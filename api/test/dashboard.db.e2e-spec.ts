import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient, UserRole } from '@prisma/client';
import { SignJWT } from 'jose';
import request from 'supertest';
import { randomBytes } from 'node:crypto';
import { AppModule } from '../src/app.module.js';
import { TenantContextInterceptor } from '../src/security/tenant-context.interceptor.js';

describe('Dashboard tenant/unit scope (PostgreSQL e2e)', () => {
  const db = new PrismaClient();
  const suffix = `${Date.now()}-${randomBytes(4).toString('hex')}`;
  const jwtSecret = 'dashboard-e2e-secret-with-at-least-32-characters';
  const jwtKey = new TextEncoder().encode(jwtSecret);
  let app: INestApplication;
  let tenantId: string;
  let otherTenantId: string;
  let unitId: string;
  let hiddenUnitId: string;
  let otherUnitId: string;
  let patientId: string;
  let adminToken: string;
  let operatorToken: string;
  let operatorId: string;
  let operatorMembershipId: string;
  const createdUserEmails: string[] = [];

  async function makeToken(scope: { tenantId: string; membershipId: string; sessionId: string; userId: string; role: UserRole }) {
    return new SignJWT({ tenantId: scope.tenantId, membershipId: scope.membershipId, sessionId: scope.sessionId, role: scope.role })
      .setProtectedHeader({ alg: 'HS256' }).setSubject(scope.userId).setIssuer('clinic-api').setAudience('clinic-web').setIssuedAt().setExpirationTime('5m').sign(jwtKey);
  }

  function todayAtLocal(hour: number) {
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    return new Date(`${date}T${String(hour + 3).padStart(2, '0')}:00:00.000Z`);
  }

  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET = jwtSecret;
    process.env.INTEGRATION_ENCRYPTION_KEY = 'e'.repeat(64);
    const tenant = await db.tenant.create({ data: { name: `Dashboard PostgreSQL ${suffix}`, slug: `dashboard-db-${suffix}` } });
    tenantId = tenant.id;
    const other = await db.tenant.create({ data: { name: `Dashboard outro tenant ${suffix}`, slug: `dashboard-other-${suffix}` } });
    otherTenantId = other.id;
    const [unit, hiddenUnit, otherUnit] = await Promise.all([
      db.unit.create({ data: { tenantId, name: 'Unidade escopada', slug: `dash-a-${suffix}` } }),
      db.unit.create({ data: { tenantId, name: 'Unidade fora do escopo', slug: `dash-b-${suffix}` } }),
      db.unit.create({ data: { tenantId: otherTenantId, name: 'Unidade externa', slug: `dash-c-${suffix}` } }),
    ]);
    unitId = unit.id; hiddenUnitId = hiddenUnit.id; otherUnitId = otherUnit.id;
    const [adminUser, operatorUser, otherPatient] = await Promise.all([
      db.user.create({ data: { email: `dashboard-admin-${suffix}@example.test`, displayName: 'Admin Dashboard', passwordHash: 'unused' } }),
      db.user.create({ data: { email: `dashboard-operator-${suffix}@example.test`, displayName: 'Operador Dashboard', passwordHash: 'unused' } }),
      db.patient.create({ data: { tenantId: otherTenantId, unitId: otherUnit.id, fullName: 'Paciente de outro tenant' } }),
    ]);
    createdUserEmails.push(adminUser.email, operatorUser.email);
    operatorId = operatorUser.id;
    const [adminMembership, operatorMembership] = await Promise.all([
      db.membership.create({ data: { tenantId, userId: adminUser.id, role: UserRole.TENANT_ADMIN } }),
      db.membership.create({ data: { tenantId, userId: operatorUser.id, role: UserRole.OPERATOR } }),
    ]);
    operatorMembershipId = operatorMembership.id;
    await db.unitMembership.create({ data: { tenantId, membershipId: operatorMembership.id, unitId } });
    const patient = await db.patient.create({ data: { tenantId, unitId, fullName: 'Paciente dashboard PostgreSQL' } });
    patientId = patient.id;
    await db.patient.create({ data: { tenantId, unitId: null, fullName: 'Paciente sem unidade dashboard' } });
    const startsAt = todayAtLocal(12);
    const endsAt = new Date(startsAt.getTime() + 30 * 60_000);
    const hiddenPatient = await db.patient.create({ data: { tenantId, unitId: hiddenUnitId, fullName: 'Paciente unidade restrita' } });
    await Promise.all([
      db.appointment.create({ data: { tenantId, unitId, patientId, startsAt, endsAt, status: 'PENDING', source: 'NATIVE' } }),
      db.appointment.create({ data: { tenantId, unitId: hiddenUnitId, patientId: hiddenPatient.id, startsAt, endsAt, status: 'CONFIRMED', source: 'NATIVE' } }),
      db.appointment.create({ data: { tenantId: otherTenantId, unitId: otherUnit.id, patientId: otherPatient.id, startsAt, endsAt, status: 'CONFIRMED', source: 'NATIVE' } }),
      db.conversation.create({ data: { tenantId, unitId, patientId, status: 'WAITING_HUMAN', lastMessageAt: new Date() } }),
      db.task.create({ data: { tenantId, unitId, patientId, title: 'Tarefa própria dashboard', assignedToId: operatorId, createdById: operatorId, dueAt: new Date(Date.now() - 60_000) } }),
      db.task.create({ data: { tenantId, unitId, patientId, title: 'Tarefa de outro atendente', assignedToId: adminUser.id, createdById: adminUser.id } }),
    ]);
    const [adminSession, operatorSession] = await Promise.all([
      db.authSession.create({ data: { tenantId, userId: adminUser.id, membershipId: adminMembership.id, tokenHash: `dashboard-admin-${suffix}`, expiresAt: new Date(Date.now() + 60_000) } }),
      db.authSession.create({ data: { tenantId, userId: operatorId, membershipId: operatorMembership.id, tokenHash: `dashboard-operator-${suffix}`, expiresAt: new Date(Date.now() + 60_000) } }),
    ]);
    adminToken = await makeToken({ tenantId, membershipId: adminMembership.id, sessionId: adminSession.id, userId: adminUser.id, role: UserRole.TENANT_ADMIN });
    operatorToken = await makeToken({ tenantId, membershipId: operatorMembershipId, sessionId: operatorSession.id, userId: operatorId, role: UserRole.OPERATOR });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    app.useGlobalInterceptors(app.get(TenantContextInterceptor));
    app.setGlobalPrefix('api');
    await app.init();
  }, 30_000);

  afterAll(async () => {
    await app?.close();
    if (tenantId) await db.tenant.deleteMany({ where: { id: tenantId } });
    if (otherTenantId) await db.tenant.deleteMany({ where: { id: otherTenantId } });
    if (createdUserEmails.length) await db.user.deleteMany({ where: { email: { in: createdUserEmails } } });
    await db.$disconnect();
  });

  it('agrega dados no PostgreSQL pelo tenant/unidade e aplica o recorte do operador', async () => {
    const admin = await request(app.getHttpServer()).get(`/api/dashboard/overview?unitId=${unitId}`).set('Authorization', `Bearer ${adminToken}`).expect(200);
    expect(admin.body.timezone).toBe('America/Sao_Paulo');
    expect(admin.body.units).toEqual([{ id: unitId, name: 'Unidade escopada' }]);
    expect(admin.body.appointments).toHaveLength(1);
    expect(admin.body.appointments[0].patient.id).toBe(patientId);
    expect(admin.body.metrics).toMatchObject({ appointmentsToday: 1, awaitingConfirmation: 1, conversationsWaitingHuman: 1, openTasks: 2, overdueTasks: 1, activePatients: 2 });

    const operator = await request(app.getHttpServer()).get('/api/dashboard/overview').set('Authorization', `Bearer ${operatorToken}`).expect(200);
    expect(operator.body.units.map((row: { id: string }) => row.id)).toEqual([unitId]);
    expect(operator.body.appointments).toHaveLength(1);
    expect(operator.body.metrics.openTasks).toBe(1);
    expect(operator.body.metrics.overdueTasks).toBe(1);
    expect(operator.body.metrics.appointmentsToday).toBe(1);
    expect(operator.body.metrics.activePatients).toBe(2);
  });

  it('rejeita filtro de unidade não autorizada e não agrega outro tenant', async () => {
    await request(app.getHttpServer()).get(`/api/dashboard/overview?unitId=${hiddenUnitId}`).set('Authorization', `Bearer ${operatorToken}`).expect(403);
    await request(app.getHttpServer()).get(`/api/dashboard/overview?unitId=${otherUnitId}`).set('Authorization', `Bearer ${adminToken}`).expect(403);
  });
});
