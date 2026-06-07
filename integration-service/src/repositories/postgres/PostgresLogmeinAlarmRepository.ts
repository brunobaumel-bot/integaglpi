/**
 * PostgresLogmeinAlarmRepository
 *
 * Repositório para as três tabelas do sistema de alarme LogMeIn:
 *   - integaglpi_logmein_alarm_rules    — definição das regras
 *   - integaglpi_logmein_alarm_targets  — hosts monitorados por regra
 *   - integaglpi_logmein_alarm_events   — log de auditoria
 *
 * Nunca grava PII de usuários/perfis/contatos.
 * Nunca acessa MariaDB GLPI diretamente (apenas PostgreSQL de integração).
 *
 * PHASE: integaglpi_logmein_alarm_rules_and_auto_ticket_implementation_001
 */

import type { SqlExecutor } from '../../infra/db/postgres.js';
import type { LogmeinHostContext } from '../../domain/services/LogmeinReadonlyContextService.js';

// ── Table names ───────────────────────────────────────────────────────────────

const ALARM_RULES_TABLE    = 'integaglpi_logmein_alarm_rules';
const ALARM_TARGETS_TABLE  = 'integaglpi_logmein_alarm_targets';
const ALARM_EVENTS_TABLE   = 'integaglpi_logmein_alarm_events';
const ASSET_CACHE_TABLE    = 'glpi_plugin_integaglpi_logmein_asset_cache';

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

export type AlarmType = 'host_offline' | 'host_not_seen_minutes';

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

// ── Mappers ───────────────────────────────────────────────────────────────────

function toRule(row: AlarmRuleRow): LogmeinAlarmRule {
  return {
    id: row.id,
    ruleName: row.rule_name,
    alarmType: row.alarm_type as AlarmType,
    enabled: row.enabled,
    cooldownMinutes: row.cooldown_minutes,
    conditionPayload: typeof row.condition_payload === 'object' && row.condition_payload !== null
      ? row.condition_payload as Record<string, unknown>
      : {},
    glpiEntitiesId: row.glpi_entities_id,
    glpiGroupId: row.glpi_group_id ?? null,
    glpiItilCategoryId: row.glpi_itil_category_id ?? null,
    createTicket: row.create_ticket,
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

// ── Repository ────────────────────────────────────────────────────────────────

export class PostgresLogmeinAlarmRepository {
  public constructor(private readonly executor: SqlExecutor) {}

  // ── Schema check ────────────────────────────────────────────────────────────

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

  // ── Rules CRUD ──────────────────────────────────────────────────────────────

  public async listEnabledRules(): Promise<LogmeinAlarmRule[]> {
    const result = await this.executor.query<AlarmRuleRow>(
      `
        SELECT id, rule_name, alarm_type, enabled, cooldown_minutes,
               condition_payload, glpi_entities_id, glpi_group_id,
               glpi_itil_category_id, create_ticket, created_at, updated_at
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
               glpi_itil_category_id, create_ticket, created_at, updated_at
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
               glpi_itil_category_id, create_ticket, created_at, updated_at
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
           glpi_entities_id, glpi_group_id, glpi_itil_category_id, create_ticket)
        VALUES
          ($1, $2, false, $3, $4::jsonb, $5, $6, $7, $8)
        RETURNING id, rule_name, alarm_type, enabled, cooldown_minutes,
                  condition_payload, glpi_entities_id, glpi_group_id,
                  glpi_itil_category_id, create_ticket, created_at, updated_at
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
    // Build SET clause dynamically — only columns provided are changed.
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

    const result = await this.executor.query<AlarmRuleRow>(
      `
        UPDATE ${ALARM_RULES_TABLE}
        SET ${setClauses.join(', ')}
        WHERE id = $1::uuid
        RETURNING id, rule_name, alarm_type, enabled, cooldown_minutes,
                  condition_payload, glpi_entities_id, glpi_group_id,
                  glpi_itil_category_id, create_ticket, created_at, updated_at
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

  // ── Host status from asset cache ─────────────────────────────────────────────

  /**
   * Retorna o status atual dos hosts pelo host_id.
   * Consulta o cache de ativos LogMeIn no PostgreSQL de integração.
   * Nunca acessa MariaDB GLPI.
   */
  public async getHostsCurrentStatus(hostIds: readonly string[]): Promise<Map<string, LogmeinHostContext>> {
    const map = new Map<string, LogmeinHostContext>();
    if (hostIds.length === 0) return map;

    // Build $1, $2, ... placeholders
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
      }>(
        `
          SELECT logmein_host_external_id, logmein_group_external_id, logmein_group_name,
                 host_name_sanitized, equipment_tag, status, last_seen_at
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
        });
      }
    } catch {
      // Safe degradation — empty map means host status unknown → no alarm
    }

    return map;
  }

  // ── Events ───────────────────────────────────────────────────────────────────

  /**
   * Insere um evento de alarme se o event_hash não existir (dedupe via UNIQUE).
   * Retorna { inserted: true } quando novo, { inserted: false } quando duplicado.
   */
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
}
