import { spawn, spawnSync } from 'node:child_process';
import { createHmac, randomBytes } from 'node:crypto';
import net from 'node:net';
import { PrismaClient } from '@prisma/client';

const apiPort = Number(process.env.REDIS_OUTAGE_TEST_API_PORT ?? 3902);
const redisPort = Number(new URL(process.env.REDIS_URL ?? 'redis://localhost:6380').port || 6379);
const redisHost = new URL(process.env.REDIS_URL ?? 'redis://localhost:6380').hostname;
const appSecret = 'local-only-redis-outage-test-secret';
const prisma = new PrismaClient();
const suffix = `${Date.now()}-${randomBytes(4).toString('hex')}`;
let api: ReturnType<typeof spawn> | undefined;
let redisStopped = false;
let tenantId = '';
let userId = '';
let planId = '';

function redisAcceptingConnections(timeoutMs = 400): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: redisHost, port: redisPort, timeout: timeoutMs });
    const timer = setTimeout(() => done(false), timeoutMs);
    const done = (open: boolean) => { clearTimeout(timer); socket.destroy(); resolve(open); };
    socket.once('connect', () => socket.write('*1\r\n$4\r\nPING\r\n'));
    socket.once('data', (data) => done(data.toString().includes('+PONG')));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

async function waitForRedis(open: boolean, timeoutMs = 30_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (await redisAcceptingConnections() === open) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Redis não ficou ${open ? 'disponível' : 'indisponível'} dentro de ${timeoutMs}ms.`);
}

function compose(action: 'stop' | 'start') {
  const result = spawnSync('docker', ['compose', '--project-directory', '..', '-f', '../docker-compose.yml', action, 'redis'], { cwd: process.cwd(), encoding: 'utf8', timeout: 30_000 });
  if (result.status !== 0) throw new Error(`docker compose ${action} redis falhou: ${(result.stderr || result.stdout).slice(0, 1000)}`);
}

async function waitForApi() {
  const until = Date.now() + 30_000;
  while (Date.now() < until) {
    if (api?.exitCode !== null && api?.exitCode !== undefined) throw new Error(`API encerrou durante startup (exit ${api.exitCode}).`);
    try {
      const response = await fetch(`http://127.0.0.1:${apiPort}/api/meta/webhook?hub.mode=subscribe&hub.verify_token=outage-check&hub.challenge=ok`);
      if (response.status === 200 && await response.text() === 'ok') return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('API não iniciou a tempo.');
}

async function postWebhook(url: string, secret: string, payload: object) {
  const raw = JSON.stringify(payload);
  const signature = createHmac('sha256', secret).update(raw).digest('hex');
  return fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': `sha256=${signature}` }, body: raw, signal: AbortSignal.timeout(10_000) });
}

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Este teste só pode executar fora de produção.');
  await waitForRedis(true);
  const plan = await prisma.plan.create({ data: { code: `OUTAGE-${suffix}`, name: 'Redis outage fixture', priceCents: 0, messageLimitPerCycle: 10, userLimit: 10, unitLimit: 3, connectionLimit: 3, activeAutomationLimit: 5, campaignLimitPerCycle: 5 } });
  planId = plan.id;
  const tenant = await prisma.tenant.create({ data: { name: `Redis outage ${suffix}`, slug: `redis-outage-${suffix}` } });
  tenantId = tenant.id;
  const unit = await prisma.unit.create({ data: { tenantId: tenant.id, name: 'Outage test', slug: 'outage-test' } });
  const user = await prisma.user.create({ data: { email: `outage-${suffix}@example.test`, displayName: 'Redis outage test', passwordHash: 'not-used' } });
  userId = user.id;
  const membership = await prisma.membership.create({ data: { tenantId: tenant.id, userId: user.id, role: 'TENANT_ADMIN' } });
  await prisma.unitMembership.create({ data: { tenantId: tenant.id, membershipId: membership.id, unitId: unit.id } });
  await prisma.subscription.create({ data: { tenantId: tenant.id, planId: plan.id, status: 'TRIAL', cycleStartsAt: new Date(Date.now() - 60_000), cycleEndsAt: new Date(Date.now() + 30 * 86400_000) } });
  const phone = `551166${Date.now().toString().slice(-8)}`;
  await prisma.patient.create({ data: { tenantId: tenant.id, unitId: unit.id, fullName: 'Paciente de teste Redis', phone, phoneNormalized: phone } });
  const connection = await prisma.metaConnection.create({ data: { tenantId: tenant.id, unitId: unit.id, wabaId: `outage-waba-${suffix}`, phoneNumberId: `outage-phone-${suffix}`, accessTokenEncrypted: 'local-test-placeholder', status: 'CONNECTED' } });
  process.stdout.write('phase=fixtures_ready\n');

  api = spawn(process.execPath, ['dist/main.js'], {
    cwd: process.cwd(), stdio: 'ignore',
    env: { ...process.env, NODE_ENV: 'test', API_PORT: String(apiPort), REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:6380', OUTBOX_DISPATCH_MODE: 'disabled', META_APP_SECRET: appSecret, META_WEBHOOK_VERIFY_TOKEN: 'outage-check' },
  });
  await waitForApi();
  process.stdout.write('phase=api_ready\n');
  const messageId = `wamid.redis-outage.${suffix}`;
  const payload = { object: 'whatsapp_business_account', entry: [{ id: connection.wabaId, changes: [{ field: 'messages', value: { metadata: { phone_number_id: connection.phoneNumberId }, messages: [{ id: messageId, from: phone, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: 'mensagem de teste local' } }] } }] }] };
  const url = `http://127.0.0.1:${apiPort}/api/meta/webhook`;
  const outageStarted = Date.now();
  compose('stop');
  redisStopped = true;
  process.stdout.write('phase=redis_stopped\n');
  await waitForRedis(false);
  process.stdout.write('phase=redis_unavailable_confirmed\n');
  const failedResponse = await postWebhook(url, appSecret, payload);
  process.stdout.write(`phase=webhook_response status=${failedResponse.status}\n`);
  const persisted = await prisma.metaWebhookEvent.findFirst({ where: { tenantId: tenant.id, connectionId: connection.id, providerMessageId: messageId } });
  if (!persisted) throw new Error('O webhook falhou e o evento não está no PostgreSQL.');
  const statusWhileDown = persisted.status;
  const unavailableResponseStatus = failedResponse.status;
  compose('start');
  redisStopped = false;
  await waitForRedis(true);
  process.stdout.write('phase=redis_recovered\n');
  const recoveryStarted = Date.now();
  const duplicateResponse = await postWebhook(url, appSecret, payload);
  if (!duplicateResponse.ok) throw new Error(`Reenvio duplicado após recuperação retornou HTTP ${duplicateResponse.status}.`);
  let event = persisted;
  while (Date.now() - recoveryStarted < 30_000 && !['PROCESSED', 'UNMATCHED', 'FAILED'].includes(event.status)) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    event = await prisma.metaWebhookEvent.findUniqueOrThrow({ where: { id: persisted.id } });
  }
  const messageCount = await prisma.message.count({ where: { tenantId: tenant.id, provider: 'META_CLOUD', providerMessageId: messageId } });
  const eventCount = await prisma.metaWebhookEvent.count({ where: { tenantId: tenant.id, connectionId: connection.id, providerMessageId: messageId } });
  if (event.status !== 'PROCESSED' || messageCount !== 1 || eventCount !== 1) throw new Error(`Recuperação inválida: event=${event.status}, messages=${messageCount}, events=${eventCount}.`);
  process.stdout.write(`${JSON.stringify({ test: 'redis-outage-webhook-persistence-recovery', persistedBeforeRecovery: true, statusWhileRedisDown: statusWhileDown, httpWhileRedisDown: unavailableResponseStatus, duplicateReplayHttp: duplicateResponse.status, finalEventStatus: event.status, persistedEventCount: eventCount, inboundMessageCount: messageCount, redisOutageSeconds: Number(((Date.now() - outageStarted) / 1000).toFixed(2)), recoverySeconds: Number(((Date.now() - recoveryStarted) / 1000).toFixed(2)), externalSend: false, unoWrite: false })}\n`);
}

try {
  await main();
} finally {
  if (redisStopped) { try { compose('start'); } catch {} }
  if (api && api.exitCode === null) { api.kill(); await new Promise((resolve) => api!.once('exit', resolve)); }
  if (tenantId) await prisma.tenant.deleteMany({ where: { id: tenantId } }).catch(() => undefined);
  if (userId) await prisma.user.deleteMany({ where: { id: userId } }).catch(() => undefined);
  if (planId) await prisma.plan.deleteMany({ where: { id: planId } }).catch(() => undefined);
  await prisma.$disconnect();
}
