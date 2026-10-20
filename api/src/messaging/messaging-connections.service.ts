import { BadGatewayException, BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContext } from '../security/tenant-context.js';
import { encryptSecret } from '../security/secret-crypto.js';
import { MessagingProviderRegistry } from './messaging-provider.js';
import { UsageService } from '../usage/usage.service.js';
import { decryptSecret } from '../security/secret-crypto.js';
import { EvolutionInspectionClient, evolutionV237ReferenceContract } from './evolution-inspection.client.js';

@Injectable()
export class MessagingConnectionsService {
  private readonly providers = new MessagingProviderRegistry();
  private readonly evolutionInspection = new EvolutionInspectionClient();
  constructor(private readonly prisma: PrismaService, private readonly context: TenantContext, private readonly usage: UsageService) {}

  private scope() {
    const scope = this.context.current();
    if (!scope || scope.role !== 'TENANT_ADMIN') throw new ForbiddenException('Apenas administrador do tenant pode gerenciar conexões.');
    return scope;
  }

  async list(unitId?: string) {
    const scope = this.scope();
    if (unitId) await this.assertUnit(scope.tenantId, unitId);
    const where = { tenantId: scope.tenantId, ...(unitId ? { unitId } : {}) };
    const [meta, evolution] = await Promise.all([
      this.prisma.scoped.metaConnection.findMany({ where, select: { id: true, unitId: true, displayName: true, wabaId: true, phoneNumberId: true, graphApiVersion: true, status: true, enabled: true, updatedAt: true } }),
      this.prisma.scoped.evolutionConnection.findMany({ where, select: { id: true, unitId: true, displayName: true, apiBaseUrl: true, instanceName: true, mode: true, apiVersion: true, phoneNumber: true, status: true, enabled: true, isDefault: true, lastCheckedAt: true, lastError: true, updatedAt: true } }),
    ]);
    return [
      ...meta.map((row) => ({ ...row, provider: 'META_CLOUD', credentialsConfigured: true, webhookUrl: this.metaWebhookUrl(), homologation: 'PENDING_EXTERNAL_CREDENTIALS' })),
      ...evolution.map((row) => ({ ...row, provider: row.mode, credentialsConfigured: true, webhookUrl: this.evolutionWebhookUrl(row.id), homologation: 'PENDING_VERSION_CONFIRMATION', warning: row.mode === 'EVOLUTION_BAILEYS' ? 'WhatsApp Web/Baileys não é integração oficial da Meta e tem risco adicional de desconexão e restrição.' : null })),
    ];
  }

  async whatsappContacts(unitId: string) {
    const scope = this.context.current();
    if (!scope || !['TENANT_ADMIN', 'UNIT_MANAGER', 'OPERATOR'].includes(scope.role)) {
      throw new ForbiddenException('Seu perfil não pode importar contatos do WhatsApp.');
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(unitId)) {
      throw new BadRequestException('Selecione uma unidade válida para consultar os contatos.');
    }
    const unit = await this.prisma.scoped.unit.findFirst({ where: { id: unitId, active: true }, select: { id: true } });
    if (!unit) throw new NotFoundException('Unidade não encontrada.');
    if (scope.role !== 'TENANT_ADMIN') {
      const membership = await this.prisma.scoped.unitMembership.findFirst({
        where: { membershipId: scope.membershipId, unitId }, select: { unitId: true },
      });
      if (!membership) throw new ForbiddenException('Unidade fora do escopo do usuário.');
    }

    const connection = await this.prisma.scoped.evolutionConnection.findFirst({
      where: { unitId, mode: 'EVOLUTION_BAILEYS', enabled: true, isDefault: true },
      select: { id: true, apiBaseUrl: true, instanceName: true, apiVersion: true, apiKeyEncrypted: true },
    });
    if (!connection) throw new NotFoundException('Não há uma conexão Evolution ativa e padrão nesta unidade. A agenda de contatos não está disponível na Meta Cloud.');
    if (connection.apiVersion.trim().replace(/^v/i, '') !== evolutionV237ReferenceContract.version.replace(/-reference-only$/, '')) {
      throw new BadRequestException('A versão da Evolution não foi confirmada como 2.3.7; a consulta de contatos permanece indisponível.');
    }

    let raw: unknown;
    try {
      raw = await this.evolutionInspection.contacts({
        baseUrl: connection.apiBaseUrl,
        instanceName: connection.instanceName,
        apiKey: decryptSecret(connection.apiKeyEncrypted),
        contract: evolutionV237ReferenceContract,
      });
    } catch {
      throw new BadGatewayException('Não foi possível consultar os contatos do WhatsApp. Verifique a conexão e tente novamente.');
    }
    const root = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
    const list = Array.isArray(raw) ? raw : Array.isArray(root.contacts) ? root.contacts : Array.isArray(root.data) ? root.data : [];
    const contacts = new Map<string, { name: string; phone: string }>();
    for (const item of list.slice(0, 5000)) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const record = item as Record<string, unknown>;
      const id = record.id && typeof record.id === 'object' ? record.id as Record<string, unknown> : {};
      const jid = String(id.remoteJid ?? record.remoteJid ?? record.jid ?? '');
      if (!jid || jid.endsWith('@g.us') || jid.endsWith('@broadcast') || jid.endsWith('@lid')) continue;
      const rawPhone = jid.includes('@') ? jid.slice(0, jid.indexOf('@')) : jid;
      const phone = rawPhone.replace(/\D/g, '');
      if (phone.length < 10 || phone.length > 15 || contacts.has(phone)) continue;
      const candidateName = record.pushName ?? record.verifiedName ?? record.name;
      const name = typeof candidateName === 'string' && candidateName.trim() ? candidateName.trim().slice(0, 160) : 'Contato sem nome';
      contacts.set(phone, { name, phone });
    }
    await this.audit(scope.tenantId, scope.userId, 'WHATSAPP_CONTACTS_LISTED', 'EvolutionConnection', connection.id, { unitId, count: contacts.size });
    return { contacts: [...contacts.values()], source: 'EVOLUTION_BAILEYS', unitId, version: evolutionV237ReferenceContract.version, consent: 'UNKNOWN_UNLESS_SEPARATELY_RECORDED' };
  }

  async createMeta(input: Record<string, unknown>) {
    const scope = this.scope();
    const unitId = this.string(input.unitId, 'unitId', 80);
    await this.assertUnit(scope.tenantId, unitId);
    const displayName = this.string(input.displayName, 'displayName', 100);
    const wabaId = this.string(input.wabaId, 'wabaId', 120);
    const phoneNumberId = this.string(input.phoneNumberId, 'phoneNumberId', 120);
    const accessToken = this.string(input.accessToken, 'accessToken', 5000);
    const graphApiVersion = typeof input.graphApiVersion === 'string' && /^v\d+\.\d+$/.test(input.graphApiVersion) ? input.graphApiVersion : 'UNCONFIRMED';
    const isDefault = input.isDefault === true || !(await this.prisma.scoped.metaConnection.count({ where: { tenantId: scope.tenantId, unitId, isDefault: true, enabled: true } }));
    if (isDefault) await this.prisma.scoped.metaConnection.updateMany({ where: { tenantId: scope.tenantId, unitId }, data: { isDefault: false } });
    const row = await this.prisma.unscoped.$transaction(async (tx) => {
      await this.usage.assertCapacityWithinTransaction(tx, 'connections');
      return tx.metaConnection.create({ data: { tenantId: scope.tenantId, unitId, displayName, wabaId, phoneNumberId, graphApiVersion, accessTokenEncrypted: encryptSecret(accessToken), status: 'DISCONNECTED', isDefault } });
    });
    await this.audit(scope.tenantId, scope.userId, 'MESSAGING_CONNECTION_CREATED', 'MetaConnection', row.id, { provider: 'META_CLOUD', unitId, wabaId, phoneNumberId, graphApiVersion });
    return { id: row.id, provider: 'META_CLOUD', displayName, unitId, wabaId, phoneNumberId, graphApiVersion, status: row.status, credentialsConfigured: true, webhookUrl: this.metaWebhookUrl(), sendsEnabled: false };
  }

  async createEvolution(input: Record<string, unknown>) {
    const scope = this.scope();
    const unitId = this.string(input.unitId, 'unitId', 80);
    await this.assertUnit(scope.tenantId, unitId);
    const displayName = this.string(input.displayName, 'displayName', 100);
    const instanceName = this.string(input.instanceName, 'instanceName', 120);
    const apiBaseUrl = this.baseUrl(input.apiBaseUrl);
    const apiKey = this.string(input.apiKey, 'apiKey', 5000);
    const mode = input.mode === 'EVOLUTION_CLOUD' ? 'EVOLUTION_CLOUD' : 'EVOLUTION_BAILEYS';
    if (mode === 'EVOLUTION_CLOUD') throw new BadRequestException('EVOLUTION_CLOUD ficará disponível quando a versão instalada e o contrato Cloud forem confirmados.');
    const rawWebhookSecret = randomBytes(32).toString('base64url');
    const apiVersion = typeof input.apiVersion === 'string' ? input.apiVersion.trim().slice(0, 80) : '';
    const phoneNumber = typeof input.phoneNumber === 'string' ? input.phoneNumber.replace(/\D/g, '').slice(0, 20) || null : null;
    const isDefault = input.isDefault === true || !(await this.prisma.scoped.evolutionConnection.count({ where: { tenantId: scope.tenantId, unitId, mode: 'EVOLUTION_BAILEYS', isDefault: true, enabled: true } }));
    if (isDefault) await this.prisma.scoped.evolutionConnection.updateMany({ where: { tenantId: scope.tenantId, unitId, mode: 'EVOLUTION_BAILEYS' }, data: { isDefault: false } });
    const row = await this.prisma.unscoped.$transaction(async (tx) => {
      await this.usage.assertCapacityWithinTransaction(tx, 'connections');
      return tx.evolutionConnection.create({ data: { tenantId: scope.tenantId, unitId, displayName, instanceName, apiBaseUrl, mode, apiVersion: apiVersion || 'UNCONFIRMED', phoneNumber, apiKeyEncrypted: encryptSecret(apiKey), webhookSecretHash: createHash('sha256').update(rawWebhookSecret).digest('hex'), status: 'DISCONNECTED', isDefault } });
    });
    await this.audit(scope.tenantId, scope.userId, 'MESSAGING_CONNECTION_CREATED', 'EvolutionConnection', row.id, { provider: mode, unitId, instanceName, apiBaseUrl, apiVersion: row.apiVersion });
    return { id: row.id, provider: mode, unitId, displayName, apiBaseUrl, instanceName, apiVersion: row.apiVersion, phoneNumber, status: row.status, credentialsConfigured: true, webhookUrl: this.evolutionWebhookUrl(row.id), webhookSecret: rawWebhookSecret, webhookSecretShownOnce: true, sendsEnabled: false, warning: 'Baileys/WhatsApp Web não é canal oficial Meta.' };
  }

  async dryRun(id: string) {
    const scope = this.scope();
    const meta = await this.prisma.scoped.metaConnection.findFirst({ where: { tenantId: scope.tenantId, id }, select: { id: true, unitId: true } });
    const evolution = meta ? null : await this.prisma.scoped.evolutionConnection.findFirst({ where: { tenantId: scope.tenantId, id }, select: { id: true, unitId: true, mode: true } });
    const provider = meta ? 'META_CLOUD' : evolution?.mode;
    if (!provider || !this.providers.get(provider)) throw new NotFoundException('Conexão não encontrada ou provider futuro sem suporte.');
    const adapter = this.providers.get(provider)!;
    const simulated = adapter.simulateSend({ connectionId: id, destination: '5511000000000', body: 'Mensagem sintética de validação; nenhum destinatário real.', idempotencyKey: `connection-test:${id}`, purpose: 'APPOINTMENT_REMINDER' });
    return { id, unitId: meta?.unitId ?? evolution?.unitId, provider, official: adapter.official, capabilities: adapter.capabilities(), mode: 'dry-run', simulated, sendsEnabled: false, externalRequestMade: false };
  }

  async disconnectLocally(id: string) {
    const scope = this.scope();
    const meta = await this.prisma.scoped.metaConnection.updateMany({ where: { tenantId: scope.tenantId, id }, data: { status: 'DISCONNECTED', enabled: false } });
    if (meta.count) { await this.audit(scope.tenantId, scope.userId, 'MESSAGING_CONNECTION_DISABLED_LOCALLY', 'MetaConnection', id, {}); return { id, status: 'DISCONNECTED', remoteAction: false }; }
    const evo = await this.prisma.scoped.evolutionConnection.updateMany({ where: { tenantId: scope.tenantId, id }, data: { status: 'DISCONNECTED', enabled: false, lastError: 'Desativada localmente; nenhuma chamada remota foi feita.' } });
    if (!evo.count) throw new NotFoundException('Conexão não encontrada.');
    await this.audit(scope.tenantId, scope.userId, 'MESSAGING_CONNECTION_DISABLED_LOCALLY', 'EvolutionConnection', id, {});
    return { id, status: 'DISCONNECTED', remoteAction: false };
  }

  private async assertUnit(tenantId: string, unitId: string) {
    if (!(await this.prisma.scoped.unit.findFirst({ where: { tenantId, id: unitId, active: true }, select: { id: true } }))) throw new NotFoundException('Unidade não encontrada no tenant.');
  }
  private string(value: unknown, name: string, max: number) {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new BadRequestException(`${name} é obrigatório e deve ter até ${max} caracteres.`);
    return value.trim();
  }
  private baseUrl(value: unknown) {
    const raw = this.string(value, 'apiBaseUrl', 500);
    let parsed: URL;
    try { parsed = new URL(raw); } catch { throw new BadRequestException('URL da Evolution inválida.'); }
    const local = ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);
    if (!['https:', 'http:'].includes(parsed.protocol) || (parsed.protocol !== 'https:' && (process.env.NODE_ENV === 'production' || !local)) || parsed.username || parsed.password || parsed.search || parsed.hash) throw new BadRequestException('Use URL HTTPS sem credenciais, query ou fragmento; HTTP só é permitido para loopback em ambiente local.');
    return parsed.toString().replace(/\/$/, '');
  }
  private async audit(tenantId: string, actorUserId: string, action: string, entityType: string, entityId: string, metadata: Record<string, unknown>) {
    await this.prisma.scoped.auditEvent.create({ data: { tenantId, actorUserId, action, entityType, entityId, metadata: metadata as object } });
  }
  private metaWebhookUrl() { const base = process.env.API_PUBLIC_URL?.replace(/\/$/, ''); return base ? `${base}/api/meta/webhook` : null; }
  private evolutionWebhookUrl(id: string) { const base = process.env.API_PUBLIC_URL?.replace(/\/$/, ''); return base ? `${base}/api/evolution/webhook/${id}` : null; }
}
