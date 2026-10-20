import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';

@Injectable()
export class RedisCoordinatorService implements OnModuleDestroy {
  private readonly redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6380', { maxRetriesPerRequest: null });

  async acquireTenantSlot(tenantId: string, token: string, limit = Number(process.env.OUTBOX_MAX_CONCURRENT_PER_TENANT ?? 8)): Promise<number> {
    const keys = Array.from({ length: Math.max(1, Math.min(64, limit)) }, (_, slot) => `meta:tenant-worker:${tenantId}:${slot}`);
    const ttl = Math.max(500, Math.min(120_000, Number(process.env.OUTBOX_TENANT_SLOT_TTL_MS ?? 120_000)));
    return await this.redis.eval("for i,key in ipairs(KEYS) do if redis.call('SET',key,ARGV[1],'PX',ARGV[2],'NX') then return i end end return 0", keys.length, ...keys, token, String(ttl)) as number;
  }

  async releaseTenantSlot(tenantId: string, slot: number, token: string) {
    const key = `meta:tenant-worker:${tenantId}:${slot - 1}`;
    await this.redis.eval("if redis.call('GET',KEYS[1]) == ARGV[1] then return redis.call('DEL',KEYS[1]) else return 0 end", 1, key, token);
  }

  async takeConnectionRateSlot(connectionId: string, limit = Number(process.env.OUTBOX_MAX_PER_CONNECTION_PER_MINUTE ?? 300)): Promise<boolean> {
    const result = await this.redis.eval(
      "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('PEXPIRE',KEYS[1],60000) end; if n<=tonumber(ARGV[1]) then return 1 else return 0 end",
      1,
      `outbox:rate:${connectionId}`,
      Math.max(1, Math.min(10000, limit)),
    );
    return Number(result) === 1;
  }

  async onModuleDestroy() { await this.redis.quit(); }
}
