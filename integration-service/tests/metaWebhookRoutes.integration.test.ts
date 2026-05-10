import { createHmac } from 'node:crypto';

import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createApp } from '../src/app.js';

const testOutboundDeps = {
  outboundMessageService: {
    send: vi.fn(),
  } as never,
  integrationServiceApiKey: 'test-integration-service-api-key-32chars-min',
};

const basePayload = {
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
            messages: [
              {
                id: 'wamid.123',
                from: '5511999999999',
                type: 'text',
                text: {
                  body: 'hello',
                },
              },
            ],
          },
        },
      ],
    },
  ],
};

describe('Meta webhook routes', () => {
  it('validates the Meta challenge on GET /webhook/meta', async () => {
    const app = createApp({
      inboundWebhookService: {
        process: vi.fn(),
      } as never,
      metaAppSecret: 'meta-secret',
      metaVerifyToken: 'verify-token',
      ...testOutboundDeps,
    });

    const response = await request(app).get('/webhook/meta').query({
      'hub.mode': 'subscribe',
      'hub.verify_token': 'verify-token',
      'hub.challenge': 'challenge-value',
    });

    expect(response.status).toBe(200);
    expect(response.text).toBe('challenge-value');
  });

  it('rejects invalid verify_token on GET /webhook/meta', async () => {
    const app = createApp({
      inboundWebhookService: {
        process: vi.fn(),
      } as never,
      metaAppSecret: 'meta-secret',
      metaVerifyToken: 'verify-token',
      ...testOutboundDeps,
    });

    const response = await request(app).get('/webhook/meta').query({
      'hub.mode': 'subscribe',
      'hub.verify_token': 'wrong-token',
      'hub.challenge': 'challenge-value',
    });

    expect(response.status).toBe(403);
  });

  it('uses the signature middleware on POST /webhook/meta', async () => {
    const app = createApp({
      inboundWebhookService: {
        process: vi.fn().mockResolvedValue({
          results: [{ messageId: 'wamid.123', outcome: 'processed' }],
        }),
      } as never,
      metaAppSecret: 'meta-secret',
      metaVerifyToken: 'verify-token',
      ...testOutboundDeps,
    });

    const body = JSON.stringify(basePayload);
    const signature = createHmac('sha256', 'meta-secret').update(Buffer.from(body)).digest('hex');

    const response = await request(app)
      .post('/webhook/meta')
      .set('X-Hub-Signature-256', `sha256=${signature}`)
      .set('Content-Type', 'application/json')
      .send(body);

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('accepted');
  });

  it('passes an explicit correlation id to webhook processing', async () => {
    const process = vi.fn().mockResolvedValue({
      results: [{ messageId: 'wamid.123', outcome: 'processed' }],
    });
    const app = createApp({
      inboundWebhookService: { process } as never,
      metaAppSecret: 'meta-secret',
      metaVerifyToken: 'verify-token',
      ...testOutboundDeps,
    });

    const body = JSON.stringify(basePayload);
    const signature = createHmac('sha256', 'meta-secret').update(Buffer.from(body)).digest('hex');

    await request(app)
      .post('/webhook/meta')
      .set('X-Hub-Signature-256', `sha256=${signature}`)
      .set('X-Correlation-Id', 'WA-20260510153022-a8f3c2')
      .set('Content-Type', 'application/json')
      .send(body)
      .expect(200);

    expect(process).toHaveBeenCalledWith(basePayload, { correlationId: 'WA-20260510153022-a8f3c2' });
  });

  it('rejects invalid signature on POST /webhook/meta', async () => {
    const app = createApp({
      inboundWebhookService: {
        process: vi.fn(),
      } as never,
      metaAppSecret: 'meta-secret',
      metaVerifyToken: 'verify-token',
      ...testOutboundDeps,
    });

    const response = await request(app)
      .post('/webhook/meta')
      .set('X-Hub-Signature-256', 'sha256=deadbeef')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(basePayload));

    expect(response.status).toBe(401);
  });
});
