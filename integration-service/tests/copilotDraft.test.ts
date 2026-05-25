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

const multiIssueContext: CopilotContext = {
  ...context,
  ticketTitle: 'Impressora, formatacao e Outlook',
  windowNotice: 'open_24h',
  messages: [
    {
      direction: 'inbound',
      messageType: 'text',
      text: 'Quero configurar uma impressora na rede, formatar meu computador e destravar meu Outlook com erro de licença.',
      createdAt: '2026-05-23T10:00:00Z',
    },
  ],
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

  it('rewrites multi-issue support drafts into short numbered operational questions', async () => {
    const provider = createProvider(JSON.stringify({
      draft_response: 'Olá! Vamos revisar seu caso. Para ajudar melhor preciso de mais informações. Olá! Vamos revisar seu caso. Para ajudar melhor preciso de mais informações.',
      tone: 'neutral',
      kb_references: [],
      assumptions: [],
      missing_information: [],
      safety_warnings: ['revise antes de enviar'],
      technician_checklist: ['confirmar dados'],
      confidence_score: 30,
      window_notice: 'open_24h',
      template_notice: '',
      no_auto_send: true,
    }));
    const service = new CopilotDraftService(provider, {
      enabled: true,
      provider: 'ollama',
      model: 'llama3.1',
      dryRun: false,
      maxChars: 8_000,
    }, createAudit() as never);

    const result = await service.requestDraft({ context: multiIssueContext, tone: 'neutral', requestedBy: 7 });
    const lines = result.draftResponse.split('\n');

    expect(lines).toHaveLength(4);
    expect(lines[0]).toMatch(/^1\. Impressora na rede:/);
    expect(lines[0]).toContain('modelo e IP/nome da impressora');
    expect(lines[1]).toMatch(/^2\. Formatação do computador:/);
    expect(lines[1]).toContain('dia e horário para coleta ou acesso');
    expect(lines[2]).toMatch(/^3\. Outlook\/licença:/);
    expect(lines[2]).toContain('print ou código do erro');
    expect(lines[2]).toContain('versão do Outlook/Office');
    expect(lines[3]).toContain('Próxima ação');
    expect(result.confidenceScore).toBeGreaterThanOrEqual(70);
    expect(result.noAutoSend).toBe(true);
  });

  it('uses recent conversation history to avoid repeating answered support questions', async () => {
    const provider = createProvider(JSON.stringify({
      draft_response: 'Obrigado. Vou analisar.',
      tone: 'technical',
      kb_references: [],
      assumptions: [],
      missing_information: [],
      safety_warnings: ['revise antes de enviar'],
      technician_checklist: ['confirmar dados'],
      confidence_score: 50,
      window_notice: 'open_24h',
      template_notice: '',
      no_auto_send: true,
    }));
    const service = new CopilotDraftService(provider, {
      enabled: true,
      provider: 'ollama',
      model: 'llama3.1',
      dryRun: false,
      maxChars: 8_000,
    }, createAudit() as never);

    const result = await service.requestDraft({
      context: {
        ...multiIssueContext,
        messages: [
          multiIssueContext.messages[0],
          {
            direction: 'inbound',
            messageType: 'text',
            text: 'A impressora é HP LaserJet no IP 192.168.10.30. Pode coletar amanhã 14h. Outlook Microsoft 365 com erro 0x80070005.',
            createdAt: '2026-05-23T10:02:00Z',
          },
        ],
      },
      tone: 'technical',
      requestedBy: 7,
    });

    expect(result.draftResponse).not.toContain('modelo e IP/nome da impressora');
    expect(result.draftResponse).not.toContain('dia e horário para coleta ou acesso');
    expect(result.draftResponse).not.toContain('print ou código do erro');
    expect(result.draftResponse).not.toContain('versão do Outlook/Office');
    expect(result.draftResponse).toContain('já tenho os dados principais');
    expect(result.draftResponse).toContain('já tenho dia/horário');
    expect(result.draftResponse).toContain('se há arquivos para backup');
    expect(result.draftResponse.split('\n').length).toBeLessThanOrEqual(5);
  });
});
