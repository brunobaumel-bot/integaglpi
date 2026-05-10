import type { InboundMediaMetadata, MetaWebhookPayload, ParsedMetaInboundMessage } from './metaWebhookTypes.js';

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
  } | undefined;
}): string | null {
  if (message.type === 'interactive' && message.interactive?.button_reply?.id) {
    return message.interactive.button_reply.id;
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

