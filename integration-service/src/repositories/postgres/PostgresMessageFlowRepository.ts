import type {
  BusinessHoursConfigRecord,
  ConfiguredMessage,
  ConfiguredMessageSendType,
  MessageFlowRepository,
  RecordAutomationEventInput,
  RecordInactivityJobEventInput,
} from '../contracts/MessageFlowRepository.js';
import type { SqlExecutor } from '../../infra/db/postgres.js';
import { DATABASE_TABLES } from '../../infra/db/databaseConstants.js';

type ColumnRow = { column_name: string };

type CatalogRow = {
  event_key: string;
  description: string | null;
  group_name: string | null;
  default_text: string | null;
  custom_text: string | null;
  is_active: boolean | null;
  send_type: string | null;
  language: string | null;
  fallback_text: string | null;
  template_name: string | null;
  buttons_json: unknown;
  list_options_json: unknown;
  expects_response: boolean | null;
  updated_at: Date | null;
  updated_by: number | null;
};

type BusinessHoursRow = {
  business_hours_enabled: boolean | null;
  timezone: string | null;
  weekday_start_time: string | null;
  weekday_end_time: string | null;
  saturday_enabled: boolean | null;
  saturday_start_time: string | null;
  saturday_end_time: string | null;
  sunday_enabled: boolean | null;
  sunday_start_time: string | null;
  sunday_end_time: string | null;
  holiday_behavior: string | null;
  outside_hours_event_key: string | null;
  cooldown_minutes: number | null;
};

const SEND_TYPES = new Set(['text', 'interactive_buttons', 'interactive_list', 'template', 'internal_only']);

export class PostgresMessageFlowRepository implements MessageFlowRepository {
  public constructor(private readonly executor: SqlExecutor) {}

  public async findMessageByEventKey(eventKey: string): Promise<ConfiguredMessage | null> {
    if (!await this.tableExists(DATABASE_TABLES.messageCatalog)) {
      return null;
    }

    const result = await this.executor.query<CatalogRow>(
      `
        SELECT
          event_key,
          description,
          group_name,
          default_text,
          custom_text,
          is_active,
          send_type,
          language,
          fallback_text,
          template_name,
          buttons_json,
          list_options_json,
          expects_response,
          updated_at,
          updated_by
        FROM ${DATABASE_TABLES.messageCatalog}
        WHERE event_key = $1
        LIMIT 1
      `,
      [eventKey],
    );

    if (!result.rowCount) {
      return null;
    }

    return mapCatalogRow(result.rows[0]);
  }

  public async findBusinessHoursConfig(): Promise<BusinessHoursConfigRecord | null> {
    if (!await this.tableExists(DATABASE_TABLES.businessHours)) {
      return null;
    }

    const result = await this.executor.query<BusinessHoursRow>(
      `
        SELECT
          business_hours_enabled,
          timezone,
          weekday_start_time,
          weekday_end_time,
          saturday_enabled,
          saturday_start_time,
          saturday_end_time,
          sunday_enabled,
          sunday_start_time,
          sunday_end_time,
          holiday_behavior,
          outside_hours_event_key,
          cooldown_minutes
        FROM ${DATABASE_TABLES.businessHours}
        ORDER BY id ASC
        LIMIT 1
      `,
    );

    if (!result.rowCount) {
      return null;
    }

    return mapBusinessHoursRow(result.rows[0]);
  }

  public async findLastAutomationEvent(
    conversationId: string | null,
    phoneE164: string | null,
    eventKey: string,
    statuses: Array<RecordAutomationEventInput['status']>,
  ): Promise<Date | null> {
    if (!await this.tableExists(DATABASE_TABLES.messageAutomationEvents)) {
      return null;
    }

    const result = await this.executor.query<{ created_at: Date }>(
      `
        SELECT created_at
        FROM ${DATABASE_TABLES.messageAutomationEvents}
        WHERE event_key = $1
          AND status = ANY($2::text[])
          AND (
            ($3::text IS NOT NULL AND conversation_id = $3)
            OR ($4::text IS NOT NULL AND phone_e164 = $4)
          )
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [eventKey, statuses, conversationId, phoneE164],
    );

    return result.rowCount ? result.rows[0].created_at : null;
  }

  public async recordAutomationEvent(input: RecordAutomationEventInput): Promise<void> {
    if (!await this.tableExists(DATABASE_TABLES.messageAutomationEvents)) {
      return;
    }

    await this.executor.query(
      `
        INSERT INTO ${DATABASE_TABLES.messageAutomationEvents} (
          conversation_id,
          phone_e164,
          event_key,
          status,
          message_id,
          reason,
          error_code,
          error_message_sanitized
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `,
      [
        input.conversationId,
        input.phoneE164,
        input.eventKey,
        input.status,
        input.messageId ?? null,
        input.reason ?? null,
        input.errorCode ?? null,
        input.errorMessageSanitized ?? null,
      ],
    );
  }

  public async recordInactivityJobEvent(input: RecordInactivityJobEventInput): Promise<void> {
    if (!await this.tableExists(DATABASE_TABLES.inactivityJobEvents)) {
      return;
    }

    await this.executor.query(
      `
        INSERT INTO ${DATABASE_TABLES.inactivityJobEvents} (
          conversation_id,
          ticket_id,
          phone_e164,
          event_key,
          status,
          reason,
          message_id,
          delivery_status,
          meta_error_code,
          meta_error_message_sanitized,
          checked_count,
          eligible_count,
          reason_code,
          reason_description
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      `,
      [
        input.conversationId,
        input.ticketId ?? null,
        input.phoneE164,
        input.eventKey ?? null,
        input.status,
        input.reason ?? null,
        input.messageId ?? null,
        input.deliveryStatus ?? null,
        input.metaErrorCode ?? null,
        input.metaErrorMessageSanitized ?? null,
        input.checkedCount ?? null,
        input.eligibleCount ?? null,
        input.reasonCode ?? null,
        input.reasonDescription ?? null,
      ],
    );
  }

  private async tableExists(tableName: string): Promise<boolean> {
    const result = await this.executor.query<ColumnRow>(
      `
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = $1
        LIMIT 1
      `,
      [tableName],
    );

    return (result.rowCount ?? 0) > 0;
  }
}

function mapCatalogRow(row: CatalogRow): ConfiguredMessage {
  const sendType = typeof row.send_type === 'string' && SEND_TYPES.has(row.send_type)
    ? row.send_type as ConfiguredMessageSendType
    : 'text';

  return {
    eventKey: row.event_key,
    description: row.description ?? '',
    groupName: row.group_name ?? 'Geral',
    defaultText: row.default_text ?? '',
    customText: row.custom_text,
    isActive: row.is_active !== false,
    sendType,
    language: row.language ?? 'pt_BR',
    fallbackText: row.fallback_text,
    templateName: row.template_name,
    buttons: normalizeButtons(row.buttons_json),
    listOptions: normalizeListOptions(row.list_options_json),
    expectsResponse: row.expects_response === true,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

function mapBusinessHoursRow(row: BusinessHoursRow): BusinessHoursConfigRecord {
  const holidayBehavior = row.holiday_behavior === 'closed' || row.holiday_behavior === 'custom'
    ? row.holiday_behavior
    : 'normal';

  return {
    enabled: row.business_hours_enabled === true,
    timezone: row.timezone?.trim() || 'America/Sao_Paulo',
    weekdayStart: row.weekday_start_time?.trim() || '08:00',
    weekdayEnd: row.weekday_end_time?.trim() || '18:00',
    saturdayEnabled: row.saturday_enabled === true,
    saturdayStart: row.saturday_start_time,
    saturdayEnd: row.saturday_end_time,
    sundayEnabled: row.sunday_enabled === true,
    sundayStart: row.sunday_start_time,
    sundayEnd: row.sunday_end_time,
    holidayBehavior,
    eventKey: row.outside_hours_event_key?.trim() || 'outside_business_hours_message',
    cooldownMinutes: Number.isInteger(row.cooldown_minutes) && Number(row.cooldown_minutes) > 0
      ? Number(row.cooldown_minutes)
      : 60,
  };
}

function normalizeButtons(value: unknown): Array<{ id: string; title: string }> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return null;
      }
      const row = item as Record<string, unknown>;
      const id = typeof row.id === 'string' ? row.id.trim() : '';
      const title = typeof row.title === 'string' ? row.title.trim() : '';

      return id !== '' && title !== '' ? { id, title } : null;
    })
    .filter((item): item is { id: string; title: string } => item !== null);
}

function normalizeListOptions(value: unknown): Array<{ id: string; title: string; description?: string }> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return null;
      }
      const row = item as Record<string, unknown>;
      const id = typeof row.id === 'string' ? row.id.trim() : '';
      const title = typeof row.title === 'string' ? row.title.trim() : '';
      const description = typeof row.description === 'string' ? row.description.trim() : '';

      return id !== '' && title !== '' ? { id, title, ...(description !== '' ? { description } : {}) } : null;
    })
    .filter((item): item is { id: string; title: string; description?: string } => item !== null);
}
