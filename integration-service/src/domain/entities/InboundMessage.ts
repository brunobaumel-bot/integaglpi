import type { GlpiSyncStatus } from '../types/GlpiSyncStatus.js';
import type { MessageProcessingStatus } from '../types/MessageProcessingStatus.js';

export interface InboundMessage {
  id: string;
  conversationId: string | null;
  messageId: string;
  direction: string;
  senderPhone: string;
  recipientPhone: string;
  messageType: string;
  messageText: string | null;
  rawPayload: unknown;
  mediaInfo: Record<string, unknown> | null;
  processingStatus: MessageProcessingStatus;
  glpiSyncStatus: GlpiSyncStatus;
  metaMessageId: string | null;
  deliveryStatus: string | null;
  deliveryStatusUpdatedAt: Date | null;
  metaErrorCode: string | null;
  metaErrorMessageSanitized: string | null;
  createdAt: Date;
  updatedAt: Date;
}

