import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { SignJWT } from 'jose';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { TenantContextInterceptor } from '../src/security/tenant-context.interceptor.js';
import { InvitationMailerService } from '../src/users/invitation-mailer.service.js';
import { UsageService } from '../src/usage/usage.service.js';
import { StageCampaignService } from '../src/inbox/stage-campaign.service.js';

describe('Tenant isolation (e2e)', () => {
  let app: INestApplication;
  const mailerMock = { send: vi.fn().mockResolvedValue(undefined) };
  const secret = new TextEncoder().encode('e2e-only-secret-with-at-least-32-characters');
  const tenantA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET = 'e2e-only-secret-with-at-least-32-characters';
    const prismaMock = {
      unscoped: {
        user: { findUnique: vi.fn().mockResolvedValue(null) },
        $transaction: vi.fn(async (callback: (tx: any) => unknown) => callback({
          patient: { count: vi.fn().mockResolvedValue(0), findMany: vi.fn().mockResolvedValue([]) },
          userInvitation: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: 'invitation-a', email: 'new.operator@example.test', expiresAt: new Date('2030-01-01T00:00:00Z') }) },
          auditEvent: { create: vi.fn().mockResolvedValue({}) },
        })),
        userInvitation: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
        authSession: {
          findFirst: vi.fn(({ where }: { where: { tenantId: string } }) => where.tenantId === tenantA
            ? { id: 'session-a', revokedAt: null, expiresAt: new Date(Date.now() + 60_000), tenant: { status: 'TRIAL' }, membership: { role: 'TENANT_ADMIN', status: 'ACTIVE', tenantId: tenantA, userId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' }, user: { active: true, mustChangePassword: false, platformAdminIdentity: null } }
            : null),
        },
      },
      get scoped() {
        return {
          user: { findFirst: vi.fn().mockResolvedValue({ id: 'user-a', email: 'a@example.test' }) },
          patient: { findMany: vi.fn().mockResolvedValue([]) },
          unit: { findMany: vi.fn().mockResolvedValue([{ id: 'ffffffff-ffff-4fff-8fff-ffffffffffff' }]) },
          userInvitation: {
            findFirst: vi.fn().mockResolvedValue(null),
            create: vi.fn().mockResolvedValue({ id: 'invitation-a', email: 'new.operator@example.test', expiresAt: new Date('2030-01-01T00:00:00Z') }),
          },
          membership: { findUnique: vi.fn().mockResolvedValue(null) },
          auditEvent: { create: vi.fn().mockResolvedValue({}) },
          tenant: { findFirst: vi.fn().mockResolvedValue({ name: 'Clínica E2E' }) },
        };
      },
      $connect: vi.fn(),
      $disconnect: vi.fn(),
    };

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService).useValue(prismaMock)
      .overrideProvider(InvitationMailerService).useValue(mailerMock)
      .overrideProvider(UsageService).useValue({ assertCapacity: vi.fn().mockResolvedValue(undefined), assertCapacityWithinTransaction: vi.fn().mockResolvedValue(undefined), consume: vi.fn(), consumeWithinTransaction: vi.fn() })
      .overrideProvider(StageCampaignService).useValue({ onModuleInit: vi.fn() })
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(app.get(TenantContextInterceptor));
    app.setGlobalPrefix('api');
    await app.init();
  });

  async function token(tenantId: string) {
    return new SignJWT({ tenantId, membershipId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', sessionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', role: 'TENANT_ADMIN' })
      .setProtectedHeader({ alg: 'HS256' }).setSubject('dddddddd-dddd-4ddd-8ddd-dddddddddddd').setIssuer('clinic-api').setAudience('clinic-web')
      .setIssuedAt().setExpirationTime('5m').sign(secret);
  }

  it('rejeita sessão válida para outro tenant, mesmo com token assinado', async () => {
    const crossTenantToken = await token('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');
    await request(app.getHttpServer()).get('/api/auth/me').set('Authorization', `Bearer ${crossTenantToken}`).expect(401);
  });

  it('rejeita chamadas protegidas sem token', async () => {
    await request(app.getHttpServer()).get('/api/auth/me').expect(401);
  });

  it('identifica access token expirado como falha de autenticação', async () => {
    const expired = await new SignJWT({ tenantId: tenantA, membershipId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', sessionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', role: 'TENANT_ADMIN' })
      .setProtectedHeader({ alg: 'HS256' }).setSubject('dddddddd-dddd-4ddd-8ddd-dddddddddddd').setIssuer('clinic-api').setAudience('clinic-web')
      .setIssuedAt().setExpirationTime(Math.floor(Date.now() / 1000) - 5).sign(secret);
    await request(app.getHttpServer()).get('/api/patients').set('Authorization', `Bearer ${expired}`).expect(401).expect(({ body }) => expect(body.code).toBe('ACCESS_TOKEN_INVALID'));
  });

  it('protege a listagem de pacientes e rejeita tenant sem sessão correspondente', async () => {
    await request(app.getHttpServer()).get('/api/patients').set('Authorization', `Bearer ${await token(tenantA)}`).expect(200).expect({ items: [], total: 0, page: 1, pageSize: 25, totalPages: 0 });
    await request(app.getHttpServer()).get('/api/patients').set('Authorization', `Bearer ${await token('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee')}`).expect(401);
  });

  it('does not issue new invitations or send email; direct user creation replaces this flow', async () => {
    mailerMock.send.mockClear();
    await request(app.getHttpServer()).post('/api/users/invitations')
      .set('Authorization', `Bearer ${await token(tenantA)}`)
      .send({ email: 'new.operator@example.test', displayName: 'Nova Operadora', role: 'OPERATOR', unitIds: ['ffffffff-ffff-4fff-8fff-ffffffffffff'] })
      .expect(404);
    expect(mailerMock.send).not.toHaveBeenCalled();
  });

  it('keeps the legacy endpoint unavailable without attempting to send email', async () => {
    mailerMock.send.mockRejectedValueOnce(new Error('SMTP unavailable'));
    await request(app.getHttpServer()).post('/api/users/invitations')
      .set('Authorization', `Bearer ${await token(tenantA)}`)
      .send({ email: 'other.operator@example.test', displayName: 'Outra Operadora', role: 'OPERATOR', unitIds: ['ffffffff-ffff-4fff-8fff-ffffffffffff'] })
      .expect(404);
    expect(mailerMock.send).not.toHaveBeenCalled();
  });

  afterAll(async () => app.close());
});

