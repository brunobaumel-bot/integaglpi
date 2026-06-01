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
    | 'completed'
    | 'failed';
  message: string;
  sessionsFound: number;
  sessionsInserted: number;
  sessionsSkippedDuplicate: number;
  windowFrom: string;
  windowTo: string;
  durationMs: number;
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
  }): Promise<void>;
}

// ── Default configuration ─────────────────────────────────────────────────────
const DEFAULT_TIMEOUT_MS = 15_000;  // report API can be slower than sync API
const DEFAULT_LOOKBACK_DAYS = 7;
const MAX_PAGES = 5;                 // max 5 pages × 500 items = 2500 sessions/run
const PAGE_SIZE = 500;
const LOCK_KEY = 'logmein_reconciliation_sync';

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

  public constructor(
    private readonly config: LogmeinReadonlyConfig & {
      reconciliationEnabled?: boolean;
      lookbackDays?: number;
    },
    private readonly auditService?: AuditService,
    private readonly repository?: LogmeinReconciliationRepository,
    private readonly syncLock?: LogmeinSyncLockAdapter,
  ) {}

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

    const lookbackDays = Math.max(1, Math.min(90, this.config.lookbackDays ?? DEFAULT_LOOKBACK_DAYS));
    const windowTo = overrideWindowTo ?? new Date();
    const windowFrom = overrideWindowFrom ?? new Date(windowTo.getTime() - lookbackDays * 86_400_000);
    const windowFromStr = isoDateString(windowFrom);
    const windowToStr = isoDateString(windowTo);

    await this.repository.insertReconciliationAudit({
      status: 'started',
      sessionsFound: 0,
      sessionsInserted: 0,
      windowFrom: windowFromStr,
      windowTo: windowToStr,
    });
    await this.audit('LOGMEIN_SESSION_SYNC_STARTED', 'success', {
      window_from: windowFromStr,
      window_to: windowToStr,
      lookback_days: lookbackDays,
    });

    try {
      const rawSessions = await this.fetchAllSessionPages(windowFrom, windowTo);
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
      });
      await this.audit('LOGMEIN_SESSION_SYNC_COMPLETED', 'success', {
        sessions_found: rawSessions.length,
        sessions_inserted: inserted,
        sessions_skipped: skipped,
        duration_ms: durationMs,
        window_from: windowFromStr,
        window_to: windowToStr,
      });

      return {
        ok: true,
        status: 'completed',
        message: '',
        sessionsFound: rawSessions.length,
        sessionsInserted: inserted,
        sessionsSkippedDuplicate: skipped,
        windowFrom: windowFromStr,
        windowTo: windowToStr,
        durationMs,
      };
    } catch (error: unknown) {
      const durationMs = Date.now() - startMs;
      const errorMessage = sanitizeText(error instanceof Error ? error.message : String(error), 240);
      await this.repository.insertReconciliationAudit({
        status: 'failed',
        sessionsFound: 0,
        sessionsInserted: 0,
        windowFrom: windowFromStr,
        windowTo: windowToStr,
        errorMessageSanitized: errorMessage,
        durationMs,
      });
      await this.audit('LOGMEIN_SESSION_SYNC_FAILED', 'failed', {
        error_type: this.errorType(error),
        duration_ms: durationMs,
        window_from: windowFromStr,
        window_to: windowToStr,
      });
      return {
        ok: false,
        status: 'failed',
        message: 'Conciliação LogMeIn temporariamente indisponível.',
        sessionsFound: 0,
        sessionsInserted: 0,
        sessionsSkippedDuplicate: 0,
        windowFrom: windowFromStr,
        windowTo: windowToStr,
        durationMs,
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

  private async fetchAllSessionPages(from: Date, to: Date): Promise<Record<string, unknown>[]> {
    const allItems: Record<string, unknown>[] = [];
    const url = this.reportEndpoint();
    const authHeader = this.basicAuthHeader();
    const body = {
      from: from.toISOString(),
      to: to.toISOString(),
      count: PAGE_SIZE,
    };

    for (let page = 0; page < MAX_PAGES; page++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS);

      let response: Response;
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
      } finally {
        clearTimeout(timeout);
      }

      if (!response.ok) {
        throw new Error(`LOGMEIN_REPORT_HTTP_${response.status}`);
      }

      const raw = await response.json() as unknown;
      const items = this.extractItems(raw);
      allItems.push(...items);

      // Stop if page is not full (no more pages).
      if (items.length < PAGE_SIZE) break;
    }

    return allItems;
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
    const message = error instanceof Error ? error.message : String(error);
    if (/LOGMEIN_FORBIDDEN_ENDPOINT/i.test(message)) return 'forbidden_endpoint';
    if (/abort|timeout/i.test(message)) return 'timeout';
    if (/LOGMEIN_REPORT_HTTP_/i.test(message)) return 'http';
    return 'transport';
  }
}
