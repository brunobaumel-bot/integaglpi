import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Request, Response } from 'express';
import type { Pool } from 'pg';

import type { GlpiClient } from '../adapters/glpi/GlpiClient.js';
import { redisClient } from '../cache/redisClient.js';
import { env } from '../config/env.js';
import { postgresPool } from '../infra/db/postgres.js';
import { DIAGNOSTIC_CATEGORIES, readRuntimeManifest } from '../services/RuntimeManifestService.js';

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
    const runtimeManifest = readRuntimeManifest();

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
      redis: {
        configured: Boolean(env.REDIS_HOST && env.REDIS_PORT),
        client_status: redisClient.status,
      },
      readiness: {
        build_id: runtimeManifest.build_id,
        package_id: runtimeManifest.package_id,
        package_status: runtimeManifest.status,
        manifest_found: runtimeManifest.found,
        expected_migrations_count: runtimeManifest.expected_migrations_count,
        webhook_guard: {
          app_secret_configured: Boolean(env.META_APP_SECRET),
          allowlist_configured:
            env.ALLOWED_META_PHONE_NUMBER_IDS.trim() !== ''
            || env.ALLOWED_META_DISPLAY_PHONE_NUMBERS.trim() !== ''
            || env.ALLOWED_META_PHONE_ID.trim() !== '',
        },
      },
      ...(version !== undefined ? { version } : {}),
    };

    if (!postgresOk) {
      res.status(503).json(body);
      return;
    }
    res.status(200).json(body);
  };
}

async function safeQueryRows<T extends Record<string, unknown>>(
  pool: Pick<Pool, 'query'>,
  text: string,
  values: unknown[] = [],
): Promise<T[]> {
  try {
    const result = await pool.query<T>(text, values);

    return Array.isArray(result.rows) ? result.rows : [];
  } catch {
    return [];
  }
}

const AI_RUNTIME_SETTING_KEYS = [
  'ai_supervisor_enabled',
  'ai_supervisor_provider',
  'ai_supervisor_model',
  'ai_supervisor_timeout_seconds',
  'ai_supervisor_max_messages',
  'ai_supervisor_max_chars',
  'ai_supervisor_dry_run',
  'copilot_enabled',
  'copilot_provider',
  'copilot_model',
  'copilot_dry_run',
  'copilot_timeout_ms',
  'copilot_max_context_chars',
  'p4_candidate_review_provider',
  'p4_candidate_review_model',
] as const;

function aiSetting(settings: Map<string, unknown>, key: string): string {
  const value = settings.get(key);
  return value === undefined || value === null ? '' : String(value).trim();
}

function aiBool(settings: Map<string, unknown>, key: string, fallback: boolean): boolean {
  const value = aiSetting(settings, key).toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(value)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(value)) {
    return false;
  }
  return fallback;
}

function aiProvider(settings: Map<string, unknown>, key: string, fallback: string): string {
  const value = aiSetting(settings, key).toLowerCase();
  if (value === 'local') {
    return 'ollama';
  }
  return ['ollama', 'disabled'].includes(value) ? value : fallback;
}

function aiModel(settings: Map<string, unknown>, key: string, fallback: string): string {
  const value = aiSetting(settings, key).replace(/[^A-Za-z0-9_.:/-]+/g, '').slice(0, 120);
  return value !== '' ? value : fallback;
}

function aiInteger(settings: Map<string, unknown>, key: string, fallback: number, min: number, max: number): number {
  const parsed = Number(aiSetting(settings, key));
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

async function loadAiRuntimeConfigDiagnostics(pool: Pick<Pool, 'query'>): Promise<Record<string, unknown>> {
  const refreshedAt = new Date().toISOString();
  const columnRows = await safeQueryRows<{ column_name: string }>(
    pool,
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = $1
        AND column_name = ANY($2::text[])
    `,
    ['glpi_plugin_integaglpi_configs', ['context', 'updated_at', ...AI_RUNTIME_SETTING_KEYS]],
  );
  const columns = columnRows.map((row) => row.column_name);
  if (!columns.includes('context')) {
    return {
      cache: { strategy: 'no_cache', refreshed_at: refreshedAt, source: 'env', database_available: false },
      ai_supervisor: { origin: 'env', effective: { model: env.AI_SUPERVISOR_MODEL, timeout_ms: env.AI_SUPERVISOR_TIMEOUT_SECONDS * 1000 } },
      copilot: { origin: 'env', effective: { model: env.COPILOT_DRAFT_MODEL || env.AI_SUPERVISOR_MODEL, timeout_ms: (env.COPILOT_TIMEOUT_SECONDS || env.AI_SUPERVISOR_TIMEOUT_SECONDS) * 1000 } },
      ai_online_alerts: { origin: 'env', effective: { model: env.AI_ONLINE_ALERT_MODEL || env.AI_SUPERVISOR_MODEL, timeout_ms: (env.AI_ONLINE_ALERT_TIMEOUT_SECONDS || env.AI_SUPERVISOR_TIMEOUT_SECONDS) * 1000 } },
    };
  }

  const projectionColumns = columns.filter((column) => column !== 'context');
  const settings = new Map<string, unknown>();
  if (projectionColumns.length > 0) {
    const rows = await safeQueryRows<Record<string, unknown>>(
      pool,
      `
        SELECT ${projectionColumns.map((column) => `"${column}"`).join(', ')}
        FROM glpi_plugin_integaglpi_configs
        WHERE context = 'ai_settings'
        LIMIT 1
      `,
    );
    const row = rows[0] ?? {};
    for (const key of projectionColumns) {
      const value = row[key];
      if (value !== undefined && value !== null && String(value).trim() !== '') {
        settings.set(key, value);
      }
    }
  }

  const hasDb = [...settings.keys()].some((key) => key !== 'updated_at');
  const supervisorModel = aiModel(settings, 'ai_supervisor_model', env.AI_SUPERVISOR_MODEL);
  const supervisorTimeoutMs = aiInteger(settings, 'ai_supervisor_timeout_seconds', env.AI_SUPERVISOR_TIMEOUT_SECONDS, 15, 180) * 1000;
  const copilotModelFallback = env.COPILOT_DRAFT_MODEL.trim() !== '' ? env.COPILOT_DRAFT_MODEL.trim() : supervisorModel;
  const copilotTimeoutFallback = env.COPILOT_TIMEOUT_SECONDS > 0 ? env.COPILOT_TIMEOUT_SECONDS * 1000 : supervisorTimeoutMs;
  const alertModel = env.AI_ONLINE_ALERT_MODEL.trim() !== '' ? env.AI_ONLINE_ALERT_MODEL.trim() : supervisorModel;
  const alertTimeoutMs = env.AI_ONLINE_ALERT_TIMEOUT_SECONDS > 0 ? env.AI_ONLINE_ALERT_TIMEOUT_SECONDS * 1000 : supervisorTimeoutMs;

  return {
    cache: {
      strategy: 'no_cache_db_read_per_request',
      refreshed_at: refreshedAt,
      source: hasDb ? 'db_ai_settings' : 'env',
      database_available: true,
      settings_updated_at: aiSetting(settings, 'updated_at'),
    },
    ai_supervisor: {
      origin: hasDb ? 'db' : 'env',
      saved: {
        model: aiSetting(settings, 'ai_supervisor_model'),
        timeout_seconds: aiSetting(settings, 'ai_supervisor_timeout_seconds'),
      },
      effective: {
        enabled: aiBool(settings, 'ai_supervisor_enabled', env.AI_SUPERVISOR_ENABLED),
        provider: aiProvider(settings, 'ai_supervisor_provider', env.AI_SUPERVISOR_PROVIDER),
        model: supervisorModel,
        timeout_ms: supervisorTimeoutMs,
        max_messages: aiInteger(settings, 'ai_supervisor_max_messages', env.AI_SUPERVISOR_MAX_MESSAGES, 1, 30),
        max_chars: aiInteger(settings, 'ai_supervisor_max_chars', env.AI_SUPERVISOR_MAX_CHARS, 500, 12_000),
        dry_run: aiBool(settings, 'ai_supervisor_dry_run', env.AI_SUPERVISOR_DRY_RUN),
      },
    },
    copilot: {
      origin: hasDb ? 'db' : 'env',
      saved: {
        model: aiSetting(settings, 'copilot_model'),
        timeout_ms: aiSetting(settings, 'copilot_timeout_ms'),
      },
      effective: {
        enabled: aiBool(settings, 'copilot_enabled', aiBool(settings, 'ai_supervisor_enabled', env.AI_SUPERVISOR_ENABLED)),
        provider: aiProvider(settings, 'copilot_provider', aiProvider(settings, 'ai_supervisor_provider', env.AI_SUPERVISOR_PROVIDER)),
        model: aiModel(settings, 'copilot_model', copilotModelFallback),
        timeout_ms: aiInteger(settings, 'copilot_timeout_ms', copilotTimeoutFallback, 15_000, 120_000),
        max_chars: aiInteger(settings, 'copilot_max_context_chars', env.AI_SUPERVISOR_MAX_CHARS, 1_000, 12_000),
        dry_run: aiBool(settings, 'copilot_dry_run', aiBool(settings, 'ai_supervisor_dry_run', env.AI_SUPERVISOR_DRY_RUN)),
      },
    },
    ai_online_alerts: {
      origin: env.AI_ONLINE_ALERT_MODEL.trim() !== '' || env.AI_ONLINE_ALERT_TIMEOUT_SECONDS > 0 ? 'env_function_override' : (hasDb ? 'db' : 'env'),
      effective: {
        provider: aiProvider(settings, 'ai_supervisor_provider', env.AI_SUPERVISOR_PROVIDER),
        model: alertModel,
        timeout_ms: alertTimeoutMs,
        dry_run: aiBool(settings, 'ai_supervisor_dry_run', env.AI_SUPERVISOR_DRY_RUN),
      },
    },
    p4_candidate_review: {
      origin: hasDb ? 'db' : 'env',
      saved: {
        provider: aiSetting(settings, 'p4_candidate_review_provider'),
        model: aiSetting(settings, 'p4_candidate_review_model'),
      },
      effective: {
        provider: aiProvider(settings, 'p4_candidate_review_provider', 'disabled'),
        model: aiModel(settings, 'p4_candidate_review_model', supervisorModel),
      },
    },
    ai_online_alert_worker: {
      loop_env: env.AI_ONLINE_ALERT_WORKER_LOOP,
      interval_seconds: env.AI_ONLINE_ALERT_WORKER_INTERVAL_SECONDS,
      status_source: 'worker_process_or_compose',
    },
  };
}

export function createOpsDiagnosticsController(
  pool: Pick<Pool, 'query'>,
  glpiClient?: Pick<GlpiClient, 'checkApiHealth'>,
) {
  return async function opsDiagnosticsController(_req: Request, res: Response): Promise<void> {
    const postgresStartedAt = Date.now();
    let postgresOk = false;
    let postgresLatencyMs: number | null = null;
    try {
      await pool.query('SELECT 1');
      postgresOk = true;
      postgresLatencyMs = Date.now() - postgresStartedAt;
    } catch {
      postgresOk = false;
    }

    const [schemaRows, attemptRows, deliveryRows, inactivityRows, aiRuntimeConfig] = await Promise.all([
      safeQueryRows<{ table_name: string; column_name: string }>(
        pool,
        `
          SELECT table_name, column_name
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name IN (
              'glpi_plugin_integaglpi_conversations',
              'glpi_plugin_integaglpi_entity_selection_attempts',
              'glpi_plugin_integaglpi_message_delivery_status',
              'glpi_plugin_integaglpi_inactivity_job_events',
              'glpi_plugin_integaglpi_messages',
              'glpi_plugin_integaglpi_ai_quality_analyses'
            )
          ORDER BY table_name, ordinal_position
        `,
      ),
      safeQueryRows<Record<string, unknown>>(
        pool,
        `
          SELECT
            a.conversation_id,
            a.status,
            a.glpi_entity_id,
            a.glpi_ticket_id,
            CASE
              WHEN a.error_message LIKE 'ambiguous_reconciliation:%' THEN 'ambiguous_reconciliation'
              ELSE a.status
            END AS display_status,
            LEFT(COALESCE(a.error_message, ''), 180) AS error_message_sanitized,
            a.updated_at
          FROM glpi_plugin_integaglpi_entity_selection_attempts a
          ORDER BY a.updated_at DESC
          LIMIT 10
        `,
      ),
      safeQueryRows<Record<string, unknown>>(
        pool,
        `
          SELECT COALESCE(delivery_status, 'unknown') AS status, COUNT(*)::int AS total
          FROM glpi_plugin_integaglpi_messages
          WHERE direction = 'outbound'
          GROUP BY COALESCE(delivery_status, 'unknown')
          ORDER BY total DESC
          LIMIT 10
        `,
      ),
      safeQueryRows<Record<string, unknown>>(
        pool,
        `
          SELECT
            status,
            COALESCE(event_key, '') AS event_key,
            COALESCE(reason, '') AS reason,
            COALESCE(meta_error_code, '') AS meta_error_code,
            COALESCE(meta_error_message_sanitized, '') AS meta_error_message_sanitized,
            checked_count,
            eligible_count,
            created_at
          FROM glpi_plugin_integaglpi_inactivity_job_events
          ORDER BY created_at DESC
          LIMIT 10
        `,
      ),
      loadAiRuntimeConfigDiagnostics(pool),
    ]);

    const columns = new Set(schemaRows.map((row) => `${row.table_name}.${row.column_name}`));
    const glpiHealth = glpiClient ? await glpiClient.checkApiHealth() : null;
    const runtimeManifest = readRuntimeManifest();

    res.status(200).json({
      ok: postgresOk,
      service: 'integration-service',
      diagnostic_categories: DIAGNOSTIC_CATEGORIES,
      build: {
        build_id: runtimeManifest.build_id,
        package_id: runtimeManifest.package_id,
        generated_at: runtimeManifest.generated_at,
        manifest_found: runtimeManifest.found,
        package_status: runtimeManifest.status,
        source_hint: runtimeManifest.source_hint,
        phase_ids: runtimeManifest.phase_ids,
        critical_files_count: runtimeManifest.critical_files_count,
        expected_migrations_count: runtimeManifest.expected_migrations_count,
        missing_critical_files: runtimeManifest.missing_critical_files,
      },
      postgres: {
        ok: postgresOk,
        latency_ms: postgresLatencyMs,
      },
      redis: {
        configured: Boolean(env.REDIS_HOST && env.REDIS_PORT),
        client_status: redisClient.status,
      },
      glpi_api: {
        configured: Boolean(env.GLPI_API_BASE_URL && env.GLPI_APP_TOKEN && env.GLPI_USER_TOKEN),
        ok: glpiHealth?.ok ?? null,
        latency_ms: glpiHealth?.latencyMs ?? null,
        error_stage: glpiHealth?.errorStage ?? null,
      },
      meta: {
        configured: Boolean(env.META_APP_SECRET && env.META_ACCESS_TOKEN && env.META_VERIFY_TOKEN),
        allowed_phone_number_ids_configured: env.ALLOWED_META_PHONE_NUMBER_IDS.trim() !== '',
        allowed_display_phone_numbers_configured: env.ALLOWED_META_DISPLAY_PHONE_NUMBERS.trim() !== '',
        legacy_allowed_phone_id_configured: env.ALLOWED_META_PHONE_ID.trim() !== '',
      },
      ai_supervisor: {
        enabled: env.AI_SUPERVISOR_ENABLED,
        provider: env.AI_SUPERVISOR_PROVIDER,
        dry_run: env.AI_SUPERVISOR_DRY_RUN,
        base_url_configured: env.AI_SUPERVISOR_BASE_URL.trim() !== '',
      },
      ai_runtime_config: aiRuntimeConfig,
      readiness: {
        webhook_guard: {
          signature_secret_configured: Boolean(env.META_APP_SECRET),
          verify_token_configured: Boolean(env.META_VERIFY_TOKEN),
          phone_number_id_configured: Boolean(env.META_PHONE_NUMBER_ID),
          allowlist_configured:
            env.ALLOWED_META_PHONE_NUMBER_IDS.trim() !== ''
            || env.ALLOWED_META_DISPLAY_PHONE_NUMBERS.trim() !== ''
            || env.ALLOWED_META_PHONE_ID.trim() !== '',
        },
        config: {
          database: env.DB_HOST.trim() !== '' && env.DB_NAME.trim() !== '' && env.DB_USER.trim() !== '',
          redis: env.REDIS_HOST.trim() !== '' && Number.isFinite(env.REDIS_PORT),
          glpi: Boolean(env.GLPI_API_BASE_URL && env.GLPI_APP_TOKEN && env.GLPI_USER_TOKEN),
          meta: Boolean(env.META_APP_SECRET && env.META_ACCESS_TOKEN && env.META_VERIFY_TOKEN),
        },
      },
      schema: {
        conversations_entity_columns: columns.has('glpi_plugin_integaglpi_conversations.glpi_entity_id')
          && columns.has('glpi_plugin_integaglpi_conversations.glpi_entity_name'),
        entity_selection_idempotency: columns.has('glpi_plugin_integaglpi_entity_selection_attempts.idempotency_key'),
        delivery_status_available: columns.has('glpi_plugin_integaglpi_messages.delivery_status'),
        inactivity_diagnostics_available: schemaRows.some((row) => row.table_name === 'glpi_plugin_integaglpi_inactivity_job_events'),
        ai_quality_available: schemaRows.some((row) => row.table_name === 'glpi_plugin_integaglpi_ai_quality_analyses'),
      },
      entity_selection_attempts: attemptRows,
      delivery_status_counts: deliveryRows,
      inactivity_diagnostics: inactivityRows,
    });
  };
}

/** Default handler bound to the shared app pool. */
export const healthController = createHealthController(postgresPool);
