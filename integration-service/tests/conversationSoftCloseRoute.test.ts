import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createApp } from '../src/app.js';
import { ConversationSoftCloseError } from '../src/domain/services/ConversationSoftCloseService.js';

const testApiKey = 'test-integration-service-api-key-32chars-min';

function createTestApp(softClose = vi.fn()) {
  return createApp({
    inboundWebhookService: { process: vi.fn() } as never,
    metaAppSecret: 'meta-secret',
    metaVerifyToken: 'verify-token',
    outboundMessageService: { send: vi.fn() } as never,
    conversationSoftCloseService: { softClose } as never,
    integrationServiceApiKey: testApiKey,
  });
}

describe('POST /internal/glpi/conversations/:conversation_id/soft-close', () => {
  it('requires Bearer authorization', async () => {
    const softClose = vi.fn();
    const app = createTestApp(softClose);

    const response = await request(app)
      .post('/internal/glpi/conversations/conv-1/soft-close')
      .set('X-Integaglpi-Api-Key', testApiKey)
      .send({ reason: 'Abandonada', glpi_user_id: 7, permission_validated: true });

    expect(response.status).toBe(401);
    expect(softClose).not.toHaveBeenCalled();
  });

  it('requires permission validation from the plugin', async () => {
    const softClose = vi.fn();
    const app = createTestApp(softClose);

    const response = await request(app)
      .post('/internal/glpi/conversations/conv-1/soft-close')
      .set('Authorization', `Bearer ${testApiKey}`)
      .send({ reason: 'Abandonada', glpi_user_id: 7 });

    expect(response.status).toBe(403);
    expect(response.body.error_code).toBe('PERMISSION_NOT_VALIDATED');
    expect(softClose).not.toHaveBeenCalled();
  });

  it('passes operator and reason to the service', async () => {
    const softClose = vi.fn().mockResolvedValue({
      status: 'cancelled',
      conversationId: 'conv-1',
      previousStatus: 'awaiting_queue_selection',
      newStatus: 'cancelled',
      idempotent: false,
      message: 'Conversa encerrada administrativamente.',
    });
    const app = createTestApp(softClose);

    const response = await request(app)
      .post('/internal/glpi/conversations/conv-1/soft-close')
      .set('Authorization', `Bearer ${testApiKey}`)
      .send({
        reason: ' Abandonada pelo cliente ',
        glpi_user_id: 7,
        operator_name: 'Operador Teste',
        permission_validated: true,
      });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      ok: true,
      status: 'cancelled',
      previous_status: 'awaiting_queue_selection',
      new_status: 'cancelled',
    });
    expect(softClose).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'conv-1',
      reason: ' Abandonada pelo cliente ',
      operatorId: 7,
      operatorName: 'Operador Teste',
    }));
  });

  it('maps controlled domain errors without leaking stack traces', async () => {
    const softClose = vi.fn().mockRejectedValue(new ConversationSoftCloseError(
      409,
      'CONVERSATION_HAS_GLPI_TICKET',
      'Conversa vinculada a ticket GLPI não pode ser encerrada administrativamente por esta ação.',
    ));
    const app = createTestApp(softClose);

    const response = await request(app)
      .post('/internal/glpi/conversations/conv-1/soft-close')
      .set('Authorization', `Bearer ${testApiKey}`)
      .send({ reason: 'Abandonada', glpi_user_id: 7, permission_validated: true });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      ok: false,
      error_code: 'CONVERSATION_HAS_GLPI_TICKET',
    });
    expect(JSON.stringify(response.body)).not.toContain('stack');
  });
});
