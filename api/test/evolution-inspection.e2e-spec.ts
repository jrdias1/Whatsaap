import { EvolutionInspectionClient, EvolutionApiContract } from '../src/messaging/evolution-inspection.client.js';

describe('Evolution read-only inspection contract', () => {
  it('builds typed status and QR requests through an injected local transport', async () => {
    const requests: Array<{ url: string; headers: HeadersInit }> = [];
    const responses = [
      { instance: { state: 'open' } },
      { qrcode: { base64: 'data:image/png;base64,fixture', pairingCode: '123-456' } },
    ];
    const transport: typeof fetch = async (input, init) => {
      requests.push({ url: String(input), headers: init?.headers ?? {} });
      return new Response(JSON.stringify(responses.shift()), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const contract: EvolutionApiContract = {
      version: 'fixture-v1',
      authHeader: 'apikey',
      statusPath: (name) => `/read/status/${encodeURIComponent(name)}`,
      qrPath: (name) => `/read/qr/${encodeURIComponent(name)}`,
    };
    const client = new EvolutionInspectionClient(transport);
    const input = { baseUrl: 'https://evolution.example.test', instanceName: 'clinic one', apiKey: 'fixture-secret', contract };

    expect(await client.status(input)).toMatchObject({ version: 'fixture-v1', state: 'CONNECTED' });
    expect(await client.qrCode(input)).toMatchObject({ version: 'fixture-v1', qrCode: 'data:image/png;base64,fixture', pairingCode: '123-456' });
    expect(requests.map((request) => request.url)).toEqual([
      'https://evolution.example.test/read/status/clinic%20one',
      'https://evolution.example.test/read/qr/clinic%20one',
    ]);
    expect(requests.every((request) => (request.headers as Record<string, string>).apikey === 'fixture-secret')).toBe(true);
  });
});
