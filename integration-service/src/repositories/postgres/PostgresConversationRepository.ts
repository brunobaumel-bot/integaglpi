import type { Conversation } from '../../domain/entities/Conversation.js';
import type { SqlExecutor } from '../../infra/db/postgres.js';
import { DATABASE_TABLES } from '../../infra/db/databaseConstants.js';
import type {
  ConversationRepository,
  CreateConversationInput,
  EntitySelectionAttempt,
  EntitySelectionAttemptReserveResult,
  EntitySelectionAttemptStatus,
} from '../contracts/ConversationRepository.js';

import { mapConversationRow } from './postgresRowMappers.js';

interface EntitySelectionAttemptRow {
  id: string;
  conversation_id: string;
  idempotency_key?: string | null;
  status: string;
  glpi_entity_id: number | string | null;
  glpi_entity_name: string | null;
  glpi_ticket_id: number | string | null;
  error_message: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  finished_at?: Date | string | null;
}

function asEntitySelectionStatus(value: string): EntitySelectionAttemptStatus {
  if (
    value === 'processing' ||
    value === 'succeeded' ||
    value === 'failed_before_ticket' ||
    value === 'failed_after_ticket' ||
    value === 'cancelled'
  ) {
    return value;
  }

  if (value === 'reserved' || value === 'ticket_creating') {
    return 'processing';
  }

  return 'processing';
}

function mapEntitySelectionAttemptRow(row: EntitySelectionAttemptRow): EntitySelectionAttempt {
  return {
    id: String(row.id),
    conversationId: String(row.conversation_id),
    idempotencyKey: row.idempotency_key == null ? null : String(row.idempotency_key),
    status: asEntitySelectionStatus(String(row.status)),
    glpiEntityId:
      row.glpi_entity_id == null || row.glpi_entity_id === ''
        ? null
        : Number(row.glpi_entity_id),
    glpiEntityName: row.glpi_entity_name,
    glpiTicketId:
      row.glpi_ticket_id == null || row.glpi_ticket_id === ''
        ? null
        : Number(row.glpi_ticket_id),
    errorMessage: row.error_message,
    createdAt: row.created_at instanceof Date ? row.created_at : new Date(String(row.created_at)),
    updatedAt: row.updated_at instanceof Date ? row.updated_at : new Date(String(row.updated_at)),
    finishedAt: row.finished_at == null
      ? null
      : row.finished_at instanceof Date
        ? row.finished_at
        : new Date(String(row.finished_at)),
  };
}

const REUSABLE_CONVERSATION_STATUSES = ['open', 'awaiting_queue_selection', 'awaiting_entity_selection', 'collecting_contact_profile'];
const CONVERSATION_RUNTIME_TABLE = 'glpi_plugin_integaglpi_conversation_runtime';

export class PostgresConversationRepository implements ConversationRepository {
  public constructor(private readonly executor: SqlExecutor) {}

  public async findReusableByPhoneE164(phoneE164: string): Promise<Conversation | null> {
    const result = await this.executor.query<Parameters<typeof mapConversationRow>[0]>(
      `
        SELECT *
        FROM ${DATABASE_TABLES.conversations}
        WHERE phone_e164 = $1
          AND status = ANY($2::text[])
        ORDER BY last_message_at DESC
        LIMIT 1
      `,
      [phoneE164, REUSABLE_CONVERSATION_STATUSES],
    );

    return result.rowCount ? mapConversationRow(result.rows[0]) : null;
  }

  public async findPendingGlpiOrphanByPhoneE164(phoneE164: string): Promise<Conversation | null> {
    const result = await this.executor.query<Parameters<typeof mapConversationRow>[0]>(
      `
        SELECT *
        FROM ${DATABASE_TABLES.conversations}
        WHERE phone_e164 = $1
          AND status = 'pending_glpi'
          AND glpi_ticket_id IS NULL
        ORDER BY last_message_at DESC
        LIMIT 1
      `,
      [phoneE164],
    );

    return result.rowCount ? mapConversationRow(result.rows[0]) : null;
  }

  public async findLatestClosedByPhoneE164(phoneE164: string): Promise<Conversation | null> {
    const result = await this.executor.query<Parameters<typeof mapConversationRow>[0]>(
      `
        SELECT *
        FROM ${DATABASE_TABLES.conversations}
        WHERE phone_e164 = $1
          AND status = 'closed'
        ORDER BY last_message_at DESC
        LIMIT 1
      `,
      [phoneE164],
    );

    return result.rowCount ? mapConversationRow(result.rows[0]) : null;
  }

  public async findById(conversationId: string): Promise<Conversation | null> {
    const result = await this.executor.query<Parameters<typeof mapConversationRow>[0]>(
      `
        SELECT *
        FROM ${DATABASE_TABLES.conversations}
        WHERE id = $1
        LIMIT 1
      `,
      [conversationId],
    );

    return result.rowCount ? mapConversationRow(result.rows[0]) : null;
  }

  public async findByIdAndGlpiTicketId(conversationId: string, glpiTicketId: number): Promise<Conversation | null> {
    const result = await this.executor.query<Parameters<typeof mapConversationRow>[0]>(
      `
        SELECT *
        FROM ${DATABASE_TABLES.conversations}
        WHERE id = $1
          AND glpi_ticket_id = $2
        LIMIT 1
      `,
      [conversationId, glpiTicketId],
    );

    return result.rowCount ? mapConversationRow(result.rows[0]) : null;
  }

  public async create(input: CreateConversationInput): Promise<Conversation> {
    const result = await this.executor.query<Parameters<typeof mapConversationRow>[0]>(
      `
        INSERT INTO ${DATABASE_TABLES.conversations} (
          phone_e164,
          contact_id,
          glpi_ticket_id,
          status,
          last_message_at
        )
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *
      `,
      [input.phoneE164, input.contactId, input.glpiTicketId, input.status, input.lastMessageAt],
    );

    return mapConversationRow(result.rows[0]);
  }

  public async linkGlpiTicket(
    conversationId: string,
    ticketId: number,
    queueId?: number | null,
    glpiEntityId?: number | null,
    glpiEntityName?: string | null,
  ): Promise<boolean> {
    const normalizedEntityId = typeof glpiEntityId === 'number'
      && Number.isInteger(glpiEntityId)
      && glpiEntityId > 0
      ? glpiEntityId
      : null;
    const normalizedEntityName = typeof glpiEntityName === 'string' && glpiEntityName.trim() !== ''
      ? glpiEntityName.trim()
      : null;
    const result = await this.executor.query(
      `
        UPDATE ${DATABASE_TABLES.conversations}
        SET
          glpi_ticket_id = $2,
          status = 'open',
          queue_id = CASE WHEN $3::bigint IS NULL THEN queue_id ELSE $3::bigint END,
          glpi_entity_id = CASE WHEN $4::bigint IS NULL THEN glpi_entity_id ELSE $4::bigint END,
          glpi_entity_name = CASE WHEN $4::bigint IS NULL THEN glpi_entity_name ELSE $5::text END,
          updated_at = NOW()
        WHERE id = $1
          AND (glpi_ticket_id IS NULL OR glpi_ticket_id = 0)
      `,
      [conversationId, ticketId, queueId ?? null, normalizedEntityId, normalizedEntityName],
    );

    return result.rowCount === 1;
  }

  public async updateStatus(conversationId: string, status: string): Promise<void> {
    await this.executor.query(
      `
        UPDATE ${DATABASE_TABLES.conversations}
        SET status = $2, updated_at = NOW()
        WHERE id = $1
      `,
      [conversationId, status],
    );
  }

  public async updateQueueAndStatus(conversationId: string, queueId: number | null, status: string): Promise<void> {
    await this.executor.query(
      `
        UPDATE ${DATABASE_TABLES.conversations}
        SET queue_id = $2, status = $3, updated_at = NOW()
        WHERE id = $1
      `,
      [conversationId, queueId, status],
    );
  }

  public async updateProfileCollectionState(conversationId: string, state: Record<string, unknown>): Promise<void> {
    await this.executor.query(
      `
        UPDATE ${DATABASE_TABLES.conversations}
        SET profile_collection_state = $2::jsonb, updated_at = NOW()
        WHERE id = $1
      `,
      [conversationId, JSON.stringify(state)],
    );
  }

  public async reopenConversation(conversationId: string): Promise<void> {
    await this.executor.query(
      `
        UPDATE ${DATABASE_TABLES.conversations}
        SET status = 'open', updated_at = NOW()
        WHERE id = $1
      `,
      [conversationId],
    );

    await this.executor.query(
      `
        UPDATE ${CONVERSATION_RUNTIME_TABLE}
        SET
          status = 'open',
          closed_at = NULL,
          updated_at = NOW()
        WHERE conversation_id = $1
      `,
      [conversationId],
    );
  }

  public async touch(conversationId: string, occurredAt: Date): Promise<void> {
    await this.executor.query(
      `
        UPDATE ${DATABASE_TABLES.conversations}
        SET last_message_at = $2, updated_at = NOW()
        WHERE id = $1
      `,
      [conversationId, occurredAt],
    );
  }

  public async reserveEntitySelectionAttempt(
    conversationId: string,
    glpiEntityId: number,
    glpiEntityName?: string | null,
    idempotencyKey?: string | null,
  ): Promise<EntitySelectionAttemptReserveResult> {
    if (
      typeof glpiEntityId !== 'number'
      || !Number.isFinite(glpiEntityId)
      || !Number.isInteger(glpiEntityId)
      || glpiEntityId <= 0
    ) {
      throw new Error('reserveEntitySelectionAttempt: glpi_entity_id must be a positive integer');
    }
    const normalizedIdempotencyKey = typeof idempotencyKey === 'string' ? idempotencyKey.trim() : '';
    if (normalizedIdempotencyKey === '') {
      throw new Error('reserveEntitySelectionAttempt: idempotency_key must be a non-empty string');
    }

    const inserted = await this.executor.query<EntitySelectionAttemptRow>(
      `
        INSERT INTO ${DATABASE_TABLES.entitySelectionAttempts} (
          conversation_id,
          glpi_entity_id,
          glpi_entity_name,
          idempotency_key,
          status
        )
        VALUES ($1, $2, $3, $4, 'processing')
        ON CONFLICT (conversation_id) DO UPDATE
        SET
          glpi_entity_id = EXCLUDED.glpi_entity_id,
          glpi_entity_name = EXCLUDED.glpi_entity_name,
          idempotency_key = EXCLUDED.idempotency_key,
          status = 'processing',
          glpi_ticket_id = NULL,
          error_message = NULL,
          finished_at = NULL,
          updated_at = NOW()
        WHERE ${DATABASE_TABLES.entitySelectionAttempts}.status IN ('failed_before_ticket', 'cancelled')
        RETURNING *
      `,
      [conversationId, glpiEntityId, glpiEntityName ?? null, normalizedIdempotencyKey],
    );

    if (inserted.rowCount && inserted.rows[0]) {
      return { wasCreated: true, attempt: mapEntitySelectionAttemptRow(inserted.rows[0]) };
    }

    const existing = await this.findEntitySelectionAttemptByConversationId(conversationId);
    if (!existing) {
      throw new Error('entity_selection_attempts: insert conflict without existing row');
    }

    return { wasCreated: false, attempt: existing };
  }

  public async findEntitySelectionAttemptByConversationId(
    conversationId: string,
  ): Promise<EntitySelectionAttempt | null> {
    const result = await this.executor.query<EntitySelectionAttemptRow>(
      `
        SELECT *
        FROM ${DATABASE_TABLES.entitySelectionAttempts}
        WHERE conversation_id = $1
        LIMIT 1
      `,
      [conversationId],
    );

    return result.rowCount ? mapEntitySelectionAttemptRow(result.rows[0]) : null;
  }

  public async markEntitySelectionAttemptSucceeded(attemptId: string, glpiTicketId: number): Promise<void> {
    await this.executor.query(
      `
        UPDATE ${DATABASE_TABLES.entitySelectionAttempts}
        SET
          status = 'succeeded',
          glpi_ticket_id = $2,
          error_message = NULL,
          finished_at = NOW(),
          updated_at = NOW()
        WHERE id = $1
      `,
      [attemptId, glpiTicketId],
    );
  }

  public async markEntitySelectionAttemptFailedBeforeTicket(attemptId: string, errorMessage: string): Promise<void> {
    await this.executor.query(
      `
        UPDATE ${DATABASE_TABLES.entitySelectionAttempts}
        SET
          status = 'failed_before_ticket',
          error_message = $2,
          finished_at = NOW(),
          updated_at = NOW()
        WHERE id = $1
      `,
      [attemptId, errorMessage],
    );
  }

  public async markEntitySelectionAttemptFailedAfterTicket(
    attemptId: string,
    glpiTicketId: number,
    errorMessage: string,
  ): Promise<void> {
    await this.executor.query(
      `
        UPDATE ${DATABASE_TABLES.entitySelectionAttempts}
        SET
          status = 'failed_after_ticket',
          glpi_ticket_id = $2,
          error_message = $3,
          finished_at = NOW(),
          updated_at = NOW()
        WHERE id = $1
      `,
      [attemptId, glpiTicketId, errorMessage],
    );
  }
}

