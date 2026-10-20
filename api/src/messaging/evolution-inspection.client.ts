/**
 * Version-bound, read-only Evolution client. Contact listing is available only
 * through an authenticated, unit-scoped user action. Status and QR methods are
 * not invoked during connection setup.
 */
export type EvolutionApiContract = {
  version: string;
  authHeader: string;
  statusPath: (instanceName: string) => string;
  qrPath: (instanceName: string) => string;
  contactsPath?: (instanceName: string) => string;
};

/** Paths observed in the local CRM Turismo Evolution API 2.3.7 code only. */
export const evolutionV237ReferenceContract: EvolutionApiContract = {
  version: '2.3.7-reference-only',
  authHeader: 'apikey',
  statusPath: (instanceName) => `/instance/connectionState/${encodeURIComponent(instanceName)}`,
  qrPath: (instanceName) => `/instance/connect/${encodeURIComponent(instanceName)}`,
  contactsPath: (instanceName) => `/chat/findContacts/${encodeURIComponent(instanceName)}`,
};

export type EvolutionInspectionInput = {
  baseUrl: string;
  instanceName: string;
  apiKey: string;
  contract: EvolutionApiContract;
};

export type EvolutionConnectionInspection = {
  version: string;
  state: 'CONNECTED' | 'CONNECTING' | 'DISCONNECTED' | 'UNKNOWN';
  observedAt: string;
};

export type EvolutionQrInspection = {
  version: string;
  /** Keep QR material out of logs and persist it nowhere. */
  qrCode: string | null;
  pairingCode: string | null;
  observedAt: string;
};

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export class EvolutionInspectionClient {
  constructor(private readonly transport: FetchLike = fetch, private readonly timeoutMs = 5000) {}

  async status(input: EvolutionInspectionInput): Promise<EvolutionConnectionInspection> {
    const result = await this.get(input, input.contract.statusPath(input.instanceName));
    const root = this.record(result);
    const instance = this.record(root.instance);
    const rawState = String(root.state ?? root.status ?? instance.state ?? '').toLowerCase();
    const state = ['open', 'connected'].includes(rawState) ? 'CONNECTED'
      : ['connecting', 'qr'].includes(rawState) ? 'CONNECTING'
        : ['close', 'closed', 'disconnected'].includes(rawState) ? 'DISCONNECTED' : 'UNKNOWN';
    return { version: input.contract.version, state, observedAt: new Date().toISOString() };
  }

  async qrCode(input: EvolutionInspectionInput): Promise<EvolutionQrInspection> {
    const result = await this.get(input, input.contract.qrPath(input.instanceName));
    const root = this.record(result);
    const data = this.record(root.qrcode ?? root.qrCode ?? root);
    return {
      version: input.contract.version,
      qrCode: this.firstString(data.base64, data.code, data.qr),
      pairingCode: this.firstString(data.pairingCode, data.pairing_code),
      observedAt: new Date().toISOString(),
    };
  }

  /** Read-only contact listing. This is called only after an authenticated user asks to import. */
  async contacts(input: EvolutionInspectionInput): Promise<unknown> {
    if (!input.apiKey || !input.instanceName) throw new Error('Evolution credentials and instance name are required.');
    if (!input.contract.contactsPath) throw new Error('Evolution contact listing is not defined for this API contract.');
    const base = new URL(input.baseUrl);
    const localDevelopment = process.env.NODE_ENV !== 'production' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname);
    if ((!localDevelopment && base.protocol !== 'https:') || (base.protocol !== 'https:' && base.protocol !== 'http:') || base.username || base.password || base.search || base.hash) {
      throw new Error('Evolution contacts require a secure HTTPS URL without embedded credentials.');
    }
    const url = new URL(input.contract.contactsPath(input.instanceName), `${base.toString().replace(/\/$/, '')}/`);
    if (url.origin !== base.origin) throw new Error('Evolution contract path cannot change the configured host.');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.transport(url, {
        method: 'POST',
        headers: { [input.contract.authHeader]: input.apiKey, accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({ where: {} }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Evolution contacts returned HTTP ${response.status}.`);
      return await response.json() as unknown;
    } finally { clearTimeout(timer); }
  }

  private async get(input: EvolutionInspectionInput, path: string): Promise<unknown> {
    if (!input.apiKey || !input.instanceName) throw new Error('Evolution credentials and instance name are required.');
    const base = new URL(input.baseUrl);
    if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) throw new Error('Evolution inspection requires an HTTPS base URL without embedded credentials.');
    const url = new URL(path, `${base.toString().replace(/\/$/, '')}/`);
    if (url.origin !== base.origin) throw new Error('Evolution contract path cannot change the configured host.');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.transport(url, { method: 'GET', headers: { [input.contract.authHeader]: input.apiKey, accept: 'application/json' }, signal: controller.signal });
      if (!response.ok) throw new Error(`Evolution inspection returned HTTP ${response.status}.`);
      return await response.json() as unknown;
    } finally { clearTimeout(timer); }
  }

  private record(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  }

  private firstString(...values: unknown[]): string | null {
    return values.find((value): value is string => typeof value === 'string' && Boolean(value.trim())) ?? null;
  }
}
