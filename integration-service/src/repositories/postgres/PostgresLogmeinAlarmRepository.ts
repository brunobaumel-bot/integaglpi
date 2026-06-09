/**
 * PostgresLogmeinAlarmRepository
 *
 * Repositório para as três tabelas do sistema de alarme LogMeIn:
 *   - integaglpi_logmein_alarm_rules    — definição das regras
 *   - integaglpi_logmein_alarm_targets  — hosts monitorados por regra
 *   - integaglpi_logmein_alarm_events   — log de auditoria
 *
 * Nunca grava PII de usuários/perfis/contatos.
 * Nunca acessa banco de dados do GLPI (MariaDB) — apenas PostgreSQL de integração.
 *
 * PHASE: integaglpi_logmein_alarm_rules_and_auto_ticket_implementation_001
 */

import type { SqlExecutor } from '../../infra/db/postgres.js';
import type { LogmeinHostContext } from '../../domain/services/LogmeinReadonlyContextService.js';

// ── Table names ───────────────────────────────────────────────────────────────

const ALARM_RULES_TABLE   = 'integaglpi_logmein_alarm_rules';
const ALARM_TARGETS_TABLE = 'integaglpi_logmein_alarm_targets';
const ALARM_EVENTS_TABLE  = 'integaglpi_logmein_alarm_events';
const ASSET_CACHE_TABLE   = 'glpi_plugin_integaglpi_logmein_asset_cache';

// ── Alarm type taxonomy ───────────────────────────────────────────────────────

/**
 * Auto-ticket capable (gate duplo: global flag + per-rule flag):
 *   host_offline, host_not_seen, missing_equipment_tag, missing_entity_mapping,
 *   low_disk, low_memory
 *
 * Alert-only (nunca criam ticket, independentemente do flag create_ticket):
 *   hardware_change
 *
 * Forbidden (nunca permitidos nesta fase):
 *   high_cpu, disk_health_smart, network_bandwidth, software_compliance
 */
export type AlarmType =
  | 'host_offline'
  | 'host_not_seen'
  | 'missing_equipment_tag'
  | 'missing_entity_mapping'
  | 'hardware_change'
  | 'low_disk'
  | 'low_memory';

// ── Row types (internal) ──────────────────────────────────────────────────────

interface AlarmRuleRow {
  id: string;
  rule_name: string;
  alarm_type: string;
  enabled: boolean;
  cooldown_minutes: number;
  condition_payload: Record<string, unknown>;
  glpi_entities_id: number;
  glpi_group_id: number | null;
  glpi_itil_category_id: number | null;
  create_ticket: boolean;
  min_consecutive_checks: number;
  consecutive_check_interval_minutes: number;
  created_at: Date;
  updated_at: Date;
}

interface AlarmTargetRow {
  id: string;
  rule_id: string;
  host_id: string;
  hostname: string;
  created_at: Date;
}

interface AlarmEventRow {
  id: string;
  rule_id: string;
  host_id: string;
  hostname: string;
  alarm_type: string;
  event_hash: string;
  glpi_ticket_id: number | null;
  cooldown_skipped: boolean;
  dedupe_hit: boolean;
  created_at: Date;
}

// ── Public DTOs ───────────────────────────────────────────────────────────────

export interface LogmeinAlarmRule {
  id: string;
  ruleName: string;
  alarmType: AlarmType;
  enabled: boolean;
  cooldownMinutes: number;
  conditionPayload: Record<string, unknown>;
  glpiEntitiesId: number;
  glpiGroupId: number | null;
  glpiItilCategoryId: number | null;
  createTicket: boolean;
  /** Only relevant for host_offline. Minimum 2 for auto-ticket. */
  minConsecutiveChecks: number;
  /** Only relevant for host_offline. Minimum 5 minutes. */
  consecutiveCheckIntervalMinutes: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface LogmeinAlarmTarget {
  id: string;
  ruleId: string;
  hostId: string;
  hostname: string;
  createdAt: Date;
}

export interface LogmeinAlarmEvent {
  id: string;
  ruleId: string;
  hostId: string;
  hostname: string;
  alarmType: string;
  eventHash: string;
  glpiTicketId: number | null;
  cooldownSkipped: boolean;
  dedupeHit: boolean;
  createdAt: Date;
}

export interface CreateAlarmRuleInput {
  ruleName: string;
  alarmType: AlarmType;
  cooldownMinutes: number;
  conditionPayload: Record<string, unknown>;
  glpiEntitiesId: number;
  glpiGroupId: number | null;
  glpiItilCategoryId: number | null;
  createTicket: boolean;
  /** For host_offline rules: minimum consecutive offline checks before firing. Default 1. */
  minConsecutiveChecks?: number;
  /** For host_offline rules: minimum minutes between consecutive check counts. Default 5. */
  consecutiveCheckIntervalMinutes?: number;
}

export interface InsertAlarmEventInput {
  ruleId: string;
  hostId: string;
  hostname: string;
  alarmType: string;
  eventHash: string;
  glpiTicketId: number | null;
  cooldownSkipped: boolean;
  dedupeHit: boolean;
}

// ── F2B — Alarm history read-only ────────────────────────────────────────────

/**
 * Derived result type for a recorded alarm event.
 *
 * Derivation rules (applied in priority order, in memory — no DB column):
 *   cooldown_skipped=true            → suppressed_cooldown
 *   dedupe_hit=true                  → suppressed_dedupe
 *   glpi_ticket_id IS NOT NULL       → ticket_created
 *   alarm_type contains 'dry_run'    → dry_run
 *   default                          → fired
 */
export type AlarmResultType =
  | 'fired'
  | 'suppressed_cooldown'
  | 'suppressed_dedupe'
  | 'ticket_created'
  | 'dry_run';

/** Single history entry with derived fields (no new DB columns). */
export interface AlarmHistoryEntry {
  id: string;
  ruleId: string;
  hostId: string;
  hostname: string;
  alarmType: string;
  /** Alias for createdAt — derivado sem coluna nova. */
  firedAt: Date;
  /** Derived in memory — not persisted. */
  resultType: AlarmResultType;
  /** Human-readable reason derived from resultType — no new DB column. */
  reason: string;
  glpiTicketId: number | null;
  eventHash: string;
}

export interface AlarmHistoryPage {
  entries: AlarmHistoryEntry[];
  total: number;
  limit: number;
  offset: number;
}

export interface AlarmHistoryFilters {
  /** Filter by specific rule UUID. */
  ruleId?: string | null;
  /** Filter by LogMeIn host external ID. */
  hostId?: string | null;
  /** Filter by alarm type. */
  alarmType?: AlarmType | null;
  /** Look-back window in days [1, 90]. Default 30. */
  periodDays?: number;
  /** Maximum results per page [1, 200]. Default 50. */
  limit?: number;
  /** Offset for pagination. Default 0. */
  offset?: number;
}

// ── Mapper ────────────────────────────────────────────────────────────────────

function toRule(row: AlarmRuleRow): LogmeinAlarmRule {
  return {
    id: row.id,
    ruleName: row.rule_name,
    alarmType: row.alarm_type as AlarmType,
    enabled: row.enabled,
    cooldownMinutes: row.cooldown_minutes,
    conditionPayload:
      typeof row.condition_payload === 'object' && row.condition_payload !== null
        ? (row.condition_payload as Record<string, unknown>)
        : {},
    glpiEntitiesId: row.glpi_entities_id,
    glpiGroupId: row.glpi_group_id ?? null,
    glpiItilCategoryId: row.glpi_itil_category_id ?? null,
    createTicket: row.create_ticket,
    minConsecutiveChecks: row.min_consecutive_checks ?? 1,
    consecutiveCheckIntervalMinutes: row.consecutive_check_interval_minutes ?? 5,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toTarget(row: AlarmTargetRow): LogmeinAlarmTarget {
  return {
    id: row.id,
    ruleId: row.rule_id,
    hostId: row.host_id,
    hostname: row.hostname,
    createdAt: row.created_at,
  };
}

function toEvent(row: AlarmEventRow): LogmeinAlarmEvent {
  return {
    id: row.id,
    ruleId: row.rule_id,
    hostId: row.host_id,
    hostname: row.hostname,
    alarmType: row.alarm_type,
    eventHash: row.event_hash,
    glpiTicketId: row.glpi_ticket_id ?? null,
    cooldownSkipped: row.cooldown_skipped,
    dedupeHit: row.dedupe_hit,
    createdAt: row.created_at,
  };
}

/**
 * Derive resultType in memory from existing columns — no new DB column.
 * Priority order matches the F2B contract specification.
 */
export function deriveResultType(event: {
  cooldown_skipped: boolean;
  dedupe_hit: boolean;
  glpi_ticket_id: number | null;
  alarm_type: string;
}): AlarmResultType {
  if (event.cooldown_skipped) return 'suppressed_cooldown';
  if (event.dedupe_hit) return 'suppressed_dedupe';
  if (event.glpi_ticket_id !== null) return 'ticket_created';
  if (String(event.alarm_type).includes('dry_run')) return 'dry_run';
  return 'fired';
}

/**
 * Derive a human-readable reason string from the resultType.
 * All text is static — no PII, no ticket content, no user data.
 * Priority order matches deriveResultType().
 */
export function deriveReason(
  resultType: AlarmResultType,
  glpiTicketId: number | null,
): string {
  switch (resultType) {
    case 'suppressed_cooldown':
      return 'Evento suprimido por cooldown.';
    case 'suppressed_dedupe':
      return 'Evento suprimido por deduplicação.';
    case 'ticket_created':
      return glpiTicketId !== null
        ? `Evento associado ao ticket GLPI ${glpiTicketId}.`
        : 'Evento associado ao ticket GLPI informado.';
    case 'dry_run':
      return 'Execução em modo simulação/dry-run.';
    case 'fired':
      return 'Evento de alarme registrado.';
    default:
      return 'Evento registrado.';
  }
}

function toHistoryEntry(row: AlarmEventRow): AlarmHistoryEntry {
  const resultType = deriveResultType(row);
  return {
    id: row.id,
    ruleId: row.rule_id,
    hostId: row.host_id,
    hostname: row.hostname,
    alarmType: row.alarm_type,
    firedAt: row.created_at,
    resultType,
    reason: deriveReason(resultType, row.glpi_ticket_id ?? null),
    glpiTicketId: row.glpi_ticket_id ?? null,
    eventHash: row.event_hash,
  };
}

// ── Repository ────────────────────────────────────────────────────────────────

export class PostgresLogmeinAlarmRepository {
  public constructor(private readonly executor: SqlExecutor) {}

  // ── Schema ─────────────────────────────────────────────────────────────────

  public async isSchemaReady(): Promise<boolean> {
    const result = await this.executor.query<{ ready: boolean }>(
      `
        SELECT
          to_regclass($1::text) IS NOT NULL
          AND to_regclass($2::text) IS NOT NULL
          AND to_regclass($3::text) IS NOT NULL AS ready
      `,
      [
        `public.${ALARM_RULES_TABLE}`,
        `public.${ALARM_TARGETS_TABLE}`,
        `public.${ALARM_EVENTS_TABLE}`,
      ],
    );
    return result.rows[0]?.ready === true;
  }

  // ── Rules ──────────────────────────────────────────────────────────────────

  public async listEnabledRules(): Promise<LogmeinAlarmRule[]> {
    const result = await this.executor.query<AlarmRuleRow>(
      `
        SELECT id, rule_name, alarm_type, enabled, cooldown_minutes,
               condition_payload, glpi_entities_id, glpi_group_id,
               glpi_itil_category_id, create_ticket,
               COALESCE(min_consecutive_checks, 1) AS min_consecutive_checks,
               COALESCE(consecutive_check_interval_minutes, 5) AS consecutive_check_interval_minutes,
               created_at, updated_at
        FROM ${ALARM_RULES_TABLE}
        WHERE enabled = true
        ORDER BY created_at ASC
      `,
    );
    return result.rows.map(toRule);
  }

  public async listAllRules(): Promise<LogmeinAlarmRule[]> {
    const result = await this.executor.query<AlarmRuleRow>(
      `
        SELECT id, rule_name, alarm_type, enabled, cooldown_minutes,
               condition_payload, glpi_entities_id, glpi_group_id,
               glpi_itil_category_id, create_ticket,
               COALESCE(min_consecutive_checks, 1) AS min_consecutive_checks,
               COALESCE(consecutive_check_interval_minutes, 5) AS consecutive_check_interval_minutes,
               created_at, updated_at
        FROM ${ALARM_RULES_TABLE}
        ORDER BY created_at ASC
      `,
    );
    return result.rows.map(toRule);
  }

  public async getRuleById(id: string): Promise<LogmeinAlarmRule | null> {
    const result = await this.executor.query<AlarmRuleRow>(
      `
        SELECT id, rule_name, alarm_type, enabled, cooldown_minutes,
               condition_payload, glpi_entities_id, glpi_group_id,
               glpi_itil_category_id, create_ticket,
               COALESCE(min_consecutive_checks, 1) AS min_consecutive_checks,
               COALESCE(consecutive_check_interval_minutes, 5) AS consecutive_check_interval_minutes,
               created_at, updated_at
        FROM ${ALARM_RULES_TABLE}
        WHERE id = $1::uuid
      `,
      [id],
    );
    const row = result.rows[0];
    return row != null ? toRule(row) : null;
  }

  public async createRule(input: CreateAlarmRuleInput): Promise<LogmeinAlarmRule> {
    const result = await this.executor.query<AlarmRuleRow>(
      `
        INSERT INTO ${ALARM_RULES_TABLE}
          (rule_name, alarm_type, enabled, cooldown_minutes, condition_payload,
           glpi_entities_id, glpi_group_id, glpi_itil_category_id, create_ticket,
           min_consecutive_checks, consecutive_check_interval_minutes)
        VALUES
          ($1, $2, false, $3, $4::jsonb, $5, $6, $7, $8, $9, $10)
        RETURNING id, rule_name, alarm_type, enabled, cooldown_minutes,
                  condition_payload, glpi_entities_id, glpi_group_id,
                  glpi_itil_category_id, create_ticket,
                  COALESCE(min_consecutive_checks, 1) AS min_consecutive_checks,
                  COALESCE(consecutive_check_interval_minutes, 5) AS consecutive_check_interval_minutes,
                  created_at, updated_at
      `,
      [
        input.ruleName,
        input.alarmType,
        input.cooldownMinutes,
        JSON.stringify(input.conditionPayload),
        input.glpiEntitiesId,
        input.glpiGroupId,
        input.glpiItilCategoryId,
        input.createTicket,
        input.minConsecutiveChecks ?? 1,
        input.consecutiveCheckIntervalMinutes ?? 5,
      ],
    );
    const row = result.rows[0];
    if (row == null) {
      throw new Error('[logmein_alarm] createRule: INSERT returned no row.');
    }
    return toRule(row);
  }

  public async updateRule(
    id: string,
    input: Partial<Omit<CreateAlarmRuleInput, 'alarmType'>> & { enabled?: boolean },
  ): Promise<LogmeinAlarmRule | null> {
    const setClauses: string[] = ['updated_at = NOW()'];
    const params: unknown[] = [id];
    let idx = 2;

    if (input.ruleName !== undefined) {
      setClauses.push(`rule_name = $${idx++}::text`);
      params.push(input.ruleName);
    }
    if (input.enabled !== undefined) {
      setClauses.push(`enabled = $${idx++}::boolean`);
      params.push(input.enabled);
    }
    if (input.cooldownMinutes !== undefined) {
      setClauses.push(`cooldown_minutes = $${idx++}::int`);
      params.push(input.cooldownMinutes);
    }
    if (input.conditionPayload !== undefined) {
      setClauses.push(`condition_payload = $${idx++}::jsonb`);
      params.push(JSON.stringify(input.conditionPayload));
    }
    if (input.glpiEntitiesId !== undefined) {
      setClauses.push(`glpi_entities_id = $${idx++}::int`);
      params.push(input.glpiEntitiesId);
    }
    if (input.glpiGroupId !== undefined) {
      setClauses.push(`glpi_group_id = $${idx++}`);
      params.push(input.glpiGroupId);
    }
    if (input.glpiItilCategoryId !== undefined) {
      setClauses.push(`glpi_itil_category_id = $${idx++}`);
      params.push(input.glpiItilCategoryId);
    }
    if (input.createTicket !== undefined) {
      setClauses.push(`create_ticket = $${idx++}::boolean`);
      params.push(input.createTicket);
    }
    if (input.minConsecutiveChecks !== undefined) {
      setClauses.push(`min_consecutive_checks = $${idx++}::int`);
      params.push(input.minConsecutiveChecks);
    }
    if (input.consecutiveCheckIntervalMinutes !== undefined) {
      setClauses.push(`consecutive_check_interval_minutes = $${idx++}::int`);
      params.push(input.consecutiveCheckIntervalMinutes);
    }

    const result = await this.executor.query<AlarmRuleRow>(
      `
        UPDATE ${ALARM_RULES_TABLE}
        SET ${setClauses.join(', ')}
        WHERE id = $1::uuid
        RETURNING id, rule_name, alarm_type, enabled, cooldown_minutes,
                  condition_payload, glpi_entities_id, glpi_group_id,
                  glpi_itil_category_id, create_ticket,
                  COALESCE(min_consecutive_checks, 1) AS min_consecutive_checks,
                  COALESCE(consecutive_check_interval_minutes, 5) AS consecutive_check_interval_minutes,
                  created_at, updated_at
      `,
      params,
    );
    const row = result.rows[0];
    return row != null ? toRule(row) : null;
  }

  public async deleteRule(id: string): Promise<boolean> {
    const result = await this.executor.query<{ id: string }>(
      `DELETE FROM ${ALARM_RULES_TABLE} WHERE id = $1::uuid RETURNING id`,
      [id],
    );
    return (result.rows.length ?? 0) > 0;
  }

  // ── Targets ─────────────────────────────────────────────────────────────────

  public async listTargetsForRule(ruleId: string): Promise<LogmeinAlarmTarget[]> {
    const result = await this.executor.query<AlarmTargetRow>(
      `
        SELECT id, rule_id, host_id, hostname, created_at
        FROM ${ALARM_TARGETS_TABLE}
        WHERE rule_id = $1::uuid
        ORDER BY hostname ASC
      `,
      [ruleId],
    );
    return result.rows.map(toTarget);
  }

  public async addTarget(ruleId: string, hostId: string, hostname: string): Promise<LogmeinAlarmTarget> {
    const result = await this.executor.query<AlarmTargetRow>(
      `
        INSERT INTO ${ALARM_TARGETS_TABLE} (rule_id, host_id, hostname)
        VALUES ($1::uuid, $2::text, $3::text)
        ON CONFLICT (rule_id, host_id) DO UPDATE SET hostname = EXCLUDED.hostname
        RETURNING id, rule_id, host_id, hostname, created_at
      `,
      [ruleId, hostId, hostname],
    );
    const row = result.rows[0];
    if (row == null) {
      throw new Error('[logmein_alarm] addTarget: INSERT returned no row.');
    }
    return toTarget(row);
  }

  public async removeTarget(ruleId: string, hostId: string): Promise<boolean> {
    const result = await this.executor.query<{ id: string }>(
      `
        DELETE FROM ${ALARM_TARGETS_TABLE}
        WHERE rule_id = $1::uuid AND host_id = $2::text
        RETURNING id
      `,
      [ruleId, hostId],
    );
    return (result.rows.length ?? 0) > 0;
  }

  // ── Host status ─────────────────────────────────────────────────────────────

  public async getHostsCurrentStatus(hostIds: readonly string[]): Promise<Map<string, LogmeinHostContext>> {
    const map = new Map<string, LogmeinHostContext>();
    if (hostIds.length === 0) return map;

    const placeholders = hostIds.map((_, i) => `$${i + 1}::text`).join(', ');
    try {
      const result = await this.executor.query<{
        logmein_host_external_id: string;
        logmein_group_external_id: string;
        logmein_group_name: string;
        host_name_sanitized: string;
        equipment_tag: string | null;
        status: string | null;
        last_seen_at: string | Date | null;
        glpi_entity_candidate_id: number | null;
      }>(
        `
          SELECT logmein_host_external_id, logmein_group_external_id, logmein_group_name,
                 host_name_sanitized, equipment_tag, status, last_seen_at,
                 glpi_entity_candidate_id
          FROM ${ASSET_CACHE_TABLE}
          WHERE logmein_host_external_id IN (${placeholders})
        `,
        [...hostIds],
      );

      for (const row of result.rows) {
        const rawStatus = String(row.status ?? '').toLowerCase();
        const status: LogmeinHostContext['status'] =
          rawStatus === 'online' || rawStatus === 'offline' ? rawStatus : 'unknown';
        const lastSeenAt =
          row.last_seen_at instanceof Date
            ? row.last_seen_at.toISOString()
            : typeof row.last_seen_at === 'string'
              ? row.last_seen_at
              : null;

        map.set(row.logmein_host_external_id, {
          externalId: row.logmein_host_external_id,
          groupExternalId: row.logmein_group_external_id,
          groupName: row.logmein_group_name,
          hostName: row.host_name_sanitized,
          equipmentTag: row.equipment_tag ?? '',
          status,
          lastSeenAt,
          glpiEntityCandidateId: typeof row.glpi_entity_candidate_id === 'number' ? row.glpi_entity_candidate_id : null,
        });
      }
    } catch {
      // Safe degradation — empty map → status unknown → no alarm
    }

    return map;
  }

  // ── Events ───────────────────────────────────────────────────────────────────

  public async insertEventIfNew(input: InsertAlarmEventInput): Promise<{ inserted: boolean }> {
    const result = await this.executor.query<{ id: string }>(
      `
        INSERT INTO ${ALARM_EVENTS_TABLE}
          (rule_id, host_id, hostname, alarm_type, event_hash,
           glpi_ticket_id, cooldown_skipped, dedupe_hit)
        VALUES
          ($1::uuid, $2::text, $3::text, $4::text, $5::text,
           $6, $7::boolean, $8::boolean)
        ON CONFLICT (event_hash) DO NOTHING
        RETURNING id
      `,
      [
        input.ruleId,
        input.hostId,
        input.hostname,
        input.alarmType,
        input.eventHash,
        input.glpiTicketId,
        input.cooldownSkipped,
        input.dedupeHit,
      ],
    );
    return { inserted: (result.rows.length ?? 0) > 0 };
  }

  public async listRecentEvents(ruleId: string, limit: number): Promise<LogmeinAlarmEvent[]> {
    const safeLimit = Math.max(1, Math.min(limit, 500));
    const result = await this.executor.query<AlarmEventRow>(
      `
        SELECT id, rule_id, host_id, hostname, alarm_type, event_hash,
               glpi_ticket_id, cooldown_skipped, dedupe_hit, created_at
        FROM ${ALARM_EVENTS_TABLE}
        WHERE rule_id = $1::uuid
        ORDER BY created_at DESC
        LIMIT $2::int
      `,
      [ruleId, safeLimit],
    );
    return result.rows.map(toEvent);
  }

  // ── F2B — Alarm history (paginated, multi-filter) ─────────────────────────

  /**
   * Paginated alarm history with optional filters.
   *
   * Safety invariants (F2B):
   *   - Read-only: no INSERT / UPDATE / DELETE.
   *   - resultType derived in memory — no new DB column.
   *   - firedAt is an alias for created_at — no schema change.
   *   - Parameterised SQL only — no string interpolation for user values.
   *   - glpiTicketId included for correlation (no PII — ticket ID is not PII).
   *   - hostname is sanitized by the ingest pipeline; logged here as-is.
   */
  public async listAlarmHistory(filters: AlarmHistoryFilters = {}): Promise<AlarmHistoryPage> {
    const periodDays = Math.max(1, Math.min(filters.periodDays ?? 30, 90));
    const limit = Math.max(1, Math.min(filters.limit ?? 50, 200));
    const offset = Math.max(0, filters.offset ?? 0);

    // Build dynamic WHERE clauses with parameterised values.
    const params: unknown[] = [`${periodDays} days`]; // $1
    const conditions: string[] = [`created_at >= NOW() - $1::interval`];

    if (filters.ruleId != null) {
      params.push(filters.ruleId);
      conditions.push(`rule_id = $${params.length}::uuid`);
    }
    if (filters.hostId != null) {
      params.push(filters.hostId);
      conditions.push(`host_id = $${params.length}::text`);
    }
    if (filters.alarmType != null) {
      params.push(filters.alarmType);
      conditions.push(`alarm_type = $${params.length}::text`);
    }

    const where = conditions.join(' AND ');

    const countResult = await this.executor.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total FROM ${ALARM_EVENTS_TABLE} WHERE ${where}`,
      params,
    );
    const total = parseInt(countResult.rows[0]?.total ?? '0', 10);

    const dataParams = [...params, limit, offset];
    const dataResult = await this.executor.query<AlarmEventRow>(
      `
        SELECT id, rule_id, host_id, hostname, alarm_type, event_hash,
               glpi_ticket_id, cooldown_skipped, dedupe_hit, created_at
        FROM ${ALARM_EVENTS_TABLE}
        WHERE ${where}
        ORDER BY created_at DESC
        LIMIT $${params.length + 1}::int
        OFFSET $${params.length + 2}::int
      `,
      dataParams,
    );

    return {
      entries: dataResult.rows.map(toHistoryEntry),
      total,
      limit,
      offset,
    };
  }

  /**
   * Aggregate alarm events by alarm_type within a sliding time window.
   * Used by F4 LogmeinAlarmCorrelationService — read-only, no schema change.
   *
   * Safety invariants:
   *   - Read-only SELECT only.
   *   - No PII: returns alarm_type (enum-like string), counts, and timestamps.
   *   - No new DB column.
   *   - HAVING COUNT(*) >= 2 filters out single-event types.
   *
   * Phase: integaglpi_v9_alarm_correlation_001 — F4
   */
  public async listCorrelationAggregates(
    windowMinutes: number,
    limit: number,
  ): Promise<CorrelationAggregate[]> {
    const safeWindow = Math.max(1, Math.min(windowMinutes, 10_080)); // 1m..7d
    const safeLimit = Math.max(1, Math.min(limit, 100));

    const result = await this.executor.query<{
      alarm_type: string;
      total_events: string;
      distinct_hosts: string;
      first_event: Date;
      last_event: Date;
      cooldown_skipped_count: string;
      dedupe_hit_count: string;
      ticket_created_count: string;
    }>(
      `
        SELECT
          alarm_type,
          COUNT(*)::text                                                  AS total_events,
          COUNT(DISTINCT host_id)::text                                   AS distinct_hosts,
          MIN(created_at)                                                 AS first_event,
          MAX(created_at)                                                 AS last_event,
          SUM(CASE WHEN cooldown_skipped THEN 1 ELSE 0 END)::text        AS cooldown_skipped_count,
          SUM(CASE WHEN dedupe_hit THEN 1 ELSE 0 END)::text              AS dedupe_hit_count,
          COUNT(CASE WHEN glpi_ticket_id IS NOT NULL THEN 1 END)::text   AS ticket_created_count
        FROM ${ALARM_EVENTS_TABLE}
        WHERE created_at >= NOW() - ($1::int * INTERVAL '1 minute')
        GROUP BY alarm_type
        HAVING COUNT(*) >= 2
        ORDER BY COUNT(*) DESC
        LIMIT $2::int
      `,
      [safeWindow, safeLimit],
    );

    return result.rows.map((row) => ({
      alarmType: row.alarm_type,
      totalEvents: parseInt(row.total_events, 10),
      distinctHosts: parseInt(row.distinct_hosts, 10),
      firstEvent: row.first_event,
      lastEvent: row.last_event,
      cooldownSkippedCount: parseInt(row.cooldown_skipped_count, 10),
      dedupeHitCount: parseInt(row.dedupe_hit_count, 10),
      ticketCreatedCount: parseInt(row.ticket_created_count, 10),
    }));
  }
}

// ── F4 Correlation types (exported for LogmeinAlarmCorrelationService) ────────

export interface CorrelationAggregate {
  alarmType: string;
  totalEvents: number;
  distinctHosts: number;
  firstEvent: Date;
  lastEvent: Date;
  cooldownSkippedCount: number;
  dedupeHitCount: number;
  ticketCreatedCount: number;
}
