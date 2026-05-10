import { randomUUID } from 'node:crypto';

import { ensureRedisConnection, redisClient } from './redisClient.js';
import type { KeyLock } from '../domain/contracts/KeyLock.js';

const LOCK_PREFIX = 'glpi_plugin_whatsapp:lock:';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Minimal, safe Redis lock:
 * - SET key value NX PX ttl
 * - release via Lua: delete only if value matches token
 */
export class RedisKeyLock implements KeyLock {
  public constructor(
    private readonly ttlMs = 15000,
    private readonly retries = 25,
    private readonly retryDelayMs = 80,
  ) {}

  public async withLock<T>(key: string, work: () => Promise<T>): Promise<T> {
    await ensureRedisConnection();

    const lockKey = `${LOCK_PREFIX}${key}`;
    const token = randomUUID();

    let acquired = false;
    for (let attempt = 0; attempt <= this.retries; attempt += 1) {
      const result = await redisClient.set(lockKey, token, 'PX', this.ttlMs, 'NX');
      if (result === 'OK') {
        acquired = true;
        break;
      }

      if (attempt < this.retries) {
        await sleep(this.retryDelayMs);
      }
    }

    if (!acquired) {
      throw new Error(`RedisKeyLock: failed to acquire lock for ${key}`);
    }

    try {
      return await work();
    } finally {
      // Release only if token matches (avoid deleting someone else's lock)
      const lua = `
        if redis.call("GET", KEYS[1]) == ARGV[1] then
          return redis.call("DEL", KEYS[1])
        end
        return 0
      `;
      try {
        await redisClient.eval(lua, 1, lockKey, token);
      } catch {
        // Best-effort unlock; lock TTL prevents deadlocks.
      }
    }
  }
}

