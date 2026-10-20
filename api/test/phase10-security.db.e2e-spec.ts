import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient, UserRole } from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';
import { SignJWT } from 'jose';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { TenantContextInterceptor } from '../src/security/tenant-context.interceptor.js';

describe('Fase 10: segurança administrativa, recuperação, tema e privacidade (PostgreSQL isolado)', () => {
  const db = new PrismaClient();
  const suffix = `${Date.now()}-${randomBytes(4).toString('hex')}`;
  const secret = new TextEncoder().encode('phase10-only-jwt-secret-over-32-characters');
  const password = 'Phase10-admin-current-password-2026!';
  let app: INestApplication;
  let tenantA: string;
  let tenantB: string;
  let unitA1: string;
  let unitA2: string;
  let unitB: string;
  let adminId: string;
  let adminMembershipId: string;
  let managerMembershipId: string;
  let managerId: string;

  let operatorMembershipId: string;
  let patientA: string;
  let adminToken = '';
  let managerToken = '';
  let operatorToken = '';
  let otherTenantToken = '';
  let operatorSessionId: string;
  let planId: string;
  const oldInvitationMode = process.env.LOCAL_INVITATION_HANDOFF;

  async function actor(tenantId: string, role: UserRole, email: string) {
    const user = await db.user.create({ data: { email, displayName: role, passwordHash: await bcrypt.hash(password, 4) } });
    const membership = await db.membership.create({ data: { tenantId, userId: user.id, role, status: 'ACTIVE' } });
    const sessionId = randomBytes(16).toString('hex');
    const session = await db.authSession.create({ data: { tenantId, userId: user.id, membershipId: membership.id, tokenHash: `phase10-${suffix}-${sessionId}`, expiresAt: new Date(Date.now() + 60 * 60_000) } });
    const token = await new SignJWT({ tenantId, membershipId: membership.id, sessionId: session.id, role })
      .setProtectedHeader({ alg: 'HS256' }).setSubject(user.id).setIssuer('clinic-api').setAudience('clinic-web').setIssuedAt().setExpirationTime('15m').sign(secret);
    return { user, membership, session, token };
  }

  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET = 'phase10-only-jwt-secret-over-32-characters';
    process.env.INTEGRATION_ENCRYPTION_KEY = 'e'.repeat(64);
    process.env.LOCAL_INVITATION_HANDOFF = '1';
    const [a, b] = await Promise.all([
      db.tenant.create({ data: { name: `Clínica Fase 10 A ${suffix}`, slug: `phase10-a-${suffix}`, status: 'TRIAL' } }),
      db.tenant.create({ data: { name: `Clínica Fase 10 B ${suffix}`, slug: `phase10-b-${suffix}`, status: 'TRIAL' } }),
    ]);
    tenantA = a.id; tenantB = b.id;
    planId = (await db.plan.create({ data: { code: `P10-${suffix}`, name: 'Plano fictício Fase 10', priceCents: 0, patientLimit: 20, messageLimitPerCycle: 50, userLimit: 10, unitLimit: 3, connectionLimit: 2, activeAutomationLimit: 3, campaignLimitPerCycle: 5 } })).id;
    const start = new Date(Date.now() - 60_000);
    await Promise.all([tenantA, tenantB].map((tenantId) => db.subscription.create({ data: { tenantId, planId, status: 'TRIAL', cycleStartsAt: start, cycleEndsAt: new Date(Date.now() + 30 * 86400000) } })));
    const [a1, a2, b1] = await Promise.all([
      db.unit.create({ data: { tenantId: tenantA, name: 'Unidade Norte', slug: 'norte' } }),
      db.unit.create({ data: { tenantId: tenantA, name: 'Unidade Sul', slug: 'sul' } }),
      db.unit.create({ data: { tenantId: tenantB, name: 'Unidade Externa', slug: 'externa' } }),
    ]);
    unitA1 = a1.id; unitA2 = a2.id; unitB = b1.id;
    const [admin, manager, operator, other] = await Promise.all([
      actor(tenantA, UserRole.TENANT_ADMIN, `admin-${suffix}@example.test`),
      actor(tenantA, UserRole.UNIT_MANAGER, `manager-${suffix}@example.test`),
      actor(tenantA, UserRole.OPERATOR, `operator-${suffix}@example.test`),
      actor(tenantB, UserRole.TENANT_ADMIN, `other-${suffix}@example.test`),
    ]);
    adminId = admin.user.id; adminMembershipId = admin.membership.id; managerId = manager.user.id; managerMembershipId = manager.membership.id;
    operatorMembershipId = operator.membership.id;
    operatorSessionId = operator.session.id;
    adminToken = admin.token; managerToken = manager.token; operatorToken = operator.token; otherTenantToken = other.token;
    await db.unitMembership.createMany({ data: [
      { tenantId: tenantA, membershipId: admin.membership.id, unitId: unitA1 }, { tenantId: tenantA, membershipId: admin.membership.id, unitId: unitA2 },
      { tenantId: tenantA, membershipId: manager.membership.id, unitId: unitA1 },
      { tenantId: tenantA, membershipId: operator.membership.id, unitId: unitA1 }, { tenantId: tenantA, membershipId: operator.membership.id, unitId: unitA2 },
      { tenantId: tenantB, membershipId: other.membership.id, unitId: unitB },
    ] });
    patientA = (await db.patient.create({ data: { tenantId: tenantA, unitId: unitA1, fullName: 'Paciente Fictício Fase 10' } })).id;
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication(); app.useGlobalInterceptors(app.get(TenantContextInterceptor)); app.setGlobalPrefix('api'); await app.init();
  });

  afterAll(async () => {
    await app?.close(); await db.$disconnect();
    if (oldInvitationMode === undefined) delete process.env.LOCAL_INVITATION_HANDOFF;
    else process.env.LOCAL_INVITATION_HANDOFF = oldInvitationMode;
  });

  it('lists members by tenant and keeps the retired invitation endpoint unavailable', async () => {
    const listed = await request(app.getHttpServer()).get('/api/users').set('Authorization', `Bearer ${adminToken}`).expect(200);
    expect(listed.body.users.map((row: any) => row.id)).toContain(operatorMembershipId);
    expect(listed.body.users.some((row: any) => row.user.email === `other-${suffix}@example.test`)).toBe(false);
    await request(app.getHttpServer()).post('/api/users/invitations').set('Authorization', `Bearer ${adminToken}`).send({ email: `invite-${suffix}@example.test`, displayName: 'Test employee', role: 'OPERATOR', unitIds: [unitA1] }).expect(404);
    await request(app.getHttpServer()).patch(`/api/users/${operatorMembershipId}`).set('Authorization', `Bearer ${operatorToken}`).send({ role: 'TENANT_ADMIN' }).expect(403);
    await request(app.getHttpServer()).patch(`/api/users/${operatorMembershipId}`).set('Authorization', `Bearer ${managerToken}`).send({ unitIds: [unitA2] }).expect(403);
    await request(app.getHttpServer()).patch(`/api/users/${operatorMembershipId}`).set('Authorization', `Bearer ${adminToken}`).send({ role: 'PLATFORM_SUPERADMIN' }).expect(400);
    await request(app.getHttpServer()).patch(`/api/users/${operatorMembershipId}`).set('Authorization', `Bearer ${otherTenantToken}`).send({ status: 'DISABLED' }).expect(403);
    const unitFiltered = await request(app.getHttpServer()).get(`/api/users?unitId=${unitA1}&role=OPERATOR`).set('Authorization', `Bearer ${adminToken}`).expect(200);
    expect(unitFiltered.body.users.some((row: any) => row.id === operatorMembershipId)).toBe(true);
    await request(app.getHttpServer()).patch(`/api/users/${operatorMembershipId}`).set('Authorization', `Bearer ${adminToken}`).send({ role: 'OPERATOR' }).expect(200);
    const history = await request(app.getHttpServer()).get(`/api/users/${operatorMembershipId}/history`).set('Authorization', `Bearer ${adminToken}`).expect(200);
    expect(history.body.some((row: any) => row.action === 'USER_MEMBERSHIP_UPDATED')).toBe(true);
    await request(app.getHttpServer()).patch(`/api/users/${adminMembershipId}`).set('Authorization', `Bearer ${adminToken}`).send({ status: 'DISABLED' }).expect(409);
  });

  it('revoga sessões ao desativar acesso e exige nova sessão após reativação ou mudança de papel', async () => {
    await request(app.getHttpServer()).patch(`/api/users/${operatorMembershipId}`).set('Authorization', `Bearer ${adminToken}`).send({ status: 'DISABLED' }).expect(200);
    expect((await db.authSession.findUniqueOrThrow({ where: { id: operatorSessionId } })).revokedAt).toBeTruthy();
    await request(app.getHttpServer()).get('/api/auth/me').set('Authorization', `Bearer ${operatorToken}`).expect(401);
    await request(app.getHttpServer()).patch(`/api/users/${operatorMembershipId}`).set('Authorization', `Bearer ${adminToken}`).send({ status: 'ACTIVE' }).expect(200);
    await request(app.getHttpServer()).get('/api/auth/me').set('Authorization', `Bearer ${operatorToken}`).expect(401);
  });

  it('completes verified recovery for a manager as a single-use flow and revokes sessions', async () => {
    const issued = await request(app.getHttpServer()).post(`/api/users/${managerMembershipId}/recovery`).set('Authorization', `Bearer ${adminToken}`).send({ currentPassword: password, identityVerification: 'IN_PERSON', reason: 'Identity checked in person.' }).expect(201);
    expect(issued.body.token).toHaveLength(43);
    const tokenHash = createHash('sha256').update(issued.body.token).digest('hex');
    const stored = await db.passwordRecoveryToken.findUniqueOrThrow({ where: { tokenHash } });
    expect(stored.tokenHash).not.toBe(issued.body.token); expect(stored.usedAt).toBeNull();
    const email = `manager-${suffix}@example.test`;
    const recoveredPassword = 'New-recovered-password-2026!';
    await request(app.getHttpServer()).post('/api/auth/password-recovery/complete').send({ tenantSlug: `phase10-a-${suffix}`, email, token: issued.body.token, password: recoveredPassword }).expect(201);
    await request(app.getHttpServer()).post('/api/auth/password-recovery/complete').send({ tenantSlug: `phase10-a-${suffix}`, email, token: issued.body.token, password: 'Another-recovery-password-2026!' }).expect(400);
    await request(app.getHttpServer()).get('/api/auth/me').set('Authorization', `Bearer ${managerToken}`).expect(401);
    const login = await request(app.getHttpServer()).post('/api/auth/login').send({ tenantSlug: `phase10-a-${suffix}`, email, password: recoveredPassword }).expect(201);
    expect(login.body.accessToken).toBeTruthy();
    const expiredToken = randomBytes(32).toString('base64url');
    await db.passwordRecoveryToken.create({ data: { tenantId: tenantA, userId: managerId, createdById: adminId, tokenHash: createHash('sha256').update(expiredToken).digest('hex'), expiresAt: new Date(Date.now() - 1000) } });
    await request(app.getHttpServer()).post('/api/auth/password-recovery/complete').send({ tenantSlug: `phase10-a-${suffix}`, email, token: expiredToken, password: 'Yet-another-password-2026!' }).expect(400);
    await request(app.getHttpServer()).post(`/api/users/${operatorMembershipId}/recovery`).set('Authorization', `Bearer ${adminToken}`).send({ currentPassword: password, identityVerification: 'IN_PERSON', reason: 'Identity checked in person.' }).expect(400);
    await request(app.getHttpServer()).post(`/api/users/${managerMembershipId}/recovery`).set('Authorization', `Bearer ${managerToken}`).send({ currentPassword: password, identityVerification: 'IN_PERSON', reason: 'Identity checked in person.' }).expect(401);
  });

  it('isola tema por tenant, valida cor e conteúdo e calcula o primeiro acesso com dados persistidos', async () => {
    await request(app.getHttpServer()).patch('/api/settings/tenant').set('Authorization', `Bearer ${adminToken}`).send({ displayName: 'Clínica Fase 10 A', contactEmail: `admin-${suffix}@example.test`, accentColor: '#064E3B', secondaryColor: '#104C44', institutionalText: 'Atendimento com hora marcada.' }).expect(200);
    await request(app.getHttpServer()).patch('/api/settings/tenant').set('Authorization', `Bearer ${adminToken}`).send({ accentColor: '#ffffff' }).expect(400);
    await request(app.getHttpServer()).patch('/api/settings/tenant').set('Authorization', `Bearer ${adminToken}`).send({ institutionalText: '<script>alert(1)</script>' }).expect(400);
    await request(app.getHttpServer()).patch(`/api/settings/units/${unitA1}`).set('Authorization', `Bearer ${adminToken}`).send({ contactPhone: '+55 11 99999-0000', address: 'Rua Fictícia, 10' }).expect(200);
    await request(app.getHttpServer()).patch(`/api/settings/units/${unitB}`).set('Authorization', `Bearer ${adminToken}`).send({ address: 'Tentativa cruzada' }).expect(404);
    const a = await request(app.getHttpServer()).get('/api/settings/tenant').set('Authorization', `Bearer ${adminToken}`).expect(200);
    const b = await request(app.getHttpServer()).get('/api/settings/tenant').set('Authorization', `Bearer ${otherTenantToken}`).expect(200);
    expect(a.body.tenant.displayName).toBe('Clínica Fase 10 A'); expect(b.body.tenant.displayName).toBeNull();
    const progress = await request(app.getHttpServer()).get('/api/settings/setup').set('Authorization', `Bearer ${adminToken}`).expect(200);
    expect(progress.body.steps.find((step: any) => step.key === 'clinic').complete).toBe(true);
    expect(progress.body.steps.find((step: any) => step.key === 'team').complete).toBe(true);
  });

  it('registra e audita solicitações sem excluir dados e impede consulta entre tenants', async () => {
    const created = await request(app.getHttpServer()).post('/api/privacy/requests').set('Authorization', `Bearer ${adminToken}`).send({ patientId: patientA, type: 'ERASURE', reason: 'Solicito avaliação do pedido de exclusão.' }).expect(201);
    await request(app.getHttpServer()).patch(`/api/privacy/requests/${created.body.id}`).set('Authorization', `Bearer ${adminToken}`).send({ status: 'UNDER_REVIEW' }).expect(200);
    await request(app.getHttpServer()).patch(`/api/privacy/requests/${created.body.id}`).set('Authorization', `Bearer ${adminToken}`).send({ status: 'COMPLETED', closureReason: 'Analisado; retenção requer revisão jurídica.' }).expect(200);
    await request(app.getHttpServer()).patch(`/api/privacy/requests/${created.body.id}`).set('Authorization', `Bearer ${adminToken}`).send({ status: 'OPEN' }).expect(409);
    await request(app.getHttpServer()).get('/api/privacy/requests').set('Authorization', `Bearer ${otherTenantToken}`).expect(200).expect([]);
    await request(app.getHttpServer()).get('/api/privacy/requests').set('Authorization', `Bearer ${operatorToken}`).expect(401);
    const patient = await db.patient.findUnique({ where: { id: patientA } });
    expect(patient?.active).toBe(true); expect(patient?.deletedAt).toBeNull();
    const history = await db.privacyRequestEvent.findMany({ where: { privacyRequestId: created.body.id }, orderBy: { occurredAt: 'asc' } });
    expect(history.map((row) => row.action)).toEqual(['REQUEST_REGISTERED', 'STATUS_UNDER_REVIEW', 'STATUS_COMPLETED']);
    await expect(db.privacyRequestEvent.update({ where: { id: history[0]!.id }, data: { action: 'TAMPERED' } })).rejects.toThrow(/append-only/);
    await request(app.getHttpServer()).get('/api/reports/export.csv?from=2026-01-01&to=2026-01-01').set('Authorization', `Bearer ${adminToken}`).expect(200);
    expect(await db.auditEvent.count({ where: { tenantId: tenantA, action: 'REPORT_EXPORTED' } })).toBe(1);
  });

  it('mantém contas de clínica suspensas sem sessão válida e nunca usa a rota clínica para alterar a identidade MFA global', async () => {
    const globalIdentityCount = await db.platformAdminIdentity.count();
    await db.tenant.update({ where: { id: tenantA }, data: { status: 'SUSPENDED' } });
    await request(app.getHttpServer()).get('/api/auth/me').set('Authorization', `Bearer ${adminToken}`).expect(403);
    expect(await db.platformAdminIdentity.count()).toBe(globalIdentityCount);
  });
});


