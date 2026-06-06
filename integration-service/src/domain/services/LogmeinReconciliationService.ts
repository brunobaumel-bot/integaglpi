/**
 * V7 — LogMeIn remote-access evidence reconciliation.
 *
 * Phase: integaglpi_v7_logmein_remote_access_evidence_reconciliation_001
 *
 * Read-only allowlist policy:
 *  ALLOWED : POST /public-api/v1/reports/remote-access-with-groups
 *            POST /public-api/v1/reports/remote-access  (fallback)
 *  FORBIDDEN: /hosts/{id}/connection, any PUT/DELETE/PATCH, any RMM/script endpoint
 *
 * Sanitization contract:
 *  - userIp  → SHA-256 hash, never stored in plaintext
 *  - userId / technician → SHA-256 hash, never stored in plaintext
 *  - hostName → sanitizeText(), max 160 chars
 *  - No raw payload persisted
 */

import { createHash } from 'node:crypto';

import type { AuditService } from './AuditService.js';
import type { LogmeinReadonlyConfig, LogmeinSyncLockAdapter } from './LogmeinReadonlyContextService.js';

// ── Allowed report endpoint (read-only POST) ─────────────────────────────────
export const RECONCILIATION_BASE_URL = 'https://secure.logmein.com';
export const RECONCILIATION_REPORT_PATH = '/public-api/v1/reports/remote-access-with-groups';
export const RECONCILIATION_FALLBACK_PATH = '/public-api/v1/reports/remote-access';

/**
 * The ONLY paths the worker is ever allowed to POST to. The final endpoint is
 * composed internally from (origin + one of these). A configured baseUrl is
 * treated strictly as an origin (scheme + host[:port]) — any path, query, or
 * hash it carries is discarded. This makes it impossible for configuration to
 * redirect the POST to an action/connection endpoint.
 */
export const RECONCILIATION_ALLOWED_PATHS: readonly string[] = [
  RECONCILIATION_REPORT_PATH,
  RECONCILIATION_FALLBACK_PATH,
];

/** Raised when a forbidden endpoint is somehow requested — defence in depth. */
export class ForbiddenEndpointError extends Error {
  public constructor(attempted: string) {
    super(`LOGMEIN_FORBIDDEN_ENDPOINT:${attempted}`);
    this.name = 'ForbiddenEndpointError';
  }
}

/**
 * Sanitized error categories surfaced to the plugin/operator when the LogMeIn
 * report API itself fails. These are stable identifiers — never raw bodies,
 * headers, tokens or response payloads.
 */
export const REPORT_ERROR_CATEGORIES = {
  HTTP_400: 'LOGMEIN_REPORT_INVALID_PAYLOAD',
  HTTP_429: 'LOGMEIN_RATE_LIMITED',
  HTTP_401_403: 'LOGMEIN_AUTH_FAILED',
  HTTP_415: 'LOGMEIN_UNSUPPORTED_MEDIA_TYPE',
  HTTP_500: 'LOGMEIN_REPORT_HTTP_500',
  EMPTY: 'LOGMEIN_REPORT_EMPTY',
  PARSE_FAILED: 'LOGMEIN_REPORT_PARSE_FAILED',
  TIMEOUT: 'LOGMEIN_REPORT_TIMEOUT',
  TRANSPORT: 'LOGMEIN_REPORT_TRANSPORT',
} as const;

const XSSI_PREFIX_RE = /^\)\]\}'[,\s]*/;

/**
 * Raised when the LogMeIn report API returns a non-OK status or an unparseable
 * body. Carries the sanitized category and the numeric status code only — no
 * response body, headers or credentials are ever attached.
 */
export class ReportApiError extends Error {
  public readonly category: string;
  public readonly statusCode: number;
  public readonly primaryStatusCode: number | null;
  public readonly fallbackStatusCode: number | null;
  public readonly fallbackUsed: boolean;
  public readonly reportPathLabel: 'primary' | 'fallback';
  /** Sanitized, bounded diagnostic reason from the error response (never raw/secret). */
  public readonly reason: string;
  public readonly chunksRequested: number | null;
  public readonly retriesPerformed: number | null;
  public readonly fallbackSkippedReason: string | null;
  public readonly retryAfterSeconds: number | null;
  public readonly rateLimitCooldownUntil: string | null;

  public constructor(category: string, statusCode: number, details: {
    primaryStatusCode?: number | null;
    fallbackStatusCode?: number | null;
    fallbackUsed?: boolean;
    reportPathLabel?: 'primary' | 'fallback';
    reason?: string;
    chunksRequested?: number | null;
    retriesPerformed?: number | null;
    fallbackSkippedReason?: string | null;
    retryAfterSeconds?: number | null;
    rateLimitCooldownUntil?: string | null;
  } = {}) {
    super(category); // message is the stable category id, safe to log
    this.name = 'ReportApiError';
    this.category = category;
    this.statusCode = statusCode;
    this.primaryStatusCode = details.primaryStatusCode ?? (details.reportPathLabel === 'fallback' ? null : statusCode);
    this.fallbackStatusCode = details.fallbackStatusCode ?? (details.reportPathLabel === 'fallback' ? statusCode : null);
    this.fallbackUsed = details.fallbackUsed ?? false;
    this.reportPathLabel = details.reportPathLabel ?? 'primary';
    this.reason = details.reason ?? '';
    this.chunksRequested = details.chunksRequested ?? null;
    this.retriesPerformed = details.retriesPerformed ?? null;
    this.fallbackSkippedReason = details.fallbackSkippedReason ?? null;
    this.retryAfterSeconds = details.retryAfterSeconds ?? null;
    this.rateLimitCooldownUntil = details.rateLimitCooldownUntil ?? null;
  }
}

/** Maps an HTTP status code from the report API to a sanitized category. */
export function classifyReportHttpStatus(status: number): string {
  if (status === 400) return REPORT_ERROR_CATEGORIES.HTTP_400;
  if (status === 429) return REPORT_ERROR_CATEGORIES.HTTP_429;
  if (status === 401 || status === 403 || status === 409) return REPORT_ERROR_CATEGORIES.HTTP_401_403;
  if (status === 415) return REPORT_ERROR_CATEGORIES.HTTP_415;
  if (status >= 400 && status < 500) return REPORT_ERROR_CATEGORIES.HTTP_400;
  if (status >= 500) return REPORT_ERROR_CATEGORIES.HTTP_500;
  return REPORT_ERROR_CATEGORIES.HTTP_500;
}

/** Human-readable, sanitized operator message per category. */
export function reportErrorMessage(category: string): string {
  switch (category) {
    case REPORT_ERROR_CATEGORIES.HTTP_400:
      return 'A API LogMeIn rejeitou o payload do relatório. Revise startDate/endDate e parâmetros obrigatórios.';
    case REPORT_ERROR_CATEGORIES.HTTP_429:
      return 'A API LogMeIn limitou as requisições (HTTP 429 - Too Many Requests). Aguarde o cooldown antes de tentar novamente. Nenhuma alteração foi aplicada.';
    case REPORT_ERROR_CATEGORIES.HTTP_401_403:
      return 'Autorização LogMeIn ausente ou inválida.';
    case REPORT_ERROR_CATEGORIES.HTTP_415:
      return 'A API LogMeIn exige envio em JSON. Verifique Content-Type application/json.';
    case REPORT_ERROR_CATEGORIES.HTTP_500:
      return 'A API de relatórios LogMeIn retornou erro interno (HTTP 5xx). Tente novamente mais tarde.';
    case REPORT_ERROR_CATEGORIES.PARSE_FAILED:
      return 'A resposta da API de relatórios LogMeIn não pôde ser interpretada (formato inesperado).';
    case REPORT_ERROR_CATEGORIES.TIMEOUT:
      return 'A API de relatórios LogMeIn excedeu o tempo limite. Tente novamente.';
    default:
      return 'Conciliação LogMeIn temporariamente indisponível.';
  }
}

// Explicitly forbidden endpoints — checked in tests.
export const FORBIDDEN_ENDPOINTS = [
  '/hosts/',           // connection, commands, script execution
  '/connection',
  '/start-session',
  '/remote-access/start',
  '/deploy',
  '/execute',
  '/run-script',
] as const;

// ── Match statuses ────────────────────────────────────────────────────────────
export const MATCH_STATUSES = [
  'pending_user_review',
  'no_ticket_found',
  'no_entity_mapping',
  'matched_ticket',
  'ignored_duplicate',
  'out_of_scope',
  'resolved',
] as const;
export type MatchStatus = typeof MATCH_STATUSES[number];

export type MatchConfidence = 'high' | 'medium' | 'low' | 'none';

// ── Domain types ─────────────────────────────────────────────────────────────
export interface RemoteAccessSession {
  sessionId: string;
  hostExternalId: string;
  groupExternalId: string;
  groupName: string;
  hostNameSanitized: string;
  sessionStartAt: string | null;
  sessionEndAt: string | null;
  durationSeconds: number;
  equipmentTag: string;
  technicianHash: string | null;
  glpiEntityId: number | null;
  matchStatus: MatchStatus;
  matchConfidence: MatchConfidence;
  sourceWindowFrom: string;
  sourceWindowTo: string;
  sourceSnapshotHash: string;
}

export interface QueueItem {
  id: number;
  sessionId: string;
  status: MatchStatus;
  glpiEntityId: number | null;
  glpiTicketId: number | null;
  glpiTaskId: number | null;
  sessionStartAt: string | null;
  durationSeconds: number;
  groupName: string;
  hostNameSanitized: string;
  equipmentTag: string;
  matchConfidence: string;
  createdAt: string;
}

export interface QueuePage {
  items: QueueItem[];
  total: number;
  page: number;
  limit: number;
  hasNext: boolean;
}

export interface ReconciliationSyncResult {
  ok: boolean;
  status:
    | 'disabled'
    | 'unconfigured'
    | 'migration_required'
    | 'sync_in_progress'
    | 'circuit_open'
    | 'completed'
    | 'failed';
  message: string;
  sessionsFound: number;
  sessionsInserted: number;
  sessionsSkippedDuplicate: number;
  windowFrom: string;
  windowTo: string;
  durationMs: number;
  /** Sanitized report-error category when the LogMeIn report API failed (else null). */
  reportError: string | null;
  /** HTTP status code from the report API when applicable (else null). */
  reportStatusCode: number | null;
  primaryStatusCode: number | null;
  fallbackStatusCode: number | null;
  fallbackUsed: boolean;
  /** Bounded, sanitized diagnostic reason from the report error response (else null). */
  reportReason: string | null;
  fallbackSkippedReason: string | null;
  retryAfterSeconds: number | null;
  rateLimitCooldownUntil: string | null;
  lookbackHours: number;
  lookbackDays: number | null;
  chunkMinutes: number;
  overlapMinutes: number;
  maxRetries: number;
  cooldownSeconds: number;
  circuitOpenUntil: string | null;
}

interface ReportFetchResult {
  items: Record<string, unknown>[];
  primaryStatusCode: number | null;
  fallbackStatusCode: number | null;
  fallbackUsed: boolean;
  reportPathLabel: 'primary' | 'fallback';
  chunksRequested: number;
  chunkMinutes: number;
  overlapMinutes: number;
  retriesPerformed: number;
}

/** Repository contract — implemented by PostgresLogmeinReconciliationRepository. */
export interface LogmeinReconciliationRepository {
  isSchemaReady(): Promise<boolean>;
  upsertSession(session: RemoteAccessSession): Promise<{ inserted: boolean }>;
  upsertQueueItem(sessionId: string, status: MatchStatus, entityId: number | null): Promise<void>;
  getEntityForGroup(groupExternalId: string): Promise<number | null>;
  getEquipmentTagForHost(hostExternalId: string): Promise<string | null>;
  listQueue(input: { status?: string; entityId?: number; page: number; limit: number }): Promise<QueuePage>;
  resolveQueueItem(
    id: number,
    input: {
      status: MatchStatus;
      ticketId?: number | null;
      taskId?: number | null;
      userId: number;
      note?: string | null;
    },
  ): Promise<boolean>;
  insertReconciliationAudit(input: {
    status: 'started' | 'completed' | 'failed';
    sessionsFound: number;
    sessionsInserted: number;
    windowFrom: string;
    windowTo: string;
    errorMessageSanitized?: string | null;
    durationMs?: number | null;
    reportError?: string | null;
    reportStatusCode?: number | null;
    primaryStatusCode?: number | null;
    fallbackStatusCode?: number | null;
    fallbackUsed?: boolean;
    reportPathLabel?: 'primary' | 'fallback' | null;
    reportReason?: string | null;
    chunksRequested?: number | null;
    chunkMinutes?: number | null;
    maxChunkHours?: number | null;
    overlapMinutes?: number | null;
    retriesPerformed?: number | null;
    maxRetries?: number | null;
    lookbackHours?: number | null;
    lookbackDays?: number | null;
    cooldownSeconds?: number | null;
    circuitOpenUntil?: string | null;
    fallbackSkippedReason?: string | null;
    retryAfterSeconds?: number | null;
    rateLimitCooldownUntil?: string | null;
  }): Promise<void>;
}

// ── Default configuration ─────────────────────────────────────────────────────
const DEFAULT_TIMEOUT_MS = 15_000;  // report API can be slower than sync API
const DEFAULT_LOOKBACK_DAYS = 7;
const DEFAULT_CHUNK_MINUTES = 120;
const DEFAULT_CHUNK_OVERLAP_MINUTES = 10;
const DEFAULT_MAX_REPORT_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 25;
const CIRCUIT_BREAKER_FAILURE_THRESHOLD = 2;
const DEFAULT_CIRCUIT_BREAKER_COOLDOWN_SECONDS = 900;
// LogMeIn Central enforces a strict 1-call-per-minute limit across all API
// endpoints. When the window is split into multiple chunks each chunk requires
// its own POST to the reports API, so we must wait at least 62 seconds between
// consecutive chunk calls to stay within the documented rate limit.
// Reference: https://support.logmein.com/central/help/logmein-central-developer-center
// "Due to security restrictions, APIs can only be called once every minute."
const DEFAULT_INTER_CHUNK_DELAY_MS = 62_000;
const MAX_PAGES = 5;                 // max 5 pages × 500 items = 2500 sessions/run
const PAGE_SIZE = 500;
const LOCK_KEY = 'logmein_reconciliation_sync';

interface ReconciliationTimingConfig {
  lookbackHours: number;
  lookbackDays: number | null;
  chunkMinutes: number;
  overlapMinutes: number;
  maxRetries: number;
  cooldownSeconds: number;
  /** Minimum delay between consecutive chunk API calls (ms). Defaults to 62 000. */
  interChunkDelayMs: number;
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function resolveTimingConfig(config: {
  lookbackDays?: number;
  lookbackHours?: number;
  chunkMinutes?: number;
  overlapMinutes?: number;
  maxRetries?: number;
  circuitCooldownSeconds?: number;
  interChunkDelayMs?: number;
}): ReconciliationTimingConfig {
  const fallbackLookbackDays = clampInt(config.lookbackDays, DEFAULT_LOOKBACK_DAYS, 1, 90);
  const lookbackHours = config.lookbackHours !== undefined
    ? clampInt(config.lookbackHours, fallbackLookbackDays * 24, 1, 2_160)
    : fallbackLookbackDays * 24;
  const chunkMinutes = clampInt(config.chunkMinutes, DEFAULT_CHUNK_MINUTES, 5, 120);
  const overlapMinutes = Math.min(
    clampInt(config.overlapMinutes, DEFAULT_CHUNK_OVERLAP_MINUTES, 0, Math.max(0, chunkMinutes - 1)),
    Math.max(0, chunkMinutes - 1),
  );

  return {
    lookbackHours,
    lookbackDays: config.lookbackHours !== undefined ? null : fallbackLookbackDays,
    chunkMinutes,
    overlapMinutes,
    maxRetries: clampInt(config.maxRetries, DEFAULT_MAX_REPORT_RETRIES, 0, 3),
    cooldownSeconds: clampInt(config.circuitCooldownSeconds, DEFAULT_CIRCUIT_BREAKER_COOLDOWN_SECONDS, 60, 86_400),
    // Production callers (buildDependencies) must always pass interChunkDelayMs=62000
    // to respect the 1-call/min LogMeIn rate limit. Tests create the service directly
    // without this field and get 0 (no delay), keeping the test suite fast.
    interChunkDelayMs: typeof config.interChunkDelayMs === 'number' && config.interChunkDelayMs >= 0
      ? Math.min(config.interChunkDelayMs, 300_000)
      : 0,
  };
}

function sanitizeText(value: unknown, max = 160): string {
  return String(value ?? '')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[EMAIL]')
    .replace(/(?:\+?\d[\s().-]*){10,16}/g, '[TELEFONE]')
    .replace(/\b(?:token|secret|bearer|authorization|password|api_key|psk|companyid)\b\s*[:=]\s*["']?[^"',\s}]+["']?/gi, '[SEGREDO_REMOVIDO]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function sha256(value: string): string {
  return value !== '' ? createHash('sha256').update(value).digest('hex') : '';
}

/**
 * Extracts a bounded, sanitized diagnostic reason from an ERROR response body.
 *
 * SECURITY: used ONLY on the non-OK (error) path — never on the success/session
 * path. Reads at most 2 KB of the body, pulls only well-known top-level error
 * fields, strips HTML, and runs the result through sanitizeText() (which removes
 * emails, phones, and token/secret/psk/companyid patterns). The raw text is
 * discarded after extraction. No auth header, no request body, and no full
 * session payload is ever read, logged or persisted.
 */
const ERROR_REASON_MAX_CHARS = 240;
async function extractSanitizedErrorReason(response: Response): Promise<string> {
  try {
    const raw = await response.text();
    if (raw === '') return '';
    const bounded = raw.slice(0, 2_000).replace(XSSI_PREFIX_RE, ''); // hard cap before any processing
    let candidate = '';
    try {
      const parsed = JSON.parse(bounded) as unknown;
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const rec = parsed as Record<string, unknown>;
        for (const key of ['error', 'message', 'error_description', 'code', 'title', 'detail', 'reason', 'errorCode']) {
          const v = rec[key];
          if (typeof v === 'string' && v.trim() !== '') {
            candidate = candidate === '' ? v : `${candidate} | ${v}`;
          } else if (typeof v === 'number') {
            candidate = candidate === '' ? String(v) : `${candidate} | ${v}`;
          }
        }
      }
    } catch {
      // Not JSON — likely an HTML/proxy error page. Strip tags, keep a snippet.
      candidate = bounded.replace(/<[^>]*>/g, ' ');
    }
    if (candidate.trim() === '') {
      candidate = bounded;
    }
    return sanitizeText(candidate, ERROR_REASON_MAX_CHARS);
  } catch {
    return '';
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

function retryDelayMs(attempt: number): number {
  const jitter = Math.floor(Math.random() * RETRY_BASE_DELAY_MS);
  return RETRY_BASE_DELAY_MS * (2 ** Math.max(0, attempt - 1)) + jitter;
}

function parseRetryAfterSeconds(value: string | null): number | null {
  if (value === null || value.trim() === '') return null;
  const trimmed = value.trim();
  const seconds = Number.parseInt(trimmed, 10);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds, 86_400);
  }
  const dateMs = Date.parse(trimmed);
  if (!Number.isFinite(dateMs)) return null;
  const diffSeconds = Math.ceil((dateMs - Date.now()) / 1_000);
  if (diffSeconds < 0) return 0;
  return Math.min(diffSeconds, 86_400);
}

function shouldRetryReportError(error: unknown): boolean {
  if (error instanceof ReportApiError) {
    return error.category === REPORT_ERROR_CATEGORIES.HTTP_500
      || error.category === REPORT_ERROR_CATEGORIES.TIMEOUT
      || error.category === REPORT_ERROR_CATEGORIES.TRANSPORT;
  }
  if (error instanceof ForbiddenEndpointError) return false;
  const message = error instanceof Error ? error.message : String(error);
  return /abort|timeout|fetch failed|network|ECONNRESET|ETIMEDOUT/i.test(message);
}

function splitWindowIntoChunks(
  from: Date,
  to: Date,
  chunkMinutes: number,
  overlapMinutes: number,
): Array<{ from: Date; to: Date }> {
  const startMs = from.getTime();
  const endMs = to.getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs >= endMs) {
    return [{ from, to }];
  }

  const chunkMs = Math.max(5, chunkMinutes) * 60_000;
  const overlapMs = Math.max(0, Math.min(overlapMinutes, Math.max(0, chunkMinutes - 1))) * 60_000;
  const chunks: Array<{ from: Date; to: Date }> = [];
  let cursor = startMs;
  while (cursor < endMs) {
    const chunkEnd = Math.min(cursor + chunkMs, endMs);
    chunks.push({ from: new Date(cursor), to: new Date(chunkEnd) });
    if (chunkEnd >= endMs) break;
    cursor = Math.max(cursor + 1, chunkEnd - overlapMs);
  }
  return chunks;
}

function rawSessionKey(item: Record<string, unknown>): string {
  for (const key of ['sessionId', 'session_id', 'id', 'SessionID', 'sessionID']) {
    const value = item[key];
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return '';
}

function isoDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function parseIsoDate(value: unknown): string | null {
  if (!value || typeof value !== 'string') return null;
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

function parseDurationSeconds(value: unknown, startAt: string | null, endAt: string | null): number {
  if (typeof value === 'number' && value >= 0) return Math.round(value);
  if (startAt !== null && endAt !== null) {
    const diff = (new Date(endAt).getTime() - new Date(startAt).getTime()) / 1000;
    if (Number.isFinite(diff) && diff >= 0) return Math.round(diff);
  }
  return 0;
}

function buildBasicAuthHeader(companyId: string, psk: string): string {
  return `Basic ${Buffer.from(`${companyId}:${psk}`).toString('base64')}`;
}

// ── Service ───────────────────────────────────────────────────────────────────
export class LogmeinReconciliationService {
  private static syncInProgress = false;
  private static consecutiveProvider5xxFailures = 0;
  private static circuitOpenUntilMs = 0;
  private static rateLimitCooldownUntilMs = 0;
  private readonly timingConfig: ReconciliationTimingConfig;

  public constructor(
    private readonly config: LogmeinReadonlyConfig & {
      reconciliationEnabled?: boolean;
      lookbackDays?: number;
      lookbackHours?: number;
      chunkMinutes?: number;
      overlapMinutes?: number;
      maxRetries?: number;
      circuitCooldownSeconds?: number;
    },
    private readonly auditService?: AuditService,
    private readonly repository?: LogmeinReconciliationRepository,
    private readonly syncLock?: LogmeinSyncLockAdapter,
  ) {
    this.timingConfig = resolveTimingConfig(config);
  }

  /** Fetch remote-access sessions from LogMeIn reports API, upsert into ledger. */
  public async syncRemoteAccessSessions(
    overrideWindowFrom?: Date,
    overrideWindowTo?: Date,
  ): Promise<ReconciliationSyncResult> {
    if (!this.config.reconciliationEnabled) {
      return this.fallback('disabled', 'LOGMEIN_RECONCILIATION_DISABLED');
    }
    if (!this.hasCredentials()) {
      return this.fallback('unconfigured', 'CONFIG_REQUIRED_FOR_LOGMEIN_CREDENTIALS');
    }
    if (!this.repository || !await this.repository.isSchemaReady()) {
      return this.fallback('migration_required', 'MIGRATION_043_REQUIRED');
    }

    const rateLimitCooldownUntil = LogmeinReconciliationService.rateLimitCooldownUntilMs;
    if (rateLimitCooldownUntil > Date.now()) {
      const cooldownUntilIso = new Date(rateLimitCooldownUntil).toISOString();
      await this.repository.insertReconciliationAudit({
        status: 'failed',
        sessionsFound: 0,
        sessionsInserted: 0,
        windowFrom: '',
        windowTo: '',
        errorMessageSanitized: 'LOGMEIN_RATE_LIMITED_COOLDOWN_ACTIVE',
        durationMs: 0,
        reportError: REPORT_ERROR_CATEGORIES.HTTP_429,
        reportStatusCode: 429,
        primaryStatusCode: null,
        fallbackStatusCode: null,
        fallbackUsed: false,
        reportPathLabel: 'primary',
        reportReason: 'cooldown_active',
        fallbackSkippedReason: 'rate_limited',
        retryAfterSeconds: Math.max(1, Math.ceil((rateLimitCooldownUntil - Date.now()) / 1_000)),
        rateLimitCooldownUntil: cooldownUntilIso,
        chunksRequested: 0,
        chunkMinutes: this.timingConfig.chunkMinutes,
        overlapMinutes: this.timingConfig.overlapMinutes,
        retriesPerformed: 0,
        maxRetries: this.timingConfig.maxRetries,
        lookbackHours: this.timingConfig.lookbackHours,
        lookbackDays: this.timingConfig.lookbackDays,
        cooldownSeconds: this.timingConfig.cooldownSeconds,
        circuitOpenUntil: null,
      });
      await this.audit('LOGMEIN_SESSION_SYNC_FAILED', 'failed', {
        error_type: 'rate_limited_cooldown_active',
        report_error: REPORT_ERROR_CATEGORIES.HTTP_429,
        report_reason: 'cooldown_active',
        status_code: 429,
        fallback_used: false,
        fallback_skipped_reason: 'rate_limited',
        retry_after_seconds: Math.max(1, Math.ceil((rateLimitCooldownUntil - Date.now()) / 1_000)),
        rate_limit_cooldown_until: cooldownUntilIso,
        cooldown_seconds: this.timingConfig.cooldownSeconds,
      });
      return {
        ok: false,
        status: 'failed',
        message: reportErrorMessage(REPORT_ERROR_CATEGORIES.HTTP_429),
        sessionsFound: 0,
        sessionsInserted: 0,
        sessionsSkippedDuplicate: 0,
        windowFrom: '',
        windowTo: '',
        durationMs: 0,
        reportError: REPORT_ERROR_CATEGORIES.HTTP_429,
        reportStatusCode: 429,
        primaryStatusCode: null,
        fallbackStatusCode: null,
        fallbackUsed: false,
        reportReason: 'cooldown_active',
        fallbackSkippedReason: 'rate_limited',
        retryAfterSeconds: Math.max(1, Math.ceil((rateLimitCooldownUntil - Date.now()) / 1_000)),
        rateLimitCooldownUntil: cooldownUntilIso,
        lookbackHours: this.timingConfig.lookbackHours,
        lookbackDays: this.timingConfig.lookbackDays,
        chunkMinutes: this.timingConfig.chunkMinutes,
        overlapMinutes: this.timingConfig.overlapMinutes,
        maxRetries: this.timingConfig.maxRetries,
        cooldownSeconds: this.timingConfig.cooldownSeconds,
        circuitOpenUntil: null,
      };
    }

    const circuitOpenUntil = LogmeinReconciliationService.circuitOpenUntilMs;
    if (circuitOpenUntil > Date.now()) {
      const circuitOpenUntilIso = new Date(circuitOpenUntil).toISOString();
      await this.repository.insertReconciliationAudit({
        status: 'failed',
        sessionsFound: 0,
        sessionsInserted: 0,
        windowFrom: '',
        windowTo: '',
        errorMessageSanitized: 'LOGMEIN_REPORT_CIRCUIT_OPEN',
        durationMs: 0,
        reportError: REPORT_ERROR_CATEGORIES.HTTP_500,
        reportStatusCode: null,
        primaryStatusCode: null,
        fallbackStatusCode: null,
        fallbackUsed: true,
        reportPathLabel: 'fallback',
        reportReason: 'circuit_open',
        fallbackSkippedReason: null,
        retryAfterSeconds: null,
        rateLimitCooldownUntil: null,
        chunksRequested: 0,
        chunkMinutes: this.timingConfig.chunkMinutes,
        overlapMinutes: this.timingConfig.overlapMinutes,
        retriesPerformed: 0,
        maxRetries: this.timingConfig.maxRetries,
        lookbackHours: this.timingConfig.lookbackHours,
        lookbackDays: this.timingConfig.lookbackDays,
        cooldownSeconds: this.timingConfig.cooldownSeconds,
        circuitOpenUntil: circuitOpenUntilIso,
      });
      await this.audit('LOGMEIN_SESSION_SYNC_FAILED', 'failed', {
        report_error: REPORT_ERROR_CATEGORIES.HTTP_500,
        report_reason: 'circuit_open',
        fallback_used: true,
        chunk_minutes: this.timingConfig.chunkMinutes,
        overlap_minutes: this.timingConfig.overlapMinutes,
        max_retries: this.timingConfig.maxRetries,
        cooldown_seconds: this.timingConfig.cooldownSeconds,
        circuit_open_until: circuitOpenUntilIso,
      });
      return {
        ok: false,
        status: 'circuit_open',
        message: 'LogMeIn Reporting API indisponível temporariamente. Aguarde o cooldown antes de tentar novamente.',
        sessionsFound: 0,
        sessionsInserted: 0,
        sessionsSkippedDuplicate: 0,
        windowFrom: '',
        windowTo: '',
        durationMs: 0,
        reportError: REPORT_ERROR_CATEGORIES.HTTP_500,
        reportStatusCode: null,
        primaryStatusCode: null,
        fallbackStatusCode: null,
        fallbackUsed: true,
        reportReason: 'circuit_open',
        fallbackSkippedReason: null,
        retryAfterSeconds: null,
        rateLimitCooldownUntil: null,
        lookbackHours: this.timingConfig.lookbackHours,
        lookbackDays: this.timingConfig.lookbackDays,
        chunkMinutes: this.timingConfig.chunkMinutes,
        overlapMinutes: this.timingConfig.overlapMinutes,
        maxRetries: this.timingConfig.maxRetries,
        cooldownSeconds: this.timingConfig.cooldownSeconds,
        circuitOpenUntil: circuitOpenUntilIso,
      };
    }

    // Redis cross-process lock.
    const redisAcquired = this.syncLock !== undefined ? await this.syncLock.tryAcquire() : true;
    if (!redisAcquired) {
      await this.audit('LOGMEIN_SESSION_SYNC_STARTED', 'failed', {
        reason: 'redis_lock_busy',
        lock_key: LOCK_KEY,
      });
      return this.fallback('sync_in_progress', 'LOGMEIN_RECONCILIATION_SYNC_IN_PROGRESS');
    }

    // In-process lock.
    if (LogmeinReconciliationService.syncInProgress) {
      if (this.syncLock) await this.syncLock.release().catch(() => undefined);
      await this.audit('LOGMEIN_SESSION_SYNC_STARTED', 'failed', {
        reason: 'in_process_flag_set',
        lock_key: LOCK_KEY,
      });
      return this.fallback('sync_in_progress', 'LOGMEIN_RECONCILIATION_SYNC_IN_PROGRESS');
    }

    LogmeinReconciliationService.syncInProgress = true;
    const startMs = Date.now();

    const windowTo = overrideWindowTo ?? new Date();
    const windowFrom = overrideWindowFrom ?? new Date(windowTo.getTime() - this.timingConfig.lookbackHours * 3_600_000);
    const windowFromStr = isoDateString(windowFrom);
    const windowToStr = isoDateString(windowTo);

    await this.repository.insertReconciliationAudit({
      status: 'started',
      sessionsFound: 0,
      sessionsInserted: 0,
      windowFrom: windowFromStr,
      windowTo: windowToStr,
      reportError: null,
      reportStatusCode: null,
      primaryStatusCode: null,
      fallbackStatusCode: null,
      fallbackUsed: false,
      reportPathLabel: null,
      reportReason: null,
      fallbackSkippedReason: null,
      retryAfterSeconds: null,
      rateLimitCooldownUntil: null,
      chunksRequested: null,
      chunkMinutes: this.timingConfig.chunkMinutes,
      overlapMinutes: this.timingConfig.overlapMinutes,
      retriesPerformed: 0,
      maxRetries: this.timingConfig.maxRetries,
      lookbackHours: this.timingConfig.lookbackHours,
      lookbackDays: this.timingConfig.lookbackDays,
      cooldownSeconds: this.timingConfig.cooldownSeconds,
      circuitOpenUntil: null,
    });
    await this.audit('LOGMEIN_SESSION_SYNC_STARTED', 'success', {
      window_from: windowFromStr,
      window_to: windowToStr,
      lookback_days: this.timingConfig.lookbackDays,
      lookback_hours: this.timingConfig.lookbackHours,
      chunk_minutes: this.timingConfig.chunkMinutes,
      overlap_minutes: this.timingConfig.overlapMinutes,
      max_retries: this.timingConfig.maxRetries,
      cooldown_seconds: this.timingConfig.cooldownSeconds,
    });

    try {
      const reportFetch = await this.fetchAllSessionPages(windowFrom, windowTo);
      const rawSessions = reportFetch.items;
      let inserted = 0;
      let skipped = 0;

      for (const raw of rawSessions) {
        const normalized = await this.normalizeSession(raw, windowFromStr, windowToStr);
        if (normalized === null) continue;
        const result = await this.repository.upsertSession(normalized);
        if (result.inserted) {
          inserted++;
          await this.repository.upsertQueueItem(
            normalized.sessionId,
            normalized.matchStatus,
            normalized.glpiEntityId,
          );
          await this.audit('LOGMEIN_SESSION_MATCHED', 'success', {
            session_id_hash: sha256(normalized.sessionId).slice(0, 16),
            match_status: normalized.matchStatus,
            match_confidence: normalized.matchConfidence,
            entity_id: normalized.glpiEntityId,
            duration_seconds: normalized.durationSeconds,
            window_from: windowFromStr,
            window_to: windowToStr,
          });
        } else {
          skipped++;
        }
      }

      const durationMs = Date.now() - startMs;
      await this.repository.insertReconciliationAudit({
        status: 'completed',
        sessionsFound: rawSessions.length,
        sessionsInserted: inserted,
        windowFrom: windowFromStr,
        windowTo: windowToStr,
        durationMs,
        reportError: null,
        reportStatusCode: null,
        primaryStatusCode: reportFetch.primaryStatusCode,
        fallbackStatusCode: reportFetch.fallbackStatusCode,
        fallbackUsed: reportFetch.fallbackUsed,
        reportPathLabel: reportFetch.reportPathLabel,
        reportReason: null,
        fallbackSkippedReason: null,
        retryAfterSeconds: null,
        rateLimitCooldownUntil: null,
        chunksRequested: reportFetch.chunksRequested,
        chunkMinutes: reportFetch.chunkMinutes,
        overlapMinutes: reportFetch.overlapMinutes,
        retriesPerformed: reportFetch.retriesPerformed,
        maxRetries: this.timingConfig.maxRetries,
        lookbackHours: this.timingConfig.lookbackHours,
        lookbackDays: this.timingConfig.lookbackDays,
        cooldownSeconds: this.timingConfig.cooldownSeconds,
        circuitOpenUntil: null,
      });
      await this.audit('LOGMEIN_SESSION_SYNC_COMPLETED', 'success', {
        sessions_found: rawSessions.length,
        sessions_inserted: inserted,
        sessions_skipped: skipped,
        duration_ms: durationMs,
        window_from: windowFromStr,
        window_to: windowToStr,
        report_path_label: reportFetch.reportPathLabel,
        primary_status_code: reportFetch.primaryStatusCode,
        fallback_status_code: reportFetch.fallbackStatusCode,
        fallback_used: reportFetch.fallbackUsed,
        chunks_requested: reportFetch.chunksRequested,
        chunk_minutes: reportFetch.chunkMinutes,
        overlap_minutes: reportFetch.overlapMinutes,
        retries_performed: reportFetch.retriesPerformed,
        max_retries: this.timingConfig.maxRetries,
        lookback_hours: this.timingConfig.lookbackHours,
        lookback_days: this.timingConfig.lookbackDays,
        cooldown_seconds: this.timingConfig.cooldownSeconds,
      });

      LogmeinReconciliationService.consecutiveProvider5xxFailures = 0;
      LogmeinReconciliationService.circuitOpenUntilMs = 0;

      // HTTP 200 with zero sessions is a SUCCESS, not an error.
      const completedMessage = rawSessions.length === 0
        ? 'Sync concluído: nenhuma sessão remota no período.'
        : '';

      return {
        ok: true,
        status: 'completed',
        message: completedMessage,
        sessionsFound: rawSessions.length,
        sessionsInserted: inserted,
        sessionsSkippedDuplicate: skipped,
        windowFrom: windowFromStr,
        windowTo: windowToStr,
        durationMs,
        reportError: null,
        reportStatusCode: null,
        primaryStatusCode: reportFetch.primaryStatusCode,
        fallbackStatusCode: reportFetch.fallbackStatusCode,
        fallbackUsed: reportFetch.fallbackUsed,
        reportReason: null,
        fallbackSkippedReason: null,
        retryAfterSeconds: null,
        rateLimitCooldownUntil: null,
        lookbackHours: this.timingConfig.lookbackHours,
        lookbackDays: this.timingConfig.lookbackDays,
        chunkMinutes: this.timingConfig.chunkMinutes,
        overlapMinutes: this.timingConfig.overlapMinutes,
        maxRetries: this.timingConfig.maxRetries,
        cooldownSeconds: this.timingConfig.cooldownSeconds,
        circuitOpenUntil: null,
      };
    } catch (error: unknown) {
      const durationMs = Date.now() - startMs;
      // Resolve sanitized category + status code without ever touching the body.
      const reportCategory = error instanceof ReportApiError
        ? error.category
        : (error instanceof Error && /abort|timeout/i.test(error.message)
            ? REPORT_ERROR_CATEGORIES.TIMEOUT
            : REPORT_ERROR_CATEGORIES.TRANSPORT);
      const reportStatusCode = error instanceof ReportApiError ? error.statusCode : null;
      const primaryStatusCode = error instanceof ReportApiError ? error.primaryStatusCode : null;
      const fallbackStatusCode = error instanceof ReportApiError ? error.fallbackStatusCode : null;
      const fallbackUsed = error instanceof ReportApiError ? error.fallbackUsed : false;
      const reportPathLabel = error instanceof ReportApiError ? error.reportPathLabel : 'primary';
      // Bounded, sanitized diagnostic reason (only present on ReportApiError).
      const reportReason = error instanceof ReportApiError && error.reason !== '' ? error.reason : null;
      const fallbackSkippedReason = error instanceof ReportApiError ? error.fallbackSkippedReason : null;
      const retryAfterSeconds = error instanceof ReportApiError ? error.retryAfterSeconds : null;
      const rateLimitCooldownUntil = error instanceof ReportApiError ? error.rateLimitCooldownUntil : null;
      const chunksRequested = error instanceof ReportApiError ? error.chunksRequested : null;
      const retriesPerformed = error instanceof ReportApiError ? error.retriesPerformed : null;
      let circuitOpenUntilIso: string | null = null;
      if (reportCategory === REPORT_ERROR_CATEGORIES.HTTP_429) {
        const cooldownUntilMs = rateLimitCooldownUntil !== null
          ? Date.parse(rateLimitCooldownUntil)
          : Date.now() + this.timingConfig.cooldownSeconds * 1_000;
        if (Number.isFinite(cooldownUntilMs) && cooldownUntilMs > Date.now()) {
          LogmeinReconciliationService.rateLimitCooldownUntilMs = cooldownUntilMs;
        }
      }
      if (
        error instanceof ReportApiError
        && reportCategory === REPORT_ERROR_CATEGORIES.HTTP_500
        && fallbackUsed
        && (fallbackStatusCode ?? 0) >= 500
      ) {
        LogmeinReconciliationService.consecutiveProvider5xxFailures += 1;
        if (LogmeinReconciliationService.consecutiveProvider5xxFailures >= CIRCUIT_BREAKER_FAILURE_THRESHOLD) {
          LogmeinReconciliationService.circuitOpenUntilMs = Date.now() + this.timingConfig.cooldownSeconds * 1_000;
          circuitOpenUntilIso = new Date(LogmeinReconciliationService.circuitOpenUntilMs).toISOString();
        }
      } else {
        LogmeinReconciliationService.consecutiveProvider5xxFailures = 0;
      }
      // errorMessageSanitized is the stable category id (never a raw message/body).
      const errorMessage = sanitizeText(reportCategory, 240);

      await this.repository.insertReconciliationAudit({
        status: 'failed',
        sessionsFound: 0,
        sessionsInserted: 0,
        windowFrom: windowFromStr,
        windowTo: windowToStr,
        errorMessageSanitized: errorMessage,
        durationMs,
        reportError: reportCategory,
        reportStatusCode,
        primaryStatusCode,
        fallbackStatusCode,
        fallbackUsed,
        reportPathLabel,
        reportReason,
        fallbackSkippedReason,
        retryAfterSeconds,
        rateLimitCooldownUntil,
        chunksRequested,
        chunkMinutes: this.timingConfig.chunkMinutes,
        overlapMinutes: this.timingConfig.overlapMinutes,
        retriesPerformed,
        maxRetries: this.timingConfig.maxRetries,
        lookbackHours: this.timingConfig.lookbackHours,
        lookbackDays: this.timingConfig.lookbackDays,
        cooldownSeconds: this.timingConfig.cooldownSeconds,
        circuitOpenUntil: circuitOpenUntilIso,
      });
      await this.audit('LOGMEIN_SESSION_SYNC_FAILED', 'failed', {
        error_type: this.errorType(error),
        report_error: reportCategory,
        // Logical labels only — never the full URL with query/host credentials.
        report_path_label: reportPathLabel,
        primary_status_code: primaryStatusCode,
        fallback_status_code: fallbackStatusCode,
        fallback_used: fallbackUsed,
        status_code: reportStatusCode,
        // Bounded sanitized reason for operator diagnosis (no body/token/headers).
        report_reason: reportReason,
        fallback_skipped_reason: fallbackSkippedReason,
        retry_after_seconds: retryAfterSeconds,
        rate_limit_cooldown_until: rateLimitCooldownUntil,
        chunks_requested: chunksRequested,
        chunk_minutes: this.timingConfig.chunkMinutes,
        overlap_minutes: this.timingConfig.overlapMinutes,
        retries_performed: retriesPerformed,
        max_retries: this.timingConfig.maxRetries,
        lookback_hours: this.timingConfig.lookbackHours,
        lookback_days: this.timingConfig.lookbackDays,
        cooldown_seconds: this.timingConfig.cooldownSeconds,
        circuit_open_until: circuitOpenUntilIso,
        duration_ms: durationMs,
        window_from: windowFromStr,
        window_to: windowToStr,
      });
      return {
        ok: false,
        status: 'failed',
        message: reportErrorMessage(reportCategory),
        sessionsFound: 0,
        sessionsInserted: 0,
        sessionsSkippedDuplicate: 0,
        windowFrom: windowFromStr,
        windowTo: windowToStr,
        durationMs,
        reportError: reportCategory,
        reportStatusCode,
        primaryStatusCode,
        fallbackStatusCode,
        fallbackUsed,
        reportReason,
        fallbackSkippedReason,
        retryAfterSeconds,
        rateLimitCooldownUntil,
        lookbackHours: this.timingConfig.lookbackHours,
        lookbackDays: this.timingConfig.lookbackDays,
        chunkMinutes: this.timingConfig.chunkMinutes,
        overlapMinutes: this.timingConfig.overlapMinutes,
        maxRetries: this.timingConfig.maxRetries,
        cooldownSeconds: this.timingConfig.cooldownSeconds,
        circuitOpenUntil: circuitOpenUntilIso,
      };
    } finally {
      LogmeinReconciliationService.syncInProgress = false;
      if (this.syncLock && redisAcquired) {
        await this.syncLock.release().catch(() => undefined);
      }
    }
  }

  /** List the regularization queue. */
  public async listQueue(input: {
    status?: string;
    entityId?: number;
    page: number;
    limit: number;
  }): Promise<QueuePage> {
    if (!this.repository) {
      return { items: [], total: 0, page: input.page, limit: input.limit, hasNext: false };
    }
    return this.repository.listQueue(input);
  }

  /** Resolve a queue item (link ticket, create task, ignore). All actions are manual. */
  public async resolveQueueItem(
    id: number,
    input: {
      status: MatchStatus;
      ticketId?: number | null;
      taskId?: number | null;
      userId: number;
      note?: string | null;
    },
  ): Promise<boolean> {
    if (!this.repository) return false;
    const ok = await this.repository.resolveQueueItem(id, {
      ...input,
      note: input.note ? sanitizeText(input.note, 500) : null,
    });
    if (ok) {
      await this.audit('LOGMEIN_SESSION_REGULARIZATION_RESOLVED', 'success', {
        queue_item_id: id,
        new_status: input.status,
        ticket_id: input.ticketId ?? null,
        task_id: input.taskId ?? null,
        resolved_by_user_id: input.userId,
      });
    }
    return ok;
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private async fetchAllSessionPages(from: Date, to: Date): Promise<ReportFetchResult> {
    const chunks = splitWindowIntoChunks(
      from,
      to,
      this.timingConfig.chunkMinutes,
      this.timingConfig.overlapMinutes,
    );

    // De-duplicate chunks that collapse to the same (startDate, endDate) pair.
    // The LogMeIn Reports API uses date-only granularity (YYYY-MM-DD), so multiple
    // time-based sub-day chunks within the same calendar day would send identical
    // requests and waste the strict 1-call/min quota. We keep only the first chunk
    // per unique date pair, which is enough to retrieve all sessions for that day.
    const seenDatePairs = new Set<string>();
    const dedupedChunks = chunks.filter((chunk) => {
      const key = `${isoDateString(chunk.from)}|${isoDateString(chunk.to)}`;
      if (seenDatePairs.has(key)) return false;
      seenDatePairs.add(key);
      return true;
    });

    const itemsBySessionId = new Map<string, Record<string, unknown>>();
    let primaryStatusCode: number | null = null;
    let fallbackStatusCode: number | null = null;
    let fallbackUsed = false;
    let reportPathLabel: 'primary' | 'fallback' = 'primary';
    let retriesPerformed = 0;
    let isFirstChunk = true;

    for (const chunk of dedupedChunks) {
      // LogMeIn enforces 1 API call per minute. Add the required inter-chunk
      // delay before every call except the very first one.
      if (isFirstChunk) {
        isFirstChunk = false;
      } else {
        await new Promise<void>((resolve) => setTimeout(resolve, this.timingConfig.interChunkDelayMs));
      }
      try {
        const result = await this.fetchSessionWindowWithFallback(chunk.from, chunk.to);
        primaryStatusCode = result.primaryStatusCode ?? primaryStatusCode;
        fallbackStatusCode = result.fallbackStatusCode ?? fallbackStatusCode;
        fallbackUsed = fallbackUsed || result.fallbackUsed;
        reportPathLabel = result.reportPathLabel === 'fallback' ? 'fallback' : reportPathLabel;
        retriesPerformed += result.retriesPerformed;
        for (const item of result.items) {
          const key = rawSessionKey(item);
          itemsBySessionId.set(key !== '' ? key : `__no_session_id_${itemsBySessionId.size}`, item);
        }
      } catch (error: unknown) {
        if (error instanceof ReportApiError) {
          throw new ReportApiError(error.category, error.statusCode, {
            primaryStatusCode: error.primaryStatusCode,
            fallbackStatusCode: error.fallbackStatusCode,
            fallbackUsed: error.fallbackUsed,
            reportPathLabel: error.reportPathLabel,
            reason: error.reason,
            fallbackSkippedReason: error.fallbackSkippedReason,
            retryAfterSeconds: error.retryAfterSeconds,
            rateLimitCooldownUntil: error.rateLimitCooldownUntil,
            chunksRequested: dedupedChunks.length,
            retriesPerformed: retriesPerformed + (error.retriesPerformed ?? 0),
          });
        }
        throw error;
      }
    }

    return {
      items: Array.from(itemsBySessionId.values()),
      primaryStatusCode,
      fallbackStatusCode,
      fallbackUsed,
      reportPathLabel,
      chunksRequested: dedupedChunks.length,
      chunkMinutes: this.timingConfig.chunkMinutes,
      overlapMinutes: this.timingConfig.overlapMinutes,
      retriesPerformed,
    };
  }

  private async fetchSessionWindowWithFallback(from: Date, to: Date): Promise<ReportFetchResult> {
    try {
      const primary = await this.fetchSessionPagesFromPath(RECONCILIATION_REPORT_PATH, from, to, 'primary');
      return {
        items: primary.items,
        primaryStatusCode: primary.statusCode,
        fallbackStatusCode: null,
        fallbackUsed: false,
        reportPathLabel: 'primary',
        chunksRequested: 1,
        chunkMinutes: this.timingConfig.chunkMinutes,
        overlapMinutes: this.timingConfig.overlapMinutes,
        retriesPerformed: primary.retriesPerformed,
      };
    } catch (error: unknown) {
      if (!(error instanceof ReportApiError) || error.category !== REPORT_ERROR_CATEGORIES.HTTP_500) {
        throw error;
      }

      try {
        const fallback = await this.fetchSessionPagesFromPath(RECONCILIATION_FALLBACK_PATH, from, to, 'fallback');
        return {
          items: fallback.items,
          primaryStatusCode: error.statusCode,
          fallbackStatusCode: fallback.statusCode,
          fallbackUsed: true,
          reportPathLabel: 'fallback',
          chunksRequested: 1,
          chunkMinutes: this.timingConfig.chunkMinutes,
          overlapMinutes: this.timingConfig.overlapMinutes,
          retriesPerformed: (error.retriesPerformed ?? 0) + fallback.retriesPerformed,
        };
      } catch (fallbackError: unknown) {
        if (fallbackError instanceof ReportApiError) {
          // Prefer the fallback reason; fall back to the primary reason if empty.
          const combinedReason = fallbackError.reason !== '' ? fallbackError.reason : error.reason;
          throw new ReportApiError(fallbackError.category, fallbackError.statusCode, {
            primaryStatusCode: error.statusCode,
            fallbackStatusCode: fallbackError.statusCode,
            fallbackUsed: true,
            reportPathLabel: 'fallback',
            reason: combinedReason,
            fallbackSkippedReason: fallbackError.fallbackSkippedReason,
            retryAfterSeconds: fallbackError.retryAfterSeconds,
            rateLimitCooldownUntil: fallbackError.rateLimitCooldownUntil,
            chunksRequested: 1,
            retriesPerformed: (error.retriesPerformed ?? 0) + (fallbackError.retriesPerformed ?? 0),
          });
        }
        throw fallbackError;
      }
    }
  }

  private async fetchSessionPagesFromPath(
    path: string,
    from: Date,
    to: Date,
    label: 'primary' | 'fallback',
  ): Promise<{ items: Record<string, unknown>[]; statusCode: number; retriesPerformed: number }> {
    const allItems: Record<string, unknown>[] = [];
    const url = this.reportEndpoint(path);
    const authHeader = this.basicAuthHeader();
    const startDate = isoDateString(from);
    const endDate = isoDateString(to);
    const body = {
      startDate,
      endDate,
      count: PAGE_SIZE,
    };
    let retriesPerformed = 0;
    let lastStatusCode = 200;

    for (let page = 0; page < MAX_PAGES; page++) {
      let response: Response | null = null;
      for (let attempt = 0; attempt <= this.timingConfig.maxRetries; attempt++) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS);
        try {
          response = await fetch(url, {
            method: 'POST',                        // POST is allowlisted for passive reports
            signal: controller.signal,
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
              Authorization: authHeader,           // header value never logged
            },
            body: JSON.stringify({ ...body, offset: page * PAGE_SIZE }),
          });
          if (response.ok || response.status < 500) {
            break;
          }
          if (attempt >= this.timingConfig.maxRetries) break;
          retriesPerformed++;
          await delay(retryDelayMs(attempt + 1));
        } catch (error: unknown) {
          if (attempt >= this.timingConfig.maxRetries || !shouldRetryReportError(error)) {
            const message = error instanceof Error ? error.message : String(error);
            throw new ReportApiError(REPORT_ERROR_CATEGORIES.TRANSPORT, 0, {
              reportPathLabel: label,
              retriesPerformed,
              reason: sanitizeText(message, ERROR_REASON_MAX_CHARS),
            });
          }
          retriesPerformed++;
          await delay(retryDelayMs(attempt + 1));
        } finally {
          clearTimeout(timeout);
        }
      }

      if (response === null) {
        throw new ReportApiError(REPORT_ERROR_CATEGORIES.TRANSPORT, 0, {
          reportPathLabel: label,
          retriesPerformed,
        });
      }
      lastStatusCode = typeof response.status === 'number' ? response.status : 200;

      if (!response.ok) {
        // Sanitized classification + bounded diagnostic reason. The reason reads
        // only well-known top-level error fields, stripped of secrets — never the
        // full body, request, or auth header.
        const reason = await extractSanitizedErrorReason(response);
        const category = classifyReportHttpStatus(response.status);
        const retryAfterSeconds = category === REPORT_ERROR_CATEGORIES.HTTP_429
          ? parseRetryAfterSeconds(response.headers?.get?.('retry-after') ?? null)
            ?? this.timingConfig.cooldownSeconds
          : null;
        const rateLimitCooldownUntil = retryAfterSeconds !== null
          ? new Date(Date.now() + retryAfterSeconds * 1_000).toISOString()
          : null;
        throw new ReportApiError(category, response.status, {
          reportPathLabel: label,
          reason,
          retriesPerformed,
          fallbackSkippedReason: category === REPORT_ERROR_CATEGORIES.HTTP_429 ? 'rate_limited' : null,
          retryAfterSeconds,
          rateLimitCooldownUntil,
        });
      }

      let raw: unknown;
      try {
        // GoTo/LogMeIn reports wrap the body in the anti-JSON-hijacking guard
        // `)]}'` (same convention as Google APIs). Strip it before parsing so the
        // success path works. The hostswithgroups (asset) endpoint does NOT use
        // this guard, which is why the existing asset sync parses cleanly.
        // Prefer raw text (required to strip the guard); tolerate json-only bodies.
        const text = typeof response.text === 'function'
          ? await response.text()
          : JSON.stringify(await response.json());
        const cleaned = text.replace(/^\)\]\}'[,\s]*/, '');
        raw = JSON.parse(cleaned);
      } catch {
        // Body present but not valid JSON / unexpected shape.
        throw new ReportApiError(REPORT_ERROR_CATEGORIES.PARSE_FAILED, response.status, {
          reportPathLabel: label,
          retriesPerformed,
        });
      }

      const items = this.extractItems(raw);
      allItems.push(...items);

      // Stop if page is not full (no more pages).
      if (items.length < PAGE_SIZE) break;
    }

    return { items: allItems, statusCode: lastStatusCode, retriesPerformed };
  }

  private extractItems(body: unknown): Record<string, unknown>[] {
    const record = body !== null && typeof body === 'object' && !Array.isArray(body)
      ? body as Record<string, unknown>
      : {};

    const candidates = [
      record.items,
      record.sessions,
      record.data,
      record.result,
      record.Results,
      body,
    ];
    for (const candidate of candidates) {
      if (Array.isArray(candidate)) {
        return candidate.filter((v) => v !== null && typeof v === 'object') as Record<string, unknown>[];
      }
    }
    return [];
  }

  private async normalizeSession(
    raw: Record<string, unknown>,
    windowFrom: string,
    windowTo: string,
  ): Promise<RemoteAccessSession | null> {
    // sessionId is mandatory.
    const sessionId = this.firstString(raw, ['sessionId', 'SessionId', 'session_id', 'SessionID'], 160);
    if (sessionId === '') return null;

    const hostExternalId = this.firstString(raw, ['hostId', 'HostId', 'host_id', 'HostID'], 120);
    const groupExternalId = this.firstString(raw, ['groupId', 'GroupId', 'group_id', 'GroupID'], 120);
    const groupName = sanitizeText(this.firstString(raw, ['groupName', 'GroupName', 'group_name'], 160));
    const hostName = sanitizeText(
      this.firstString(raw, ['hostName', 'HostName', 'host_name', 'deviceName', 'DeviceName'], 160),
    );

    const sessionStartAt = parseIsoDate(
      this.firstRaw(raw, ['startTime', 'StartTime', 'start_time', 'sessionStart', 'SessionStart']),
    );
    const sessionEndAt = parseIsoDate(
      this.firstRaw(raw, ['endTime', 'EndTime', 'end_time', 'sessionEnd', 'SessionEnd']),
    );
    const durationSeconds = parseDurationSeconds(
      this.firstRaw(raw, ['duration', 'Duration', 'durationSeconds', 'DurationSeconds']),
      sessionStartAt,
      sessionEndAt,
    );

    // Security: hash IP and technician — never store in plaintext.
    const rawIp = this.firstString(raw, ['userIp', 'UserIp', 'user_ip', 'clientIp', 'ClientIp'], 80);
    const rawUser = this.firstString(raw, ['userId', 'UserId', 'user_id', 'userEmail', 'UserEmail'], 160);
    const technicianHash = rawUser !== '' ? sha256(rawUser) : null;
    // rawIp is hashed for the snapshotHash but not persisted anywhere.
    void rawIp; // intentionally unused — never persisted

    // Snapshot hash covers the session content (not the IP) for dedup.
    const snapshotInput = [sessionId, hostExternalId, groupExternalId, sessionStartAt ?? '', sessionEndAt ?? ''].join('|');
    const sourceSnapshotHash = sha256(snapshotInput);

    // Entity matching from local Postgres cache.
    let glpiEntityId: number | null = null;
    let equipmentTag = '';
    let matchStatus: MatchStatus = 'pending_user_review';
    let matchConfidence: MatchConfidence = 'none';

    if (this.repository && groupExternalId !== '') {
      glpiEntityId = await this.repository.getEntityForGroup(groupExternalId);
    }
    if (this.repository && hostExternalId !== '') {
      equipmentTag = (await this.repository.getEquipmentTagForHost(hostExternalId)) ?? '';
    }

    if (glpiEntityId === null || glpiEntityId <= 0) {
      matchStatus = 'no_entity_mapping';
      matchConfidence = 'none';
    } else if (equipmentTag !== '') {
      // Entity matched + equipment tag present → medium (ticket matching deferred to PHP)
      matchStatus = 'pending_user_review';
      matchConfidence = 'medium';
    } else {
      // Entity matched, no equipment tag → low confidence
      matchStatus = 'pending_user_review';
      matchConfidence = 'low';
    }

    return {
      sessionId,
      hostExternalId,
      groupExternalId,
      groupName,
      hostNameSanitized: hostName,
      sessionStartAt,
      sessionEndAt,
      durationSeconds,
      equipmentTag,
      technicianHash,
      glpiEntityId,
      matchStatus,
      matchConfidence,
      sourceWindowFrom: windowFrom,
      sourceWindowTo: windowTo,
      sourceSnapshotHash,
    };
  }

  private firstString(record: Record<string, unknown>, keys: string[], max: number): string {
    for (const key of keys) {
      const value = sanitizeText(record[key], max);
      if (value !== '') return value;
    }
    return '';
  }

  private firstRaw(record: Record<string, unknown>, keys: string[]): unknown {
    for (const key of keys) {
      if (record[key] !== undefined && record[key] !== null) return record[key];
    }
    return undefined;
  }

  /**
   * Compose the final report endpoint from a hardened origin + an allowlisted path.
   *
   * Security contract:
   *  - The configured baseUrl is reduced to its ORIGIN only (scheme + host[:port]).
   *    Any path / query / hash it carries is discarded — config can never choose
   *    the final path.
   *  - The path is ALWAYS taken from RECONCILIATION_ALLOWED_PATHS (default: the
   *    remote-access-with-groups report).
   *  - The composed URL is re-validated against the allowlist before return.
   *    Anything else (e.g. /hosts/{id}/connection) throws ForbiddenEndpointError.
   *
   * @param path one of RECONCILIATION_ALLOWED_PATHS (defaults to the primary report)
   */
  private reportEndpoint(path: string = RECONCILIATION_REPORT_PATH): string {
    // 1. The requested path MUST be in the allowlist — no exceptions.
    if (!RECONCILIATION_ALLOWED_PATHS.includes(path)) {
      throw new ForbiddenEndpointError(path);
    }

    // 2. Reduce the configured base to ORIGIN ONLY. Discard any path/query/hash.
    const rawBase = this.config.baseUrl ?? RECONCILIATION_BASE_URL;
    let origin: string;
    try {
      const parsed = new URL(rawBase);
      // Only https origins are allowed for the LogMeIn public API.
      if (parsed.protocol !== 'https:') {
        throw new ForbiddenEndpointError(rawBase);
      }
      origin = `${parsed.protocol}//${parsed.host}`;
    } catch (error) {
      if (error instanceof ForbiddenEndpointError) throw error;
      // Unparseable base → fall back to the canonical LogMeIn origin.
      origin = RECONCILIATION_BASE_URL;
    }

    // 3. Compose final URL: origin + allowlisted path. Nothing else.
    const finalUrl = `${origin}${path}`;

    // 4. Re-validate the composed URL: it must end with an allowlisted path and
    //    must NOT contain any forbidden segment. Defence in depth against any
    //    future refactor that might reintroduce a gap.
    const finalPath = new URL(finalUrl).pathname;
    if (!RECONCILIATION_ALLOWED_PATHS.includes(finalPath)) {
      throw new ForbiddenEndpointError(finalUrl);
    }
    for (const forbidden of FORBIDDEN_ENDPOINTS) {
      if (finalUrl.includes(forbidden)) {
        throw new ForbiddenEndpointError(finalUrl);
      }
    }

    return finalUrl;
  }

  private basicAuthHeader(): string {
    return buildBasicAuthHeader(
      this.config.companyId?.trim() ?? '',
      this.config.psk?.trim() ?? '',
    );
  }

  private hasCredentials(): boolean {
    return Boolean(this.config.companyId?.trim()) && Boolean(this.config.psk?.trim());
  }

  private fallback(status: ReconciliationSyncResult['status'], message: string): ReconciliationSyncResult {
    return {
      ok: false,
      status,
      message,
      sessionsFound: 0,
      sessionsInserted: 0,
      sessionsSkippedDuplicate: 0,
      windowFrom: '',
      windowTo: '',
      durationMs: 0,
      reportError: null,
      reportStatusCode: null,
      primaryStatusCode: null,
      fallbackStatusCode: null,
      fallbackUsed: false,
      reportReason: null,
      fallbackSkippedReason: null,
      retryAfterSeconds: null,
      rateLimitCooldownUntil: null,
      lookbackHours: this.timingConfig.lookbackHours,
      lookbackDays: this.timingConfig.lookbackDays,
      chunkMinutes: this.timingConfig.chunkMinutes,
      overlapMinutes: this.timingConfig.overlapMinutes,
      maxRetries: this.timingConfig.maxRetries,
      cooldownSeconds: this.timingConfig.cooldownSeconds,
      circuitOpenUntil: null,
    };
  }

  private async audit(eventType: string, status: 'success' | 'failed', payload: Record<string, unknown>): Promise<void> {
    await this.auditService?.recordAuditEventSafe({
      eventType,
      status,
      severity: status === 'success' ? 'info' : 'warning',
      source: 'LogmeinReconciliationService',
      payload: {
        ...payload,
        read_only: true,
        remote_execution: false,
        post_action_only_reports: true,
      },
    });
  }

  private errorType(error: unknown): string {
    if (error instanceof ForbiddenEndpointError) return 'forbidden_endpoint';
    if (error instanceof ReportApiError) {
      if (error.category === REPORT_ERROR_CATEGORIES.PARSE_FAILED) return 'parse';
      return 'http';
    }
    const message = error instanceof Error ? error.message : String(error);
    if (/LOGMEIN_FORBIDDEN_ENDPOINT/i.test(message)) return 'forbidden_endpoint';
    if (/abort|timeout/i.test(message)) return 'timeout';
    if (/LOGMEIN_REPORT_HTTP_/i.test(message)) return 'http';
    return 'transport';
  }
}
