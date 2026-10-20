import { createHmac, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { PrismaClient } from '@prisma/client';
import { Redis } from 'ioredis';

const target = Number(process.env.LOAD_TEST_MESSAGES ?? 5000);
const batchSize = Number(process.env.LOAD_TEST_BATCH_SIZE ?? 100);
const baseUrl = (process.env.API_BASE_URL ?? 'http://localhost:3002/api').replace(/\/$/, '');
const appSecret = process.env.META_APP_SECRET;
const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
if (!Number.isInteger(target) || target < 1 || !Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100 || !appSecret) throw new Error('Configure META_APP_SECRET, LOAD_TEST_MESSAGES (default 5000) e batch size entre 1–100.');
const signingSecret = appSecret;

const db = new PrismaClient();
const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6380', { maxRetriesPerRequest: 1, connectTimeout: 2000 });
let tenantId: string | undefined;
let accepted = 0;
let errors = 0;
const startedAt = performance.now();

async function main() {
  const tenant = await db.tenant.create({ data: { name: `Webhook Load ${suffix}`, slug: `webhook-load-${suffix}` } });
  tenantId = tenant.id;
  const testTenantId = tenant.id;
  const unit = await db.unit.create({ data: { tenantId: testTenantId, name: 'Carga sintética', slug: `load-${suffix}` } });
  const patientCount = Math.min(1000, Math.max(1, Math.ceil(target / 5)));
  const patients = Array.from({ length: patientCount }, (_, index) => ({ tenantId: testTenantId, unitId: unit.id, fullName: `Paciente Fictício ${index + 1}`, phone: `551199${String(index).padStart(8, '0')}`, phoneNormalized: `551199${String(index).padStart(8, '0')}` }));
  await db.patient.createMany({ data: patients });
  const connection = await db.metaConnection.create({ data: { tenantId: testTenantId, unitId: unit.id, wabaId: `load-${suffix}`, phoneNumberId: `load-phone-${suffix}`, accessTokenEncrypted: 'synthetic-disabled', status: 'CONNECTED' } });
  const latenciesMs: number[] = [];
  for (let offset = 0; offset < target; offset += batchSize) {
    const count = Math.min(batchSize, target - offset);
    const messages = Array.from({ length: count }, (_, index) => ({
      id: `wamid.load.${suffix}.${offset + index}`,
      from: patients[(offset + index) % patients.length].phoneNormalized,
      timestamp: String(Math.floor(Date.now() / 1000)),
      type: 'text',
      text: { body: `Mensagem fictícia de carga ${offset + index + 1}` },
    }));
    const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: connection.wabaId, changes: [{ field: 'messages', value: { metadata: { phone_number_id: connection.phoneNumberId }, messages } }] }] });
    const requestStarted = performance.now();
    try {
      const response = await fetch(`${baseUrl}/meta/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': `sha256=${createHmac('sha256', signingSecret).update(body).digest('hex')}` }, body, signal: AbortSignal.timeout(15_000) });
      latenciesMs.push(performance.now() - requestStarted);
      if (!response.ok) { errors++; await response.text(); }
      else accepted += Number((await response.json() as { enqueued: number }).enqueued);
    } catch { errors++; latenciesMs.push(performance.now() - requestStarted); }
  }

  const reconciliationStart = performance.now();
  const recoveryCount = Math.min(100, target);
  const recoveryRows = Array.from({ length: recoveryCount }, (_, index) => ({ tenantId: tenant.id, connectionId: connection.id, eventKey: `recovery:${suffix}:${index}`, eventType: 'messages:message', payload: { id: `wamid.recovery.${suffix}.${index}`, from: patients[index % patients.length].phoneNormalized, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: `Evento de reconciliação ${index}` } }, providerMessageId: `wamid.recovery.${suffix}.${index}` }));
  await db.metaWebhookEvent.createMany({ data: recoveryRows });
  let terminalCount = 0;
  let backlogPeak = 0;
  const deadline = Date.now() + 5 * 60_000;
  let finalCounts: Record<string, number> = {};
  let recoveryCompletedAt: number | null = null;
  let peakRedisMemoryBytes = 0;
  while (Date.now() < deadline) {
    const grouped = await db.metaWebhookEvent.groupBy({ by: ['status'], where: { tenantId: testTenantId }, _count: { id: true } });
    finalCounts = Object.fromEntries(grouped.map((entry) => [entry.status, entry._count.id]));
    terminalCount = ['PROCESSED', 'UNMATCHED', 'FAILED'].reduce((sum, status) => sum + (finalCounts[status] ?? 0), 0);
    backlogPeak = Math.max(backlogPeak, (finalCounts.PENDING ?? 0) + (finalCounts.PROCESSING ?? 0) + (finalCounts.RETRY ?? 0));
    const recovered = await db.metaWebhookEvent.count({ where: { tenantId: testTenantId, eventKey: { startsWith: `recovery:${suffix}:` }, status: { in: ['PROCESSED', 'UNMATCHED', 'FAILED'] } } });
    if (recovered >= recoveryCount && recoveryCompletedAt === null) recoveryCompletedAt = performance.now();
    const memoryInfo = await redis.info('memory');
    const usedBytes = Number(/used_memory:(\d+)/.exec(memoryInfo)?.[1] ?? 0);
    peakRedisMemoryBytes = Math.max(peakRedisMemoryBytes, usedBytes);
    if (terminalCount >= target + recoveryCount) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  const events = await db.metaWebhookEvent.findMany({ where: { tenantId: testTenantId }, select: { receivedAt: true, processedAt: true, status: true } });
  const processingMs = events.filter((event) => event.processedAt).map((event) => event.processedAt!.getTime() - event.receivedAt.getTime()).sort((a, b) => a - b);
  const sorted = [...latenciesMs].sort((a, b) => a - b);
  const redisInfo = await redis.info('memory');
  const usedMemory = /used_memory_human:([^\r\n]+)/.exec(redisInfo)?.[1] ?? 'n/a';
  const elapsedSec = (performance.now() - startedAt) / 1000;
  const report = {
    target, accepted, httpErrors: errors, totalElapsedSeconds: Number(elapsedSec.toFixed(2)), acceptedThroughputPerSecond: Number((accepted / elapsedSec).toFixed(2)),
    httpLatencyMs: { p50: percentile(sorted, 0.5), p95: percentile(sorted, 0.95), max: Number((Math.max(...sorted, 0)).toFixed(2)) },
    processingLatencyMs: { p50: percentile(processingMs, 0.5), p95: percentile(processingMs, 0.95), max: Math.max(...processingMs, 0) },
    statuses: finalCounts, backlogPeak, reconciliationRecoverySeconds: recoveryCompletedAt === null ? null : Number(((recoveryCompletedAt - reconciliationStart) / 1000).toFixed(2)),
    redisUsedMemory: usedMemory, redisPeakMemoryBytes: peakRedisMemoryBytes, loadGeneratorRssBytes: process.memoryUsage().rss, eventsProcessedPerSecond: Number((terminalCount / Math.max(0.001, elapsedSec)).toFixed(2)),
    caveat: 'A reconciliação foi simulada com eventos persistidos sem job BullMQ. Isso não simula uma parada real do container Redis; capacidade não homologada.',
  };
  console.log(JSON.stringify(report, null, 2));
  if (errors > 0 || terminalCount < target + recoveryCount || (finalCounts.FAILED ?? 0) > 0) process.exitCode = 1;
  // Keep the fixture isolated and remove only records created by this run.
  await db.tenant.delete({ where: { id: tenant.id } });
}

function percentile(values: number[], fraction: number) { return values.length ? Number(values[Math.min(values.length - 1, Math.floor((values.length - 1) * fraction))].toFixed(2)) : 0; }

try { await main(); }
finally { if (tenantId) await db.tenant.deleteMany({ where: { id: tenantId } }).catch(() => undefined); await redis.quit(); await db.$disconnect(); }
