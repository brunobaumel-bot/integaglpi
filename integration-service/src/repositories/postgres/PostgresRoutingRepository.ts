import type { SqlExecutor } from '../../infra/db/postgres.js';
import { DATABASE_TABLES } from '../../infra/db/databaseConstants.js';
import type {
  ActiveRoutingOption,
  RoutingQueueAssignment,
  RoutingRepository,
} from '../contracts/RoutingRepository.js';

interface RoutingOptionRow {
  id: string | number;
  label: string;
  option_key: string;
  queue_id: number | string | null;
  glpi_group_id: number | string | null;
  glpi_user_id: number | string | null;
  confirmation_message: string | null;
  sort_order: number | string;
}

function asInt(value: number | string | null | undefined): number | null {
  if (value == null) {
    return null;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && /^\d+$/.test(value)) {
    return Number.parseInt(value, 10);
  }

  return null;
}

function mapRow(row: RoutingOptionRow): ActiveRoutingOption {
  return {
    id: Number(row.id),
    label: row.label,
    optionKey: row.option_key,
    queueId: asInt(row.queue_id),
    glpiGroupId: asInt(row.glpi_group_id),
    glpiUserId: asInt(row.glpi_user_id),
    confirmationMessage: row.confirmation_message,
    sortOrder: Number(row.sort_order) || 0,
  };
}

export class PostgresRoutingRepository implements RoutingRepository {
  public constructor(private readonly executor: SqlExecutor) {}

  public async findAssignmentByQueueId(queueId: number): Promise<RoutingQueueAssignment | null> {
    const result = await this.executor.query<RoutingOptionRow>(
      `
        SELECT
          id,
          queue_id,
          glpi_group_id,
          glpi_user_id
        FROM ${DATABASE_TABLES.routingOptions}
        WHERE is_active = TRUE
          AND queue_id = $1
        ORDER BY sort_order ASC, label ASC
        LIMIT 1
      `,
      [queueId],
    );

    if (!result.rowCount) {
      return null;
    }

    const row = result.rows[0];
    const qid = asInt(row.queue_id);
    if (qid === null) {
      return null;
    }

    return {
      routingOptionId: Number(row.id),
      queueId: qid,
      glpiGroupId: asInt(row.glpi_group_id),
      glpiUserId: asInt(row.glpi_user_id),
    };
  }

  public async getActiveOptions(): Promise<ActiveRoutingOption[]> {
    const result = await this.executor.query<RoutingOptionRow>(
      `
        SELECT
          id,
          label,
          option_key,
          queue_id,
          glpi_group_id,
          glpi_user_id,
          confirmation_message,
          sort_order
        FROM ${DATABASE_TABLES.routingOptions}
        WHERE is_active = TRUE
        ORDER BY sort_order ASC, label ASC
      `,
    );

    return result.rows.map(mapRow);
  }
}
