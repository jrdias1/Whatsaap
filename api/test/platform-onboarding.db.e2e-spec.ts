import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient, UserRole } from '@prisma/client';
import { createHmac, randomBytes } from 'node:crypto';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { TenantContextInterceptor } from '../src/security/tenant-context.interceptor.js';
import { encryptSecret } from '../src/security/secret-crypto.js';
import { decodeBase32 } from '../src/auth/totp.js';

describe('Platform onboarding and administration (PostgreSQL e2e)', () => {
  const db = new PrismaClient();
  const suffix = `${Date.now()}-${randomBytes(4).toString('hex')}`;
  const platformSlug = `platform-${suffix}`;
  const adminEmail = `platform-${suffix}@example.test`;
  const clinicAdminEmail = `clinic-${suffix}@example.test`;
  const password = 'Platform-test-password-2026!';
  const planCode = `PLATFORM-E2E-${suffix}`;
  const totpSecret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  const idempotencyKey = `provision-${suffix}`;
  let app: INestApplication;
  let platformTenantId: string;
  let planId: string;
  let platformToken = '';
  let consumedPlatformOtp = '';
  let provisionedTenantId = '';
  let provisionedUnitId = '';
  let clinicToken = '';
  let inviteToken = '';

  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET = 'platform-e2e-jwt-secret-over-32-characters';
    process.env.INTEGRATION_ENCRYPTION_KEY = 'd'.repeat(64);
    const platformTenant = await db.tenant.create({ data: { name: `Platform test ${suffix}`, slug: platformSlug, status: 'ACTIVE' } });
    platformTenantId = platformTenant.id;
    const unit = await db.unit.create({ data: { tenantId: platformTenant.id, name: 'Administração', slug: 'admin' } });
    const user = await db.user.create({ data: { email: adminEmail, displayName: 'Platform E2E', passwordHash: await bcrypt.hash(password, 4) } });
    const membership = await db.membership.create({ data: { tenantId: platformTenant.id, userId: user.id, role: UserRole.PLATFORM_SUPERADMIN, status: 'ACTIVE' } });
    await db.unitMembership.create({ data: { tenantId: platformTenant.id, membershipId: membership.id, unitId: unit.id } });
    await db.platformAdminIdentity.create({ data: { userId: user.id, totpSecretEncrypted: encryptSecret(totpSecret) } });
    const plan = await db.plan.create({ data: { code: planCode.toLowerCase(), name: 'Platform E2E', priceCents: 9700, patientLimit: 20, messageLimitPerCycle: 50, userLimit: 5, unitLimit: 2, connectionLimit: 1, activeAutomationLimit: 2, campaignLimitPerCycle: 3 } });
    planId = plan.id;
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication(); app.useGlobalInterceptors(app.get(TenantContextInterceptor)); app.setGlobalPrefix('api'); await app.init();
    consumedPlatformOtp = totpAt(totpSecret, Date.now());
    const login = await request(app.getHttpServer()).post('/api/auth/login').send({ email: adminEmail, password, tenantSlug: platformSlug, otp: consumedPlatformOtp });
    expect(login.status).toBe(201);
    platformToken = login.body.accessToken;
    await request(app.getHttpServer()).get('/api/units').set('Authorization', `Bearer ${platformToken}`).expect(200);
  });

  afterAll(async () => {
    if (provisionedTenantId) await db.tenant.deleteMany({ where: { id: provisionedTenantId } });
    if (platformTenantId) await db.tenant.deleteMany({ where: { id: platformTenantId } });
    await db.user.deleteMany({ where: { email: { in: [adminEmail, clinicAdminEmail] } } });
    if (planId) await db.plan.deleteMany({ where: { id: planId } });
    await app?.close(); await db.$disconnect();
  });

  it('requires platform identity and TOTP and provisions clinic, unit, trial, and local first-admin invitation idempotently', async () => {
    const noOtp = await request(app.getHttpServer()).post('/api/auth/login').send({ email: adminEmail, password, tenantSlug: platformSlug });
    expect(noOtp.status).toBe(401);
    const replayedOtp = await request(app.getHttpServer()).post('/api/auth/login').send({ email: adminEmail, password, tenantSlug: platformSlug, otp: consumedPlatformOtp });
    expect(replayedOtp.status).toBe(401);

    const input = { idempotencyKey, name: `Clínica ${suffix}`, slug: `clinic-${suffix}`, unitName: 'Unidade Centro', unitSlug: 'centro', adminName: 'Primeiro Admin', adminEmail: clinicAdminEmail, planCode: planCode.toUpperCase(), trialDays: 21 };
    expect((await request(app.getHttpServer()).post('/api/platform/tenants').set('Authorization', `Bearer ${platformToken}`).send({ ...input, planCode: `MISSING-${suffix}` })).status).toBe(400);
    await db.plan.update({ where: { id: planId }, data: { enabled: false } });
    expect((await request(app.getHttpServer()).post('/api/platform/tenants').set('Authorization', `Bearer ${platformToken}`).send(input)).status).toBe(400);
    await db.plan.update({ where: { id: planId }, data: { enabled: true } });
    const created = await request(app.getHttpServer()).post('/api/platform/tenants').set('Authorization', `Bearer ${platformToken}`).send(input);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.alreadyProvisioned).toBe(false);
    expect(created.body.invitation.delivery).toBe('LOCAL_ONLY');
    expect(created.body.invitation.token).toBeTruthy();
    inviteToken = created.body.invitation.token;
    provisionedTenantId = created.body.tenant.id;
    provisionedUnitId = created.body.invitation.unit.id;
    const duplicate = await request(app.getHttpServer()).post('/api/platform/tenants').set('Authorization', `Bearer ${platformToken}`).send(input);
    expect(duplicate.status).toBe(201);
    expect(duplicate.body.alreadyProvisioned).toBe(true);
    expect(duplicate.body.invitation).toBeNull();
    expect(await db.tenant.count({ where: { provisioningKey: idempotencyKey } })).toBe(1);
    expect(await db.unit.count({ where: { tenantId: provisionedTenantId } })).toBe(1);
    expect(await db.subscription.count({ where: { tenantId: provisionedTenantId } })).toBe(1);
    expect(await db.userInvitation.count({ where: { tenantId: provisionedTenantId } })).toBe(1);
  });

  it('protects tenant scope, applies per-tenant overrides, and suspends without deleting data or resuming old jobs', async () => {
    const token = inviteToken;
    expect((await request(app.getHttpServer()).post('/api/auth/accept-invitation').send({ token, password: 'New-clinic-user-Password-2026!' })).status).toBe(201);
    const tenantLogin = await request(app.getHttpServer()).post('/api/auth/login').send({ email: clinicAdminEmail, password: 'New-clinic-user-Password-2026!', tenantSlug: `clinic-${suffix}` });
    expect(tenantLogin.status).toBe(201); clinicToken = tenantLogin.body.accessToken;
    expect((await request(app.getHttpServer()).get(`/api/platform/tenants/${provisionedTenantId}`).set('Authorization', `Bearer ${clinicToken}`)).status).toBe(403);
    const escalation = await request(app.getHttpServer()).post('/api/users/invitations').set('Authorization', `Bearer ${clinicToken}`).send({ email: `escalate-${suffix}@example.test`, displayName: 'Escalation', role: 'PLATFORM_SUPERADMIN', unitIds: [provisionedUnitId] });
    expect(escalation.status).toBe(404);
    const update = await request(app.getHttpServer()).patch(`/api/platform/tenants/${provisionedTenantId}/limits`).set('Authorization', `Bearer ${platformToken}`).send({ userLimit: 1, patientLimit: 0 });
    expect(update.status).toBe(200);
    const usage = await request(app.getHttpServer()).get('/api/usage').set('Authorization', `Bearer ${clinicToken}`);
    expect(usage.body.usage.patients.limit).toBe(0);
    const overLimit = await request(app.getHttpServer()).post('/api/users/members').set('Authorization', `Bearer ${clinicToken}`).send({ email: `over-limit-${suffix}@example.test`, displayName: 'Over limit', role: 'OPERATOR', password: 'Over-limit-Test-2026!', unitIds: [provisionedUnitId] });
    expect(overLimit.status).toBe(402);
    const suspend = await request(app.getHttpServer()).patch(`/api/platform/tenants/${provisionedTenantId}/status`).set('Authorization', `Bearer ${platformToken}`).send({ status: 'SUSPENDED', reason: 'Teste administrativo' });
    expect(suspend.status).toBe(200);
    expect((await db.tenant.findUnique({ where: { id: provisionedTenantId }, select: { status: true } }))?.status).toBe('SUSPENDED');
    expect(await db.unit.count({ where: { tenantId: provisionedTenantId } })).toBe(1);
    expect((await request(app.getHttpServer()).get('/api/usage').set('Authorization', `Bearer ${clinicToken}`)).status).toBe(401);
    expect(await db.auditEvent.count({ where: { tenantId: provisionedTenantId, action: 'PLATFORM_TENANT_SUSPENDED' } })).toBe(1);
    const activate = await request(app.getHttpServer()).patch(`/api/platform/tenants/${provisionedTenantId}/status`).set('Authorization', `Bearer ${platformToken}`).send({ status: 'ACTIVE', reason: 'Plano verificado' });
    expect(activate.status).toBe(200);
    expect((await request(app.getHttpServer()).get('/api/usage').set('Authorization', `Bearer ${clinicToken}`)).status).toBe(401);
    expect((await db.tenant.findUnique({ where: { id: provisionedTenantId }, select: { status: true } }))?.status).toBe('TRIAL');
  });
});

function totpAt(secret: string, now: number) {
  const step = BigInt(Math.floor(now / 30_000)), counter = Buffer.alloc(8); counter.writeBigUInt64BE(step);
  const digest = createHmac('sha1', decodeBase32(secret)).update(counter).digest(), index = digest[digest.length - 1]! & 15;
  const binary = ((digest[index]! & 127) << 24) | (digest[index + 1]! << 16) | (digest[index + 2]! << 8) | digest[index + 3]!;
  return String(binary % 1_000_000).padStart(6, '0');
}
