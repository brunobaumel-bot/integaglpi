import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Request, Response } from 'express';
import type { Pool } from 'pg';

import { env } from '../config/env.js';
import { postgresPool } from '../infra/db/postgres.js';

const POSTGRES_HEALTH_TIMEOUT_MS = 2_000;

let cachedServiceVersion: string | undefined;
function getServiceVersion(): string | undefined {
  if (cachedServiceVersion !== undefined) {
    return cachedServiceVersion;
  }
  try {
    const path = join(dirname(fileURLToPath(import.meta.url)), '../../package.json');
    const raw = readFileSync(path, 'utf8');
    const pkg = JSON.parse(raw) as { version?: string };
    cachedServiceVersion = typeof pkg.version === 'string' ? pkg.version : undefined;
  } catch {
    cachedServiceVersion = undefined;
  }
  return cachedServiceVersion;
}

export function createHealthController(pool: Pick<Pool, 'query'>) {
  return async function healthController(_req: Request, res: Response): Promise<void> {
    const t0 = Date.now();
    let postgresOk = false;
    let latencyMs: number | undefined;
    try {
      await Promise.race([
        pool.query('SELECT 1'),
        new Promise<never>((_, reject) => {
          setTimeout(() => {
            reject(new Error('postgres_healthcheck_timeout'));
          }, POSTGRES_HEALTH_TIMEOUT_MS);
        }),
      ]);
      postgresOk = true;
      latencyMs = Date.now() - t0;
    } catch {
      postgresOk = false;
    }

    const metaConfigured = Boolean(
      String(env.META_APP_SECRET || '').length > 0 &&
        String(env.META_ACCESS_TOKEN || '').length > 0 &&
        String(env.META_VERIFY_TOKEN || '').length > 0 &&
        String(env.META_PHONE_NUMBER_ID || '').length > 0,
    );
    const glpiConfigured = Boolean(
      String(env.GLPI_API_BASE_URL || '').length > 0 &&
        String(env.GLPI_APP_TOKEN || '').length > 0 &&
        String(env.GLPI_USER_TOKEN || '').length > 0,
    );

    const version = getServiceVersion();

    const body = {
      ok: postgresOk,
      service: 'integration-service' as const,
      uptime_seconds: Math.floor(process.uptime()),
      postgres: {
        ok: postgresOk,
        ...(latencyMs !== undefined ? { latency_ms: latencyMs } : {}),
      },
      meta_configured: metaConfigured,
      glpi_configured: glpiConfigured,
      ...(version !== undefined ? { version } : {}),
    };

    if (!postgresOk) {
      res.status(503).json(body);
      return;
    }
    res.status(200).json(body);
  };
}

/** Default handler bound to the shared app pool. */
export const healthController = createHealthController(postgresPool);
