import type { Contact } from '../../domain/entities/Contact.js';
import type { Conversation } from '../../domain/entities/Conversation.js';
import type { InboundMessage } from '../../domain/entities/InboundMessage.js';
import type { WebhookEvent } from '../../domain/entities/WebhookEvent.js';

interface ContactRow {
  id: string;
  phone_e164: string;
  glpi_contact_id: number | null;
  glpi_user_id: number | null;
  name: string | null;
  source: string;
  cache_key: string;
  created_at: Date;
  updated_at: Date;
}

interface ConversationRow {
  id: string;
  phone_e164: string;
  contact_id: string;
  glpi_ticket_id: number | null;
  queue_id?: number | null;
  status: string;
  last_message_at: Date;
  created_at: Date;
  updated_at: Date;
}

interface InboundMessageRow {
  id: string;
  conversation_id: string | null;
  message_id: string;
  direction: string;
  sender_phone: string;
  recipient_phone: string;
  message_type: string;
  message_text: string | null;
  raw_payload: unknown;
  media_info: Record<string, unknown> | null | undefined;
  processing_status: InboundMessage['processingStatus'];
  glpi_sync_status: InboundMessage['glpiSyncStatus'];
  created_at: Date;
  updated_at: Date;
}

interface WebhookEventRow {
  event_id: string;
  event_type: string;
  payload: unknown;
  signature_valid: boolean;
  received_at: Date;
  processing_status: WebhookEvent['processingStatus'];
  created_at: Date;
}

export function mapContactRow(row: ContactRow): Contact {
  return {
    id: row.id,
    phoneE164: row.phone_e164,
    glpiContactId: row.glpi_contact_id,
    glpiUserId: row.glpi_user_id,
    name: row.name,
    source: row.source,
    cacheKey: row.cache_key,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapConversationRow(row: ConversationRow): Conversation {
  return {
    id: row.id,
    phoneE164: row.phone_e164,
    contactId: row.contact_id,
    glpiTicketId: row.glpi_ticket_id,
    queueId: row.queue_id ?? null,
    status: row.status,
    lastMessageAt: row.last_message_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapInboundMessageRow(row: InboundMessageRow): InboundMessage {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    messageId: row.message_id,
    direction: row.direction,
    senderPhone: row.sender_phone,
    recipientPhone: row.recipient_phone,
    messageType: row.message_type,
    messageText: row.message_text,
    rawPayload: row.raw_payload,
    mediaInfo: row.media_info ?? null,
    processingStatus: row.processing_status,
    glpiSyncStatus: row.glpi_sync_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapWebhookEventRow(row: WebhookEventRow): WebhookEvent {
  return {
    eventId: row.event_id,
    eventType: row.event_type,
    payload: row.payload,
    signatureValid: row.signature_valid,
    receivedAt: row.received_at,
    processingStatus: row.processing_status,
    createdAt: row.created_at,
  };
}

