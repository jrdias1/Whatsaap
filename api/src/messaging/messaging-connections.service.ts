import { BadGatewayException, BadRequestException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { createHash, createHmac, randomUUID } from 'node:crypto';
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

  private connectionActionScope() {
    const scope = this.context.current();
    if (!scope || !['TENANT_ADMIN', 'OPERATOR'].includes(scope.role)) throw new ForbiddenException('Apenas o administrador da cl\u00ednica pode gerenciar canais.');
    return scope;
  }

  async list(unitId?: string) {
    const scope = this.scope();
    if (unitId) await this.assertUnit(scope.tenantId, unitId);
    const where = { tenantId: scope.tenantId, ...(unitId ? { unitId } : {}) };
    const [meta, evolution] = await Promise.all([
      this.prisma.scoped.metaConnection.findMany({ where, select: { id: true, unitId: true, displayName: true, wabaId: true, phoneNumberId: true, graphApiVersion: true, status: true, enabled: true, updatedAt: true } }),
      this.prisma.scoped.evolutionConnection.findMany({ where, select: { id: true, unitId: true, displayName: true, instanceName: true, mode: true, apiVersion: true, phoneNumber: true, status: true, enabled: true, isDefault: true, lastCheckedAt: true, lastError: true, updatedAt: true } }),
    ]);
    return [
      ...meta.map((row) => ({ ...row, provider: 'META_CLOUD', credentialsConfigured: true, webhookUrl: this.metaWebhookUrl(), homologation: 'PENDING_EXTERNAL_CREDENTIALS' })),
      ...evolution.map((row) => ({ ...row, provider: row.mode, credentialsConfigured: true, webhookUrl: this.evolutionWebhookUrl(row.id), homologation: 'PENDING_VERSION_CONFIRMATION', warning: row.mode === 'EVOLUTION_BAILEYS' ? 'WhatsApp Web/Baileys não é integração oficial da Meta e tem risco adicional de desconexão e restrição.' : null })),
    ];
  }

  /** Creates or reuses a clinic branch connection and returns its QR. */
  async connectEvolution(unitIdInput: unknown) {
    const scope = this.connectionActionScope();
    const isOperator = scope.role === 'OPERATOR';
    const unitId = this.string(unitIdInput, 'unitId', 80);
    await this.assertUnit(scope.tenantId, unitId);
    if (isOperator) await this.assertOperatorUnit(scope.membershipId, unitId);

    const unit = await this.prisma.scoped.unit.findFirst({ where: { tenantId: scope.tenantId, id: unitId, active: true }, select: { id: true, name: true } });
    if (!unit) throw new NotFoundException('Filial n\u00e3o encontrada.');
    let connection = await this.prisma.scoped.evolutionConnection.findFirst({ where: { tenantId: scope.tenantId, unitId, mode: 'EVOLUTION_BAILEYS' }, orderBy: { createdAt: 'asc' } });
    if (isOperator && (!connection || !connection.enabled)) throw new ForbiddenException('Esta filial ainda n\u00e3o tem uma conex\u00e3o ativa configurada pelo administrador.');

    const apiBaseUrl = isOperator ? connection!.apiBaseUrl : this.evolutionApiUrl();
    const apiKey = isOperator ? decryptSecret(connection!.apiKeyEncrypted) : this.evolutionApiKey();
    if (isOperator) {
      try {
        const state = await this.evolutionRequest(apiBaseUrl, apiKey, `/instance/connectionState/${encodeURIComponent(connection!.instanceName)}`);
        if (this.isConnected(state)) {
          await this.prisma.scoped.evolutionConnection.update({ where: { id: connection!.id }, data: { status: 'CONNECTED', lastCheckedAt: new Date(), lastError: null } });
          return { id: connection!.id, unitId, status: 'CONNECTED', qr: null, alreadyConnected: true };
        }
      } catch {
        throw new BadGatewayException('N\u00e3o foi poss\u00edvel verificar a conex\u00e3o desta filial. Solicite a verifica\u00e7\u00e3o ao administrador.');
      }
    }

    const tenant = await this.prisma.scoped.tenant.findUnique({ where: { id: scope.tenantId }, select: { name: true } });
    if (!tenant) throw new NotFoundException('Cl\u00ednica n\u00e3o encontrada.');
    if (!connection) {
      connection = await this.prisma.unscoped.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${scope.tenantId}:evolution-unit:${unitId}`}, 0))`;
        const existing = await tx.evolutionConnection.findFirst({ where: { tenantId: scope.tenantId, unitId, mode: 'EVOLUTION_BAILEYS' } });
        if (existing) return existing;
        if (isOperator) throw new ForbiddenException('Esta filial n\u00e3o tem uma conex\u00e3o WhatsApp configurada pelo administrador.');
        await this.usage.assertCapacityWithinTransaction(tx, 'connections', scope.tenantId);
        const instanceName = this.buildInstanceName(tenant.name, unit.name, scope.tenantId, unitId);
        const id = randomUUID();
        const webhookSecret = this.webhookSecret(id);
        return tx.evolutionConnection.create({ data: {
          id, tenantId: scope.tenantId, unitId, displayName: `${tenant.name} - ${unit.name}`,
          apiBaseUrl, instanceName, mode: 'EVOLUTION_BAILEYS', apiVersion: process.env.EVOLUTION_API_VERSION?.trim() || 'UNCONFIRMED',
          apiKeyEncrypted: encryptSecret(apiKey), webhookSecretHash: createHash('sha256').update(webhookSecret).digest('hex'),
          status: 'DISCONNECTED', enabled: true, isDefault: true,
        } });
      });
      await this.audit(scope.tenantId, scope.userId, 'EVOLUTION_CONNECTION_CREATED', 'EvolutionConnection', connection.id, { unitId, provider: 'EVOLUTION_BAILEYS' });
    }

    const webhookSecret = this.webhookSecret(connection.id);
    if (!isOperator) {
      await this.prisma.scoped.evolutionConnection.updateMany({ where: { tenantId: scope.tenantId, unitId, mode: 'EVOLUTION_BAILEYS', id: { not: connection.id } }, data: { isDefault: false } });
    }
    connection = await this.prisma.scoped.evolutionConnection.update({ where: { id: connection.id }, data: {
      ...(!isOperator ? { apiBaseUrl, apiKeyEncrypted: encryptSecret(apiKey) } : {}),
      webhookSecretHash: createHash('sha256').update(webhookSecret).digest('hex'), enabled: true,
      ...(!isOperator ? { isDefault: true } : {}),
    } });

    try {
      await this.ensureEvolutionInstance(apiBaseUrl, connection.instanceName, apiKey);
      const webhookUrl = this.evolutionWebhookUrl(connection.id);
      if (!webhookUrl) throw new Error('API_PUBLIC_URL n\u00e3o configurada.');
      await this.evolutionRequest(apiBaseUrl, apiKey, `/webhook/set/${encodeURIComponent(connection.instanceName)}`, {
        method: 'POST', body: { webhook: { url: webhookUrl, enabled: true, webhookByEvents: false, events: ['MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'CONNECTION_UPDATE'], headers: { 'x-evolution-webhook-secret': webhookSecret } } },
      });
      const state = await this.evolutionRequest(apiBaseUrl, apiKey, `/instance/connectionState/${encodeURIComponent(connection.instanceName)}`);
      if (this.isConnected(state)) {
        await this.prisma.scoped.evolutionConnection.update({ where: { id: connection.id }, data: { status: 'CONNECTED', enabled: true, lastCheckedAt: new Date(), lastError: null } });
        return { id: connection.id, unitId, status: 'CONNECTED', qr: null, alreadyConnected: true };
      }
      const qr = await this.getEvolutionQr(apiBaseUrl, apiKey, connection.instanceName);
      await this.prisma.scoped.evolutionConnection.update({ where: { id: connection.id }, data: { status: 'DISCONNECTED', enabled: true, lastCheckedAt: new Date(), lastError: null } });
      await this.audit(scope.tenantId, scope.userId, 'EVOLUTION_QR_GENERATED', 'EvolutionConnection', connection.id, { unitId });
      return { id: connection.id, unitId, status: 'CONNECTING', qr, alreadyConnected: false };
    } catch (error) {
      await this.prisma.scoped.evolutionConnection.update({ where: { id: connection.id }, data: { status: 'ERROR', lastCheckedAt: new Date(), lastError: error instanceof Error ? error.message.slice(0, 500) : 'Falha ao conectar com a Evolution API.' } }).catch(() => undefined);
      if (error instanceof BadRequestException || error instanceof NotFoundException || error instanceof ForbiddenException) throw error;
      throw new BadGatewayException('N\u00e3o foi poss\u00edvel conectar ao WhatsApp agora. Verifique a Evolution API e tente novamente.');
    }
  }

  /** Gives operators only a yes/no operational status for their assigned branch. */
  async operatorConnectionStatus(unitIdInput: unknown) {
    const scope = this.connectionActionScope();
    const unitId = this.string(unitIdInput, 'unitId', 80);
    await this.assertUnit(scope.tenantId, unitId);
    if (scope.role === 'OPERATOR') await this.assertOperatorUnit(scope.membershipId, unitId);
    const connection = await this.prisma.scoped.evolutionConnection.findFirst({ where: { tenantId: scope.tenantId, unitId, mode: 'EVOLUTION_BAILEYS' }, select: { id: true, enabled: true, apiBaseUrl: true, apiKeyEncrypted: true, instanceName: true } });
    if (!connection) return { unitId, configured: false, status: 'NOT_CONFIGURED', canReconnect: false };
    if (!connection.enabled) return { unitId, configured: true, status: 'DISABLED', canReconnect: false };
    try {
      const state = await this.evolutionRequest(connection.apiBaseUrl, decryptSecret(connection.apiKeyEncrypted), `/instance/connectionState/${encodeURIComponent(connection.instanceName)}`);
      const rawState = this.connectionState(state);
      const status = rawState === 'open' ? 'CONNECTED' : rawState === 'connecting' || rawState === 'qr' ? 'CONNECTING' : 'DISCONNECTED';
      await this.prisma.scoped.evolutionConnection.update({ where: { id: connection.id }, data: { status: status === 'CONNECTED' ? 'CONNECTED' : 'DISCONNECTED', lastCheckedAt: new Date(), lastError: null } });
      return { unitId, configured: true, status, canReconnect: status !== 'CONNECTED' };
    } catch {
      await this.prisma.scoped.evolutionConnection.update({ where: { id: connection.id }, data: { status: 'ERROR', lastCheckedAt: new Date() } }).catch(() => undefined);
      return { unitId, configured: true, status: 'ERROR', canReconnect: true };
    }
  }

  async evolutionStatus(id: string) {
    const scope = this.scope();
    const connection = await this.prisma.scoped.evolutionConnection.findFirst({ where: { tenantId: scope.tenantId, id, mode: 'EVOLUTION_BAILEYS' } });
    if (!connection) throw new NotFoundException('Conexão não encontrada.');
    try {
      const state = await this.evolutionRequest(connection.apiBaseUrl, decryptSecret(connection.apiKeyEncrypted), `/instance/connectionState/${encodeURIComponent(connection.instanceName)}`);
      const rawState = this.connectionState(state);
      const status = rawState === 'open' ? 'CONNECTED' : rawState === 'connecting' || rawState === 'qr' ? 'CONNECTING' : 'DISCONNECTED';
      await this.prisma.scoped.evolutionConnection.update({ where: { id }, data: { status: status === 'CONNECTED' ? 'CONNECTED' : 'DISCONNECTED', enabled: true, lastCheckedAt: new Date(), lastError: null } });
      return { id, unitId: connection.unitId, status };
    } catch {
      throw new BadGatewayException('Não foi possível consultar o estado do WhatsApp.');
    }
  }

  async disconnectEvolution(id: string) {
    const scope = this.scope();
    const connection = await this.prisma.scoped.evolutionConnection.findFirst({ where: { tenantId: scope.tenantId, id, mode: 'EVOLUTION_BAILEYS' } });
    if (!connection) throw new NotFoundException('Conexão não encontrada.');
    try { await this.evolutionRequest(connection.apiBaseUrl, decryptSecret(connection.apiKeyEncrypted), `/instance/logout/${encodeURIComponent(connection.instanceName)}`, { method: 'DELETE' }); }
    catch { throw new BadGatewayException('Não foi possível desconectar o WhatsApp. Tente novamente.'); }
    await this.prisma.scoped.evolutionConnection.update({ where: { id }, data: { status: 'DISCONNECTED', enabled: true, lastCheckedAt: new Date(), lastError: null } });
    await this.audit(scope.tenantId, scope.userId, 'EVOLUTION_CONNECTION_DISCONNECTED', 'EvolutionConnection', id, { unitId: connection.unitId });
    return { id, status: 'DISCONNECTED' };
  }

  private evolutionApiUrl() {
    const raw = process.env.EVOLUTION_API_URL?.trim();
    if (!raw) throw new ServiceUnavailableException('A conexão com WhatsApp ainda não está disponível. A Evolution API não foi configurada no servidor.');
    let url: URL;
    try { url = new URL(raw); } catch { throw new ServiceUnavailableException('A URL da Evolution API no servidor é inválida.'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new ServiceUnavailableException('A URL da Evolution API no servidor é inválida.');
    return url.toString().replace(/\/$/, '');
  }
  private evolutionApiKey() {
    const key = process.env.EVOLUTION_GLOBAL_KEY || process.env.EVOLUTION_API_KEY;
    if (!key?.trim()) throw new ServiceUnavailableException('A conexão com WhatsApp ainda não está disponível. A chave da Evolution API não foi configurada no servidor.');
    return key.trim();
  }
  private webhookSecret(id: string) {
    const key = process.env.INTEGRATION_ENCRYPTION_KEY;
    if (!key || !/^[a-f\d]{64}$/i.test(key)) throw new ServiceUnavailableException('A chave de integrações do servidor não está configurada corretamente.');
    return createHmac('sha256', Buffer.from(key, 'hex')).update(`essencial-evolution-webhook:${id}`).digest('base64url');
  }
  private async ensureEvolutionInstance(base: string, name: string, apiKey: string) {
    const listInstances = async () => this.evolutionRequest(base, apiKey, '/instance/fetchInstances');
    const containsInstance = (response: unknown) => {
      const root = response && typeof response === 'object' ? response as Record<string, any> : {};
      const instances = Array.isArray(response) ? response : Array.isArray(root.data) ? root.data : [];
      return instances.some((instance: any) => instance?.name === name || instance?.instance === name || instance?.instance?.instanceName === name);
    };
    if (containsInstance(await listInstances())) return;
    try {
      await this.evolutionRequest(base, apiKey, '/instance/create', { method: 'POST', body: { instanceName: name, token: apiKey, qrcode: true, integration: 'WHATSAPP-BAILEYS' } });
    } catch (error) {
      // Concurrent requests or an instance created by an earlier interrupted attempt may return conflict.
      if (!(error instanceof BadRequestException)) throw error;
      if (!containsInstance(await listInstances())) throw error;
    }
  }
  private async getEvolutionQr(base: string, apiKey: string, name: string): Promise<string> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await this.evolutionRequest(base, apiKey, `/instance/connect/${encodeURIComponent(name)}`);
      const root = response && typeof response === 'object' ? response as Record<string, any> : {};
      const nested = root.qrcode ?? root.qrCode ?? root.qr ?? root;
      const raw = typeof nested === 'string' ? nested : nested?.base64 ?? nested?.code;
      if (typeof raw === 'string' && raw.trim()) return raw.startsWith('data:') ? raw : `data:image/png;base64,${raw}`;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 1200));
    }
    throw new BadGatewayException('A Evolution API não retornou um QR Code. Tente gerar novamente.');
  }
  private isConnected(response: unknown) {
    return this.connectionState(response) === 'open';
  }
  private connectionState(response: unknown) {
    if (!response || typeof response !== 'object') return '';
    const root = response as Record<string, any>;
    return String(root.state ?? root.instance?.state ?? root.data?.instance?.state ?? '').toLowerCase();
  }
  private async evolutionRequest(base: string, apiKey: string, path: string, options: { method?: string; body?: unknown } = {}): Promise<unknown> {
    const target = new URL(path, `${base.replace(/\/$/, '')}/`);
    if (target.origin !== new URL(base).origin) throw new BadGatewayException('Rota inválida da Evolution API.');
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(target, { method: options.method ?? 'GET', headers: { apikey: apiKey, accept: 'application/json', ...(options.body ? { 'content-type': 'application/json' } : {}) }, ...(options.body ? { body: JSON.stringify(options.body) } : {}), signal: controller.signal });
      if (!response.ok) {
        if (response.status === 404) throw new NotFoundException('Instância Evolution não encontrada.');
        if (response.status === 409 || response.status === 401) throw new BadRequestException('Instância já existe ou a chave da Evolution API foi rejeitada.');
        throw new BadGatewayException(`Evolution API respondeu com erro HTTP ${response.status}.`);
      }
      return await response.json().catch(() => ({}));
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException || error instanceof BadGatewayException) throw error;
      throw new BadGatewayException('Evolution API indisponível ou sem resposta.');
    } finally { clearTimeout(timer); }
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
  private async assertOperatorUnit(membershipId: string, unitId: string) {
    if (!await this.prisma.scoped.unitMembership.findFirst({ where: { membershipId, unitId }, select: { unitId: true } })) throw new ForbiddenException('Esta filial n\u00e3o est\u00e1 no seu escopo.');
  }
  private buildInstanceName(tenantName: string, unitName: string, tenantId: string, unitId: string) {
    const segment = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'unidade';
    const suffix = createHash('sha256').update(`${tenantId}:${unitId}`).digest('hex').slice(0, 8);
    return `ec-${segment(tenantName)}-${segment(unitName)}-${suffix}`.slice(0, 80);
  }
  private string(value: unknown, name: string, max: number) {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new BadRequestException(`${name} é obrigatório e deve ter até ${max} caracteres.`);
    return value.trim();
  }

  private async audit(tenantId: string, actorUserId: string, action: string, entityType: string, entityId: string, metadata: Record<string, unknown>) {
    await this.prisma.scoped.auditEvent.create({ data: { tenantId, actorUserId, action, entityType, entityId, metadata: metadata as object } });
  }
  private metaWebhookUrl() { const base = process.env.API_PUBLIC_URL?.replace(/\/$/, ''); return base ? `${base}/api/meta/webhook` : null; }
  private evolutionWebhookUrl(id: string) { const base = process.env.API_PUBLIC_URL?.replace(/\/$/, ''); return base ? `${base}/api/evolution/webhook/${id}` : null; }
}
