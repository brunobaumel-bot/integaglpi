import type { InboundMessage } from '../../domain/entities/InboundMessage.js';
import type { SqlExecutor } from '../../infra/db/postgres.js';
import { DATABASE_TABLES } from '../../infra/db/databaseConstants.js';
import type {
  InsertOutboundMessageInput,
  MessageRepository,
  MessageDeliveryStatus,
  RecordDeliveryStatusInput,
  RecordDeliveryStatusResult,
  ReserveInboundMessageInput,
  UpdateMessageStateInput,
} from '../contracts/MessageRepository.js';

import { mapInboundMessageRow } from './postgresRowMappers.js';

interface AttachmentColumns {
  attachment_hash: string | null;
  attachment_status: string;
  attachment_blocked_reason: string | null;
  attachment_mime_detected: string | null;
  attachment_extension: string | null;
  attachment_size_bytes: number | null;
  attachment_filename_sanitized: string | null;
}

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

  public async findByConversationId(conversationId: string, limit = 200): Promise<InboundMessage[]> {
    const result = await this.executor.query<Parameters<typeof mapInboundMessageRow>[0]>(
      `
        SELECT *
        FROM ${DATABASE_TABLES.messages}
        WHERE conversation_id = $1
        ORDER BY created_at DESC
        LIMIT $2
      `,
      [conversationId, limit],
    );

    return result.rows.map((row) => mapInboundMessageRow(row));
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
          media_info,
          processing_status,
          glpi_sync_status,
          meta_message_id,
          delivery_status,
          delivery_status_updated_at,
          conversation_id,
          idempotency_key,
          attachment_hash,
          attachment_status,
          attachment_blocked_reason,
          attachment_mime_detected,
          attachment_extension,
          attachment_size_bytes,
          attachment_filename_sanitized
        )
        VALUES ($1, 'outbound', $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $1, 'sent', NOW(), $10, $11, $12, $13, $14, $15, $16, $17, $18)
        RETURNING id, message_id
      `,
      (() => {
        const attachment = attachmentColumnsFromMediaInfo(input.mediaInfo ?? null);
        return [
        input.messageId,
        input.senderPhone,
        input.recipientPhone,
        input.messageType,
        input.messageText,
        JSON.stringify(input.rawPayload),
        input.mediaInfo ? JSON.stringify(input.mediaInfo) : null,
        input.processingStatus,
        input.glpiSyncStatus,
        input.conversationId,
        input.idempotencyKey,
        attachment.attachment_hash,
        attachment.attachment_status,
        attachment.attachment_blocked_reason,
        attachment.attachment_mime_detected,
        attachment.attachment_extension,
        attachment.attachment_size_bytes,
        attachment.attachment_filename_sanitized,
        ];
      })(),
    );

    if (!result.rowCount) {
      throw new Error('Failed to insert outbound message.');
    }

    return {
      id: result.rows[0].id,
      messageId: result.rows[0].message_id,
    };
  }

  public async recordDeliveryStatus(input: RecordDeliveryStatusInput): Promise<RecordDeliveryStatusResult> {
    const current = await this.executor.query<{
      id: string;
      delivery_status: MessageDeliveryStatus | null;
    }>(
      `
        SELECT id, delivery_status
        FROM ${DATABASE_TABLES.messages}
        WHERE direction = 'outbound'
          AND (
            meta_message_id = $1
            OR message_id = $1
          )
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [input.metaMessageId],
    );

    if (!current.rowCount) {
      return {
        matched: false,
        insertedEvent: false,
        currentStatus: null,
      };
    }

    const localMessageId = current.rows[0].id;
    const currentStatus = normalizeDeliveryStatus(current.rows[0].delivery_status);
    const nextStatus = chooseDeliveryStatus(currentStatus, input.status);

    const inserted = await this.executor.query<{ id: string }>(
      `
        INSERT INTO ${DATABASE_TABLES.messageDeliveryStatus} (
          local_message_id,
          meta_message_id,
          status,
          error_code,
          error_message_sanitized,
          correlation_id,
          received_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (meta_message_id, status) DO NOTHING
        RETURNING id
      `,
      [
        localMessageId,
        input.metaMessageId,
        input.status,
        input.errorCode ?? null,
        input.errorMessageSanitized ?? null,
        input.correlationId ?? null,
        input.receivedAt,
      ],
    );

    await this.executor.query(
      `
        UPDATE ${DATABASE_TABLES.messages}
        SET
          meta_message_id = COALESCE(meta_message_id, $2),
          delivery_status = $3,
          delivery_status_updated_at = CASE
            WHEN delivery_status IS DISTINCT FROM $3 THEN $4
            ELSE COALESCE(delivery_status_updated_at, $4)
          END,
          meta_error_code = COALESCE($5, meta_error_code),
          meta_error_message_sanitized = COALESCE($6, meta_error_message_sanitized),
          updated_at = NOW()
        WHERE id = $1
      `,
      [
        localMessageId,
        input.metaMessageId,
        nextStatus,
        input.receivedAt,
        input.errorCode ?? null,
        input.errorMessageSanitized ?? null,
      ],
    );

    return {
      matched: true,
      insertedEvent: Boolean(inserted.rowCount),
      currentStatus: nextStatus,
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
    const attachment = attachmentColumnsFromMediaInfo(mediaInfo);
    await this.executor.query(
      `
        UPDATE ${DATABASE_TABLES.messages}
        SET
          media_info = $2::jsonb,
          attachment_hash = $3,
          attachment_status = $4,
          attachment_blocked_reason = $5,
          attachment_mime_detected = $6,
          attachment_extension = $7,
          attachment_size_bytes = $8,
          attachment_filename_sanitized = $9,
          updated_at = NOW()
        WHERE message_id = $1
      `,
      [
        messageId,
        JSON.stringify(mediaInfo),
        attachment.attachment_hash,
        attachment.attachment_status,
        attachment.attachment_blocked_reason,
        attachment.attachment_mime_detected,
        attachment.attachment_extension,
        attachment.attachment_size_bytes,
        attachment.attachment_filename_sanitized,
      ],
    );
  }
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function numberOrNull(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  return Math.trunc(value);
}

function attachmentColumnsFromMediaInfo(mediaInfo: Record<string, unknown> | null): AttachmentColumns {
  if (mediaInfo === null) {
    return {
      attachment_hash: null,
      attachment_status: 'received',
      attachment_blocked_reason: null,
      attachment_mime_detected: null,
      attachment_extension: null,
      attachment_size_bytes: null,
      attachment_filename_sanitized: null,
    };
  }

  const legacyStatus = stringOrNull(mediaInfo.status);
  const status = stringOrNull(mediaInfo.attachment_status)
    ?? (legacyStatus === 'synced' ? 'synced'
      : legacyStatus === 'blocked' || legacyStatus === 'skipped' ? 'blocked'
        : legacyStatus === 'error' || legacyStatus === 'uploaded_unlinked' ? 'failed'
          : 'received');

  return {
    attachment_hash: stringOrNull(mediaInfo.attachment_hash),
    attachment_status: status,
    attachment_blocked_reason: stringOrNull(mediaInfo.attachment_blocked_reason)
      ?? (status === 'blocked' ? stringOrNull(mediaInfo.error) : null),
    attachment_mime_detected: stringOrNull(mediaInfo.attachment_mime_detected) ?? stringOrNull(mediaInfo.mime_type),
    attachment_extension: stringOrNull(mediaInfo.attachment_extension),
    attachment_size_bytes: numberOrNull(mediaInfo.attachment_size_bytes) ?? numberOrNull(mediaInfo.file_size),
    attachment_filename_sanitized: stringOrNull(mediaInfo.attachment_filename_sanitized) ?? stringOrNull(mediaInfo.file_name),
  };
}

const DELIVERY_ORDER: Record<MessageDeliveryStatus, number> = {
  pending: 0,
  sent: 1,
  failed: 1,
  delivered: 2,
  read: 3,
};

function normalizeDeliveryStatus(status: string | null): MessageDeliveryStatus {
  if (status === 'pending' || status === 'sent' || status === 'delivered' || status === 'read' || status === 'failed') {
    return status;
  }

  return 'pending';
}

function chooseDeliveryStatus(current: MessageDeliveryStatus, incoming: MessageDeliveryStatus): MessageDeliveryStatus {
  if (incoming === 'failed') {
    return DELIVERY_ORDER[current] >= DELIVERY_ORDER.delivered ? current : 'failed';
  }

  if (current === 'failed') {
    return DELIVERY_ORDER[incoming] > DELIVERY_ORDER.failed ? incoming : current;
  }

  return DELIVERY_ORDER[incoming] >= DELIVERY_ORDER[current] ? incoming : current;
}

