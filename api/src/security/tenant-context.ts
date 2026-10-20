import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable } from '@nestjs/common';

export interface TenantScope {
  tenantId: string;
  userId: string;
  membershipId: string;
  role: string;
}

@Injectable()
export class TenantContext {
  private readonly storage = new AsyncLocalStorage<TenantScope>();

  run<T>(scope: TenantScope, callback: () => T): T {
    return this.storage.run(scope, callback);
  }

  current(): TenantScope | undefined {
    return this.storage.getStore();
  }
}
