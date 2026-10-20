import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient, UserRole } from '@prisma/client';
import { createHmac, randomBytes } from 'node:crypto';
import { SignJWT } from 'jose';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { TenantContextInterceptor } from '../src/security/tenant-context.interceptor.js';
import { encryptSecret } from '../src/security/secret-crypto.js';
import { decodeBase32 } from '../src/auth/totp.js';

describe('Senha provisória obrigatória no primeiro acesso (PostgreSQL)', () => {
  const db = new PrismaClient();
  const suffix = `${Date.now()}-${randomBytes(4).toString('hex')}`;
  const jwtSecret = 'first-login-password-e2e-secret-at-least-32';
  const tempPassword = 'Temporary-e2e-2026!';
  const finalPassword = 'Final-password-e2e-2026!';
  let app: INestApplication;
  let tenantId: string;
  let otherTenantId: string;
  let tenantSlug: string;
  let unitId: string;
  let otherUnitId: string;
  let platformTenantId: string;
  let platformSlug: string;
  let planId: string;
  let adminId: string;
  let adminMembershipId: string;
  let adminToken: string;
  let adminSessionId: string;
  let operatorMembershipId: string;
  let operatorId: string;
  let operatorToken = '';
  let managerMembershipId: string;
  let managerToken = '';
  let loginAddress = 20;
  const disposableEmails: string[] = [];

  async function signToken(userId: string, membershipId: string, sessionId: string, tenant = tenantId, role = UserRole.TENANT_ADMIN) {
    return new SignJWT({ tenantId: tenant, membershipId, sessionId, role })
      .setProtectedHeader({ alg: 'HS256' }).setSubject(userId).setIssuer('clinic-api').setAudience('clinic-web')
      .setIssuedAt().setExpirationTime('15m').sign(new TextEncoder().encode(jwtSecret));
  }

  async function login(email: string, password: string, status = 201) {
    loginAddress = (loginAddress % 200) + 1;
    return request(app.getHttpServer()).post('/api/auth/login').set('x-forwarded-for', `198.51.100.${loginAddress}`).send({ email, password, tenantSlug }).expect(status);
  }

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_ACCESS_SECRET = jwtSecret;
    process.env.INTEGRATION_ENCRYPTION_KEY = 'f'.repeat(64);
    tenantSlug = `first-login-${suffix}`;
    const [tenant, otherTenant, platformTenant] = await Promise.all([
      db.tenant.create({ data: { name: `First login ${suffix}`, slug: tenantSlug, status: 'TRIAL' } }),
      db.tenant.create({ data: { name: `Other tenant ${suffix}`, slug: `first-login-other-${suffix}`, status: 'TRIAL' } }),
      db.tenant.create({ data: { name: `Platform ${suffix}`, slug: `first-login-platform-${suffix}`, status: 'ACTIVE' } }),
    ]);
    tenantId = tenant.id; otherTenantId = otherTenant.id; platformTenantId = platformTenant.id; platformSlug = platformTenant.slug;
    const plan = await db.plan.create({ data: { code: `FL-${suffix}`.toUpperCase(), name: 'First login test', priceCents: 0, patientLimit: 20, messageLimitPerCycle: 100, userLimit: 20, unitLimit: 5, connectionLimit: 2, activeAutomationLimit: 5, campaignLimitPerCycle: 5 } });
    planId = plan.id;
    const now = new Date();
    await Promise.all([tenantId, otherTenantId].map((id) => db.subscription.create({ data: { tenantId: id, planId, status: 'TRIAL', cycleStartsAt: new Date(now.getTime() - 60_000), cycleEndsAt: new Date(now.getTime() + 30 * 86400000) } })));
    const [unit, otherUnit] = await Promise.all([
      db.unit.create({ data: { tenantId, name: 'Unidade permitida', slug: `allowed-${suffix}` } }),
      db.unit.create({ data: { tenantId, name: 'Unidade restrita', slug: `restricted-${suffix}` } }),
    ]);
    unitId = unit.id; otherUnitId = otherUnit.id;
    await db.unit.create({ data: { tenantId: platformTenantId, name: 'Platform test', slug: `platform-${suffix}` } });
    const adminEmail = `first-login-admin-${suffix}@example.test`; disposableEmails.push(adminEmail);
    const admin = await db.user.create({ data: { email: adminEmail, displayName: 'Admin E2E', passwordHash: await bcrypt.hash('Admin-e2e-password-2026!', 4) } });
    adminId = admin.id;
    const adminMembership = await db.membership.create({ data: { tenantId, userId: adminId, role: UserRole.TENANT_ADMIN, status: 'ACTIVE' } });
    adminMembershipId = adminMembership.id;
    const adminSession = await db.authSession.create({ data: { tenantId, userId: adminId, membershipId: adminMembershipId, tokenHash: `first-login-admin-${suffix}`, expiresAt: new Date(Date.now() + 60 * 60_000) } });
    adminSessionId = adminSession.id;
    adminToken = await signToken(adminId, adminMembershipId, adminSessionId);
    await db.unitMembership.createMany({ data: [unitId, otherUnitId].map((id) => ({ tenantId, membershipId: adminMembershipId, unitId: id })) });
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication(); app.getHttpAdapter().getInstance().set('trust proxy', 'loopback'); app.useGlobalInterceptors(app.get(TenantContextInterceptor)); app.setGlobalPrefix('api'); await app.init();
  });

  afterAll(async () => {
    await app?.close();
    if (tenantId || otherTenantId) await db.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenantId].filter(Boolean) } } });
    if (disposableEmails.length) await db.user.deleteMany({ where: { email: { in: disposableEmails } } });
    if (planId) await db.plan.deleteMany({ where: { id: planId } });
    await db.$disconnect();
  }, 30_000);

  it('creates an operator with a provisional password, blocks operations, changes it and enforces the assigned unit scope', async () => {
    const email = `operator-${suffix}@example.test`; disposableEmails.push(email);
    const created = await request(app.getHttpServer()).post('/api/users/members').set('Authorization', `Bearer ${adminToken}`)
      .send({ email, displayName: 'Operador E2E', role: 'OPERATOR', password: tempPassword, unitIds: [unitId] }).expect(201);
    expect(created.body.user).not.toHaveProperty('passwordHash');
    expect(created.body.user).not.toHaveProperty('password');
    expect(created.body.user.mustChangePassword).toBe(true);
    operatorId = created.body.user.id; operatorMembershipId = created.body.id;

    const authenticated = await login(email, tempPassword);
    operatorToken = authenticated.body.accessToken;
    await request(app.getHttpServer()).get('/api/auth/me').set('Authorization', `Bearer ${operatorToken}`).expect(200).expect(({ body }) => expect(body.mustChangePassword).toBe(true));
    const refreshCookie = authenticated.headers['set-cookie']?.[0]?.split(';')[0];
    expect(refreshCookie).toMatch(/^clinic_refresh=/);
    const refreshed = await request(app.getHttpServer()).post('/api/auth/refresh').set('Cookie', refreshCookie!).expect(201);
    operatorToken = refreshed.body.accessToken;
    await request(app.getHttpServer()).get('/api/appointments').set('Authorization', `Bearer ${refreshed.body.accessToken}`).expect(403);
    for (const path of ['/api/units', '/api/patients', '/api/appointments', '/api/tasks', '/api/reports/overview', '/api/settings/tenant']) {
      await request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${operatorToken}`).expect(403);
    }
    await request(app.getHttpServer()).post('/api/users/members').set('Authorization', `Bearer ${operatorToken}`).send({}).expect(403);
    await request(app.getHttpServer()).patch('/api/auth/password').set('Authorization', `Bearer ${operatorToken}`).send({ currentPassword: tempPassword, newPassword: tempPassword }).expect(400);
    await request(app.getHttpServer()).patch('/api/auth/password').set('Authorization', `Bearer ${operatorToken}`).send({ currentPassword: tempPassword, newPassword: 'short' }).expect(400);
    await request(app.getHttpServer()).patch('/api/auth/password').set('Authorization', `Bearer ${operatorToken}`).send({ currentPassword: tempPassword, newPassword: finalPassword }).expect(200);
    await login(email, tempPassword, 401);
    const finalLogin = await login(email, finalPassword);
    operatorToken = finalLogin.body.accessToken;
    const allowedUnits = await request(app.getHttpServer()).get('/api/units').set('Authorization', `Bearer ${operatorToken}`).expect(200);
    expect(allowedUnits.body.map((row: { id: string }) => row.id)).toEqual([unitId]);
  });

  it('applies the same required change to managers and makes admin reset revoke sessions and require another change', async () => {
    const email = `manager-${suffix}@example.test`; disposableEmails.push(email);
    const created = await request(app.getHttpServer()).post('/api/users/members').set('Authorization', `Bearer ${adminToken}`)
      .send({ email, displayName: 'Gerente E2E', role: 'UNIT_MANAGER', password: tempPassword, unitIds: [unitId] }).expect(201);
    expect(created.body.role).toBe('UNIT_MANAGER'); expect(created.body.user.mustChangePassword).toBe(true);
    managerMembershipId = created.body.id;
    managerToken = (await login(email, tempPassword)).body.accessToken;
    await request(app.getHttpServer()).get('/api/patients').set('Authorization', `Bearer ${managerToken}`).expect(403);
    await request(app.getHttpServer()).patch('/api/auth/password').set('Authorization', `Bearer ${managerToken}`).send({ currentPassword: tempPassword, newPassword: finalPassword }).expect(200);
    managerToken = (await login(email, finalPassword)).body.accessToken;

    const beforeReset = await login(`operator-${suffix}@example.test`, finalPassword);
    const oldToken = beforeReset.body.accessToken;
    const resetPassword = 'Reset-e2e-password-2026!';
    await request(app.getHttpServer()).patch(`/api/users/${operatorMembershipId}/password`).set('Authorization', `Bearer ${adminToken}`).send({ password: resetPassword }).expect(200);
    await request(app.getHttpServer()).get('/api/auth/me').set('Authorization', `Bearer ${oldToken}`).expect(401);
    expect((await db.user.findUniqueOrThrow({ where: { id: operatorId } })).mustChangePassword).toBe(true);
    const resetLogin = await login(`operator-${suffix}@example.test`, resetPassword);
    await request(app.getHttpServer()).get('/api/appointments').set('Authorization', `Bearer ${resetLogin.body.accessToken}`).expect(403);
    await request(app.getHttpServer()).patch(`/api/users/${managerMembershipId}/password`).set('Authorization', `Bearer ${managerToken}`).send({ password: 'another-temp-password-2026!' }).expect(403);
  });

  it('does not link an existing global identity, permits no cross-tenant reset, and serializes racing password changes', async () => {
    const linkedEmail = `linked-${suffix}@example.test`; disposableEmails.push(linkedEmail);
    const originalHash = await bcrypt.hash('Existing-account-password-2026!', 4);
    const existing = await db.user.create({ data: { email: linkedEmail, displayName: 'Conta em outro tenant', passwordHash: originalHash } });
    await db.membership.create({ data: { tenantId: otherTenantId, userId: existing.id, role: UserRole.TENANT_ADMIN, status: 'ACTIVE' } });
    await request(app.getHttpServer()).post('/api/users/members').set('Authorization', `Bearer ${adminToken}`).send({ email: linkedEmail, displayName: 'Tentativa', role: 'OPERATOR', password: tempPassword, unitIds: [unitId] }).expect(409);
    expect((await db.user.findUniqueOrThrow({ where: { id: existing.id } })).passwordHash).toBe(originalHash);
    const localMembership = await db.membership.create({ data: { tenantId, userId: existing.id, role: UserRole.OPERATOR, status: 'ACTIVE' } });
    await request(app.getHttpServer()).patch(`/api/users/${localMembership.id}/password`).set('Authorization', `Bearer ${adminToken}`).send({ password: 'Attempted-reset-password-2026!' }).expect(409);

    const resetOne = 'Concurrent-admin-reset-one-2026!';
    const resetTwo = 'Concurrent-admin-reset-two-2026!';
    const [first, second] = await Promise.all([
      request(app.getHttpServer()).patch(`/api/users/${operatorMembershipId}/password`).set('Authorization', `Bearer ${adminToken}`).send({ password: resetOne }),
      request(app.getHttpServer()).patch(`/api/users/${operatorMembershipId}/password`).set('Authorization', `Bearer ${adminToken}`).send({ password: resetTwo }),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);
  });

  it('keeps Superadmin behind MFA and creates a clinic administrator whose provisional password is mandatory', async () => {
    const mfaSecret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
    const platformEmail = `superadmin-${suffix}@example.test`; disposableEmails.push(platformEmail);
    const platformPassword = 'Superadmin-e2e-password-2026!';
    const platformUser = await db.user.create({ data: { email: platformEmail, displayName: 'Superadmin E2E', passwordHash: await bcrypt.hash(platformPassword, 4) } });
    await db.membership.create({ data: { tenantId: platformTenantId, userId: platformUser.id, role: UserRole.PLATFORM_SUPERADMIN, status: 'ACTIVE' } });
    await db.platformAdminIdentity.create({ data: { userId: platformUser.id, totpSecretEncrypted: encryptSecret(mfaSecret) } });
    await request(app.getHttpServer()).post('/api/auth/login').set('x-forwarded-for', '198.51.100.241').send({ email: platformEmail, password: platformPassword, tenantSlug: platformSlug }).expect(401);
    const platformLogin = await request(app.getHttpServer()).post('/api/auth/login').set('x-forwarded-for', '198.51.100.242').send({ email: platformEmail, password: platformPassword, tenantSlug: platformSlug, otp: totpAt(mfaSecret) }).expect(201);
    const adminEmail = `clinic-admin-${suffix}@example.test`; disposableEmails.push(adminEmail);
    const adminTempPassword = 'Clinic-admin-temporary-2026!';
    const created = await request(app.getHttpServer()).post(`/api/platform/tenants/${tenantId}/members`).set('Authorization', `Bearer ${platformLogin.body.accessToken}`)
      .send({ email: adminEmail, displayName: 'Administrador inicial', role: 'TENANT_ADMIN', password: adminTempPassword, unitIds: [unitId], reason: 'Teste fictício de senha inicial' }).expect(201);
    expect(created.body.user.mustChangePassword).toBe(true);
    const clinicLogin = await login(adminEmail, adminTempPassword);
    await request(app.getHttpServer()).get('/api/units').set('Authorization', `Bearer ${clinicLogin.body.accessToken}`).expect(403);
    await request(app.getHttpServer()).patch('/api/auth/password').set('Authorization', `Bearer ${clinicLogin.body.accessToken}`).send({ currentPassword: adminTempPassword, newPassword: finalPassword }).expect(200);
    expect((await db.user.findUniqueOrThrow({ where: { id: created.body.user.id } })).mustChangePassword).toBe(false);
  });

  it('rotates one refresh cookie once under concurrent requests and leaves the winning session usable', async () => {
    const email = `refresh-race-${suffix}@example.test`; disposableEmails.push(email);
    const password = 'Refresh-race-e2e-2026!';
    const user = await db.user.create({ data: { email, displayName: 'Refresh E2E', passwordHash: await bcrypt.hash(password, 4) } });
    await db.membership.create({ data: { tenantId, userId: user.id, role: UserRole.TENANT_ADMIN, status: 'ACTIVE' } });
    const loggedIn = await login(email, password);
    const cookie = loggedIn.headers['set-cookie']?.find((value: string) => value.startsWith('clinic_refresh='))?.split(';')[0];
    expect(cookie).toBeTruthy();
    const responses = await Promise.all([
      request(app.getHttpServer()).post('/api/auth/refresh').set('Cookie', cookie!),
      request(app.getHttpServer()).post('/api/auth/refresh').set('Cookie', cookie!),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([201, 401]);
    const winner = responses.find((response) => response.status === 201)!;
    await request(app.getHttpServer()).get('/api/auth/me').set('Authorization', `Bearer ${winner.body.accessToken}`).expect(200);
    await request(app.getHttpServer()).post('/api/auth/refresh').set('Cookie', cookie!).expect(401);
  });
});

function totpAt(secret: string, now = Date.now()) {
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(now / 30_000)));
  const digest = createHmac('sha1', decodeBase32(secret)).update(counter).digest();
  const index = digest[digest.length - 1]! & 15;
  const binary = ((digest[index]! & 127) << 24) | (digest[index + 1]! << 16) | (digest[index + 2]! << 8) | digest[index + 3]!;
  return String(binary % 1_000_000).padStart(6, '0');
}
