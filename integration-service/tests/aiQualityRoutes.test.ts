import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApp } from '../src/app.js';

const testApiKey = 'test-integration-service-api-key-32chars-min';
const testsDir = dirname(fileURLToPath(import.meta.url));
const srcRoot = resolve(testsDir, '../src');

function createTestApp(aiSupervisorService: {
  requestAnalysis: ReturnType<typeof vi.fn>;
  saveFeedback: ReturnType<typeof vi.fn>;
}, overrides: {
  inboundWebhookService?: { process: ReturnType<typeof vi.fn> };
  outboundMessageService?: { send: ReturnType<typeof vi.fn> };
} = {}) {
  return createApp({
    inboundWebhookService: (overrides.inboundWebhookService ?? { process: vi.fn() }) as never,
    metaAppSecret: 'meta-secret',
    metaVerifyToken: 'verify-token',
    outboundMessageService: (overrides.outboundMessageService ?? { send: vi.fn() }) as never,
    integrationServiceApiKey: testApiKey,
    aiSupervisorService: aiSupervisorService as never,
  });
}

function signMetaBody(body: string): string {
  return `sha256=${createHmac('sha256', 'meta-secret').update(body).digest('hex')}`;
}

describe('AI quality internal routes', () => {
  it('requires Bearer authorization', async () => {
    const service = { requestAnalysis: vi.fn(), saveFeedback: vi.fn() };
    const app = createTestApp(service);

    const response = await request(app)
      .post('/internal/glpi/ai-quality/analyze')
      .send({ conversation_id: 'conv-1', glpi_ticket_id: 123 });

    expect(response.status).toBe(401);
    expect(service.requestAnalysis).not.toHaveBeenCalled();
  });

  it('starts manual analysis for a valid request', async () => {
    const service = {
      requestAnalysis: vi.fn().mockResolvedValue({
        id: '1',
        status: 'completed',
        conversationId: 'conv-1',
        glpiTicketId: 123,
      }),
      saveFeedback: vi.fn(),
    };
    const app = createTestApp(service);

    const response = await request(app)
      .post('/internal/glpi/ai-quality/analyze')
      .set('Authorization', `Bearer ${testApiKey}`)
      .send({ conversation_id: 'conv-1', glpi_ticket_id: 123, glpi_user_id: 7 });

    expect(response.status).toBe(200);
    expect(response.body.analysis.status).toBe('completed');
    expect(service.requestAnalysis).toHaveBeenCalledWith({
      conversationId: 'conv-1',
      glpiTicketId: 123,
      createdBy: 7,
    });
  });

  it('returns controlled disabled error', async () => {
    const service = {
      requestAnalysis: vi.fn().mockRejectedValue(new Error('AI_SUPERVISOR_DISABLED')),
      saveFeedback: vi.fn(),
    };
    const app = createTestApp(service);

    const response = await request(app)
      .post('/internal/glpi/ai-quality/analyze')
      .set('Authorization', `Bearer ${testApiKey}`)
      .send({ conversation_id: 'conv-1', ticket_id: 123 });

    expect(response.status).toBe(409);
    expect(response.body.error_code).toBe('AI_SUPERVISOR_DISABLED');
  });

  it('saves supervisor feedback', async () => {
    const service = {
      requestAnalysis: vi.fn(),
      saveFeedback: vi.fn().mockResolvedValue({
        id: '1',
        status: 'completed',
        supervisorFeedback: 'useful',
      }),
    };
    const app = createTestApp(service);

    const response = await request(app)
      .post('/internal/glpi/ai-quality/feedback')
      .set('Authorization', `Bearer ${testApiKey}`)
      .send({ analysis_id: '1', feedback: 'useful', feedback_notes: 'Ajuda na revisão.' });

    expect(response.status).toBe(200);
    expect(response.body.analysis.supervisorFeedback).toBe('useful');
    expect(service.saveFeedback).toHaveBeenCalledWith('1', 'useful', 'Ajuda na revisão.');
  });

  it('does not call AI supervisor from Meta webhook processing', async () => {
    const previousAllowedPhoneIds = process.env.ALLOWED_META_PHONE_NUMBER_IDS;
    process.env.ALLOWED_META_PHONE_NUMBER_IDS = 'phone-1';
    const service = { requestAnalysis: vi.fn(), saveFeedback: vi.fn() };
    const inboundWebhookService = { process: vi.fn().mockResolvedValue({ results: [] }) };
    const app = createTestApp(service, { inboundWebhookService });
    const body = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [{
        id: 'business-1',
        changes: [{
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            metadata: {
              phone_number_id: 'phone-1',
              display_phone_number: '5511300000000',
            },
            messages: [{
              id: 'wamid.1',
              from: '5511999999999',
              type: 'text',
              text: { body: 'Oi' },
            }],
          },
        }],
      }],
    });

    try {
      const response = await request(app)
        .post('/webhook/meta')
        .set('Content-Type', 'application/json')
        .set('X-Hub-Signature-256', signMetaBody(body))
        .send(body);

      expect(response.status).toBe(200);
      expect(inboundWebhookService.process).toHaveBeenCalledTimes(1);
      expect(service.requestAnalysis).not.toHaveBeenCalled();
    } finally {
      if (previousAllowedPhoneIds === undefined) {
        delete process.env.ALLOWED_META_PHONE_NUMBER_IDS;
      } else {
        process.env.ALLOWED_META_PHONE_NUMBER_IDS = previousAllowedPhoneIds;
      }
    }
  });

  it('does not call AI supervisor from outbound message sending', async () => {
    const service = { requestAnalysis: vi.fn(), saveFeedback: vi.fn() };
    const outboundMessageService = {
      send: vi.fn().mockResolvedValue({
        httpStatus: 200,
        body: {
          status: 'sent',
          message_id: 'row-1',
          provider_message_id: 'wamid.1',
          duplicate: false,
        },
      }),
    };
    const app = createTestApp(service, { outboundMessageService });

    const response = await request(app)
      .post('/internal/glpi/messages/outbound')
      .set('Authorization', `Bearer ${testApiKey}`)
      .send({
        ticket_id: 123,
        conversation_id: 'conv-1',
        text: 'Mensagem operacional.',
        glpi_user_id: 7,
        message_type: 'text',
      });

    expect(response.status).toBe(200);
    expect(outboundMessageService.send).toHaveBeenCalledTimes(1);
    expect(service.requestAnalysis).not.toHaveBeenCalled();
  });

  it('keeps AI supervisor out of inbound and outbound service implementations', async () => {
    const inbound = await readFile(resolve(srcRoot, 'domain/services/InboundWebhookService.ts'), 'utf8');
    const outbound = await readFile(resolve(srcRoot, 'domain/services/OutboundMessageService.ts'), 'utf8');

    expect(inbound).not.toContain('AiSupervisor');
    expect(inbound).not.toContain('aiSupervisor');
    expect(outbound).not.toContain('AiSupervisor');
    expect(outbound).not.toContain('aiSupervisor');
  });
});
