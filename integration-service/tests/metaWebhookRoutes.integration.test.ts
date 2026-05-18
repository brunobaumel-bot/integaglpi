import { createHmac } from 'node:crypto';

import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../src/app.js';
import { logger } from '../src/infra/logger/logger.js';

const originalMetaPhoneNumberId = process.env.META_PHONE_NUMBER_ID;
const originalAllowedMetaPhoneNumberIds = process.env.ALLOWED_META_PHONE_NUMBER_IDS;
const originalAllowedMetaDisplayPhoneNumbers = process.env.ALLOWED_META_DISPLAY_PHONE_NUMBERS;
const originalAllowedMetaPhoneId = process.env.ALLOWED_META_PHONE_ID;
const allowedPhoneNumberId = '1050089564861532';

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
              phone_number_id: allowedPhoneNumberId,
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

function signBody(body: string): string {
  return createHmac('sha256', 'meta-secret').update(Buffer.from(body)).digest('hex');
}

describe('Meta webhook routes', () => {
  beforeEach(() => {
    process.env.META_PHONE_NUMBER_ID = allowedPhoneNumberId;
    process.env.ALLOWED_META_PHONE_NUMBER_IDS = allowedPhoneNumberId;
    delete process.env.ALLOWED_META_DISPLAY_PHONE_NUMBERS;
    delete process.env.ALLOWED_META_PHONE_ID;
  });

  afterEach(() => {
    if (originalMetaPhoneNumberId === undefined) {
      delete process.env.META_PHONE_NUMBER_ID;
    } else {
      process.env.META_PHONE_NUMBER_ID = originalMetaPhoneNumberId;
    }
    if (originalAllowedMetaPhoneNumberIds === undefined) {
      delete process.env.ALLOWED_META_PHONE_NUMBER_IDS;
    } else {
      process.env.ALLOWED_META_PHONE_NUMBER_IDS = originalAllowedMetaPhoneNumberIds;
    }
    if (originalAllowedMetaDisplayPhoneNumbers === undefined) {
      delete process.env.ALLOWED_META_DISPLAY_PHONE_NUMBERS;
    } else {
      process.env.ALLOWED_META_DISPLAY_PHONE_NUMBERS = originalAllowedMetaDisplayPhoneNumbers;
    }
    if (originalAllowedMetaPhoneId === undefined) {
      delete process.env.ALLOWED_META_PHONE_ID;
    } else {
      process.env.ALLOWED_META_PHONE_ID = originalAllowedMetaPhoneId;
    }
    vi.restoreAllMocks();
  });

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
    const signature = signBody(body);

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
    const signature = signBody(body);

    await request(app)
      .post('/webhook/meta')
      .set('X-Hub-Signature-256', `sha256=${signature}`)
      .set('X-Correlation-Id', 'WA-20260510153022-a8f3c2')
      .set('Content-Type', 'application/json')
      .send(body)
      .expect(200);

    expect(process).toHaveBeenCalledWith(basePayload, { correlationId: 'WA-20260510153022-a8f3c2' });
  });

  it('drops a webhook from an unauthorized phone_number_id without calling inbound processing', async () => {
    const process = vi.fn();
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const app = createApp({
      inboundWebhookService: { process } as never,
      metaAppSecret: 'meta-secret',
      metaVerifyToken: 'verify-token',
      ...testOutboundDeps,
    });
    const foreignPayload = {
      ...basePayload,
      entry: [
        {
          id: 'entry-foreign',
          changes: [
            {
              ...basePayload.entry[0].changes[0],
              value: {
                ...basePayload.entry[0].changes[0].value,
                metadata: {
                  display_phone_number: '5530336404',
                  phone_number_id: 'prod-phone-number-id',
                },
              },
            },
          ],
        },
      ],
    };
    const body = JSON.stringify(foreignPayload);
    const signature = signBody(body);

    const response = await request(app)
      .post('/webhook/meta')
      .set('X-Hub-Signature-256', `sha256=${signature}`)
      .set('Content-Type', 'application/json')
      .send(body);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      status: 'ignored',
      ignored: true,
      reason: 'unauthorized_number',
    });
    expect(process).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'DROPPED_UNAUTHORIZED_NUMBER',
        reason: 'unauthorized_number',
        expected_policy: 'allowed_phone_number_ids_configured',
        received_phone_ids_masked: expect.not.arrayContaining(['prod-phone-number-id']),
        received_display_phone_numbers_masked: expect.not.arrayContaining(['5530336404']),
      }),
      '[integration-service][security][DROPPED_UNAUTHORIZED_NUMBER]',
    );
  });

  it('drops the whole webhook when a mixed phone_number_id payload contains any unauthorized change', async () => {
    const process = vi.fn().mockResolvedValue({
      results: [{ messageId: 'wamid.allowed', outcome: 'processed' }],
    });
    const app = createApp({
      inboundWebhookService: { process } as never,
      metaAppSecret: 'meta-secret',
      metaVerifyToken: 'verify-token',
      ...testOutboundDeps,
    });
    const allowedChange = {
      ...basePayload.entry[0].changes[0],
      value: {
        ...basePayload.entry[0].changes[0].value,
        messages: [
          {
            id: 'wamid.allowed',
            from: '5511999999999',
            type: 'text',
            text: { body: 'allowed' },
          },
        ],
      },
    };
    const foreignChange = {
      ...basePayload.entry[0].changes[0],
      value: {
        ...basePayload.entry[0].changes[0].value,
        metadata: {
          display_phone_number: '5530336404',
          phone_number_id: 'prod-phone-number-id',
        },
        messages: [
          {
            id: 'wamid.foreign',
            from: '5511888888888',
            type: 'text',
            text: { body: 'foreign' },
          },
        ],
      },
    };
    const mixedPayload = {
      ...basePayload,
      entry: [
        {
          id: 'entry-mixed',
          changes: [foreignChange, allowedChange],
        },
      ],
    };
    const body = JSON.stringify(mixedPayload);
    const signature = signBody(body);

    const response = await request(app)
      .post('/webhook/meta')
      .set('X-Hub-Signature-256', `sha256=${signature}`)
      .set('Content-Type', 'application/json')
      .send(body);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      status: 'ignored',
      ignored: true,
      reason: 'unauthorized_number',
    });
    expect(process).not.toHaveBeenCalled();
  });

  it('preserves authorized status webhook processing', async () => {
    const process = vi.fn().mockResolvedValue({
      results: [{ messageId: 'wamid.status', outcome: 'processed' }],
    });
    const app = createApp({
      inboundWebhookService: { process } as never,
      metaAppSecret: 'meta-secret',
      metaVerifyToken: 'verify-token',
      ...testOutboundDeps,
    });
    const statusPayload = {
      ...basePayload,
      entry: [
        {
          id: 'entry-status',
          changes: [
            {
              field: 'messages',
              value: {
                metadata: {
                  display_phone_number: '5511300000000',
                  phone_number_id: allowedPhoneNumberId,
                },
                statuses: [
                  {
                    id: 'wamid.status',
                    status: 'delivered',
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    const body = JSON.stringify(statusPayload);
    const signature = signBody(body);

    const response = await request(app)
      .post('/webhook/meta')
      .set('X-Hub-Signature-256', `sha256=${signature}`)
      .set('Content-Type', 'application/json')
      .send(body);

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('accepted');
    expect(process).toHaveBeenCalledWith(statusPayload, expect.any(Object));
  });

  it('drops unauthorized status webhook without calling inbound processing', async () => {
    const process = vi.fn();
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const app = createApp({
      inboundWebhookService: { process } as never,
      metaAppSecret: 'meta-secret',
      metaVerifyToken: 'verify-token',
      ...testOutboundDeps,
    });
    const statusPayload = {
      ...basePayload,
      entry: [
        {
          id: 'entry-status',
          changes: [
            {
              field: 'messages',
              value: {
                metadata: {
                  display_phone_number: '5530336404',
                  phone_number_id: 'prod-phone-number-id',
                },
                statuses: [
                  {
                    id: 'wamid.status',
                    status: 'delivered',
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    const body = JSON.stringify(statusPayload);
    const signature = signBody(body);

    const response = await request(app)
      .post('/webhook/meta')
      .set('X-Hub-Signature-256', `sha256=${signature}`)
      .set('Content-Type', 'application/json')
      .send(body);

    expect(response.status).toBe(200);
    expect(response.body.reason).toBe('unauthorized_number');
    expect(process).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'DROPPED_UNAUTHORIZED_NUMBER',
        webhook_event_type: 'status',
      }),
      '[integration-service][security][DROPPED_UNAUTHORIZED_NUMBER]',
    );
  });

  it('drops webhook without metadata before inbound processing', async () => {
    const process = vi.fn();
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const app = createApp({
      inboundWebhookService: { process } as never,
      metaAppSecret: 'meta-secret',
      metaVerifyToken: 'verify-token',
      ...testOutboundDeps,
    });
    const missingMetadataPayload = {
      ...basePayload,
      entry: [
        {
          id: 'entry-missing-metadata',
          changes: [
            {
              ...basePayload.entry[0].changes[0],
              value: {
                ...basePayload.entry[0].changes[0].value,
                metadata: undefined,
              },
            },
          ],
        },
      ],
    };
    const body = JSON.stringify(missingMetadataPayload);
    const signature = signBody(body);

    const response = await request(app)
      .post('/webhook/meta')
      .set('X-Hub-Signature-256', `sha256=${signature}`)
      .set('Content-Type', 'application/json')
      .send(body);

    expect(response.status).toBe(200);
    expect(response.body.reason).toBe('missing_metadata');
    expect(process).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'DROPPED_MISSING_META_METADATA',
      }),
      '[integration-service][security][DROPPED_MISSING_META_METADATA]',
    );
  });

  it('drops webhook when phone guard is not configured before inbound processing', async () => {
    delete process.env.ALLOWED_META_PHONE_NUMBER_IDS;
    delete process.env.ALLOWED_META_PHONE_ID;
    const processWebhook = vi.fn();
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const app = createApp({
      inboundWebhookService: { process: processWebhook } as never,
      metaAppSecret: 'meta-secret',
      metaVerifyToken: 'verify-token',
      ...testOutboundDeps,
    });
    const body = JSON.stringify(basePayload);
    const signature = signBody(body);

    const response = await request(app)
      .post('/webhook/meta')
      .set('X-Hub-Signature-256', `sha256=${signature}`)
      .set('Content-Type', 'application/json')
      .send(body);

    expect(response.status).toBe(200);
    expect(response.body.reason).toBe('not_configured');
    expect(processWebhook).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'META_PHONE_GUARD_NOT_CONFIGURED',
      }),
      '[integration-service][security][META_PHONE_GUARD_NOT_CONFIGURED]',
    );
  });

  it('enforces optional normalized display phone allowlist', async () => {
    process.env.ALLOWED_META_DISPLAY_PHONE_NUMBERS = '+55 (11) 30000-0000';
    const processWebhook = vi.fn().mockResolvedValue({
      results: [{ messageId: 'wamid.123', outcome: 'processed' }],
    });
    const app = createApp({
      inboundWebhookService: { process: processWebhook } as never,
      metaAppSecret: 'meta-secret',
      metaVerifyToken: 'verify-token',
      ...testOutboundDeps,
    });
    const body = JSON.stringify(basePayload);
    const signature = signBody(body);

    const response = await request(app)
      .post('/webhook/meta')
      .set('X-Hub-Signature-256', `sha256=${signature}`)
      .set('Content-Type', 'application/json')
      .send(body);

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('accepted');
    expect(processWebhook).toHaveBeenCalledTimes(1);
  });

  it('drops webhook when optional display phone allowlist does not match', async () => {
    process.env.ALLOWED_META_DISPLAY_PHONE_NUMBERS = '+55 (41) 9999-9999';
    const processWebhook = vi.fn();
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const app = createApp({
      inboundWebhookService: { process: processWebhook } as never,
      metaAppSecret: 'meta-secret',
      metaVerifyToken: 'verify-token',
      ...testOutboundDeps,
    });
    const body = JSON.stringify(basePayload);
    const signature = signBody(body);

    const response = await request(app)
      .post('/webhook/meta')
      .set('X-Hub-Signature-256', `sha256=${signature}`)
      .set('Content-Type', 'application/json')
      .send(body);

    expect(response.status).toBe(200);
    expect(response.body.reason).toBe('unauthorized_number');
    expect(processWebhook).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'DROPPED_UNAUTHORIZED_NUMBER',
        expected_policy: 'allowed_phone_number_ids_and_display_phone_numbers_configured',
      }),
      '[integration-service][security][DROPPED_UNAUTHORIZED_NUMBER]',
    );
  });

  it('supports legacy ALLOWED_META_PHONE_ID when plural allowlist is absent', async () => {
    delete process.env.ALLOWED_META_PHONE_NUMBER_IDS;
    process.env.ALLOWED_META_PHONE_ID = allowedPhoneNumberId;
    const processWebhook = vi.fn().mockResolvedValue({
      results: [{ messageId: 'wamid.123', outcome: 'processed' }],
    });
    const app = createApp({
      inboundWebhookService: { process: processWebhook } as never,
      metaAppSecret: 'meta-secret',
      metaVerifyToken: 'verify-token',
      ...testOutboundDeps,
    });
    const body = JSON.stringify(basePayload);
    const signature = signBody(body);

    const response = await request(app)
      .post('/webhook/meta')
      .set('X-Hub-Signature-256', `sha256=${signature}`)
      .set('Content-Type', 'application/json')
      .send(body);

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('accepted');
    expect(processWebhook).toHaveBeenCalledTimes(1);
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
