import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient, UserRole } from '@prisma/client';
import { SignJWT } from 'jose';
import request from 'supertest';
import * as ExcelJS from 'exceljs';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { AppModule } from '../src/app.module.js';
import { TenantContextInterceptor } from '../src/security/tenant-context.interceptor.js';
import { MetaWebhookService } from '../src/meta/meta-webhook.service.js';
import { OutboxDispatchService } from '../src/outbox/outbox-dispatch.service.js';
import { AutomationsService } from '../src/automations/automations.service.js';

describe('Tenant and unit isolation (PostgreSQL e2e)', () => {
  let app: INestApplication;
  const db = new PrismaClient();
  const secretText = 'integration-test-secret-with-at-least-32-characters';
  const secret = new TextEncoder().encode(secretText);
  const suffix = `${Date.now()}-${randomBytes(4).toString('hex')}`;
  let tenantAId: string;
  let tenantBId: string;
  let userAId: string;
  let adminUserId: string;
  let adminMembershipId: string;
  let adminSessionId: string;
  let membershipAId: string;
  let unitA1Id: string;
  let unitA2Id: string;
  let unitBId: string;
  let patientA1Id: string;
  let patientA2Id: string;
  let patientUnassignedId: string;
  let patientBId: string;
  let activeSessionId: string;
  let revokedSessionId: string;
  let testPlanId: string;
  let previousRedisUrl: string | undefined;

  async function accessToken(
    tenantId: string,
    membershipId: string,
    sessionId: string,
    userId: string,
    role = UserRole.OPERATOR,
  ) {
    return new SignJWT({
      tenantId,
      membershipId,
      sessionId,
      role,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(userId)
      .setIssuer('clinic-api')
      .setAudience('clinic-web')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(secret);
  }

  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET = secretText;
    previousRedisUrl = process.env.REDIS_URL;
    const isolatedRedisUrl = new URL(previousRedisUrl ?? 'redis://localhost:6380');
    isolatedRedisUrl.pathname = '/15';
    process.env.REDIS_URL = isolatedRedisUrl.toString();
    process.env.INTEGRATION_ENCRYPTION_KEY = 'c'.repeat(64);
    process.env.META_APP_SECRET = 'meta-e2e-secret';
    process.env.META_WEBHOOK_VERIFY_TOKEN = 'meta-e2e-verify-token';
    const tenantA = await db.tenant.create({
      data: { name: `E2E Tenant A ${suffix}`, slug: `e2e-a-${suffix}` },
    });
    tenantAId = tenantA.id;
    const tenantB = await db.tenant.create({
      data: { name: `E2E Tenant B ${suffix}`, slug: `e2e-b-${suffix}` },
    });
    tenantBId = tenantB.id;
    const plan = await db.plan.create({ data: { code: `E2E-${suffix}`, name: 'E2E', priceCents: 0, patientLimit: 50, messageLimitPerCycle: 1, userLimit: 10, unitLimit: 5, connectionLimit: 100, activeAutomationLimit: 100, campaignLimitPerCycle: 1 } });
    testPlanId = plan.id;
    const cycleStartsAt = new Date(Date.now() - 60_000);
    await db.subscription.create({ data: { tenantId: tenantAId, planId: testPlanId, status: 'TRIAL', cycleStartsAt, cycleEndsAt: new Date(Date.now() + 30 * 86400000) } });
    const [unitA1, unitA2, unitB] = await Promise.all([
      db.unit.create({
        data: {
          tenantId: tenantAId,
          name: 'Unidade permitida',
          slug: 'permitida',
        },
      }),
      db.unit.create({
        data: {
          tenantId: tenantAId,
          name: 'Unidade restrita',
          slug: 'restrita',
        },
      }),
      db.unit.create({
        data: {
          tenantId: tenantBId,
          name: 'Unidade tenant B',
          slug: 'tenant-b',
        },
      }),
    ]);
    unitA1Id = unitA1.id;
    unitA2Id = unitA2.id;
    unitBId = unitB.id;
    const user = await db.user.create({
      data: {
        email: `e2e-${suffix}@example.test`,
        displayName: 'Operador E2E',
        passwordHash: 'not-used-in-this-test',
      },
    });
    userAId = user.id;
    const membership = await db.membership.create({
      data: { tenantId: tenantAId, userId: userAId, role: UserRole.OPERATOR },
    });
    membershipAId = membership.id;
    const admin = await db.user.create({
      data: {
        email: `admin-e2e-${suffix}@example.test`,
        displayName: 'Admin E2E',
        passwordHash: 'not-used-in-this-test',
      },
    });
    adminUserId = admin.id;
    const adminMembership = await db.membership.create({
      data: {
        tenantId: tenantAId,
        userId: adminUserId,
        role: UserRole.TENANT_ADMIN,
      },
    });
    adminMembershipId = adminMembership.id;
    await db.unitMembership.create({
      data: {
        tenantId: tenantAId,
        membershipId: membershipAId,
        unitId: unitA1Id,
      },
    });
    const [patientA1, patientA2, patientUnassigned, patientB] = await Promise.all([
      db.patient.create({
        data: {
          tenantId: tenantAId,
          unitId: unitA1Id,
          fullName: 'Paciente unidade permitida',
          phone: `+551199${Date.now().toString().slice(-8)}`,
        },
      }),
      db.patient.create({
        data: {
          tenantId: tenantAId,
          unitId: unitA2Id,
          fullName: 'Paciente unidade restrita',
        },
      }),
      db.patient.create({
        data: {
          tenantId: tenantAId,
          unitId: null,
          fullName: 'Paciente sem unidade preferencial',
        },
      }),
      db.patient.create({
        data: {
          tenantId: tenantBId,
          unitId: unitB.id,
          fullName: 'Paciente outro tenant',
        },
      }),
    ]);
    patientA1Id = patientA1.id;
    patientA2Id = patientA2.id;
    patientUnassignedId = patientUnassigned.id;
    patientBId = patientB.id;
    const [activeSession, revokedSession] = await Promise.all([
      db.authSession.create({
        data: {
          tenantId: tenantAId,
          userId: userAId,
          membershipId: membershipAId,
          tokenHash: `e2e-active-${suffix}`,
          expiresAt: new Date(Date.now() + 60 * 60_000),
        },
      }),
      db.authSession.create({
        data: {
          tenantId: tenantAId,
          userId: userAId,
          membershipId: membershipAId,
          tokenHash: `e2e-revoked-${suffix}`,
          expiresAt: new Date(Date.now() + 60 * 60_000),
          revokedAt: new Date(),
        },
      }),
    ]);
    activeSessionId = activeSession.id;
    revokedSessionId = revokedSession.id;
    const adminSession = await db.authSession.create({
      data: {
        tenantId: tenantAId,
        userId: adminUserId,
        membershipId: adminMembershipId,
        tokenHash: `e2e-admin-${suffix}`,
        expiresAt: new Date(Date.now() + 60 * 60_000),
      },
    });
    adminSessionId = adminSession.id;

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    app.useGlobalInterceptors(app.get(TenantContextInterceptor));
    app.setGlobalPrefix('api');
    await app.init();
  }, 30_000);

  it('limits patient list and detail to the operator unit and authenticated tenant', async () => {
    const token = await accessToken(
      tenantAId,
      membershipAId,
      activeSessionId,
      userAId,
    );
    const response = await request(app.getHttpServer())
      .get('/api/patients')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(response.body.items.map((patient: { id: string }) => patient.id)).toEqual([
      patientA1Id,
    ]);
    const schedulingPatients = await request(app.getHttpServer())
      .get(`/api/patients?unitId=${unitA1Id}&includeUnassigned=true&search=Paciente`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(schedulingPatients.body.items.map((patient: { id: string }) => patient.id).sort()).toEqual(
      [patientA1Id, patientUnassignedId].sort(),
    );
    const accessibleUnits = await request(app.getHttpServer())
      .get('/api/units')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(accessibleUnits.body.map((unit: { id: string }) => unit.id)).toEqual(
      [unitA1Id],
    );
    await request(app.getHttpServer())
      .get(`/api/integrations/uno/${unitA2Id}/status`)
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
    await request(app.getHttpServer())
      .get(`/api/integrations/uno/${unitA1Id}/status`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect((status) => expect(status.body.activeSource).toBe('NATIVE'));
    await request(app.getHttpServer())
      .get(`/api/patients/${patientA2Id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
    await request(app.getHttpServer())
      .get(`/api/patients/${patientUnassignedId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
    await request(app.getHttpServer())
      .get(`/api/patients/${patientBId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
    const appointmentStart = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await db.appointment.create({
      data: {
        tenantId: tenantAId,
        unitId: unitA1Id,
        patientId: patientUnassignedId,
        startsAt: appointmentStart,
        endsAt: new Date(appointmentStart.getTime() + 30 * 60 * 1000),
        createdById: userAId,
      },
    });
    await request(app.getHttpServer())
      .get(`/api/patients/${patientUnassignedId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
  });

  it('rejects writes to a unit outside the operator membership', async () => {
    const token = await accessToken(
      tenantAId,
      membershipAId,
      activeSessionId,
      userAId,
    );
    await request(app.getHttpServer())
      .post('/api/patients')
      .set('Authorization', `Bearer ${token}`)
      .send({ fullName: 'Tentativa fora do escopo', unitId: unitA2Id })
      .expect(403);
  });

  it('creates a patient with an explicit marketing consent choice in the same operation', async () => {
    const token = await accessToken(tenantAId, membershipAId, activeSessionId, userAId);
    const grantedName = `Consentimento concedido ${suffix}`;
    await request(app.getHttpServer())
      .post('/api/patients')
      .set('Authorization', `Bearer ${token}`)
      .send({ fullName: grantedName, unitId: unitA1Id, marketingConsent: 'GRANTED' })
      .expect(400);
    expect(await db.patient.count({ where: { tenantId: tenantAId, fullName: grantedName } })).toBe(0);
    await request(app.getHttpServer())
      .post('/api/patients')
      .set('Authorization', `Bearer ${token}`)
      .send({ fullName: grantedName, unitId: unitA1Id, marketingConsent: 'GRANTED', evidenceType: 'OTHER', evidenceReference: 'checkbox' })
      .expect(400);

    const granted = await request(app.getHttpServer())
      .post('/api/patients')
      .set('Authorization', `Bearer ${token}`)
      .send({ fullName: grantedName, unitId: unitA1Id, marketingConsent: 'GRANTED', evidenceType: 'WHATSAPP_MESSAGE', evidenceReference: `wa-message-${suffix}`, evidence: 'Mensagem de autorização identificada' })
      .expect(201);
    const [grantedPreference, grantedEvent] = await Promise.all([
      db.consentPreference.findUniqueOrThrow({ where: { tenantId_patientId_channel_purpose: { tenantId: tenantAId, patientId: granted.body.id, channel: 'WHATSAPP', purpose: 'MARKETING' } } }),
      db.consentEvent.findFirstOrThrow({ where: { tenantId: tenantAId, patientId: granted.body.id, source: 'MANUAL' } }),
    ]);
    expect(grantedPreference.status).toBe('GRANTED');
    expect(grantedPreference.evidenceReference).toBe(`wa-message-${suffix}`);
    expect(grantedEvent.actorUserId).toBe(userAId);

    const created = await request(app.getHttpServer())
      .post('/api/patients')
      .set('Authorization', `Bearer ${token}`)
      .send({ fullName: `Consentimento negado ${suffix}`, unitId: unitA1Id, marketingConsent: 'DENIED' })
      .expect(201);
    const [preference, event] = await Promise.all([
      db.consentPreference.findUniqueOrThrow({
        where: { tenantId_patientId_channel_purpose: { tenantId: tenantAId, patientId: created.body.id, channel: 'WHATSAPP', purpose: 'MARKETING' } },
      }),
      db.consentEvent.findFirstOrThrow({ where: { tenantId: tenantAId, patientId: created.body.id, source: 'MANUAL' } }),
    ]);
    expect(preference.status).toBe('DENIED');
    expect(event.status).toBe('DENIED');
  });

  it('edits only scoped patient fields and leaves consent history untouched', async () => {
    const token = await accessToken(tenantAId, membershipAId, activeSessionId, userAId);
    await request(app.getHttpServer())
      .post(`/api/patients/${patientA1Id}/consents`)
      .set('Authorization', `Bearer ${token}`)
      .send({ channel: 'WHATSAPP', purpose: 'MARKETING', status: 'GRANTED', source: 'MANUAL', evidenceType: 'SIGNED_DOCUMENT', evidenceReference: `signed-${suffix}` })
      .expect(201);
    const eventCountBefore = await db.consentEvent.count({ where: { tenantId: tenantAId, patientId: patientA1Id } });
    await request(app.getHttpServer())
      .patch(`/api/patients/${patientA1Id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ phone: '(31) 99876-5432', marketingConsent: 'REVOKED' })
      .expect(200);
    const [patient, preference, eventCountAfter] = await Promise.all([
      db.patient.findUniqueOrThrow({ where: { id: patientA1Id } }),
      db.consentPreference.findUniqueOrThrow({ where: { tenantId_patientId_channel_purpose: { tenantId: tenantAId, patientId: patientA1Id, channel: 'WHATSAPP', purpose: 'MARKETING' } } }),
      db.consentEvent.count({ where: { tenantId: tenantAId, patientId: patientA1Id } }),
    ]);
    expect(patient.phoneNormalized).toBe('31998765432');
    expect(preference.status).toBe('GRANTED');
    expect(eventCountAfter).toBe(eventCountBefore);
    const consentEvent = await db.consentEvent.findFirstOrThrow({ where: { tenantId: tenantAId, patientId: patientA1Id } });
    await expect(db.consentEvent.update({ where: { id: consentEvent.id }, data: { status: 'DENIED' } })).rejects.toThrow();
    await expect(db.consentEvent.delete({ where: { id: consentEvent.id } })).rejects.toThrow();
    await request(app.getHttpServer()).patch(`/api/patients/${patientA2Id}`).set('Authorization', `Bearer ${token}`).send({ fullName: 'Tentativa cross-unit' }).expect(403);
    await request(app.getHttpServer()).patch(`/api/patients/${patientBId}`).set('Authorization', `Bearer ${token}`).send({ fullName: 'Tentativa cross-tenant' }).expect(404);
    await request(app.getHttpServer()).patch(`/api/patients/${patientA1Id}/archive`).set('Authorization', `Bearer ${token}`).expect(403);
  });

  it('searches and paginates on the server with stable counts and unit filters', async () => {
    const adminToken = await accessToken(tenantAId, adminMembershipId, adminSessionId, adminUserId, UserRole.TENANT_ADMIN);
    const page1 = await request(app.getHttpServer()).get('/api/patients?search=Paciente%20unidade&page=1&pageSize=1&status=ALL').set('Authorization', `Bearer ${adminToken}`).expect(200);
    expect(page1.body.total).toBe(2);
    expect(page1.body.page).toBe(1);
    expect(page1.body.items).toHaveLength(1);
    const page2 = await request(app.getHttpServer()).get('/api/patients?search=Paciente%20unidade&page=2&pageSize=1&status=ALL').set('Authorization', `Bearer ${adminToken}`).expect(200);
    expect(page2.body.total).toBe(2);
    expect(page2.body.items).toHaveLength(1);
    expect(page2.body.items[0].id).not.toBe(page1.body.items[0].id);
    await request(app.getHttpServer()).get(`/api/patients?unitId=${unitA2Id}`).set('Authorization', `Bearer ${await accessToken(tenantAId, membershipAId, activeSessionId, userAId)}`).expect(403);
    await request(app.getHttpServer()).get('/api/patients?pageSize=101').set('Authorization', `Bearer ${adminToken}`).expect(400);
  });

  it('archives without deleting related records and suppresses pending messages', async () => {
    const adminToken = await accessToken(tenantAId, adminMembershipId, adminSessionId, adminUserId, UserRole.TENANT_ADMIN);
    const patient = await db.patient.create({ data: { tenantId: tenantAId, unitId: unitA1Id, fullName: `Paciente arquivamento ${suffix}` } });
    const appointment = await db.appointment.create({ data: { tenantId: tenantAId, unitId: unitA1Id, patientId: patient.id, startsAt: new Date(Date.now() + 10 * 86400000), endsAt: new Date(Date.now() + 10 * 86400000 + 30 * 60000) } });
    const outbox = await db.outboxMessage.create({ data: { tenantId: tenantAId, patientId: patient.id, purpose: 'MARKETING', channel: 'WHATSAPP', provider: 'META_CLOUD', body: 'pendente', idempotencyKey: `archive-${suffix}` } });
    const result = await request(app.getHttpServer()).patch(`/api/patients/${patient.id}/archive`).set('Authorization', `Bearer ${adminToken}`).expect(200);
    expect(result.body.suppressedOutboxCount).toBe(1);
    const [archived, preservedAppointment, suppressed] = await Promise.all([
      db.patient.findUniqueOrThrow({ where: { id: patient.id } }),
      db.appointment.findUniqueOrThrow({ where: { id: appointment.id } }),
      db.outboxMessage.findUniqueOrThrow({ where: { id: outbox.id } }),
    ]);
    expect(archived.deletedAt).toBeTruthy();
    expect(archived.active).toBe(false);
    expect(preservedAppointment.patientId).toBe(patient.id);
    expect(suppressed.status).toBe('SUPPRESSED');
    await request(app.getHttpServer()).get(`/api/patients?status=ARCHIVED&search=${encodeURIComponent(patient.fullName)}`).set('Authorization', `Bearer ${adminToken}`).expect(200).expect((response) => expect(response.body.items.map((item: { id: string }) => item.id)).toContain(patient.id));
  });

  it('adds tenant-scoped patient tags and append-only internal notes', async () => {
    const operatorToken = await accessToken(tenantAId, membershipAId, activeSessionId, userAId);
    const firstTag = await request(app.getHttpServer()).post(`/api/patients/${patientA1Id}/tags`).set('Authorization', `Bearer ${operatorToken}`).send({ name: `Retorno ${suffix}`, color: '#1677cc' }).expect(201);
    const reusedTag = await request(app.getHttpServer()).post(`/api/patients/${patientA1Id}/tags`).set('Authorization', `Bearer ${operatorToken}`).send({ name: `retorno ${suffix}`, color: '#1677cc' }).expect(201);
    expect(reusedTag.body.id).toBe(firstTag.body.id);
    const tags = await request(app.getHttpServer()).get(`/api/patients/${patientA1Id}/tags`).set('Authorization', `Bearer ${operatorToken}`).expect(200);
    expect(tags.body).toHaveLength(1);
    await request(app.getHttpServer()).post(`/api/patients/${patientA2Id}/notes`).set('Authorization', `Bearer ${operatorToken}`).send({ content: 'Acesso fora da unidade' }).expect(403);
    await request(app.getHttpServer()).post(`/api/patients/${patientBId}/notes`).set('Authorization', `Bearer ${operatorToken}`).send({ content: 'Acesso fora do tenant' }).expect(404);
    const addedNote = await request(app.getHttpServer()).post(`/api/patients/${patientA1Id}/notes`).set('Authorization', `Bearer ${operatorToken}`).send({ content: 'Confirmar retorno pela recepção' }).expect(201);
    expect(addedNote.body.authorUserId).toBe(userAId);
    const notes = await request(app.getHttpServer()).get(`/api/patients/${patientA1Id}/notes`).set('Authorization', `Bearer ${operatorToken}`).expect(200);
    expect(notes.body[0].content).toBe('Confirmar retorno pela recepção');
  });

  it('imports bounded CSV rows with preview-ready validation, duplicate detection, and unknown consent by default', async () => {
    const adminToken = await accessToken(tenantAId, adminMembershipId, adminSessionId, adminUserId, UserRole.TENANT_ADMIN);
    const phone = `219${Date.now().toString().slice(-8)}`;
    const imported = await request(app.getHttpServer()).post('/api/patients/import').set('Authorization', `Bearer ${adminToken}`).send({ unitId: unitA1Id, rows: [
      { fullName: `Importado ${suffix}`, phone, email: `import-${suffix}@example.test`, birthDate: '10/05/1990', source: 'CSV' },
      { fullName: `Duplicado ${suffix}`, phone },
      { fullName: 'x', phone: '123' },
    ] }).expect(201);
    expect(imported.body.imported).toBe(1);
    expect(imported.body.duplicates).toBe(1);
    expect(imported.body.errors).toHaveLength(1);
    const patient = await db.patient.findFirstOrThrow({ where: { tenantId: tenantAId, phoneNormalized: phone } });
    expect(patient.birthDate?.toISOString()).toBe('1990-05-10T00:00:00.000Z');
    expect(await db.consentPreference.count({ where: { tenantId: tenantAId, patientId: patient.id } })).toBe(0);
    await request(app.getHttpServer()).post('/api/patients/import').set('Authorization', `Bearer ${adminToken}`).send({ unitId: unitA1Id, rows: Array.from({ length: 501 }, () => ({ fullName: 'Paciente' })) }).expect(400);
  });

  it('previews bounded XLSX values, supports sheet selection, and rejects formulas without granting consent', async () => {
    const adminToken = await accessToken(tenantAId, adminMembershipId, adminSessionId, adminUserId, UserRole.TENANT_ADMIN);
    const workbook = new ExcelJS.Workbook();
    const first = workbook.addWorksheet('Importar');
    first.addRow(['Paciente', 'Celular', 'Email', 'Nascimento']);
    first.addRow(['XLSX Cliente', '5511991234567', 'xlsx@example.test', '10/05/1990']);
    const second = workbook.addWorksheet('Outra aba');
    second.addRow(['Paciente']);
    second.addRow(['Cliente da segunda aba']);
    const bytes = await workbook.xlsx.writeBuffer();
    const response = await request(app.getHttpServer())
      .post('/api/patients/import/preview')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', Buffer.from(bytes), { filename: 'pacientes.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      .expect(201);
    expect(response.body.sheets).toEqual(['Importar', 'Outra aba']);
    expect(response.body.headers).toEqual(['Paciente', 'Celular', 'Email', 'Nascimento']);
    expect(response.body.rows[0]).toEqual(['XLSX Cliente', '5511991234567', 'xlsx@example.test', '10/05/1990']);
    expect(response.body.consent).toBe('UNKNOWN_UNLESS_SEPARATELY_RECORDED');
    const selected = await request(app.getHttpServer())
      .post('/api/patients/import/preview')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('sheetName', 'Outra aba')
      .attach('file', Buffer.from(bytes), { filename: 'pacientes.xlsx' })
      .expect(201);
    expect(selected.body.sheetName).toBe('Outra aba');

    const formulaWorkbook = new ExcelJS.Workbook();
    const formulaSheet = formulaWorkbook.addWorksheet('Formula');
    formulaSheet.addRow(['Nome']);
    formulaSheet.getCell('A2').value = { formula: 'CONCAT("Nome","Paciente")' };
    const formulaBytes = await formulaWorkbook.xlsx.writeBuffer();
    await request(app.getHttpServer())
      .post('/api/patients/import/preview')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', Buffer.from(formulaBytes), { filename: 'formula.xlsx' })
      .expect(400);

    await request(app.getHttpServer())
      .post('/api/patients/import/preview')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', Buffer.from('not an xlsx archive'), { filename: 'malformed.xlsx', contentType: 'text/plain' })
      .expect(400);
  });

  it('serializes simultaneous conversation claims and keeps assignment history scoped', async () => {
    const operatorToken = await accessToken(tenantAId, membershipAId, activeSessionId, userAId);
    const adminToken = await accessToken(tenantAId, adminMembershipId, adminSessionId, adminUserId, UserRole.TENANT_ADMIN);
    const secondUser = await db.user.create({ data: { email: `e2e-second-${suffix}@example.test`, displayName: 'Segundo operador', passwordHash: 'not-used-in-this-test' } });
    const secondMembership = await db.membership.create({ data: { tenantId: tenantAId, userId: secondUser.id, role: UserRole.OPERATOR } });
    await db.unitMembership.create({ data: { tenantId: tenantAId, membershipId: secondMembership.id, unitId: unitA1Id } });
    const secondSession = await db.authSession.create({ data: { tenantId: tenantAId, userId: secondUser.id, membershipId: secondMembership.id, tokenHash: `e2e-second-${suffix}`, expiresAt: new Date(Date.now() + 60_000) } });
    const secondToken = await accessToken(tenantAId, secondMembership.id, secondSession.id, secondUser.id);
    const conversation = await db.conversation.create({ data: { tenantId: tenantAId, unitId: unitA1Id, patientId: patientA1Id, assignedToId: null } });
    const claim = () => request(app.getHttpServer()).post(`/api/inbox/conversations/${conversation.id}/claim`).set('Authorization', `Bearer ${operatorToken}`);
    const competingClaim = () => request(app.getHttpServer()).post(`/api/inbox/conversations/${conversation.id}/claim`).set('Authorization', `Bearer ${secondToken}`);
    const claims = await Promise.all([claim(), competingClaim()]);
    expect(claims.map((response) => response.status).sort()).toEqual([201, 409]);
    expect(await db.conversationAssignment.count({ where: { tenantId: tenantAId, conversationId: conversation.id, action: 'CLAIMED' } })).toBe(1);

    await request(app.getHttpServer())
      .patch(`/api/inbox/conversations/${conversation.id}/assignment`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ assigneeId: userAId })
      .expect(200);
    const history = await request(app.getHttpServer())
      .get(`/api/inbox/conversations/${conversation.id}/assignment-history`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .expect(200);
    expect(history.body).toHaveLength(2);
    expect(history.body[0].action).toBe('TRANSFERRED');
    await request(app.getHttpServer())
      .get(`/api/inbox/conversations/${conversation.id}/assignment-history`)
      .set('Authorization', `Bearer ${await accessToken(tenantBId, membershipAId, activeSessionId, userAId)}`)
      .expect(401);
  });

  it('creates and completes unit-scoped tasks with append-only history and role checks', async () => {
    const operatorToken = await accessToken(tenantAId, membershipAId, activeSessionId, userAId);
    const adminToken = await accessToken(tenantAId, adminMembershipId, adminSessionId, adminUserId, UserRole.TENANT_ADMIN);
    const created = await request(app.getHttpServer())
      .post('/api/tasks')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ unitId: unitA1Id, patientId: patientA1Id, title: 'Retornar contato', priority: 'HIGH', dueAt: new Date(Date.now() + 3600_000).toISOString() })
      .expect(201);
    expect(created.body.assignedToId).toBe(userAId);
    await request(app.getHttpServer())
      .post('/api/tasks')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ unitId: unitA2Id, title: 'Fora da unidade', assignedToId: userAId })
      .expect(403);
    await request(app.getHttpServer())
      .patch(`/api/tasks/${created.body.id}`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ assignedToId: adminUserId })
      .expect(403);
    const done = await request(app.getHttpServer())
      .patch(`/api/tasks/${created.body.id}/status`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ status: 'DONE' })
      .expect(200);
    expect(done.body.completedAt).toBeTruthy();
    const history = await request(app.getHttpServer()).get(`/api/tasks/${created.body.id}/history`).set('Authorization', `Bearer ${adminToken}`).expect(200);
    expect(history.body.map((event: { action: string }) => event.action)).toEqual(['STATUS_CHANGED', 'CREATED']);
    const listed = await request(app.getHttpServer()).get('/api/tasks?status=DONE').set('Authorization', `Bearer ${operatorToken}`).expect(200);
    expect(listed.body.some((task: { id: string }) => task.id === created.body.id)).toBe(true);
  });

  it('keeps configurable pipeline stages separate from technical conversation statuses', async () => {
    const operatorToken = await accessToken(tenantAId, membershipAId, activeSessionId, userAId);
    const adminToken = await accessToken(tenantAId, adminMembershipId, adminSessionId, adminUserId, UserRole.TENANT_ADMIN);
    const initialStages = await request(app.getHttpServer()).get('/api/inbox/stages').set('Authorization', `Bearer ${operatorToken}`).expect(200);
    expect(initialStages.body.map((stage: { name: string }) => stage.name)).toEqual(['Novo atendimento', 'Triagem', 'Em atendimento', 'Aguardando paciente', 'Agendado', 'Pós-atendimento', 'Encerrado']);
    await request(app.getHttpServer()).post('/api/inbox/stages').set('Authorization', `Bearer ${operatorToken}`).send({ name: 'Bloqueado', position: 2 }).expect(403);
    const conversation = await db.conversation.create({ data: { tenantId: tenantAId, unitId: unitA1Id, patientId: patientA1Id } });
    await request(app.getHttpServer()).patch(`/api/inbox/conversations/${conversation.id}/status`).set('Authorization', `Bearer ${operatorToken}`).send({ status: 'WAITING_HUMAN' }).expect(200);
    await request(app.getHttpServer()).patch(`/api/inbox/conversations/${conversation.id}/stage`).set('Authorization', `Bearer ${operatorToken}`).send({ stageId: initialStages.body[1].id }).expect(200);
    const saved = await db.conversation.findUniqueOrThrow({ where: { id: conversation.id } });
    expect(saved.status).toBe('WAITING_HUMAN');
    expect(saved.pipelineStageId).toBe(initialStages.body[1].id);
    const history = await request(app.getHttpServer()).get(`/api/inbox/conversations/${conversation.id}/stage-history`).set('Authorization', `Bearer ${operatorToken}`).expect(200);
    expect(history.body).toHaveLength(1);
    await request(app.getHttpServer()).post('/api/inbox/stages').set('Authorization', `Bearer ${adminToken}`).send({ name: 'Revisão humana', position: 1 }).expect(201);
    await request(app.getHttpServer()).patch(`/api/inbox/stages/${initialStages.body[1].id}`).set('Authorization', `Bearer ${adminToken}`).send({ active: false }).expect(200);
    const reassigned = await db.conversation.findUniqueOrThrow({ where: { id: conversation.id } });
    expect(reassigned.pipelineStageId).toBe(initialStages.body[0].id);
    expect(reassigned.status).toBe('WAITING_HUMAN');
  });

  it('moves conversations across the inbox Kanban with unit isolation and audit history', async () => {
    const operatorToken = await accessToken(tenantAId, membershipAId, activeSessionId, userAId);
    const conversation = await db.conversation.create({ data: { tenantId: tenantAId, unitId: unitA1Id, patientId: patientA1Id } });
    const moved = await request(app.getHttpServer()).patch(`/api/inbox/conversations/${conversation.id}/status`).set('Authorization', `Bearer ${operatorToken}`).send({ status: 'WAITING_HUMAN' }).expect(200);
    expect(moved.body.status).toBe('WAITING_HUMAN');
    expect(await db.auditEvent.count({ where: { tenantId: tenantAId, action: 'CONVERSATION_STATUS_CHANGED', entityId: conversation.id } })).toBe(1);
    const outside = await db.conversation.create({ data: { tenantId: tenantAId, unitId: unitA2Id, patientId: patientA2Id } });
    await request(app.getHttpServer()).patch(`/api/inbox/conversations/${outside.id}/status`).set('Authorization', `Bearer ${operatorToken}`).send({ status: 'CLOSED' }).expect(404);
  });

  it('creates appointments only inside the assigned unit and serializes overlapping bookings', async () => {
    const token = await accessToken(
      tenantAId,
      membershipAId,
      activeSessionId,
      userAId,
    );
    const startsAt = new Date(Date.now() + 5 * 86400000);
    startsAt.setUTCHours(15, 0, 0, 0);
    const endsAt = new Date(startsAt.getTime() + 30 * 60000);
    const body = {
      unitId: unitA1Id,
      patientId: patientA1Id,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
    };
    const createdAppointment = await request(app.getHttpServer())
      .post('/api/appointments')
      .set('Authorization', `Bearer ${token}`)
      .send(body)
      .expect(201);
    await request(app.getHttpServer())
      .patch(`/api/appointments/${createdAppointment.body.id}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'COMPLETED' })
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/appointments')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...body, patientId: patientA1Id })
      .expect(400);
    await request(app.getHttpServer())
      .patch(`/api/appointments/${createdAppointment.body.id}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'CONFIRMED' })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/api/appointments/${createdAppointment.body.id}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'CANCELLED' })
      .expect(200);
    const raceStart = new Date(startsAt.getTime() + 60 * 60000);
    const raceBody = {
      ...body,
      startsAt: raceStart.toISOString(),
      endsAt: new Date(raceStart.getTime() + 30 * 60000).toISOString(),
    };
    const raceResults = await Promise.all(
      [1, 2].map(() =>
        request(app.getHttpServer())
          .post('/api/appointments')
          .set('Authorization', `Bearer ${token}`)
          .send(raceBody),
      ),
    );
    expect(raceResults.map((response) => response.status).sort()).toEqual([
      201, 400,
    ]);
    await request(app.getHttpServer())
      .post('/api/appointments')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...body, unitId: unitA2Id, patientId: patientA2Id })
      .expect(403);
  });

  it('reschedules native appointments transactionally and refuses a conflicting slot', async () => {
    const token = await accessToken(tenantAId, membershipAId, activeSessionId, userAId);
    const start = new Date(Date.now() + 20 * 86400000);
    start.setUTCHours(10, 0, 0, 0);
    const create = (at: Date) => request(app.getHttpServer()).post('/api/appointments').set('Authorization', `Bearer ${token}`).send({ unitId: unitA1Id, patientId: patientA1Id, startsAt: at.toISOString(), endsAt: new Date(at.getTime() + 30 * 60_000).toISOString() }).expect(201);
    const first = await create(start);
    const secondStart = new Date(start.getTime() + 2 * 60 * 60_000);
    const second = await create(secondStart);
    await request(app.getHttpServer()).patch(`/api/appointments/${second.body.id}/reschedule`).set('Authorization', `Bearer ${token}`).send({ startsAt: start.toISOString(), endsAt: new Date(start.getTime() + 30 * 60_000).toISOString() }).expect(400);
    const freeStart = new Date(start.getTime() + 4 * 60 * 60_000);
    const moved = await request(app.getHttpServer()).patch(`/api/appointments/${second.body.id}/reschedule`).set('Authorization', `Bearer ${token}`).send({ startsAt: freeStart.toISOString(), endsAt: new Date(freeStart.getTime() + 30 * 60_000).toISOString() }).expect(200);
    expect(moved.body.startsAt).toBe(freeStart.toISOString());
    expect(await db.auditEvent.count({ where: { tenantId: tenantAId, action: 'APPOINTMENT_RESCHEDULED', entityId: second.body.id } })).toBe(1);
    expect(first.body.id).not.toBe(second.body.id);
  });

  it('lists calendar appointments by unit, exposes audit details, and links reception tasks', async () => {
    const token = await accessToken(tenantAId, adminMembershipId, adminSessionId, adminUserId, UserRole.TENANT_ADMIN);
    const start = new Date(Date.now() + 12 * 86400000);
    const procedure = await db.procedure.create({ data: { tenantId: tenantAId, unitId: unitA1Id, name: `Agenda procedure ${suffix}`, appointmentDurationMinutes: 45 } });
    const created = await request(app.getHttpServer()).post('/api/appointments').set('Authorization', `Bearer ${token}`).send({ unitId: unitA1Id, patientId: patientA1Id, procedureId: procedure.id, startsAt: start.toISOString() }).expect(201);
    expect(new Date(created.body.endsAt).getTime() - new Date(created.body.startsAt).getTime()).toBe(45 * 60_000);
    const filtered = await request(app.getHttpServer()).get(`/api/appointments?from=${encodeURIComponent(new Date(start.getTime() - 60_000).toISOString())}&to=${encodeURIComponent(new Date(start.getTime() + 60 * 60_000).toISOString())}&unitId=${unitA1Id}`).set('Authorization', `Bearer ${token}`).expect(200);
    expect(filtered.body.some((row: { id: string }) => row.id === created.body.id)).toBe(true);
    const detail = await request(app.getHttpServer()).get(`/api/appointments/${created.body.id}`).set('Authorization', `Bearer ${token}`).expect(200);
    expect(detail.body).toMatchObject({ id: created.body.id, patient: { id: patientA1Id }, procedure: { id: procedure.id }, createdBy: { id: adminUserId } });
    expect(detail.body.history.some((event: { action: string }) => event.action === 'APPOINTMENT_CREATED')).toBe(true);
    const task = await request(app.getHttpServer()).post('/api/tasks').set('Authorization', `Bearer ${token}`).send({ unitId: unitA1Id, appointmentId: created.body.id, title: `Reception task ${suffix}` }).expect(201);
    expect(task.body.appointmentId).toBe(created.body.id);
    const tasks = await request(app.getHttpServer()).get(`/api/tasks?appointmentId=${created.body.id}`).set('Authorization', `Bearer ${token}`).expect(200);
    expect(tasks.body.some((row: { id: string }) => row.id === task.body.id)).toBe(true);
  });

  it('returns point availability, rejects invalid procedure/unit pairs, and prevents local writes for Uno-sourced appointments', async () => {
    const token = await accessToken(tenantAId, adminMembershipId, adminSessionId, adminUserId, UserRole.TENANT_ADMIN);
    const start = new Date(Date.now() + 16 * 86400000);
    const procedure = await db.procedure.create({ data: { tenantId: tenantAId, unitId: unitA1Id, name: `Availability procedure ${suffix}`, appointmentDurationMinutes: 30 } });
    const result = await request(app.getHttpServer()).get(`/api/appointments/availability?unitId=${unitA1Id}&procedureId=${procedure.id}&startsAt=${encodeURIComponent(start.toISOString())}`).set('Authorization', `Bearer ${token}`).expect(200);
    expect(result.body).toMatchObject({ available: true, writable: true, durationMinutes: 30, sourceOfTruth: 'NATIVE' });
    await request(app.getHttpServer()).get(`/api/appointments/availability?unitId=${unitA1Id}&procedureId=${procedure.id}&startsAt=invalid`).set('Authorization', `Bearer ${token}`).expect(400);
    await request(app.getHttpServer()).get(`/api/appointments/availability?unitId=${unitA2Id}&procedureId=${procedure.id}&startsAt=${encodeURIComponent(start.toISOString())}`).set('Authorization', `Bearer ${token}`).expect(400);
    const uno = await db.appointment.create({ data: { tenantId: tenantAId, unitId: unitA1Id, patientId: patientA1Id, startsAt: start, endsAt: new Date(start.getTime() + 30 * 60_000), status: 'CONFIRMED', source: 'UNO' } });
    await request(app.getHttpServer()).patch(`/api/appointments/${uno.id}/status`).set('Authorization', `Bearer ${token}`).send({ status: 'COMPLETED' }).expect(400);
    try {
      await db.unoConnection.create({ data: { tenantId: tenantAId, unitId: unitA2Id, webhookTokenHash: `unit-source-${suffix}`, sourceOfTruth: 'UNO' } });
      const sourceStatus = await request(app.getHttpServer()).get(`/api/integrations/uno/${unitA2Id}/status`).set('Authorization', `Bearer ${token}`).expect(200);
      expect(sourceStatus.body.activeSource).toBe('UNO');
      const localCopy = await db.appointment.create({ data: { tenantId: tenantAId, unitId: unitA2Id, patientId: patientA2Id, startsAt: start, endsAt: new Date(start.getTime() + 30 * 60_000), status: 'CONFIRMED', source: 'NATIVE' } });
      await request(app.getHttpServer()).patch(`/api/appointments/${localCopy.id}/status`).set('Authorization', `Bearer ${token}`).send({ status: 'COMPLETED' }).expect(400);
      const unavailable = await request(app.getHttpServer()).get(`/api/appointments/availability?unitId=${unitA2Id}&startsAt=${encodeURIComponent(start.toISOString())}`).set('Authorization', `Bearer ${token}`).expect(200);
      expect(unavailable.body).toMatchObject({ sourceOfTruth: 'UNO', writable: false, available: false });
    } finally {
      await db.unoConnection.deleteMany({ where: { tenantId: tenantAId, unitId: unitA2Id } });
    }
  });

  it('rejects past bookings and future completion without emitting completion side effects', async () => {
    const token = await accessToken(tenantAId, adminMembershipId, adminSessionId, adminUserId, UserRole.TENANT_ADMIN);
    const past = new Date('2020-01-01T12:00:00.000Z');
    const pastAvailability = await request(app.getHttpServer()).get(`/api/appointments/availability?unitId=${unitA1Id}&startsAt=${encodeURIComponent(past.toISOString())}`).set('Authorization', `Bearer ${token}`).expect(200);
    expect(pastAvailability.body).toMatchObject({ available: false, reasonCode: 'PAST_TIME' });
    await request(app.getHttpServer()).post('/api/appointments').set('Authorization', `Bearer ${token}`).send({ unitId: unitA1Id, patientId: patientA1Id, startsAt: past.toISOString(), durationMinutes: 30 }).expect(400);

    const startsAt = new Date(Date.now() + 48 * 60 * 60_000);
    const created = await request(app.getHttpServer()).post('/api/appointments').set('Authorization', `Bearer ${token}`).send({ unitId: unitA1Id, patientId: patientA1Id, startsAt: startsAt.toISOString(), durationMinutes: 30 }).expect(201);
    await request(app.getHttpServer()).patch(`/api/appointments/${created.body.id}/status`).set('Authorization', `Bearer ${token}`).send({ status: 'CONFIRMED' }).expect(200);
    await request(app.getHttpServer()).patch(`/api/appointments/${created.body.id}/status`).set('Authorization', `Bearer ${token}`).send({ status: 'COMPLETED' }).expect(400);
    expect(await db.appointment.findUniqueOrThrow({ where: { id: created.body.id } })).toMatchObject({ status: 'CONFIRMED', completedAt: null });
    expect(await db.auditEvent.count({ where: { tenantId: tenantAId, entityType: 'Appointment', entityId: created.body.id, action: 'APPOINTMENT_STATUS_CHANGED' } })).toBe(1);
    expect(await db.npsSurvey.count({ where: { tenantId: tenantAId, appointmentId: created.body.id } })).toBe(0);

    const elapsedStart = new Date(Date.now() - 60_000);
    await db.appointment.update({ where: { id: created.body.id }, data: { startsAt: elapsedStart, endsAt: new Date(elapsedStart.getTime() + 30 * 60_000) } });
    await request(app.getHttpServer()).patch(`/api/appointments/${created.body.id}/status`).set('Authorization', `Bearer ${token}`).send({ status: 'COMPLETED' }).expect(200);
    expect(await db.appointment.findUniqueOrThrow({ where: { id: created.body.id } })).toMatchObject({ status: 'COMPLETED' });
  });

  it('allocates separate resources in parallel and enforces native unit hours', async () => {
    const admin = await accessToken(tenantAId, adminMembershipId, adminSessionId, adminUserId, UserRole.TENANT_ADMIN);
    const operator = await accessToken(tenantAId, membershipAId, activeSessionId, userAId);
    const testUnit = await db.unit.create({ data: { tenantId: tenantAId, name: 'Resource schedule ' + suffix, slug: 'resource-schedule-' + suffix } });
    const testPatient = await db.patient.create({ data: { tenantId: tenantAId, unitId: testUnit.id, fullName: 'Resource schedule patient ' + suffix } });
    const procedure = await db.procedure.create({ data: { tenantId: tenantAId, unitId: testUnit.id, name: 'Resource schedule ' + suffix, appointmentDurationMinutes: 30 } });
    const resourceRows = await Promise.all([
      ['PROFESSIONAL', 'Professional A'], ['PROFESSIONAL', 'Professional B'], ['ROOM', 'Room A'], ['ROOM', 'Room B'],
    ].map(([type, name]) => request(app.getHttpServer()).post('/api/resources').set('Authorization', 'Bearer ' + admin).send({ unitId: testUnit.id, type, name: name + suffix }).expect(201)));
    const [professionalA, professionalB, roomA, roomB] = resourceRows.map((row) => row.body as { id: string });
    const requirementResponse = await request(app.getHttpServer()).put('/api/resources/procedure-requirements/' + procedure.id).set('Authorization', 'Bearer ' + admin).send({ unitId: testUnit.id, requirements: [{ resourceType: 'PROFESSIONAL', quantity: 1 }, { resourceType: 'ROOM', quantity: 1 }] });
    expect(requirementResponse.status, JSON.stringify(requirementResponse.body)).toBe(200);
    await request(app.getHttpServer()).put('/api/units/' + testUnit.id + '/schedule/weekly').set('Authorization', 'Bearer ' + admin).send({ enabled: true, intervals: [{ weekday: 1, startMinute: 540, endMinute: 720 }, { weekday: 1, startMinute: 780, endMinute: 1020 }, { weekday: 2, startMinute: 540, endMinute: 1020 }] }).expect(200);
    const at = (hour: number) => new Date(Date.UTC(2030, 2, 4, hour + 3, 0, 0)); // Monday, São Paulo
    const booking = (start: Date, resourceIds: string[]) => request(app.getHttpServer()).post('/api/appointments').set('Authorization', 'Bearer ' + admin).send({ unitId: testUnit.id, patientId: testPatient.id, procedureId: procedure.id, startsAt: start.toISOString(), resourceIds });
    const first = await booking(at(9), [professionalA.id, roomA.id]).expect(201);
    const parallel = await booking(at(9), [professionalB.id, roomB.id]).expect(201);
    expect(parallel.body.id).not.toBe(first.body.id);
    await booking(at(9), [professionalA.id, roomB.id]).expect(400);
    await booking(at(9), [professionalB.id, roomA.id]).expect(400);
    await booking(at(11), []).expect(400); // required professional and room cannot be omitted
    const rescheduleCandidate = await booking(at(11), [professionalB.id, roomB.id]).expect(201);
    await request(app.getHttpServer()).patch('/api/appointments/' + rescheduleCandidate.body.id + '/reschedule').set('Authorization', 'Bearer ' + admin).send({ startsAt: at(9).toISOString() }).expect(400);
    await db.appointment.create({ data: { tenantId: tenantAId, unitId: testUnit.id, patientId: testPatient.id, procedureId: procedure.id, startsAt: at(10), endsAt: new Date(at(10).getTime() + 30 * 60000), status: 'PENDING' } });
    await booking(at(10), [professionalA.id, roomB.id]).expect(400); // old resource-less rows occupy the whole unit
    const outside = await request(app.getHttpServer()).get('/api/appointments/availability?unitId=' + testUnit.id + '&procedureId=' + procedure.id + '&startsAt=' + encodeURIComponent(at(19).toISOString()) + '&resourceIds=' + professionalA.id + ',' + roomA.id).set('Authorization', 'Bearer ' + admin).expect(200);
    expect(outside.body).toMatchObject({ available: false, reason: 'O horário está fora do expediente configurado para a unidade.' });
    await request(app.getHttpServer()).put('/api/units/' + testUnit.id + '/schedule/exceptions/2030-03-05').set('Authorization', 'Bearer ' + admin).send({ closed: true, label: 'Holiday E2E', intervals: [] }).expect(200);
    const closed = await request(app.getHttpServer()).get('/api/appointments/availability?unitId=' + testUnit.id + '&procedureId=' + procedure.id + '&startsAt=2030-03-05T13:00:00.000Z&resourceIds=' + professionalA.id + ',' + roomA.id).set('Authorization', 'Bearer ' + admin).expect(200);
    expect(closed.body).toMatchObject({ available: false, reason: 'A unidade está fechada nesta data.' });
    const raceBody = { unitId: testUnit.id, patientId: testPatient.id, procedureId: procedure.id, startsAt: at(13).toISOString(), resourceIds: [professionalA.id, roomA.id] };
    const race = await Promise.all([1, 2].map(() => request(app.getHttpServer()).post('/api/appointments').set('Authorization', 'Bearer ' + admin).send(raceBody)));
    expect(race.map((result) => result.status).sort()).toEqual([201, 400]);
    await request(app.getHttpServer()).get('/api/resources?unitId=' + testUnit.id).set('Authorization', 'Bearer ' + operator).expect(403);
    await request(app.getHttpServer()).post('/api/appointments').set('Authorization', 'Bearer ' + operator).send(raceBody).expect(403);
    expect(await db.auditEvent.count({ where: { tenantId: tenantAId, entityType: 'Appointment', entityId: first.body.id, action: 'APPOINTMENT_CREATED' } })).toBe(1);
    await db.appointment.deleteMany({ where: { tenantId: tenantAId, unitId: testUnit.id, procedureId: procedure.id } });
    await db.unitScheduleException.deleteMany({ where: { tenantId: tenantAId, unitId: testUnit.id } });
    await db.unitWorkingInterval.deleteMany({ where: { tenantId: tenantAId, unitId: testUnit.id } });
    await db.procedureResourceRequirement.deleteMany({ where: { tenantId: tenantAId, procedureId: procedure.id } });
    await db.unitResource.deleteMany({ where: { tenantId: tenantAId, unitId: testUnit.id, id: { in: [professionalA.id, professionalB.id, roomA.id, roomB.id] } } });
    await db.procedure.delete({ where: { id: procedure.id } });
    await db.patient.delete({ where: { id: testPatient.id } });
    await db.unit.delete({ where: { id: testUnit.id } });
  });

  it('does not expose inbox records outside the operator unit', async () => {
    const token = await accessToken(
      tenantAId,
      membershipAId,
      activeSessionId,
      userAId,
    );
    await request(app.getHttpServer())
      .post('/api/inbox/conversations')
      .set('Authorization', `Bearer ${token}`)
      .send({ unitId: unitA2Id, patientId: patientA2Id })
      .expect(403);
    const campaign = await request(app.getHttpServer())
      .post('/api/campaigns')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Campanha fora do papel', body: 'Teste' })
      .expect(201);
    expect(campaign.body.status).toBe('DRAFT');
  });

  it('approves a Meta-only campaign into consent-filtered idempotent outbox', async () => {
    const token = await accessToken(
      tenantAId,
      adminMembershipId,
      adminSessionId,
      adminUserId,
      UserRole.TENANT_ADMIN,
    );
    await db.consentPreference.upsert({
      where: {
        tenantId_patientId_channel_purpose: {
          tenantId: tenantAId,
          patientId: patientA1Id,
          channel: 'WHATSAPP',
          purpose: 'MARKETING',
        },
      },
      create: {
        tenantId: tenantAId,
        patientId: patientA1Id,
        channel: 'WHATSAPP',
        purpose: 'MARKETING',
        status: 'GRANTED',
        source: 'MANUAL',
        evidence: 'E2E authorized',
      },
      update: {
        status: 'GRANTED',
        source: 'MANUAL',
        evidence: 'E2E authorized',
      },
    });
    const created = await request(app.getHttpServer())
      .post('/api/campaigns')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Campanha E2E',
        body: 'Olá, {{paciente.primeiroNome}}!',
        provider: 'META_CLOUD',
      })
      .expect(201);
    await request(app.getHttpServer()).post(`/api/campaigns/${created.body.id}/approve`).set('Authorization', `Bearer ${token}`).expect(400);
    const audience = await request(app.getHttpServer()).get('/api/campaigns/audience?search=Paciente').set('Authorization', `Bearer ${token}`).expect(200);
    expect(audience.body.some((patient: { id: string }) => patient.id === patientA1Id)).toBe(true);
    const edited = await request(app.getHttpServer()).patch(`/api/campaigns/${created.body.id}`).set('Authorization', `Bearer ${token}`).send({ name: 'Campanha E2E revisada', audiencePatientIds: [patientA1Id] }).expect(200);
    expect(edited.body.audiencePatientIds).toEqual([patientA1Id]);
    const future = new Date(Date.now() + 86400000).toISOString();
    const scheduled = await request(app.getHttpServer()).patch(`/api/campaigns/${created.body.id}`).set('Authorization', `Bearer ${token}`).send({ scheduledAt: future }).expect(200);
    expect(scheduled.body.scheduledAt).toBe(future);
    const unscheduled = await request(app.getHttpServer()).patch(`/api/campaigns/${created.body.id}`).set('Authorization', `Bearer ${token}`).send({ scheduledAt: null }).expect(200);
    expect(new Date(unscheduled.body.scheduledAt).getTime()).toBeLessThan(new Date(future).getTime());
    const approved = await request(app.getHttpServer())
      .post(`/api/campaigns/${created.body.id}/approve`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    expect(approved.body.queuedCount).toBe(1);
    expect(approved.body.sendsEnabled).toBe(false);
    const queued = await db.outboxMessage.findUniqueOrThrow({
      where: {
        tenantId_idempotencyKey: {
          tenantId: tenantAId,
          idempotencyKey: `campaign:${created.body.id}:patient:${patientA1Id}`,
        },
      },
    });
    expect(queued.provider).toBe('META_CLOUD');
    expect(queued.status).toBe('PENDING');
    expect(queued.body).toBe('Olá, Paciente!');
  });

  it('links one patient to an immediate Baileys stage campaign and cancels pending work when edited', async () => {
    const token = await accessToken(tenantAId, adminMembershipId, adminSessionId, adminUserId, UserRole.TENANT_ADMIN);
    const campaign = await request(app.getHttpServer()).post('/api/campaigns').set('Authorization', `Bearer ${token}`)
      .send({ name: `Etapa individual ${suffix}`, mode: 'STAGE', provider: 'EVOLUTION_BAILEYS', body: 'Olá, {{paciente.primeiroNome}}!' }).expect(201);
    expect(campaign.body.provider).toBe('EVOLUTION_BAILEYS');
    await request(app.getHttpServer()).get('/api/inbox/stages').set('Authorization', `Bearer ${token}`).expect(200);
    const stage = await request(app.getHttpServer()).post('/api/inbox/stages').set('Authorization', `Bearer ${token}`)
      .send({ name: `Aguardando retorno ${suffix}`, position: 90, campaignId: campaign.body.id, inactivityDays: 0 }).expect(201);
    const conversation = await request(app.getHttpServer()).post('/api/inbox/conversations').set('Authorization', `Bearer ${token}`)
      .send({ unitId: unitA1Id, patientId: patientA1Id }).expect(201);
    await request(app.getHttpServer()).patch(`/api/inbox/conversations/${conversation.body.id}/stage`).set('Authorization', `Bearer ${token}`)
      .send({ stageId: stage.body.id, enrollCampaign: true }).expect(200);
    const enrollment = await db.stageCampaignEnrollment.findFirstOrThrow({ where: { tenantId: tenantAId, conversationId: conversation.body.id, stageId: stage.body.id } });
    expect(enrollment.status).toBe('PENDING');
    expect(enrollment.inactivityDays).toBe(0);
    expect(enrollment.body).toBe('Olá, {{paciente.primeiroNome}}!');
    await request(app.getHttpServer()).patch(`/api/campaigns/${campaign.body.id}`).set('Authorization', `Bearer ${token}`)
      .send({ body: 'Podemos ajudar, {{paciente.primeiroNome}}?' }).expect(200);
    expect((await db.stageCampaignEnrollment.findUniqueOrThrow({ where: { id: enrollment.id } })).status).toBe('CANCELLED');
  });

  it('reports usage against the persisted billing cycle and blocks exhausted message quota', async () => {
    const adminToken = await accessToken(tenantAId, adminMembershipId, adminSessionId, adminUserId, UserRole.TENANT_ADMIN);
    const usage = await request(app.getHttpServer()).get('/api/usage').set('Authorization', `Bearer ${adminToken}`).expect(200);
    expect(usage.body.usage.messages).toEqual({ current: 1, limit: 1 });
    expect(usage.body.usage.campaigns).toEqual({ current: 1, limit: 1 });
    await db.consentPreference.upsert({
      where: { tenantId_patientId_channel_purpose: { tenantId: tenantAId, patientId: patientA1Id, channel: 'WHATSAPP', purpose: 'APPOINTMENT_REMINDER' } },
      create: { tenantId: tenantAId, patientId: patientA1Id, channel: 'WHATSAPP', purpose: 'APPOINTMENT_REMINDER', status: 'GRANTED', source: 'MANUAL', evidence: 'E2E authorized' },
      update: { status: 'GRANTED', source: 'MANUAL', evidence: 'E2E authorized' },
    });
    const conversation = await db.conversation.create({ data: { tenantId: tenantAId, unitId: unitA1Id, patientId: patientA1Id } });
    await request(app.getHttpServer()).post(`/api/inbox/conversations/${conversation.id}/messages`).set('Authorization', `Bearer ${adminToken}`).send({ body: 'Lembrete extra', purpose: 'APPOINTMENT_REMINDER' }).expect(402);
  });

  it('requires explicit AI data-processing authorization, encrypts the key, and scopes drafts by unit', async () => {
    const adminToken = await accessToken(tenantAId, adminMembershipId, adminSessionId, adminUserId, UserRole.TENANT_ADMIN);
    const disabled = await request(app.getHttpServer()).patch('/api/ai/settings').set('Authorization', `Bearer ${adminToken}`).send({ enabled: true, model: 'gpt-4o-mini', apiKey: 'sk-test-secret-value-with-length-over-20' }).expect(200);
    expect(disabled.body.enabled).toBe(false);
    const configured = await request(app.getHttpServer()).patch('/api/ai/settings').set('Authorization', `Bearer ${adminToken}`).send({ enabled: true, model: 'gpt-4o-mini', apiKey: 'sk-test-secret-value-with-length-over-20', conversationProcessingAuthorized: true }).expect(200);
    expect(configured.body.configured).toBe(true);
    expect(configured.body).not.toHaveProperty('apiKey');
    const saved = await db.aiSettings.findUniqueOrThrow({ where: { tenantId: tenantAId } });
    expect(saved.apiKeyEncrypted).not.toContain('sk-test-secret-value');
    const conversation = await db.conversation.create({ data: { tenantId: tenantAId, unitId: unitA2Id, patientId: patientA2Id } });
    const operatorToken = await accessToken(tenantAId, membershipAId, activeSessionId, userAId);
    await request(app.getHttpServer()).get(`/api/ai/conversations/${conversation.id}/drafts`).set('Authorization', `Bearer ${operatorToken}`).expect(403);
  });

  it('rejects spoofed inbound/AI messages and suppresses outbox after an explicit consent revocation', async () => {
    const token = await accessToken(
      tenantAId,
      membershipAId,
      activeSessionId,
      userAId,
    );
    await db.consentPreference.upsert({
      where: {
        tenantId_patientId_channel_purpose: {
          tenantId: tenantAId,
          patientId: patientA1Id,
          channel: 'WHATSAPP',
          purpose: 'MARKETING',
        },
      },
      create: {
        tenantId: tenantAId,
        patientId: patientA1Id,
        channel: 'WHATSAPP',
        purpose: 'MARKETING',
        status: 'GRANTED',
        source: 'MANUAL',
        evidence: 'E2E authorized',
      },
      update: {
        status: 'GRANTED',
        source: 'MANUAL',
        evidence: 'E2E authorized',
      },
    });
    await db.outboxMessage.create({
      data: {
        tenantId: tenantAId,
        patientId: patientA1Id,
        purpose: 'MARKETING',
        channel: 'WHATSAPP',
        provider: 'META_CLOUD',
        body: 'Future campaign',
        idempotencyKey: `optout-e2e-${suffix}`,
      },
    });
    const conversation = await request(app.getHttpServer())
      .post('/api/inbox/conversations')
      .set('Authorization', `Bearer ${token}`)
      .send({ unitId: unitA1Id, patientId: patientA1Id })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/inbox/conversations/${conversation.body.id}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ direction: 'INBOUND', body: 'STOP' })
      .expect(403);
    await request(app.getHttpServer())
      .post(`/api/inbox/conversations/${conversation.body.id}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ body: 'Spoofed AI message', purpose: 'MARKETING', actor: 'AI', approved: true })
      .expect(400);
    await request(app.getHttpServer())
      .post(`/api/patients/${patientA1Id}/consents`)
      .set('Authorization', `Bearer ${token}`)
      .send({ channel: 'WHATSAPP', purpose: 'MARKETING', status: 'REVOKED', source: 'MANUAL', evidence: 'E2E opt-out' })
      .expect(201);
    const [revoked, suppressed] = await Promise.all([
      db.consentPreference.findUniqueOrThrow({
        where: {
          tenantId_patientId_channel_purpose: {
            tenantId: tenantAId,
            patientId: patientA1Id,
            channel: 'WHATSAPP',
            purpose: 'MARKETING',
          },
        },
      }),
      db.outboxMessage.findUniqueOrThrow({
        where: {
          tenantId_idempotencyKey: {
            tenantId: tenantAId,
            idempotencyKey: `optout-e2e-${suffix}`,
          },
        },
      }),
    ]);
    expect(revoked.status).toBe('REVOKED');
    expect(suppressed.status).toBe('SUPPRESSED');
  });

  it('PostgreSQL composite keys reject a membership linked to another tenant unit', async () => {
    const unitB = await db.unit.findFirstOrThrow({
      where: { tenantId: tenantBId },
    });
    await expect(
      db.unitMembership.create({
        data: {
          tenantId: tenantAId,
          membershipId: membershipAId,
          unitId: unitB.id,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
  });

  it('rejects a JWT whose persisted session was revoked', async () => {
    const token = await accessToken(
      tenantAId,
      membershipAId,
      revokedSessionId,
      userAId,
    );
    await request(app.getHttpServer())
      .get('/api/patients')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
  });

  it('keeps a suspended tenant forbidden while treating a revoked session as unauthenticated', async () => {
    const token = await accessToken(tenantAId, membershipAId, activeSessionId, userAId);
    await db.tenant.update({ where: { id: tenantAId }, data: { status: 'SUSPENDED' } });
    try {
      await request(app.getHttpServer()).get('/api/patients').set('Authorization', `Bearer ${token}`).expect(403);
    } finally {
      await db.tenant.update({ where: { id: tenantAId }, data: { status: 'TRIAL' } });
    }
  });

  it('creates tenant-scoped quick replies for admins and rejects operator edits', async () => {
    const adminToken = await accessToken(tenantAId, adminMembershipId, adminSessionId, adminUserId, UserRole.TENANT_ADMIN);
    const operatorToken = await accessToken(tenantAId, membershipAId, activeSessionId, userAId);
    const created = await request(app.getHttpServer()).post('/api/quick-replies').set('Authorization', `Bearer ${adminToken}`).send({ name: 'Confirmação', category: 'Agenda', shortcut: `confirm-${suffix}`, body: 'Olá {{paciente.primeiroNome}}' }).expect(201);
    expect(created.body.tenantId).toBe(tenantAId);
    const listed = await request(app.getHttpServer()).get('/api/quick-replies').set('Authorization', `Bearer ${adminToken}`).expect(200);
    expect(listed.body.some((item: { id: string }) => item.id === created.body.id)).toBe(true);
    const conversation = await request(app.getHttpServer()).post('/api/inbox/conversations').set('Authorization', `Bearer ${adminToken}`).send({ unitId: unitA1Id, patientId: patientA1Id }).expect(201);
    const preview = await request(app.getHttpServer()).post(`/api/quick-replies/${created.body.id}/preview`).set('Authorization', `Bearer ${adminToken}`).send({ conversationId: conversation.body.id }).expect(201);
    expect(preview.body.canInsert).toBe(true);
    expect(preview.body.body).toContain('Paciente');
    await request(app.getHttpServer()).patch(`/api/quick-replies/${created.body.id}`).set('Authorization', `Bearer ${adminToken}`).send({ body: 'Olá {{paciente.nome}}' }).expect(200);
    await request(app.getHttpServer()).post('/api/quick-replies').set('Authorization', `Bearer ${operatorToken}`).send({ name: 'Sem permissão', category: 'Agenda', body: 'Oi' }).expect(403);
  });

  it('verifies signed Meta webhooks over the raw request body', async () => {
    const verify = await request(app.getHttpServer()).get('/api/meta/webhook').query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'meta-e2e-verify-token', 'hub.challenge': 'challenge-e2e' }).expect(200);
    expect(verify.text).toBe('challenge-e2e');
    const raw = JSON.stringify({ object: 'whatsapp_business_account', entry: [] });
    await request(app.getHttpServer()).post('/api/meta/webhook').set('content-type', 'application/json').set('x-hub-signature-256', 'sha256=invalid').send(JSON.parse(raw)).expect(401);
    const signature = createHmac('sha256', 'meta-e2e-secret').update(raw).digest('hex');
    await request(app.getHttpServer()).post('/api/meta/webhook').set('content-type', 'application/json').set('x-hub-signature-256', `sha256=${signature}`).send(JSON.parse(raw)).expect(201).expect(({ body }) => expect(body).toMatchObject({ accepted: true, enqueued: 0 }));
  });

  it('persists and deduplicates signed inbound messages and records inbound opt-out', async () => {
    const phone = `551188${Date.now().toString().slice(-8)}`;
    const patient = await db.patient.create({ data: { tenantId: tenantAId, unitId: unitA1Id, fullName: 'Paciente Webhook E2E', phone, phoneNormalized: phone } });
    const connection = await db.metaConnection.create({ data: { tenantId: tenantAId, unitId: unitA1Id, wabaId: `e2e-waba-${suffix}`, phoneNumberId: `e2e-phone-${suffix}`, accessTokenEncrypted: 'test-only-encrypted-placeholder', status: 'CONNECTED' } });
    await db.consentPreference.create({ data: { tenantId: tenantAId, patientId: patient.id, channel: 'WHATSAPP', purpose: 'MARKETING', status: 'GRANTED', source: 'MANUAL', evidence: 'Fixture E2E', evidenceType: 'WRITTEN_FORM', evidenceReference: `fixture-${suffix}` } });
    const outbox = await db.outboxMessage.create({ data: { tenantId: tenantAId, patientId: patient.id, purpose: 'MARKETING', channel: 'WHATSAPP', provider: 'META_CLOUD', body: 'Campanha fictícia pendente', idempotencyKey: `webhook-outbox-${suffix}` } });
    const payload = { object: 'whatsapp_business_account', entry: [{ id: connection.wabaId, changes: [{ field: 'messages', value: { metadata: { phone_number_id: connection.phoneNumberId }, messages: [{ id: `wamid.e2e.${suffix}`, from: phone, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: 'SAIR' } }] } }] }] };
    const raw = JSON.stringify(payload);
    const signature = createHmac('sha256', 'meta-e2e-secret').update(raw).digest('hex');
    for (let index = 0; index < 2; index++) await request(app.getHttpServer()).post('/api/meta/webhook').set('content-type', 'application/json').set('x-hub-signature-256', `sha256=${signature}`).send(payload).expect(201);
    let event = await db.metaWebhookEvent.findFirstOrThrow({ where: { tenantId: tenantAId, connectionId: connection.id, providerMessageId: `wamid.e2e.${suffix}` } });
    for (let attempt = 0; attempt < 40 && !['PROCESSED', 'UNMATCHED', 'FAILED'].includes(event.status); attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      event = await db.metaWebhookEvent.findFirstOrThrow({ where: { tenantId: tenantAId, connectionId: connection.id, providerMessageId: `wamid.e2e.${suffix}` } });
    }
    expect(event.status, event.lastError ?? '').toBe('PROCESSED');
    expect(await db.metaWebhookEvent.count({ where: { tenantId: tenantAId, connectionId: connection.id, providerMessageId: `wamid.e2e.${suffix}` } })).toBe(1);
    expect(await db.message.count({ where: { tenantId: tenantAId, provider: 'META_CLOUD', providerMessageId: `wamid.e2e.${suffix}` } })).toBe(1);
    const preference = await db.consentPreference.findUniqueOrThrow({ where: { tenantId_patientId_channel_purpose: { tenantId: tenantAId, patientId: patient.id, channel: 'WHATSAPP', purpose: 'MARKETING' } } });
    const queuedOutbox = await db.outboxMessage.findUniqueOrThrow({ where: { tenantId_idempotencyKey: { tenantId: tenantAId, idempotencyKey: outbox.idempotencyKey } } });
    expect(preference.status).toBe('REVOKED');
    expect(queuedOutbox.status).toBe('SUPPRESSED');
    expect(await db.consentEvent.count({ where: { tenantId: tenantAId, patientId: patient.id, purpose: 'MARKETING', evidenceReference: `wamid.e2e.${suffix}`, status: 'REVOKED' } })).toBe(1);
  });

  it('keeps Meta delivery status monotonic when webhook events arrive out of order', async () => {
    const connection = await db.metaConnection.findFirstOrThrow({ where: { tenantId: tenantAId, unitId: unitA1Id } });
    const conversation = await db.conversation.create({ data: { tenantId: tenantAId, unitId: unitA1Id, patientId: patientA1Id } });
    const providerMessageId = `wamid.status.${suffix}`;
    const message = await db.message.create({ data: { tenantId: tenantAId, conversationId: conversation.id, direction: 'OUTBOUND', actor: 'HUMAN', origin: 'HUMAN', status: 'QUEUED', body: 'Mensagem de teste local', provider: 'META_CLOUD', providerMessageId, idempotencyKey: `status-${suffix}` } });

    const sendStatus = async (status: string, timestamp: string) => {
      const payload = { object: 'whatsapp_business_account', entry: [{ id: connection.wabaId, changes: [{ field: 'messages', value: { metadata: { phone_number_id: connection.phoneNumberId }, statuses: [{ id: providerMessageId, status, timestamp, recipient_id: '5511999999999' }] } }] }] };
      const raw = JSON.stringify(payload);
      const signature = createHmac('sha256', 'meta-e2e-secret').update(raw).digest('hex');
      await request(app.getHttpServer()).post('/api/meta/webhook').set('content-type', 'application/json').set('x-hub-signature-256', `sha256=${signature}`).send(payload).expect(201);
      let event = await db.metaWebhookEvent.findFirstOrThrow({ where: { tenantId: tenantAId, connectionId: connection.id, providerMessageId, eventType: 'messages:status', providerTimestamp: BigInt(timestamp) } });
      for (let attempt = 0; attempt < 40 && !['PROCESSED', 'UNMATCHED', 'FAILED'].includes(event.status); attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        event = await db.metaWebhookEvent.findFirstOrThrow({ where: { id: event.id } });
      }
      expect(event.status, event.lastError ?? '').toBe('PROCESSED');
    };

    await sendStatus('READ', '300');
    await sendStatus('DELIVERED', '200');
    await sendStatus('SENT', '100');
    await sendStatus('FAILED', '400');
    const persisted = await db.message.findUniqueOrThrow({ where: { tenantId_id: { tenantId: tenantAId, id: message.id } } });
    expect(persisted.status).toBe('READ');
  });

  it('reconciles a stale PROCESSING event from PostgreSQL after a worker interruption', async () => {
    const connection = await db.metaConnection.findFirstOrThrow({ where: { tenantId: tenantAId, unitId: unitA1Id } });
    const old = new Date(Date.now() - 10 * 60_000);
    const event = await db.metaWebhookEvent.create({ data: { tenantId: tenantAId, connectionId: connection.id, eventKey: `stale-worker:${suffix}`, eventType: 'messages:status', payload: { id: `wamid.missing.${suffix}`, status: 'READ', timestamp: '1' }, status: 'PROCESSING', attempts: 1, enqueuedAt: old, nextAttemptAt: old, providerMessageId: `wamid.missing.${suffix}` } });
    await app.get(MetaWebhookService).reconcilePendingEvents();
    let recovered = await db.metaWebhookEvent.findUniqueOrThrow({ where: { id: event.id } });
    for (let attempt = 0; attempt < 40 && !['PROCESSED', 'FAILED'].includes(recovered.status); attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      recovered = await db.metaWebhookEvent.findUniqueOrThrow({ where: { id: event.id } });
    }
    expect(recovered.status, recovered.lastError ?? '').toBe('PROCESSED');
    expect(recovered.enqueuedAt).not.toBeNull();
  });

  it('dispatches only in dry-run and reconciles an accepted-then-timeout receipt without repeating it', async () => {
    const previousMode = process.env.OUTBOX_DISPATCH_MODE;
    const previousFault = process.env.OUTBOX_DRY_RUN_ACCEPT_TIMEOUT_KEY;
    process.env.OUTBOX_DISPATCH_MODE = 'dry-run';
    const adminToken = await accessToken(tenantAId, adminMembershipId, adminSessionId, adminUserId, UserRole.TENANT_ADMIN);
    const operatorToken = await accessToken(tenantAId, membershipAId, activeSessionId, userAId);
    const subscription = await db.subscription.findUniqueOrThrow({ where: { tenantId: tenantAId } });
    await db.plan.update({ where: { id: testPlanId }, data: { messageLimitPerCycle: 10 } });
    const phone = `55${Date.now().toString().slice(-10)}`;
    const patient = await db.patient.create({ data: { tenantId: tenantAId, unitId: unitA1Id, fullName: `Outbox dry-run ${suffix}`, phone, phoneNormalized: phone } });
    await db.consentPreference.create({ data: { tenantId: tenantAId, patientId: patient.id, channel: 'WHATSAPP', purpose: 'MARKETING', status: 'GRANTED', source: 'MANUAL', evidence: 'Consentimento fixture', evidenceType: 'WRITTEN_FORM', evidenceReference: `outbox-consent-${suffix}` } });
    await db.metaConnection.findFirstOrThrow({ where: { tenantId: tenantAId, unitId: unitA1Id, status: 'CONNECTED' } });

    const dispatchOne = async (name: string, key: string, fault = false) => {
      const campaign = await db.campaign.create({ data: { tenantId: tenantAId, name, status: 'APPROVED', channel: 'WHATSAPP', provider: 'META_CLOUD', body: 'Mensagem fictícia apenas para teste local.' } });
      await db.usageEntry.create({ data: { tenantId: tenantAId, subscriptionId: subscription.id, metric: 'messages', quantity: 1, idempotencyKey: `campaign:${campaign.id}:messages`, cycleStartsAt: subscription.cycleStartsAt, cycleEndsAt: subscription.cycleEndsAt } });
      const outbox = await db.outboxMessage.create({ data: { tenantId: tenantAId, patientId: patient.id, campaignId: campaign.id, purpose: 'MARKETING', channel: 'WHATSAPP', provider: 'META_CLOUD', body: campaign.body, idempotencyKey: key } });
      if (fault) process.env.OUTBOX_DRY_RUN_ACCEPT_TIMEOUT_KEY = key;
      const dispatches = await Promise.all([
        request(app.getHttpServer()).post('/api/outbox/dry-run/dispatch').set('Authorization', `Bearer ${adminToken}`).send({ limit: 10 }).expect(201),
        request(app.getHttpServer()).post('/api/outbox/dry-run/dispatch').set('Authorization', `Bearer ${adminToken}`).send({ limit: 10 }).expect(201),
      ]);
      expect(dispatches.every(({ body }) => body.sendsEnabled === false)).toBe(true);
      let row = await db.outboxMessage.findUniqueOrThrow({ where: { id: outbox.id } });
      for (let attempt = 0; attempt < 100 && !['SIMULATED', 'UNKNOWN', 'FAILED', 'SUPPRESSED'].includes(row.status); attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        row = await db.outboxMessage.findUniqueOrThrow({ where: { id: outbox.id } });
      }
      return { outbox, row };
    };

    try {
      await request(app.getHttpServer()).post('/api/outbox/dry-run/dispatch').set('Authorization', `Bearer ${operatorToken}`).send({ limit: 1 }).expect(403);
      const accepted = await dispatchOne('Dry run normal', `outbox-accepted-${suffix}`);
      expect(accepted.row.status, accepted.row.lastError ?? '').toBe('SIMULATED');
      const indeterminate = await dispatchOne('Dry run indeterminado', `outbox-unknown-${suffix}`, true);
      expect(indeterminate.row.status).toBe('UNKNOWN');
      expect(await db.message.count({ where: { tenantId: tenantAId, idempotencyKey: `outbox:${indeterminate.outbox.id}` } })).toBe(0);
      await request(app.getHttpServer()).post('/api/outbox/dry-run/reconcile-unknown').set('Authorization', `Bearer ${adminToken}`).send({}).expect(201).expect(({ body }) => expect(body.reconciled).toBe(1));
      const reconciled = await db.outboxMessage.findUniqueOrThrow({ where: { id: indeterminate.outbox.id } });
      expect(reconciled.status).toBe('SIMULATED');
      expect(await db.dryRunProviderReceipt.count({ where: { tenantId: tenantAId, outboxMessageId: indeterminate.outbox.id } })).toBe(1);
      expect(await db.message.count({ where: { tenantId: tenantAId, idempotencyKey: `outbox:${indeterminate.outbox.id}` } })).toBe(1);
      expect(await db.outboxAttempt.count({ where: { tenantId: tenantAId, outboxMessageId: indeterminate.outbox.id } })).toBe(2);
      const ledger = await db.usageEntry.count({ where: { tenantId: tenantAId, metric: 'messages', idempotencyKey: { in: [`campaign:${accepted.outbox.campaignId}:messages`, `campaign:${indeterminate.outbox.campaignId}:messages`] } } });
      expect(ledger).toBe(2);

      const interruptedCampaign = await db.campaign.create({ data: { tenantId: tenantAId, name: 'Worker interrompido', status: 'APPROVED', body: 'Conteúdo local de recuperação.' } });
      await db.usageEntry.create({ data: { tenantId: tenantAId, subscriptionId: subscription.id, metric: 'messages', quantity: 1, idempotencyKey: `campaign:${interruptedCampaign.id}:messages`, cycleStartsAt: subscription.cycleStartsAt, cycleEndsAt: subscription.cycleEndsAt } });
      const old = new Date(Date.now() - 10 * 60_000);
      const interrupted = await db.outboxMessage.create({ data: { tenantId: tenantAId, patientId: patient.id, campaignId: interruptedCampaign.id, purpose: 'MARKETING', channel: 'WHATSAPP', provider: 'META_CLOUD', body: interruptedCampaign.body, idempotencyKey: `outbox-interrupted-${suffix}`, status: 'PROCESSING', attempts: 1, enqueuedAt: old, leaseExpiresAt: old, nextAttemptAt: old } });
      await app.get(OutboxDispatchService).reconcileQueue();
      let recoveredOutbox = await db.outboxMessage.findUniqueOrThrow({ where: { id: interrupted.id } });
      for (let attempt = 0; attempt < 100 && recoveredOutbox.status !== 'SIMULATED'; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        recoveredOutbox = await db.outboxMessage.findUniqueOrThrow({ where: { id: interrupted.id } });
      }
      expect(recoveredOutbox.status, recoveredOutbox.lastError ?? '').toBe('SIMULATED');
      expect(await db.outboxAttempt.count({ where: { tenantId: tenantAId, outboxMessageId: interrupted.id } })).toBe(2);

      const optedOutPatient = await db.patient.create({ data: { tenantId: tenantAId, unitId: unitA1Id, fullName: 'Paciente opt-out pendente', phoneNormalized: `551155${Date.now().toString().slice(-8)}` } });
      await db.consentPreference.create({ data: { tenantId: tenantAId, patientId: optedOutPatient.id, channel: 'WHATSAPP', purpose: 'MARKETING', status: 'REVOKED', source: 'API', evidence: 'Revogação antes do processamento', evidenceReference: `revoke-${suffix}` } });
      const suppressedCampaign = await db.campaign.create({ data: { tenantId: tenantAId, name: 'Opt-out pendente', status: 'APPROVED', body: 'Conteúdo local suprimido.' } });
      await db.usageEntry.create({ data: { tenantId: tenantAId, subscriptionId: subscription.id, metric: 'messages', quantity: 1, idempotencyKey: `campaign:${suppressedCampaign.id}:messages`, cycleStartsAt: subscription.cycleStartsAt, cycleEndsAt: subscription.cycleEndsAt } });
      const suppressed = await db.outboxMessage.create({ data: { tenantId: tenantAId, patientId: optedOutPatient.id, campaignId: suppressedCampaign.id, purpose: 'MARKETING', channel: 'WHATSAPP', provider: 'META_CLOUD', body: suppressedCampaign.body, idempotencyKey: `outbox-revoked-${suffix}` } });
      await request(app.getHttpServer()).post('/api/outbox/dry-run/dispatch').set('Authorization', `Bearer ${adminToken}`).send({ limit: 10 }).expect(201);
      let suppressedRow = await db.outboxMessage.findUniqueOrThrow({ where: { id: suppressed.id } });
      for (let attempt = 0; attempt < 100 && suppressedRow.status !== 'SUPPRESSED'; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        suppressedRow = await db.outboxMessage.findUniqueOrThrow({ where: { id: suppressed.id } });
      }
      expect(suppressedRow.status).toBe('SUPPRESSED');
      expect(suppressedRow.suppressionReason).toBe('CONSENT_REVOKED');
      expect(await db.message.count({ where: { tenantId: tenantAId, idempotencyKey: `outbox:${suppressed.id}` } })).toBe(0);
    } finally {
      if (previousMode === undefined) delete process.env.OUTBOX_DISPATCH_MODE; else process.env.OUTBOX_DISPATCH_MODE = previousMode;
      if (previousFault === undefined) delete process.env.OUTBOX_DRY_RUN_ACCEPT_TIMEOUT_KEY; else process.env.OUTBOX_DRY_RUN_ACCEPT_TIMEOUT_KEY = previousFault;
    }
  }, 30_000);

  it('configures Meta and Evolution locally, protects secrets, and accepts only authenticated Evolution events', async () => {
    const adminToken = await accessToken(tenantAId, adminMembershipId, adminSessionId, adminUserId, UserRole.TENANT_ADMIN);
    const operatorToken = await accessToken(tenantAId, membershipAId, activeSessionId, userAId);
    const meta = await request(app.getHttpServer()).post('/api/messaging/connections/meta').set('Authorization', `Bearer ${adminToken}`).send({ displayName: 'Meta E2E', unitId: unitA1Id, wabaId: `waba-${suffix}`, phoneNumberId: `phone-${suffix}`, graphApiVersion: 'v99.0', accessToken: `meta-secret-${suffix}` }).expect(201);
    expect(meta.body).not.toHaveProperty('accessToken');
    expect(meta.body.sendsEnabled).toBe(false);
    const metaStored = await db.metaConnection.findUniqueOrThrow({ where: { id: meta.body.id } });
    expect(metaStored.accessTokenEncrypted).not.toContain(`meta-secret-${suffix}`);

    const evolution = await request(app.getHttpServer()).post('/api/messaging/connections/evolution').set('Authorization', `Bearer ${adminToken}`).send({ displayName: 'Evolution E2E', unitId: unitA1Id, apiBaseUrl: 'https://evolution.example.test', instanceName: `instance-${suffix}`, apiVersion: 'UNCONFIRMED', apiKey: `evolution-secret-${suffix}`, mode: 'EVOLUTION_BAILEYS' }).expect(201);
    expect(evolution.body.webhookSecret).toBeTruthy();
    const evolutionStored = await db.evolutionConnection.findUniqueOrThrow({ where: { id: evolution.body.id } });
    expect(evolutionStored.apiKeyEncrypted).not.toContain(`evolution-secret-${suffix}`);
    expect(evolutionStored.webhookSecretHash).not.toBe(evolution.body.webhookSecret);
    const listed = await request(app.getHttpServer()).get(`/api/messaging/connections?unitId=${unitA1Id}`).set('Authorization', `Bearer ${adminToken}`).expect(200);
    expect(JSON.stringify(listed.body)).not.toContain(`evolution-secret-${suffix}`);
    expect(JSON.stringify(listed.body)).not.toContain(evolution.body.webhookSecret);
    await request(app.getHttpServer()).get('/api/messaging/connections').set('Authorization', `Bearer ${operatorToken}`).expect(403);
    await request(app.getHttpServer()).post(`/api/messaging/connections/${meta.body.id}/dry-run`).set('Authorization', `Bearer ${adminToken}`).send({}).expect(201).expect(({ body }) => {
      expect(body.provider).toBe('META_CLOUD'); expect(body.externalRequestMade).toBe(false); expect(body.sendsEnabled).toBe(false);
    });
    await request(app.getHttpServer()).post(`/api/messaging/connections/${evolution.body.id}/dry-run`).set('Authorization', `Bearer ${adminToken}`).send({}).expect(201).expect(({ body }) => {
      expect(body.provider).toBe('EVOLUTION_BAILEYS'); expect(body.official).toBe(false); expect(body.externalRequestMade).toBe(false);
    });

    const patientPhone = `551188${Date.now().toString().slice(-8)}`;
    const patient = await db.patient.create({ data: { tenantId: tenantAId, unitId: unitA1Id, fullName: `Evolution inbound ${suffix}`, phone: patientPhone, phoneNormalized: patientPhone } });
    await db.consentPreference.create({ data: { tenantId: tenantAId, patientId: patient.id, channel: 'WHATSAPP', purpose: 'MARKETING', status: 'GRANTED', source: 'MANUAL', evidence: 'Fixture E2E local', evidenceType: 'WRITTEN_FORM', evidenceReference: `evolution-consent-${suffix}` } });
    const payload = { event: 'MESSAGES_UPSERT', instance: `instance-${suffix}`, data: { key: { id: `evo-msg-${suffix}`, remoteJid: `${patientPhone}@s.whatsapp.net`, fromMe: false }, message: { conversation: 'Olá, preciso de ajuda' }, messageTimestamp: Math.floor(Date.now() / 1000) } };
    await request(app.getHttpServer()).post(`/api/evolution/webhook/${evolution.body.id}`).send(payload).expect(401);
    await request(app.getHttpServer()).post(`/api/evolution/webhook/${evolution.body.id}`).set('x-evolution-webhook-secret', evolution.body.webhookSecret).send({ ...payload, instance: 'outra-instancia' }).expect(401);
    await request(app.getHttpServer()).post(`/api/evolution/webhook/${evolution.body.id}`).set('x-evolution-webhook-secret', evolution.body.webhookSecret).send(payload).expect(201);
    await request(app.getHttpServer()).post(`/api/evolution/webhook/${evolution.body.id}`).set('x-evolution-webhook-secret', evolution.body.webhookSecret).send(payload).expect(201);
    const providerMessageId = `evo-msg-${suffix}`;
    for (let attempt = 0; attempt < 100 && !(await db.message.findFirst({ where: { tenantId: tenantAId, provider: 'EVOLUTION_BAILEYS', providerMessageId } })); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
    expect(await db.message.count({ where: { tenantId: tenantAId, provider: 'EVOLUTION_BAILEYS', providerMessageId } })).toBe(1);
    expect(await db.conversation.count({ where: { tenantId: tenantAId, patientId: patient.id, unitId: unitA1Id } })).toBe(1);

    const ownMessageId = `evo-own-${suffix}`;
    await request(app.getHttpServer()).post(`/api/evolution/webhook/${evolution.body.id}`).set('x-evolution-webhook-secret', evolution.body.webhookSecret).send({ event: 'MESSAGES_UPSERT', instance: `instance-${suffix}`, data: { key: { id: ownMessageId, remoteJid: `${patientPhone}@s.whatsapp.net`, fromMe: true }, message: { conversation: 'Mensagem enviada pelo próprio número' } } }).expect(201);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(await db.message.count({ where: { tenantId: tenantAId, provider: 'EVOLUTION_BAILEYS', providerMessageId: ownMessageId, direction: 'INBOUND' } })).toBe(0);
    await db.evolutionConnection.update({ where: { id: evolution.body.id }, data: { status: 'CONNECTED' } });
    const subscription = await db.subscription.findUniqueOrThrow({ where: { tenantId: tenantAId } });
    const marketingCampaign = await db.campaign.create({ data: { tenantId: tenantAId, name: `Baileys campaign blocked ${suffix}`, status: 'APPROVED', provider: 'META_CLOUD', body: 'Conteúdo somente de teste local.' } });
    await db.usageEntry.create({ data: { tenantId: tenantAId, subscriptionId: subscription.id, metric: 'messages', quantity: 1, idempotencyKey: `campaign:${marketingCampaign.id}:messages`, cycleStartsAt: subscription.cycleStartsAt, cycleEndsAt: subscription.cycleEndsAt } });
    const marketingOutbox = await db.outboxMessage.create({ data: { tenantId: tenantAId, patientId: patient.id, campaignId: marketingCampaign.id, purpose: 'MARKETING', channel: 'WHATSAPP', provider: 'EVOLUTION_BAILEYS', connectionId: evolution.body.id, body: marketingCampaign.body, idempotencyKey: `baileys-marketing-${suffix}` } });
    const previousMode = process.env.OUTBOX_DISPATCH_MODE;
    process.env.OUTBOX_DISPATCH_MODE = 'dry-run';
    try {
      await request(app.getHttpServer()).post('/api/outbox/dry-run/dispatch').set('Authorization', `Bearer ${adminToken}`).send({ limit: 10 }).expect(201);
      let blocked = await db.outboxMessage.findUniqueOrThrow({ where: { id: marketingOutbox.id } });
      for (let attempt = 0; attempt < 100 && !['FAILED', 'SIMULATED'].includes(blocked.status); attempt++) { await new Promise((resolve) => setTimeout(resolve, 50)); blocked = await db.outboxMessage.findUniqueOrThrow({ where: { id: marketingOutbox.id } }); }
      expect(blocked.status).toBe('FAILED');
      expect(blocked.lastError).toContain('Baileys');
      expect(await db.message.count({ where: { tenantId: tenantAId, idempotencyKey: `outbox:${marketingOutbox.id}` } })).toBe(0);
    } finally { if (previousMode === undefined) delete process.env.OUTBOX_DISPATCH_MODE; else process.env.OUTBOX_DISPATCH_MODE = previousMode; }
    const disconnected = await request(app.getHttpServer()).post(`/api/messaging/connections/${evolution.body.id}/disconnect-local`).set('Authorization', `Bearer ${adminToken}`).send({}).expect(201);
    expect(disconnected.body.remoteAction).toBe(false);
    const afterDisable = await db.evolutionConnection.findUniqueOrThrow({ where: { id: evolution.body.id } });
    expect(afterDisable.enabled).toBe(false);
    await request(app.getHttpServer()).post(`/api/evolution/webhook/${evolution.body.id}`).set('x-evolution-webhook-secret', evolution.body.webhookSecret).send(payload).expect(401);
  }, 30_000);

  it('executes appointment confirmation once in dry-run and only confirms on an exact authenticated reply', async () => {
    const previousMode = process.env.OUTBOX_DISPATCH_MODE;
    process.env.OUTBOX_DISPATCH_MODE = 'dry-run';
    const adminToken = await accessToken(tenantAId, adminMembershipId, adminSessionId, adminUserId, UserRole.TENANT_ADMIN);
    try {
      await db.plan.update({ where: { id: testPlanId }, data: { messageLimitPerCycle: 100 } });
      const phone = `55${Date.now().toString().slice(-10)}`;
      const patient = await db.patient.create({ data: { tenantId: tenantAId, unitId: unitA1Id, fullName: `Confirmation ${suffix}`, phone, phoneNormalized: phone } });
      await db.consentPreference.create({ data: { tenantId: tenantAId, patientId: patient.id, channel: 'WHATSAPP', purpose: 'APPOINTMENT_REMINDER', status: 'GRANTED', source: 'MANUAL', evidence: 'Fictitious local E2E evidence', evidenceType: 'WRITTEN_FORM', evidenceReference: `appointment-consent-${suffix}` } });
      const connection = await db.metaConnection.create({ data: { tenantId: tenantAId, unitId: unitA1Id, wabaId: `automation-waba-${suffix}`, phoneNumberId: `automation-phone-${suffix}`, accessTokenEncrypted: 'test-only-encrypted-placeholder', status: 'CONNECTED', enabled: true } });
      const configuration = { unitId: unitA1Id, advanceMinutes: 180, allowedStartHour: 0, allowedEndHour: 24, provider: 'META_CLOUD', connectionId: connection.id, body: 'Confirme respondendo CONFIRMAR', confirmKeywords: ['CONFIRMAR'], rescheduleKeywords: ['REAGENDAR'], humanKeywords: ['ATENDENTE'], noResponseAction: 'NONE', responsibleUserId: adminUserId };
      const createdRule = await request(app.getHttpServer()).post('/api/automations').set('Authorization', `Bearer ${adminToken}`).send({ name: `Confirmação E2E ${suffix}`, trigger: 'APPOINTMENT_CONFIRMATION', configuration }).expect(201);
      await request(app.getHttpServer()).patch(`/api/automations/${createdRule.body.id}/status`).set('Authorization', `Bearer ${adminToken}`).send({ status: 'ACTIVE' }).expect(200);
      const startsAt = new Date(Date.now() + 2 * 60 * 60_000);
      const appointment = await request(app.getHttpServer()).post('/api/appointments').set('Authorization', `Bearer ${adminToken}`).send({ unitId: unitA1Id, patientId: patient.id, startsAt: startsAt.toISOString(), endsAt: new Date(startsAt.getTime() + 30 * 60_000).toISOString() }).expect(201);

      let execution = await db.automationExecution.findFirstOrThrow({ where: { tenantId: tenantAId, automationId: createdRule.body.id, appointmentId: appointment.body.id } });
      for (let attempt = 0; attempt < 200 && execution.status === 'PENDING'; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        execution = await db.automationExecution.findUniqueOrThrow({ where: { id: execution.id } });
      }
      expect(execution.status).toBe('OUTBOXED');
      expect(await db.automationExecution.count({ where: { tenantId: tenantAId, automationId: createdRule.body.id, appointmentId: appointment.body.id } })).toBe(1);
      const queuedOutbox = await db.outboxMessage.findUniqueOrThrow({ where: { id: execution.outboxMessageId! } });
      expect(queuedOutbox.provider).toBe('META_CLOUD');
      expect(queuedOutbox.status).toBe('PENDING');
      await request(app.getHttpServer()).post('/api/outbox/dry-run/dispatch').set('Authorization', `Bearer ${adminToken}`).send({ limit: 10 }).expect(201);
      let outbox = await db.outboxMessage.findUniqueOrThrow({ where: { id: queuedOutbox.id } });
      for (let attempt = 0; attempt < 400 && !['SIMULATED', 'FAILED', 'SUPPRESSED', 'UNKNOWN'].includes(outbox.status); attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        outbox = await db.outboxMessage.findUniqueOrThrow({ where: { id: queuedOutbox.id } });
      }
      expect(outbox.status).toBe('SIMULATED');

      const postReply = async (providerMessageId: string, text: string) => {
        const payload = { object: 'whatsapp_business_account', entry: [{ id: connection.wabaId, changes: [{ field: 'messages', value: { metadata: { phone_number_id: connection.phoneNumberId }, messages: [{ id: providerMessageId, from: phone, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: text } }] } }] }] };
        const raw = JSON.stringify(payload);
        const signature = createHmac('sha256', 'meta-e2e-secret').update(raw).digest('hex');
        await request(app.getHttpServer()).post('/api/meta/webhook').set('content-type', 'application/json').set('x-hub-signature-256', `sha256=${signature}`).send(payload).expect(201);
        for (let attempt = 0; attempt < 200; attempt++) {
          const event = await db.metaWebhookEvent.findFirst({ where: { tenantId: tenantAId, providerMessageId, connectionId: connection.id } });
          if (event?.status === 'PROCESSED') return;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        throw new Error(`Meta webhook event ${providerMessageId} was not processed`);
      };
      await postReply(`ambiguous-${suffix}`, 'sim');
      expect((await db.appointment.findUniqueOrThrow({ where: { id: appointment.body.id } })).status).toBe('PENDING');
      expect((await db.automationExecution.findUniqueOrThrow({ where: { id: execution.id } })).status).toBe('OUTBOXED');
      await postReply(`confirmed-${suffix}`, 'CONFIRMAR');
      expect((await db.appointment.findUniqueOrThrow({ where: { id: appointment.body.id } })).status).toBe('CONFIRMED');
      const completedExecution = await db.automationExecution.findUniqueOrThrow({ where: { id: execution.id } });
      expect(completedExecution).toMatchObject({ status: 'RESPONDED', responseAction: 'CONFIRM' });
    } finally {
      if (previousMode === undefined) delete process.env.OUTBOX_DISPATCH_MODE; else process.env.OUTBOX_DISPATCH_MODE = previousMode;
    }
  }, 30_000);

  it('revalidates queued confirmation jobs after consent, patient, connection, quota, appointment cancellation, and reschedule changes', async () => {
    const adminToken = await accessToken(tenantAId, adminMembershipId, adminSessionId, adminUserId, UserRole.TENANT_ADMIN);
    await db.plan.update({ where: { id: testPlanId }, data: { messageLimitPerCycle: 100 } });
    const connection = await db.metaConnection.create({ data: { tenantId: tenantAId, unitId: unitA1Id, wabaId: `revalidate-waba-${suffix}`, phoneNumberId: `revalidate-phone-${suffix}`, accessTokenEncrypted: 'test-only-encrypted-placeholder', status: 'CONNECTED', enabled: true } });
    const configuration = { unitId: unitA1Id, advanceMinutes: 60, allowedStartHour: 0, allowedEndHour: 24, provider: 'META_CLOUD', connectionId: connection.id, body: 'Fixture de confirmação', confirmKeywords: ['CONFIRMAR'], rescheduleKeywords: ['REAGENDAR'], humanKeywords: ['ATENDENTE'], noResponseAction: 'NONE', responsibleUserId: adminUserId };
    const rule = await request(app.getHttpServer()).post('/api/automations').set('Authorization', `Bearer ${adminToken}`).send({ name: `Revalidação E2E ${suffix}`, trigger: 'APPOINTMENT_CONFIRMATION', configuration }).expect(201);
    await request(app.getHttpServer()).patch(`/api/automations/${rule.body.id}/status`).set('Authorization', `Bearer ${adminToken}`).send({ status: 'ACTIVE' }).expect(200);
    const execute = (app.get(AutomationsService) as unknown as { execute: (id: string) => Promise<void> }).execute.bind(app.get(AutomationsService));
    const scenarios = ['revoked', 'archived', 'disabled', 'quota', 'cancelled', 'rescheduled'] as const;
    for (const scenario of scenarios) {
      await db.metaConnection.update({ where: { id: connection.id }, data: { enabled: true, status: 'CONNECTED' } });
      await db.plan.update({ where: { id: testPlanId }, data: { messageLimitPerCycle: 100 } });
      const phone = `551144${Date.now().toString().slice(-7)}${scenarios.indexOf(scenario)}`;
      const patient = await db.patient.create({ data: { tenantId: tenantAId, unitId: unitA1Id, fullName: `${scenario} ${suffix}`, phone, phoneNormalized: phone } });
      await db.consentPreference.create({ data: { tenantId: tenantAId, patientId: patient.id, channel: 'WHATSAPP', purpose: 'APPOINTMENT_REMINDER', status: 'GRANTED', source: 'MANUAL', evidence: 'fixture evidence', evidenceType: 'WRITTEN_FORM', evidenceReference: `${scenario}-${suffix}` } });
      const startsAt = new Date(Date.now() + (48 + scenarios.indexOf(scenario) * 2) * 60 * 60_000);
      const appointment = await request(app.getHttpServer()).post('/api/appointments').set('Authorization', `Bearer ${adminToken}`).send({ unitId: unitA1Id, patientId: patient.id, startsAt: startsAt.toISOString(), endsAt: new Date(startsAt.getTime() + 30 * 60_000).toISOString() }).expect(201);
      const execution = await db.automationExecution.findFirstOrThrow({ where: { tenantId: tenantAId, automationId: rule.body.id, appointmentId: appointment.body.id } });
      if (scenario === 'revoked') await db.consentPreference.update({ where: { tenantId_patientId_channel_purpose: { tenantId: tenantAId, patientId: patient.id, channel: 'WHATSAPP', purpose: 'APPOINTMENT_REMINDER' } }, data: { status: 'REVOKED' } });
      if (scenario === 'archived') await db.patient.update({ where: { id: patient.id }, data: { active: false, deletedAt: new Date() } });
      if (scenario === 'disabled') await db.metaConnection.update({ where: { id: connection.id }, data: { enabled: false, status: 'DISCONNECTED' } });
      if (scenario === 'quota') await db.plan.update({ where: { id: testPlanId }, data: { messageLimitPerCycle: 0 } });
      if (scenario === 'cancelled') await db.appointment.update({ where: { id: appointment.body.id }, data: { status: 'CANCELLED' } });
      if (scenario === 'rescheduled') await db.appointment.update({ where: { id: appointment.body.id }, data: { startsAt: new Date(startsAt.getTime() + 60 * 60_000), endsAt: new Date(startsAt.getTime() + 90 * 60_000) } });
      await db.automationExecution.update({ where: { id: execution.id }, data: { scheduledAt: new Date(Date.now() - 1000) } });
      await execute(execution.id);
      const current = await db.automationExecution.findUniqueOrThrow({ where: { id: execution.id } });
      expect(current.status, scenario).toBe(['cancelled', 'rescheduled'].includes(scenario) ? 'CANCELLED' : 'SUPPRESSED');
      expect(current.outboxMessageId, scenario).toBeNull();
    }
  }, 30_000);

  it('schedules procedure return from effect days and turns an authenticated reply into a human task in dry-run', async () => {
    const previousMode = process.env.OUTBOX_DISPATCH_MODE;
    process.env.OUTBOX_DISPATCH_MODE = 'dry-run';
    const adminToken = await accessToken(tenantAId, adminMembershipId, adminSessionId, adminUserId, UserRole.TENANT_ADMIN);
    try {
      await db.plan.update({ where: { id: testPlanId }, data: { messageLimitPerCycle: 100 } });
      const phone = `551155${Date.now().toString().slice(-8)}`;
      const patient = await db.patient.create({ data: { tenantId: tenantAId, unitId: unitA1Id, fullName: `Return ${suffix}`, phone, phoneNormalized: phone } });
      await db.consentPreference.create({ data: { tenantId: tenantAId, patientId: patient.id, channel: 'WHATSAPP', purpose: 'PROCEDURE_RETURN', status: 'GRANTED', source: 'MANUAL', evidence: 'Fictitious local E2E consent for return contact', evidenceType: 'WRITTEN_FORM', evidenceReference: `return-consent-${suffix}` } });
      const procedure = await db.procedure.create({ data: { tenantId: tenantAId, unitId: unitA1Id, name: `Procedimento retorno ${suffix}`, appointmentDurationMinutes: 30, returnAfterDays: 10, reminderAdvanceDays: 2 } });
      const connection = await db.metaConnection.create({ data: { tenantId: tenantAId, unitId: unitA1Id, wabaId: `return-waba-${suffix}`, phoneNumberId: `return-phone-${suffix}`, accessTokenEncrypted: 'test-only-encrypted-placeholder', status: 'CONNECTED', enabled: true } });
      const configuration = { unitId: unitA1Id, procedureId: procedure.id, advanceMinutes: 0, allowedStartHour: 0, allowedEndHour: 24, allowedDaysOfWeek: [0,1,2,3,4,5,6], provider: 'META_CLOUD', connectionId: connection.id, body: 'Olá {{paciente.nome}}, se desejar organizar seu retorno, nossa equipe pode ajudar.', responseWindowHours: 72, maxContactsPerPatient: 2, interestKeywords: ['TENHO INTERESSE'], rescheduleKeywords: ['AGENDAR'], noContactKeywords: ['NAO QUERO CONTATO'], noResponseAction: 'CREATE_TASK', responsibleUserId: adminUserId };
      await db.procedure.update({ where: { id: procedure.id }, data: { reminderAdvanceDays: 11 } });
      await request(app.getHttpServer()).post('/api/automations').set('Authorization', `Bearer ${adminToken}`).send({ name: `Retorno inválido ${suffix}`, trigger: 'PROCEDURE_RETURN', configuration }).expect(400);
      await db.procedure.update({ where: { id: procedure.id }, data: { reminderAdvanceDays: 2 } });
      const rule = await request(app.getHttpServer()).post('/api/automations').set('Authorization', `Bearer ${adminToken}`).send({ name: `Retorno E2E ${suffix}`, trigger: 'PROCEDURE_RETURN', configuration }).expect(201);
      await request(app.getHttpServer()).patch(`/api/automations/${rule.body.id}/status`).set('Authorization', `Bearer ${adminToken}`).send({ status: 'ACTIVE' }).expect(200);
      const startsAt = new Date(Date.now() + 100 * 60 * 60_000);
      const appointment = await request(app.getHttpServer()).post('/api/appointments').set('Authorization', `Bearer ${adminToken}`).send({ unitId: unitA1Id, patientId: patient.id, procedureId: procedure.id, startsAt: startsAt.toISOString(), endsAt: new Date(startsAt.getTime() + 30 * 60_000).toISOString() }).expect(201);
      expect(await db.automationExecution.count({ where: { tenantId: tenantAId, automationId: rule.body.id, appointmentId: appointment.body.id } })).toBe(0);
      await request(app.getHttpServer()).patch(`/api/appointments/${appointment.body.id}/status`).set('Authorization', `Bearer ${adminToken}`).send({ status: 'CONFIRMED' }).expect(200);
      await db.appointment.update({ where: { id: appointment.body.id }, data: { startsAt: new Date(Date.now() - 60 * 60_000), endsAt: new Date(Date.now() - 30 * 60_000) } });
      await request(app.getHttpServer()).patch(`/api/appointments/${appointment.body.id}/status`).set('Authorization', `Bearer ${adminToken}`).send({ status: 'COMPLETED' }).expect(200);
      await app.get(AutomationsService).appointmentChanged(appointment.body.id);
      let execution = await db.automationExecution.findFirstOrThrow({ where: { tenantId: tenantAId, automationId: rule.body.id, appointmentId: appointment.body.id } });
      const completedAt = (await db.appointment.findUniqueOrThrow({ where: { id: appointment.body.id } })).completedAt!;
      expect(execution.scheduledAt.getTime()).toBeGreaterThanOrEqual(completedAt.getTime() + 8 * 86400000);
      expect(execution.scheduledAt.getTime()).toBeLessThan(completedAt.getTime() + 9 * 86400000);
      // Keep this fixture outside the satisfaction scheduler's 30-day window so this test remains isolated from that robot.
      const oldCompletedAt = new Date(Date.now() - 40 * 86400000);
      await db.appointment.update({ where: { id: appointment.body.id }, data: { completedAt: oldCompletedAt } });
      await app.get(AutomationsService).appointmentChanged(appointment.body.id);
      expect(await db.automationExecution.count({ where: { tenantId: tenantAId, automationId: rule.body.id, appointmentId: appointment.body.id } })).toBe(1);
      await db.automationExecution.update({ where: { id: execution.id }, data: { scheduledAt: new Date(oldCompletedAt.getTime() + 8 * 86400000) } });
      await app.get(AutomationsService).reconcileDueExecutions(tenantAId);
      for (let attempt = 0; attempt < 200; attempt++) { execution = await db.automationExecution.findUniqueOrThrow({ where: { id: execution.id } }); if (execution.status === 'OUTBOXED' || execution.status === 'SUPPRESSED' || execution.status === 'FAILED') break; await new Promise((resolve) => setTimeout(resolve, 50)); }
      expect(execution.status).toBe('OUTBOXED');
      const outbox = await db.outboxMessage.findUniqueOrThrow({ where: { id: execution.outboxMessageId! } });
      expect(outbox).toMatchObject({ status: 'PENDING', purpose: 'PROCEDURE_RETURN', provider: 'META_CLOUD' });
      await request(app.getHttpServer()).post('/api/outbox/dry-run/dispatch').set('Authorization', `Bearer ${adminToken}`).send({ limit: 10 }).expect(201);
      let dispatched = await db.outboxMessage.findUniqueOrThrow({ where: { id: outbox.id } });
      for (let attempt = 0; attempt < 200 && !['SIMULATED', 'FAILED', 'SUPPRESSED', 'UNKNOWN'].includes(dispatched.status); attempt++) { await new Promise((resolve) => setTimeout(resolve, 50)); dispatched = await db.outboxMessage.findUniqueOrThrow({ where: { id: outbox.id } }); }
      expect(dispatched.status).toBe('SIMULATED');
      const payload = { object: 'whatsapp_business_account', entry: [{ id: connection.wabaId, changes: [{ field: 'messages', value: { metadata: { phone_number_id: connection.phoneNumberId }, messages: [{ id: `return-reply-${suffix}`, from: phone, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: 'TENHO INTERESSE' } }] } }] }] };
      const raw = JSON.stringify(payload);
      const signature = createHmac('sha256', 'meta-e2e-secret').update(raw).digest('hex');
      await request(app.getHttpServer()).post('/api/meta/webhook').set('content-type', 'application/json').set('x-hub-signature-256', `sha256=${signature}`).send(payload).expect(201);
      for (let attempt = 0; attempt < 200 && !(await db.task.findFirst({ where: { tenantId: tenantAId, patientId: patient.id, procedureId: procedure.id, appointmentId: appointment.body.id } })); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
      const task = await db.task.findFirstOrThrow({ where: { tenantId: tenantAId, patientId: patient.id, procedureId: procedure.id, appointmentId: appointment.body.id } });
      expect(task.title).toContain('interessado');
      expect(await db.automationExecution.findUniqueOrThrow({ where: { id: execution.id } })).toMatchObject({ status: 'RESPONDED', responseAction: 'INTERESTED' });
      expect(await db.appointment.findUniqueOrThrow({ where: { id: appointment.body.id } })).toMatchObject({ status: 'COMPLETED' });
      const duplicatePayload = { object: 'whatsapp_business_account', entry: [{ id: connection.wabaId, changes: [{ field: 'messages', value: { metadata: { phone_number_id: connection.phoneNumberId }, messages: [{ id: `return-reply-duplicate-${suffix}`, from: phone, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: 'TENHO INTERESSE' } }] } }] }] };
      const duplicateRaw = JSON.stringify(duplicatePayload);
      const duplicateSignature = createHmac('sha256', 'meta-e2e-secret').update(duplicateRaw).digest('hex');
      await request(app.getHttpServer()).post('/api/meta/webhook').set('content-type', 'application/json').set('x-hub-signature-256', `sha256=${duplicateSignature}`).send(duplicatePayload).expect(201);
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(await db.task.count({ where: { tenantId: tenantAId, patientId: patient.id, procedureId: procedure.id, appointmentId: appointment.body.id } })).toBe(1);
      await request(app.getHttpServer()).patch(`/api/automations/${rule.body.id}/status`).set('Authorization', `Bearer ${adminToken}`).send({ status: 'PAUSED' }).expect(200);
    } finally {
      if (previousMode === undefined) delete process.env.OUTBOX_DISPATCH_MODE; else process.env.OUTBOX_DISPATCH_MODE = previousMode;
    }
  }, 30_000);

  it('schedules post-care satisfaction after native completion and records only an exact authenticated five-option reply', async () => {
    const previousMode = process.env.OUTBOX_DISPATCH_MODE;
    process.env.OUTBOX_DISPATCH_MODE = 'dry-run';
    const adminToken = await accessToken(tenantAId, adminMembershipId, adminSessionId, adminUserId, UserRole.TENANT_ADMIN);
    try {
      await db.plan.update({ where: { id: testPlanId }, data: { messageLimitPerCycle: 100 } });
      const phone = `55${Date.now().toString().slice(-10)}`;
      const patient = await db.patient.create({ data: { tenantId: tenantAId, unitId: unitA1Id, fullName: `Survey ${suffix}`, phone, phoneNormalized: phone } });
      await db.consentPreference.create({ data: { tenantId: tenantAId, patientId: patient.id, channel: 'WHATSAPP', purpose: 'SATISFACTION_SURVEY', status: 'GRANTED', source: 'MANUAL', evidence: 'Fictitious local E2E evidence', evidenceType: 'WRITTEN_FORM', evidenceReference: `survey-consent-${suffix}` } });
      const procedure = await db.procedure.create({ data: { tenantId: tenantAId, unitId: unitA1Id, name: `Procedimento pesquisa ${suffix}`, appointmentDurationMinutes: 30 } });
      const connection = await db.metaConnection.create({ data: { tenantId: tenantAId, unitId: unitA1Id, wabaId: `survey-waba-${suffix}`, phoneNumberId: `survey-phone-${suffix}`, accessTokenEncrypted: 'test-only-encrypted-placeholder', status: 'CONNECTED', enabled: true } });
      const configuration = { unitId: unitA1Id, procedureId: procedure.id, advanceMinutes: 0, allowedStartHour: 0, allowedEndHour: 24, provider: 'META_CLOUD', connectionId: connection.id, opening: 'Olá {{paciente.nome}}!', question: 'Como foi sua experiência?', responseWindowHours: 24, version: 1, thankYou: { EXCELLENT: 'Obrigado ótimo', GOOD: 'Obrigado bom', REGULAR: 'Obrigado regular', POOR: 'Obrigado ruim', VERY_POOR: 'Obrigado péssimo' }, regularAction: 'CREATE_TASK', noResponseAction: 'CREATE_TASK', responsibleUserId: adminUserId };
      const rule = await request(app.getHttpServer()).post('/api/automations').set('Authorization', `Bearer ${adminToken}`).send({ name: `Pesquisa E2E ${suffix}`, trigger: 'POST_CARE_SATISFACTION', configuration }).expect(201);
      await request(app.getHttpServer()).patch(`/api/automations/${rule.body.id}/status`).set('Authorization', `Bearer ${adminToken}`).send({ status: 'ACTIVE' }).expect(200);
      const startsAt = new Date(Date.now() + 120 * 60 * 60_000);
      const appointment = await request(app.getHttpServer()).post('/api/appointments').set('Authorization', `Bearer ${adminToken}`).send({ unitId: unitA1Id, patientId: patient.id, procedureId: procedure.id, startsAt: startsAt.toISOString(), endsAt: new Date(startsAt.getTime() + 30 * 60_000).toISOString() }).expect(201);
      expect(await db.automationExecution.count({ where: { tenantId: tenantAId, automationId: rule.body.id, appointmentId: appointment.body.id } })).toBe(0);
      await request(app.getHttpServer()).patch(`/api/appointments/${appointment.body.id}/status`).set('Authorization', `Bearer ${adminToken}`).send({ status: 'CONFIRMED' }).expect(200);
      await db.appointment.update({ where: { id: appointment.body.id }, data: { startsAt: new Date(Date.now() - 60 * 60_000), endsAt: new Date(Date.now() - 30 * 60_000) } });
      await request(app.getHttpServer()).patch(`/api/appointments/${appointment.body.id}/status`).set('Authorization', `Bearer ${adminToken}`).send({ status: 'COMPLETED' }).expect(200);
      await app.get(AutomationsService).appointmentChanged(appointment.body.id);
      await app.get(AutomationsService).appointmentChanged(appointment.body.id);
      let execution = await db.automationExecution.findFirst({ where: { tenantId: tenantAId, automationId: rule.body.id, appointmentId: appointment.body.id } });
      for (let attempt = 0; attempt < 200 && (!execution || execution.status === 'PENDING'); attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        execution = await db.automationExecution.findFirst({ where: { tenantId: tenantAId, automationId: rule.body.id, appointmentId: appointment.body.id } });
      }
      expect(execution?.status).toBe('OUTBOXED');
      const survey = await db.satisfactionSurvey.findFirstOrThrow({ where: { tenantId: tenantAId, automationId: rule.body.id, appointmentId: appointment.body.id } });
      expect(survey).toMatchObject({ state: 'OUTBOXED', version: 1, question: 'Como foi sua experiência?' });
      const outbox = await db.outboxMessage.findUniqueOrThrow({ where: { id: survey.outboxMessageId! } });
      expect(outbox).toMatchObject({ purpose: 'SATISFACTION_SURVEY', provider: 'META_CLOUD', status: 'PENDING' });
      await request(app.getHttpServer()).post('/api/outbox/dry-run/dispatch').set('Authorization', `Bearer ${adminToken}`).send({ limit: 10 }).expect(201);
      let dispatched = await db.outboxMessage.findUniqueOrThrow({ where: { id: outbox.id } });
      for (let attempt = 0; attempt < 200 && !['SIMULATED', 'FAILED', 'SUPPRESSED', 'UNKNOWN'].includes(dispatched.status); attempt++) { await new Promise((resolve) => setTimeout(resolve, 50)); dispatched = await db.outboxMessage.findUniqueOrThrow({ where: { id: outbox.id } }); }
      expect(dispatched.status).toBe('SIMULATED');

      const postReply = async (providerMessageId: string, text: string) => {
        const payload = { object: 'whatsapp_business_account', entry: [{ id: connection.wabaId, changes: [{ field: 'messages', value: { metadata: { phone_number_id: connection.phoneNumberId }, messages: [{ id: providerMessageId, from: phone, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: text } }] } }] }] };
        const raw = JSON.stringify(payload);
        const signature = createHmac('sha256', 'meta-e2e-secret').update(raw).digest('hex');
        await request(app.getHttpServer()).post('/api/meta/webhook').set('content-type', 'application/json').set('x-hub-signature-256', `sha256=${signature}`).send(payload).expect(201);
        for (let attempt = 0; attempt < 200; attempt++) {
          const event = await db.metaWebhookEvent.findFirst({ where: { tenantId: tenantAId, providerMessageId, connectionId: connection.id } });
          if (event?.status === 'PROCESSED') return;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        throw new Error(`Meta webhook event ${providerMessageId} was not processed`);
      };
      await postReply(`survey-ambiguous-${suffix}`, 'Minha experiência foi ruim, mas quero explicar melhor.');
      expect((await db.satisfactionSurvey.findUniqueOrThrow({ where: { id: survey.id } })).state).toBe('OUTBOXED');
      await postReply(`survey-response-${suffix}`, 'RUIM');
      const answered = await db.satisfactionSurvey.findUniqueOrThrow({ where: { id: survey.id } });
      expect(answered).toMatchObject({ state: 'RESPONDED', classification: 'POOR', responseSource: 'META_CLOUD_HMAC' });
      await postReply(`survey-duplicate-${suffix}`, 'RUIM');
      expect(await db.task.count({ where: { tenantId: tenantAId, patientId: patient.id, appointmentId: appointment.body.id } })).toBe(1);
      expect(await db.outboxMessage.count({ where: { tenantId: tenantAId, patientId: patient.id, purpose: 'SATISFACTION_SURVEY', idempotencyKey: `satisfaction-survey:${survey.id}:thank-you` } })).toBe(1);
      const task = await db.task.findFirstOrThrow({ where: { tenantId: tenantAId, patientId: patient.id, appointmentId: appointment.body.id } });
      expect(task).toMatchObject({ priority: 'URGENT', appointmentId: appointment.body.id });
      expect(task.description).toContain('POOR');
      expect(await db.satisfactionSurveyEvent.count({ where: { tenantId: tenantAId, surveyId: survey.id } })).toBeGreaterThanOrEqual(2);
      expect(await db.outboxMessage.count({ where: { tenantId: tenantAId, patientId: patient.id, purpose: 'SATISFACTION_SURVEY', idempotencyKey: `satisfaction-survey:${survey.id}:thank-you` } })).toBe(1);

      const lateStart = new Date(Date.now() + 122 * 60 * 60_000);
      const lateAppointment = await request(app.getHttpServer()).post('/api/appointments').set('Authorization', `Bearer ${adminToken}`).send({ unitId: unitA1Id, patientId: patient.id, procedureId: procedure.id, startsAt: lateStart.toISOString(), endsAt: new Date(lateStart.getTime() + 30 * 60_000).toISOString() }).expect(201);
      await request(app.getHttpServer()).patch(`/api/appointments/${lateAppointment.body.id}/status`).set('Authorization', `Bearer ${adminToken}`).send({ status: 'CONFIRMED' }).expect(200);
      await db.appointment.update({ where: { id: lateAppointment.body.id }, data: { startsAt: new Date(Date.now() - 60 * 60_000), endsAt: new Date(Date.now() - 30 * 60_000) } });
      await request(app.getHttpServer()).patch(`/api/appointments/${lateAppointment.body.id}/status`).set('Authorization', `Bearer ${adminToken}`).send({ status: 'COMPLETED' }).expect(200);
      let lateExecution = await db.automationExecution.findFirst({ where: { tenantId: tenantAId, automationId: rule.body.id, appointmentId: lateAppointment.body.id } });
      for (let attempt = 0; attempt < 100 && !lateExecution?.lastError; attempt++) { await new Promise((resolve) => setTimeout(resolve, 50)); lateExecution = await db.automationExecution.findFirst({ where: { tenantId: tenantAId, automationId: rule.body.id, appointmentId: lateAppointment.body.id } }); }
      expect(lateExecution?.status).toBe('PENDING');
      expect(lateExecution?.lastError).toMatch(/^Adiada:/);
      // Avance os contatos fictícios para outro dia e feche a conversa antes da segunda pesquisa.
      const priorDay = new Date(Date.now() - 86400000);
      await db.outboxMessage.updateMany({ where: { tenantId: tenantAId, patientId: patient.id, status: { in: ['SIMULATED', 'SENT'] } }, data: { sentAt: priorDay } });
      await db.message.updateMany({ where: { tenantId: tenantAId, direction: 'OUTBOUND', conversation: { tenantId: tenantAId, patientId: patient.id } }, data: { createdAt: priorDay } });
      await db.conversation.updateMany({ where: { tenantId: tenantAId, patientId: patient.id }, data: { status: 'CLOSED', lastMessageAt: priorDay } });
      await db.automationExecution.update({ where: { id: lateExecution!.id }, data: { scheduledAt: new Date(Date.now() - 1000) } });
      await app.get(AutomationsService).reconcileDueExecutions(tenantAId);
      for (let attempt = 0; attempt < 200 && (!lateExecution || lateExecution.status === 'PENDING'); attempt++) { await new Promise((resolve) => setTimeout(resolve, 50)); lateExecution = await db.automationExecution.findFirst({ where: { tenantId: tenantAId, automationId: rule.body.id, appointmentId: lateAppointment.body.id } }); }
      expect(lateExecution?.status, lateExecution?.lastError ?? 'Sem motivo registrado').toBe('OUTBOXED');
      const lateSurvey = await db.satisfactionSurvey.findFirstOrThrow({ where: { tenantId: tenantAId, automationId: rule.body.id, appointmentId: lateAppointment.body.id } });
      const lateOutbox = await db.outboxMessage.findUniqueOrThrow({ where: { id: lateSurvey.outboxMessageId! } });
      await db.conversation.updateMany({ where: { tenantId: tenantAId, patientId: patient.id }, data: { status: 'CLOSED', lastMessageAt: priorDay } });
      await db.outboxMessage.update({ where: { id: lateOutbox.id }, data: { scheduledAt: new Date(Date.now() - 1000), nextAttemptAt: new Date(Date.now() - 1000) } });
      await request(app.getHttpServer()).post('/api/outbox/dry-run/dispatch').set('Authorization', `Bearer ${adminToken}`).send({ limit: 10 }).expect(201);
      let lateDispatched = await db.outboxMessage.findUniqueOrThrow({ where: { id: lateOutbox.id } });
      for (let attempt = 0; attempt < 200 && !['SIMULATED', 'FAILED', 'SUPPRESSED', 'UNKNOWN'].includes(lateDispatched.status); attempt++) { await new Promise((resolve) => setTimeout(resolve, 50)); lateDispatched = await db.outboxMessage.findUniqueOrThrow({ where: { id: lateOutbox.id } }); }
      expect(lateDispatched.status, lateDispatched.lastError ?? 'Sem motivo registrado').toBe('SIMULATED');
      await db.satisfactionSurvey.update({ where: { id: lateSurvey.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
      await postReply(`survey-late-${suffix}`, 'BOM');
      const expiredSurvey = await db.satisfactionSurvey.findUniqueOrThrow({ where: { id: lateSurvey.id } });
      expect(expiredSurvey).toMatchObject({ state: 'EXPIRED', classification: null, respondedAt: null });
      expect(await db.task.count({ where: { tenantId: tenantAId, patientId: patient.id, appointmentId: lateAppointment.body.id, title: 'Pesquisa de satisfação sem resposta' } })).toBe(1);
      const results = await request(app.getHttpServer()).get(`/api/automations/${rule.body.id}/satisfaction-results`).set('Authorization', `Bearer ${adminToken}`).expect(200);
      expect(results.body.received).toMatchObject({ EXCELLENT: 0, GOOD: 0, REGULAR: 0, POOR: 1, VERY_POOR: 0 });
      expect(results.body).toMatchObject({ total: 2, expired: 1 });
      const currentRule = (await request(app.getHttpServer()).get('/api/automations').set('Authorization', `Bearer ${adminToken}`).expect(200)).body.find((item: { id: string }) => item.id === rule.body.id);
      expect(currentRule.metrics.taskCount).toBe(2);
      await request(app.getHttpServer()).patch(`/api/automations/${rule.body.id}/status`).set('Authorization', `Bearer ${adminToken}`).send({ status: 'PAUSED' }).expect(200);
    } finally {
      if (previousMode === undefined) delete process.env.OUTBOX_DISPATCH_MODE; else process.env.OUTBOX_DISPATCH_MODE = previousMode;
    }
  }, 30_000);

  it('atomically pauses a rule and suppresses its already queued execution and pending outbox message', async () => {
    const adminToken = await accessToken(tenantAId, adminMembershipId, adminSessionId, adminUserId, UserRole.TENANT_ADMIN);
    const phone = `551188${Date.now().toString().slice(-8)}`;
    const patient = await db.patient.create({ data: { tenantId: tenantAId, unitId: unitA1Id, fullName: `Pause ${suffix}`, phone, phoneNormalized: phone } });
    const connection = await db.metaConnection.create({ data: { tenantId: tenantAId, unitId: unitA1Id, wabaId: `pause-waba-${suffix}`, phoneNumberId: `pause-phone-${suffix}`, accessTokenEncrypted: 'test-only-encrypted-placeholder', status: 'CONNECTED', enabled: true } });
    const configuration = { unitId: unitA1Id, advanceMinutes: 60, allowedStartHour: 0, allowedEndHour: 24, provider: 'META_CLOUD', connectionId: connection.id, body: 'Confirme respondendo CONFIRMAR', confirmKeywords: ['CONFIRMAR'], rescheduleKeywords: ['REAGENDAR'], humanKeywords: ['ATENDENTE'], noResponseAction: 'NONE', responsibleUserId: adminUserId };
    const rule = await request(app.getHttpServer()).post('/api/automations').set('Authorization', `Bearer ${adminToken}`).send({ name: `Pausar E2E ${suffix}`, trigger: 'APPOINTMENT_CONFIRMATION', configuration }).expect(201);
    await request(app.getHttpServer()).patch(`/api/automations/${rule.body.id}/status`).set('Authorization', `Bearer ${adminToken}`).send({ status: 'ACTIVE' }).expect(200);
    const startsAt = new Date(Date.now() + 3 * 60 * 60_000);
    const appointment = await request(app.getHttpServer()).post('/api/appointments').set('Authorization', `Bearer ${adminToken}`).send({ unitId: unitA1Id, patientId: patient.id, startsAt: startsAt.toISOString(), endsAt: new Date(startsAt.getTime() + 30 * 60_000).toISOString() }).expect(201);
    const execution = await db.automationExecution.findFirstOrThrow({ where: { tenantId: tenantAId, automationId: rule.body.id, appointmentId: appointment.body.id } });
    const outbox = await db.outboxMessage.create({ data: { tenantId: tenantAId, patientId: patient.id, purpose: 'APPOINTMENT_REMINDER', channel: 'WHATSAPP', provider: 'META_CLOUD', connectionId: connection.id, body: 'Local pending fixture', idempotencyKey: `pause-outbox-${suffix}` } });
    await db.automationExecution.update({ where: { id: execution.id }, data: { status: 'OUTBOXED', outboxMessageId: outbox.id } });
    await request(app.getHttpServer()).patch(`/api/automations/${rule.body.id}/status`).set('Authorization', `Bearer ${adminToken}`).send({ status: 'PAUSED' }).expect(200);
    expect(await db.automationExecution.findUniqueOrThrow({ where: { id: execution.id } })).toMatchObject({ status: 'CANCELLED', lastError: 'RULE_PAUSED' });
    expect(await db.outboxMessage.findUniqueOrThrow({ where: { id: outbox.id } })).toMatchObject({ status: 'SUPPRESSED', suppressionReason: 'RULE_PAUSED' });
  }, 30_000);

  it('runs an approved, idempotent referral reward lifecycle without creating a patient or consent from a click', async () => {
    const adminToken = await accessToken(tenantAId, adminMembershipId, adminSessionId, adminUserId, UserRole.TENANT_ADMIN);
    const operatorToken = await accessToken(tenantAId, membershipAId, activeSessionId, userAId);
    const startsAt = new Date(Date.now() - 60_000);
    const campaign = await request(app.getHttpServer()).post('/api/referrals/campaigns').set('Authorization', `Bearer ${adminToken}`).send({ name: `Indicação E2E ${suffix}`, description: 'Teste local; campanha configurável.', unitIds: [unitA1Id], startsAt: startsAt.toISOString(), qualificationCriterion: 'LEAD_REGISTERED', rewardEveryQualifiedCount: 1, rewardType: 'SESSION_CREDIT', rewardQuantity: 5, rewardDescription: 'Até cinco créditos internos sujeitos à aprovação', rewardValidityDays: 90, maxRewardsPerParticipant: 1, requireHumanApproval: true }).expect(201);
    await request(app.getHttpServer()).patch(`/api/referrals/campaigns/${campaign.body.id}/status`).set('Authorization', `Bearer ${adminToken}`).send({ status: 'ACTIVE' }).expect(200);
    const participant = await request(app.getHttpServer()).post(`/api/referrals/campaigns/${campaign.body.id}/participants`).set('Authorization', `Bearer ${adminToken}`).send({ patientId: patientA1Id, unitId: unitA1Id }).expect(201);
    expect(participant.body.token).toHaveLength(43);
    expect(JSON.stringify(participant.body)).not.toContain('Paciente unidade permitida');
    const beforePatients = await db.patient.count({ where: { tenantId: tenantAId } });
    const click = await request(app.getHttpServer()).post(`/api/referrals/public/${participant.body.token}/click`).send({ clickKey: `click-${suffix}-0000000001` }).expect(201);
    const repeatedClick = await request(app.getHttpServer()).post(`/api/referrals/public/${participant.body.token}/click`).send({ clickKey: `click-${suffix}-0000000001` }).expect(201);
    expect(repeatedClick.body.claimToken).toBe(click.body.claimToken);
    expect(click.body).toMatchObject({ patientCreated: false, consentRecorded: false });
    expect(await db.patient.count({ where: { tenantId: tenantAId } })).toBe(beforePatients);
    const leadPhone = `55${Date.now().toString().slice(-10)}`;
    const lead = await request(app.getHttpServer()).post(`/api/referrals/public/lead/${click.body.claimToken}`).send({ phone: leadPhone }).expect(201);
    expect(lead.body).toMatchObject({ accepted: true, status: 'QUALIFIED', patientCreated: false, consentRecorded: false });
    const rewards = await request(app.getHttpServer()).get('/api/referrals/rewards').set('Authorization', `Bearer ${adminToken}`).expect(200);
    const reward = rewards.body.find((row: { campaignId: string }) => row.campaignId === campaign.body.id);
    expect(reward).toBeTruthy();
    expect(reward.status).toBe('PENDING_APPROVAL');
    await request(app.getHttpServer()).patch(`/api/referrals/rewards/${reward.id}/decision`).set('Authorization', `Bearer ${operatorToken}`).send({ action: 'APPROVE' }).expect(403);
    await request(app.getHttpServer()).post(`/api/referrals/rewards/${reward.id}/issue`).set('Authorization', `Bearer ${adminToken}`).expect(409);
    await request(app.getHttpServer()).patch(`/api/referrals/rewards/${reward.id}/decision`).set('Authorization', `Bearer ${adminToken}`).send({ action: 'APPROVE' }).expect(200);
    await request(app.getHttpServer()).patch(`/api/referrals/rewards/${reward.id}/decision`).set('Authorization', `Bearer ${adminToken}`).send({ action: 'APPROVE' }).expect(409);
    const issued = await request(app.getHttpServer()).post(`/api/referrals/rewards/${reward.id}/issue`).set('Authorization', `Bearer ${adminToken}`).expect(201);
    expect(new Date(issued.body.expiresAt).getTime() - new Date(issued.body.issuedAt).getTime()).toBe(90 * 86400000);
    expect(issued.body.voucherCode).toBeTruthy();
    const redeemed = await request(app.getHttpServer()).post('/api/referrals/rewards/redeem').set('Authorization', `Bearer ${adminToken}`).send({ code: issued.body.voucherCode, unitId: unitA1Id, quantity: 3, idempotencyKey: `redeem-${suffix}-00000001` }).expect(201);
    const repeated = await request(app.getHttpServer()).post('/api/referrals/rewards/redeem').set('Authorization', `Bearer ${adminToken}`).send({ code: issued.body.voucherCode, unitId: unitA1Id, quantity: 3, idempotencyKey: `redeem-${suffix}-00000001` }).expect(201);
    expect(repeated.body).toMatchObject({ id: redeemed.body.id, duplicate: true });
    await request(app.getHttpServer()).post('/api/referrals/rewards/redeem').set('Authorization', `Bearer ${adminToken}`).send({ code: issued.body.voucherCode, unitId: unitA1Id, quantity: 3, idempotencyKey: `redeem-${suffix}-00000002` }).expect(409);
    const conversionCampaign = await request(app.getHttpServer()).post('/api/referrals/campaigns').set('Authorization', `Bearer ${adminToken}`).send({ name: `Conversão nativa E2E ${suffix}`, unitIds: [unitA1Id], startsAt: startsAt.toISOString(), qualificationCriterion: 'FIRST_NATIVE_APPOINTMENT_COMPLETED', rewardEveryQualifiedCount: 1, rewardType: 'VOUCHER', rewardQuantity: 1, rewardDescription: 'Voucher de teste após conclusão nativa', rewardValidityDays: 90, maxRewardsPerParticipant: 1, requireHumanApproval: true }).expect(201);
    await request(app.getHttpServer()).patch(`/api/referrals/campaigns/${conversionCampaign.body.id}/status`).set('Authorization', `Bearer ${adminToken}`).send({ status: 'ACTIVE' }).expect(200);
    const conversionParticipant = await request(app.getHttpServer()).post(`/api/referrals/campaigns/${conversionCampaign.body.id}/participants`).set('Authorization', `Bearer ${adminToken}`).send({ patientId: patientA1Id, unitId: unitA1Id }).expect(201);
    const conversionClick = await request(app.getHttpServer()).post(`/api/referrals/public/${conversionParticipant.body.token}/click`).send({ clickKey: `conversion-${suffix}-00000001` }).expect(201);
    const conversionLeadPhone = `55${(Date.now() + 2).toString().slice(-10)}`;
    const conversionLead = await request(app.getHttpServer()).post(`/api/referrals/public/lead/${conversionClick.body.claimToken}`).send({ phone: conversionLeadPhone }).expect(201);
    const referredPatient = await db.patient.create({ data: { tenantId: tenantAId, unitId: unitA1Id, fullName: `Referred patient ${suffix}`, phone: conversionLeadPhone, phoneNormalized: conversionLeadPhone } });
    await request(app.getHttpServer()).patch(`/api/referrals/${conversionLead.body.id}/patient`).set('Authorization', `Bearer ${adminToken}`).send({ patientId: referredPatient.id }).expect(200);
    const apptStart = new Date(Date.now() + 4 * 60 * 60_000);
    const eligibleAppointment = await request(app.getHttpServer()).post('/api/appointments').set('Authorization', `Bearer ${adminToken}`).send({ unitId: unitA1Id, patientId: referredPatient.id, startsAt: apptStart.toISOString(), endsAt: new Date(apptStart.getTime() + 30 * 60_000).toISOString() }).expect(201);
    await request(app.getHttpServer()).patch(`/api/appointments/${eligibleAppointment.body.id}/status`).set('Authorization', `Bearer ${adminToken}`).send({ status: 'CONFIRMED' }).expect(200);
    await db.appointment.update({ where: { id: eligibleAppointment.body.id }, data: { startsAt: new Date(Date.now() - 60 * 60_000), endsAt: new Date(Date.now() - 30 * 60_000) } });
    await request(app.getHttpServer()).patch(`/api/appointments/${eligibleAppointment.body.id}/status`).set('Authorization', `Bearer ${adminToken}`).send({ status: 'COMPLETED' }).expect(200);
    const converted = await db.referral.findUniqueOrThrow({ where: { id: conversionLead.body.id } });
    expect(converted).toMatchObject({ status: 'CONVERTED', appointmentId: eligibleAppointment.body.id });
    expect(await db.referralReward.count({ where: { tenantId: tenantAId, campaignId: conversionCampaign.body.id } })).toBe(1);
    const card = await request(app.getHttpServer()).get(`/api/referrals/loyalty/${patientA1Id}`).set('Authorization', `Bearer ${adminToken}`).expect(200);
    expect(card.body.progress.some((item: { campaign: { id: string }; qualified: number }) => item.campaign.id === campaign.body.id && item.qualified === 1)).toBe(true);
  }, 30_000);

  it('converts only the first eligible native completion and rejects duplicate, unrelated, and Uno events', async () => {
    const adminToken = await accessToken(tenantAId, adminMembershipId, adminSessionId, adminUserId, UserRole.TENANT_ADMIN);
    const campaign = await request(app.getHttpServer()).post('/api/referrals/campaigns').set('Authorization', `Bearer ${adminToken}`).send({ name: `Eligibility E2E ${suffix}`, unitIds: [unitA1Id], startsAt: new Date(Date.now() - 60_000).toISOString(), qualificationCriterion: 'FIRST_NATIVE_APPOINTMENT_COMPLETED', rewardEveryQualifiedCount: 1, rewardType: 'VOUCHER', rewardQuantity: 1, rewardDescription: 'Recompensa fictícia de elegibilidade', requireHumanApproval: true }).expect(201);
    await request(app.getHttpServer()).patch(`/api/referrals/campaigns/${campaign.body.id}/status`).set('Authorization', `Bearer ${adminToken}`).send({ status: 'ACTIVE' }).expect(200);
    const participant = await request(app.getHttpServer()).post(`/api/referrals/campaigns/${campaign.body.id}/participants`).set('Authorization', `Bearer ${adminToken}`).send({ patientId: patientA1Id, unitId: unitA1Id }).expect(201);
    const click = await request(app.getHttpServer()).post(`/api/referrals/public/${participant.body.token}/click`).send({ clickKey: `eligibility-${suffix}-00000001` }).expect(201);
    const phone = `55${(Date.now() + 12).toString().slice(-10)}`;
    const lead = await request(app.getHttpServer()).post(`/api/referrals/public/lead/${click.body.claimToken}`).send({ phone }).expect(201);
    const referred = await db.patient.create({ data: { tenantId: tenantAId, unitId: unitA1Id, fullName: `Eligibility referred ${suffix}`, phone, phoneNormalized: phone } });
    await request(app.getHttpServer()).patch(`/api/referrals/${lead.body.id}/patient`).set('Authorization', `Bearer ${adminToken}`).send({ patientId: referred.id }).expect(200);

    const createAppointment = async (patientId: string, unitId: string, status: 'PENDING' | 'CONFIRMED' = 'PENDING', source = 'NATIVE', startsInPast = false) => {
      const start = new Date(Date.now() + (startsInPast ? -60 : 8 * 60) * 60_000 + Math.floor(Math.random() * 60_000));
      const appointment = await db.appointment.create({ data: { tenantId: tenantAId, unitId, patientId, startsAt: start, endsAt: new Date(start.getTime() + 30 * 60_000), status, source: source as 'NATIVE' | 'UNO' } });
      return appointment;
    };

    const pending = await createAppointment(referred.id, unitA1Id);
    await request(app.getHttpServer()).patch(`/api/appointments/${pending.id}/status`).set('Authorization', `Bearer ${adminToken}`).send({ status: 'PAID' }).expect(400);
    await request(app.getHttpServer()).patch(`/api/appointments/${pending.id}/status`).set('Authorization', `Bearer ${adminToken}`).send({ status: 'CONFIRMED' }).expect(200);
    expect((await db.referral.findUniqueOrThrow({ where: { id: lead.body.id } })).status).toBe('PATIENT_LINKED');
    await request(app.getHttpServer()).patch(`/api/appointments/${pending.id}/status`).set('Authorization', `Bearer ${adminToken}`).send({ status: 'CANCELLED' }).expect(200);

    const noShow = await createAppointment(referred.id, unitA1Id);
    await request(app.getHttpServer()).patch(`/api/appointments/${noShow.id}/status`).set('Authorization', `Bearer ${adminToken}`).send({ status: 'CONFIRMED' }).expect(200);
    await request(app.getHttpServer()).patch(`/api/appointments/${noShow.id}/status`).set('Authorization', `Bearer ${adminToken}`).send({ status: 'NO_SHOW' }).expect(200);
    expect((await db.referral.findUniqueOrThrow({ where: { id: lead.body.id } })).status).toBe('PATIENT_LINKED');

    const unrelated = await createAppointment(patientA1Id, unitA1Id, 'CONFIRMED', 'NATIVE', true);
    await request(app.getHttpServer()).patch(`/api/appointments/${unrelated.id}/status`).set('Authorization', `Bearer ${adminToken}`).send({ status: 'COMPLETED' }).expect(200);
    const otherUnitAppointment = await createAppointment(patientA2Id, unitA2Id, 'CONFIRMED', 'NATIVE', true);
    await request(app.getHttpServer()).patch(`/api/appointments/${otherUnitAppointment.id}/status`).set('Authorization', `Bearer ${adminToken}`).send({ status: 'COMPLETED' }).expect(200);
    const otherTenantStart = new Date(Date.now() + 9 * 60 * 60_000);
    const otherTenantAppointment = await db.appointment.create({ data: { tenantId: tenantBId, unitId: unitBId, patientId: patientBId, startsAt: otherTenantStart, endsAt: new Date(otherTenantStart.getTime() + 30 * 60_000), status: 'CONFIRMED', source: 'NATIVE' } });
    await request(app.getHttpServer()).patch(`/api/appointments/${otherTenantAppointment.id}/status`).set('Authorization', `Bearer ${adminToken}`).send({ status: 'COMPLETED' }).expect(404);
    const unoAppointment = await createAppointment(referred.id, unitA1Id, 'CONFIRMED', 'UNO');
    await request(app.getHttpServer()).patch(`/api/appointments/${unoAppointment.id}/status`).set('Authorization', `Bearer ${adminToken}`).send({ status: 'COMPLETED' }).expect(400);
    expect((await db.referral.findUniqueOrThrow({ where: { id: lead.body.id } })).status).toBe('PATIENT_LINKED');

    const eligible = await createAppointment(referred.id, unitA1Id, 'CONFIRMED', 'NATIVE', true);
    await request(app.getHttpServer()).patch(`/api/appointments/${eligible.id}/status`).set('Authorization', `Bearer ${adminToken}`).send({ status: 'COMPLETED' }).expect(200);
    expect(await db.referral.findUniqueOrThrow({ where: { id: lead.body.id } })).toMatchObject({ status: 'CONVERTED', appointmentId: eligible.id });
    expect(await db.referralReward.count({ where: { tenantId: tenantAId, campaignId: campaign.body.id } })).toBe(1);
    await request(app.getHttpServer()).patch(`/api/appointments/${eligible.id}/status`).set('Authorization', `Bearer ${adminToken}`).send({ status: 'COMPLETED' }).expect(400);
    expect(await db.referralReward.count({ where: { tenantId: tenantAId, campaignId: campaign.body.id } })).toBe(1);
    const operatorToken = await accessToken(tenantAId, membershipAId, activeSessionId, userAId, UserRole.OPERATOR);
    await request(app.getHttpServer()).patch(`/api/referrals/${lead.body.id}/status`).set('Authorization', `Bearer ${operatorToken}`).send({ status: 'REVERSED', reason: 'Motivo de teste' }).expect(403);
    await request(app.getHttpServer()).patch(`/api/referrals/${lead.body.id}/status`).set('Authorization', `Bearer ${adminToken}`).send({ status: 'REVERSED' }).expect(400);
    await request(app.getHttpServer()).patch(`/api/referrals/${lead.body.id}/status`).set('Authorization', `Bearer ${adminToken}`).send({ status: 'REVERSED', reason: 'Erro de associação confirmado em teste' }).expect(200);
    await request(app.getHttpServer()).patch(`/api/referrals/${lead.body.id}/status`).set('Authorization', `Bearer ${adminToken}`).send({ status: 'REVERSED', reason: 'Repetição duplicada' }).expect(409);
    expect(await db.referralEvent.count({ where: { tenantId: tenantAId, referralId: lead.body.id, event: 'NATIVE_APPOINTMENT_CONVERTED' } })).toBe(1);
    expect(await db.referralEvent.count({ where: { tenantId: tenantAId, referralId: lead.body.id, event: 'REVERSED' } })).toBe(1);
    expect(await db.auditEvent.count({ where: { tenantId: tenantAId, entityType: 'Referral', entityId: lead.body.id, action: 'REFERRAL_REVERSED' } })).toBe(1);
    const reward = await db.referralReward.findFirstOrThrow({ where: { tenantId: tenantAId, campaignId: campaign.body.id } });
    expect(reward.status).toBe('CANCELLED');
    expect(reward.voucherHash).toBeNull();
  }, 30_000);

  it('creates only one pending reward at a configured fictitious 20-referral milestone and preserves its event history on reversal', async () => {
    const adminToken = await accessToken(tenantAId, adminMembershipId, adminSessionId, adminUserId, UserRole.TENANT_ADMIN);
    const campaign = await request(app.getHttpServer()).post('/api/referrals/campaigns').set('Authorization', `Bearer ${adminToken}`).send({ name: `Fictitious 20 referral target ${suffix}`, description: 'Somente critério técnico fictício; regra comercial depende de confirmação da Maislaser.', unitIds: [unitA1Id], startsAt: new Date(Date.now() - 60_000).toISOString(), qualificationCriterion: 'LEAD_REGISTERED', rewardEveryQualifiedCount: 20, rewardType: 'VOUCHER', rewardQuantity: 1, rewardDescription: 'Recompensa técnica sujeita à aprovação', rewardValidityDays: 90, maxRewardsPerParticipant: 1, requireHumanApproval: true }).expect(201);
    await request(app.getHttpServer()).patch(`/api/referrals/campaigns/${campaign.body.id}/status`).set('Authorization', `Bearer ${adminToken}`).send({ status: 'ACTIVE' }).expect(200);
    const participant = await request(app.getHttpServer()).post(`/api/referrals/campaigns/${campaign.body.id}/participants`).set('Authorization', `Bearer ${adminToken}`).send({ patientId: patientA1Id, unitId: unitA1Id }).expect(201);
    const qualifiedAt = new Date();
    await db.referral.createMany({ data: Array.from({ length: 19 }, (_, index) => ({ tenantId: tenantAId, campaignId: campaign.body.id, participantId: participant.body.participantId, indicatorPatientId: patientA1Id, unitId: unitA1Id, clickKey: `mile-${suffix}-${String(index).padStart(3, '0')}`, claimTokenHash: `sha256-test-${suffix}-${String(index).padStart(3, '0')}`, leadPhoneNormalized: `5512${String(index).padStart(9, '0')}`, status: 'QUALIFIED' as const, qualifiedAt, qualificationEvidence: 'Fixture técnica; regra comercial não homologada' })) });
    const before = await request(app.getHttpServer()).get(`/api/referrals/loyalty/${patientA1Id}`).set('Authorization', `Bearer ${adminToken}`).expect(200);
    expect(before.body.progress.find((item: { campaign: { id: string } }) => item.campaign.id === campaign.body.id)).toMatchObject({ qualified: 19, target: 20, remaining: 1 });
    const click = await request(app.getHttpServer()).post(`/api/referrals/public/${participant.body.token}/click`).send({ clickKey: `mile-final-${suffix}-0001` }).expect(201);
    const phone = `5598${Date.now().toString().slice(-9)}`;
    const lead = await request(app.getHttpServer()).post(`/api/referrals/public/lead/${click.body.claimToken}`).send({ phone }).expect(201);
    expect(lead.body.status).toBe('QUALIFIED');
    const repeated = await request(app.getHttpServer()).post(`/api/referrals/public/lead/${click.body.claimToken}`).send({ phone }).expect(201);
    expect(repeated.body).toMatchObject({ accepted: true, status: 'QUALIFIED', patientCreated: false, consentRecorded: false });
    expect(await db.referralReward.count({ where: { tenantId: tenantAId, campaignId: campaign.body.id, participantId: participant.body.id } })).toBe(1);
    const reward = await db.referralReward.findFirstOrThrow({ where: { tenantId: tenantAId, campaignId: campaign.body.id, participantId: participant.body.id } });
    expect(reward.status).toBe('PENDING_APPROVAL');
    expect(reward.voucherHash).toBeNull();
    const operatorToken = await accessToken(tenantAId, membershipAId, activeSessionId, userAId, UserRole.OPERATOR);
    await request(app.getHttpServer()).patch(`/api/referrals/${lead.body.id}/status`).set('Authorization', `Bearer ${operatorToken}`).send({ status: 'REVERSED', reason: 'Sem permissão' }).expect(403);
    await request(app.getHttpServer()).patch(`/api/referrals/${lead.body.id}/status`).set('Authorization', `Bearer ${adminToken}`).send({ status: 'REVERSED', reason: 'Correção de teste após marco fictício' }).expect(200);
    await request(app.getHttpServer()).patch(`/api/referrals/${lead.body.id}/status`).set('Authorization', `Bearer ${adminToken}`).send({ status: 'REVERSED', reason: 'Repetida' }).expect(409);
    expect(await db.referralEvent.count({ where: { tenantId: tenantAId, referralId: lead.body.id, event: { in: ['CLICKED', 'LEAD_REGISTERED', 'QUALIFIED', 'REVERSED'] } } })).toBe(4);
    expect((await db.referralReward.findUniqueOrThrow({ where: { id: reward.id } })).status).toBe('CANCELLED');
    expect(await db.auditEvent.count({ where: { tenantId: tenantAId, entityType: 'Referral', entityId: lead.body.id, action: 'REFERRAL_REVERSED' } })).toBe(1);
  }, 30_000);

  it('serializes concurrent voucher redemption, denies another unit, and expires without touching Uno', async () => {
    const adminToken = await accessToken(tenantAId, adminMembershipId, adminSessionId, adminUserId, UserRole.TENANT_ADMIN);
    const campaign = await request(app.getHttpServer()).post('/api/referrals/campaigns').set('Authorization', `Bearer ${adminToken}`).send({ name: `Voucher concurrency E2E ${suffix}`, unitIds: [unitA1Id], startsAt: new Date(Date.now() - 60_000).toISOString(), qualificationCriterion: 'LEAD_REGISTERED', rewardEveryQualifiedCount: 1, rewardType: 'SESSION_CREDIT', rewardQuantity: 1, rewardDescription: 'Crédito somente interno ao SaaS de teste', requireHumanApproval: true }).expect(201);
    await request(app.getHttpServer()).patch(`/api/referrals/campaigns/${campaign.body.id}/status`).set('Authorization', `Bearer ${adminToken}`).send({ status: 'ACTIVE' }).expect(200);
    const participant = await request(app.getHttpServer()).post(`/api/referrals/campaigns/${campaign.body.id}/participants`).set('Authorization', `Bearer ${adminToken}`).send({ patientId: patientA1Id, unitId: unitA1Id }).expect(201);
    const click = await request(app.getHttpServer()).post(`/api/referrals/public/${participant.body.token}/click`).send({ clickKey: `voucher-race-${suffix}-0001` }).expect(201);
    const phone = `5577${Date.now().toString().slice(-9)}`;
    await request(app.getHttpServer()).post(`/api/referrals/public/lead/${click.body.claimToken}`).send({ phone }).expect(201);
    const rewardResponse = await request(app.getHttpServer()).get('/api/referrals/rewards').set('Authorization', `Bearer ${adminToken}`).expect(200);
    const reward = rewardResponse.body.find((row: { campaignId: string }) => row.campaignId === campaign.body.id);
    await request(app.getHttpServer()).post(`/api/referrals/rewards/${reward.id}/issue`).set('Authorization', `Bearer ${adminToken}`).expect(409);
    await request(app.getHttpServer()).patch(`/api/referrals/rewards/${reward.id}/decision`).set('Authorization', `Bearer ${adminToken}`).send({ action: 'APPROVE' }).expect(200);
    const issued = await request(app.getHttpServer()).post(`/api/referrals/rewards/${reward.id}/issue`).set('Authorization', `Bearer ${adminToken}`).expect(201);
    expect(new Date(issued.body.expiresAt).getTime() - new Date(issued.body.issuedAt).getTime()).toBe(90 * 86400000);
    await request(app.getHttpServer()).post('/api/referrals/rewards/redeem').set('Authorization', `Bearer ${adminToken}`).send({ code: issued.body.voucherCode, unitId: unitA2Id, quantity: 1, idempotencyKey: `wrong-unit-${suffix}-00001` }).expect(403);
    const results = await Promise.all([
      request(app.getHttpServer()).post('/api/referrals/rewards/redeem').set('Authorization', `Bearer ${adminToken}`).send({ code: issued.body.voucherCode, unitId: unitA1Id, quantity: 1, idempotencyKey: `race-one-${suffix}-0000001` }),
      request(app.getHttpServer()).post('/api/referrals/rewards/redeem').set('Authorization', `Bearer ${adminToken}`).send({ code: issued.body.voucherCode, unitId: unitA1Id, quantity: 1, idempotencyKey: `race-two-${suffix}-0000002` }),
    ]);
    expect(results.map((response) => response.status).sort()).toEqual([201, 409]);
    expect((await db.referralReward.findUniqueOrThrow({ where: { id: reward.id } })).usedQty).toBe(1);
    expect(await db.referralRewardUse.count({ where: { tenantId: tenantAId, rewardId: reward.id } })).toBe(1);
    const expiredCode = `EXP-${suffix}`.toUpperCase();
    const expiredReward = await db.referralReward.create({ data: { tenantId: tenantAId, campaignId: campaign.body.id, participantId: participant.body.participantId, unitId: unitA1Id, milestoneNumber: 999, type: 'VOUCHER', description: 'Voucher expirado de fixture', authorizedQty: 1, status: 'ISSUED', issuedById: adminUserId, issuedAt: new Date(Date.now() - 2 * 86400000), expiresAt: new Date(Date.now() - 86400000), voucherHash: createHash('sha256').update(expiredCode).digest('hex'), voucherLast4: '0000' } });
    const unoEventsBefore = await db.unoEvent.count({ where: { tenantId: tenantAId } });
    await request(app.getHttpServer()).post('/api/referrals/rewards/redeem').set('Authorization', `Bearer ${adminToken}`).send({ code: expiredCode, unitId: unitA1Id, quantity: 1, idempotencyKey: `expired-redeem-${suffix}-00001` }).expect(409);
    expect((await db.referralReward.findUniqueOrThrow({ where: { id: expiredReward.id } })).status).toBe('EXPIRED');
    expect(await db.unoEvent.count({ where: { tenantId: tenantAId } })).toBe(unoEventsBefore);
  }, 30_000);

  it('links an authenticated Evolution reply to a procedure-return execution once, including a duplicate provider event', async () => {
    const adminToken = await accessToken(tenantAId, adminMembershipId, adminSessionId, adminUserId, UserRole.TENANT_ADMIN);
    const phone = `55${Date.now().toString().slice(-10)}`;
    const patient = await db.patient.create({ data: { tenantId: tenantAId, unitId: unitA1Id, fullName: `Evolution return ${suffix}`, phone, phoneNormalized: phone } });
    const procedure = await db.procedure.create({ data: { tenantId: tenantAId, unitId: unitA1Id, name: `Evolution return procedure ${suffix}`, appointmentDurationMinutes: 30, returnAfterDays: 10, reminderAdvanceDays: 2 } });
    const connection = await request(app.getHttpServer()).post('/api/messaging/connections/evolution').set('Authorization', `Bearer ${adminToken}`).send({ displayName: 'Evolution return E2E', unitId: unitA1Id, apiBaseUrl: 'https://evolution.example.test', instanceName: `return-instance-${suffix}`, apiVersion: 'UNCONFIRMED', apiKey: `return-api-key-${suffix}`, mode: 'EVOLUTION_BAILEYS' }).expect(201);
    const rule = await db.automation.create({ data: { tenantId: tenantAId, name: `Evolution return rule ${suffix}`, trigger: 'PROCEDURE_RETURN', status: 'ACTIVE', createdById: adminUserId, configuration: { unitId: unitA1Id, procedureId: procedure.id, advanceMinutes: 0, allowedStartHour: 0, allowedEndHour: 24, allowedDaysOfWeek: [0,1,2,3,4,5,6], provider: 'EVOLUTION_BAILEYS', connectionId: connection.body.id, body: 'Retorno fictício', responseWindowHours: 72, maxContactsPerPatient: 2, interestKeywords: ['TENHO INTERESSE'], rescheduleKeywords: ['AGENDAR'], noContactKeywords: ['NAO QUERO CONTATO'], noResponseAction: 'CREATE_TASK', responsibleUserId: adminUserId } } });
    const appointment = await db.appointment.create({ data: { tenantId: tenantAId, unitId: unitA1Id, patientId: patient.id, procedureId: procedure.id, startsAt: new Date(Date.now() - 40 * 86400000), endsAt: new Date(Date.now() - 40 * 86400000 + 30 * 60_000), status: 'COMPLETED', source: 'NATIVE', completedAt: new Date(Date.now() - 40 * 86400000) } });
    const execution = await db.automationExecution.create({ data: { tenantId: tenantAId, unitId: unitA1Id, automationId: rule.id, appointmentId: appointment.id, patientId: patient.id, idempotencyKey: `procedure-return:${rule.id}:${appointment.id}:${appointment.startsAt.toISOString()}`, status: 'OUTBOXED', scheduledAt: new Date(Date.now() - 60_000), responseDeadlineAt: new Date(Date.now() + 60 * 60_000) } });
    const outbox = await db.outboxMessage.create({ data: { tenantId: tenantAId, patientId: patient.id, purpose: 'PROCEDURE_RETURN', channel: 'WHATSAPP', provider: 'EVOLUTION_BAILEYS', connectionId: connection.body.id, body: 'Resposta apenas simulada localmente', idempotencyKey: `evolution-return-outbox-${suffix}`, status: 'SIMULATED' } });
    await db.automationExecution.update({ where: { id: execution.id }, data: { outboxMessageId: outbox.id } });
    await db.consentPreference.create({ data: { tenantId: tenantAId, patientId: patient.id, channel: 'WHATSAPP', purpose: 'PROCEDURE_RETURN', status: 'GRANTED', source: 'MANUAL', evidence: 'Fixture fictícia E2E; nenhum envio externo', evidenceType: 'WRITTEN_FORM', evidenceReference: `evolution-return-consent-${suffix}` } });
    const payload = { event: 'MESSAGES_UPSERT', instance: `return-instance-${suffix}`, data: { key: { id: `evolution-return-reply-${suffix}`, remoteJid: `${phone}@s.whatsapp.net`, fromMe: false }, message: { conversation: 'TENHO INTERESSE' }, messageTimestamp: Math.floor(Date.now() / 1000) } };
    const webhook = () => request(app.getHttpServer()).post(`/api/evolution/webhook/${connection.body.id}`).set('x-evolution-webhook-secret', connection.body.webhookSecret).send(payload).expect(201);
    await webhook();
    await webhook();
    let event = await db.evolutionWebhookEvent.findFirstOrThrow({ where: { tenantId: tenantAId, connectionId: connection.body.id, providerMessageId: `evolution-return-reply-${suffix}` } });
    for (let attempt = 0; attempt < 100 && event.status !== 'PROCESSED'; attempt++) { await new Promise((resolve) => setTimeout(resolve, 50)); event = await db.evolutionWebhookEvent.findUniqueOrThrow({ where: { id: event.id } }); }
    expect(event.status).toBe('PROCESSED');
    expect(await db.evolutionWebhookEvent.count({ where: { tenantId: tenantAId, connectionId: connection.body.id, providerMessageId: `evolution-return-reply-${suffix}` } })).toBe(1);
    expect(await db.message.count({ where: { tenantId: tenantAId, provider: 'EVOLUTION_BAILEYS', providerMessageId: `evolution-return-reply-${suffix}` } })).toBe(1);
    expect(await db.automationExecution.findUniqueOrThrow({ where: { id: execution.id } })).toMatchObject({ status: 'RESPONDED', responseAction: 'INTERESTED' });
    expect(await db.task.count({ where: { tenantId: tenantAId, patientId: patient.id, procedureId: procedure.id, appointmentId: appointment.id } })).toBe(1);
  }, 30_000);

  it('serializes concurrent procedure-return executions against the patient/procedure contact limit', async () => {
    const previousMode = process.env.OUTBOX_DISPATCH_MODE;
    process.env.OUTBOX_DISPATCH_MODE = 'dry-run';
    try {
      await db.plan.update({ where: { id: testPlanId }, data: { messageLimitPerCycle: 100 } });
      const phone = `55${(Date.now() + 1).toString().slice(-10)}`;
      const patient = await db.patient.create({ data: { tenantId: tenantAId, unitId: unitA1Id, fullName: `Concurrent return ${suffix}`, phone, phoneNormalized: phone } });
      await db.consentPreference.create({ data: { tenantId: tenantAId, patientId: patient.id, channel: 'WHATSAPP', purpose: 'PROCEDURE_RETURN', status: 'GRANTED', source: 'MANUAL', evidence: 'Fixture fictícia E2E', evidenceType: 'WRITTEN_FORM', evidenceReference: `concurrent-return-consent-${suffix}` } });
      const procedure = await db.procedure.create({ data: { tenantId: tenantAId, unitId: unitA1Id, name: `Concurrent procedure ${suffix}`, appointmentDurationMinutes: 30, returnAfterDays: 10, reminderAdvanceDays: 2 } });
      const connection = await db.metaConnection.create({ data: { tenantId: tenantAId, unitId: unitA1Id, wabaId: `concurrent-waba-${suffix}`, phoneNumberId: `concurrent-phone-${suffix}`, accessTokenEncrypted: 'test-only-encrypted-placeholder', status: 'CONNECTED', enabled: true } });
      const rule = await db.automation.create({ data: { tenantId: tenantAId, name: `Concurrent return ${suffix}`, trigger: 'PROCEDURE_RETURN', status: 'ACTIVE', createdById: adminUserId, configuration: { unitId: unitA1Id, procedureId: procedure.id, advanceMinutes: 0, allowedStartHour: 0, allowedEndHour: 24, allowedDaysOfWeek: [0,1,2,3,4,5,6], provider: 'META_CLOUD', connectionId: connection.id, body: 'Conteúdo apenas local', responseWindowHours: 72, maxContactsPerPatient: 1, interestKeywords: ['INTERESSE'], rescheduleKeywords: ['AGENDAR'], noContactKeywords: ['NAO'], noResponseAction: 'NONE', responsibleUserId: adminUserId } } });
      const service = app.get(AutomationsService) as unknown as { execute(id: string): Promise<void> };
      const executions = [] as Array<{ id: string }>;
      for (let index = 0; index < 2; index++) {
        const completedAt = new Date(Date.now() - (41 + index) * 86400000);
        const startsAt = new Date(completedAt.getTime() - 30 * 60_000);
        const appointment = await db.appointment.create({ data: { tenantId: tenantAId, unitId: unitA1Id, patientId: patient.id, procedureId: procedure.id, startsAt, endsAt: completedAt, status: 'COMPLETED', source: 'NATIVE', completedAt } });
        executions.push(await db.automationExecution.create({ data: { tenantId: tenantAId, unitId: unitA1Id, automationId: rule.id, appointmentId: appointment.id, patientId: patient.id, idempotencyKey: `procedure-return:${rule.id}:${appointment.id}:${startsAt.toISOString()}`, scheduledAt: new Date(completedAt.getTime() + 8 * 86400000) } }));
      }
      await Promise.all(executions.map(({ id }) => service.execute(id)));
      const rows = await db.automationExecution.findMany({ where: { tenantId: tenantAId, id: { in: executions.map(({ id }) => id) } }, orderBy: { id: 'asc' } });
      expect(rows.filter((row) => row.status === 'OUTBOXED')).toHaveLength(1);
      expect(rows.filter((row) => row.status === 'SUPPRESSED')).toHaveLength(1);
      expect(await db.outboxMessage.count({ where: { tenantId: tenantAId, patientId: patient.id, purpose: 'PROCEDURE_RETURN', connectionId: connection.id } })).toBe(1);
    } finally {
      if (previousMode === undefined) delete process.env.OUTBOX_DISPATCH_MODE; else process.env.OUTBOX_DISPATCH_MODE = previousMode;
    }
  }, 30_000);

  afterAll(async () => {
    if (app) await app.close();
    if (previousRedisUrl === undefined) delete process.env.REDIS_URL; else process.env.REDIS_URL = previousRedisUrl;
    await db.$executeRawUnsafe('ALTER TABLE "ConsentEvent" DISABLE TRIGGER "ConsentEvent_immutable_delete"');
    await db.$executeRawUnsafe('ALTER TABLE "SatisfactionSurveyEvent" DISABLE TRIGGER "SatisfactionSurveyEvent_immutable_delete"');
    try {
      if (tenantAId) await db.referralRewardSource.deleteMany({ where: { tenantId: tenantAId } });
      if (tenantAId) await db.tenant.deleteMany({ where: { id: tenantAId } });
      if (tenantBId) await db.tenant.deleteMany({ where: { id: tenantBId } });
      if (testPlanId) await db.plan.deleteMany({ where: { id: testPlanId } });
      if (userAId) await db.user.deleteMany({ where: { id: userAId } });
      if (adminUserId) await db.user.deleteMany({ where: { id: adminUserId } });
    } finally {
      await db.$executeRawUnsafe('ALTER TABLE "ConsentEvent" ENABLE TRIGGER "ConsentEvent_immutable_delete"');
      await db.$executeRawUnsafe('ALTER TABLE "SatisfactionSurveyEvent" ENABLE TRIGGER "SatisfactionSurveyEvent_immutable_delete"');
    }
    await db.$disconnect();
  }, 30_000);
});
