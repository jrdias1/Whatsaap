import type { MessagingProvider } from '@prisma/client';

export type ProviderSendInput = {
  connectionId: string;
  destination: string;
  body: string;
  idempotencyKey: string;
  purpose: 'MARKETING' | 'POST_CARE' | 'APPOINTMENT_REMINDER' | 'SATISFACTION_SURVEY' | 'PROCEDURE_RETURN';
};

export type ProviderSimulation = {
  provider: MessagingProvider;
  simulated: true;
  sendsEnabled: false;
  externalRequestMade: false;
  accepted: true;
  reference: string;
};

export interface MessagingProviderAdapter {
  readonly provider: MessagingProvider;
  readonly official: boolean;
  readonly supportsMarketing: boolean;
  capabilities(): { text: boolean; media: boolean; inbound: boolean; status: boolean; qr: boolean };
  simulateSend(input: ProviderSendInput): ProviderSimulation;
}

/** Local adapters intentionally have no HTTP client. Live transport requires separate homologation. */
export class MetaCloudDryRunAdapter implements MessagingProviderAdapter {
  readonly provider = 'META_CLOUD' as const;
  readonly official = true;
  readonly supportsMarketing = true;
  capabilities() { return { text: true, media: false, inbound: true, status: true, qr: false }; }
  simulateSend(input: ProviderSendInput): ProviderSimulation {
    return { provider: this.provider, simulated: true, sendsEnabled: false, externalRequestMade: false, accepted: true, reference: `dryrun:meta:${input.idempotencyKey}` };
  }
}

export class EvolutionBaileysDryRunAdapter implements MessagingProviderAdapter {
  readonly provider = 'EVOLUTION_BAILEYS' as const;
  readonly official = false;
  readonly supportsMarketing = false;
  capabilities() { return { text: true, media: false, inbound: true, status: true, qr: true }; }
  simulateSend(input: ProviderSendInput): ProviderSimulation {
    return { provider: this.provider, simulated: true, sendsEnabled: false, externalRequestMade: false, accepted: true, reference: `dryrun:evolution:${input.idempotencyKey}` };
  }
}

export class MessagingProviderRegistry {
  private readonly adapters = new Map<MessagingProvider, MessagingProviderAdapter>([
    ['META_CLOUD', new MetaCloudDryRunAdapter()],
    ['EVOLUTION_BAILEYS', new EvolutionBaileysDryRunAdapter()],
  ]);
  get(provider: string): MessagingProviderAdapter | undefined { return this.adapters.get(provider as MessagingProvider); }
}
