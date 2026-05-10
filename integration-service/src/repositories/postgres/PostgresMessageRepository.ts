import type { InboundMessage } from '../../domain/entities/InboundMessage.js';
import type { SqlExecutor } from '../../infra/db/postgres.js';
import { DATABASE_TABLES } from '../../infra/db/databaseConstants.js';
import type {
  InsertOutboundMessageInput,
  MessageRepository,
  ReserveInboundMessageInput,
  UpdateMessageStateInput,
} from '../contracts/MessageRepository.js';

import { mapInboundMessageRow } from './postgresRowMappers.js';

export class PostgresMessageRepository implements MessageRepository {
  public constructor(private readonly executor: SqlExecutor) {}

  public async reserveInbound(input: ReserveInboundMessageInput): Promise<InboundMessage | null> {
    const result = await this.executor.query<Parameters<typeof mapInboundMessageRow>[0]>(
      `
        INSERT INTO ${DATABASE_TABLES.messages} (
          message_id,
          direction,
          sender_phone,
          recipient_phone,
          message_type,
          message_text,
          raw_payload,
          processing_status,
          glpi_sync_status
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)
        ON CONFLICT (message_id) DO NOTHING
        RETURNING *
      `,
      [
        input.messageId,
        input.direction,
        input.senderPhone,
        input.recipientPhone,
        input.messageType,
        input.messageText,
        JSON.stringify(input.rawPayload),
        input.processingStatus,
        input.glpiSyncStatus,
      ],
    );

    return result.rowCount ? mapInboundMessageRow(result.rows[0]) : null;
  }

  public async findByMessageId(messageId: string): Promise<InboundMessage | null> {
    const result = await this.executor.query<Parameters<typeof mapInboundMessageRow>[0]>(
      `
        SELECT *
        FROM ${DATABASE_TABLES.messages}
        WHERE message_id = $1
        LIMIT 1
      `,
      [messageId],
    );

    return result.rowCount ? mapInboundMessageRow(result.rows[0]) : null;
  }

  public async findByIdempotencyKey(idempotencyKey: string): Promise<InboundMessage | null> {
    const result = await this.executor.query<Parameters<typeof mapInboundMessageRow>[0]>(
      `
        SELECT *
        FROM ${DATABASE_TABLES.messages}
        WHERE idempotency_key = $1
        LIMIT 1
      `,
      [idempotencyKey],
    );

    return result.rowCount ? mapInboundMessageRow(result.rows[0]) : null;
  }

  public async insertOutbound(input: InsertOutboundMessageInput): Promise<{ id: string; messageId: string }> {
    const result = await this.executor.query<{ id: string; message_id: string }>(
      `
        INSERT INTO ${DATABASE_TABLES.messages} (
          message_id,
          direction,
          sender_phone,
          recipient_phone,
          message_type,
          message_text,
          raw_payload,
          processing_status,
          glpi_sync_status,
          conversation_id,
          idempotency_key
        )
        VALUES ($1, 'outbound', $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10)
        RETURNING id, message_id
      `,
      [
        input.messageId,
        input.senderPhone,
        input.recipientPhone,
        input.messageType,
        input.messageText,
        JSON.stringify(input.rawPayload),
        input.processingStatus,
        input.glpiSyncStatus,
        input.conversationId,
        input.idempotencyKey,
      ],
    );

    if (!result.rowCount) {
      throw new Error('Failed to insert outbound message.');
    }

    return {
      id: result.rows[0].id,
      messageId: result.rows[0].message_id,
    };
  }

  public async updateState(input: UpdateMessageStateInput): Promise<void> {
    await this.executor.query(
      `
        UPDATE ${DATABASE_TABLES.messages}
        SET
          conversation_id = COALESCE($2, conversation_id),
          processing_status = $3,
          glpi_sync_status = $4,
          updated_at = NOW()
        WHERE message_id = $1
      `,
      [input.messageId, input.conversationId ?? null, input.processingStatus, input.glpiSyncStatus],
    );
  }

  public async updateMediaInfo(messageId: string, mediaInfo: Record<string, unknown>): Promise<void> {
    await this.executor.query(
      `
        UPDATE ${DATABASE_TABLES.messages}
        SET
          media_info = $2::jsonb,
          updated_at = NOW()
        WHERE message_id = $1
      `,
      [messageId, JSON.stringify(mediaInfo)],
    );
  }
}

