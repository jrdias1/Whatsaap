import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient, UserRole } from '@prisma/client';
import { SignJWT } from 'jose';
import request from 'supertest';
import { randomBytes } from 'node:crypto';
import { AppModule } from '../src/app.module.js';
import { TenantContextInterceptor } from '../src/security/tenant-context.interceptor.js';

describe('Reports and private NPS (PostgreSQL e2e)', () => {
  const db = new PrismaClient();
  const suffix = `${Date.now()}-${randomBytes(4).toString('hex')}`;
  const secret = 'reports-e2e-secret-with-at-least-32-characters';
  const key = new TextEncoder().encode(secret);
  let app: INestApplication;
  let tenantId: string; let unitId: string; let otherUnitId: string; let patientId: string; let appointmentId: string;
  let adminId: string; let adminToken: string; let operatorToken: string;

  async function token(tenant: string, userId: string, membershipId: string, role: UserRole, sessionId: string) {
    return new SignJWT({ tenantId: tenant, membershipId, sessionId, role }).setProtectedHeader({ alg: 'HS256' }).setSubject(userId).setIssuer('clinic-api').setAudience('clinic-web').setIssuedAt().setExpirationTime('5m').sign(key);
  }

  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET = secret;
    process.env.INTEGRATION_ENCRYPTION_KEY = 'f'.repeat(64);
    const tenant = await db.tenant.create({ data: { name: `Reports ${suffix}`, slug: `reports-${suffix}`, status: 'ACTIVE' } }); tenantId = tenant.id;
    const [unit, otherUnit] = await Promise.all([
      db.unit.create({ data: { tenantId, name: 'Centro', slug: `reports-a-${suffix}` } }),
      db.unit.create({ data: { tenantId, name: 'Norte', slug: `reports-b-${suffix}` } }),
    ]); unitId = unit.id; otherUnitId = otherUnit.id;
    const [admin, operator] = await Promise.all([
      db.user.create({ data: { email: `reports-admin-${suffix}@example.test`, displayName: 'Reports Admin', passwordHash: 'unused' } }),
      db.user.create({ data: { email: `reports-operator-${suffix}@example.test`, displayName: 'Reports Operator', passwordHash: 'unused' } }),
    ]); adminId = admin.id;
    const [adminMembership, operatorMembership] = await Promise.all([
      db.membership.create({ data: { tenantId, userId: admin.id, role: UserRole.TENANT_ADMIN } }),
      db.membership.create({ data: { tenantId, userId: operator.id, role: UserRole.OPERATOR } }),
    ]);
    await db.unitMembership.create({ data: { tenantId, membershipId: operatorMembership.id, unitId } });
    const patient = await db.patient.create({ data: { tenantId, unitId, fullName: `NPS paciente ${suffix}` } }); patientId = patient.id;
    const procedure = await db.procedure.create({ data: { tenantId, unitId, name: 'Consulta', appointmentDurationMinutes: 30 } });
    const appointment = await db.appointment.create({ data: { tenantId, unitId, patientId, procedureId: procedure.id, startsAt: new Date(Date.now() - 3_600_000), endsAt: new Date(Date.now() - 1_800_000), completedAt: new Date(Date.now() - 1_800_000), status: 'COMPLETED', source: 'NATIVE' } }); appointmentId = appointment.id;
    await db.consentPreference.create({ data: { tenantId, patientId, channel: 'WHATSAPP', purpose: 'SATISFACTION_SURVEY', status: 'GRANTED', source: 'MANUAL', evidenceType: 'WRITTEN_FORM', evidenceReference: `e2e-${suffix}` } });
    await db.npsSettings.create({ data: { tenantId, enabled: true, unitId, createFollowupBelow: 6, responsibleUserId: adminId, windowStartMinute: 0, windowEndMinute: 1440 } });
    const survey = await db.npsSurvey.create({ data: { tenantId, unitId, patientId, appointmentId, scheduledAt: new Date(Date.now() - 60_000), question: 'Indicaria nossa clinica?', allowComment: true } });
    const [adminSession, operatorSession] = await Promise.all([
      db.authSession.create({ data: { tenantId, userId: admin.id, membershipId: adminMembership.id, tokenHash: `reports-admin-${suffix}`, expiresAt: new Date(Date.now() + 60_000) } }),
      db.authSession.create({ data: { tenantId, userId: operator.id, membershipId: operatorMembership.id, tokenHash: `reports-operator-${suffix}`, expiresAt: new Date(Date.now() + 60_000) } }),
    ]);
    adminToken = await token(tenantId, admin.id, adminMembership.id, UserRole.TENANT_ADMIN, adminSession.id);
    operatorToken = await token(tenantId, operator.id, operatorMembership.id, UserRole.OPERATOR, operatorSession.id);
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication(); app.useGlobalInterceptors(app.get(TenantContextInterceptor)); app.setGlobalPrefix('api'); await app.init();
    expect(survey.id).toBeTruthy();
  }, 30_000);

  afterAll(async () => {
    await app?.close();
    await db.$disconnect();
  });

  it('agrega por periodo/unidade, protege exportacao e registra NPS/follow-up uma unica vez', async () => {
    const from = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const to = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const foreignTenant = await db.tenant.create({ data: { name: `Foreign reports ${suffix}`, slug: `reports-foreign-${suffix}`, status: 'ACTIVE' } });
    const foreignUnit = await db.unit.create({ data: { tenantId: foreignTenant.id, name: 'Outra clínica', slug: `reports-foreign-unit-${suffix}` } });
    const foreignPatient = await db.patient.create({ data: { tenantId: foreignTenant.id, unitId: foreignUnit.id, fullName: 'Paciente isolado' } });
    await db.appointment.create({ data: { tenantId: foreignTenant.id, unitId: foreignUnit.id, patientId: foreignPatient.id, startsAt: new Date(Date.now() - 3_600_000), endsAt: new Date(Date.now() - 1_800_000), completedAt: new Date(), status: 'COMPLETED', source: 'NATIVE' } });
    const overview = await request(app.getHttpServer()).get(`/api/reports/overview?from=${from}&to=${to}&unitId=${unitId}`).set('Authorization', `Bearer ${adminToken}`).expect(200);
    expect(overview.body.appointments.completed).toBe(1);
    expect(overview.body.nps.responses).toBe(0);
    expect(overview.body.satisfaction5.npsEquivalent).toBe(false);
    const csv = await request(app.getHttpServer()).get(`/api/reports/export.csv?from=${from}&to=${to}`).set('Authorization', `Bearer ${adminToken}`).expect(200);
    expect(csv.text).toContain('appointments_completed_by_completed_at');
    expect(await db.auditEvent.count({ where: { tenantId, action: 'REPORT_EXPORTED' } })).toBe(1);
    await request(app.getHttpServer()).get(`/api/reports/overview?from=${from}&to=${to}&unitId=${otherUnitId}`).set('Authorization', `Bearer ${operatorToken}`).expect(403);
    await request(app.getHttpServer()).get('/api/reports/overview').set('Authorization', `Bearer ${operatorToken}`).expect(403);
    await request(app.getHttpServer()).put('/api/reports/nps/settings').set('Authorization', `Bearer ${operatorToken}`).send({ enabled: true }).expect(403);

    const surveys = await request(app.getHttpServer()).get(`/api/reports/nps/surveys?from=${from}&to=${to}`).set('Authorization', `Bearer ${adminToken}`).expect(200);
    const surveyId = surveys.body.items[0].id as string;
    await request(app.getHttpServer()).post(`/api/reports/nps/surveys/${surveyId}/response`).set('Authorization', `Bearer ${adminToken}`).send({ score: 11 }).expect(400);
    const recorded = await request(app.getHttpServer()).post(`/api/reports/nps/surveys/${surveyId}/response`).set('Authorization', `Bearer ${adminToken}`).send({ score: 4, comment: 'Retorno ficticio' }).expect(201);
    expect(recorded.body.followupTaskId).toBeTruthy();
    expect(await db.task.count({ where: { tenantId, title: { startsWith: 'Follow-up NPS:' }, patientId } })).toBe(1);
    await request(app.getHttpServer()).post(`/api/reports/nps/surveys/${surveyId}/response`).set('Authorization', `Bearer ${adminToken}`).send({ score: 3 }).expect(400);
    const updated = await request(app.getHttpServer()).get(`/api/reports/overview?from=${from}&to=${to}`).set('Authorization', `Bearer ${adminToken}`).expect(200);
    expect(updated.body.nps).toMatchObject({ responses: 1, nps: -100, detractors: 1 });
    expect(await db.outboxMessage.count({ where: { tenantId } })).toBe(0);
  });

  it('planeja NPS interno apos conclusao elegivel sem gerar outbox e respeita idempotencia', async () => {
    const appointment = await db.appointment.create({ data: { tenantId, unitId, patientId, startsAt: new Date(Date.now() - 3_600_000), endsAt: new Date(Date.now() - 1_800_000), status: 'CONFIRMED', source: 'NATIVE' } });
    await request(app.getHttpServer()).patch(`/api/appointments/${appointment.id}/status`).set('Authorization', `Bearer ${adminToken}`).send({ status: 'COMPLETED' }).expect(200);
    const survey = await db.npsSurvey.findUnique({ where: { tenantId_appointmentId: { tenantId, appointmentId: appointment.id } } });
    expect(survey).toMatchObject({ status: 'PLANNED', appointmentId: appointment.id, patientId });
    expect(survey!.scheduledAt.getTime()).toBeGreaterThan(Date.now());
    expect(await db.npsSurvey.count({ where: { tenantId, appointmentId: appointment.id } })).toBe(1);
    expect(await db.outboxMessage.count({ where: { tenantId } })).toBe(0);
  });

  it('revogar consentimento de pesquisa encerra pesquisas planejadas sem criar mensagem', async () => {
    const appointment = await db.appointment.create({ data: { tenantId, unitId, patientId, startsAt: new Date(Date.now() + 2_000_000), endsAt: new Date(Date.now() + 3_800_000), status: 'PENDING', source: 'NATIVE' } });
    const survey = await db.npsSurvey.create({ data: { tenantId, unitId, patientId, appointmentId: appointment.id, scheduledAt: new Date(Date.now() + 1_000_000), question: 'Indicaria nossa clinica?', allowComment: true } });
    await request(app.getHttpServer()).post(`/api/patients/${patientId}/consents`).set('Authorization', `Bearer ${adminToken}`).send({ channel: 'WHATSAPP', purpose: 'SATISFACTION_SURVEY', status: 'REVOKED', source: 'MANUAL' }).expect(201);
    expect((await db.npsSurvey.findUnique({ where: { id: survey.id }, select: { status: true } }))?.status).toBe('CANCELLED');
    expect(await db.outboxMessage.count({ where: { tenantId } })).toBe(0);
  });

  it('mantem proxy desativado por padrao e cabecalho X-Forwarded-For nao contorna o limite de login', async () => {
    expect(app.getHttpAdapter().getInstance().get('trust proxy')).toBeFalsy();
    const statuses: number[] = [];
    for (let index = 0; index < 9; index++) statuses.push((await request(app.getHttpServer()).post('/api/auth/login').set('X-Forwarded-For', `198.51.100.${index + 10}`).send({ email: 'missing@example.test', password: 'incorrect', tenantSlug: 'missing' })).status);
    expect(statuses.slice(0, 8).every((status) => status !== 429)).toBe(true);
    expect(statuses[8]).toBe(429);
  });
});
