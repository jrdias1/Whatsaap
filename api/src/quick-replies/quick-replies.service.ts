import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContext } from '../security/tenant-context.js';
import { assertReadableMessageText } from '../common/message-text-integrity.js';

const allowedVariables = new Set(['paciente.nome', 'paciente.primeiroNome', 'unidade.nome', 'atendente.nome', 'agendamento.data', 'agendamento.hora']);

@Injectable()
export class QuickRepliesService {
  constructor(private readonly prisma: PrismaService, private readonly context: TenantContext) {}
  private scope() {
    const scope = this.context.current();
    if (!scope) throw new ForbiddenException('Tenant obrigatório.');
    return scope;
  }
  private async allowedUnits() {
    const s = this.scope();
    if (['TENANT_ADMIN', 'PLATFORM_SUPERADMIN'].includes(s.role)) return null;
    return (await this.prisma.scoped.unitMembership.findMany({ where: { membershipId: s.membershipId }, select: { unitId: true } })).map(({ unitId }) => unitId);
  }
  async list(search?: string) {
    const s = this.scope();
    const term = search?.trim();
    return this.prisma.scoped.quickReply.findMany({
      where: { tenantId: s.tenantId, active: true, ...(term ? { OR: [{ name: { contains: term, mode: 'insensitive' } }, { description: { contains: term, mode: 'insensitive' } }, { shortcut: { contains: term, mode: 'insensitive' } }, { category: { contains: term, mode: 'insensitive' } }] } : {}) },
      orderBy: [{ category: 'asc' }, { name: 'asc' }, { id: 'asc' }], take: 200,
    });
  }
  async create(input: Record<string, unknown>) {
    const s = this.scope();
    this.assertAdmin(s.role);
    const data = this.validate(input) as { name: string; category: string; body: string; description?: string | null; shortcut?: string | null; active?: boolean };
    const row = await this.prisma.scoped.quickReply.create({ data: { tenantId: s.tenantId, ...data, createdById: s.userId, updatedById: s.userId } });
    await this.prisma.scoped.auditEvent.create({ data: { tenantId: s.tenantId, actorUserId: s.userId, action: 'QUICK_REPLY_CREATED', entityType: 'QuickReply', entityId: row.id } });
    return row;
  }
  async update(id: string, input: Record<string, unknown>) {
    const s = this.scope();
    this.assertAdmin(s.role);
    const current = await this.prisma.scoped.quickReply.findFirst({ where: { id, tenantId: s.tenantId } });
    if (!current) throw new NotFoundException('Resposta rápida não encontrada.');
    const data = this.validate(input, true);
    const updated = await this.prisma.scoped.quickReply.update({ where: { tenantId_id: { tenantId: s.tenantId, id } }, data: { ...data, updatedById: s.userId } });
    await this.prisma.scoped.auditEvent.create({ data: { tenantId: s.tenantId, actorUserId: s.userId, action: data.active === false ? 'QUICK_REPLY_DEACTIVATED' : 'QUICK_REPLY_UPDATED', entityType: 'QuickReply', entityId: id } });
    return updated;
  }
  async preview(id: string, conversationId: string) {
    const s = this.scope();
    const allowed = await this.allowedUnits();
    const [reply, conversation] = await Promise.all([
      this.prisma.scoped.quickReply.findFirst({ where: { id, tenantId: s.tenantId, active: true } }),
      this.prisma.scoped.conversation.findFirst({ where: { id: conversationId, tenantId: s.tenantId, ...(allowed ? { unitId: { in: allowed } } : {}) }, include: { patient: { select: { id: true, fullName: true } }, unit: { select: { id: true, name: true } }, assignedTo: { select: { displayName: true } } } }),
    ]);
    if (!reply) throw new NotFoundException('Resposta rápida não encontrada.');
    if (!conversation) throw new NotFoundException('Conversa não encontrada.');
    const appointment = await this.prisma.scoped.appointment.findFirst({ where: { tenantId: s.tenantId, unitId: conversation.unitId, patientId: conversation.patientId, startsAt: { gte: new Date() }, status: { in: ['PENDING', 'CONFIRMED'] } }, orderBy: [{ startsAt: 'asc' }, { id: 'asc' }], select: { startsAt: true } });
    const dateParts = appointment ? new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short' }).format(appointment.startsAt) : undefined;
    const timeParts = appointment ? new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }).format(appointment.startsAt) : undefined;
    const firstName = conversation.patient.fullName.trim().split(/\s+/)[0] ?? '';
    const values: Record<string, string | undefined> = {
      'paciente.nome': conversation.patient.fullName,
      'paciente.primeiroNome': firstName,
      'unidade.nome': conversation.unit.name,
      'atendente.nome': conversation.assignedTo?.displayName ?? (s.role === 'OPERATOR' ? 'Equipe' : undefined),
      'agendamento.data': dateParts,
      'agendamento.hora': timeParts,
    };
    const unresolved: string[] = [];
    const body = reply.body.replace(/\{\{\s*([\p{L}.]+)\s*\}\}/gu, (token, key: string) => {
      if (!allowedVariables.has(key)) { unresolved.push(token); return token; }
      const value = values[key];
      if (!value) { unresolved.push(token); return token; }
      return value;
    });
    return { body, unresolved: [...new Set(unresolved)], canInsert: unresolved.length === 0 };
  }
  private assertAdmin(role: string) { if (!['TENANT_ADMIN', 'UNIT_MANAGER'].includes(role)) throw new ForbiddenException('Somente administradores ou gerentes podem administrar respostas rápidas.'); }
  private validate(input: Record<string, unknown>, partial = false) {
    const data: Record<string, unknown> = {};
    const fields = ['name', 'description', 'shortcut', 'category', 'body', 'active'] as const;
    if (partial && !fields.some((field) => input[field] !== undefined)) throw new BadRequestException('Informe ao menos um campo.');
    for (const field of fields) {
      if (input[field] === undefined) { if (!partial && field !== 'description' && field !== 'shortcut' && field !== 'active') throw new BadRequestException(`Campo ${field} obrigatório.`); continue; }
      const value = input[field];
      if (field === 'active') { if (typeof value !== 'boolean') throw new BadRequestException('O status precisa ser válido.'); data.active = value; continue; }
      if (field === 'description' || field === 'shortcut') { if (value === null || value === '') { data[field] = null; continue; } }
      if (typeof value !== 'string') throw new BadRequestException(`${this.fieldLabel(field)} precisa ser um texto válido.`);
      const text = value.trim();
      const max = field === 'body' ? 4000 : field === 'description' ? 240 : field === 'shortcut' ? 40 : field === 'name' ? 100 : 60;
      if ((field !== 'description' && field !== 'shortcut' && text.length < 1) || text.length > max) throw new BadRequestException(`${this.fieldLabel(field)} deve respeitar o limite de ${field === 'body' ? '1 a 4.000' : field === 'name' ? '1 a 100' : '1 a 60'} caracteres.`);
      if (field === 'body') assertReadableMessageText(text, 'resposta rápida');
      if (field === 'body' && /\{\{\s*([^}]+)\s*\}\}/g.test(text)) {
        const keys = [...text.matchAll(/\{\{\s*([^}]+)\s*\}\}/g)].map((match) => match[1].trim());
        if (keys.some((key) => !allowedVariables.has(key))) throw new BadRequestException('A resposta contém variável não permitida.');
      }
      data[field] = text;
    }
    return data as { name?: string; description?: string | null; shortcut?: string | null; category?: string; body?: string; active?: boolean };
  }
  private fieldLabel(field: string) { return ({ name: 'O nome', description: 'A descrição', shortcut: 'O atalho', category: 'A categoria', body: 'O texto da resposta' } as Record<string, string>)[field] ?? 'O campo'; }
}
