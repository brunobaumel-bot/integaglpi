import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createApp } from '../src/app.js';

const testApiKey = 'test-integration-service-api-key-32chars-min';

describe('POST /internal/glpi/messages/outbound', () => {
  it('returns 401 without credentials', async () => {
    const app = createApp({
      inboundWebhookService: { process: vi.fn() } as never,
      metaAppSecret: 'meta-secret',
      metaVerifyToken: 'verify-token',
      outboundMessageService: { send: vi.fn() } as never,
      integrationServiceApiKey: testApiKey,
    });

    const response = await request(app).post('/internal/glpi/messages/outbound').send({
      ticket_id: 1,
      conversation_id: 'conv-1',
      text: 'hello',
      message_type: 'text',
      glpi_user_id: 2,
    });

    expect(response.status).toBe(401);
    expect(response.body.error_code).toBe('UNAUTHORIZED');
  });

  it('returns 401 for wrong API key', async () => {
    const app = createApp({
      inboundWebhookService: { process: vi.fn() } as never,
      metaAppSecret: 'meta-secret',
      metaVerifyToken: 'verify-token',
      outboundMessageService: { send: vi.fn() } as never,
      integrationServiceApiKey: testApiKey,
    });

    const response = await request(app)
      .post('/internal/glpi/messages/outbound')
      .set('Authorization', 'Bearer wrong-key-not-matching-length-32chars!')
      .send({
        ticket_id: 1,
        conversation_id: 'conv-1',
        text: 'hello',
        message_type: 'text',
        glpi_user_id: 2,
      });

    expect(response.status).toBe(401);
  });

  it('rejects legacy X-Integaglpi-Api-Key header', async () => {
    const send = vi.fn().mockResolvedValue({
      httpStatus: 201,
      body: {
        status: 'sent',
        message_id: 'mock.wamid.test',
        conversation_id: 'conv-1',
        postgres_message_row_id: 'row-1',
        idempotent: false,
      },
    });

    const app = createApp({
      inboundWebhookService: { process: vi.fn() } as never,
      metaAppSecret: 'meta-secret',
      metaVerifyToken: 'verify-token',
      outboundMessageService: { send } as never,
      integrationServiceApiKey: testApiKey,
    });

    const response = await request(app)
      .post('/internal/glpi/messages/outbound')
      .set('X-Integaglpi-Api-Key', testApiKey)
      .send({
        ticket_id: 1,
        conversation_id: 'conv-1',
        text: 'hello',
        message_type: 'text',
        glpi_user_id: 2,
      });

    expect(send).not.toHaveBeenCalled();
    expect(response.status).toBe(401);
    expect(response.body.error_code).toBe('UNAUTHORIZED');
  });

  it('accepts outbound document payloads through the Bearer-protected endpoint', async () => {
    const send = vi.fn().mockResolvedValue({
      httpStatus: 201,
      body: {
        status: 'sent',
        message_id: 'wamid.document',
        conversation_id: 'conv-1',
        postgres_message_row_id: 'row-1',
        idempotent: false,
      },
    });

    const app = createApp({
      inboundWebhookService: { process: vi.fn() } as never,
      metaAppSecret: 'meta-secret',
      metaVerifyToken: 'verify-token',
      outboundMessageService: { send } as never,
      integrationServiceApiKey: testApiKey,
    });

    const response = await request(app)
      .post('/internal/glpi/messages/outbound')
      .set('Authorization', `Bearer ${testApiKey}`)
      .send({
        ticket_id: 1,
        conversation_id: 'conv-1',
        text: 'Anexo do chamado #1: relatorio.pdf.',
        message_type: 'document',
        glpi_user_id: 2,
        idempotency_key: 'notify_document_1_12345',
        media: {
          document_id: 55,
          filename: 'relatorio.pdf',
          mime_type: 'application/pdf',
          content_base64: Buffer.from('%PDF-1.4').toString('base64'),
        },
      });

    expect(response.status).toBe(201);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        message_type: 'document',
        media: expect.objectContaining({
          filename: 'relatorio.pdf',
          mime_type: 'application/pdf',
        }),
      }),
      expect.objectContaining({
        correlationId: expect.stringMatching(/^WA-\d{14}-[a-f0-9]{6}$/),
      }),
    );
  });

  it('uses the larger JSON limit only for outbound media payloads', async () => {
    const send = vi.fn().mockResolvedValue({
      httpStatus: 201,
      body: {
        status: 'sent',
        message_id: 'wamid.document.large',
        conversation_id: 'conv-1',
        postgres_message_row_id: 'row-1',
        idempotent: false,
      },
    });

    const app = createApp({
      inboundWebhookService: { process: vi.fn() } as never,
      metaAppSecret: 'meta-secret',
      metaVerifyToken: 'verify-token',
      outboundMessageService: { send } as never,
      integrationServiceApiKey: testApiKey,
    });
    const contentBase64 = Buffer.alloc(160_000, 0x61).toString('base64');

    const response = await request(app)
      .post('/internal/glpi/messages/outbound')
      .set('Authorization', `Bearer ${testApiKey}`)
      .send({
        ticket_id: 1,
        conversation_id: 'conv-1',
        text: 'Anexo do chamado #1: relatorio.pdf.',
        message_type: 'document',
        glpi_user_id: 2,
        idempotency_key: 'notify_document_1_large',
        media: {
          document_id: 56,
          filename: 'relatorio.pdf',
          mime_type: 'application/pdf',
          content_base64: contentBase64,
        },
      });

    expect(response.status).toBe(201);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        message_type: 'document',
        media: expect.objectContaining({ content_base64: contentBase64 }),
      }),
      expect.any(Object),
    );
  });
});

describe('POST /internal/glpi/notifications/ticket-solved', () => {
  it('dispatches solved notification payload to outbound service', async () => {
    const sendSolutionApprovalRequest = vi.fn().mockResolvedValue({
      httpStatus: 201,
      body: {
        status: 'sent',
        message_id: 'mock.wamid.solution',
        conversation_id: 'conv-1',
        postgres_message_row_id: 'row-1',
        idempotent: false,
      },
    });

    const app = createApp({
      inboundWebhookService: { process: vi.fn() } as never,
      metaAppSecret: 'meta-secret',
      metaVerifyToken: 'verify-token',
      outboundMessageService: { send: vi.fn(), sendSolutionApprovalRequest } as never,
      integrationServiceApiKey: testApiKey,
    });

    const response = await request(app)
      .post('/internal/glpi/notifications/ticket-solved')
      .set('Authorization', `Bearer ${testApiKey}`)
      .send({
        ticket_id: 1234,
        conversation_id: 'conv-1',
        glpi_user_id: 2,
        idempotency_key: 'notify_ticket_solved_1234_77',
        solution_id: 77,
        solution_content: '<p>Problema corrigido.</p>',
        solution_status: 2,
      });

    expect(sendSolutionApprovalRequest).toHaveBeenCalledWith(
      {
        ticket_id: 1234,
        conversation_id: 'conv-1',
        glpi_user_id: 2,
        idempotency_key: 'notify_ticket_solved_1234_77',
        solution_id: 77,
        solution_content: '<p>Problema corrigido.</p>',
        solution_status: 2,
      },
      expect.objectContaining({
        correlationId: expect.stringMatching(/^WA-\d{14}-[a-f0-9]{6}$/),
      }),
    );
    expect(response.status).toBe(201);
    expect(response.body.message_id).toBe('mock.wamid.solution');
  });
});
