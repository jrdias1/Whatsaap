import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { ForbiddenException, Injectable, Logger, OnModuleDestroy, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { OutboxAttemptOutcome, OutboxStatus, Prisma } from '@prisma/client';
import { DelayedError, Job, Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContext } from '../security/tenant-context.js';
import { RedisCoordinatorService } from '../queue/redis-coordinator.service.js';
import { MessagingProviderRegistry } from '../messaging/messaging-provider.js';
import { resolvePlanLimits } from '../usage/plan-limits.js';
import { hasSuspectMessageEncoding } from '../common/message-text-integrity.js';

type DispatchJob = { outboxMessageId: string };
const MAX_ATTEMPTS = 8;
const DISPATCHABLE: OutboxStatus[] = ['PENDING', 'RETRY'];

@Injectable()
export class OutboxDispatchService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxDispatchService.name);
  private readonly providerRegistry = new MessagingProviderRegistry();
  private timer?: NodeJS.Timeout;
  constructor(
    private readonly prisma: PrismaService,
    private readonly context: TenantContext,
    @InjectQueue('outbox-dispatch') private readonly queue: Queue<DispatchJob>,
  ) {}

  private scope() {
    const scope = this.context.current();
    if (!scope) throw new ForbiddenException('Tenant obrigatório.');
    return scope;
  }

  private assertDryRun() {
    if (process.env.NODE_ENV === 'production' || process.env.OUTBOX_DISPATCH_MODE !== 'dry-run') {
      throw new ServiceUnavailableException('Dispatcher indisponível: OUTBOX_DISPATCH_MODE=dry-run é obrigatório e não pode operar em produção.');
    }
  }

  async dispatchPending(limit = 250, unitId?: string) {
    this.assertDryRun();
    const scope = this.scope();
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new ForbiddenException('Limite deve ficar entre 1 e 1000.');
    const rows = await this.prisma.scoped.outboxMessage.findMany({
      where: { tenantId: scope.tenantId, status: { in: DISPATCHABLE }, enqueuedAt: null, scheduledAt: { lte: new Date() }, nextAttemptAt: { lte: new Date() }, ...(unitId ? { patient: { unitId } } : {}) },
      orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }], take: limit, select: { id: true },
    });
    const queued: string[] = [];
    for (const row of rows) {
      const jobId = `outbox-${row.id}`;
      const marked = await this.prisma.scoped.outboxMessage.updateMany({ where: { tenantId: scope.tenantId, id: row.id, status: { in: DISPATCHABLE }, enqueuedAt: null }, data: { enqueuedAt: new Date() } });
      if (!marked.count) continue;
      try { await this.queue.add('dispatch-dry-run', { outboxMessageId: row.id }, { jobId, priority: 10, attempts: 1, removeOnComplete: true, removeOnFail: false }); }
      catch (error) { await this.prisma.scoped.outboxMessage.updateMany({ where: { tenantId: scope.tenantId, id: row.id, status: { in: DISPATCHABLE } }, data: { enqueuedAt: null } }); throw error; }
      queued.push(row.id);
    }
    return { mode: 'dry-run', queued: queued.length, outboxIds: queued, sendsEnabled: false };
  }

  async summary() {
    const scope = this.scope();
    const [groups, oldestPending, oldestUnknown] = await Promise.all([
      this.prisma.scoped.outboxMessage.groupBy({ by: ['status'], where: { tenantId: scope.tenantId }, _count: { _all: true } }),
      this.prisma.scoped.outboxMessage.findFirst({ where: { tenantId: scope.tenantId, status: { in: DISPATCHABLE } }, orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }], select: { scheduledAt: true } }),
      this.prisma.scoped.outboxMessage.findFirst({ where: { tenantId: scope.tenantId, status: 'UNKNOWN' }, orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }], select: { updatedAt: true } }),
    ]);
    return { mode: process.env.OUTBOX_DISPATCH_MODE === 'dry-run' ? 'dry-run' : 'disabled', counts: Object.fromEntries(groups.map((group) => [group.status, group._count._all])), oldestPendingAt: oldestPending?.scheduledAt ?? null, oldestUnknownAt: oldestUnknown?.updatedAt ?? null, sendsEnabled: false };
  }

  async reconcileUnknown() {
    this.assertDryRun();
    const scope = this.scope();
    const rows = await this.prisma.scoped.outboxMessage.findMany({ where: { tenantId: scope.tenantId, status: 'UNKNOWN' }, orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }], take: 250, select: { id: true } });
    let reconciled = 0;
    for (const row of rows) if (await this.finalizeKnownReceipt(scope.tenantId, row.id)) reconciled++;
    return { mode: 'dry-run', reconciled, sendsEnabled: false };
  }

  onModuleInit() {
    if (process.env.NODE_ENV !== 'production' && process.env.OUTBOX_DISPATCH_MODE === 'dry-run') {
      this.timer = setInterval(() => void this.reconcileQueue().catch((error: unknown) => this.logger.error('Falha ao recuperar a fila durável do outbox.', error)), 5000);
      this.timer.unref();
    }
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  async reconcileQueue() {
    this.assertDryRun();
    const now = new Date();
    // PROCESSING rows are reconciled against the simulator receipt before any retry.
    const expired = await this.prisma.unscoped.outboxMessage.findMany({ where: { status: 'PROCESSING', leaseExpiresAt: { lte: now } }, orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }], take: 250, select: { id: true, tenantId: true, idempotencyKey: true, attempts: true } });
    for (const row of expired) {
      const receipt = await this.prisma.unscoped.dryRunProviderReceipt.findUnique({ where: { tenantId_idempotencyKey: { tenantId: row.tenantId, idempotencyKey: row.idempotencyKey } } });
      if (receipt) await this.finalizeKnownReceipt(row.tenantId, row.id);
      else await this.prisma.unscoped.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "OutboxMessage" WHERE "tenantId" = ${row.tenantId}::uuid AND id = ${row.id}::uuid FOR UPDATE`;
        const current = await tx.outboxMessage.findFirst({ where: { tenantId: row.tenantId, id: row.id, status: 'PROCESSING', leaseExpiresAt: { lte: now } } });
        if (!current) return;
        const exhausted = current.attempts >= MAX_ATTEMPTS;
        const detail = 'Worker interrupted before simulated acceptance; recovery is safe and has no external side effect.';
        await tx.outboxMessage.update({ where: { tenantId_id: { tenantId: row.tenantId, id: row.id } }, data: { status: exhausted ? 'FAILED' : 'RETRY', leaseExpiresAt: null, enqueuedAt: null, nextAttemptAt: now, lastError: detail } });
        await tx.outboxAttempt.upsert({
          where: { tenantId_outboxMessageId_attemptNumber: { tenantId: row.tenantId, outboxMessageId: row.id, attemptNumber: Math.max(1, current.attempts) } },
          create: { tenantId: row.tenantId, outboxMessageId: row.id, attemptNumber: Math.max(1, current.attempts), outcome: exhausted ? 'PERMANENT_FAILURE' : 'RETRYABLE_FAILURE', cause: 'WORKER_LEASE_EXPIRED', detail, nextAction: exhausted ? 'DEAD_LETTER_ADMIN_REVIEW' : 'RETRY_AFTER_RECOVERY' },
          update: {},
        });
      });
    }

    const candidates = await this.prisma.unscoped.outboxMessage.findMany({ where: { status: { in: DISPATCHABLE }, scheduledAt: { lte: now }, nextAttemptAt: { lte: now }, OR: [{ enqueuedAt: null }, { enqueuedAt: { lt: new Date(now.getTime() - 30_000) } }] }, orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }], take: 250, select: { id: true, tenantId: true, enqueuedAt: true } });
    for (const row of candidates) {
      const jobId = `outbox-${row.id}`;
      const job = await this.queue.getJob(jobId);
      if (job) {
        const state = await job.getState();
        if (['waiting', 'active', 'delayed', 'waiting-children', 'prioritized'].includes(state)) continue;
        await job.remove().catch(() => undefined);
      }
      const marked = await this.prisma.unscoped.outboxMessage.updateMany({ where: { tenantId: row.tenantId, id: row.id, status: { in: DISPATCHABLE }, OR: [{ enqueuedAt: null }, { enqueuedAt: { lt: new Date(Date.now() - 30_000) } }] }, data: { enqueuedAt: new Date() } });
      if (!marked.count) continue;
      try { await this.queue.add('dispatch-dry-run', { outboxMessageId: row.id }, { jobId, priority: 10, attempts: 1, removeOnComplete: true, removeOnFail: false }); }
      catch (error) { await this.prisma.unscoped.outboxMessage.updateMany({ where: { tenantId: row.tenantId, id: row.id, status: { in: DISPATCHABLE } }, data: { enqueuedAt: null } }); throw error; }
    }
  }

  async process(job: Job<DispatchJob>, token?: string, redis?: RedisCoordinatorService) {
    this.assertDryRun();
    const candidate = await this.prisma.unscoped.outboxMessage.findUnique({ where: { id: job.data.outboxMessageId }, include: { patient: { select: { unitId: true } } } });
    if (!candidate || !DISPATCHABLE.includes(candidate.status)) return;
    const connection = candidate.patient.unitId ? candidate.provider === 'META_CLOUD'
      ? await this.prisma.unscoped.metaConnection.findFirst({ where: { tenantId: candidate.tenantId, unitId: candidate.patient.unitId, enabled: true, status: 'CONNECTED', ...(candidate.connectionId ? { id: candidate.connectionId } : {}) }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }], select: { id: true } })
      : candidate.provider === 'EVOLUTION_BAILEYS'
        ? await this.prisma.unscoped.evolutionConnection.findFirst({ where: { tenantId: candidate.tenantId, unitId: candidate.patient.unitId, mode: 'EVOLUTION_BAILEYS', enabled: true, status: 'CONNECTED', ...(candidate.connectionId ? { id: candidate.connectionId } : {}) }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }], select: { id: true } })
        : null : null;
    if (!connection) return this.finishWithoutDelivery(candidate.tenantId, candidate.id, candidate.status, candidate.attempts, candidate.patient.unitId ? 'NO_CONNECTED_META_CONNECTION' : 'PATIENT_WITHOUT_UNIT', 'Conexão Meta Cloud homologada não disponível para unidade.', 'CHECK_CONNECTION', 'FAILED');

    const leaseToken = randomUUID();
    const tenantSlot = await redis!.acquireTenantSlot(candidate.tenantId, leaseToken);
    if (!tenantSlot) { await job.moveToDelayed(Date.now() + 500, token); throw new DelayedError(); }
    try {
      const rateAllowed = await redis!.takeConnectionRateSlot(connection.id);
      if (!rateAllowed) { await job.moveToDelayed(Date.now() + 1500, token); throw new DelayedError(); }
      const claimed = await this.claim(candidate.tenantId, candidate.id);
      if (!claimed) return;
      const simulatedDelay = Number(process.env.OUTBOX_DRY_RUN_PROCESSING_DELAY_MS ?? 0);
      if (Number.isFinite(simulatedDelay) && simulatedDelay > 0) await new Promise((resolve) => setTimeout(resolve, Math.min(120_000, simulatedDelay)));
      await this.processClaimed(candidate.tenantId, candidate.id, connection.id, candidate.provider);
    } catch (error) {
      if (!(error instanceof DelayedError)) await this.recordDispatchError(candidate.tenantId, candidate.id, error);
      throw error;
    } finally { await redis!.releaseTenantSlot(candidate.tenantId, tenantSlot, leaseToken); }
  }

  private async claim(tenantId: string, id: string) {
    return this.prisma.unscoped.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "OutboxMessage" WHERE "tenantId" = ${tenantId}::uuid AND id = ${id}::uuid FOR UPDATE`;
      const row = await tx.outboxMessage.findFirst({ where: { tenantId, id } });
      if (!row || !DISPATCHABLE.includes(row.status) || row.scheduledAt > new Date() || row.nextAttemptAt > new Date()) return false;
      const leaseMs = Math.max(1000, Math.min(300_000, Number(process.env.OUTBOX_DISPATCH_LEASE_MS ?? 60_000)));
      await tx.outboxMessage.update({ where: { tenantId_id: { tenantId, id } }, data: { status: 'PROCESSING', attempts: { increment: 1 }, leaseExpiresAt: new Date(Date.now() + leaseMs) } });
      return true;
    });
  }

  private async processClaimed(tenantId: string, id: string, connectionId: string, provider: string) {
    const processingStarted = Date.now();
    await this.prisma.unscoped.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "OutboxMessage" WHERE "tenantId" = ${tenantId}::uuid AND id = ${id}::uuid FOR UPDATE`;
      const outbox = await tx.outboxMessage.findFirst({ where: { tenantId, id }, include: { patient: true, campaign: true } });
      if (!outbox || outbox.status !== 'PROCESSING') return;
      const stageEnrollment = outbox.idempotencyKey.startsWith('stage-campaign:') ? await tx.stageCampaignEnrollment.findFirst({ where: { tenantId, outboxMessageId: id }, include: { conversation: true, stage: true } }) : null;
      const attemptNumber = Math.max(1, outbox.attempts);
      const patient = await tx.patient.findFirst({ where: { tenantId, id: outbox.patientId }, select: { id: true, active: true, deletedAt: true, unitId: true } });
      const connection = patient?.unitId ? provider === 'META_CLOUD'
        ? await tx.metaConnection.findFirst({ where: { tenantId, unitId: patient.unitId, id: connectionId, enabled: true, status: 'CONNECTED' }, select: { id: true } })
        : provider === 'EVOLUTION_BAILEYS'
          ? await tx.evolutionConnection.findFirst({ where: { tenantId, unitId: patient.unitId, id: connectionId, mode: 'EVOLUTION_BAILEYS', enabled: true, status: 'CONNECTED' }, select: { id: true } })
          : null : null;
      let blocker: { cause: string; detail: string; outcome: OutboxAttemptOutcome; status: OutboxStatus; nextAction: string } | undefined;
      if (!patient || !patient.active || patient.deletedAt) blocker = { cause: 'PATIENT_ARCHIVED_OR_INACTIVE', detail: 'Paciente arquivado ou inativo.', outcome: 'SUPPRESSED', status: 'SUPPRESSED', nextAction: 'NONE' };
      else if (!connection || patient.unitId === null) blocker = { cause: 'UNIT_OR_CONNECTION_CHANGED', detail: 'Unidade ou conexão Meta não está disponível.', outcome: 'PERMANENT_FAILURE', status: 'FAILED', nextAction: 'ADMIN_REVIEW' };
      else if (!this.providerRegistry.get(outbox.provider) || outbox.channel !== 'WHATSAPP' || (outbox.provider === 'EVOLUTION_BAILEYS' && outbox.purpose === 'MARKETING' && !(outbox.campaign?.mode === 'STAGE' && stageEnrollment))) blocker = { cause: 'UNSUPPORTED_CHANNEL_PURPOSE', detail: 'Provider sem suporte ou Baileys não permitido para campanhas em lista.', outcome: 'PERMANENT_FAILURE', status: 'FAILED', nextAction: 'USE_META_CLOUD_FOR_MARKETING' };
      else if (outbox.campaign?.mode === 'STAGE' && !stageEnrollment) blocker = { cause: 'STAGE_ENROLLMENT_MISSING', detail: 'Vínculo confirmado com a etapa não encontrado.', outcome: 'SUPPRESSED', status: 'SUPPRESSED', nextAction: 'NONE' };
      else if (hasSuspectMessageEncoding(outbox.body)) blocker = { cause: 'MESSAGE_TEXT_CORRUPTED', detail: 'Texto com indícios de codificação corrompida. Revise a mensagem na origem.', outcome: 'SUPPRESSED', status: 'SUPPRESSED', nextAction: 'ADMIN_REVIEW' };
      else if ((outbox.provider === 'META_CLOUD' && outbox.purpose === 'MARKETING' && (!outbox.campaign || outbox.campaign.status !== 'APPROVED')) || (outbox.provider === 'EVOLUTION_BAILEYS' && (outbox.purpose === 'MARKETING' && !(outbox.campaign?.mode === 'STAGE' && stageEnrollment) || outbox.campaign !== null && outbox.campaign.mode !== 'STAGE')) || (outbox.campaign && (outbox.campaign.status !== 'APPROVED' || outbox.provider !== outbox.campaign.provider)) || !outbox.body.trim() || outbox.body.length > 4000 || outbox.scheduledAt > new Date()) blocker = { cause: 'CAMPAIGN_OR_MESSAGE_NOT_READY', detail: 'Campanha ou mensagem não aprovada, finalidade incompatível, sem conteúdo ou ainda agendada.', outcome: 'PERMANENT_FAILURE', status: 'FAILED', nextAction: 'ADMIN_REVIEW' };
      else {
        await tx.$queryRaw`SELECT id FROM "Patient" WHERE "tenantId" = ${tenantId}::uuid AND id = ${outbox.patientId}::uuid FOR UPDATE`;
        if (stageEnrollment) {
          const replied = await tx.message.findFirst({ where: { tenantId, conversationId: stageEnrollment.conversationId, direction: 'INBOUND', createdAt: { gt: stageEnrollment.createdAt } }, select: { id: true } });
          if (stageEnrollment.status !== 'OUTBOXED' || stageEnrollment.conversation.status === 'CLOSED' || stageEnrollment.conversation.pipelineStageId !== stageEnrollment.stageId || !stageEnrollment.stage.active || stageEnrollment.stage.campaignId !== outbox.campaignId || replied) blocker = { cause: 'STAGE_CAMPAIGN_CANCELLED', detail: replied ? 'O paciente respondeu antes do processamento.' : 'A conversa foi encerrada, saiu da etapa ou teve a campanha alterada.', outcome: 'SUPPRESSED', status: 'SUPPRESSED', nextAction: 'NONE' };
          if (!blocker) {
            const pauseUntil = await this.stageCampaignContactPause(tx, tenantId, outbox.patientId, stageEnrollment.conversationId, id, new Date());
            if (pauseUntil) {
              await tx.outboxMessage.update({ where: { tenantId_id: { tenantId, id } }, data: { status: 'PENDING', scheduledAt: pauseUntil.until, nextAttemptAt: pauseUntil.until, enqueuedAt: null, leaseExpiresAt: null, lastError: pauseUntil.reason } });
              return;
            }
          }
        }
        if (outbox.idempotencyKey.startsWith('automation:')) {
          const pauseUntil = await this.automationContactPause(tx, tenantId, outbox.patientId, outbox.idempotencyKey, new Date());
          if (pauseUntil) {
            await tx.outboxMessage.update({ where: { tenantId_id: { tenantId, id } }, data: { status: 'PENDING', scheduledAt: pauseUntil.until, nextAttemptAt: pauseUntil.until, enqueuedAt: null, leaseExpiresAt: null, lastError: pauseUntil.reason } });
            return;
          }
        }
        const preference = await tx.consentPreference.findUnique({ where: { tenantId_patientId_channel_purpose: { tenantId, patientId: outbox.patientId, channel: 'WHATSAPP', purpose: outbox.purpose } }, select: { status: true } });
        if (preference?.status !== 'GRANTED') blocker = { cause: preference?.status === 'REVOKED' ? 'CONSENT_REVOKED' : 'CONSENT_NOT_GRANTED', detail: 'Consentimento de marketing precisa estar concedido no instante da simulação.', outcome: 'SUPPRESSED', status: 'SUPPRESSED', nextAction: 'NONE' };
        await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id = ${tenantId}::uuid FOR SHARE`;
        const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: { status: true } });
        if (!tenant || tenant.status === 'SUSPENDED') blocker = { cause: 'TENANT_SUSPENDED', detail: 'Empresa suspensa; despacho bloqueado.', outcome: 'SUPPRESSED', status: 'SUPPRESSED', nextAction: 'NONE' };
        const subscription = await tx.subscription.findUnique({ where: { tenantId }, include: { plan: true } });
        if (!blocker && (!subscription || !subscription.plan.enabled || !['TRIAL', 'ACTIVE'].includes(subscription.status) || subscription.cycleStartsAt > new Date() || subscription.cycleEndsAt <= new Date())) blocker = { cause: 'SUBSCRIPTION_INACTIVE', detail: 'Plano/ciclo não está ativo.', outcome: 'PERMANENT_FAILURE', status: 'FAILED', nextAction: 'ADMIN_REVIEW' };
        if (!blocker) {
          const reservationKey = outbox.campaignId && outbox.campaign?.mode !== 'STAGE' ? `campaign:${outbox.campaignId}:messages` : `outbox:${outbox.id}:messages`;
          const reservation = await tx.usageEntry.findUnique({ where: { tenantId_metric_idempotencyKey: { tenantId, metric: 'messages', idempotencyKey: reservationKey } } });
          const requiredQuantity = outbox.campaignId && outbox.campaign?.mode !== 'STAGE' ? await tx.outboxMessage.count({ where: { tenantId, campaignId: outbox.campaignId } }) : 1;
          const usage = await tx.usageEntry.aggregate({ where: { tenantId, metric: 'messages', cycleStartsAt: subscription!.cycleStartsAt, cycleEndsAt: subscription!.cycleEndsAt }, _sum: { quantity: true } });
          const messageLimit = resolvePlanLimits(subscription!.plan, subscription!.limitOverrides).messageLimitPerCycle;
          if (!reservation || reservation.quantity < requiredQuantity || reservation.cycleStartsAt.getTime() !== subscription!.cycleStartsAt.getTime() || reservation.cycleEndsAt.getTime() !== subscription!.cycleEndsAt.getTime() || reservation.quantity > messageLimit || (usage._sum.quantity ?? 0) > messageLimit) blocker = { cause: 'QUOTA_RESERVATION_MISSING_OR_EXPIRED', detail: 'Reserva original da cota ausente, expirada ou acima do limite administrativo atual.', outcome: 'PERMANENT_FAILURE', status: 'FAILED', nextAction: 'ADMIN_REVIEW' };
        }
      }
      if (blocker) {
        await tx.outboxMessage.update({ where: { tenantId_id: { tenantId, id } }, data: { status: blocker.status, suppressionReason: blocker.status === 'SUPPRESSED' ? blocker.cause : null, lastError: blocker.detail, leaseExpiresAt: null } });
        if (stageEnrollment) await tx.stageCampaignEnrollment.update({ where: { tenantId_id: { tenantId, id: stageEnrollment.id } }, data: { status: blocker.status, reason: blocker.detail } });
        if (outbox.purpose === 'SATISFACTION_SURVEY') {
          const survey = await tx.satisfactionSurvey.findFirst({ where: { tenantId, outboxMessageId: id, state: 'OUTBOXED' }, select: { id: true } });
          if (survey) {
            const state = blocker.status === 'SUPPRESSED' ? 'SUPPRESSED' : 'FAILED';
            await tx.satisfactionSurvey.update({ where: { tenantId_id: { tenantId, id: survey.id } }, data: { state } });
            await tx.satisfactionSurveyEvent.create({ data: { tenantId, surveyId: survey.id, event: state, metadata: { reason: blocker.cause, outboxMessageId: id } } });
          }
        }
        await tx.outboxAttempt.create({ data: { tenantId, outboxMessageId: id, attemptNumber, outcome: blocker.outcome, cause: blocker.cause, detail: blocker.detail, nextAction: blocker.nextAction } });
        return;
      }
      const faultKey = process.env.OUTBOX_DRY_RUN_ACCEPT_TIMEOUT_KEY;
      const acceptedWithLostResponse = Boolean(faultKey && faultKey === outbox.idempotencyKey);
      const adapter = this.providerRegistry.get(outbox.provider)!;
      const simulated = adapter.simulateSend({ connectionId, destination: '', body: outbox.body, idempotencyKey: outbox.idempotencyKey, purpose: outbox.purpose });
      const receipt = await tx.dryRunProviderReceipt.upsert({ where: { tenantId_idempotencyKey: { tenantId, idempotencyKey: outbox.idempotencyKey } }, create: { tenantId, idempotencyKey: outbox.idempotencyKey, outboxMessageId: id, providerReference: simulated.reference }, update: {} });
      if (acceptedWithLostResponse) {
        await tx.outboxMessage.update({ where: { tenantId_id: { tenantId, id } }, data: { status: 'UNKNOWN', lastError: 'Simulador aceitou a chave idempotente, mas a resposta local foi perdida.', leaseExpiresAt: null } });
        await tx.outboxAttempt.create({ data: { tenantId, outboxMessageId: id, attemptNumber, outcome: 'UNKNOWN', cause: 'SIMULATED_ACCEPT_THEN_TIMEOUT', detail: 'Aceite simulado persistido; resultado local indeterminado.', nextAction: 'LOOKUP_SIMULATED_RECEIPT', providerReference: receipt.providerReference, queueLatencyMs: outbox.enqueuedAt ? Math.max(0, processingStarted - outbox.enqueuedAt.getTime()) : null, processingMs: Date.now() - processingStarted } });
        return;
      }
      await this.writeDryRunMessage(tx, tenantId, id, outbox.patientId, patient!.unitId!, outbox.body, outbox.provider, receipt.providerReference);
      await tx.outboxMessage.update({ where: { tenantId_id: { tenantId, id } }, data: { status: 'SIMULATED', sentAt: new Date(), lastError: null, suppressionReason: null, leaseExpiresAt: null } });
      if (stageEnrollment) await tx.stageCampaignEnrollment.update({ where: { tenantId_id: { tenantId, id: stageEnrollment.id } }, data: { status: 'SIMULATED', reason: 'Mensagem simulada localmente; nenhum WhatsApp foi enviado.' } });
      if (outbox.purpose === 'SATISFACTION_SURVEY') {
        const survey = await tx.satisfactionSurvey.findFirst({ where: { tenantId, outboxMessageId: id, state: 'OUTBOXED' }, select: { id: true } });
        if (survey) await tx.satisfactionSurveyEvent.create({ data: { tenantId, surveyId: survey.id, event: 'SIMULATED', metadata: { outboxMessageId: id, externalRequestMade: false } } });
      }
      await tx.outboxAttempt.create({ data: { tenantId, outboxMessageId: id, attemptNumber, outcome: 'ACCEPTED', cause: 'DRY_RUN_SIMULATED_ACCEPTANCE', detail: 'Efeito persistido somente no banco de teste local; nenhum provedor foi chamado.', nextAction: 'NONE', providerReference: receipt.providerReference, queueLatencyMs: outbox.enqueuedAt ? Math.max(0, processingStarted - outbox.enqueuedAt.getTime()) : null, processingMs: Date.now() - processingStarted } });
    });
  }

  private async finishWithoutDelivery(tenantId: string, id: string, expectedStatus: OutboxStatus, previousAttempts: number, cause: string, detail: string, nextAction: string, status: OutboxStatus) {
    await this.prisma.unscoped.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "OutboxMessage" WHERE "tenantId" = ${tenantId}::uuid AND id = ${id}::uuid FOR UPDATE`;
      const row = await tx.outboxMessage.findFirst({ where: { tenantId, id } });
      if (!row || row.status !== expectedStatus) return;
      const attemptNumber = Math.max(row.attempts, previousAttempts) + 1;
      await tx.outboxMessage.update({ where: { tenantId_id: { tenantId, id } }, data: { attempts: attemptNumber, status, lastError: detail, enqueuedAt: null } });
      await tx.outboxAttempt.create({ data: { tenantId, outboxMessageId: id, attemptNumber, outcome: status === 'SUPPRESSED' ? 'SUPPRESSED' : 'PERMANENT_FAILURE', cause, detail, nextAction } });
    });
  }

  private async stageCampaignContactPause(tx: Prisma.TransactionClient, tenantId: string, patientId: string, conversationId: string, currentOutboxId: string, now: Date) {
    const localHour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hourCycle: 'h23' }).format(now));
    if (localHour < 9 || localHour >= 18) return { until: this.allowedContactTimeAfter(new Date(now.getTime() + 60_000), 9, 18) ?? new Date(now.getTime() + 86400000), reason: 'Campanha do funil adiada para horário de contato.' };
    const conversation = await tx.conversation.findFirst({ where: { tenantId, id: conversationId }, select: { status: true } });
    const recentMessage = await tx.message.findFirst({ where: { tenantId, conversation: { patientId }, createdAt: { gte: new Date(now.getTime() - 30 * 60000) } }, select: { id: true } });
    if (conversation?.status === 'WAITING_HUMAN' || recentMessage) return { until: this.allowedContactTimeAfter(new Date(now.getTime() + 60 * 60000), 9, 18) ?? new Date(now.getTime() + 86400000), reason: 'Campanha do funil adiada porque há conversa recente.' };
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
    const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '01';
    const start = new Date(`${part('year')}-${part('month')}-${part('day')}T00:00:00-03:00`);
    const end = new Date(start.getTime() + 86400000);
    const [outboxToday, humanToday] = await Promise.all([
      tx.outboxMessage.findFirst({ where: { tenantId, patientId, id: { not: currentOutboxId }, status: { in: ['PENDING', 'RETRY', 'PROCESSING', 'SIMULATED', 'SENT'] }, scheduledAt: { gte: start, lt: end } }, select: { id: true } }),
      tx.message.findFirst({ where: { tenantId, conversation: { patientId }, direction: 'OUTBOUND', actor: 'HUMAN', createdAt: { gte: start, lt: end } }, select: { id: true } }),
    ]);
    if (outboxToday || humanToday) return { until: this.allowedContactTimeAfter(end, 9, 18) ?? new Date(end.getTime() + 86400000), reason: 'Campanha do funil adiada para evitar duas mensagens no mesmo dia.' };
    return null;
  }

  private async automationContactPause(tx: Prisma.TransactionClient, tenantId: string, patientId: string, idempotencyKey: string, now: Date) {
    const linkedExecutionId = idempotencyKey.split(':')[1];
    const execution = linkedExecutionId ? await tx.automationExecution.findFirst({ where: { tenantId, id: linkedExecutionId }, include: { automation: { select: { configuration: true } } } }) : null;
    const config = execution?.automation.configuration as { allowedStartHour?: number; allowedEndHour?: number } | undefined;
    const startHour = Number.isInteger(config?.allowedStartHour) ? config!.allowedStartHour! : 8;
    const endHour = Number.isInteger(config?.allowedEndHour) ? config!.allowedEndHour! : 20;
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
    const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '01';
    const start = new Date(`${part('year')}-${part('month')}-${part('day')}T00:00:00-03:00`);
    const end = new Date(start.getTime() + 24 * 60 * 60_000);
    const conversation = await tx.conversation.findFirst({ where: { tenantId, patientId, OR: [{ status: { in: ['OPEN', 'WAITING_HUMAN'] } }, { lastMessageAt: { gte: new Date(now.getTime() - 30 * 60_000) } }] }, orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }], select: { lastMessageAt: true } });
    if (conversation) {
      const candidate = new Date(Math.max(now.getTime() + 30 * 60_000, conversation.lastMessageAt.getTime() + 30 * 60_000));
      const until = this.allowedContactTimeAfter(candidate, startHour, endHour);
      if (until) return { until, reason: 'Envio automático pausado enquanto há conversa ativa ou atividade recente.' };
    }
    const [contactedToday, humanMessageToday] = await Promise.all([
      tx.outboxMessage.findFirst({ where: { tenantId, patientId, status: { in: ['SIMULATED', 'SENT'] }, sentAt: { gte: start, lt: end } }, select: { id: true } }),
      tx.message.findFirst({ where: { tenantId, direction: 'OUTBOUND', status: { in: ['QUEUED', 'SIMULATED', 'SENT', 'DELIVERED', 'READ'] }, createdAt: { gte: start, lt: end }, conversation: { tenantId, patientId } }, select: { id: true } }),
    ]);
    if (contactedToday || humanMessageToday) {
      const until = this.allowedContactTimeAfter(new Date(end.getTime() + 9 * 60 * 60_000), startHour, endHour);
      if (until) return { until, reason: 'Envio automático adiado para evitar duas mensagens no mesmo dia.' };
    }
    return null;
  }

  private allowedContactTimeAfter(candidate: Date, startHour: number, endHour: number) {
    for (let minute = 0; minute <= 8 * 24 * 60; minute++, candidate.setTime(candidate.getTime() + 60_000)) {
      const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hourCycle: 'h23' }).format(candidate));
      if (hour >= startHour && hour < endHour) return new Date(candidate);
    }
    return null;
  }

  private async recordDispatchError(tenantId: string, id: string, error: unknown) {
    await this.prisma.unscoped.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "OutboxMessage" WHERE "tenantId" = ${tenantId}::uuid AND id = ${id}::uuid FOR UPDATE`;
      const row = await tx.outboxMessage.findFirst({ where: { tenantId, id, status: { in: ['PENDING', 'RETRY', 'PROCESSING'] } } });
      if (!row) return;
      const attempts = Math.max(1, row.attempts + (row.status === 'PROCESSING' ? 0 : 1));
      const exhausted = attempts >= MAX_ATTEMPTS;
      const detail = error instanceof Error ? error.message.slice(0, 500) : 'Falha transitória desconhecida.';
      const delaySeconds = Math.min(300, 2 ** Math.max(0, attempts - 1));
      await tx.outboxMessage.update({ where: { tenantId_id: { tenantId, id } }, data: { attempts, status: exhausted ? 'FAILED' : 'RETRY', enqueuedAt: null, leaseExpiresAt: null, nextAttemptAt: exhausted ? row.nextAttemptAt : new Date(Date.now() + delaySeconds * 1000), lastError: detail } });
      await tx.outboxAttempt.upsert({
        where: { tenantId_outboxMessageId_attemptNumber: { tenantId, outboxMessageId: id, attemptNumber: attempts } },
        create: { tenantId, outboxMessageId: id, attemptNumber: attempts, outcome: exhausted ? 'PERMANENT_FAILURE' : 'RETRYABLE_FAILURE', cause: 'DISPATCH_PROCESSING_ERROR', detail, nextAction: exhausted ? 'DEAD_LETTER_ADMIN_REVIEW' : `RETRY_AFTER_${delaySeconds}_SECONDS` },
        update: {},
      });
    });
  }

  private async writeDryRunMessage(tx: Prisma.TransactionClient, tenantId: string, outboxId: string, patientId: string, unitId: string, body: string, provider: string, providerReference: string) {
    const conversation = await tx.conversation.findFirst({ where: { tenantId, unitId, patientId, status: { not: 'CLOSED' } }, orderBy: [{ lastMessageAt: 'desc' }, { id: 'asc' }] });
    const now = new Date();
    let conversationId = conversation?.id;
    if (!conversationId) {
      const stage = await tx.conversationStage.findFirst({ where: { tenantId, active: true }, orderBy: [{ position: 'asc' }, { id: 'asc' }] });
      const created = await tx.conversation.create({ data: { tenantId, unitId, patientId, status: 'OPEN', pipelineStageId: stage?.id, lastMessageAt: now } });
      conversationId = created.id;
    }
    await tx.message.upsert({ where: { tenantId_idempotencyKey: { tenantId, idempotencyKey: `outbox:${outboxId}` } }, create: { tenantId, conversationId, direction: 'OUTBOUND', actor: 'SYSTEM', origin: 'SYSTEM', status: 'SIMULATED', body, provider, providerMessageId: providerReference, idempotencyKey: `outbox:${outboxId}`, sentAt: now, createdAt: now }, update: {} });
    await tx.conversation.update({ where: { tenantId_id: { tenantId, id: conversationId } }, data: { lastMessageAt: now } });
  }

  private async finalizeKnownReceipt(tenantId: string, id: string) {
    return this.prisma.unscoped.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "OutboxMessage" WHERE "tenantId" = ${tenantId}::uuid AND id = ${id}::uuid FOR UPDATE`;
      const row = await tx.outboxMessage.findFirst({ where: { tenantId, id, status: { in: ['UNKNOWN', 'PROCESSING'] } }, include: { patient: { select: { unitId: true } } } });
      if (!row?.patient.unitId) return false;
      const receipt = await tx.dryRunProviderReceipt.findUnique({ where: { tenantId_idempotencyKey: { tenantId, idempotencyKey: row.idempotencyKey } } });
      if (!receipt) return false;
      await this.writeDryRunMessage(tx, tenantId, id, row.patientId, row.patient.unitId, row.body, row.provider, receipt.providerReference);
      await tx.outboxMessage.update({ where: { tenantId_id: { tenantId, id } }, data: { status: 'SIMULATED', sentAt: receipt.acceptedAt, lastError: null, leaseExpiresAt: null } });
      await tx.outboxAttempt.create({ data: { tenantId, outboxMessageId: id, attemptNumber: Math.max(1, row.attempts) + 1, outcome: 'ACCEPTED', cause: 'DRY_RUN_RECEIPT_RECONCILED', detail: 'Receipt simulada localizada sem repetir a operação.', nextAction: 'NONE', providerReference: receipt.providerReference } });
      return true;
    });
  }
}

@Processor('outbox-dispatch', { concurrency: Number(process.env.OUTBOX_WORKER_CONCURRENCY ?? 32), lockDuration: Number(process.env.OUTBOX_JOB_LOCK_DURATION_MS ?? 30_000), stalledInterval: Number(process.env.OUTBOX_JOB_STALLED_INTERVAL_MS ?? 30_000), maxStalledCount: 2 })
@Injectable()
export class OutboxDispatchProcessor extends WorkerHost {
  constructor(private readonly service: OutboxDispatchService, private readonly redis: RedisCoordinatorService) { super(); }
  process(job: Job<DispatchJob>, token?: string) { return this.service.process(job, token, this.redis); }
}
