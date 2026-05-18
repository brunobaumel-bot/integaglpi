import type {
  ConversationProfileSnapshotRecord,
  ContactProfilePersistenceRepository,
  ContactProfileRecord,
} from '../../domain/repositories/ContactProfilePersistenceRepository.js';
import type { SqlExecutor } from '../../infra/db/postgres.js';
import { DATABASE_TABLES } from '../../infra/db/databaseConstants.js';

interface ProfileRow {
  phone_e164: string;
  requester_name: string | null;
  email_address: string | null;
  email_status: string | null;
  glpi_user_id: number | null;
  glpi_user_link_status: string | null;
  glpi_user_link_source: string | null;
  glpi_user_linked_at: Date | string | null;
  glpi_user_created_by_integaglpi: boolean | null;
  company_name_raw: string | null;
  last_equipment_tag: string | null;
  equipment_tag_unknown: boolean | null;
  last_problem_summary: string | null;
  profile_status: string | null;
  profile_source: string | null;
  confirmation_count: number | null;
  last_confirmed_at: Date | string | null;
  last_conversation_id: string | null;
  updated_at: Date | string;
}

interface SnapshotRow {
  conversation_id: string;
  phone_e164: string;
  snapshot_json: unknown;
  updated_at: Date | string;
}

function asJsonObject(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asDate(value: Date | string | null): Date {
  return value instanceof Date ? value : new Date(String(value ?? new Date().toISOString()));
}

function dateToIso(value: Date | string | null): string {
  if (!value) {
    return '';
  }

  return value instanceof Date ? value.toISOString() : String(value);
}

function rowToProfile(row: ProfileRow): Record<string, unknown> {
  return {
    phone_e164: row.phone_e164,
    requester_name: row.requester_name,
    email_address: row.email_address,
    email_status: row.email_status ?? (row.email_address ? 'valid' : 'not_provided'),
    glpi_user_id: row.glpi_user_id,
    glpi_user_link_status: row.glpi_user_link_status,
    glpi_user_link_source: row.glpi_user_link_source,
    glpi_user_linked_at: dateToIso(row.glpi_user_linked_at),
    glpi_user_created_by_integaglpi: row.glpi_user_created_by_integaglpi ?? false,
    company_name_raw: row.company_name_raw,
    last_equipment_tag: row.last_equipment_tag,
    equipment_tag_unknown: row.equipment_tag_unknown ?? false,
    last_problem_summary: row.last_problem_summary,
    profile_status: row.profile_status ?? 'incomplete',
    profile_source: row.profile_source ?? 'whatsapp',
    confirmation_count: row.confirmation_count ?? 0,
    last_confirmed_at: dateToIso(row.last_confirmed_at),
    last_conversation_id: row.last_conversation_id,
  };
}

export class PostgresContactProfileRepository implements ContactProfilePersistenceRepository {
  public constructor(private readonly executor: SqlExecutor) {}

  public async findByPhoneE164(phoneE164: string): Promise<ContactProfileRecord | null> {
    const result = await this.executor.query<ProfileRow>(
      `
        SELECT
          phone_e164,
          requester_name,
          email_address,
          email_status,
          glpi_user_id,
          glpi_user_link_status,
          glpi_user_link_source,
          glpi_user_linked_at,
          glpi_user_created_by_integaglpi,
          company_name_raw,
          last_equipment_tag,
          equipment_tag_unknown,
          last_problem_summary,
          profile_status,
          profile_source,
          confirmation_count,
          last_confirmed_at,
          last_conversation_id,
          updated_at
        FROM ${DATABASE_TABLES.contactProfile}
        WHERE phone_e164 = $1
          AND is_active = TRUE
        ORDER BY updated_at DESC
        LIMIT 1
      `,
      [phoneE164],
    );

    if (!result.rowCount) {
      return null;
    }

    const row = result.rows[0];

    return {
      phoneE164: row.phone_e164,
      profile: rowToProfile(row),
      updatedAt: asDate(row.updated_at),
    };
  }

  public async upsertProfile(phoneE164: string, profile: Record<string, unknown>): Promise<void> {
    await this.executor.query(
      `
        INSERT INTO ${DATABASE_TABLES.contactProfile} (
          phone_e164,
          requester_name,
          email_address,
          email_status,
          glpi_user_id,
          glpi_user_link_status,
          glpi_user_link_source,
          glpi_user_linked_at,
          glpi_user_created_by_integaglpi,
          company_name_raw,
          last_equipment_tag,
          equipment_tag_unknown,
          last_problem_summary,
          profile_status,
          profile_source,
          confirmation_count,
          last_confirmed_at,
          last_conversation_id,
          is_active,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, NULLIF($8, '')::timestamptz, $9, $10, $11, $12, $13, $14, $15, $16, NULLIF($17, '')::timestamptz, $18, TRUE, NOW())
        ON CONFLICT (phone_e164) WHERE is_active = TRUE DO UPDATE
        SET requester_name = EXCLUDED.requester_name,
            email_address = EXCLUDED.email_address,
            email_status = EXCLUDED.email_status,
            glpi_user_id = EXCLUDED.glpi_user_id,
            glpi_user_link_status = EXCLUDED.glpi_user_link_status,
            glpi_user_link_source = EXCLUDED.glpi_user_link_source,
            glpi_user_linked_at = EXCLUDED.glpi_user_linked_at,
            glpi_user_created_by_integaglpi = EXCLUDED.glpi_user_created_by_integaglpi,
            company_name_raw = EXCLUDED.company_name_raw,
            last_equipment_tag = EXCLUDED.last_equipment_tag,
            equipment_tag_unknown = EXCLUDED.equipment_tag_unknown,
            last_problem_summary = EXCLUDED.last_problem_summary,
            profile_status = EXCLUDED.profile_status,
            profile_source = EXCLUDED.profile_source,
            confirmation_count = EXCLUDED.confirmation_count,
            last_confirmed_at = EXCLUDED.last_confirmed_at,
            last_conversation_id = EXCLUDED.last_conversation_id,
            updated_at = NOW()
      `,
      [
        phoneE164,
        profile.requester_name ?? null,
        profile.email_address ?? null,
        profile.email_status ?? (profile.email_address ? 'valid' : 'not_provided'),
        Number(profile.glpi_user_id) > 0 ? Number(profile.glpi_user_id) : null,
        profile.glpi_user_link_status ?? null,
        profile.glpi_user_link_source ?? null,
        typeof profile.glpi_user_linked_at === 'string' ? profile.glpi_user_linked_at : '',
        profile.glpi_user_created_by_integaglpi === true,
        profile.company_name_raw ?? null,
        profile.last_equipment_tag ?? null,
        profile.equipment_tag_unknown === true,
        profile.last_problem_summary ?? null,
        profile.profile_status ?? 'incomplete',
        profile.profile_source ?? 'whatsapp',
        Number(profile.confirmation_count) || 0,
        typeof profile.last_confirmed_at === 'string' ? profile.last_confirmed_at : '',
        typeof profile.last_conversation_id === 'string' ? profile.last_conversation_id : null,
      ],
    );
  }

  public async findSnapshotByConversationId(conversationId: string): Promise<ConversationProfileSnapshotRecord | null> {
    const result = await this.executor.query<SnapshotRow>(
      `
        SELECT conversation_id, phone_e164, snapshot_json, updated_at
        FROM ${DATABASE_TABLES.conversationProfileSnapshot}
        WHERE conversation_id = $1
        LIMIT 1
      `,
      [conversationId],
    );

    if (!result.rowCount) {
      return null;
    }

    const row = result.rows[0];
    return {
      conversationId: row.conversation_id,
      phoneE164: row.phone_e164,
      snapshotJson: asJsonObject(row.snapshot_json),
      updatedAt: asDate(row.updated_at),
    };
  }

  public async upsertSnapshot(
    conversationId: string,
    phoneE164: string,
    snapshotJson: Record<string, unknown>,
  ): Promise<void> {
    const effectivePhoneE164 = phoneE164.trim() || String(snapshotJson.phone_e164 ?? '').trim();
    if (!effectivePhoneE164) {
      throw new Error('conversation_profile_snapshot phone_e164 is required');
    }

    await this.executor.query(
      `
        INSERT INTO ${DATABASE_TABLES.conversationProfileSnapshot} (conversation_id, phone_e164, snapshot_json)
        VALUES ($1, $2, $3::jsonb)
        ON CONFLICT (conversation_id) DO UPDATE
        SET phone_e164 = EXCLUDED.phone_e164,
            snapshot_json = EXCLUDED.snapshot_json,
            updated_at = NOW()
      `,
      [conversationId, effectivePhoneE164, JSON.stringify(snapshotJson)],
    );
  }
}
