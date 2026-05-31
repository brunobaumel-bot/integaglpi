import type { SqlExecutor } from '../../infra/db/postgres.js';
import type { LogmeinHealthSummary, LogmeinHostContext, LogmeinReadonlyCacheRepository } from '../../domain/services/LogmeinReadonlyContextService.js';
import { LOGMEIN_HEALTH_THRESHOLDS } from '../../domain/services/LogmeinReadonlyContextService.js';

const ASSET_CACHE_TABLE = 'glpi_plugin_integaglpi_logmein_asset_cache';
const GROUP_MAP_TABLE = 'glpi_plugin_integaglpi_logmein_group_maps';
const SYNC_AUDIT_TABLE = 'glpi_plugin_integaglpi_logmein_sync_audit';
const HOST_UPSERT_BATCH_SIZE = 100;

interface HostRow {
  logmein_host_external_id: string;
  logmein_group_external_id: string;
  logmein_group_name: string;
  host_name_sanitized: string;
  equipment_tag: string | null;
  status: string | null;
  last_seen_at: Date | string | null;
}

function tableRegclass(table: string): string {
  return `public.${table}`;
}

function dateText(value: Date | string | null): string | null {
  if (value === null) {
    return null;
  }
  return value instanceof Date ? value.toISOString() : String(value);
}

function toHost(row: HostRow): LogmeinHostContext {
  const status = String(row.status ?? '').toLowerCase();
  return {
    externalId: row.logmein_host_external_id,
    groupExternalId: row.logmein_group_external_id,
    groupName: row.logmein_group_name,
    hostName: row.host_name_sanitized,
    equipmentTag: row.equipment_tag ?? '',
    status: status === 'online' || status === 'offline' ? status : 'unknown',
    lastSeenAt: dateText(row.last_seen_at),
  };
}

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }

  return result;
}

export class PostgresLogmeinReadonlyRepository implements LogmeinReadonlyCacheRepository {
  public constructor(private readonly executor: SqlExecutor) {}

  public async isSchemaReady(): Promise<boolean> {
    const result = await this.executor.query<{ ready: boolean }>(
      `
        SELECT
          to_regclass($1::text) IS NOT NULL
          AND to_regclass($2::text) IS NOT NULL
          AND to_regclass($3::text) IS NOT NULL AS ready
      `,
      [tableRegclass(ASSET_CACHE_TABLE), tableRegclass(GROUP_MAP_TABLE), tableRegclass(SYNC_AUDIT_TABLE)],
    );

    return result.rows[0]?.ready === true;
  }

  public async upsertHosts(input: {
    groups: Array<{ externalId: string; name: string }>;
    hosts: LogmeinHostContext[];
    sourceSnapshotHash: string;
  }): Promise<{ groupsImported: number; hostsImported: number }> {
    const groupNames = new Map(input.groups.map((group) => [group.externalId, group.name]));
    let hostsImported = 0;

    for (const batch of chunks(input.hosts, HOST_UPSERT_BATCH_SIZE)) {
      if (batch.length === 0) {
        continue;
      }
      const params: unknown[] = [];
      const values = batch.map((host, index) => {
        const offset = index * 8;
        params.push(
          host.externalId,
          host.groupExternalId,
          groupNames.get(host.groupExternalId) ?? host.groupName,
          host.hostName,
          host.equipmentTag,
          host.status,
          host.lastSeenAt ?? '',
          input.sourceSnapshotHash,
        );

        return `($${offset + 1}::text, $${offset + 2}::text, $${offset + 3}::text, $${offset + 4}::text, NULLIF($${offset + 5}::text, ''), $${offset + 6}::text, NULLIF($${offset + 7}::text, '')::timestamptz, $${offset + 8}::text, NOW())`;
      });

      await this.executor.query(
        `
          INSERT INTO ${ASSET_CACHE_TABLE} (
            logmein_host_external_id,
            logmein_group_external_id,
            logmein_group_name,
            host_name_sanitized,
            equipment_tag,
            status,
            last_seen_at,
            source_snapshot_hash,
            cache_updated_at
          )
          VALUES ${values.join(', ')}
          ON CONFLICT (logmein_host_external_id)
          DO UPDATE SET
            logmein_group_external_id = EXCLUDED.logmein_group_external_id,
            logmein_group_name = EXCLUDED.logmein_group_name,
            host_name_sanitized = EXCLUDED.host_name_sanitized,
            equipment_tag = EXCLUDED.equipment_tag,
            status = EXCLUDED.status,
            last_seen_at = EXCLUDED.last_seen_at,
            source_snapshot_hash = EXCLUDED.source_snapshot_hash,
            cache_updated_at = NOW()
        `,
        params,
      );
      hostsImported += batch.length;
    }

    const groupsImported = new Set(input.hosts.map((host) => host.groupExternalId).filter((value) => value !== '')).size;
    return { groupsImported, hostsImported };
  }

  public async insertSyncAudit(input: {
    status: 'started' | 'completed' | 'failed';
    groupsImported: number;
    hostsImported: number;
    errorMessageSanitized?: string | null;
    durationMs?: number | null;
  }): Promise<void> {
    await this.executor.query(
      `
        INSERT INTO ${SYNC_AUDIT_TABLE} (
          event_type,
          status,
          severity,
          payload_json,
          created_at
        )
        VALUES ($1::text, $2::text, $3::text, $4::jsonb, NOW())
      `,
      [
        input.status === 'failed' ? 'LOGMEIN_SYNC_FAILED' : input.status === 'completed' ? 'LOGMEIN_SYNC_COMPLETED' : 'LOGMEIN_SYNC_STARTED',
        input.status,
        input.status === 'failed' ? 'warning' : 'info',
        JSON.stringify({
          groups_imported: input.groupsImported,
          hosts_imported: input.hostsImported,
          error_message_sanitized: input.errorMessageSanitized ?? null,
          duration_ms: input.durationMs ?? null,
          read_only: true,
          remote_execution: false,
        }),
      ],
    );
  }

  public async getHealthSummary(): Promise<LogmeinHealthSummary> {
    const empty = this.emptyHealthSummary();

    // 1. Check tables exist.
    const schemaReady = await this.isSchemaReady();
    if (!schemaReady) {
      return empty;
    }

    // 2. Last N sync events (completed | failed) for consecutive-failure count.
    const syncRows = await this.safeQuery<{
      status: string;
      payload_json: string;
      created_at: string;
    }>(
      `
        SELECT status, payload_json, created_at
        FROM ${SYNC_AUDIT_TABLE}
        WHERE status IN ('completed', 'failed')
        ORDER BY id DESC
        LIMIT 5
      `,
    );

    const lastSync = syncRows[0] ?? null;
    let lastPayload: Record<string, unknown> = {};
    if (lastSync) {
      try {
        const parsed = JSON.parse(lastSync.payload_json ?? '{}') as unknown;
        lastPayload = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
          ? parsed as Record<string, unknown>
          : {};
      } catch { /* ignore */ }
    }

    const consecutiveFailures = syncRows.findIndex((row) => row.status !== 'failed');
    const actualConsecutiveFailures = consecutiveFailures === -1 ? syncRows.length : consecutiveFailures;

    // 3. Cache stats.
    const cacheStatsRows = await this.safeQuery<{
      total_hosts: string;
      hosts_valid_tag: string;
      hosts_without_tag: string;
      hosts_invalid_tag: string;
      cache_age_hours: string | null;
    }>(
      `
        SELECT
          COUNT(*)::text AS total_hosts,
          COUNT(*) FILTER (WHERE equipment_tag ~ '^[0-9]{4}$')::text AS hosts_valid_tag,
          COUNT(*) FILTER (WHERE COALESCE(equipment_tag, '') = '')::text AS hosts_without_tag,
          COUNT(*) FILTER (
            WHERE COALESCE(equipment_tag, '') <> '' AND (equipment_tag !~ '^[0-9]{4}$')
          )::text AS hosts_invalid_tag,
          ROUND(EXTRACT(EPOCH FROM (NOW() - MAX(cache_updated_at))) / 3600.0, 2)::text AS cache_age_hours
        FROM ${ASSET_CACHE_TABLE}
      `,
    );
    const cs = cacheStatsRows[0] ?? null;
    const totalHosts = parseInt(cs?.total_hosts ?? '0', 10);
    const tagsValid = parseInt(cs?.hosts_valid_tag ?? '0', 10);
    const hostsWithoutTag = parseInt(cs?.hosts_without_tag ?? '0', 10);
    const tagsInvalid = parseInt(cs?.hosts_invalid_tag ?? '0', 10);
    const cacheAgeHours = cs?.cache_age_hours != null ? parseFloat(cs.cache_age_hours) : null;

    // 4. Groups without entity mapping.
    const gwRows = await this.safeQuery<{ groups_without_entity: string }>(
      `
        SELECT COUNT(DISTINCT a.logmein_group_external_id)::text AS groups_without_entity
        FROM ${ASSET_CACHE_TABLE} a
        LEFT JOIN ${GROUP_MAP_TABLE} m
          ON m.logmein_group_external_id = a.logmein_group_external_id
         AND m.is_active = TRUE
        WHERE COALESCE(a.logmein_group_external_id, '') <> ''
          AND m.id IS NULL
      `,
    );
    const groupsWithoutEntity = parseInt(gwRows[0]?.groups_without_entity ?? '0', 10);

    // 5. Compute derived metrics.
    const tagCoveragePercent = totalHosts > 0 ? Math.round((tagsValid / totalHosts) * 100) : null;
    const lastSyncStatus: LogmeinHealthSummary['lastSyncStatus'] = lastSync
      ? (lastSync.status === 'completed' ? 'completed' : 'failed')
      : 'never';
    const lastSyncDurationMs = typeof lastPayload.duration_ms === 'number' ? lastPayload.duration_ms : null;
    const groupsImported = typeof lastPayload.groups_imported === 'number' ? lastPayload.groups_imported : 0;
    const hostsImported = typeof lastPayload.hosts_imported === 'number' ? lastPayload.hosts_imported : 0;
    const lastSyncErrorSanitized = typeof lastPayload.error_message_sanitized === 'string'
      ? lastPayload.error_message_sanitized.slice(0, 240)
      : null;

    // 6. Alert flags.
    const syncFailing = actualConsecutiveFailures >= LOGMEIN_HEALTH_THRESHOLDS.consecutiveFailuresWarning;
    const cacheStale = cacheAgeHours !== null && cacheAgeHours > LOGMEIN_HEALTH_THRESHOLDS.cacheStaleWarningHours;
    const lowTagCoverage = tagCoveragePercent !== null && tagCoveragePercent < LOGMEIN_HEALTH_THRESHOLDS.tagCoverageWarningPercent;
    const hasGroupsWithoutEntity = groupsWithoutEntity > 0;

    const isWarning = syncFailing || cacheStale || lowTagCoverage || hasGroupsWithoutEntity;
    const isCritical = (cacheAgeHours !== null && cacheAgeHours > LOGMEIN_HEALTH_THRESHOLDS.cacheStaleCriticalHours)
      || (actualConsecutiveFailures >= LOGMEIN_HEALTH_THRESHOLDS.consecutiveFailuresWarning * 2);

    return {
      ok: !isWarning && !isCritical,
      status: isCritical ? 'critical' : isWarning ? 'warning' : 'ok',
      lastSyncTimestamp: lastSync?.created_at ?? null,
      lastSyncStatus,
      lastSyncDurationMs,
      groupsImported,
      hostsImported,
      lastSyncErrorSanitized,
      totalHosts,
      tagsValid,
      tagsInvalid,
      hostsWithoutTag,
      groupsWithoutEntity,
      cacheAgeHours,
      tagCoveragePercent,
      consecutiveFailures: actualConsecutiveFailures,
      alerts: {
        syncFailing,
        cacheStale,
        lowTagCoverage,
        groupsWithoutEntity: hasGroupsWithoutEntity,
      },
      thresholds: LOGMEIN_HEALTH_THRESHOLDS,
      readOnly: true,
    };
  }

  private emptyHealthSummary(): LogmeinHealthSummary {
    return {
      ok: false,
      status: 'unavailable',
      lastSyncTimestamp: null,
      lastSyncStatus: null,
      lastSyncDurationMs: null,
      groupsImported: 0,
      hostsImported: 0,
      lastSyncErrorSanitized: null,
      totalHosts: 0,
      tagsValid: 0,
      tagsInvalid: 0,
      hostsWithoutTag: 0,
      groupsWithoutEntity: 0,
      cacheAgeHours: null,
      tagCoveragePercent: null,
      consecutiveFailures: 0,
      alerts: { syncFailing: false, cacheStale: false, lowTagCoverage: false, groupsWithoutEntity: false },
      thresholds: LOGMEIN_HEALTH_THRESHOLDS,
      readOnly: true,
    };
  }

  private async safeQuery<T extends Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
    try {
      const result = await this.executor.query<T>(sql, params);
      return Array.isArray(result.rows) ? result.rows : [];
    } catch {
      return [];
    }
  }

  public async listHostsByGroup(groupExternalId: string, limit: number): Promise<LogmeinHostContext[]> {
    const result = await this.executor.query<HostRow>(
      `
        SELECT
          logmein_host_external_id,
          logmein_group_external_id,
          logmein_group_name,
          host_name_sanitized,
          equipment_tag,
          status,
          last_seen_at
        FROM ${ASSET_CACHE_TABLE}
        WHERE logmein_group_external_id = $1::text
        ORDER BY cache_updated_at DESC NULLS LAST, host_name_sanitized ASC
        LIMIT $2::int
      `,
      [groupExternalId, Math.max(1, Math.min(limit, 100))],
    );

    return result.rows.map(toHost);
  }
}
