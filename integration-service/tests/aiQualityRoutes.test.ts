import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createApp } from '../src/app.js';

const testApiKey = 'test-integration-service-api-key-32chars-min';

function createTestApp(aiSupervisorService: {
  requestAnalysis: ReturnType<typeof vi.fn>;
  saveFeedback: ReturnType<typeof vi.fn>;
}) {
  return createApp({
    inboundWebhookService: { process: vi.fn() } as never,
    metaAppSecret: 'meta-secret',
    metaVerifyToken: 'verify-token',
    outboundMessageService: { send: vi.fn() } as never,
    integrationServiceApiKey: testApiKey,
    aiSupervisorService: aiSupervisorService as never,
  });
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
});
