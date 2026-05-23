import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createApp } from '../src/app.js';
import { parseCopilotDraftResult } from '../src/ai/parseCopilotDraftResult.js';
import type { CopilotContext } from '../src/ai/copilotTypes.js';
import { CopilotDraftService } from '../src/domain/services/CopilotDraftService.js';

const apiKey = 'test-integration-service-api-key-32chars-min';

const context: CopilotContext = {
  conversationId: 'conv-1',
  glpiTicketId: 123,
  ticketTitle: 'Office nao ativa',
  ticketStatus: 'open',
  queueName: 'Suporte',
  slaLabel: 'ok',
  windowNotice: 'closed_24h',
  messages: [{ direction: 'inbound', messageType: 'text', text: 'Office nao ativa', createdAt: '2026-05-23T10:00:00Z' }],
  kbArticles: [{ articleId: 10, title: 'Ativacao Office', category: 'Office', excerpt: 'Procedimento seguro.', internalUrl: '/front/knowbaseitem.form.php?id=10' }],
  aiQuality: null,
  kbCandidates: [],
  historicalInsights: [],
};

function createProvider(response: string) {
  return {
    generate: vi.fn(async () => parseCopilotDraftResult(response)),
  };
}

function createAudit() {
  return {
    recordAuditEventSafe: vi.fn(async () => undefined),
  };
}

function createTestApp(service: CopilotDraftService) {
  return createApp({
    inboundWebhookService: { process: vi.fn() } as never,
    metaAppSecret: 'meta-secret',
    metaVerifyToken: 'verify-token',
    outboundMessageService: { send: vi.fn() } as never,
    integrationServiceApiKey: apiKey,
    copilotDraftService: service,
  });
}

describe('internal copilot draft', () => {
  it('validates draft JSON and requires no_auto_send/checklist', () => {
    const parsed = parseCopilotDraftResult(JSON.stringify({
      draft_response: 'Olá! Vamos revisar o procedimento com segurança.',
      tone: 'friendly',
      kb_references: [{ article_id: 10, title: 'Ativacao Office', internal_url: '/front/knowbaseitem.form.php?id=10' }],
      assumptions: [],
      missing_information: ['print do erro'],
      safety_warnings: ['revise antes de enviar'],
      technician_checklist: ['confirmar janela WhatsApp'],
      confidence_score: 120,
      window_notice: 'closed_24h',
      template_notice: '',
      no_auto_send: true,
    }));

    expect(parsed.confidenceScore).toBe(100);
    expect(parsed.templateNotice).toContain('template aprovado');
    expect(parsed.noAutoSend).toBe(true);
    expect(() => parseCopilotDraftResult('not json')).toThrow('COPILOT_DRAFT_INVALID_JSON');
    expect(() => parseCopilotDraftResult(JSON.stringify({ ...parsed, no_auto_send: false, noAutoSend: false }))).toThrow();
  });

  it('dry-run generates a draft without calling provider or outbound services', async () => {
    const provider = createProvider('{}');
    const audit = createAudit();
    const service = new CopilotDraftService(provider, {
      enabled: true,
      provider: 'ollama',
      model: 'llama3.1',
      dryRun: true,
      maxChars: 8_000,
    }, audit as never);

    const result = await service.requestDraft({ context, tone: 'friendly', requestedBy: 7 });

    expect(result.draftResponse).toContain('Olá');
    expect(result.noAutoSend).toBe(true);
    expect(result.templateNotice).toContain('template aprovado');
    expect(provider.generate).not.toHaveBeenCalled();
    expect(audit.recordAuditEventSafe).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'COPILOT_DRAFT_GENERATED' }));
  });

  it('exposes an authenticated internal route and never calls outbound send', async () => {
    const service = new CopilotDraftService(createProvider('{}'), {
      enabled: true,
      provider: 'ollama',
      model: 'llama3.1',
      dryRun: true,
      maxChars: 8_000,
    }, createAudit() as never);
    const app = createTestApp(service);

    const unauthorized = await request(app).post('/internal/glpi/copilot/draft').send({});
    const response = await request(app)
      .post('/internal/glpi/copilot/draft')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({ action: 'generate', tone: 'technical', context, glpi_user_id: 7 });

    expect(unauthorized.status).toBe(401);
    expect(response.status).toBe(201);
    expect(response.body.draft.noAutoSend).toBe(true);
  });
});
