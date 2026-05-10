import type { SettingsRepository } from '../../domain/repositories/SettingsRepository.js';
import type { SqlExecutor } from '../../infra/db/postgres.js';
import { DATABASE_TABLES } from '../../infra/db/databaseConstants.js';

const MESSAGE_SETTING_KEYS = [
  'menu_message',
  'invalid_option_message',
  'invalid_media_message',
  'error_fallback_message',
  'ticket_created_message',
  'conversation_closed_message',
  'after_hours_message',
] as const;

const BUSINESS_HOURS_SETTING_KEYS = [
  'hours_enabled',
  'business_days',
  'start_time',
  'end_time',
  'timezone',
] as const;

type MessageSettingKey = (typeof MESSAGE_SETTING_KEYS)[number];
type BusinessHoursSettingKey = (typeof BUSINESS_HOURS_SETTING_KEYS)[number];

type MessageSettingsRow = Partial<Record<MessageSettingKey, unknown>>;
type BusinessHoursSettingsRow = Partial<Record<BusinessHoursSettingKey, unknown>>;
type ColumnRow = { column_name: string };

export class PostgresSettingsRepository implements SettingsRepository {
  public constructor(private readonly executor: SqlExecutor) {}

  public async findMessageSettings(): Promise<Map<string, string>> {
    const columnsResult = await this.executor.query<ColumnRow>(
      `
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = $1
          AND column_name = ANY($2::text[])
      `,
      [DATABASE_TABLES.configs, ['context', ...MESSAGE_SETTING_KEYS]],
    );

    const hasContextColumn = columnsResult.rows.some((row) => row.column_name === 'context');
    if (!hasContextColumn) {
      return new Map();
    }

    const columns = columnsResult.rows
      .map((row) => row.column_name)
      .filter((column): column is MessageSettingKey =>
        MESSAGE_SETTING_KEYS.includes(column as MessageSettingKey),
      );

    if (columns.length === 0) {
      return new Map();
    }

    const projection = columns.map((column) => `"${column}"`).join(', ');
    const result = await this.executor.query<MessageSettingsRow>(
      `
        SELECT ${projection}
        FROM ${DATABASE_TABLES.configs}
        WHERE context = 'message'
        LIMIT 1
      `,
    );

    const row = result.rows[0] ?? {};
    const settings = new Map<string, string>();

    for (const key of MESSAGE_SETTING_KEYS) {
      const value = row[key];
      if (typeof value === 'string') {
        settings.set(key, value);
      }
    }

    return settings;
  }

  public async findBusinessHoursSettings(): Promise<Map<string, unknown>> {
    const columnsResult = await this.executor.query<ColumnRow>(
      `
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = $1
          AND column_name = ANY($2::text[])
      `,
      [DATABASE_TABLES.configs, ['context', ...BUSINESS_HOURS_SETTING_KEYS]],
    );

    const hasContextColumn = columnsResult.rows.some((row) => row.column_name === 'context');
    if (!hasContextColumn) {
      return new Map();
    }

    const columns = columnsResult.rows
      .map((row) => row.column_name)
      .filter((column): column is BusinessHoursSettingKey =>
        BUSINESS_HOURS_SETTING_KEYS.includes(column as BusinessHoursSettingKey),
      );

    if (columns.length === 0) {
      return new Map();
    }

    const projection = columns.map((column) => `"${column}"`).join(', ');
    const result = await this.executor.query<BusinessHoursSettingsRow>(
      `
        SELECT ${projection}
        FROM ${DATABASE_TABLES.configs}
        WHERE context = 'business_hours'
        LIMIT 1
      `,
    );

    const row = result.rows[0] ?? {};
    const settings = new Map<string, unknown>();

    for (const key of BUSINESS_HOURS_SETTING_KEYS) {
      if (Object.prototype.hasOwnProperty.call(row, key)) {
        settings.set(key, row[key]);
      }
    }

    return settings;
  }
}
