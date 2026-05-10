import { describe, expect, it } from 'vitest';

import { parseMetaInboundMessages } from '../src/adapters/meta/parseMetaWebhookPayload.js';
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
});
