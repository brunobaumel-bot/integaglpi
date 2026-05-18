import type { InboundMessage } from '../../domain/entities/InboundMessage.js';
import type { GlpiSyncStatus } from '../../domain/types/GlpiSyncStatus.js';
import type { MessageProcessingStatus } from '../../domain/types/MessageProcessingStatus.js';

export interface InsertOutboundMessageInput {
  messageId: string;
  conversationId: string | null;
  senderPhone: string;
  recipientPhone: string;
  messageType: string;
  messageText: string;
  rawPayload: unknown;
  mediaInfo?: Record<string, unknown> | null;
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

export type MessageDeliveryStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'failed';

export interface RecordDeliveryStatusInput {
  metaMessageId: string;
  status: MessageDeliveryStatus;
  errorCode?: string | null;
  errorMessageSanitized?: string | null;
  correlationId?: string | null;
  receivedAt: Date;
}

export interface RecordDeliveryStatusResult {
  matched: boolean;
  insertedEvent: boolean;
  currentStatus: MessageDeliveryStatus | null;
}

export interface MessageRepository {
  reserveInbound(input: ReserveInboundMessageInput): Promise<InboundMessage | null>;
  findByMessageId(messageId: string): Promise<InboundMessage | null>;
  findByIdempotencyKey(idempotencyKey: string): Promise<InboundMessage | null>;
  findByConversationId(conversationId: string, limit?: number): Promise<InboundMessage[]>;
  insertOutbound(input: InsertOutboundMessageInput): Promise<InsertedOutboundMessage>;
  recordDeliveryStatus(input: RecordDeliveryStatusInput): Promise<RecordDeliveryStatusResult>;
  updateState(input: UpdateMessageStateInput): Promise<void>;
  updateMediaInfo(messageId: string, mediaInfo: Record<string, unknown>): Promise<void>;
}

