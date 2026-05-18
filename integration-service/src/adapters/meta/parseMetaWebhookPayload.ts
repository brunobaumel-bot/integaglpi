import type {
  InboundMediaMetadata,
  MetaWebhookPayload,
  ParsedMetaInboundMessage,
  ParsedMetaStatusUpdate,
} from './metaWebhookTypes.js';

function extractMediaMetadata(message: {
  type: string;
  image?: { id: string; mime_type?: string; caption?: string } | undefined;
  document?: { id: string; mime_type?: string; filename?: string; caption?: string } | undefined;
  audio?: { id: string; mime_type?: string } | undefined;
}): InboundMediaMetadata | null {
  if (message.type === 'image' && message.image) {
    return {
      mediaId: message.image.id,
      mimeTypeFromWebhook: message.image.mime_type ?? null,
      fileName: null,
      caption: message.image.caption ?? null,
    };
  }
  if (message.type === 'document' && message.document) {
    return {
      mediaId: message.document.id,
      mimeTypeFromWebhook: message.document.mime_type ?? null,
      fileName: message.document.filename ?? null,
      caption: message.document.caption ?? null,
    };
  }
  if (message.type === 'audio' && message.audio) {
    return {
      mediaId: message.audio.id,
      mimeTypeFromWebhook: message.audio.mime_type ?? null,
      fileName: null,
      caption: null,
    };
  }
  return null;
}

function extractMessageText(message: {
  type: string;
  text?: { body?: string } | undefined;
  interactive?: {
    type?: string;
    button_reply?: { id?: string; title?: string } | undefined;
    list_reply?: { id?: string; title?: string; description?: string } | undefined;
  } | undefined;
}): string | null {
  if (message.type === 'interactive' && message.interactive?.button_reply?.id) {
    return message.interactive.button_reply.id;
  }
  if (message.type === 'interactive' && message.interactive?.list_reply?.id) {
    return message.interactive.list_reply.id;
  }

  return message.text?.body ?? null;
}

export function parseMetaInboundMessages(payload: MetaWebhookPayload): ParsedMetaInboundMessage[] {
  const parsedMessages: ParsedMetaInboundMessage[] = [];

  for (const entry of payload.entry) {
    for (const change of entry.changes) {
      const recipientPhone = change.value.metadata?.display_phone_number ?? '';
      const contactName = change.value.contacts?.[0]?.profile?.name ?? null;
      const messages = change.value.messages ?? [];

      for (const message of messages) {
        parsedMessages.push({
          eventId: `${entry.id}:${change.field}:${message.id}`,
          eventType: 'message',
          messageId: message.id,
          senderPhone: message.from,
          recipientPhone,
          messageType: message.type,
          messageText: extractMessageText(message),
          mediaMetadata: extractMediaMetadata(message),
          contactName,
          timestamp: message.timestamp ?? null,
          rawPayload: payload,
        });
      }
    }
  }

  return parsedMessages;
}

export function parseMetaStatusUpdates(payload: MetaWebhookPayload): ParsedMetaStatusUpdate[] {
  const parsedStatuses: ParsedMetaStatusUpdate[] = [];

  for (const entry of payload.entry) {
    for (const change of entry.changes) {
      const statuses = change.value.statuses ?? [];

      for (const status of statuses) {
        const metaMessageId = readString(status, 'id');
        const statusValue = readString(status, 'status');
        if (metaMessageId === '' || statusValue === '') {
          continue;
        }

        const error = readFirstError(status);
        parsedStatuses.push({
          eventId: `${entry.id}:${change.field}:status:${metaMessageId}:${statusValue}`,
          eventType: 'status',
          metaMessageId,
          status: statusValue,
          timestamp: readString(status, 'timestamp') || null,
          recipientId: readString(status, 'recipient_id') || null,
          errorCode: error.code,
          errorMessage: error.message,
        });
      }
    }
  }

  return parsedStatuses;
}

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === 'string' ? value.trim() : '';
}

function readFirstError(status: Record<string, unknown>): { code: string | null; message: string | null } {
  const errors = status.errors;
  if (!Array.isArray(errors) || errors.length === 0) {
    return { code: null, message: null };
  }

  const first = errors[0];
  if (!first || typeof first !== 'object' || Array.isArray(first)) {
    return { code: null, message: null };
  }

  const errorRecord = first as Record<string, unknown>;
  const codeValue = errorRecord.code;
  const code = typeof codeValue === 'number' || typeof codeValue === 'string'
    ? String(codeValue)
    : null;
  const title = typeof errorRecord.title === 'string' ? errorRecord.title : '';
  const message = typeof errorRecord.message === 'string' ? errorRecord.message : '';
  const details = readErrorDetails(errorRecord.error_data);
  const combined = [title, message, details].map((part) => part.trim()).filter(Boolean).join(' - ');

  return {
    code,
    message: combined === '' ? null : combined,
  };
}

function readErrorDetails(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return '';
  }

  const details = (value as Record<string, unknown>).details;
  return typeof details === 'string' ? details : '';
}

