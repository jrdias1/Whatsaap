import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DelayedError, Job } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisCoordinatorService } from '../queue/redis-coordinator.service.js';
import { AutomationsService } from '../automations/automations.service.js';

type MetaWebhookJob = { eventId: string };
type MetaInbound = { id?: string; from?: string; timestamp?: string; type?: string; text?: { body?: string }; interactive?: { button_reply?: { id?: string; title?: string }; list_reply?: { id?: string; title?: string } } };

@Processor('meta-webhooks', { concurrency: 32 })
@Injectable()
export class MetaWebhookProcessor extends WorkerHost {
  private readonly logger = new Logger(MetaWebhookProcessor.name);
  constructor(private readonly prisma: PrismaService, private readonly redis: RedisCoordinatorService, private readonly automations: AutomationsService) { super(); }

  async process(job: Job<MetaWebhookJob>, token?: string) {
    const event = await this.prisma.unscoped.metaWebhookEvent.findUnique({ where: { id: job.data.eventId }, include: { connection: { select: { unitId: true } } } });
    if (!event || event.status === 'PROCESSED' || event.status === 'UNMATCHED') return;
    const lease = randomUUID();
    const slot = await this.redis.acquireTenantSlot(event.tenantId, lease);
    if (!slot) {
      await job.moveToDelayed(Date.now() + 250, token);
      throw new DelayedError();
    }
    try {
      const claimed = await this.prisma.unscoped.metaWebhookEvent.updateMany({ where: { id: event.id, status: { in: ['PENDING', 'RETRY'] } }, data: { status: 'PROCESSING', attempts: { increment: 1 }, nextAttemptAt: new Date(Date.now() + 5 * 60_000) } });
      if (!claimed.count) return;
      if (event.eventType.endsWith(':message')) {
        await this.processInbound(event.id, event.tenantId, event.connection.unitId, event.payload as MetaInbound);
      }
      else if (event.eventType.endsWith(':status')) await this.processStatus(event.id, event.tenantId, event.payload as Record<string, unknown>);
      else await this.markProcessed(event.id);
    } catch (error) {
      const attempts = Math.max(event.attempts + 1, job.attemptsMade + 1);
      const exhausted = attempts >= 8;
      await this.prisma.unscoped.metaWebhookEvent.update({ where: { id: event.id }, data: { status: exhausted ? 'FAILED' : 'RETRY', attempts, lastError: error instanceof Error ? error.message.slice(0, 500) : 'Erro desconhecido', nextAttemptAt: new Date(Date.now() + Math.min(300_000, 1000 * 2 ** (attempts - 1))) } });
      throw error;
    } finally {
      await this.redis.releaseTenantSlot(event.tenantId, slot, lease);
    }
  }

  private async processInbound(eventId: string, tenantId: string, unitId: string, item: MetaInbound): Promise<void> {
    if (!item.id || !item.from) throw new Error('Evento inbound Meta sem ID ou telefone.');
    const providerMessageId = item.id;
    const sender = item.from.replace(/\D/g, '');
    const providerTimestamp = item.timestamp && /^\d+$/.test(item.timestamp) ? new Date(Number(item.timestamp) * 1000) : new Date();
    const selectionId = item.interactive?.button_reply?.id ?? item.interactive?.list_reply?.id;
    const text = typeof item.text?.body === 'string' ? item.text.body : item.interactive?.button_reply?.title ?? item.interactive?.list_reply?.title ?? `[Mensagem ${item.type ?? 'multimídia'} recebida]`;
    return this.prisma.unscoped.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${tenantId}:${unitId}:${sender}`}, 0))`;
      const patient = await tx.patient.findFirst({ where: { tenantId, phoneNormalized: sender, active: true, deletedAt: null, OR: [{ unitId }, { unitId: null }] }, select: { id: true } });
      if (!patient) {
        // Keep the verified Meta event for later matching without creating an unreviewed patient.
        await tx.metaWebhookEvent.update({ where: { id: eventId }, data: { status: 'UNMATCHED', processedAt: new Date(), lastError: null } });
        return;
      }

      const command = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase();
      if (['SAIR', 'STOP', 'CANCELAR'].includes(command)) await this.revokeMarketing(tx, tenantId, patient.id, providerMessageId, text, providerTimestamp);

      let conversation = await tx.conversation.findFirst({ where: { tenantId, unitId, patientId: patient.id, status: { not: 'CLOSED' } }, orderBy: [{ lastMessageAt: 'desc' }, { id: 'asc' }] });
      if (!conversation) {
        const stage = await tx.conversationStage.findFirst({ where: { tenantId, active: true }, orderBy: [{ position: 'asc' }, { id: 'asc' }] });
        conversation = await tx.conversation.create({ data: { tenantId, unitId, patientId: patient.id, status: 'OPEN', pipelineStageId: stage?.id, lastMessageAt: providerTimestamp, humanResponseDueAt: new Date(providerTimestamp.getTime() + 15 * 60_000) } });
      } else {
        await tx.conversation.update({ where: { tenantId_id: { tenantId, id: conversation.id } }, data: { status: conversation.status === 'WAITING_HUMAN' ? 'WAITING_HUMAN' : 'OPEN', lastMessageAt: providerTimestamp, humanResponseDueAt: new Date(providerTimestamp.getTime() + 15 * 60_000) } });
      }
      await tx.message.upsert({
        where: { tenantId_provider_providerMessageId: { tenantId, provider: 'META_CLOUD', providerMessageId } },
        create: { tenantId, conversationId: conversation.id, direction: 'INBOUND', actor: 'PATIENT', origin: 'SYSTEM', status: 'RECEIVED', body: text, provider: 'META_CLOUD', providerMessageId, idempotencyKey: `meta-in:${providerMessageId}`, createdAt: providerTimestamp },
        update: {},
      });
      await this.automations.handlePatientReply(tx, tenantId, unitId, patient.id, text, providerMessageId, 'META_CLOUD_HMAC', selectionId);
      await tx.metaWebhookEvent.update({ where: { id: eventId }, data: { status: 'PROCESSED', processedAt: new Date(), lastError: null } });
    });
  }

  private async revokeMarketing(tx: Prisma.TransactionClient, tenantId: string, patientId: string, providerMessageId: string, evidence: string, occurredAt: Date) {
    await tx.$queryRaw`SELECT id FROM "Patient" WHERE "tenantId" = ${tenantId}::uuid AND id = ${patientId}::uuid FOR UPDATE`;
    await tx.consentEvent.create({ data: { tenantId, patientId, channel: 'WHATSAPP', purpose: 'MARKETING', status: 'REVOKED', source: 'WHATSAPP_INBOUND', evidence: evidence.slice(0, 500), evidenceType: 'WHATSAPP_MESSAGE', evidenceReference: providerMessageId, occurredAt } });
    await tx.consentPreference.upsert({
      where: { tenantId_patientId_channel_purpose: { tenantId, patientId, channel: 'WHATSAPP', purpose: 'MARKETING' } },
      create: { tenantId, patientId, channel: 'WHATSAPP', purpose: 'MARKETING', status: 'REVOKED', source: 'WHATSAPP_INBOUND', evidence: evidence.slice(0, 500), evidenceType: 'WHATSAPP_MESSAGE', evidenceReference: providerMessageId, lastChangedAt: occurredAt },
      update: { status: 'REVOKED', source: 'WHATSAPP_INBOUND', evidence: evidence.slice(0, 500), evidenceType: 'WHATSAPP_MESSAGE', evidenceReference: providerMessageId, lastChangedAt: occurredAt },
    });
    await tx.outboxMessage.updateMany({ where: { tenantId, patientId, channel: 'WHATSAPP', purpose: 'MARKETING', status: { in: ['PENDING', 'PROCESSING'] } }, data: { status: 'SUPPRESSED', suppressionReason: 'OPT_OUT_INBOUND' } });
    await tx.consentEvent.create({ data: { tenantId, patientId, channel: 'WHATSAPP', purpose: 'PROCEDURE_RETURN', status: 'REVOKED', source: 'WHATSAPP_INBOUND', evidence: evidence.slice(0, 500), evidenceType: 'WHATSAPP_MESSAGE', evidenceReference: providerMessageId, occurredAt } });
    await tx.consentPreference.upsert({ where: { tenantId_patientId_channel_purpose: { tenantId, patientId, channel: 'WHATSAPP', purpose: 'PROCEDURE_RETURN' } }, create: { tenantId, patientId, channel: 'WHATSAPP', purpose: 'PROCEDURE_RETURN', status: 'REVOKED', source: 'WHATSAPP_INBOUND', evidence: evidence.slice(0, 500), evidenceType: 'WHATSAPP_MESSAGE', evidenceReference: providerMessageId, lastChangedAt: occurredAt }, update: { status: 'REVOKED', source: 'WHATSAPP_INBOUND', evidence: evidence.slice(0, 500), evidenceType: 'WHATSAPP_MESSAGE', evidenceReference: providerMessageId, lastChangedAt: occurredAt } });
    await tx.outboxMessage.updateMany({ where: { tenantId, patientId, channel: 'WHATSAPP', purpose: 'PROCEDURE_RETURN', status: { in: ['PENDING', 'RETRY', 'PROCESSING'] } }, data: { status: 'SUPPRESSED', suppressionReason: 'OPT_OUT_INBOUND' } });
    await tx.automationExecution.updateMany({ where: { tenantId, patientId, status: 'PENDING', automation: { trigger: 'PROCEDURE_RETURN' } }, data: { status: 'SUPPRESSED', lastError: 'Global WhatsApp opt-out.' } });
  }

  private async processStatus(eventId: string, tenantId: string, item: Record<string, unknown>) {
    const id = typeof item.id === 'string' ? item.id : undefined;
    const status = typeof item.status === 'string' ? item.status.toUpperCase() : undefined;
    await this.prisma.unscoped.$transaction(async (tx) => {
      if (id && ['SENT', 'DELIVERED', 'READ', 'FAILED'].includes(status ?? '')) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${tenantId}:META_CLOUD:${id}`}, 0))`;
        const message = await tx.message.findFirst({ where: { tenantId, provider: 'META_CLOUD', providerMessageId: id } });
        if (message) {
          const rank: Record<string, number> = { QUEUED: 0, SENT: 1, DELIVERED: 2, READ: 3 };
          const canAdvance = status !== 'FAILED' && (rank[status!] ?? 0) > (rank[message.status] ?? 0);
          const canFail = status === 'FAILED' && !['DELIVERED', 'READ'].includes(message.status);
          if (canAdvance || canFail) await tx.message.update({ where: { tenantId_id: { tenantId, id: message.id } }, data: { status: status as 'SENT' | 'DELIVERED' | 'READ' | 'FAILED' } });
        }
      }
      await tx.metaWebhookEvent.update({ where: { id: eventId }, data: { status: 'PROCESSED', processedAt: new Date(), lastError: null } });
    });
  }

  private markProcessed(eventId: string) {
    return this.prisma.unscoped.metaWebhookEvent.update({ where: { id: eventId }, data: { status: 'PROCESSED', processedAt: new Date(), lastError: null } });
  }
}
