import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createApp } from '../src/app.js';
import { EntitySelectionError } from '../src/domain/services/EntitySelectionService.js';

const testApiKey = 'test-integration-service-api-key-32chars-min';

function createTestApp(entitySelectionService: {
  confirmEntity: ReturnType<typeof vi.fn>;
  getEntitySelectionStatus?: ReturnType<typeof vi.fn>;
}) {
  const resolvedEntitySelectionService = {
    getEntitySelectionStatus: vi.fn(),
    ...entitySelectionService,
  };

  return createApp({
    inboundWebhookService: { process: vi.fn() } as never,
    metaAppSecret: 'meta-secret',
    metaVerifyToken: 'verify-token',
    outboundMessageService: { send: vi.fn() } as never,
    entitySelectionService: resolvedEntitySelectionService as never,
    integrationServiceApiKey: testApiKey,
  });
}

describe('POST /internal/glpi/conversations/:conversation_id/entity', () => {
  it('requires Bearer authorization and does not accept legacy API key header', async () => {
    const confirmEntity = vi.fn();
    const app = createTestApp({ confirmEntity });

    const response = await request(app)
      .post('/internal/glpi/conversations/conv-1/entity')
      .set('X-Integaglpi-Api-Key', testApiKey)
      .send({ glpi_entity_id: 42, create_ticket: true });

    expect(response.status).toBe(401);
    expect(confirmEntity).not.toHaveBeenCalled();
  });

  it('passes create_ticket=true to EntitySelectionService', async () => {
    const confirmEntity = vi.fn().mockResolvedValue({
      status: 'succeeded',
      conversationId: 'conv-1',
      glpiTicketId: 123,
      message: 'Chamado #123 criado e vinculado com sucesso.',
    });
    const app = createTestApp({ confirmEntity });

    const response = await request(app)
      .post('/internal/glpi/conversations/conv-1/entity')
      .set('Authorization', `Bearer ${testApiKey}`)
      .send({
        glpi_entity_id: 42,
        glpi_entity_name: 'Cliente Teste',
        glpi_user_id: 7,
        create_ticket: true,
        permission_validated: true,
      });

    expect(response.status).toBe(201);
    expect(response.body.glpi_ticket_id).toBe(123);
    expect(confirmEntity).toHaveBeenCalledWith({
      conversationId: 'conv-1',
      glpiEntityId: 42,
      glpiEntityName: 'Cliente Teste',
      glpiUserId: 7,
      createTicket: true,
      idempotencyKey: null,
    });
  });

  it('passes a non-empty idempotency_key to EntitySelectionService', async () => {
    const confirmEntity = vi.fn().mockResolvedValue({
      status: 'succeeded',
      conversationId: 'conv-1',
      glpiTicketId: 123,
      message: 'Chamado #123 criado e vinculado com sucesso.',
    });
    const app = createTestApp({ confirmEntity });

    const response = await request(app)
      .post('/internal/glpi/conversations/conv-1/entity')
      .set('Authorization', `Bearer ${testApiKey}`)
      .send({
        glpi_entity_id: 42,
        create_ticket: true,
        permission_validated: true,
        idempotency_key: ' entity_selection:conv-1:42 ',
      });

    expect(response.status).toBe(201);
    expect(confirmEntity).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: 'entity_selection:conv-1:42',
    }));
  });

  it('returns 202 while entity selection is already processing', async () => {
    const confirmEntity = vi.fn().mockResolvedValue({
      status: 'processing',
      conversationId: 'conv-1',
      idempotent: true,
      message: 'A criação do chamado ainda está em processamento. Atualize a Central em alguns segundos.',
    });
    const app = createTestApp({ confirmEntity });

    const response = await request(app)
      .post('/internal/glpi/conversations/conv-1/entity')
      .set('Authorization', `Bearer ${testApiKey}`)
      .send({ glpi_entity_id: 42, create_ticket: true, permission_validated: true });

    expect(response.status).toBe(202);
    expect(response.body.status).toBe('processing');
  });

  it('returns read-only entity selection status for polling', async () => {
    const getEntitySelectionStatus = vi.fn().mockResolvedValue({
      status: 'processing',
      conversationId: 'conv-1',
      glpiTicketId: undefined,
      glpiEntityId: 42,
      glpiEntityName: 'Cliente Teste',
      errorType: null,
      errorMessage: null,
      startedAt: '2026-05-12T00:00:00.000Z',
      finishedAt: null,
      durationSeconds: null,
      message: 'Criando chamado no GLPI...',
    });
    const app = createTestApp({ confirmEntity: vi.fn(), getEntitySelectionStatus });

    const response = await request(app)
      .get('/internal/glpi/conversations/conv-1/entity')
      .set('Authorization', `Bearer ${testApiKey}`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      status: 'processing',
      conversation_id: 'conv-1',
      glpi_entity_id: 42,
      error_type: null,
      finished_at: null,
      duration_seconds: null,
    });
    expect(getEntitySelectionStatus).toHaveBeenCalledWith('conv-1');
  });

  it('returns 200 when entity selection is reconciled against an existing ticket', async () => {
    const confirmEntity = vi.fn().mockResolvedValue({
      status: 'succeeded',
      conversationId: 'conv-1',
      glpiTicketId: 123,
      idempotent: true,
      message: 'A conversa já foi vinculada ao chamado #123.',
    });
    const app = createTestApp({ confirmEntity });

    const response = await request(app)
      .post('/internal/glpi/conversations/conv-1/entity')
      .set('Authorization', `Bearer ${testApiKey}`)
      .send({ glpi_entity_id: 42, create_ticket: true, permission_validated: true });

    expect(response.status).toBe(200);
    expect(response.body.glpi_ticket_id).toBe(123);
    expect(response.body.idempotent).toBe(true);
  });

  it('returns notification warning without failing a successful ticket creation', async () => {
    const confirmEntity = vi.fn().mockResolvedValue({
      status: 'succeeded',
      conversationId: 'conv-1',
      glpiTicketId: 123,
      message: 'Chamado #123 criado e vinculado com sucesso.',
      warning: 'Chamado criado, mas a notificação WhatsApp de abertura não foi enviada.',
    });
    const app = createTestApp({ confirmEntity });

    const response = await request(app)
      .post('/internal/glpi/conversations/conv-1/entity')
      .set('Authorization', `Bearer ${testApiKey}`)
      .send({ glpi_entity_id: 42, create_ticket: true, permission_validated: true });

    expect(response.status).toBe(201);
    expect(response.body.glpi_ticket_id).toBe(123);
    expect(response.body.warning).toBe('Chamado criado, mas a notificação WhatsApp de abertura não foi enviada.');
  });


  it('rejects requests without permission validation from the plugin', async () => {
    const confirmEntity = vi.fn();
    const app = createTestApp({ confirmEntity });

    const response = await request(app)
      .post('/internal/glpi/conversations/conv-1/entity')
      .set('Authorization', `Bearer ${testApiKey}`)
      .send({ glpi_entity_id: 42, create_ticket: true });

    expect(response.status).toBe(403);
    expect(response.body.error_code).toBe('PERMISSION_NOT_VALIDATED');
    expect(confirmEntity).not.toHaveBeenCalled();
  });

  it('returns 400 for missing or zero entity id without calling EntitySelectionService', async () => {
    const confirmEntity = vi.fn();
    const app = createTestApp({ confirmEntity });

    const missingResponse = await request(app)
      .post('/internal/glpi/conversations/conv-1/entity')
      .set('Authorization', `Bearer ${testApiKey}`)
      .send({ create_ticket: true, permission_validated: true });

    const zeroResponse = await request(app)
      .post('/internal/glpi/conversations/conv-1/entity')
      .set('Authorization', `Bearer ${testApiKey}`)
      .send({ glpi_entity_id: 0, create_ticket: true, permission_validated: true });

    expect(missingResponse.status).toBe(400);
    expect(missingResponse.body.error_code).toBe('INVALID_ENTITY');
    expect(zeroResponse.status).toBe(400);
    expect(zeroResponse.body.error_code).toBe('INVALID_ENTITY');
    expect(confirmEntity).not.toHaveBeenCalled();
  });

  it('maps expected entity selection errors to controlled non-500 responses', async () => {
    const confirmEntity = vi.fn().mockRejectedValue(new EntitySelectionError(
      409,
      'CONVERSATION_STATUS_NOT_ALLOWED',
      'A conversa não está aguardando definição de entidade.',
      { status: 'open' },
    ));
    const app = createTestApp({ confirmEntity });

    const response = await request(app)
      .post('/internal/glpi/conversations/conv-1/entity')
      .set('Authorization', `Bearer ${testApiKey}`)
      .send({ glpi_entity_id: 42, create_ticket: true, permission_validated: true });

    expect(response.status).toBe(409);
    expect(response.body.error_code).toBe('CONVERSATION_STATUS_NOT_ALLOWED');
    expect(response.body.details).toEqual({ status: 'open' });
  });

  it('returns controlled 502 details when GLPI initSession times out before ticket creation', async () => {
    const confirmEntity = vi.fn().mockRejectedValue(new EntitySelectionError(
      502,
      'FAILED_BEFORE_TICKET',
      'Falha ao iniciar sessão no GLPI por timeout. Nenhum ticket foi criado. Tente novamente.',
      {
        glpi_stage: 'glpi_init_session',
        glpi_status_code: null,
        glpi_request_url: 'https://glpi.example.local/apirest.php/initSession/',
        error_type: 'timeout',
        timeout_ms: 5000,
      },
    ));
    const app = createTestApp({ confirmEntity });

    const response = await request(app)
      .post('/internal/glpi/conversations/conv-1/entity')
      .set('Authorization', `Bearer ${testApiKey}`)
      .send({ glpi_entity_id: 42, create_ticket: true, permission_validated: true });

    expect(response.status).toBe(502);
    expect(response.body.error_code).toBe('FAILED_BEFORE_TICKET');
    expect(response.body.message).toContain('timeout');
    expect(response.body.details).toMatchObject({
      glpi_stage: 'glpi_init_session',
      error_type: 'timeout',
      timeout_ms: 5000,
    });
  });
});
