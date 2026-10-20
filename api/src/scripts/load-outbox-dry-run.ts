import { PrismaClient } from '@prisma/client';
import { SignJWT } from 'jose';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';

const count = Number(process.env.OUTBOX_LOAD_COUNT ?? 5000);
const apiPort = Number(process.env.OUTBOX_LOAD_API_PORT ?? 3903);
const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6380';
const prisma = new PrismaClient();
const suffix = `${Date.now()}-${randomBytes(4).toString('hex')}`;
let api: ReturnType<typeof spawn> | undefined;
let apiPid = 0;
let redisCheck: Redis | undefined;
let tenantId = '';
let userId = '';
let planId = '';

function percentile(values: number[], p: number) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return Number(sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)].toFixed(2));
}

async function waitForApi() {
  const until = Date.now() + 30_000;
  while (Date.now() < until) {
    if (api?.exitCode !== null && api?.exitCode !== undefined) throw new Error(`API encerrou durante startup (exit ${api.exitCode}).`);
    try { if ((await fetch(`http://127.0.0.1:${apiPort}/api/health`)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('API não iniciou a tempo.');
}

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Teste só pode executar fora de produção.');
  if (!Number.isInteger(count) || count < 1 || count > 20_000) throw new Error('OUTBOX_LOAD_COUNT deve ficar entre 1 e 20000.');
  redisCheck = new Redis(redisUrl, { lazyConnect: true, connectTimeout: 1500, maxRetriesPerRequest: 1, retryStrategy: () => null });
  redisCheck.on('error', () => undefined);
  await redisCheck.connect();
  await redisCheck.ping();
  const apiSecret = 'local-outbox-load-api-secret-at-least-32-chars';
  const plan = await prisma.plan.create({ data: { code: `OUTBOX-LOAD-${suffix}`, name: 'Outbox load fixture', priceCents: 0, patientLimit: count + 10, messageLimitPerCycle: count + 10, userLimit: 10, unitLimit: 3, connectionLimit: 3, activeAutomationLimit: 5, campaignLimitPerCycle: 10 } });
  planId = plan.id;
  const tenant = await prisma.tenant.create({ data: { name: `Outbox load ${suffix}`, slug: `outbox-load-${suffix}` } });
  tenantId = tenant.id;
  const unit = await prisma.unit.create({ data: { tenantId, name: 'Load test', slug: 'load-test' } });
  const user = await prisma.user.create({ data: { email: `outbox-load-${suffix}@example.test`, displayName: 'Outbox load', passwordHash: 'not-used' } });
  userId = user.id;
  const membership = await prisma.membership.create({ data: { tenantId, userId, role: 'TENANT_ADMIN' } });
  await prisma.unitMembership.create({ data: { tenantId, membershipId: membership.id, unitId: unit.id } });
  const cycleStartsAt = new Date(Date.now() - 60_000);
  const cycleEndsAt = new Date(Date.now() + 30 * 86400_000);
  const subscription = await prisma.subscription.create({ data: { tenantId, planId, status: 'TRIAL', cycleStartsAt, cycleEndsAt } });
  await prisma.metaConnection.create({ data: { tenantId, unitId: unit.id, wabaId: `load-waba-${suffix}`, phoneNumberId: `load-phone-${suffix}`, accessTokenEncrypted: 'local-test-placeholder', status: 'CONNECTED' } });
  const campaign = await prisma.campaign.create({ data: { tenantId, name: '5k dry-run', status: 'APPROVED', channel: 'WHATSAPP', provider: 'META_CLOUD', body: 'Mensagem fictícia de carga. Nenhum envio externo.' } });
  await prisma.usageEntry.create({ data: { tenantId, subscriptionId: subscription.id, metric: 'messages', quantity: count, idempotencyKey: `campaign:${campaign.id}:messages`, cycleStartsAt, cycleEndsAt } });
  const patients = Array.from({ length: count }, (_, index) => ({ id: randomUUID(), tenantId, unitId: unit.id, fullName: `Paciente carga ${index + 1}`, phone: `5511${String(index).padStart(8, '0')}`, phoneNormalized: `5511${String(index).padStart(8, '0')}` }));
  for (let offset = 0; offset < patients.length; offset += 500) await prisma.patient.createMany({ data: patients.slice(offset, offset + 500) });
  for (let offset = 0; offset < patients.length; offset += 500) {
    const batch = patients.slice(offset, offset + 500);
    await prisma.consentPreference.createMany({ data: batch.map((patient) => ({ tenantId, patientId: patient.id, channel: 'WHATSAPP', purpose: 'MARKETING', status: 'GRANTED', source: 'MANUAL', evidence: 'Fixture de carga sintética', evidenceType: 'WRITTEN_FORM', evidenceReference: `load-${suffix}-${patient.id}` })) });
    await prisma.outboxMessage.createMany({ data: batch.map((patient) => ({ tenantId, patientId: patient.id, campaignId: campaign.id, purpose: 'MARKETING', channel: 'WHATSAPP', provider: 'META_CLOUD', body: campaign.body, idempotencyKey: `campaign:${campaign.id}:patient:${patient.id}` })) });
  }
  const session = await prisma.authSession.create({ data: { tenantId, userId, membershipId: membership.id, tokenHash: `outbox-load-session-${suffix}`, expiresAt: new Date(Date.now() + 60 * 60_000) } });
  const bearer = await new SignJWT({ tenantId, membershipId: membership.id, sessionId: session.id, role: 'TENANT_ADMIN' }).setProtectedHeader({ alg: 'HS256' }).setSubject(userId).setIssuer('clinic-api').setAudience('clinic-web').setIssuedAt().setExpirationTime('30m').sign(new TextEncoder().encode(apiSecret));
  api = spawn(process.execPath, ['dist/main.js'], { cwd: process.cwd(), stdio: 'ignore', env: { ...process.env, NODE_ENV: 'test', API_PORT: String(apiPort), REDIS_URL: redisUrl, JWT_ACCESS_SECRET: apiSecret, OUTBOX_DISPATCH_MODE: 'dry-run', OUTBOX_MAX_PER_CONNECTION_PER_MINUTE: process.env.OUTBOX_MAX_PER_CONNECTION_PER_MINUTE ?? '10000', OUTBOX_WORKER_CONCURRENCY: process.env.OUTBOX_WORKER_CONCURRENCY ?? '32', OUTBOX_MAX_CONCURRENT_PER_TENANT: process.env.OUTBOX_MAX_CONCURRENT_PER_TENANT ?? '8' } });
  apiPid = api.pid ?? 0;
  await waitForApi();
  const url = `http://127.0.0.1:${apiPort}/api/outbox/dry-run/dispatch`;
  const started = Date.now();
  let queued = 0;
  for (let i = 0; i < Math.ceil(count / 1000); i++) {
    const response = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' }, body: JSON.stringify({ limit: Math.min(1000, count - queued) }) });
    if (!response.ok) throw new Error(`Dispatcher retornou HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`);
    queued += Number((await response.json() as { queued: number }).queued);
  }
  let maxBacklog = count;
  let remaining = count;
  let apiPeakWorkingSet = 0;
  const sampleTimer = setInterval(async () => {
    const current = await prisma.outboxMessage.count({ where: { tenantId, campaignId: campaign.id, status: { in: ['PENDING', 'PROCESSING', 'RETRY'] } } }).catch(() => remaining);
    remaining = current;
    maxBacklog = Math.max(maxBacklog, current);
    const ps = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `(Get-Process -Id ${apiPid} -ErrorAction Stop).WorkingSet64`], { encoding: 'utf8', timeout: 5000 });
    apiPeakWorkingSet = Math.max(apiPeakWorkingSet, Number(ps.stdout.trim()) || 0);
  }, 2000);
  const deadline = Date.now() + 15 * 60_000;
  while (Date.now() < deadline) {
    remaining = await prisma.outboxMessage.count({ where: { tenantId, campaignId: campaign.id, status: { in: ['PENDING', 'PROCESSING', 'RETRY'] } } });
    maxBacklog = Math.max(maxBacklog, remaining);
    if (remaining === 0) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  clearInterval(sampleTimer);
  if (remaining !== 0) throw new Error(`Carga incompleta após 15 minutos: backlog=${remaining}.`);
  const elapsedMs = Date.now() - started;
  const rows = await prisma.outboxMessage.findMany({ where: { tenantId, campaignId: campaign.id }, select: { id: true, status: true, scheduledAt: true } });
  const attempts = await prisma.outboxAttempt.findMany({ where: { tenantId, outboxMessageId: { in: rows.map(({ id }) => id) } }, select: { queueLatencyMs: true, processingMs: true, outcome: true } });
  const [redisMemory, cpu] = await Promise.all([redisCheck.info('memory'), redisCheck.info('cpu')]);
  const usedMemory = Number(redisMemory.match(/used_memory:(\d+)/)?.[1] ?? 0);
  const userCpuSeconds = Number(cpu.match(/used_cpu_user:(\d+(?:\.\d+)?)/)?.[1] ?? 0);
  const counts = Object.fromEntries([...new Set(rows.map(({ status }) => status))].map((status) => [status, rows.filter((row) => row.status === status).length]));
  const report = { test: 'outbox-dry-run', requested: count, directlyQueued: queued, reconcilerRecoveredOrConcurrentEnqueue: Math.max(0, count - queued), processed: counts.SIMULATED ?? 0, counts, failed: counts.FAILED ?? 0, suppressed: counts.SUPPRESSED ?? 0, elapsedSeconds: Number((elapsedMs / 1000).toFixed(2)), throughputPerSecond: Number((count / (elapsedMs / 1000)).toFixed(2)), queueLatencyMs: { p50: percentile(attempts.flatMap((a) => a.queueLatencyMs === null ? [] : [a.queueLatencyMs]), 0.5), p95: percentile(attempts.flatMap((a) => a.queueLatencyMs === null ? [] : [a.queueLatencyMs]), 0.95), p99: percentile(attempts.flatMap((a) => a.queueLatencyMs === null ? [] : [a.queueLatencyMs]), 0.99) }, processingMs: { p50: percentile(attempts.flatMap((a) => a.processingMs === null ? [] : [a.processingMs]), 0.5), p95: percentile(attempts.flatMap((a) => a.processingMs === null ? [] : [a.processingMs]), 0.95), p99: percentile(attempts.flatMap((a) => a.processingMs === null ? [] : [a.processingMs]), 0.99) }, maxBacklog, apiPid, apiPeakWorkingSetBytes: apiPeakWorkingSet || null, loadGeneratorPeakRssBytes: process.memoryUsage().rss, redisUsedMemoryBytes: usedMemory, redisUserCpuSecondsAtEnd: userCpuSeconds, attempts: attempts.length, externalSend: false, unoWrite: false, note: 'Taxa de conexão aumentada apenas para acelerar a simulação local; isso não mede throughput Meta nem homologa limites do provedor.' };
  process.stdout.write(`${JSON.stringify(report)}\n`);
  if (report.processed !== count || report.failed !== 0 || report.suppressed !== 0) throw new Error(`Carga terminou com resultado inesperado: processed=${report.processed}, failed=${report.failed}, suppressed=${report.suppressed}.`);
}

try { await main(); }
finally {
  if (api && api.exitCode === null) { api.kill(); await new Promise((resolve) => api!.once('exit', resolve)); }
  if (tenantId) await prisma.tenant.deleteMany({ where: { id: tenantId } }).catch(() => undefined);
  if (userId) await prisma.user.deleteMany({ where: { id: userId } }).catch(() => undefined);
  if (planId) await prisma.plan.deleteMany({ where: { id: planId } }).catch(() => undefined);
  if (redisCheck) await redisCheck.quit().catch(() => redisCheck!.disconnect());
  await prisma.$disconnect();
}
