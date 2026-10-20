import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { UsageService } from '../usage/usage.service.js';
import { hasSuspectMessageEncoding } from '../common/message-text-integrity.js';
import { appointmentTemplateValues, renderCampaignTemplate } from '../campaigns/campaign-template.js';

const DAY_MS = 86400000;
const CONTACT_START = 9;
const CONTACT_END = 18;

@Injectable()
export class StageCampaignService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StageCampaignService.name);
  private timer?: ReturnType<typeof setInterval>;

  constructor(private readonly prisma: PrismaService, private readonly usage: UsageService) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.reconcile().catch((error: unknown) => this.logger.error('Falha ao processar campanhas do funil', error)), 60000);
    this.timer.unref();
    void this.reconcile().catch((error: unknown) => this.logger.error('Falha ao iniciar campanhas do funil', error));
  }

  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  private contactHour(date: Date) {
    return Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hourCycle: 'h23' }).format(date));
  }

  private nextContactTime(date: Date) {
    const result = new Date(date);
    result.setUTCMinutes(0, 0, 0);
    if (result < date) result.setUTCHours(result.getUTCHours() + 1);
    for (let hour = 0; hour < 72; hour++, result.setUTCHours(result.getUTCHours() + 1)) {
      const localHour = this.contactHour(result);
      if (localHour >= CONTACT_START && localHour < CONTACT_END) return new Date(result);
    }
    return new Date(date.getTime() + DAY_MS);
  }

  private brazilDay(now: Date) {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
    const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '01';
    const start = new Date(`${part('year')}-${part('month')}-${part('day')}T00:00:00-03:00`);
    return { start, end: new Date(start.getTime() + DAY_MS) };
  }

  async reconcile() {
    const due = await this.prisma.unscoped.stageCampaignEnrollment.findMany({
      where: { status: 'PENDING', dueAt: { lte: new Date() } },
      orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
      take: 100,
      select: { id: true, tenantId: true },
    });
    for (const item of due) {
      try { await this.process(item.tenantId, item.id); }
      catch (error) { this.logger.error(`Falha no acompanhamento ${item.id}`, error); }
    }
  }

  private async process(tenantId: string, id: string) {
    await this.prisma.unscoped.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "StageCampaignEnrollment" WHERE "tenantId" = ${tenantId}::uuid AND id = ${id}::uuid FOR UPDATE`;
      const enrollment = await tx.stageCampaignEnrollment.findFirst({ where: { tenantId, id }, include: { conversation: { include: { patient: true, unit: { select: { name: true } }, assignedTo: { select: { displayName: true } } } }, stage: true, campaign: true } });
      if (!enrollment || enrollment.status !== 'PENDING' || enrollment.dueAt > new Date()) return;
      const now = new Date();
      const cancel = async (reason: string, status = 'CANCELLED') => tx.stageCampaignEnrollment.update({ where: { tenantId_id: { tenantId, id } }, data: { status, reason } });
      const postpone = async (until: Date, reason: string) => tx.stageCampaignEnrollment.update({ where: { tenantId_id: { tenantId, id } }, data: { dueAt: this.nextContactTime(until), reason } });
      const { conversation, patient, stage, campaign } = { conversation: enrollment.conversation, patient: enrollment.conversation.patient, stage: enrollment.stage, campaign: enrollment.campaign };
      if (conversation.pipelineStageId !== stage.id || !stage.active || stage.campaignId !== campaign.id || campaign.status !== 'APPROVED' || campaign.mode !== 'STAGE' || conversation.status === 'CLOSED') { await cancel('A etapa ou campanha deixou de estar ativa.'); return; }
      if (!patient.active || patient.deletedAt || !patient.phone) { await cancel('Paciente sem telefone ativo.', 'SUPPRESSED'); return; }
      await tx.$queryRaw`SELECT id FROM "Patient" WHERE "tenantId" = ${tenantId}::uuid AND id = ${patient.id}::uuid FOR UPDATE`;
      const inbound = await tx.message.findFirst({ where: { tenantId, conversationId: conversation.id, direction: 'INBOUND', createdAt: { gt: enrollment.createdAt } }, select: { id: true } });
      if (inbound) { await cancel('O paciente respondeu após entrar na etapa.'); return; }
      const latestHuman = await tx.message.findFirst({ where: { tenantId, conversationId: conversation.id, direction: 'OUTBOUND', actor: 'HUMAN', createdAt: { gt: enrollment.createdAt } }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } });
      if (latestHuman && latestHuman.createdAt.getTime() + enrollment.inactivityDays * DAY_MS > now.getTime()) { await postpone(new Date(latestHuman.createdAt.getTime() + enrollment.inactivityDays * DAY_MS), 'Prazo reiniciado após mensagem da equipe.'); return; }
      const recent = await tx.message.findFirst({ where: { tenantId, conversation: { patientId: patient.id }, createdAt: { gte: new Date(now.getTime() - 30 * 60000) } }, select: { id: true } });
      if (recent || conversation.status === 'WAITING_HUMAN') { await postpone(new Date(now.getTime() + 60 * 60000), 'Adiada porque há conversa em andamento.'); return; }
      if (this.contactHour(now) < CONTACT_START || this.contactHour(now) >= CONTACT_END) { await postpone(now, 'Adiada para horário de contato.'); return; }
      const { start, end } = this.brazilDay(now);
      const [otherOutbox, humanToday] = await Promise.all([
        tx.outboxMessage.findFirst({ where: { tenantId, patientId: patient.id, status: { in: ['PENDING', 'RETRY', 'PROCESSING', 'SIMULATED', 'SENT'] }, scheduledAt: { gte: start, lt: end } }, select: { id: true } }),
        tx.message.findFirst({ where: { tenantId, conversation: { patientId: patient.id }, direction: 'OUTBOUND', actor: 'HUMAN', createdAt: { gte: start, lt: end } }, select: { id: true } }),
      ]);
      if (otherOutbox || humanToday) { await postpone(end, 'Adiada para evitar duas mensagens no mesmo dia.'); return; }
      const consent = await tx.consentPreference.findUnique({ where: { tenantId_patientId_channel_purpose: { tenantId, patientId: patient.id, channel: 'WHATSAPP', purpose: 'MARKETING' } }, select: { status: true } });
      if (consent?.status !== 'GRANTED') { await cancel('Consentimento de marketing no WhatsApp não concedido.', 'SUPPRESSED'); return; }
      const provider = campaign.provider;
      const connection = patient.unitId ? provider === 'EVOLUTION_BAILEYS'
        ? await tx.evolutionConnection.findFirst({ where: { tenantId, unitId: patient.unitId, mode: 'EVOLUTION_BAILEYS', enabled: true, status: 'CONNECTED' }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }], select: { id: true } })
        : await tx.metaConnection.findFirst({ where: { tenantId, unitId: patient.unitId, enabled: true, status: 'CONNECTED' }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }], select: { id: true } }) : null;
      if (!connection) { await postpone(new Date(now.getTime() + DAY_MS), 'Aguardando canal de WhatsApp conectado para a unidade do paciente.'); return; }
      const subscription = await tx.subscription.findUnique({ where: { tenantId }, include: { plan: true } });
      if (!subscription || !subscription.plan.enabled || !['TRIAL', 'ACTIVE'].includes(subscription.status) || subscription.cycleStartsAt > now || subscription.cycleEndsAt <= now) { await postpone(new Date(now.getTime() + DAY_MS), 'Aguardando plano ativo.'); return; }
      const [appointment, tenant] = await Promise.all([
        tx.appointment.findFirst({ where: { tenantId, patientId: patient.id, unitId: conversation.unitId, startsAt: { gte: now }, status: { in: ['PENDING', 'CONFIRMED'] } }, orderBy: [{ startsAt: 'asc' }, { id: 'asc' }], select: { startsAt: true, procedure: { select: { name: true } } } }),
        tx.tenant.findUnique({ where: { id: tenantId }, select: { name: true } }),
      ]);
      const rendered = renderCampaignTemplate(enrollment.body, { 'paciente.nome': patient.fullName, 'paciente.primeiroNome': patient.fullName.trim().split(/\s+/u)[0], 'clinica.nome': tenant?.name, 'unidade.nome': conversation.unit.name, 'atendente.nome': conversation.assignedTo?.displayName, ...appointmentTemplateValues(appointment?.startsAt, appointment?.procedure?.name) });
      if (rendered.missing.length) { await cancel(`Variáveis sem dados: ${rendered.missing.join(', ')}.`, 'SUPPRESSED'); return; }
      const body = rendered.body;
      if (hasSuspectMessageEncoding(body)) { await cancel('Texto da campanha ou nome do paciente com caracteres corrompidos.', 'SUPPRESSED'); return; }
      const outboxId = randomUUID();
      await this.usage.consumeWithinTransaction(tx, 'messages', `outbox:${outboxId}:messages`, 1, subscription);
      await tx.outboxMessage.create({ data: { id: outboxId, tenantId, patientId: patient.id, campaignId: campaign.id, purpose: 'MARKETING', channel: 'WHATSAPP', provider, connectionId: connection.id, body, idempotencyKey: `stage-campaign:${id}`, scheduledAt: now } });
      await tx.stageCampaignEnrollment.update({ where: { tenantId_id: { tenantId, id } }, data: { status: 'OUTBOXED', outboxMessageId: outboxId, reason: 'Mensagem registrada na fila lógica; envio externo permanece desligado.' } });
      await tx.auditEvent.create({ data: { tenantId, actorUserId: null, action: 'STAGE_CAMPAIGN_QUEUED', entityType: 'Conversation', entityId: conversation.id, metadata: { stageId: stage.id, campaignId: campaign.id, enrollmentId: id, outboxMessageId: outboxId } } });
    });
  }
}
