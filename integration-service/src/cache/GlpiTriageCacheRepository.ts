import type { ActiveRoutingOption } from '../repositories/contracts/RoutingRepository.js';
import { ensureRedisConnection, redisClient } from './redisClient.js';

/**
 * Cache Redis para as opções de triagem via categorias ITIL nativas do GLPI.
 *
 * Estratégia de dois níveis:
 *   - Chave primária: TTL de 900 s (15 min). Usada no fluxo normal.
 *   - Chave stale:    TTL de 3600 s (1 h).  Usada como emergência se o GLPI
 *                     estiver indisponível e a chave primária já tiver expirado.
 *
 * PHASE: integaglpi_v8_native_catalog_dynamic_triage_001
 */

const CACHE_VERSION = 'v1';
const TTL_SECONDS = 900;
const STALE_TTL_SECONDS = 3600;

export interface GlpiTriageCacheResult {
  data: ActiveRoutingOption[];
  isStale: boolean;
}

export class GlpiTriageCacheRepository {
  public buildPrimaryKey(entityId: number | null, queueId: number | null, lang: string): string {
    return `integaglpi:triage:categories:${CACHE_VERSION}:entity:${entityId ?? 0}:queue:${queueId ?? 0}:lang:${lang}`;
  }

  public buildStaleKey(primaryKey: string): string {
    return `${primaryKey}:stale`;
  }

  /**
   * Tenta ler do cache primário. Se expirado, tenta o stale.
   * Retorna null se nenhum dos dois tiver valor válido.
   */
  public async get(
    entityId: number | null,
    queueId: number | null,
    lang: string,
  ): Promise<GlpiTriageCacheResult | null> {
    await ensureRedisConnection();
    const primaryKey = this.buildPrimaryKey(entityId, queueId, lang);

    const rawPrimary = await redisClient.get(primaryKey);
    if (rawPrimary !== null) {
      try {
        const data = JSON.parse(rawPrimary) as ActiveRoutingOption[];
        if (Array.isArray(data)) {
          return { data, isStale: false };
        }
      } catch {
        await redisClient.del(primaryKey).catch(() => undefined);
      }
    }

    const staleKey = this.buildStaleKey(primaryKey);
    const rawStale = await redisClient.get(staleKey);
    if (rawStale !== null) {
      try {
        const data = JSON.parse(rawStale) as ActiveRoutingOption[];
        if (Array.isArray(data)) {
          return { data, isStale: true };
        }
      } catch {
        await redisClient.del(staleKey).catch(() => undefined);
      }
    }

    return null;
  }

  /**
   * Grava simultaneamente na chave primária (TTL 900 s) e na chave stale (TTL 3600 s).
   */
  public async set(
    entityId: number | null,
    queueId: number | null,
    lang: string,
    options: ActiveRoutingOption[],
  ): Promise<void> {
    await ensureRedisConnection();
    const primaryKey = this.buildPrimaryKey(entityId, queueId, lang);
    const staleKey = this.buildStaleKey(primaryKey);
    const serialized = JSON.stringify(options);

    await Promise.all([
      redisClient.set(primaryKey, serialized, 'EX', TTL_SECONDS),
      redisClient.set(staleKey, serialized, 'EX', STALE_TTL_SECONDS),
    ]);
  }
}
