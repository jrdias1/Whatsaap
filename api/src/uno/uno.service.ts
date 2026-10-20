import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContext } from '../security/tenant-context.js';
import { decryptSecret, encryptSecret } from '../security/secret-crypto.js';

@Injectable()
export class UnoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly context: TenantContext,
  ) {}
  private scope() {
    const s = this.context.current();
    if (!s || s.role !== 'TENANT_ADMIN')
      throw new ForbiddenException('Apenas administrador do tenant.');
    return s;
  }
  async status(unitId: string) {
    const s = this.context.current();
    if (!s) throw new ForbiddenException('Tenant obrigatório.');
    if (!['TENANT_ADMIN', 'PLATFORM_SUPERADMIN'].includes(s.role)) {
      const access = await this.prisma.scoped.unitMembership.findFirst({
        where: { membershipId: s.membershipId, unitId },
      });
      if (!access) throw new ForbiddenException('Unidade fora do escopo.');
    }
    const row = await this.prisma.scoped.unoConnection.findFirst({
      where: { tenantId: s.tenantId, unitId },
      select: {
        status: true,
        sourceOfTruth: true,
        lastCheckedAt: true,
        lastEventAt: true,
      },
    });
    return {
      activeSource: row?.sourceOfTruth === 'UNO' ? 'UNO' : 'NATIVE',
      unoStatus: row?.status ?? 'DISCONNECTED',
      unoLastCheckedAt: row?.lastCheckedAt ?? null,
      unoLastEventAt: row?.lastEventAt ?? null,
      synchronized: false,
    };
  }
  async get(unitId: string) {
    const s = this.scope();
    const row = await this.prisma.scoped.unoConnection.findFirst({
      where: { tenantId: s.tenantId, unitId },
    });
    if (!row)
      return { connected: false, sourceOfTruth: 'NATIVE', writeEnabled: false };
    return {
      status: row.status,
      unitId,
      credentialsConfigured: !!row.accessTokenEncrypted,
      selectedCategories: row.selectedCategories,
      selectedFields: row.selectedFields,
      sourceOfTruth: row.sourceOfTruth,
      writeEnabled: row.writeEnabled,
      lastCheckedAt: row.lastCheckedAt,
      lastEventAt: row.lastEventAt,
      lastError: row.lastError,
    };
  }
  async configure(unitId: string, input: Record<string, unknown>) {
    const s = this.scope();
    if (
      !(await this.prisma.scoped.unit.findFirst({
        where: { id: unitId, active: true },
      }))
    )
      throw new NotFoundException('Unidade não encontrada.');
    const categories = this.strings(input.selectedCategories, [
      'APPOINTMENT_CREATED',
      'APPOINTMENT_UPDATED',
      'APPOINTMENT_REMOVED',
      'ORDER_CREATED',
      'ORDER_UPDATED',
      'AVAILABILITY',
      'LEAD',
    ]);
    const fieldAllowlist = [
      'id',
      'startDate',
      'endDate',
      'status',
      'serviceSession',
      'customer',
      'employee',
      'room',
      'service',
      'totalPrice',
      'totalDiscount',
      'totalPaid',
      'items',
    ];
    const fields = this.strings(input.selectedFields, fieldAllowlist);
    if (input.sourceOfTruth === 'UNO' || input.writeEnabled === true)
      throw new BadRequestException(
        'A fonte Uno e a escrita só podem ser habilitadas após a homologação integral de disponibilidade, escrita e webhook.',
      );
    const current = await this.prisma.scoped.unoConnection.findFirst({
      where: { tenantId: s.tenantId, unitId },
    });
    const accessToken =
      typeof input.accessToken === 'string' && input.accessToken.trim()
        ? encryptSecret(input.accessToken.trim())
        : current?.accessTokenEncrypted;
    const secretKey =
      typeof input.secretKey === 'string' && input.secretKey.trim()
        ? encryptSecret(input.secretKey.trim())
        : current?.secretKeyEncrypted;
    const credentialsChanged = Boolean(
      (typeof input.accessToken === 'string' && input.accessToken.trim()) ||
      (typeof input.secretKey === 'string' && input.secretKey.trim()),
    );
    if (!current && (!accessToken || !secretKey))
      throw new BadRequestException(
        'Credenciais Uno por unidade são obrigatórias para configurar.',
      );
    const rawWebhookToken =
      (typeof input.rotateWebhookToken === 'boolean' &&
        input.rotateWebhookToken) ||
      !current
        ? randomBytes(32).toString('base64url')
        : undefined;
    const row = await this.prisma.scoped.unoConnection.upsert({
      where: { tenantId_unitId: { tenantId: s.tenantId, unitId } },
      create: {
        tenantId: s.tenantId,
        unitId,
        webhookTokenHash: createHash('sha256')
          .update(rawWebhookToken!)
          .digest('hex'),
        accessTokenEncrypted: accessToken,
        secretKeyEncrypted: secretKey,
        selectedCategories: categories,
        selectedFields: fields,
        sourceOfTruth: 'NATIVE',
        writeEnabled: false,
        ...(credentialsChanged
          ? {
              status: 'DISCONNECTED' as const,
              lastCheckedAt: null,
              lastError: null,
            }
          : {}),
      },
      update: {
        ...(rawWebhookToken
          ? {
              webhookTokenHash: createHash('sha256')
                .update(rawWebhookToken)
                .digest('hex'),
            }
          : {}),
        accessTokenEncrypted: accessToken,
        secretKeyEncrypted: secretKey,
        selectedCategories: categories,
        selectedFields: fields,
        sourceOfTruth: 'NATIVE',
        writeEnabled: false,
        ...(credentialsChanged
          ? {
              status: 'DISCONNECTED' as const,
              lastCheckedAt: null,
              lastError: null,
            }
          : {}),
      },
    });
    await this.prisma.scoped.auditEvent.create({
      data: {
        actorUserId: s.userId,
        action: 'UNO_CONFIGURATION_UPDATED',
        entityType: 'UnoConnection',
        entityId: row.id,
        metadata: {
          unitId,
          categories,
          fields,
          sourceOfTruth: row.sourceOfTruth,
          writeEnabled: row.writeEnabled,
        },
      },
    });
    const publicApiUrl = process.env.API_PUBLIC_URL?.replace(/\/$/, '');
    return {
      ...(await this.get(unitId)),
      webhookSetupRequired: true,
      ...(rawWebhookToken
        ? {
            webhookToken: rawWebhookToken,
            webhookTokenShownOnce: true,
            webhookUrl: publicApiUrl
              ? `${publicApiUrl}/api/integrations/uno/webhook/${row.id}`
              : null,
          }
        : {}),
    };
  }
  async test(unitId: string) {
    const s = this.scope();
    const row = await this.prisma.scoped.unoConnection.findFirst({
      where: { tenantId: s.tenantId, unitId },
    });
    if (!row?.accessTokenEncrypted || !row.secretKeyEncrypted)
      throw new BadRequestException('Configure credenciais primeiro.');
    const checked = new Date();
    try {
      const url = new URL('https://api.unobject.com.br/v1/scheduler/hours');
      const tenant = await this.prisma.scoped.tenant.findFirst({
        where: { id: s.tenantId },
        select: { timezone: true },
      });
      const date = new Intl.DateTimeFormat('en-GB', {
        timeZone: tenant?.timezone ?? 'America/Sao_Paulo',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      }).format(checked);
      url.searchParams.set('date', date);
      const response = await fetch(url, {
        headers: {
          'x-uno-access-token': decryptSecret(row.accessTokenEncrypted),
          'x-uno-secret-key': decryptSecret(row.secretKeyEncrypted),
        },
        signal: AbortSignal.timeout(5000),
      });
      await this.prisma.scoped.unoConnection.update({
        where: { id: row.id },
        data: {
          status: response.ok ? 'CONNECTED' : 'ERROR',
          lastCheckedAt: checked,
          lastError: response.ok
            ? null
            : `Uno retornou HTTP ${response.status}`,
        },
      });
      if (!response.ok)
        return {
          connected: false,
          statusCode: response.status,
          sourceOfTruth: 'NATIVE',
        };
      return {
        connected: true,
        testedAt: checked,
        sourceOfTruth: 'NATIVE',
        note: 'A validação de credencial não ativa sincronização nem altera a agenda autoritativa.',
      };
    } catch {
      await this.prisma.scoped.unoConnection.update({
        where: { id: row.id },
        data: {
          status: 'ERROR',
          lastCheckedAt: checked,
          lastError: 'Falha ao alcançar/validar Uno',
        },
      });
      return {
        connected: false,
        sourceOfTruth: 'NATIVE',
        error:
          'Falha de conexão. Verifique as credenciais e a disponibilidade do serviço.',
      };
    }
  }
  async webhook(
    connectionId: string,
    headerToken: string | undefined,
    body: Record<string, unknown>,
  ) {
    if (!headerToken) throw new UnauthorizedException();
    const connection = await this.prisma.unscoped.unoConnection.findUnique({
      where: { id: connectionId },
    });
    if (!connection) throw new UnauthorizedException();
    const tokenHash = createHash('sha256').update(headerToken).digest();
    const expectedHash = Buffer.from(connection.webhookTokenHash, 'hex');
    if (
      tokenHash.length !== expectedHash.length ||
      !timingSafeEqual(tokenHash, expectedHash)
    )
      throw new UnauthorizedException();
    const type =
      typeof body.event === 'string'
        ? body.event
        : typeof body.type === 'string'
          ? body.type
          : '';
    if (
      ![
        'APPOINTMENT_CREATED',
        'APPOINTMENT_UPDATED',
        'APPOINTMENT_REMOVED',
        'ORDER_CREATED',
        'ORDER_UPDATED',
      ].includes(type)
    )
      throw new BadRequestException('Evento Uno não reconhecido.');
    const entityName = type.startsWith('APPOINTMENT_')
      ? 'appointment'
      : 'order';
    const entity =
      body[entityName] && typeof body[entityName] === 'object'
        ? (body[entityName] as Record<string, unknown>)
        : {};
    const allowed = new Set(connection.selectedFields);
    const payload: Record<string, unknown> = {
      schema:
        typeof body.schema === 'string' ? body.schema.slice(0, 100) : null,
    };
    for (const [key, value] of Object.entries(entity))
      if (allowed.has(key)) payload[key] = value;
    const externalId =
      typeof entity.id === 'number' || typeof entity.id === 'string'
        ? String(entity.id)
        : null;
    const eventKey = externalId
      ? `${type}:${externalId}:${createHash('sha256').update(JSON.stringify(payload)).digest('hex')}`
      : createHmac('sha256', tokenHash)
          .update(JSON.stringify(body))
          .digest('hex');
    if (!connection.selectedCategories.includes(type))
      return { accepted: true, ignored: true, reason: 'category_disabled' };
    try {
      await this.prisma.unscoped.unoEvent.create({
        data: {
          tenantId: connection.tenantId,
          connectionId: connection.id,
          eventKey,
          eventType: type,
          externalId,
          payload: payload as Prisma.InputJsonObject,
        },
      });
    } catch (error: any) {
      if (error?.code !== 'P2002') throw error;
    }
    await this.prisma.unscoped.unoConnection.update({
      where: { id: connection.id },
      data: { lastEventAt: new Date() },
    });
    return { accepted: true };
  }
  private strings(value: unknown, allow: string[]) {
    if (!Array.isArray(value)) return [];
    const out = [
      ...new Set(value.filter((x): x is string => typeof x === 'string')),
    ];
    if (out.some((x) => !allow.includes(x)))
      throw new BadRequestException('Categoria/campo Uno inválido.');
    return out;
  }
}
