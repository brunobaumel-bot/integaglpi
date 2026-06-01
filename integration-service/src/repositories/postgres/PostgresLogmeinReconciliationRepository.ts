import type { SqlExecutor } from '../../infra/db/postgres.js';
import type {
  LogmeinReconciliationRepository,
  MatchStatus,
  QueueItem,
  QueuePage,
  RemoteAccessSession,
} from '../../domain/services/LogmeinReconciliationService.js';
import { MATCH_STATUSES } from '../../domain/services/LogmeinReconciliationService.js';

const SESSIONS_TABLE = 'glpi_plugin_integaglpi_logmein_remote_sessions';
const QUEUE_TABLE = 'glpi_plugin_integaglpi_logmein_regularization_queue';
const ASSET_CACHE_TABLE = 'glpi_plugin_integaglpi_logmein_asset_cache';
const GROUP_MAP_TABLE = 'glpi_plugin_integaglpi_logmein_group_maps';
const SYNC_AUDIT_TABLE = 'glpi_plugin_integaglpi_logmein_sync_audit';

const QUEUE_ITEM_LIMIT = 50;
const QUEUE_MAX_PAGE = 200;

function tableRegclass(table: string): string {
  return `public.${table}`;
}

function safeMatchStatus(value: unknown): MatchStatus {
  const s = String(value ?? '');
  return (MATCH_STATUSES as readonly string[]).includes(s) ? (s as MatchStatus) : 'pending_user_review';
}

export class PostgresLogmeinReconciliationRepository implements LogmeinReconciliationRepository {
  public constructor(private readonly executor: SqlExecutor) {}

  public async isSchemaReady(): Promise<boolean> {
    const result = await this.safeQuery<{ ready: boolean }>(
      `
        SELECT
          to_regclass($1::text) IS NOT NULL
          AND to_regclass($2::text) IS NOT NULL
          AND to_regclass($3::text) IS NOT NULL AS ready
      `,
      [tableRegclass(SESSIONS_TABLE), tableRegclass(QUEUE_TABLE), tableRegclass(ASSET_CACHE_TABLE)],
    );
    return result[0]?.ready === true;
  }

  public async upsertSession(session: RemoteAccessSession): Promise<{ inserted: boolean }> {
    const result = await this.safeQuery<{ inserted: boolean }>(
      `
        INSERT INTO ${SESSIONS_TABLE} (
          session_id, host_external_id, group_external_id, group_name, host_name_sanitized,
          session_start_at, session_end_at, duration_seconds, equipment_tag,
          glpi_entity_id, technician_hash, match_status, match_confidence,
          source_window_from, source_window_to, source_snapshot_hash, updated_at
        )
        VALUES (
          $1::text, $2::text, $3::text, $4::text, $5::text,
          NULLIF($6::text,'')::timestamptz, NULLIF($7::text,'')::timestamptz, $8::int, NULLIF($9::text,''),
          NULLIF($10::text,'')::bigint, NULLIF($11::text,''),
          $12::text, $13::text,
          NULLIF($14::text,'')::date, NULLIF($15::text,'')::date, $16::text, NOW()
        )
        ON CONFLICT (session_id) DO NOTHING
        RETURNING TRUE AS inserted
      `,
      [
        session.sessionId,
        session.hostExternalId,
        session.groupExternalId,
        session.groupName,
        session.hostNameSanitized,
        session.sessionStartAt ?? '',
        session.sessionEndAt ?? '',
        session.durationSeconds,
        session.equipmentTag,
        session.glpiEntityId !== null ? String(session.glpiEntityId) : '',
        session.technicianHash ?? '',
        session.matchStatus,
        session.matchConfidence,
        session.sourceWindowFrom,
        session.sourceWindowTo,
        session.sourceSnapshotHash,
      ],
    );
    return { inserted: result.length > 0 };
  }

  public async upsertQueueItem(sessionId: string, status: MatchStatus, entityId: number | null): Promise<void> {
    await this.safeQuery(
      `
        INSERT INTO ${QUEUE_TABLE} (session_id, status, glpi_entity_id, updated_at)
        VALUES ($1::text, $2::text, NULLIF($3::text,'')::bigint, NOW())
        ON CONFLICT (session_id) DO NOTHING
      `,
      [sessionId, status, entityId !== null ? String(entityId) : ''],
    );
  }

  public async getEntityForGroup(groupExternalId: string): Promise<number | null> {
    const rows = await this.safeQuery<{ glpi_entity_id: string }>(
      `
        SELECT glpi_entity_id::text
        FROM ${GROUP_MAP_TABLE}
        WHERE logmein_group_external_id = $1::text
          AND is_active = TRUE
        ORDER BY confidence_score DESC, updated_at DESC
        LIMIT 1
      `,
      [groupExternalId],
    );
    const value = rows[0]?.glpi_entity_id;
    return value ? parseInt(value, 10) || null : null;
  }

  public async getEquipmentTagForHost(hostExternalId: string): Promise<string | null> {
    const rows = await this.safeQuery<{ equipment_tag: string | null }>(
      `
        SELECT equipment_tag
        FROM ${ASSET_CACHE_TABLE}
        WHERE logmein_host_external_id = $1::text
        LIMIT 1
      `,
      [hostExternalId],
    );
    const tag = rows[0]?.equipment_tag ?? null;
    return tag && /^\d{4}$/.test(tag) ? tag : null;
  }

  public async listQueue(input: {
    status?: string;
    entityId?: number;
    page: number;
    limit: number;
  }): Promise<QueuePage> {
    const limit = Math.min(QUEUE_ITEM_LIMIT, Math.max(1, input.limit));
    const page = Math.min(QUEUE_MAX_PAGE, Math.max(1, input.page));
    const offset = (page - 1) * limit;

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (input.status && (MATCH_STATUSES as readonly string[]).includes(input.status)) {
      conditions.push(`q.status = $${params.length + 1}::text`);
      params.push(input.status);
    }
    if (input.entityId !== undefined && input.entityId > 0) {
      conditions.push(`q.glpi_entity_id = $${params.length + 1}::bigint`);
      params.push(input.entityId);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRows = await this.safeQuery<{ total: string }>(
      `SELECT COUNT(*)::text AS total FROM ${QUEUE_TABLE} q ${where}`,
      params,
    );
    const total = parseInt(countRows[0]?.total ?? '0', 10);

    const rows = await this.safeQuery<{
      id: string;
      session_id: string;
      status: string;
      glpi_entity_id: string | null;
      glpi_ticket_id: string | null;
      glpi_task_id: string | null;
      session_start_at: string | null;
      duration_seconds: string;
      group_name: string;
      host_name_sanitized: string;
      equipment_tag: string | null;
      match_confidence: string | null;
      q_created_at: string;
    }>(
      `
        SELECT
          q.id::text,
          q.session_id,
          q.status,
          q.glpi_entity_id::text,
          q.glpi_ticket_id::text,
          q.glpi_task_id::text,
          s.session_start_at::text,
          s.duration_seconds::text,
          s.group_name,
          s.host_name_sanitized,
          s.equipment_tag,
          s.match_confidence,
          q.created_at::text AS q_created_at
        FROM ${QUEUE_TABLE} q
        JOIN ${SESSIONS_TABLE} s ON s.session_id = q.session_id
        ${where}
        ORDER BY q.created_at DESC
        LIMIT $${params.length + 1}::int OFFSET $${params.length + 2}::int
      `,
      [...params, limit, offset],
    );

    const items: QueueItem[] = rows.map((row) => ({
      id: parseInt(row.id, 10),
      sessionId: row.session_id,
      status: safeMatchStatus(row.status),
      glpiEntityId: row.glpi_entity_id ? parseInt(row.glpi_entity_id, 10) : null,
      glpiTicketId: row.glpi_ticket_id ? parseInt(row.glpi_ticket_id, 10) : null,
      glpiTaskId: row.glpi_task_id ? parseInt(row.glpi_task_id, 10) : null,
      sessionStartAt: row.session_start_at,
      durationSeconds: parseInt(row.duration_seconds ?? '0', 10),
      groupName: row.group_name,
      hostNameSanitized: row.host_name_sanitized,
      equipmentTag: row.equipment_tag ?? '',
      matchConfidence: row.match_confidence ?? 'none',
      createdAt: row.q_created_at,
    }));

    return { items, total, page, limit, hasNext: offset + items.length < total };
  }

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
    const result = await this.safeQuery<{ id: string }>(
      `
        UPDATE ${QUEUE_TABLE}
        SET
          status                   = $2::text,
          glpi_ticket_id           = NULLIF($3::text,'')::bigint,
          glpi_task_id             = NULLIF($4::text,'')::bigint,
          resolved_by_glpi_user_id = NULLIF($5::text,'')::bigint,
          resolved_at              = NOW(),
          resolution_note          = NULLIF($6::text,''),
          updated_at               = NOW()
        WHERE id = $1::bigint
        RETURNING id::text
      `,
      [
        id,
        input.status,
        input.ticketId ? String(input.ticketId) : '',
        input.taskId ? String(input.taskId) : '',
        input.userId > 0 ? String(input.userId) : '',
        input.note ?? '',
      ],
    );

    // Also update the ledger row.
    if (result.length > 0) {
      await this.safeQuery(
        `
          UPDATE ${SESSIONS_TABLE}
          SET match_status = $2::text,
              glpi_ticket_id = NULLIF($3::text,'')::bigint,
              updated_at = NOW()
          WHERE session_id = (SELECT session_id FROM ${QUEUE_TABLE} WHERE id = $1::bigint LIMIT 1)
        `,
        [
          id,
          input.status,
          input.ticketId ? String(input.ticketId) : '',
        ],
      );
    }

    return result.length > 0;
  }

  public async insertReconciliationAudit(input: {
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
  }): Promise<void> {
    const eventType = input.status === 'started'
      ? 'LOGMEIN_SESSION_SYNC_STARTED'
      : input.status === 'completed'
        ? 'LOGMEIN_SESSION_SYNC_COMPLETED'
        : 'LOGMEIN_SESSION_SYNC_FAILED';

    await this.safeQuery(
      `
        INSERT INTO ${SYNC_AUDIT_TABLE} (
          event_type, status, severity, payload_json, created_at
        )
        VALUES ($1::text, $2::text, $3::text, $4::jsonb, NOW())
      `,
      [
        eventType,
        input.status,
        input.status === 'failed' ? 'warning' : 'info',
        JSON.stringify({
          sessions_found: input.sessionsFound,
          sessions_inserted: input.sessionsInserted,
          window_from: input.windowFrom,
          window_to: input.windowTo,
          error_message_sanitized: input.errorMessageSanitized ?? null,
          duration_ms: input.durationMs ?? null,
          report_error: input.reportError ?? null,
          report_status_code: input.reportStatusCode ?? null,
          primary_status_code: input.primaryStatusCode ?? null,
          fallback_status_code: input.fallbackStatusCode ?? null,
          fallback_used: input.fallbackUsed ?? false,
          report_path_label: input.reportPathLabel ?? null,
          report_reason: input.reportReason ?? null,
          chunks_requested: input.chunksRequested ?? null,
          chunk_minutes: input.chunkMinutes ?? null,
          max_chunk_hours: input.maxChunkHours ?? null,
          overlap_minutes: input.overlapMinutes ?? null,
          retries_performed: input.retriesPerformed ?? null,
          max_retries: input.maxRetries ?? null,
          lookback_hours: input.lookbackHours ?? null,
          lookback_days: input.lookbackDays ?? null,
          cooldown_seconds: input.cooldownSeconds ?? null,
          circuit_open_until: input.circuitOpenUntil ?? null,
          read_only: true,
          remote_execution: false,
          post_action_only_reports: true,
        }),
      ],
    );
  }

  private async safeQuery<T extends Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
    try {
      const result = await this.executor.query<T>(sql, params);
      return Array.isArray(result.rows) ? result.rows : [];
    } catch {
      return [];
    }
  }
}
