import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConsentPurpose, ConversationStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContext } from '../security/tenant-context.js';
import { UsageService } from '../usage/usage.service.js';
import { randomUUID } from 'node:crypto';
import { assertReadableMessageText } from '../common/message-text-integrity.js';
import { assertManualMessagePurpose, SERVICE_REPLY } from './manual-message-purpose.js';

@Injectable()
export class InboxService {
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
  private async allowedUnits() {
    const s = this.scope();
    if (['TENANT_ADMIN', 'PLATFORM_SUPERADMIN'].includes(s.role)) return null;
    return (
      await this.prisma.scoped.unitMembership.findMany({
        where: { membershipId: s.membershipId },
        select: { unitId: true },
      })
    ).map((x) => x.unitId);
  }
  private async ensureDefaultStages(tenantId: string) {
    const defaults = ['Novo atendimento', 'Triagem', 'Em atendimento', 'Aguardando paciente', 'Agendado', 'Pós-atendimento', 'Encerrado'];
    const previousDefaults = ['Novo contato', 'Identificação', 'Em atendimento', 'Aguardando paciente', 'Aguardando confirmação', 'Resolvido'];
    await this.prisma.unscoped.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id = ${tenantId}::uuid FOR UPDATE`;
      const count = await tx.conversationStage.count({ where: { tenantId } });
      if (count === 0) {
        await tx.conversationStage.createMany({
          data: defaults.map((name, position) => ({ tenantId, name, position })),
          skipDuplicates: true,
        });
      } else {
        const existing = await tx.conversationStage.findMany({ where: { tenantId }, orderBy: [{ position: 'asc' }, { id: 'asc' }] });
        const untouchedDefaults = existing.length === previousDefaults.length && existing.every((stage, index) => stage.active && stage.position === index && stage.name === previousDefaults[index]);
        if (untouchedDefaults) {
          await Promise.all(existing.map((stage, index) => tx.conversationStage.update({
            where: { tenantId_id: { tenantId, id: stage.id } },
            data: { name: defaults[index < 5 ? index : 6], position: index < 5 ? index : 6 },
          })));
          await tx.conversationStage.create({ data: { tenantId, name: defaults[5], position: 5 } });
        }
      }
      const first = await tx.conversationStage.findFirst({ where: { tenantId, active: true }, orderBy: [{ position: 'asc' }, { id: 'asc' }] });
      if (first) await tx.conversation.updateMany({ where: { tenantId, pipelineStageId: null }, data: { pipelineStageId: first.id } });
    });
    return this.prisma.scoped.conversationStage.findMany({ where: { active: true }, include: { campaign: { select: { id: true, name: true, body: true, mode: true, status: true, provider: true } } }, orderBy: [{ position: 'asc' }, { id: 'asc' }] });
  }
  async list(unitId?: string, assigneeId?: string) {
    const s = this.scope();
    await this.ensureDefaultStages(s.tenantId);
    const allowed = await this.allowedUnits();
    if (unitId && allowed && !allowed.includes(unitId))
      throw new ForbiddenException('Unidade fora do escopo.');
    return this.prisma.scoped.conversation.findMany({
      where: {
        tenantId: s.tenantId,
        ...(unitId ? { unitId } : allowed ? { unitId: { in: allowed } } : {}),
        ...(assigneeId === 'QUEUE' ? { assignedToId: null } : assigneeId ? { assignedToId: assigneeId } : {}),
      },
      include: {
        patient: { select: { id: true, fullName: true, phone: true } },
        unit: { select: { id: true, name: true } },
        assignedTo: { select: { id: true, displayName: true } },
        pipelineStage: { select: { id: true, name: true, position: true, campaignId: true } },
        stageCampaignEnrollments: { orderBy: { createdAt: 'desc' }, take: 1, select: { id: true, stageId: true, campaignId: true, status: true, dueAt: true, reason: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
      orderBy: [{ status: 'asc' }, { lastMessageAt: 'desc' }],
      take: 200,
    });
  }

  async stages() { return this.ensureDefaultStages(this.scope().tenantId); }

  async createStage(input: Record<string, unknown>) {
    const s = this.scope();
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    const position = Number(input.position);
    if (name.length < 2 || name.length > 60 || !Number.isInteger(position) || position < 0 || position > 100) throw new BadRequestException('Nome/ordem da etapa inválidos.');
    const campaignId = typeof input.campaignId === 'string' && input.campaignId ? input.campaignId : null;
    const inactivityDays = campaignId ? Number(input.inactivityDays) : null;
    if (campaignId) {
      if (!Number.isInteger(inactivityDays) || inactivityDays! < 0 || inactivityDays! > 90) throw new BadRequestException('Informe de 0 a 90 dias sem resposta. Use 0 para iniciar ao entrar na etapa.');
      const campaign = await this.prisma.scoped.campaign.findFirst({ where: { id: campaignId, mode: 'STAGE', status: 'APPROVED' }, select: { id: true } });
      if (!campaign) throw new BadRequestException('Escolha uma campanha ativa para o funil.');
    }
    const stage = await this.prisma.scoped.conversationStage.create({ data: { tenantId: s.tenantId, name, position, campaignId, inactivityDays } });
    await this.prisma.scoped.auditEvent.create({ data: { tenantId: s.tenantId, actorUserId: s.userId, action: 'CONVERSATION_STAGE_CREATED', entityType: 'ConversationStage', entityId: stage.id } });
    return stage;
  }

  async updateStage(id: string, input: Record<string, unknown>) {
    const s = this.scope();
    const data: { name?: string; position?: number; active?: boolean; campaignId?: string | null; inactivityDays?: number | null } = {};
    if (input.name !== undefined) {
      if (typeof input.name !== 'string' || input.name.trim().length < 2 || input.name.trim().length > 60) throw new BadRequestException('Nome da etapa inválido.');
      data.name = input.name.trim();
    }
    if (input.position !== undefined) {
      const position = Number(input.position);
      if (!Number.isInteger(position) || position < 0 || position > 100) throw new BadRequestException('Ordem da etapa inválida.');
      data.position = position;
    }
    if (input.active !== undefined) {
      if (typeof input.active !== 'boolean') throw new BadRequestException('Estado da etapa inválido.');
      data.active = input.active;
    }
    if (input.campaignId !== undefined) {
      if (input.campaignId !== null && typeof input.campaignId !== 'string') throw new BadRequestException('Campanha inválida.');
      data.campaignId = input.campaignId || null;
    }
    if (input.inactivityDays !== undefined) {
      const days = Number(input.inactivityDays);
      if (!Number.isInteger(days) || days < 0 || days > 90) throw new BadRequestException('Informe de 0 a 90 dias sem resposta.');
      data.inactivityDays = days;
    }
    return this.prisma.unscoped.$transaction(async (tx) => {
      const current = await tx.conversationStage.findFirst({ where: { tenantId: s.tenantId, id } });
      if (!current) throw new NotFoundException('Etapa não encontrada.');
      const nextCampaignId = data.campaignId === undefined ? current.campaignId : data.campaignId;
      if (nextCampaignId) {
        const campaign = await tx.campaign.findFirst({ where: { tenantId: s.tenantId, id: nextCampaignId, mode: 'STAGE', status: 'APPROVED' }, select: { id: true } });
        if (!campaign) throw new BadRequestException('Escolha uma campanha ativa para o funil.');
        if (data.inactivityDays == null && current.inactivityDays == null) throw new BadRequestException('Informe os dias sem resposta.');
      } else data.inactivityDays = null;
      if (data.active === false) {
        const fallback = await tx.conversationStage.findFirst({ where: { tenantId: s.tenantId, active: true, campaignId: null, id: { not: id } }, orderBy: [{ position: 'asc' }, { id: 'asc' }] });
        if (!fallback) throw new BadRequestException('Mantenha pelo menos uma etapa ativa.');
        const moved = await tx.conversation.updateMany({ where: { tenantId: s.tenantId, pipelineStageId: id }, data: { pipelineStageId: fallback.id } });
        if (moved.count) await tx.auditEvent.create({ data: { tenantId: s.tenantId, actorUserId: s.userId, action: 'CONVERSATION_STAGE_DEACTIVATED', entityType: 'ConversationStage', entityId: id, metadata: { fallbackStageId: fallback.id, movedConversations: moved.count } } });
      }
      if (data.active === false || nextCampaignId !== current.campaignId || data.inactivityDays !== undefined && data.inactivityDays !== current.inactivityDays) {
        await tx.stageCampaignEnrollment.updateMany({ where: { tenantId: s.tenantId, stageId: id, status: 'PENDING' }, data: { status: 'CANCELLED', reason: 'A configuração da etapa foi alterada.' } });
        const queued = await tx.stageCampaignEnrollment.findMany({ where: { tenantId: s.tenantId, stageId: id, status: 'OUTBOXED', outboxMessageId: { not: null } }, select: { outboxMessageId: true } });
        const ids = queued.flatMap((item) => item.outboxMessageId ? [item.outboxMessageId] : []);
        if (ids.length) await tx.outboxMessage.updateMany({ where: { tenantId: s.tenantId, id: { in: ids }, status: { in: ['PENDING', 'RETRY'] } }, data: { status: 'SUPPRESSED', suppressionReason: 'STAGE_CONFIGURATION_CHANGED' } });
        await tx.stageCampaignEnrollment.updateMany({ where: { tenantId: s.tenantId, stageId: id, status: 'OUTBOXED' }, data: { status: 'SUPPRESSED', reason: 'A configuração da etapa foi alterada antes do processamento.' } });
      }
      const stage = await tx.conversationStage.update({ where: { tenantId_id: { tenantId: s.tenantId, id } }, data });
      await tx.auditEvent.create({ data: { tenantId: s.tenantId, actorUserId: s.userId, action: 'CONVERSATION_STAGE_UPDATED', entityType: 'ConversationStage', entityId: id, metadata: { before: { name: current.name, position: current.position, active: current.active }, after: data } } });
      return stage;
    });
  }

  async moveStage(id: string, stageId: unknown, enrollCampaign: unknown) {
    const s = this.scope();
    if (typeof stageId !== 'string') throw new BadRequestException('Etapa visual inválida.');
    const allowed = await this.allowedUnits();
    return this.prisma.unscoped.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Conversation" WHERE "tenantId" = ${s.tenantId}::uuid AND id = ${id}::uuid FOR UPDATE`;
      const conversation = await tx.conversation.findFirst({ where: { tenantId: s.tenantId, id, ...(allowed ? { unitId: { in: allowed } } : {}) } });
      if (!conversation) throw new NotFoundException('Conversa não encontrada.');
      const stage = await tx.conversationStage.findFirst({ where: { tenantId: s.tenantId, id: stageId, active: true } });
      if (!stage) throw new BadRequestException('Etapa visual inativa ou inexistente.');
      if (conversation.pipelineStageId === stage.id) return conversation;
      if (stage.campaignId && typeof enrollCampaign !== 'boolean') throw new BadRequestException('Confirme se deseja incluir o paciente na campanha desta etapa.');
      const campaign = stage.campaignId ? await tx.campaign.findFirst({ where: { tenantId: s.tenantId, id: stage.campaignId, mode: 'STAGE', status: 'APPROVED' } }) : null;
      if (stage.campaignId && !campaign) throw new BadRequestException('A campanha desta etapa não está ativa.');
      await tx.stageCampaignEnrollment.updateMany({ where: { tenantId: s.tenantId, conversationId: id, status: 'PENDING' }, data: { status: 'CANCELLED', reason: 'O cartão mudou de etapa.' } });
      const queued = await tx.stageCampaignEnrollment.findMany({ where: { tenantId: s.tenantId, conversationId: id, status: 'OUTBOXED', outboxMessageId: { not: null } }, select: { outboxMessageId: true } });
      const queuedIds = queued.flatMap((item) => item.outboxMessageId ? [item.outboxMessageId] : []);
      if (queuedIds.length) await tx.outboxMessage.updateMany({ where: { tenantId: s.tenantId, id: { in: queuedIds }, status: { in: ['PENDING', 'RETRY'] } }, data: { status: 'SUPPRESSED', suppressionReason: 'PATIENT_LEFT_STAGE' } });
      await tx.stageCampaignEnrollment.updateMany({ where: { tenantId: s.tenantId, conversationId: id, status: 'OUTBOXED' }, data: { status: 'SUPPRESSED', reason: 'O cartão saiu da etapa antes do processamento.' } });
      const updated = await tx.conversation.update({ where: { tenantId_id: { tenantId: s.tenantId, id } }, data: { pipelineStageId: stage.id } });
      if (campaign && enrollCampaign === true) await tx.stageCampaignEnrollment.create({ data: { tenantId: s.tenantId, conversationId: id, stageId: stage.id, campaignId: campaign.id, body: campaign.body, inactivityDays: stage.inactivityDays ?? 0, dueAt: new Date(Date.now() + (stage.inactivityDays ?? 0) * 86400000) } });
      await tx.auditEvent.create({ data: { tenantId: s.tenantId, actorUserId: s.userId, action: 'CONVERSATION_STAGE_CHANGED', entityType: 'Conversation', entityId: id, metadata: { fromStageId: conversation.pipelineStageId, toStageId: stage.id, stageName: stage.name, campaignEnrollment: Boolean(campaign && enrollCampaign) } } });
      return updated;
    });
  }

  async stageHistory(id: string) {
    const s = this.scope();
    const allowed = await this.allowedUnits();
    const conversation = await this.prisma.scoped.conversation.findFirst({ where: { id, ...(allowed ? { unitId: { in: allowed } } : {}) }, select: { id: true } });
    if (!conversation) throw new NotFoundException('Conversa não encontrada.');
    return this.prisma.scoped.auditEvent.findMany({ where: { entityType: 'Conversation', entityId: id, action: 'CONVERSATION_STAGE_CHANGED', tenantId: s.tenantId }, orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }] });
  }
  async assignees(unitId?: string) {
    const s = this.scope();
    const allowed = await this.allowedUnits();
    if (unitId && allowed && !allowed.includes(unitId)) throw new ForbiddenException('Unidade fora do escopo.');
    if (unitId && !(await this.prisma.scoped.unit.findFirst({ where: { id: unitId, active: true }, select: { id: true } }))) throw new BadRequestException('Unidade inválida.');
    const unitIds = unitId ? [unitId] : allowed;
    const memberships = await this.prisma.scoped.membership.findMany({
      where: {
        tenantId: s.tenantId,
        status: 'ACTIVE',
        user: { active: true },
        ...(unitIds ? { OR: [{ role: { in: ['TENANT_ADMIN', 'PLATFORM_SUPERADMIN'] } }, { unitScopes: { some: { unitId: { in: unitIds } } } }] } : {}),
      },
      select: { user: { select: { id: true, displayName: true } }, role: true },
      orderBy: { user: { displayName: 'asc' } },
    });
    return memberships.map((membership) => ({ ...membership.user, role: membership.role }));
  }

  async assignmentHistory(id: string) {
    const s = this.scope();
    const allowed = await this.allowedUnits();
    const conversation = await this.prisma.scoped.conversation.findFirst({ where: { id, ...(allowed ? { unitId: { in: allowed } } : {}) }, select: { id: true } });
    if (!conversation) throw new NotFoundException('Conversa não encontrada.');
    return this.prisma.scoped.conversationAssignment.findMany({
      where: { conversationId: id, tenantId: s.tenantId },
      include: { actor: { select: { id: true, displayName: true } } },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
    });
  }

  async claim(id: string) { return this.changeAssignee(id, 'CLAIM'); }

  async changeAssignment(id: string, targetValue: unknown) {
    if (targetValue !== null && typeof targetValue !== 'string') throw new BadRequestException('Responsável inválido.');
    return this.changeAssignee(id, targetValue as string | null);
  }

  private async changeAssignee(id: string, target: string | null | 'CLAIM') {
    const s = this.scope();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) throw new NotFoundException('Conversa não encontrada.');
    const allowed = await this.allowedUnits();
    return this.prisma.unscoped.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Conversation" WHERE "tenantId" = ${s.tenantId}::uuid AND id = ${id}::uuid FOR UPDATE`;
      const conversation = await tx.conversation.findFirst({ where: { id, tenantId: s.tenantId, ...(allowed ? { unitId: { in: allowed } } : {}) } });
      if (!conversation) throw new NotFoundException('Conversa não encontrada.');
      if (target === 'CLAIM' && conversation.assignedToId && conversation.assignedToId !== s.userId) throw new ConflictException('A conversa já foi assumida por outra pessoa.');
      if (s.role === 'OPERATOR' && conversation.assignedToId && conversation.assignedToId !== s.userId) throw new ForbiddenException('Operadores só podem alterar conversas atribuídas a si ou ainda sem responsável.');
      let assigneeId: string | null;
      let action: 'CLAIMED' | 'ASSIGNED' | 'TRANSFERRED' | 'RELEASED';
      if (target === 'CLAIM') {
        if (conversation.assignedToId && conversation.assignedToId !== s.userId) throw new ConflictException('A conversa já foi assumida por outra pessoa.');
        assigneeId = s.userId;
        action = conversation.assignedToId === s.userId ? 'ASSIGNED' : 'CLAIMED';
      } else {
        assigneeId = target;
        if (assigneeId) {
          const membership = await tx.membership.findFirst({
            where: { tenantId: s.tenantId, status: 'ACTIVE', userId: assigneeId, user: { active: true } },
            select: { role: true, unitScopes: { where: { unitId: conversation.unitId }, select: { unitId: true } } },
          });
          if (!membership || (!['TENANT_ADMIN', 'PLATFORM_SUPERADMIN'].includes(membership.role) && !membership.unitScopes.length)) throw new BadRequestException('O responsável precisa ter acesso ativo à unidade da conversa.');
        }
        action = !assigneeId ? 'RELEASED' : conversation.assignedToId ? 'TRANSFERRED' : 'ASSIGNED';
      }
      const updated = await tx.conversation.update({ where: { tenantId_unitId_id: { tenantId: s.tenantId, unitId: conversation.unitId, id } }, data: { assignedToId: assigneeId } });
      await tx.conversationAssignment.create({ data: { tenantId: s.tenantId, conversationId: id, actorUserId: s.userId, fromUserId: conversation.assignedToId, toUserId: assigneeId, action } });
      await tx.auditEvent.create({ data: { tenantId: s.tenantId, actorUserId: s.userId, action: 'CONVERSATION_ASSIGNED', entityType: 'Conversation', entityId: id, metadata: { fromUserId: conversation.assignedToId, toUserId: assigneeId, assignmentAction: action } } });
      return updated;
    });
  }

  async open(input: Record<string, unknown>) {
    const s = this.scope();
    const unitId = String(input.unitId || '');
    const patientId = String(input.patientId || '');
    const allowed = await this.allowedUnits();
    if (!unitId || !patientId || (allowed && !allowed.includes(unitId)))
      throw new ForbiddenException('Unidade ou paciente fora do escopo.');
    const [unit, patient] = await Promise.all([
      this.prisma.scoped.unit.findFirst({
        where: { id: unitId, active: true },
      }),
      this.prisma.scoped.patient.findFirst({
        where: { id: patientId, deletedAt: null },
      }),
    ]);
    if (!unit || !patient)
      throw new BadRequestException('Unidade/paciente inválido.');
    if (allowed && patient.unitId && !allowed.includes(patient.unitId))
      throw new ForbiddenException(
        'Paciente fora do escopo das unidades permitidas.',
      );
    const stages = await this.ensureDefaultStages(s.tenantId);
    return this.prisma.scoped.conversation.create({
      data: { tenantId: s.tenantId, unitId, patientId, assignedToId: s.userId, pipelineStageId: stages[0]?.id },
    });
  }
  async messages(id: string) {
    const allowed = await this.allowedUnits();
    const convo = await this.prisma.scoped.conversation.findFirst({
      where: { id, ...(allowed ? { unitId: { in: allowed } } : {}) },
    });
    if (!convo) throw new NotFoundException('Conversa não encontrada.');
    return this.prisma.scoped.message.findMany({
      where: { conversationId: id },
      orderBy: { createdAt: 'asc' },
      take: 500,
    });
  }
  async addMessage(id: string, input: Record<string, unknown>) {
    const s = this.scope();
    const allowed = await this.allowedUnits();
    const convo = await this.prisma.scoped.conversation.findFirst({
      where: { id, ...(allowed ? { unitId: { in: allowed } } : {}) },
    });
    if (!convo) throw new NotFoundException('Conversa não encontrada.');
    const body = typeof input.body === 'string' ? input.body.trim() : '';
    if (!body || body.length > 4000)
      throw new BadRequestException('Mensagem inválida.');
    assertReadableMessageText(body);
    // This operator endpoint cannot impersonate provider webhooks or the AI.
    if (input.direction === 'INBOUND')
      throw new ForbiddenException('Mensagens recebidas exigem webhook autenticado do provedor.');
    if (input.actor === 'AI' || input.approved !== undefined)
      throw new BadRequestException('Mensagens de IA devem passar pelo fluxo de revisao de rascunhos.');
    const direction = 'OUTBOUND' as const;
    const actor = 'HUMAN' as const;
    const purpose = input.purpose as ConsentPurpose | typeof SERVICE_REPLY;
    if (purpose !== SERVICE_REPLY && !Object.values(ConsentPurpose).includes(purpose))
      throw new BadRequestException('Escolha o tipo da mensagem antes de registrar a resposta.');
    const messageKey = direction === 'OUTBOUND'
      ? `inbox:${s.tenantId}:${typeof input.idempotencyKey === 'string' && input.idempotencyKey.length ? input.idempotencyKey.slice(0, 140) : randomUUID()}`
      : undefined;
    const created = await this.prisma.unscoped.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Patient" WHERE "tenantId" = ${s.tenantId}::uuid AND id = ${convo.patientId}::uuid FOR UPDATE`;
      await assertManualMessagePurpose(tx, s.tenantId, convo.patientId, id, purpose);
      if (messageKey) {
        const subscription = await this.prisma.scoped.subscription.findUnique({ where: { tenantId: s.tenantId }, include: { plan: true } });
        if (!subscription || !subscription.plan.enabled || !['TRIAL', 'ACTIVE'].includes(subscription.status) || subscription.cycleStartsAt > new Date() || subscription.cycleEndsAt <= new Date()) throw new BadRequestException('Tenant sem plano/ciclo ativo.');
        await this.usage.consumeWithinTransaction(tx, 'messages', messageKey, 1, subscription);
      }
      const msg = await tx.message.create({
        data: {
          tenantId: s.tenantId,
          conversationId: id,
          direction,
          actor,
          body,
          status: 'QUEUED',
          idempotencyKey: messageKey ?? (typeof input.idempotencyKey === 'string' ? input.idempotencyKey.slice(0, 160) : undefined),
        },
      });
      await tx.auditEvent.create({ data: { tenantId: s.tenantId, actorUserId: s.userId, action: 'INBOX_RESPONSE_REGISTERED', entityType: 'Message', entityId: msg.id, metadata: { channel: 'WHATSAPP', purpose, providerSendEnabled: false } } });
      await tx.conversation.update({
        where: {
          tenantId_unitId_id: {
            tenantId: s.tenantId,
            unitId: convo.unitId,
            id,
          },
        },
        data: {
          lastMessageAt: new Date(),

        },
      });
      return msg;
    });
    return {
      ...created,
      providerSendEnabled: false,

    };
  }
  async close(id: string) {
    return this.changeStatus(id, 'CLOSED');
  }

  async changeStatus(id: string, value: unknown) {
    const s = this.scope();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) throw new NotFoundException('Conversa não encontrada.');
    if (typeof value !== 'string' || !Object.values(ConversationStatus).includes(value as ConversationStatus)) {
      throw new BadRequestException('Etapa de conversa inválida.');
    }
    const allowed = await this.allowedUnits();
    return this.prisma.unscoped.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Conversation" WHERE "tenantId" = ${s.tenantId}::uuid AND id = ${id}::uuid FOR UPDATE`;
      const conversation = await tx.conversation.findFirst({ where: { id, tenantId: s.tenantId, ...(allowed ? { unitId: { in: allowed } } : {}) } });
      if (!conversation) throw new NotFoundException('Conversa não encontrada.');
      const status = value as ConversationStatus;
      const updated = await tx.conversation.update({ where: { tenantId_id: { tenantId: s.tenantId, id } }, data: { status, ...(status === 'CLOSED' ? { humanResponseDueAt: null } : {}) } });
      if (status === 'CLOSED') {
        await tx.stageCampaignEnrollment.updateMany({ where: { tenantId: s.tenantId, conversationId: id, status: 'PENDING' }, data: { status: 'CANCELLED', reason: 'Conversa encerrada antes do prazo.' } });
        const queued = await tx.stageCampaignEnrollment.findMany({ where: { tenantId: s.tenantId, conversationId: id, status: 'OUTBOXED', outboxMessageId: { not: null } }, select: { id: true, outboxMessageId: true } });
        const outboxIds = queued.flatMap((item) => item.outboxMessageId ? [item.outboxMessageId] : []);
        if (outboxIds.length) await tx.outboxMessage.updateMany({ where: { tenantId: s.tenantId, id: { in: outboxIds }, status: { in: ['PENDING', 'RETRY'] } }, data: { status: 'SUPPRESSED', suppressionReason: 'CONVERSATION_CLOSED' } });
        await tx.stageCampaignEnrollment.updateMany({ where: { tenantId: s.tenantId, conversationId: id, status: 'OUTBOXED' }, data: { status: 'SUPPRESSED', reason: 'Conversa encerrada antes do processamento.' } });
      }
      await tx.auditEvent.create({ data: { tenantId: s.tenantId, actorUserId: s.userId, action: 'CONVERSATION_STATUS_CHANGED', entityType: 'Conversation', entityId: id, metadata: { from: conversation.status, to: status } } });
      return updated;
    });
  }
}
