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

    expect(result.draftResponse).toContain('[Fallback local - dry-run ativo]');
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

  it('uses effective runtime config received from the plugin for model, timeout and dry-run', async () => {
    let runtimeOptions: { model?: string; timeoutMs?: number } | undefined;
    const provider = {
      generate: vi.fn(async (_prompt: string, options?: { model?: string; timeoutMs?: number }) => {
        runtimeOptions = options;
        return parseCopilotDraftResult(JSON.stringify({
          draft_response: 'Rascunho gerado com configuração efetiva para revisão humana.',
          tone: 'neutral',
          kb_references: [],
          assumptions: [],
          missing_information: [],
          safety_warnings: ['revise antes de enviar'],
          technician_checklist: ['confirmar dados'],
          confidence_score: 60,
          window_notice: 'open_24h',
          template_notice: '',
          no_auto_send: true,
        }));
      }),
    };
    const service = new CopilotDraftService(provider, {
      enabled: false,
      provider: 'disabled',
      model: 'env-disabled',
      dryRun: true,
      maxChars: 8_000,
    }, createAudit() as never);
    const app = createTestApp(service);

    const response = await request(app)
      .post('/internal/glpi/copilot/draft')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({
        action: 'generate',
        tone: 'technical',
        context,
        glpi_user_id: 7,
        runtime_config: {
          enabled: true,
          provider: 'ollama',
          model: 'gemma3:12b',
          dry_run: false,
          max_chars: 5000,
          timeout_ms: 90000,
        },
      });

    expect(response.status).toBe(201);
    expect(provider.generate).toHaveBeenCalledOnce();
    expect(runtimeOptions).toEqual({ model: 'gemma3:12b', timeoutMs: 90000 });
    expect(response.body.draft.draftResponse).toContain('[IA Local - gemma3:12b]');
    expect(response.body.draft.noAutoSend).toBe(true);
  });

  it('returns a clear operational timeout error for slow provider calls', async () => {
    const service = {
      requestDraft: vi.fn(async () => {
        throw new Error('This operation was aborted.');
      }),
      recordUsage: vi.fn(),
      recordFeedback: vi.fn(),
    };
    const app = createTestApp(service as never);

    const response = await request(app)
      .post('/internal/glpi/copilot/draft')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({ action: 'generate', tone: 'technical', context, glpi_user_id: 7 });

    expect(response.status).toBe(504);
    expect(response.body.message).toBe('COPILOT_PROVIDER_TIMEOUT');
    expect(response.body.error_type).toBe('timeout');
  });

  it('limits Copilot context before sending it to the provider', async () => {
    let prompt = '';
    const provider = {
      generate: vi.fn(async (value: string) => {
        prompt = value;
        return parseCopilotDraftResult(JSON.stringify({
          draft_response: 'Rascunho contextual curto para revisão humana.',
          tone: 'neutral',
          kb_references: [],
          assumptions: [],
          missing_information: [],
          safety_warnings: ['revise antes de enviar'],
          technician_checklist: ['confirmar dados'],
          confidence_score: 40,
          window_notice: 'open_24h',
          template_notice: '',
          no_auto_send: true,
        }));
      }),
    };
    const service = new CopilotDraftService(provider, {
      enabled: true,
      provider: 'ollama',
      model: 'llama3.1',
      dryRun: false,
      maxChars: 20_000,
    }, createAudit() as never);

    await service.requestDraft({
      context: {
        ...context,
        windowNotice: 'open_24h',
        messages: Array.from({ length: 20 }, (_, index) => ({
          direction: index % 2 === 0 ? 'inbound' : 'outbound',
          messageType: 'text',
          text: `old-marker-${index} ` + 'x'.repeat(900),
          createdAt: `2026-05-23T10:${String(index).padStart(2, '0')}:00Z`,
        })),
        kbArticles: Array.from({ length: 8 }, (_, index) => ({
          articleId: index + 1,
          title: `Artigo ${index + 1}`,
          category: 'Suporte',
          excerpt: 'k'.repeat(1_000),
          internalUrl: `/front/knowbaseitem.form.php?id=${index + 1}`,
        })),
      },
      tone: 'neutral',
      requestedBy: 7,
    });

    expect(provider.generate).toHaveBeenCalledOnce();
    expect(prompt).not.toContain('old-marker-0');
    expect(prompt).not.toContain('old-marker-11');
    expect(prompt).toContain('old-marker-19');
    expect(prompt).not.toContain('x'.repeat(361));
    expect(prompt).not.toContain('Artigo 4');
    expect(prompt.length).toBeLessThan(8_500);
  });

  it('keeps local KB references when the provider omits them', async () => {
    const provider = createProvider(JSON.stringify({
      draft_response: 'Valide a ativação do Office pelo procedimento interno antes de orientar o cliente.',
      tone: 'technical',
      kb_references: [],
      assumptions: [],
      missing_information: [],
      safety_warnings: ['revise antes de enviar'],
      technician_checklist: ['confirmar dados'],
      confidence_score: 55,
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
        ...context,
        windowNotice: 'open_24h',
      },
      tone: 'technical',
      requestedBy: 7,
    });

    expect(result.kbReferences).toEqual([
      { articleId: 10, title: 'Ativacao Office', internalUrl: '/front/knowbaseitem.form.php?id=10' },
    ]);
    expect(result.assumptions).toContain('KB local consultada antes da sugestão de resposta.');
    expect(result.safetyWarnings.join(' ')).toContain('KB local');
    expect(result.technicianChecklist.join(' ')).toContain('KB local');
    expect(result.noAutoSend).toBe(true);
  });

  it('keeps contextual provider analysis and removes fixed template phrases', async () => {
    const provider = createProvider(JSON.stringify({
      draft_response: 'Entendi as três demandas. A retirada do computador precisa ser agendada antes da formatação. Para a impressora, envie modelo e IP/nome da impressora. No Outlook, vamos validar o erro de licença ao abrir. Próxima ação: com esses dados eu separo as demandas.',
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

    const result = await service.requestDraft({
      context: {
        ...multiIssueContext,
        messages: [
          multiIssueContext.messages[0],
          {
            direction: 'inbound',
            messageType: 'text',
            text: 'O equipamento será retirado na empresa, preciso agendar dia e horário. Não sei IP/modelo da impressora. Outlook dá erro de licença ao abrir.',
            createdAt: '2026-05-23T10:02:00Z',
          },
        ],
      },
      tone: 'neutral',
      requestedBy: 7,
    });

    expect(result.draftResponse).toContain('retirada do computador precisa ser agendada');
    expect(result.draftResponse).toContain('não precisa levantar os dados técnicos da impressora');
    expect(result.draftResponse).toContain('Outlook');
    expect(result.draftResponse).toContain('Próxima ação');
    expect(result.draftResponse).not.toContain('envie modelo e IP/nome');
    expect(result.draftResponse).not.toContain('com esses dados eu separo as demandas');
    expect(result.draftResponse.split('\n').length).toBeLessThanOrEqual(5);
    expect(result.noAutoSend).toBe(true);
  });

  it('adapts to complete history without asking answered questions again', async () => {
    const provider = createProvider(JSON.stringify({
      draft_response: 'Obrigado pelas informações. Vou organizar o atendimento conforme o que já foi informado.',
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
            text: 'Não sei IP/modelo da impressora. Pode retirar o equipamento amanhã às 14h. Outlook Microsoft 365 mostra erro 0x80070005 de licença ao abrir.',
            createdAt: '2026-05-23T10:02:00Z',
          },
        ],
      },
      tone: 'technical',
      requestedBy: 7,
    });

    expect(result.draftResponse).toContain('não precisa levantar IP ou modelo agora');
    expect(result.draftResponse).toMatch(/amanh/i);
    expect(result.draftResponse).toContain('14h');
    expect(result.draftResponse).toContain('backup');
    expect(result.draftResponse).toContain('Outlook');
    expect(result.draftResponse).not.toContain('envie modelo e IP/nome');
    expect(result.draftResponse).not.toMatch(/envie[^.\n]*(modelo|ip)[^.\n]*impressora/i);
    expect(result.draftResponse).not.toContain('melhor dia e horário para retirada');
    expect(result.draftResponse).not.toContain('print ou código do erro');
    expect(result.draftResponse).not.toContain('Microsoft 365 ou licença local');
    expect(result.draftResponse.split('\n').length).toBeLessThanOrEqual(5);
    expect(result.noAutoSend).toBe(true);
  });
});
