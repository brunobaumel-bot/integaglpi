import { randomUUID } from 'node:crypto';

import type { LogmeinSyncLockAdapter } from '../domain/services/LogmeinReadonlyContextService.js';
import { ensureRedisConnection, redisClient } from './redisClient.js';

const LOCK_PREFIX = 'glpi_plugin_whatsapp:lock:logmein_sync';
/** Default TTL: 5 minutes — covers worst-case large sync. Auto-expires if process dies. */
const DEFAULT_TTL_MS = 5 * 60 * 1_000;

/**
 * Redis-backed try-once lock for cross-process LogMeIn sync exclusion.
 * Uses SET key token NX PX ttl — the canonical distributed lock primitive.
 * Release uses a Lua CAS delete to avoid removing another process's lock.
 * Never retries: if the key exists, returns false immediately.
 */
export class LogmeinRedisSyncLock implements LogmeinSyncLockAdapter {
  private token: string | null = null;

  public constructor(private readonly ttlMs: number = DEFAULT_TTL_MS) {}

  public async tryAcquire(): Promise<boolean> {
    try {
      await ensureRedisConnection();
      const token = randomUUID();
      const result = await redisClient.set(LOCK_PREFIX, token, 'PX', this.ttlMs, 'NX');
      if (result === 'OK') {
        this.token = token;
        return true;
      }
      return false;
    } catch {
      // Redis unavailable → fail open (allow sync to proceed via static flag only).
      return true;
    }
  }

  public async release(): Promise<void> {
    if (this.token === null) {
      return;
    }
    const tokenToRelease = this.token;
    this.token = null;
    try {
      await ensureRedisConnection();
      // Lua CAS delete: only removes the key if our token still matches.
      const lua = `
        if redis.call("GET", KEYS[1]) == ARGV[1] then
          return redis.call("DEL", KEYS[1])
        end
        return 0
      `;
      await redisClient.eval(lua, 1, LOCK_PREFIX, tokenToRelease);
    } catch {
      // Best-effort: TTL ensures the lock eventually expires.
    }
  }
}
