import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DelayedError, Job, Queue } from 'bullmq';
import { createHash, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisCoordinatorService } from '../queue/redis-coordinator.service.js';
import { AutomationsService } from '../automations/automations.service.js';
import { assertValidUtf8Bytes } from '../common/message-text-integrity.js';

type EventJob = { eventId: string };
type PayloadRecord = Record<string, any>;
type IncomingEvent = { tenantId: string; connectionId: string; eventKey: string; eventType: string; payload: object; providerMessageId?: string };

@Processor('evolution-webhooks', { concurrency: 16 })
@Injectable()
export class EvolutionWebhookService extends WorkerHost implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EvolutionWebhookService.name);
  private reconcileTimer?: NodeJS.Timeout;
  constructor(private readonly prisma: PrismaService, private readonly redis: RedisCoordinatorService, private readonly automations: AutomationsService, @InjectQueue('evolution-webhooks') private readonly queue: Queue<EventJob>) { super(); }

  async accept(connectionId: string, secret: string | undefined, input: unknown, rawBody?: Buffer) {
    const connection = await this.prisma.unscoped.evolutionConnection.findUnique({ where: { id: connectionId }, select: { id: true, tenantId: true, instanceName: true, webhookSecretHash: true, mode: true, enabled: true } });
    const provided = typeof secret === 'string' ? createHash('sha256').update(secret).digest() : Buffer.alloc(0);
    const expected = connection ? Buffer.from(connection.webhookSecretHash, 'hex') : Buffer.alloc(0);
    if (!connection || !connection.enabled || connection.mode !== 'EVOLUTION_BAILEYS' || provided.length !== expected.length || !timingSafeEqual(provided, expected)) throw new UnauthorizedException('Credencial de webhook Evolution inválida ou conexão desativada.');
    if (rawBody) assertValidUtf8Bytes(rawBody);
    if (!input || typeof input !== 'object' || Array.isArray(input)) return { accepted: true, enqueued: 0 };
    const body = input as PayloadRecord;
    if (typeof body.instance === 'string' && body.instance !== connection.instanceName) throw new UnauthorizedException('Instância do payload não corresponde à conexão.');
    const eventType = typeof body.event === 'string' ? body.event.toUpperCase().replaceAll('.', '_') : '';
    if (!['MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'CONNECTION_UPDATE'].includes(eventType)) return { accepted: true, enqueued: 0, ignored: true };
    const data = body.data && typeof body.data === 'object' ? body.data as PayloadRecord : {};
    const key = data.key && typeof data.key === 'object' ? data.key as PayloadRecord : {};
    const providerMessageId = typeof key.id === 'string' ? key.id : typeof data.keyId === 'string' ? data.keyId : undefined;
    const status = String(data.status ?? data.update?.status ?? '').toLowerCase();
    const timestamp = String(data.messageTimestamp ?? data.timestamp ?? '');
    const eventKey = eventType === 'CONNECTION_UPDATE'
      ? `connection:${String(data.state ?? data.instance?.state ?? 'unknown')}:${timestamp || Math.floor(Date.now() / 1000)}`
      : providerMessageId
        ? eventType === 'MESSAGES_UPSERT' ? `message:${providerMessageId}` : `status:${providerMessageId}:${status}:${timestamp}`
        : '';
    if (!eventKey) return { accepted: true, enqueued: 0, ignored: true };
    const event: IncomingEvent = { tenantId: connection.tenantId, connectionId: connection.id, eventKey, eventType, payload: data as object, ...(providerMessageId ? { providerMessageId } : {}) };
    await this.prisma.unscoped.evolutionWebhookEvent.createMany({ data: [event], skipDuplicates: true });
    const rows = await this.prisma.unscoped.evolutionWebhookEvent.findMany({ where: { tenantId: connection.tenantId, connectionId, eventKey, status: { in: ['PENDING', 'RETRY'] }, enqueuedAt: null }, select: { id: true } });
    if (!rows.length) return { accepted: true, enqueued: 0, duplicate: true };
    const jobs = await this.queue.addBulk(rows.map(({ id }) => ({ name: 'process-event', data: { eventId: id }, opts: { jobId: id, attempts: 8, backoff: { type: 'exponential' as const, delay: 1000 }, removeOnComplete: { count: 5000 }, removeOnFail: false } })));
    await this.prisma.unscoped.evolutionWebhookEvent.updateMany({ where: { id: { in: rows.map(({ id }) => id) }, status: { in: ['PENDING', 'RETRY'] } }, data: { enqueuedAt: new Date() } });
    return { accepted: true, enqueued: jobs.length };
  }

  async process(job: Job<EventJob>, token?: string) {
    const event = await this.prisma.unscoped.evolutionWebhookEvent.findUnique({ where: { id: job.data.eventId }, include: { connection: { select: { unitId: true, mode: true } } } });
    if (!event || ['PROCESSED', 'UNMATCHED'].includes(event.status)) return;
    const lease = `${event.id}:${Date.now()}`;
    const slot = await this.redis.acquireTenantSlot(event.tenantId, lease);
    if (!slot) { await job.moveToDelayed(Date.now() + 250, token); throw new DelayedError(); }
    try {
      const claimed = await this.prisma.unscoped.evolutionWebhookEvent.updateMany({ where: { id: event.id, status: { in: ['PENDING', 'RETRY'] } }, data: { status: 'PROCESSING', attempts: { increment: 1 }, nextAttemptAt: new Date(Date.now() + 5 * 60_000) } });
      if (!claimed.count) return;
      const payload = event.payload as PayloadRecord;
      if (event.eventType === 'MESSAGES_UPSERT') await this.processMessage(event.id, event.tenantId, event.connectionId, event.connection.unitId, payload);
      else if (event.eventType === 'MESSAGES_UPDATE') await this.processStatus(event.id, event.tenantId, event.providerMessageId, payload);
      else await this.processConnectionState(event.id, event.tenantId, event.connectionId, payload);
    } catch (error) {
      const attempts = Math.max(event.attempts + 1, job.attemptsMade + 1);
      await this.prisma.unscoped.evolutionWebhookEvent.update({ where: { id: event.id }, data: { status: attempts >= 8 ? 'FAILED' : 'RETRY', attempts, enqueuedAt: null, lastError: error instanceof Error ? error.message.slice(0, 500) : 'Erro desconhecido', nextAttemptAt: new Date(Date.now() + Math.min(300_000, 1000 * 2 ** (attempts - 1))) } });
      throw error;
    } finally { await this.redis.releaseTenantSlot(event.tenantId, slot, lease); }
  }

  onModuleInit() { this.reconcileTimer = setInterval(() => void this.reconcile().catch((error: unknown) => this.logger.error('Evolution webhook reconciliation failed', error)), 10_000); this.reconcileTimer.unref(); }
  onModuleDestroy() { if (this.reconcileTimer) clearInterval(this.reconcileTimer); }
  async reconcile() {
    const now = new Date();
    await this.prisma.unscoped.evolutionWebhookEvent.updateMany({ where: { status: 'PROCESSING', nextAttemptAt: { lte: now }, attempts: { lt: 8 } }, data: { status: 'RETRY', enqueuedAt: null, nextAttemptAt: now, lastError: 'Worker lease expired; event recovered from PostgreSQL.' } });
    const rows = await this.prisma.unscoped.evolutionWebhookEvent.findMany({ where: { status: { in: ['PENDING', 'RETRY'] }, enqueuedAt: null, nextAttemptAt: { lte: now } }, orderBy: [{ receivedAt: 'asc' }, { id: 'asc' }], take: 250, select: { id: true } });
    if (!rows.length) return 0;
    const jobs = await this.queue.addBulk(rows.map(({ id }) => ({ name: 'process-event', data: { eventId: id }, opts: { jobId: id, attempts: 8, backoff: { type: 'exponential' as const, delay: 1000 }, removeOnComplete: { count: 5000 }, removeOnFail: false } })));
    await this.prisma.unscoped.evolutionWebhookEvent.updateMany({ where: { id: { in: rows.map(({ id }) => id) }, status: { in: ['PENDING', 'RETRY'] } }, data: { enqueuedAt: new Date() } });
    return jobs.length;
  }

  private async processMessage(eventId: string, tenantId: string, connectionId: string, unitId: string, data: PayloadRecord) {
    const key = (data.key && typeof data.key === 'object' ? data.key : {}) as PayloadRecord;
    const id = typeof key.id === 'string' ? key.id : undefined;
    if (!id) throw new Error('Evento Evolution sem identificador de mensagem.');
    const fromMe = key.fromMe === true;
    const remoteJid = typeof key.remoteJid === 'string' ? key.remoteJid : '';
    const phone = remoteJid.replace(/@.*$/, '').replace(/\D/g, '');
    const content = data.message && typeof data.message === 'object' ? data.message as PayloadRecord : {};
    const buttonResponse = content.buttonsResponseMessage && typeof content.buttonsResponseMessage === 'object' ? content.buttonsResponseMessage as PayloadRecord : {};
    const templateResponse = content.templateButtonReplyMessage && typeof content.templateButtonReplyMessage === 'object' ? content.templateButtonReplyMessage as PayloadRecord : {};
    const selectionId = typeof buttonResponse.selectedButtonId === 'string' ? buttonResponse.selectedButtonId : typeof templateResponse.selectedId === 'string' ? templateResponse.selectedId : undefined;
    const text = typeof content.conversation === 'string' ? content.conversation : typeof content.extendedTextMessage?.text === 'string' ? content.extendedTextMessage.text : typeof buttonResponse.selectedDisplayText === 'string' ? buttonResponse.selectedDisplayText : typeof templateResponse.selectedDisplayText === 'string' ? templateResponse.selectedDisplayText : `[Mensagem ${String(data.messageType ?? 'multimídia')} recebida]`;
    await this.prisma.unscoped.$transaction(async (tx) => {
      if (fromMe) {
        const existing = await tx.message.findFirst({ where: { tenantId, provider: 'EVOLUTION_BAILEYS', providerMessageId: id } });
        if (existing && existing.status === 'QUEUED') await tx.message.update({ where: { tenantId_id: { tenantId, id: existing.id } }, data: { status: 'SENT', sentAt: new Date() } });
        await tx.evolutionWebhookEvent.update({ where: { id: eventId }, data: { status: 'PROCESSED', processedAt: new Date() } });
        return;
      }
      if (!phone) throw new Error('Evento inbound Evolution sem remetente individual.');
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${tenantId}:${unitId}:${phone}`}, 0))`;
      const patient = await tx.patient.findFirst({ where: { tenantId, phoneNormalized: phone, active: true, deletedAt: null, OR: [{ unitId }, { unitId: null }] }, select: { id: true } });
      if (!patient) { await tx.evolutionWebhookEvent.update({ where: { id: eventId }, data: { status: 'UNMATCHED', processedAt: new Date() } }); return; }
      const occurredAt = typeof data.messageTimestamp === 'number' ? new Date(data.messageTimestamp * 1000) : new Date();
      const command = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase();
      if (['SAIR', 'STOP', 'CANCELAR'].includes(command)) await this.revokeMarketing(tx, tenantId, patient.id, id, text, occurredAt);
      let conversation = await tx.conversation.findFirst({ where: { tenantId, unitId, patientId: patient.id, status: { not: 'CLOSED' } }, orderBy: [{ lastMessageAt: 'desc' }, { id: 'asc' }] });
      if (!conversation) {
        const stage = await tx.conversationStage.findFirst({ where: { tenantId, active: true }, orderBy: [{ position: 'asc' }, { id: 'asc' }] });
        conversation = await tx.conversation.create({ data: { tenantId, unitId, patientId: patient.id, status: 'OPEN', pipelineStageId: stage?.id, lastMessageAt: occurredAt, humanResponseDueAt: new Date(occurredAt.getTime() + 15 * 60_000) } });
      } else await tx.conversation.update({ where: { tenantId_id: { tenantId, id: conversation.id } }, data: { lastMessageAt: occurredAt, humanResponseDueAt: new Date(occurredAt.getTime() + 15 * 60_000) } });
      await tx.message.upsert({ where: { tenantId_provider_providerMessageId: { tenantId, provider: 'EVOLUTION_BAILEYS', providerMessageId: id } }, create: { tenantId, conversationId: conversation.id, direction: 'INBOUND', actor: 'PATIENT', origin: 'SYSTEM', status: 'RECEIVED', body: text, provider: 'EVOLUTION_BAILEYS', providerMessageId: id, idempotencyKey: `evolution-in:${connectionId}:${id}`, createdAt: occurredAt }, update: {} });
      await this.automations.handlePatientReply(tx, tenantId, unitId, patient.id, text, id, 'EVOLUTION_AUTHENTICATED_SECRET', selectionId);
      await tx.evolutionWebhookEvent.update({ where: { id: eventId }, data: { status: 'PROCESSED', processedAt: new Date(), lastError: null } });
    });
  }

  private async processStatus(eventId: string, tenantId: string, messageId: string | null, payload: PayloadRecord) {
    const statusMap: Record<string, 'SENT' | 'DELIVERED' | 'READ' | 'FAILED'> = { SERVER_ACK: 'SENT', DELIVERY_ACK: 'DELIVERED', READ: 'READ', PLAYED: 'READ', ERROR: 'FAILED' };
    const providerStatus = String(payload.status ?? payload.update?.status ?? '').toUpperCase();
    const status = statusMap[providerStatus];
    await this.prisma.unscoped.$transaction(async (tx) => {
      if (messageId && status) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${tenantId}:EVOLUTION_BAILEYS:${messageId}`}, 0))`;
        const message = await tx.message.findFirst({ where: { tenantId, provider: 'EVOLUTION_BAILEYS', providerMessageId: messageId } });
        if (message) {
          const rank = { QUEUED: 0, SIMULATED: 0, SENT: 1, DELIVERED: 2, READ: 3 } as Record<string, number>;
          if (status === 'FAILED' ? !['DELIVERED', 'READ'].includes(message.status) : rank[status] > (rank[message.status] ?? 0)) await tx.message.update({ where: { tenantId_id: { tenantId, id: message.id } }, data: { status } });
        }
      }
      await tx.evolutionWebhookEvent.update({ where: { id: eventId }, data: { status: 'PROCESSED', processedAt: new Date() } });
    });
  }

  private async processConnectionState(eventId: string, tenantId: string, connectionId: string, payload: PayloadRecord) {
    const raw = String(payload.state ?? payload.instance?.state ?? '').toLowerCase();
    const status = raw === 'open' ? 'CONNECTED' : raw ? 'DISCONNECTED' : 'ERROR';
    const phone = typeof payload.ownerJid === 'string' ? payload.ownerJid.replace(/@.*$/, '').replace(/\D/g, '') : undefined;
    await this.prisma.unscoped.$transaction([
      this.prisma.unscoped.evolutionConnection.updateMany({ where: { tenantId, id: connectionId }, data: { status, lastCheckedAt: new Date(), lastError: status === 'ERROR' ? 'Estado de conexão ausente no callback.' : null, ...(phone ? { phoneNumber: phone } : {}) } }),
      this.prisma.unscoped.evolutionWebhookEvent.update({ where: { id: eventId }, data: { status: 'PROCESSED', processedAt: new Date() } }),
    ]);
  }

  private async revokeMarketing(tx: Prisma.TransactionClient, tenantId: string, patientId: string, messageId: string, evidence: string, occurredAt: Date) {
    await tx.$queryRaw`SELECT id FROM "Patient" WHERE "tenantId" = ${tenantId}::uuid AND id = ${patientId}::uuid FOR UPDATE`;
    await tx.consentEvent.create({ data: { tenantId, patientId, channel: 'WHATSAPP', purpose: 'MARKETING', status: 'REVOKED', source: 'WHATSAPP_INBOUND', evidence: evidence.slice(0, 500), evidenceType: 'WHATSAPP_MESSAGE', evidenceReference: messageId, occurredAt } });
    await tx.consentPreference.upsert({ where: { tenantId_patientId_channel_purpose: { tenantId, patientId, channel: 'WHATSAPP', purpose: 'MARKETING' } }, create: { tenantId, patientId, channel: 'WHATSAPP', purpose: 'MARKETING', status: 'REVOKED', source: 'WHATSAPP_INBOUND', evidence: evidence.slice(0, 500), evidenceType: 'WHATSAPP_MESSAGE', evidenceReference: messageId, lastChangedAt: occurredAt }, update: { status: 'REVOKED', source: 'WHATSAPP_INBOUND', evidence: evidence.slice(0, 500), evidenceType: 'WHATSAPP_MESSAGE', evidenceReference: messageId, lastChangedAt: occurredAt } });
    await tx.outboxMessage.updateMany({ where: { tenantId, patientId, channel: 'WHATSAPP', purpose: 'MARKETING', status: { in: ['PENDING', 'RETRY', 'PROCESSING'] } }, data: { status: 'SUPPRESSED', suppressionReason: 'OPT_OUT_INBOUND' } });
    await tx.consentEvent.create({ data: { tenantId, patientId, channel: 'WHATSAPP', purpose: 'PROCEDURE_RETURN', status: 'REVOKED', source: 'WHATSAPP_INBOUND', evidence: evidence.slice(0, 500), evidenceType: 'WHATSAPP_MESSAGE', evidenceReference: messageId, occurredAt } });
    await tx.consentPreference.upsert({ where: { tenantId_patientId_channel_purpose: { tenantId, patientId, channel: 'WHATSAPP', purpose: 'PROCEDURE_RETURN' } }, create: { tenantId, patientId, channel: 'WHATSAPP', purpose: 'PROCEDURE_RETURN', status: 'REVOKED', source: 'WHATSAPP_INBOUND', evidence: evidence.slice(0, 500), evidenceType: 'WHATSAPP_MESSAGE', evidenceReference: messageId, lastChangedAt: occurredAt }, update: { status: 'REVOKED', source: 'WHATSAPP_INBOUND', evidence: evidence.slice(0, 500), evidenceType: 'WHATSAPP_MESSAGE', evidenceReference: messageId, lastChangedAt: occurredAt } });
    await tx.outboxMessage.updateMany({ where: { tenantId, patientId, channel: 'WHATSAPP', purpose: 'PROCEDURE_RETURN', status: { in: ['PENDING', 'RETRY', 'PROCESSING'] } }, data: { status: 'SUPPRESSED', suppressionReason: 'OPT_OUT_INBOUND' } });
    await tx.automationExecution.updateMany({ where: { tenantId, patientId, status: 'PENDING', automation: { trigger: 'PROCEDURE_RETURN' } }, data: { status: 'SUPPRESSED', lastError: 'Global WhatsApp opt-out.' } });
  }
}
