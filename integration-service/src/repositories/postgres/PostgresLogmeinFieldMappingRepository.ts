import type { SqlExecutor } from '../../infra/db/postgres.js';
import type {
  LogmeinFieldMapping,
  LogmeinGlpiTargetType,
  LogmeinOverwritePolicy,
} from '../../adapters/glpi/glpiTypes.js';

const FIELD_MAPPING_TABLE = 'glpi_plugin_integaglpi_logmein_field_mapping_config';

interface MappingRow {
  id: string;
  logmein_field_key: string;
  glpi_target_type: string;
  glpi_target_field: string;
  overwrite_policy: string;
  is_active: boolean;
  requires_flag: string | null;
  created_at: string;
  updated_at: string;
}

function toMapping(row: MappingRow): LogmeinFieldMapping {
  return {
    id: Number(row.id),
    logmeinFieldKey: row.logmein_field_key,
    glpiTargetType: row.glpi_target_type as LogmeinGlpiTargetType,
    glpiTargetField: row.glpi_target_field,
    overwritePolicy: row.overwrite_policy as LogmeinOverwritePolicy,
    isActive: Boolean(row.is_active),
    requiresFlag: row.requires_flag ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export class PostgresLogmeinFieldMappingRepository {
  public constructor(private readonly executor: SqlExecutor) {}

  public async isSchemaReady(): Promise<boolean> {
    const result = await this.executor.query<{ ready: boolean }>(
      `SELECT to_regclass($1::text) IS NOT NULL AS ready`,
      [`public.${FIELD_MAPPING_TABLE}`],
    );
    return Boolean(result.rows[0]?.ready);
  }

  /** Returns all active field mappings, sorted by logmein_field_key. */
  public async listActive(): Promise<LogmeinFieldMapping[]> {
    const result = await this.executor.query<MappingRow>(
      `SELECT * FROM ${FIELD_MAPPING_TABLE} WHERE is_active = TRUE ORDER BY logmein_field_key`,
    );
    return result.rows.map(toMapping);
  }

  /** Returns all field mappings (active and inactive). */
  public async listAll(): Promise<LogmeinFieldMapping[]> {
    const result = await this.executor.query<MappingRow>(
      `SELECT * FROM ${FIELD_MAPPING_TABLE} ORDER BY logmein_field_key`,
    );
    return result.rows.map(toMapping);
  }

  /** Returns a single mapping by ID. */
  public async findById(id: number): Promise<LogmeinFieldMapping | null> {
    const result = await this.executor.query<MappingRow>(
      `SELECT * FROM ${FIELD_MAPPING_TABLE} WHERE id = $1`,
      [id],
    );
    const row = result.rows[0];
    return row ? toMapping(row) : null;
  }

  /**
   * Activates or deactivates a mapping by ID.
   * Returns the updated row or null if not found.
   */
  public async setActive(id: number, isActive: boolean): Promise<LogmeinFieldMapping | null> {
    const result = await this.executor.query<MappingRow>(
      `UPDATE ${FIELD_MAPPING_TABLE}
         SET is_active = $1, updated_at = NOW()
         WHERE id = $2
         RETURNING *`,
      [isActive, id],
    );
    const row = result.rows[0];
    return row ? toMapping(row) : null;
  }

  /** Updates the overwrite policy for a mapping. */
  public async setPolicy(id: number, policy: LogmeinOverwritePolicy): Promise<LogmeinFieldMapping | null> {
    const result = await this.executor.query<MappingRow>(
      `UPDATE ${FIELD_MAPPING_TABLE}
         SET overwrite_policy = $1, updated_at = NOW()
         WHERE id = $2
         RETURNING *`,
      [policy, id],
    );
    const row = result.rows[0];
    return row ? toMapping(row) : null;
  }

  /** Returns mapping by logmein_field_key (the first matching active row). */
  public async findByFieldKey(fieldKey: string): Promise<LogmeinFieldMapping | null> {
    const result = await this.executor.query<MappingRow>(
      `SELECT * FROM ${FIELD_MAPPING_TABLE}
         WHERE logmein_field_key = $1 AND is_active = TRUE
         ORDER BY id
         LIMIT 1`,
      [fieldKey],
    );
    const row = result.rows[0];
    return row ? toMapping(row) : null;
  }
}
