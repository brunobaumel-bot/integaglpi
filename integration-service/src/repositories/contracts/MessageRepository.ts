import type { InboundMessage } from '../../domain/entities/InboundMessage.js';
import type { GlpiSyncStatus } from '../../domain/types/GlpiSyncStatus.js';
import type { MessageProcessingStatus } from '../../domain/types/MessageProcessingStatus.js';

export interface InsertOutboundMessageInput {
  messageId: string;
  conversationId: string;
  senderPhone: string;
  recipientPhone: string;
  messageType: string;
  messageText: string;
  rawPayload: unknown;
  processingStatus: MessageProcessingStatus;
  glpiSyncStatus: GlpiSyncStatus;
  idempotencyKey: string | null;
}

export interface InsertedOutboundMessage {
  id: string;
  messageId: string;
}

export interface ReserveInboundMessageInput {
  messageId: string;
  direction: 'inbound';
  senderPhone: string;
  recipientPhone: string;
  messageType: string;
  messageText: string | null;
  rawPayload: unknown;
  processingStatus: MessageProcessingStatus;
  glpiSyncStatus: GlpiSyncStatus;
}

export interface UpdateMessageStateInput {
  messageId: string;
  conversationId?: string | null;
  processingStatus: MessageProcessingStatus;
  glpiSyncStatus: GlpiSyncStatus;
}

export interface MessageRepository {
  reserveInbound(input: ReserveInboundMessageInput): Promise<InboundMessage | null>;
  findByMessageId(messageId: string): Promise<InboundMessage | null>;
  findByIdempotencyKey(idempotencyKey: string): Promise<InboundMessage | null>;
  insertOutbound(input: InsertOutboundMessageInput): Promise<InsertedOutboundMessage>;
  updateState(input: UpdateMessageStateInput): Promise<void>;
  updateMediaInfo(messageId: string, mediaInfo: Record<string, unknown>): Promise<void>;
}

