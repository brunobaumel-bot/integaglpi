import { env } from '../config/env.js';

import { ensureRedisConnection, redisClient } from './redisClient.js';

const CONTACT_CACHE_PREFIX = 'glpi_plugin_whatsapp:contact:phone:';

export interface CachedContactIdentity {
  phoneE164: string;
  localContactId: string;
  glpiContactId: number | null;
  glpiUserId: number | null;
  name: string | null;
  source: string;
}

export class ContactCacheRepository {
  public buildCacheKey(phoneE164: string): string {
    return `${CONTACT_CACHE_PREFIX}${phoneE164}`;
  }

  public async getByPhone(phoneE164: string): Promise<CachedContactIdentity | null> {
    await ensureRedisConnection();

    const rawValue = await redisClient.get(this.buildCacheKey(phoneE164));
    if (!rawValue) {
      return null;
    }

    try {
      return JSON.parse(rawValue) as CachedContactIdentity;
    } catch {
      await redisClient.del(this.buildCacheKey(phoneE164));
      return null;
    }
  }

  public async setByPhone(contactIdentity: CachedContactIdentity): Promise<void> {
    await ensureRedisConnection();

    await redisClient.set(
      this.buildCacheKey(contactIdentity.phoneE164),
      JSON.stringify(contactIdentity),
      'EX',
      env.CONTACT_CACHE_TTL_SECONDS,
    );
  }
}
