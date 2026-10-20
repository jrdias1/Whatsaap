import { createHmac, timingSafeEqual } from 'node:crypto';
import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service.js';

type MetaChange = { field?: string; value?: { metadata?: { phone_number_id?: string }; messages?: Array<Record<string, unknown>>; statuses?: Array<Record<string, unknown>> } };
type MetaBody = { object?: string; entry?: Array<{ id?: string; changes?: MetaChange[] }> };

@Injectable()
export class MetaWebhookService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MetaWebhookService.name);
  private reconcileTimer?: NodeJS.Timeout;

  constructor(private readonly prisma: PrismaService, @InjectQueue('meta-webhooks') private readonly queue: Queue) {}

  verifyChallenge(query: Record<string, string>) {
    const expected = process.env.META_WEBHOOK_VERIFY_TOKEN;
    if (!expected || query['hub.mode'] !== 'subscribe' || query['hub.verify_token'] !== expected) return null;
    return query['hub.challenge'] ?? '';
  }

  isValidSignature(raw: Buffer, signature?: string) {
    const secret = process.env.META_APP_SECRET;
    if (!secret || !signature?.startsWith('sha256=')) return false;
    const received = Buffer.from(signature.slice(7), 'hex');
    const expected = createHmac('sha256', secret).update(raw).digest();
    return received.length === expected.length && timingSafeEqual(received, expected);
  }

  async accept(input: unknown) {
    const body = input as MetaBody;
    if (body?.object !== 'whatsapp_business_account' || !Array.isArray(body.entry)) return { accepted: true, enqueued: 0 };
    const batches = new Map<string, { tenantId: string; connectionId: string; rows: Array<{ tenantId: string; connectionId: string; eventKey: string; eventType: string; payload: object; providerMessageId: string; providerTimestamp: bigint | null }>; eventKeys: Set<string> }>();
    for (const entry of body.entry) for (const change of entry.changes ?? []) {
      const value = change.value;
      const phoneNumberId = value?.metadata?.phone_number_id;
      if (!phoneNumberId) continue;
      const connection = await this.prisma.unscoped.metaConnection.findFirst({ where: { phoneNumberId, enabled: true }, select: { id: true, tenantId: true } });
      if (!connection) continue;
      const connectionKey = `${connection.tenantId}:${connection.id}`;
      const batch = batches.get(connectionKey) ?? { tenantId: connection.tenantId, connectionId: connection.id, rows: [], eventKeys: new Set<string>() };
      const items = [ ...(value.messages ?? []).map((event) => ({ type: 'message', event })), ...(value.statuses ?? []).map((event) => ({ type: 'status', event })) ];
      for (const { type, event } of items) {
        const providerId = typeof event.id === 'string' ? event.id : undefined;
        if (!providerId) continue;
        const status = typeof event.status === 'string' ? event.status : '';
        const timestamp = typeof event.timestamp === 'string' ? event.timestamp : '';
        const eventKey = type === 'message' ? `message:${providerId}` : `status:${providerId}:${status}:${timestamp}`;
        batch.eventKeys.add(eventKey);
        batch.rows.push({ tenantId: connection.tenantId, connectionId: connection.id, eventKey, eventType: `${change.field ?? 'unknown'}:${type}`, payload: event as object, providerMessageId: providerId, providerTimestamp: timestamp && /^\d+$/.test(timestamp) ? BigInt(timestamp) : null });
      }
      batches.set(connectionKey, batch);
    }
    // Persist the complete signed batch before touching Redis. If Redis is down,
    // the caller receives 503 and reconciliation can enqueue these rows later.
    let enqueued = 0;
    for (const batch of batches.values()) {
      if (batch.rows.length === 0) continue;
      await this.prisma.unscoped.metaWebhookEvent.createMany({ data: batch.rows, skipDuplicates: true });
      const events = await this.prisma.unscoped.metaWebhookEvent.findMany({ where: { tenantId: batch.tenantId, connectionId: batch.connectionId, eventKey: { in: [...batch.eventKeys] }, status: { in: ['PENDING', 'RETRY'] } }, select: { id: true } });
      await this.enqueueMany(events.map(({ id }) => id));
      enqueued += events.length;
    }
    return { accepted: true, enqueued };
  }

  onModuleInit() {
    this.reconcileTimer = setInterval(() => void this.reconcilePendingEvents().catch((error: unknown) => this.logger.error('Falha na reconciliação da fila Meta', error)), 10_000);
    this.reconcileTimer.unref();
  }

  onModuleDestroy() { if (this.reconcileTimer) clearInterval(this.reconcileTimer); }

  async reconcilePendingEvents() {
    const now = new Date();
    const stale = await this.prisma.unscoped.metaWebhookEvent.findMany({ where: { status: 'PROCESSING', nextAttemptAt: { lte: now } }, orderBy: [{ receivedAt: 'asc' }, { id: 'asc' }], take: 250, select: { id: true, attempts: true } });
    for (const event of stale) await this.prisma.unscoped.metaWebhookEvent.updateMany({ where: { id: event.id, status: 'PROCESSING', nextAttemptAt: { lte: now } }, data: { status: event.attempts >= 8 ? 'FAILED' : 'RETRY', enqueuedAt: null, lastError: 'Worker interrompido durante processamento; recuperado pelo reconciliador.', nextAttemptAt: now } });
    const pending = await this.prisma.unscoped.metaWebhookEvent.findMany({ where: { status: { in: ['PENDING', 'RETRY'] }, enqueuedAt: null, nextAttemptAt: { lte: now } }, orderBy: [{ receivedAt: 'asc' }, { id: 'asc' }], take: 250, select: { id: true } });
    await this.enqueueMany(pending.map(({ id }) => id));
  }

  private async enqueueMany(eventIds: string[]) {
    if (eventIds.length === 0) return Promise.resolve([]);
    let timer: NodeJS.Timeout | undefined;
    try {
      const jobs = await Promise.race([
        this.queue.addBulk(eventIds.map((eventId) => ({ name: 'process-event', data: { eventId }, opts: { jobId: eventId, attempts: 8, backoff: { type: 'exponential' as const, delay: 1000 }, removeOnComplete: { count: 5000 }, removeOnFail: false } }))),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Redis não confirmou o enfileiramento em 3 segundos.')), 3000); timer.unref(); }),
      ]);
      await this.prisma.unscoped.metaWebhookEvent.updateMany({ where: { id: { in: eventIds }, status: { in: ['PENDING', 'RETRY'] } }, data: { enqueuedAt: new Date() } });
      return jobs;
    } finally { if (timer) clearTimeout(timer); }
  }
}
