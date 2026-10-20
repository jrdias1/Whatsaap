import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConsentPurpose } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContext } from '../security/tenant-context.js';
import { UsageService } from '../usage/usage.service.js';
import { assertReadableMessageText } from '../common/message-text-integrity.js';
import { appointmentTemplateValues, renderCampaignTemplate, validateCampaignTemplate } from './campaign-template.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class CampaignsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly context: TenantContext,
    private readonly usage: UsageService,
  ) {}
  private scope() {
    const s = this.context.current();
    if (!s) throw new ForbiddenException('Tenant obrigatório.');
    return s;
  }
  async list() {
    const s = this.scope();
    return this.prisma.scoped.campaign.findMany({
      where: { tenantId: s.tenantId, ...(s.role === 'UNIT_MANAGER' ? { mode: 'STAGE' } : {}) },
      include: { _count: { select: { outbox: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }
  private async permittedUnitIds() {
    const s = this.scope();
    if (s.role === 'TENANT_ADMIN') return null;
    return (await this.prisma.scoped.unitMembership.findMany({ where: { membershipId: s.membershipId }, select: { unitId: true } })).map((row) => row.unitId);
  }
  private patientIds(value: unknown) {
    if (!Array.isArray(value) || value.length > 10000 || value.some((id) => typeof id !== 'string' || !uuid.test(id))) throw new BadRequestException('Selecione até 10.000 pacientes válidos.');
    return [...new Set(value as string[])];
  }
  async audience(search = '', ids = '') {
    const s = this.scope();
    const unitIds = await this.permittedUnitIds();
    const selectedIds = ids ? ids.split(',').filter(Boolean) : [];
    if (search.length > 120 || selectedIds.length > 100 || selectedIds.some((id) => !uuid.test(id))) throw new BadRequestException('Busca de pacientes inválida.');
    return this.prisma.scoped.patient.findMany({
      where: { tenantId: s.tenantId, active: true, deletedAt: null, phone: { not: null }, ...(unitIds ? { unitId: { in: unitIds } } : {}),
        consents: { some: { channel: 'WHATSAPP', purpose: 'MARKETING', status: 'GRANTED' } },
        ...(selectedIds.length ? { id: { in: selectedIds } } : search.trim() ? { OR: [{ fullName: { contains: search.trim(), mode: 'insensitive' } }, { phone: { contains: search.trim() } }] } : {}) },
      select: { id: true, fullName: true, phone: true, unit: { select: { name: true } } },
      orderBy: [{ fullName: 'asc' }, { id: 'asc' }], take: 100,
    });
  }
  private async assertAudience(ids: string[]) {
    const s = this.scope();
    const unitIds = await this.permittedUnitIds();
    const count = await this.prisma.scoped.patient.count({ where: { tenantId: s.tenantId, id: { in: ids }, active: true, deletedAt: null, phone: { not: null }, ...(unitIds ? { unitId: { in: unitIds } } : {}), consents: { some: { channel: 'WHATSAPP', purpose: 'MARKETING', status: 'GRANTED' } } } });
    if (count !== ids.length) throw new BadRequestException('Um ou mais pacientes não estão ativos, acessíveis ou com consentimento de WhatsApp para marketing.');
  }
  async create(input: Record<string, unknown>) {
    const s = this.scope();
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    const body = typeof input.body === 'string' ? input.body.trim() : '';
    const mode = input.mode === undefined ? 'BULK' : input.mode;
    if (mode !== 'BULK' && mode !== 'STAGE') throw new BadRequestException('Tipo de campanha inválido.');
    if (name.length < 2 || name.length > 120 || !body || body.length > 4000)
      throw new BadRequestException(
        'Nome e conteúdo da campanha são obrigatórios.',
      );
    assertReadableMessageText(body);
    validateCampaignTemplate(body);
    if (mode === 'BULK' && /\{\{\s*atendente\.nome\s*\}\}/u.test(body)) throw new BadRequestException('Atendente só está disponível nas mensagens do funil.');
    const provider = input.provider ?? 'META_CLOUD';
    if (provider !== 'META_CLOUD' && !(mode === 'STAGE' && provider === 'EVOLUTION_BAILEYS'))
      throw new BadRequestException(
        'Listas exigem Meta Cloud. A mensagem individual do funil pode usar Meta Cloud ou Evolution/Baileys.',
      );
    const audiencePatientIds = mode === 'BULK' ? this.patientIds(input.audiencePatientIds ?? []) : [];
    if (audiencePatientIds.length) await this.assertAudience(audiencePatientIds);
    const scheduledAtInput = input.scheduledAt;
    if (
      scheduledAtInput !== undefined &&
      (typeof scheduledAtInput !== 'string' ||
        !/(?:Z|[+-]\d{2}:\d{2})$/i.test(scheduledAtInput))
    ) {
      throw new BadRequestException(
        'Informe a data da campanha com fuso horario explicito.',
      );
    }
    const scheduledAt = scheduledAtInput
      ? new Date(scheduledAtInput)
      : new Date();
    if (Number.isNaN(scheduledAt.getTime()))
      throw new BadRequestException('Agendamento da campanha inválido.');
    return this.prisma.scoped.campaign.create({
      data: {
        tenantId: s.tenantId,
        name,
        body,
        audiencePatientIds,
        mode,
        channel: 'WHATSAPP',
        provider,
        status: mode === 'STAGE' ? 'APPROVED' : 'DRAFT',
        scheduledAt,
        createdById: s.userId,
      },
    });
  }
  async update(id: string, input: Record<string, unknown>) {
    const s = this.scope();
    const campaign = await this.prisma.scoped.campaign.findFirst({ where: { tenantId: s.tenantId, id } });
    if (!campaign) throw new NotFoundException('Campanha não encontrada.');
    if (campaign.mode === 'BULK' && campaign.status !== 'DRAFT') throw new BadRequestException('A lista já foi aprovada. Crie outra campanha para alterar o público ou a mensagem.');
    const name = input.name === undefined ? campaign.name : typeof input.name === 'string' ? input.name.trim() : '';
    const body = input.body === undefined ? campaign.body : typeof input.body === 'string' ? input.body.trim() : '';
    if (name.length < 2 || name.length > 120 || !body || body.length > 4000) throw new BadRequestException('Informe nome e mensagem válidos.');
    assertReadableMessageText(body); validateCampaignTemplate(body);
    if (campaign.mode === 'BULK' && /\{\{\s*atendente\.nome\s*\}\}/u.test(body)) throw new BadRequestException('Atendente só está disponível nas mensagens do funil.');
    const provider = input.provider ?? campaign.provider;
    if (provider !== 'META_CLOUD' && !(campaign.mode === 'STAGE' && provider === 'EVOLUTION_BAILEYS')) throw new BadRequestException('Canal inválido para esta campanha.');
    const audiencePatientIds = campaign.mode === 'BULK' && input.audiencePatientIds !== undefined ? this.patientIds(input.audiencePatientIds) : campaign.audiencePatientIds;
    if (campaign.mode === 'BULK' && audiencePatientIds.length) await this.assertAudience(audiencePatientIds);
    const scheduledAt = input.scheduledAt === undefined ? campaign.scheduledAt : input.scheduledAt === null ? new Date() : typeof input.scheduledAt === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/i.test(input.scheduledAt) ? new Date(input.scheduledAt) : null;
    if (input.scheduledAt !== undefined && (!scheduledAt || Number.isNaN(scheduledAt.getTime()))) throw new BadRequestException('Informe a data com fuso horário explícito.');
    return this.prisma.unscoped.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Campaign" WHERE "tenantId" = ${s.tenantId}::uuid AND id = ${id}::uuid FOR UPDATE`;
      const current = await tx.campaign.findFirst({ where: { tenantId: s.tenantId, id } });
      if (!current || current.mode !== campaign.mode || campaign.mode === 'BULK' && current.status !== 'DRAFT') throw new BadRequestException('A campanha mudou; atualize a página antes de editar.');
      if (campaign.mode === 'STAGE') {
        await tx.stageCampaignEnrollment.updateMany({ where: { tenantId: s.tenantId, campaignId: id, status: 'PENDING' }, data: { status: 'CANCELLED', reason: 'A campanha foi editada antes do processamento.' } });
        const queued = await tx.stageCampaignEnrollment.findMany({ where: { tenantId: s.tenantId, campaignId: id, status: 'OUTBOXED', outboxMessageId: { not: null } }, select: { outboxMessageId: true } });
        const outboxIds = queued.flatMap((item) => item.outboxMessageId ? [item.outboxMessageId] : []);
        if (outboxIds.length) await tx.outboxMessage.updateMany({ where: { tenantId: s.tenantId, id: { in: outboxIds }, status: { in: ['PENDING', 'RETRY'] } }, data: { status: 'SUPPRESSED', suppressionReason: 'CAMPAIGN_EDITED' } });
        await tx.stageCampaignEnrollment.updateMany({ where: { tenantId: s.tenantId, campaignId: id, status: 'OUTBOXED' }, data: { status: 'SUPPRESSED', reason: 'A campanha foi editada antes do processamento.' } });
      }
      const updated = await tx.campaign.update({ where: { tenantId_id: { tenantId: s.tenantId, id } }, data: { name, body, provider: String(provider), audiencePatientIds, scheduledAt } });
      await tx.auditEvent.create({ data: { tenantId: s.tenantId, actorUserId: s.userId, action: 'CAMPAIGN_UPDATED', entityType: 'Campaign', entityId: id, metadata: { audienceCount: audiencePatientIds.length, provider } } });
      return updated;
    });
  }
  async approve(id: string) {
    const s = this.scope();
    const operatorUnitIds = s.role === 'OPERATOR'
      ? (await this.prisma.scoped.unitMembership.findMany({ where: { membershipId: s.membershipId }, select: { unitId: true } })).map(({ unitId }) => unitId)
      : null;
    if (operatorUnitIds && operatorUnitIds.length === 0) throw new ForbiddenException('Seu acesso não está vinculado a uma unidade para operar campanhas.');
    const campaign = await this.prisma.scoped.campaign.findFirst({
      where: { id, tenantId: s.tenantId },
    });
    if (!campaign) throw new NotFoundException('Campanha não encontrada.');
    if (campaign.mode !== 'BULK') throw new BadRequestException('Campanhas do funil são ativadas pela etapa, sem disparo para a lista inteira.');
    if (campaign.status !== 'DRAFT')
      throw new BadRequestException('Apenas rascunhos podem ser aprovados.');
    const audienceWhere = {
      tenantId: s.tenantId,
      id: { in: campaign.audiencePatientIds },
      active: true,
      deletedAt: null,
      phone: { not: null },
      ...(operatorUnitIds ? { unitId: { in: operatorUnitIds } } : {}),
      consents: { some: { channel: 'WHATSAPP' as const, purpose: ConsentPurpose.MARKETING, status: 'GRANTED' as const } },
    };
    if (!campaign.audiencePatientIds.length) throw new BadRequestException('Selecione os pacientes desta campanha antes de aprovar.');
    const schedule =
      campaign.scheduledAt && campaign.scheduledAt > new Date()
        ? campaign.scheduledAt
        : new Date();
    let queuedCount = 0;
    await this.prisma.unscoped.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Campaign" WHERE "tenantId" = ${s.tenantId}::uuid AND id = ${id}::uuid FOR UPDATE`;
      const current = await tx.campaign.findFirst({ where: { tenantId: s.tenantId, id } });
      if (!current || current.status !== 'DRAFT' || current.updatedAt.getTime() !== campaign.updatedAt.getTime()) throw new BadRequestException('A campanha mudou. Atualize a página antes de aprovar.');
      const targets = await tx.patient.findMany({ where: audienceWhere, select: { id: true, unitId: true, fullName: true, unit: { select: { name: true } } }, take: 10001 });
      if (targets.length !== campaign.audiencePatientIds.length) throw new BadRequestException('O público mudou. Revise pacientes e consentimentos antes de aprovar.');
      if (targets.length > 10000) throw new BadRequestException(`Publico excede 10.000; campanha nao aprovada.`);
      // Match consent updates and other outbound queues on a shared per-patient lock.
      if (targets.length) await tx.$queryRaw`SELECT id FROM "Patient" WHERE "tenantId" = ${s.tenantId}::uuid AND id = ANY(${targets.map(({ id }) => id)}::uuid[]) ORDER BY id FOR UPDATE`;
      const currentConsents = targets.length ? await tx.consentPreference.findMany({ where: { tenantId: s.tenantId, patientId: { in: targets.map(({ id }) => id) }, channel: 'WHATSAPP', purpose: ConsentPurpose.MARKETING, status: 'GRANTED' }, select: { patientId: true } }) : [];
      const consented = new Set(currentConsents.map(({ patientId }) => patientId));
      const currentTargets = targets.filter(({ id: patientId }) => consented.has(patientId));
      if (currentTargets.length !== campaign.audiencePatientIds.length) throw new BadRequestException('O consentimento de um paciente mudou. Revise o público antes de aprovar.');
      const upcoming = await tx.appointment.findMany({ where: { tenantId: s.tenantId, patientId: { in: currentTargets.map((p) => p.id) }, startsAt: { gte: new Date() }, status: { in: ['PENDING', 'CONFIRMED'] } }, orderBy: [{ startsAt: 'asc' }, { id: 'asc' }], select: { patientId: true, startsAt: true, procedure: { select: { name: true } } } });
      const nextAppointment = new Map<string, typeof upcoming[number]>();
      for (const appointment of upcoming) if (!nextAppointment.has(appointment.patientId)) nextAppointment.set(appointment.patientId, appointment);
      const tenant = await tx.tenant.findUnique({ where: { id: s.tenantId }, select: { name: true } });
      const rendered = currentTargets.map((patient) => {
        const appointment = nextAppointment.get(patient.id);
        const message = renderCampaignTemplate(campaign.body, { 'paciente.nome': patient.fullName, 'paciente.primeiroNome': patient.fullName.trim().split(/\s+/u)[0], 'clinica.nome': tenant?.name, 'unidade.nome': patient.unit?.name, ...appointmentTemplateValues(appointment?.startsAt, appointment?.procedure?.name) });
        if (message.missing.length) throw new BadRequestException(`Faltam dados para ${patient.fullName}: ${message.missing.join(', ')}. Edite a mensagem ou complete o cadastro.`);
        assertReadableMessageText(message.body);
        return { ...patient, body: message.body };
      });
      const unitIds = [...new Set(currentTargets.flatMap((target) => target.unitId ? [target.unitId] : []))];
      const connections = unitIds.length ? await tx.metaConnection.findMany({ where: { tenantId: s.tenantId, unitId: { in: unitIds }, enabled: true }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }], select: { id: true, unitId: true } }) : [];
      const connectionByUnit = new Map<string, string>();
      for (const connection of connections) if (!connectionByUnit.has(connection.unitId)) connectionByUnit.set(connection.unitId, connection.id);
      queuedCount = currentTargets.length;
      const subscription = await this.prisma.scoped.subscription.findUnique({ where: { tenantId: s.tenantId }, include: { plan: true } });
      if (!subscription || !subscription.plan.enabled || !['TRIAL', 'ACTIVE'].includes(subscription.status) || subscription.cycleStartsAt > new Date() || subscription.cycleEndsAt <= new Date()) throw new BadRequestException('Tenant sem plano/ciclo ativo.');
      await this.usage.consumeWithinTransaction(tx, 'campaigns', `campaign:${campaign.id}:approval`, 1, subscription);
      if (currentTargets.length) await this.usage.consumeWithinTransaction(tx, 'messages', `campaign:${campaign.id}:messages`, currentTargets.length, subscription);
      if (currentTargets.length)
        await tx.outboxMessage.createMany({
          data: rendered.map((p) => ({
            tenantId: s.tenantId,
            patientId: p.id,
            campaignId: campaign.id,
            purpose: 'MARKETING',
            channel: 'WHATSAPP',
            provider: 'META_CLOUD',
            connectionId: p.unitId ? connectionByUnit.get(p.unitId) ?? null : null,
            body: p.body,
            idempotencyKey: `campaign:${campaign.id}:patient:${p.id}`,
            scheduledAt: schedule,
          })),
          skipDuplicates: true,
        });
      await tx.campaign.update({
        where: { tenantId_id: { tenantId: s.tenantId, id } },
        data: { status: 'APPROVED' },
      });
      await tx.auditEvent.create({
        data: {
          tenantId: s.tenantId,
          actorUserId: s.userId,
          action: 'CAMPAIGN_APPROVED',
          entityType: 'Campaign',
          entityId: id,
          metadata: {
            targetCount: currentTargets.length,
            provider: 'META_CLOUD',
            scheduledAt: schedule.toISOString(),
          },
        },
      });
    });
    return {
      campaignId: id,
      queuedCount,
      provider: 'META_CLOUD',
      sendsEnabled: false,
      message:
        'Itens preparados no outbox; envio real permanece desabilitado até configurar e homologar Meta Cloud.',
    };
  }
  async listAutomations() {
    const s = this.scope();
    return this.prisma.scoped.automation.findMany({
      where: { tenantId: s.tenantId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }
  async createAutomation(input: Record<string, unknown>) {
    const s = this.scope();
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    const trigger = typeof input.trigger === 'string' ? input.trigger : '';
    const triggers = [
      'PROCEDURE_RETURN',
      'POST_CARE',
      'NPS_24H',
      'REFERRAL_CONVERSION',
    ];
    if (name.length < 2 || name.length > 120 || !triggers.includes(trigger))
      throw new BadRequestException('Nome ou gatilho de automação inválido.');
    if (
      !input.configuration ||
      typeof input.configuration !== 'object' ||
      Array.isArray(input.configuration)
    )
      throw new BadRequestException('Configuração JSON obrigatória.');
    const configuration = input.configuration as Record<string, unknown>;
    if (JSON.stringify(configuration).length > 8000)
      throw new BadRequestException('Configuração excede o limite permitido.');
    return this.prisma.scoped.automation.create({
      data: {
        tenantId: s.tenantId,
        name,
        trigger,
        status: 'DRAFT',
        configuration: configuration as any,
      },
    });
  }
}

