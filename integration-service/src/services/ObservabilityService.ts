import type { QueryResultRow } from 'pg';

import type { GlpiClient } from '../adapters/glpi/GlpiClient.js';
import type { Redis } from 'ioredis';
import { env } from '../config/env.js';
import type { SqlExecutor } from '../infra/db/postgres.js';
import { readRuntimeManifest } from './RuntimeManifestService.js';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const MAX_PAYLOAD_CHARS = 2_000;
const QUERY_TIMEOUT_MS = 3_000;
const GLPI_HEALTH_CACHE_TTL_MS = 5 * 60 * 1000;

const SENSITIVE_KEY_PARTS = [
  'token',
  'secret',
  'bearer',
  'authorization',
  'password',
  'app_secret',
  'access_token',
  'x-hub-signature',
  'x-hub-signature-256',
  'api_key',
  'apikey',
];

const META_EVENT_TYPES = [
  'DROPPED_UNAUTHORIZED_NUMBER',
  'META_API_FAILED',
  'DELIVERY_FAILED',
  'UNMATCHED_WAMID',
  'OAUTH_EXCEPTION',
  'TEMPLATE_ERROR',
  'DEAD_LETTER',
] as const;

export interface ObservabilityFilters {
  periodDays: number;
  severity?: string;
  eventType?: string;
  ticketId?: number;
  phone?: string;
  source?: string;
  page: number;
  limit: number;
}

export interface ObservabilityCache {
  get(key: string): Promise<string | null>;
  setex(key: string, ttlSeconds: number, value: string): Promise<unknown>;
}

type GlpiHealthResult = Awaited<ReturnType<Pick<GlpiClient, 'checkApiHealth'>['checkApiHealth']>>;

let cachedGlpiHealth: { expiresAt: number; value: GlpiHealthResult } | null = null;

export class ObservabilityService {
  public constructor(
    private readonly executor: SqlExecutor,
    private readonly redis: Pick<Redis, 'status' | 'ping'>,
    private readonly glpiClient?: Pick<GlpiClient, 'checkApiHealth'>,
  ) {}

  public async getDashboard(rawFilters: ObservabilityFilters): Promise<Record<string, unknown>> {
    const filters = normalizeFilters(rawFilters);
    const [postgres, redis, glpiApi, cards, events, total, latest] = await Promise.all([
      this.checkPostgres(),
      this.checkRedis(),
      this.checkGlpiApi(),
      this.queryCards(filters),
      this.queryEvents(filters),
      this.queryEventsTotal(filters),
      this.queryLatestSignals(),
    ]);

    const runtimeManifest = readRuntimeManifest();
    const memory = process.memoryUsage();

    return {
      ok: postgres.ok,
      read_only: true,
      filters: serializeFilters(filters),
      environment: {
        node_env: process.env.NODE_ENV ?? '',
        integration_env: env.NODE_ENV,
      },
      health: {
        node: {
          ok: true,
          uptime_seconds: Math.floor(process.uptime()),
          memory_mb: {
            rss: Math.round(memory.rss / 1024 / 1024),
            heap_used: Math.round(memory.heapUsed / 1024 / 1024),
            heap_total: Math.round(memory.heapTotal / 1024 / 1024),
          },
          build_id: runtimeManifest.build_id,
          package_id: runtimeManifest.package_id,
          package_status: runtimeManifest.status,
          manifest_found: runtimeManifest.found,
        },
        postgres,
        redis,
        glpi_api: glpiApi,
        runtime_mismatch: {
          node_build_id: runtimeManifest.build_id,
          node_package_id: runtimeManifest.package_id,
          node_package_status: runtimeManifest.status,
          manifest_found: runtimeManifest.found,
          comparison_available: false,
          status: 'plugin_manifest_not_supplied',
        },
      },
      cards,
      latest,
      meta_event_types: META_EVENT_TYPES,
      pagination: {
        page: filters.page,
        limit: filters.limit,
        total,
        total_pages: Math.max(1, Math.ceil(total / filters.limit)),
      },
      events,
      safety: {
        read_only: true,
        no_retry: true,
        no_resend: true,
        no_reprocess: true,
        payload_max_chars: MAX_PAYLOAD_CHARS,
        query_timeout_ms: QUERY_TIMEOUT_MS,
        glpi_health_cache_seconds: Math.floor(GLPI_HEALTH_CACHE_TTL_MS / 1000),
      },
    };
  }

  private async checkPostgres(): Promise<Record<string, unknown>> {
    const startedAt = Date.now();
    try {
      await this.withTimeout(this.executor.query('SELECT 1'), 'postgres_health_timeout');
      return { ok: true, latency_ms: Date.now() - startedAt };
    } catch (error: unknown) {
      return { ok: false, latency_ms: Date.now() - startedAt, error: sanitizeText((error as Error).message, 160) };
    }
  }

  private async checkRedis(): Promise<Record<string, unknown>> {
    const startedAt = Date.now();
    try {
      if (this.redis.status !== 'ready') {
        return { ok: false, configured: Boolean(env.REDIS_HOST && env.REDIS_PORT), client_status: this.redis.status };
      }
      await this.withTimeout(this.redis.ping(), 'redis_ping_timeout');
      return {
        ok: true,
        configured: Boolean(env.REDIS_HOST && env.REDIS_PORT),
        client_status: this.redis.status,
        latency_ms: Date.now() - startedAt,
      };
    } catch (error: unknown) {
      return {
        ok: false,
        configured: Boolean(env.REDIS_HOST && env.REDIS_PORT),
        client_status: this.redis.status,
        latency_ms: Date.now() - startedAt,
        error: sanitizeText((error as Error).message, 160),
      };
    }
  }

  private async checkGlpiApi(): Promise<Record<string, unknown>> {
    if (!this.glpiClient) {
      return { configured: false, ok: null, latency_ms: null, cache_status: 'unavailable' };
    }

    const now = Date.now();
    if (cachedGlpiHealth !== null && cachedGlpiHealth.expiresAt > now) {
      return toGlpiHealth(cachedGlpiHealth.value, 'hit');
    }

    try {
      const value = await this.withTimeout(this.glpiClient.checkApiHealth(), 'glpi_health_timeout');
      cachedGlpiHealth = { value, expiresAt: now + GLPI_HEALTH_CACHE_TTL_MS };
      return toGlpiHealth(value, 'miss');
    } catch (error: unknown) {
      return {
        configured: Boolean(env.GLPI_API_BASE_URL && env.GLPI_APP_TOKEN && env.GLPI_USER_TOKEN),
        ok: false,
        latency_ms: null,
        error_stage: 'exception',
        error: sanitizeText((error as Error).message, 160),
        cache_status: 'miss',
      };
    }
  }

  private async queryCards(filters: NormalizedObservabilityFilters): Promise<Record<string, unknown>> {
    const params = [filters.dateFrom, filters.dateTo];
    const [audit, delivery, deadLetter, inbound] = await Promise.all([
      this.safeQuery<Record<string, unknown>>(
        `
          SELECT
            COUNT(*) FILTER (WHERE severity IN ('error', 'critical'))::int AS critical_events,
            COUNT(*) FILTER (WHERE event_type = 'DROPPED_UNAUTHORIZED_NUMBER')::int AS webhook_guard_drops,
            COUNT(*) FILTER (WHERE event_type IN ('META_API_FAILED', 'OAUTH_EXCEPTION', 'TEMPLATE_ERROR'))::int AS meta_api_errors,
            MAX(created_at) FILTER (WHERE severity IN ('error', 'critical')) AS last_critical_at
          FROM glpi_plugin_integaglpi_audit_events
          WHERE created_at >= $1::timestamptz
            AND created_at <= $2::timestamptz
        `,
        params,
      ),
      this.safeQuery<Record<string, unknown>>(
        `
          SELECT
            COUNT(*) FILTER (WHERE delivery_status = 'failed')::int AS failed_messages,
            MAX(created_at) FILTER (WHERE delivery_status = 'failed') AS last_failed_at
          FROM glpi_plugin_integaglpi_messages
          WHERE direction = 'outbound'
            AND created_at >= $1::timestamptz
            AND created_at <= $2::timestamptz
        `,
        params,
      ),
      this.safeQuery<Record<string, unknown>>(
        `
          SELECT
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE status = 'open')::int AS open_total,
            MAX(created_at) AS last_created_at
          FROM glpi_plugin_integaglpi_dead_letter
          WHERE created_at >= $1::timestamptz
            AND created_at <= $2::timestamptz
        `,
        params,
      ),
      this.safeQuery<Record<string, unknown>>(
        `
          SELECT MAX(created_at) AS last_inbound_at
          FROM glpi_plugin_integaglpi_messages
          WHERE direction = 'inbound'
        `,
      ),
    ]);

    return {
      audit: audit[0] ?? {},
      delivery: delivery[0] ?? {},
      dead_letter: deadLetter[0] ?? {},
      webhook: {
        last_successful_inbound_at: inbound[0]?.last_inbound_at ?? null,
      },
    };
  }

  private async queryLatestSignals(): Promise<Record<string, unknown>> {
    const [metaError, deadLetter, deliveryFailed, guardDrop] = await Promise.all([
      this.safeQuery<Record<string, unknown>>(
        `
          SELECT event_type, severity, status, error_message, created_at
          FROM glpi_plugin_integaglpi_audit_events
          WHERE event_type IN ('META_API_FAILED', 'OAUTH_EXCEPTION', 'TEMPLATE_ERROR')
          ORDER BY created_at DESC
          LIMIT 1
        `,
      ),
      this.safeQuery<Record<string, unknown>>(
        `
          SELECT operation_type, failure_type, failure_reason, status, created_at
          FROM glpi_plugin_integaglpi_dead_letter
          ORDER BY created_at DESC
          LIMIT 1
        `,
      ),
      this.safeQuery<Record<string, unknown>>(
        `
          SELECT meta_message_id, meta_error_code, meta_error_message_sanitized, created_at
          FROM glpi_plugin_integaglpi_messages
          WHERE direction = 'outbound'
            AND delivery_status = 'failed'
          ORDER BY created_at DESC
          LIMIT 1
        `,
      ),
      this.safeQuery<Record<string, unknown>>(
        `
          SELECT event_type, severity, status, created_at
          FROM glpi_plugin_integaglpi_audit_events
          WHERE event_type = 'DROPPED_UNAUTHORIZED_NUMBER'
          ORDER BY created_at DESC
          LIMIT 1
        `,
      ),
    ]);

    return {
      latest_meta_error: sanitizeRow(metaError[0] ?? null),
      latest_dead_letter: sanitizeRow(deadLetter[0] ?? null),
      latest_delivery_failed: sanitizeRow(deliveryFailed[0] ?? null),
      latest_webhook_guard_drop: sanitizeRow(guardDrop[0] ?? null),
    };
  }

  private async queryEvents(filters: NormalizedObservabilityFilters): Promise<Record<string, unknown>[]> {
    const params = buildEventParams(filters);
    const result = await this.safeQuery<Record<string, unknown>>(
      `
        WITH observability_events AS (
          ${eventUnionSql()}
        )
        SELECT *
        FROM observability_events
        WHERE created_at >= $1::timestamptz
          AND created_at <= $2::timestamptz
          AND ($3::text IS NULL OR severity = $3::text)
          AND ($4::text IS NULL OR event_type = $4::text)
          AND ($5::bigint IS NULL OR ticket_id = $5::bigint)
          AND ($6::text IS NULL OR source = $6::text)
          AND ($7::text IS NULL OR phone_e164 ILIKE $7::text)
        ORDER BY created_at DESC
        LIMIT $8::int OFFSET $9::int
      `,
      params,
    );

    return result.map((row) => sanitizeRow(row) ?? {});
  }

  private async queryEventsTotal(filters: NormalizedObservabilityFilters): Promise<number> {
    const params = buildEventParams(filters).slice(0, 7);
    const result = await this.safeQuery<{ total: number }>(
      `
        WITH observability_events AS (
          ${eventUnionSql()}
        )
        SELECT COUNT(*)::int AS total
        FROM observability_events
        WHERE created_at >= $1::timestamptz
          AND created_at <= $2::timestamptz
          AND ($3::text IS NULL OR severity = $3::text)
          AND ($4::text IS NULL OR event_type = $4::text)
          AND ($5::bigint IS NULL OR ticket_id = $5::bigint)
          AND ($6::text IS NULL OR source = $6::text)
          AND ($7::text IS NULL OR phone_e164 ILIKE $7::text)
      `,
      params,
    );

    return Number(result[0]?.total ?? 0);
  }

  private async safeQuery<T extends QueryResultRow>(text: string, values: unknown[] = []): Promise<T[]> {
    try {
      const result = await this.withTimeout(this.executor.query<T>(text, values), 'observability_query_timeout');
      return Array.isArray(result.rows) ? result.rows : [];
    } catch {
      return [];
    }
  }

  private async withTimeout<T>(promise: Promise<T>, errorMessage: string): Promise<T> {
    return Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error(errorMessage));
        }, QUERY_TIMEOUT_MS);
      }),
    ]);
  }
}

interface NormalizedObservabilityFilters {
  dateFrom: string;
  dateTo: string;
  severity: string | null;
  eventType: string | null;
  ticketId: number | null;
  phone: string | null;
  source: string | null;
  page: number;
  limit: number;
}

function normalizeFilters(filters: ObservabilityFilters): NormalizedObservabilityFilters {
  const now = new Date();
  const periodDays = [1, 7, 30].includes(filters.periodDays) ? filters.periodDays : 1;
  const dateFrom = new Date(now.getTime() - periodDays * 24 * 60 * 60 * 1000);

  return {
    dateFrom: dateFrom.toISOString(),
    dateTo: now.toISOString(),
    severity: allow(filters.severity, ['debug', 'info', 'warning', 'error', 'critical']),
    eventType: normalizeOptional(filters.eventType, 80),
    ticketId: filters.ticketId && filters.ticketId > 0 ? filters.ticketId : null,
    phone: normalizePhoneFilter(filters.phone),
    source: normalizeOptional(filters.source, 80),
    page: Math.max(1, filters.page),
    limit: Math.max(1, Math.min(filters.limit || DEFAULT_LIMIT, MAX_LIMIT)),
  };
}

function serializeFilters(filters: NormalizedObservabilityFilters): Record<string, unknown> {
  return {
    date_from: filters.dateFrom,
    date_to: filters.dateTo,
    severity: filters.severity ?? '',
    event_type: filters.eventType ?? '',
    ticket_id: filters.ticketId ?? '',
    phone: filters.phone ? maskPhone(filters.phone.replaceAll('%', '')) : '',
    source: filters.source ?? '',
    page: filters.page,
    limit: filters.limit,
  };
}

function allow(value: string | undefined, allowed: string[]): string | null {
  const normalized = String(value ?? '').trim().toLowerCase();
  return allowed.includes(normalized) ? normalized : null;
}

function normalizeOptional(value: string | undefined, maxLength: number): string | null {
  const normalized = String(value ?? '').trim();
  return normalized !== '' ? normalized.slice(0, maxLength) : null;
}

function normalizePhoneFilter(value: string | undefined): string | null {
  const normalized = String(value ?? '').replace(/[^\d+]/g, '').slice(0, 20);
  if (normalized === '' || normalized.length < 4) {
    return null;
  }
  return `%${normalized}%`;
}

function buildEventParams(filters: NormalizedObservabilityFilters): unknown[] {
  return [
    filters.dateFrom,
    filters.dateTo,
    filters.severity,
    filters.eventType,
    filters.ticketId,
    filters.source,
    filters.phone,
    filters.limit,
    (filters.page - 1) * filters.limit,
  ];
}

function eventUnionSql(): string {
  return `
    SELECT
      ae.id::text AS id,
      'audit_events'::text AS source,
      ae.event_type,
      ae.severity,
      ae.status,
      ae.ticket_id,
      ae.conversation_id,
      ae.message_id,
      NULL::text AS phone_e164,
      ae.error_message,
      ae.payload_json,
      ae.created_at
    FROM glpi_plugin_integaglpi_audit_events ae
    UNION ALL
    SELECT
      dl.id::text AS id,
      'dead_letter'::text AS source,
      'DEAD_LETTER'::text AS event_type,
      CASE WHEN dl.status = 'open' THEN 'error' ELSE 'warning' END AS severity,
      dl.status,
      dl.ticket_id,
      dl.conversation_id,
      dl.message_id,
      NULL::text AS phone_e164,
      LEFT(COALESCE(dl.failure_reason, dl.failure_type, ''), 500) AS error_message,
      dl.payload_json,
      dl.created_at
    FROM glpi_plugin_integaglpi_dead_letter dl
    UNION ALL
    SELECT
      m.id::text AS id,
      'delivery'::text AS source,
      CASE WHEN m.delivery_status = 'failed' THEN 'DELIVERY_FAILED' ELSE 'DELIVERY_STATUS' END AS event_type,
      CASE WHEN m.delivery_status = 'failed' THEN 'error' ELSE 'info' END AS severity,
      COALESCE(m.delivery_status, 'unknown') AS status,
      c.glpi_ticket_id AS ticket_id,
      m.conversation_id,
      m.message_id,
      c.phone_e164,
      LEFT(COALESCE(m.meta_error_message_sanitized, ''), 500) AS error_message,
      jsonb_build_object(
        'meta_message_id', m.meta_message_id,
        'meta_error_code', m.meta_error_code,
        'message_type', m.message_type
      ) AS payload_json,
      m.created_at
    FROM glpi_plugin_integaglpi_messages m
    LEFT JOIN glpi_plugin_integaglpi_conversations c ON c.id = m.conversation_id
    WHERE m.direction = 'outbound'
  `;
}

function sanitizeRow(row: Record<string, unknown> | null): Record<string, unknown> | null {
  if (row === null) {
    return null;
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (key === 'phone_e164') {
      sanitized.phone_masked = maskPhone(String(value ?? ''));
      continue;
    }
    if (key === 'payload_json') {
      sanitized.payload_json = sanitizePayload(value);
      continue;
    }
    if (key === 'error_message') {
      sanitized.error_message = sanitizeText(String(value ?? ''), 500);
      continue;
    }
    sanitized[key] = typeof value === 'string' ? sanitizeText(value, 500) : value;
  }
  return sanitized;
}

function sanitizePayload(value: unknown): unknown {
  const redacted = redactValue(value, new WeakSet<object>());
  const serialized = JSON.stringify(redacted);
  if (serialized === undefined) {
    return null;
  }
  if (serialized.length > MAX_PAYLOAD_CHARS) {
    return `${serialized.slice(0, MAX_PAYLOAD_CHARS)}... [truncated]`;
  }
  return redacted;
}

function redactValue(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === 'string') {
    return maskEmail(maskPhone(sanitizeText(value, MAX_PAYLOAD_CHARS)));
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, seen));
  }
  if (typeof value === 'object') {
    if (seen.has(value)) {
      return '[CIRCULAR]';
    }
    seen.add(value);
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      output[key] = isSensitiveKey(key) ? '[REDACTED]' : redactValue(item, seen);
    }
    return output;
  }
  return String(value);
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return SENSITIVE_KEY_PARTS.some((part) => normalized.includes(part));
}

function sanitizeText(value: string, maxLength: number): string {
  const cleaned = value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/(token|secret|password|authorization|access_token|app_secret)\s*[:=]\s*[^,\s&]+/gi, '$1=[REDACTED]')
    .slice(0, maxLength);

  return maskEmail(maskPhone(cleaned));
}

export function maskPhone(value: string): string {
  return value.replace(/\+?[1-9]\d{7,14}/g, (match) => {
    const prefix = match.startsWith('+') ? '+' : '';
    const digits = match.replace(/\D/g, '');
    if (digits.length <= 4) {
      return prefix + '****';
    }
    return `${prefix}${digits.slice(0, 2)}****${digits.slice(-4)}`;
  });
}

export function maskEmail(value: string): string {
  return value.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, (match) => {
    const [user = '', domain = ''] = match.split('@');
    if (user.length <= 2) {
      return `**@${domain}`;
    }
    return `${user.slice(0, 1)}***${user.slice(-1)}@${domain}`;
  });
}

function toGlpiHealth(value: GlpiHealthResult, cacheStatus: 'hit' | 'miss'): Record<string, unknown> {
  return {
    configured: Boolean(env.GLPI_API_BASE_URL && env.GLPI_APP_TOKEN && env.GLPI_USER_TOKEN),
    ok: value.ok,
    latency_ms: value.latencyMs,
    error_stage: value.errorStage,
    cache_status: cacheStatus,
  };
}
