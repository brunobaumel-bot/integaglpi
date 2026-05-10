import type { Conversation } from '../../domain/entities/Conversation.js';
import type { SqlExecutor } from '../../infra/db/postgres.js';
import { DATABASE_TABLES } from '../../infra/db/databaseConstants.js';
import type {
  ConversationRepository,
  CreateConversationInput,
} from '../contracts/ConversationRepository.js';

import { mapConversationRow } from './postgresRowMappers.js';

const REUSABLE_CONVERSATION_STATUSES = ['open', 'awaiting_queue_selection'];
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

  public async linkGlpiTicket(conversationId: string, ticketId: number, queueId?: number | null): Promise<boolean> {
    if (queueId !== undefined && queueId !== null) {
      const result = await this.executor.query(
        `
          UPDATE ${DATABASE_TABLES.conversations}
          SET
            glpi_ticket_id = $2,
            status = 'open',
            queue_id = $3,
            updated_at = NOW()
          WHERE id = $1
            AND glpi_ticket_id IS NULL
        `,
        [conversationId, ticketId, queueId],
      );

      return result.rowCount === 1;
    }

    const result = await this.executor.query(
      `
        UPDATE ${DATABASE_TABLES.conversations}
        SET
          glpi_ticket_id = $2,
          status = 'open',
          updated_at = NOW()
        WHERE id = $1
          AND glpi_ticket_id IS NULL
      `,
      [conversationId, ticketId],
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
}

