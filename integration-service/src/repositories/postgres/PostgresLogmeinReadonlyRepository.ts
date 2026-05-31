import type { SqlExecutor } from '../../infra/db/postgres.js';
import type { LogmeinHostContext, LogmeinReadonlyCacheRepository } from '../../domain/services/LogmeinReadonlyContextService.js';

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
          read_only: true,
          remote_execution: false,
        }),
      ],
    );
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
