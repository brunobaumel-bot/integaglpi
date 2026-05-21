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

const CONTACT_PROFILE_SETTING_KEYS = [
  'contact_profile_collection_enabled',
  'contact_profile_prompt_mode',
  'contact_profile_require_company',
  'contact_profile_require_name',
  'contact_profile_require_equipment',
  'contact_profile_require_summary',
  'contact_profile_confirmation_enabled',
  'contact_profile_use_buttons',
  'ticket_title_enrichment_enabled',
  'contact_profile_prompt_name',
  'contact_profile_prompt_company',
  'contact_profile_prompt_equipment',
  'contact_profile_prompt_summary',
  'contact_profile_confirm_message',
  'profile_initial_prompt',
  'profile_ask_company',
  'profile_ask_name',
  'profile_ask_equipment',
  'profile_ask_summary',
  'profile_confirmation_message',
  'profile_success_message',
  'profile_change_message',
  'profile_partial_continue_message',
] as const;

const ENTITY_RESOLUTION_SETTING_KEYS = [
  'entity_resolution_mode',
  'default_glpi_entity_id',
  'triage_entity_id',
  'entity_selection_timeout_hours',
] as const;

const INACTIVITY_SETTING_KEYS = [
  'inactivity_enabled',
  'inactivity_reminder_1_minutes',
  'inactivity_reminder_2_minutes',
  'inactivity_reminder_3_minutes',
  'inactivity_autoclose_minutes',
] as const;

type MessageSettingKey = (typeof MESSAGE_SETTING_KEYS)[number];
type BusinessHoursSettingKey = (typeof BUSINESS_HOURS_SETTING_KEYS)[number];
type ContactProfileSettingKey = (typeof CONTACT_PROFILE_SETTING_KEYS)[number];
type EntityResolutionSettingKey = (typeof ENTITY_RESOLUTION_SETTING_KEYS)[number];
type InactivitySettingKey = (typeof INACTIVITY_SETTING_KEYS)[number];

type MessageSettingsRow = Partial<Record<MessageSettingKey, unknown>>;
type BusinessHoursSettingsRow = Partial<Record<BusinessHoursSettingKey, unknown>>;
type ContactProfileSettingsRow = Partial<Record<ContactProfileSettingKey, unknown>>;
type EntityResolutionSettingsRow = Partial<Record<EntityResolutionSettingKey, unknown>>;
type InactivitySettingsRow = Partial<Record<InactivitySettingKey, unknown>>;
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

  public async findContactProfileSettings(): Promise<Map<string, unknown>> {
    const columnsResult = await this.executor.query<ColumnRow>(
      `
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = $1
          AND column_name = ANY($2::text[])
      `,
      [DATABASE_TABLES.configs, ['context', ...CONTACT_PROFILE_SETTING_KEYS]],
    );

    const hasContextColumn = columnsResult.rows.some((row) => row.column_name === 'context');
    if (!hasContextColumn) {
      return new Map();
    }

    const columns = columnsResult.rows
      .map((row) => row.column_name)
      .filter((column): column is ContactProfileSettingKey =>
        CONTACT_PROFILE_SETTING_KEYS.includes(column as ContactProfileSettingKey),
      );

    if (columns.length === 0) {
      return new Map();
    }

    const projection = columns.map((column) => `"${column}"`).join(', ');
    const result = await this.executor.query<ContactProfileSettingsRow>(
      `
        SELECT ${projection}
        FROM ${DATABASE_TABLES.configs}
        WHERE context = 'contact_profile'
        LIMIT 1
      `,
    );

    const row = result.rows[0] ?? {};
    const settings = new Map<string, unknown>();

    for (const key of CONTACT_PROFILE_SETTING_KEYS) {
      if (Object.prototype.hasOwnProperty.call(row, key)) {
        settings.set(key, row[key]);
      }
    }

    return settings;
  }

  public async findEntityResolutionSettings(): Promise<Map<string, unknown>> {
    const columnsResult = await this.executor.query<ColumnRow>(
      `
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = $1
          AND column_name = ANY($2::text[])
      `,
      [DATABASE_TABLES.configs, ['context', ...ENTITY_RESOLUTION_SETTING_KEYS]],
    );

    const hasContextColumn = columnsResult.rows.some((row) => row.column_name === 'context');
    if (!hasContextColumn) {
      return new Map();
    }

    const columns = columnsResult.rows
      .map((row) => row.column_name)
      .filter((column): column is EntityResolutionSettingKey =>
        ENTITY_RESOLUTION_SETTING_KEYS.includes(column as EntityResolutionSettingKey),
      );

    if (columns.length === 0) {
      return new Map();
    }

    const projection = columns.map((column) => `"${column}"`).join(', ');
    const result = await this.executor.query<EntityResolutionSettingsRow>(
      `
        SELECT ${projection}
        FROM ${DATABASE_TABLES.configs}
        WHERE context = 'entity_resolution'
        LIMIT 1
      `,
    );

    const row = result.rows[0] ?? {};
    const settings = new Map<string, unknown>();

    for (const key of ENTITY_RESOLUTION_SETTING_KEYS) {
      if (Object.prototype.hasOwnProperty.call(row, key)) {
        settings.set(key, row[key]);
      }
    }

    return settings;
  }

  public async findInactivitySettings(): Promise<Map<string, unknown>> {
    const columnsResult = await this.executor.query<ColumnRow>(
      `
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = $1
          AND column_name = ANY($2::text[])
      `,
      [DATABASE_TABLES.configs, ['context', ...INACTIVITY_SETTING_KEYS]],
    );

    const hasContextColumn = columnsResult.rows.some((row) => row.column_name === 'context');
    if (!hasContextColumn) {
      return new Map();
    }

    const columns = columnsResult.rows
      .map((row) => row.column_name)
      .filter((column): column is InactivitySettingKey =>
        INACTIVITY_SETTING_KEYS.includes(column as InactivitySettingKey),
      );

    if (columns.length === 0) {
      return new Map();
    }

    const projection = columns.map((column) => `"${column}"`).join(', ');
    const result = await this.executor.query<InactivitySettingsRow>(
      `
        SELECT ${projection}
        FROM ${DATABASE_TABLES.configs}
        WHERE context = 'inactivity'
        LIMIT 1
      `,
    );

    const row = result.rows[0] ?? {};
    const settings = new Map<string, unknown>();

    for (const key of INACTIVITY_SETTING_KEYS) {
      if (Object.prototype.hasOwnProperty.call(row, key)) {
        settings.set(key, row[key]);
      }
    }

    return settings;
  }
}
