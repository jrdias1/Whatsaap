import { PrismaClient } from '@prisma/client';
import { SignJWT } from 'jose';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const prisma = new PrismaClient();
const suffix = `${Date.now()}-${randomBytes(4).toString('hex')}`;
const port = Number(process.env.OUTBOX_RESTART_TEST_API_PORT ?? 3904);
const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6380';
const jwtSecret = 'local-outbox-worker-restart-secret-at-least-32';
let tenantId = '';
let userId = '';
let planId = '';
let api: ReturnType<typeof spawn> | undefined;

async function startApi(delayMs: number) {
  api = spawn(process.execPath, ['dist/main.js'], { cwd: process.cwd(), stdio: 'ignore', env: { ...process.env, NODE_ENV: 'test', API_PORT: String(port), REDIS_URL: redisUrl, JWT_ACCESS_SECRET: jwtSecret, OUTBOX_DISPATCH_MODE: 'dry-run', OUTBOX_DRY_RUN_PROCESSING_DELAY_MS: String(delayMs), OUTBOX_DISPATCH_LEASE_MS: '2000', OUTBOX_TENANT_SLOT_TTL_MS: '1000', OUTBOX_JOB_LOCK_DURATION_MS: '2000', OUTBOX_JOB_STALLED_INTERVAL_MS: '500', OUTBOX_WORKER_CONCURRENCY: '1', OUTBOX_MAX_CONCURRENT_PER_TENANT: '1', OUTBOX_MAX_PER_CONNECTION_PER_MINUTE: '10000' } });
  const child = api;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`API encerrou antes de iniciar (exit ${child.exitCode}).`);
    try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) return child; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('API não ficou saudável a tempo.');
}

async function stopApi(child: ReturnType<typeof spawn>) {
  if (child.exitCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  child.kill();
  await Promise.race([exited, new Promise<void>((resolve) => setTimeout(resolve, 5000))]);
}

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Este teste só pode executar fora de produção.');
  const plan = await prisma.plan.create({ data: { code: `RESTART-${suffix}`, name: 'Worker restart fixture', priceCents: 0, messageLimitPerCycle: 5, userLimit: 3, unitLimit: 1, connectionLimit: 1, activeAutomationLimit: 1, campaignLimitPerCycle: 1 } });
  planId = plan.id;
  const tenant = await prisma.tenant.create({ data: { name: `Worker restart ${suffix}`, slug: `worker-restart-${suffix}` } });
  tenantId = tenant.id;
  const unit = await prisma.unit.create({ data: { tenantId, name: 'Worker restart', slug: 'worker-restart' } });
  const user = await prisma.user.create({ data: { email: `worker-restart-${suffix}@example.test`, displayName: 'Worker restart test', passwordHash: 'not-used' } });
  userId = user.id;
  const membership = await prisma.membership.create({ data: { tenantId, userId, role: 'TENANT_ADMIN' } });
  await prisma.unitMembership.create({ data: { tenantId, membershipId: membership.id, unitId: unit.id } });
  const cycleStartsAt = new Date(Date.now() - 60_000);
  const cycleEndsAt = new Date(Date.now() + 30 * 86400_000);
  const subscription = await prisma.subscription.create({ data: { tenantId, planId, status: 'TRIAL', cycleStartsAt, cycleEndsAt } });
  const phone = `551188${Date.now().toString().slice(-8)}`;
  const patient = await prisma.patient.create({ data: { tenantId, unitId: unit.id, fullName: 'Paciente de recuperação', phone, phoneNormalized: phone } });
  await prisma.consentPreference.create({ data: { tenantId, patientId: patient.id, channel: 'WHATSAPP', purpose: 'MARKETING', status: 'GRANTED', source: 'MANUAL', evidence: 'Fixture de teste', evidenceType: 'WRITTEN_FORM', evidenceReference: `restart-consent-${suffix}` } });
  await prisma.metaConnection.create({ data: { tenantId, unitId: unit.id, wabaId: `restart-waba-${suffix}`, phoneNumberId: `restart-phone-${suffix}`, accessTokenEncrypted: 'local-test-placeholder', status: 'CONNECTED' } });
  const campaign = await prisma.campaign.create({ data: { tenantId, name: 'Interrupção worker dry-run', status: 'APPROVED', body: 'Mensagem local de teste.' } });
  await prisma.usageEntry.create({ data: { tenantId, subscriptionId: subscription.id, metric: 'messages', quantity: 1, idempotencyKey: `campaign:${campaign.id}:messages`, cycleStartsAt, cycleEndsAt } });
  const outbox = await prisma.outboxMessage.create({ data: { tenantId, patientId: patient.id, campaignId: campaign.id, purpose: 'MARKETING', channel: 'WHATSAPP', provider: 'META_CLOUD', body: campaign.body, idempotencyKey: `restart:${campaign.id}:${patient.id}` } });
  const session = await prisma.authSession.create({ data: { tenantId, userId, membershipId: membership.id, tokenHash: `worker-restart-session-${suffix}`, expiresAt: new Date(Date.now() + 60 * 60_000) } });
  const bearer = await new SignJWT({ tenantId, membershipId: membership.id, sessionId: session.id, role: 'TENANT_ADMIN' }).setProtectedHeader({ alg: 'HS256' }).setSubject(userId).setIssuer('clinic-api').setAudience('clinic-web').setIssuedAt().setExpirationTime('30m').sign(new TextEncoder().encode(jwtSecret));

  const firstApi = await startApi(30_000);
  const response = await fetch(`http://127.0.0.1:${port}/api/outbox/dry-run/dispatch`, { method: 'POST', headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' }, body: JSON.stringify({ limit: 1 }) });
  if (!response.ok) throw new Error(`Dispatcher inicial retornou HTTP ${response.status}.`);
  const processingDeadline = Date.now() + 10_000;
  let row = await prisma.outboxMessage.findUniqueOrThrow({ where: { id: outbox.id } });
  while (Date.now() < processingDeadline && row.status !== 'PROCESSING') {
    await new Promise((resolve) => setTimeout(resolve, 50));
    row = await prisma.outboxMessage.findUniqueOrThrow({ where: { id: outbox.id } });
  }
  if (row.status !== 'PROCESSING') throw new Error(`Job não chegou a PROCESSING; estado=${row.status}.`);
  const interruptedAt = Date.now();
  await stopApi(firstApi);
  const secondApi = await startApi(0);
  let recoveryStatus = await prisma.outboxMessage.findUniqueOrThrow({ where: { id: outbox.id } });
  const recoveryDeadline = Date.now() + 45_000;
  while (Date.now() < recoveryDeadline && recoveryStatus.status !== 'SIMULATED') {
    await new Promise((resolve) => setTimeout(resolve, 150));
    recoveryStatus = await prisma.outboxMessage.findUniqueOrThrow({ where: { id: outbox.id } });
  }
  if (recoveryStatus.status !== 'SIMULATED') throw new Error(`Recovery não concluiu: ${recoveryStatus.status} / ${recoveryStatus.lastError ?? ''}`);
  const [messageCount, receiptCount, attempts] = await Promise.all([
    prisma.message.count({ where: { tenantId, idempotencyKey: `outbox:${outbox.id}` } }),
    prisma.dryRunProviderReceipt.count({ where: { tenantId, outboxMessageId: outbox.id } }),
    prisma.outboxAttempt.findMany({ where: { tenantId, outboxMessageId: outbox.id }, orderBy: { attemptNumber: 'asc' }, select: { attemptNumber: true, cause: true, outcome: true } }),
  ]);
  if (messageCount !== 1 || receiptCount !== 1) throw new Error(`Efeito duplicado/ausente: messages=${messageCount}, receipts=${receiptCount}.`);
  process.stdout.write(`${JSON.stringify({ test: 'outbox-worker-process-interruption-and-restart', interruptedAfterClaim: true, finalStatus: recoveryStatus.status, attempts, messageCount, receiptCount, recoverySeconds: Number(((Date.now() - interruptedAt) / 1000).toFixed(2)), externalSend: false, unoWrite: false })}\n`);
  await stopApi(secondApi);
}

try { await main(); }
finally {
  if (api && api.exitCode === null) await stopApi(api);
  if (tenantId) await prisma.tenant.deleteMany({ where: { id: tenantId } }).catch(() => undefined);
  if (userId) await prisma.user.deleteMany({ where: { id: userId } }).catch(() => undefined);
  if (planId) await prisma.plan.deleteMany({ where: { id: planId } }).catch(() => undefined);
  await prisma.$disconnect();
}
