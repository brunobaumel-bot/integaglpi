import { describe, expect, it } from 'vitest';

import { parseMetaInboundMessages, parseMetaStatusUpdates } from '../src/adapters/meta/parseMetaWebhookPayload.js';
import type { MetaWebhookPayload } from '../src/adapters/meta/metaWebhookTypes.js';

function payloadWithMessage(message: Record<string, unknown>): MetaWebhookPayload {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'entry-1',
        changes: [
          {
            field: 'messages',
            value: {
              metadata: {
                display_phone_number: '5511300000000',
              },
              contacts: [
                {
                  profile: { name: 'Cliente' },
                  wa_id: '5511999999999',
                },
              ],
              messages: [message as never],
            },
          },
        ],
      },
    ],
  };
}

function payloadWithStatus(status: Record<string, unknown>): MetaWebhookPayload {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'entry-1',
        changes: [
          {
            field: 'messages',
            value: {
              metadata: {
                display_phone_number: '5511300000000',
                phone_number_id: '1050089564861532',
              },
              statuses: [status],
            },
          },
        ],
      },
    ],
  };
}

describe('parseMetaInboundMessages', () => {
  it('preserves normal text messages', () => {
    const [message] = parseMetaInboundMessages(payloadWithMessage({
      id: 'wamid.text',
      from: '5511999999999',
      type: 'text',
      text: { body: 'ola' },
    }));

    expect(message?.messageType).toBe('text');
    expect(message?.messageText).toBe('ola');
  });

  it('extracts interactive button_reply id as message text', () => {
    const [message] = parseMetaInboundMessages(payloadWithMessage({
      id: 'wamid.button',
      from: '5511999999999',
      type: 'interactive',
      interactive: {
        type: 'button_reply',
        button_reply: {
          id: 'suporte',
          title: 'Suporte',
        },
      },
    }));

    expect(message?.messageType).toBe('interactive');
    expect(message?.messageText).toBe('suporte');
    expect(message?.rawPayload.entry[0]?.changes[0]?.value.messages?.[0]).toMatchObject({
      interactive: {
        button_reply: {
          id: 'suporte',
          title: 'Suporte',
        },
      },
    });
  });

  it('keeps document media metadata extraction unchanged', () => {
    const [message] = parseMetaInboundMessages(payloadWithMessage({
      id: 'wamid.doc',
      from: '5511999999999',
      type: 'document',
      document: {
        id: 'media-doc',
        mime_type: 'application/pdf',
        filename: 'arquivo.pdf',
      },
    }));

    expect(message?.messageType).toBe('document');
    expect(message?.messageText).toBeNull();
    expect(message?.mediaMetadata).toEqual({
      mediaId: 'media-doc',
      mimeTypeFromWebhook: 'application/pdf',
      fileName: 'arquivo.pdf',
      caption: null,
    });
  });

  it('extracts WhatsApp reply context and video media metadata', () => {
    const [message] = parseMetaInboundMessages(payloadWithMessage({
      id: 'wamid.video-reply',
      from: '5511999999999',
      type: 'video',
      context: {
        id: 'wamid.original',
        from: '5511300000000',
      },
      video: {
        id: 'media-video',
        mime_type: 'video/mp4',
        caption: 'Veja o erro',
      },
    }));

    expect(message?.messageType).toBe('video');
    expect(message?.replyContext).toEqual({
      messageId: 'wamid.original',
      from: '5511300000000',
    });
    expect(message?.mediaMetadata).toEqual({
      mediaId: 'media-video',
      mimeTypeFromWebhook: 'video/mp4',
      fileName: null,
      caption: 'Veja o erro',
    });
  });
});

describe('parseMetaStatusUpdates', () => {
  it('extracts Meta statuses with WAMID, recipient, timestamp and error details', () => {
    const [status] = parseMetaStatusUpdates(payloadWithStatus({
      id: 'wamid.delivery',
      status: 'failed',
      timestamp: '1779028800',
      recipient_id: '5541999999999',
      errors: [{
        code: 131047,
        title: 'Re-engagement message',
        message: 'Message failed',
        error_data: { details: 'Use a template' },
      }],
    }));

    expect(status).toEqual({
      eventId: 'entry-1:messages:status:wamid.delivery:failed',
      eventType: 'status',
      metaMessageId: 'wamid.delivery',
      status: 'failed',
      timestamp: '1779028800',
      recipientId: '5541999999999',
      errorCode: '131047',
      errorMessage: 'Re-engagement message - Message failed - Use a template',
    });
  });

  it('ignores incomplete statuses without id or status', () => {
    expect(parseMetaStatusUpdates(payloadWithStatus({ id: 'wamid.no-status' }))).toEqual([]);
    expect(parseMetaStatusUpdates(payloadWithStatus({ status: 'delivered' }))).toEqual([]);
  });
});
