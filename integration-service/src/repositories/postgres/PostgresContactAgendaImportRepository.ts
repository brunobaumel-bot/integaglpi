import type { SqlExecutor } from '../../infra/db/postgres.js';
import { DATABASE_TABLES } from '../../infra/db/databaseConstants.js';
import type {
  ApplyProfileInput,
  ApplyProfileResult,
  ContactAgendaImportRepository,
  ContactImportBatchRecord,
  ContactImportBatchStatus,
  ContactImportItemInput,
  ContactImportItemRecord,
  ContactImportActionApplied,
  ExistingContactProfileRecord,
} from '../contracts/ContactAgendaImportRepository.js';

interface BatchRow {
  batch_id: string;
  filename: string;
  uploaded_by: string | number | null;
  status: ContactImportBatchStatus;
  total_rows: number;
  valid_rows: number;
  invalid_rows: number;
  duplicate_rows: number;
  conflict_rows: number;
  error_message_sanitized: string | null;
  created_at: Date | string;
  confirmed_at: Date | string | null;
  completed_at: Date | string | null;
  rolled_back_at: Date | string | null;
}

interface ItemRow {
  item_id: string | number;
  batch_id: string;
  row_number: number;
  phone_e164: string | null;
  email: string | null;
  contact_name: string | null;
  company_name: string | null;
  equipment_tag: string | null;
  equipment_tag_unknown: boolean | null;
  validation_status: 'valid' | 'invalid';
  validation_errors: unknown;
  dedup_status: 'new' | 'duplicate' | 'conflict';
  action_planned: 'create_profile' | 'update_profile' | 'manual_review' | 'none';
  action_applied: ContactImportActionApplied;
  target_contact_profile_id: string | number | null;
  previous_state_json: unknown;
  created_at: Date | string;
  applied_at: Date | string | null;
}

interface ProfileRow {
  id: string | number;
  phone_e164: string;
  requester_name: string | null;
  email_address: string | null;
  email_status: string | null;
  glpi_user_id: string | number | null;
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
  is_active: boolean | null;
  created_at: Date | string;
  updated_at: Date | string;
}

function toDate(value: Date | string | null): Date | null {
  if (value === null) {
    return null;
  }

  return value instanceof Date ? value : new Date(value);
}

function numberOrNull(value: string | number | null): number | null {
  if (value === null) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function rowToBatch(row: BatchRow): ContactImportBatchRecord {
  return {
    batchId: row.batch_id,
    filename: row.filename,
    uploadedBy: numberOrNull(row.uploaded_by),
    status: row.status,
    totalRows: row.total_rows,
    validRows: row.valid_rows,
    invalidRows: row.invalid_rows,
    duplicateRows: row.duplicate_rows,
    conflictRows: row.conflict_rows,
    errorMessageSanitized: row.error_message_sanitized,
    createdAt: toDate(row.created_at) ?? new Date(),
    confirmedAt: toDate(row.confirmed_at),
    completedAt: toDate(row.completed_at),
    rolledBackAt: toDate(row.rolled_back_at),
  };
}

function rowToItem(row: ItemRow): ContactImportItemRecord {
  return {
    itemId: Number(row.item_id),
    batchId: row.batch_id,
    rowNumber: row.row_number,
    phoneE164: row.phone_e164,
    email: row.email,
    contactName: row.contact_name,
    companyName: row.company_name,
    equipmentTag: row.equipment_tag,
    equipmentTagUnknown: row.equipment_tag_unknown === true,
    validationStatus: row.validation_status,
    validationErrors: asStringArray(row.validation_errors),
    dedupStatus: row.dedup_status,
    actionPlanned: row.action_planned,
    actionApplied: row.action_applied,
    targetContactProfileId: numberOrNull(row.target_contact_profile_id),
    previousStateJson: asObject(row.previous_state_json),
    createdAt: toDate(row.created_at) ?? new Date(),
    appliedAt: toDate(row.applied_at),
  };
}

function profileSnapshot(row: ProfileRow): Record<string, unknown> {
  return {
    id: Number(row.id),
    phone_e164: row.phone_e164,
    requester_name: row.requester_name,
    email_address: row.email_address,
    email_status: row.email_status,
    glpi_user_id: numberOrNull(row.glpi_user_id),
    glpi_user_link_status: row.glpi_user_link_status,
    glpi_user_link_source: row.glpi_user_link_source,
    glpi_user_linked_at: row.glpi_user_linked_at ? String(row.glpi_user_linked_at) : null,
    glpi_user_created_by_integaglpi: row.glpi_user_created_by_integaglpi === true,
    company_name_raw: row.company_name_raw,
    last_equipment_tag: row.last_equipment_tag,
    equipment_tag_unknown: row.equipment_tag_unknown === true,
    last_problem_summary: row.last_problem_summary,
    profile_status: row.profile_status,
    profile_source: row.profile_source,
    confirmation_count: row.confirmation_count ?? 0,
    last_confirmed_at: row.last_confirmed_at ? String(row.last_confirmed_at) : null,
    last_conversation_id: row.last_conversation_id,
    is_active: row.is_active === true,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

export class PostgresContactAgendaImportRepository implements ContactAgendaImportRepository {
  public constructor(private readonly executor: SqlExecutor) {}

  public async createBatch(input: {
    batchId: string;
    filename: string;
    uploadedBy: number | null;
    totalRows: number;
    validRows: number;
    invalidRows: number;
    duplicateRows: number;
    conflictRows: number;
  }): Promise<void> {
    await this.executor.query(
      `
        INSERT INTO ${DATABASE_TABLES.contactImportBatches} (
          batch_id,
          filename,
          uploaded_by,
          status,
          total_rows,
          valid_rows,
          invalid_rows,
          duplicate_rows,
          conflict_rows
        )
        VALUES ($1, $2, $3, 'previewed', $4, $5, $6, $7, $8)
      `,
      [
        input.batchId,
        input.filename,
        input.uploadedBy,
        input.totalRows,
        input.validRows,
        input.invalidRows,
        input.duplicateRows,
        input.conflictRows,
      ],
    );
  }

  public async insertItems(batchId: string, items: ContactImportItemInput[]): Promise<ContactImportItemRecord[]> {
    const inserted: ContactImportItemRecord[] = [];
    for (const item of items) {
      const result = await this.executor.query<ItemRow>(
        `
          INSERT INTO ${DATABASE_TABLES.contactImportItems} (
            batch_id,
            row_number,
            phone_e164,
            email,
            contact_name,
            company_name,
            equipment_tag,
            equipment_tag_unknown,
            validation_status,
            validation_errors,
            dedup_status,
            action_planned
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12)
          RETURNING *
        `,
        [
          batchId,
          item.rowNumber,
          item.phoneE164,
          item.email,
          item.contactName,
          item.companyName,
          item.equipmentTag,
          item.equipmentTagUnknown,
          item.validationStatus,
          JSON.stringify(item.validationErrors),
          item.dedupStatus,
          item.actionPlanned,
        ],
      );
      inserted.push(rowToItem(result.rows[0]));
    }

    return inserted;
  }

  public async findBatch(batchId: string): Promise<ContactImportBatchRecord | null> {
    const result = await this.executor.query<BatchRow>(
      `SELECT * FROM ${DATABASE_TABLES.contactImportBatches} WHERE batch_id = $1 LIMIT 1`,
      [batchId],
    );

    return result.rowCount ? rowToBatch(result.rows[0]) : null;
  }

  public async listItems(batchId: string, options: { limit?: number } = {}): Promise<ContactImportItemRecord[]> {
    const limit = Math.max(1, Math.min(options.limit ?? 1000, 1000));
    const result = await this.executor.query<ItemRow>(
      `
        SELECT *
        FROM ${DATABASE_TABLES.contactImportItems}
        WHERE batch_id = $1
        ORDER BY row_number ASC
        LIMIT $2
      `,
      [batchId, limit],
    );

    return result.rows.map(rowToItem);
  }

  public async updateBatchStatus(
    batchId: string,
    status: ContactImportBatchStatus,
    errorMessage: string | null = null,
  ): Promise<void> {
    await this.executor.query(
      `
        UPDATE ${DATABASE_TABLES.contactImportBatches}
        SET status = $2::text,
            error_message_sanitized = $3::text,
            confirmed_at = CASE WHEN $2::text = 'confirmed' THEN NOW() ELSE confirmed_at END,
            completed_at = CASE WHEN $2::text IN ('completed', 'failed') THEN NOW() ELSE completed_at END,
            rolled_back_at = CASE WHEN $2::text = 'rolled_back' THEN NOW() ELSE rolled_back_at END
        WHERE batch_id = $1::text
      `,
      [batchId, status, errorMessage],
    );
  }

  public async findExistingProfiles(input: {
    phoneE164Values: string[];
    emailValues: string[];
    equipmentTagValues: string[];
  }): Promise<ExistingContactProfileRecord[]> {
    const result = await this.executor.query<ProfileRow>(
      `
        SELECT *
        FROM ${DATABASE_TABLES.contactProfile}
        WHERE is_active = TRUE
          AND (
            phone_e164 = ANY($1::text[])
            OR (email_address IS NOT NULL AND email_address = ANY($2::text[]))
            OR (last_equipment_tag IS NOT NULL AND last_equipment_tag = ANY($3::text[]))
          )
      `,
      [input.phoneE164Values, input.emailValues, input.equipmentTagValues],
    );

    return result.rows.map((row) => ({
      id: Number(row.id),
      phoneE164: row.phone_e164,
      email: row.email_address,
      equipmentTag: row.last_equipment_tag,
      profile: profileSnapshot(row),
    }));
  }

  public async applyProfile(input: ApplyProfileInput): Promise<ApplyProfileResult> {
    const existing = await this.findProfileByPhone(input.phoneE164);
    if (existing) {
      const previousStateJson = profileSnapshot(existing);
      await this.executor.query(
        `
          UPDATE ${DATABASE_TABLES.contactProfile}
          SET requester_name = COALESCE($2::text, requester_name),
              email_address = COALESCE($3::text, email_address),
              email_status = CASE WHEN $3::text IS NULL THEN email_status ELSE 'valid' END,
              company_name_raw = COALESCE($4::text, company_name_raw),
              last_equipment_tag = CASE WHEN $6::boolean THEN NULL WHEN $5::text IS NULL THEN last_equipment_tag ELSE $5::text END,
              equipment_tag_unknown = CASE WHEN $5::text IS NULL AND $6::boolean = FALSE THEN equipment_tag_unknown ELSE $6::boolean END,
              profile_source = 'csv_import',
              updated_at = NOW()
          WHERE id = $1::bigint
        `,
        [
          Number(existing.id),
          input.contactName,
          input.email,
          input.companyName,
          input.equipmentTag,
          input.equipmentTagUnknown,
        ],
      );

      return {
        actionApplied: 'updated_profile',
        targetContactProfileId: Number(existing.id),
        previousStateJson,
      };
    }

    const result = await this.executor.query<{ id: string | number }>(
      `
        INSERT INTO ${DATABASE_TABLES.contactProfile} (
          phone_e164,
          requester_name,
          email_address,
          email_status,
          company_name_raw,
          last_equipment_tag,
          equipment_tag_unknown,
          profile_status,
          profile_source,
          confirmation_count,
          is_active,
          updated_at
        )
        VALUES ($1::text, $2::text, $3::text, CASE WHEN $3::text IS NULL THEN 'not_provided' ELSE 'valid' END, $4::text, $5::text, $6::boolean, 'incomplete', 'csv_import', 0, TRUE, NOW())
        RETURNING id
      `,
      [
        input.phoneE164,
        input.contactName,
        input.email,
        input.companyName,
        input.equipmentTag,
        input.equipmentTagUnknown,
      ],
    );

    return {
      actionApplied: 'created_profile',
      targetContactProfileId: Number(result.rows[0].id),
      previousStateJson: null,
    };
  }

  public async markItemApplied(
    itemId: number,
    input: {
      actionApplied: ContactImportActionApplied;
      targetContactProfileId?: number | null;
      previousStateJson?: Record<string, unknown> | null;
    },
  ): Promise<void> {
    await this.executor.query(
      `
        UPDATE ${DATABASE_TABLES.contactImportItems}
        SET action_applied = $2::text,
            target_contact_profile_id = $3::bigint,
            previous_state_json = $4::jsonb,
            applied_at = NOW()
        WHERE item_id = $1::bigint
      `,
      [
        itemId,
        input.actionApplied,
        input.targetContactProfileId ?? null,
        input.previousStateJson === undefined ? null : JSON.stringify(input.previousStateJson),
      ],
    );
  }

  public async createRollbackRecord(input: {
    batchId: string;
    itemId: number | null;
    reason: string;
    previousStateJson: Record<string, unknown> | null;
    requestedBy: number | null;
    rollbackState: 'completed' | 'failed';
  }): Promise<void> {
    await this.executor.query(
      `
        INSERT INTO ${DATABASE_TABLES.contactImportRollbacks} (
          batch_id,
          item_id,
          reason,
          previous_state_json,
          rollback_state,
          requested_by,
          completed_at
        )
        VALUES ($1::text, $2::bigint, $3::text, $4::jsonb, $5::text, $6::bigint, NOW())
      `,
      [
        input.batchId,
        input.itemId,
        input.reason,
        JSON.stringify(input.previousStateJson ?? {}),
        input.rollbackState,
        input.requestedBy,
      ],
    );
  }

  public async restoreProfileFromPreviousState(profileId: number, previousState: Record<string, unknown>): Promise<void> {
    await this.executor.query(
      `
        UPDATE ${DATABASE_TABLES.contactProfile}
        SET requester_name = $2,
            email_address = $3,
            email_status = COALESCE($4, 'not_provided'),
            glpi_user_id = $5,
            glpi_user_link_status = $6,
            glpi_user_link_source = $7,
            glpi_user_linked_at = NULLIF($8, '')::timestamptz,
            glpi_user_created_by_integaglpi = $9,
            company_name_raw = $10,
            last_equipment_tag = $11,
            equipment_tag_unknown = $12,
            last_problem_summary = $13,
            profile_status = COALESCE($14, 'incomplete'),
            profile_source = COALESCE($15, 'whatsapp'),
            confirmation_count = $16,
            last_confirmed_at = NULLIF($17, '')::timestamptz,
            last_conversation_id = $18,
            is_active = $19,
            updated_at = NOW()
        WHERE id = $1
      `,
      [
        profileId,
        previousState.requester_name ?? null,
        previousState.email_address ?? null,
        previousState.email_status ?? null,
        numberOrNull(typeof previousState.glpi_user_id === 'number' ? previousState.glpi_user_id : null),
        previousState.glpi_user_link_status ?? null,
        previousState.glpi_user_link_source ?? null,
        typeof previousState.glpi_user_linked_at === 'string' ? previousState.glpi_user_linked_at : '',
        previousState.glpi_user_created_by_integaglpi === true,
        previousState.company_name_raw ?? null,
        previousState.last_equipment_tag ?? null,
        previousState.equipment_tag_unknown === true,
        previousState.last_problem_summary ?? null,
        previousState.profile_status ?? null,
        previousState.profile_source ?? null,
        Number(previousState.confirmation_count) || 0,
        typeof previousState.last_confirmed_at === 'string' ? previousState.last_confirmed_at : '',
        typeof previousState.last_conversation_id === 'string' ? previousState.last_conversation_id : null,
        previousState.is_active !== false,
      ],
    );
  }

  public async markCreatedProfileInactive(profileId: number): Promise<void> {
    await this.executor.query(
      `
        UPDATE ${DATABASE_TABLES.contactProfile}
        SET is_active = FALSE,
            updated_at = NOW()
        WHERE id = $1
          AND profile_source = 'csv_import'
      `,
      [profileId],
    );
  }

  private async findProfileByPhone(phoneE164: string): Promise<ProfileRow | null> {
    const result = await this.executor.query<ProfileRow>(
      `
        SELECT *
        FROM ${DATABASE_TABLES.contactProfile}
        WHERE phone_e164 = $1
          AND is_active = TRUE
        ORDER BY updated_at DESC
        LIMIT 1
      `,
      [phoneE164],
    );

    return result.rowCount ? result.rows[0] : null;
  }
}
