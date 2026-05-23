import { createHash } from 'node:crypto';

import { buildCopilotDraftPrompt } from '../../ai/copilotPrompt.js';
import {
  type CopilotContext,
  type CopilotDraftResult,
  type CopilotTone,
} from '../../ai/copilotTypes.js';
import { sanitizeAiQualityText } from '../../ai/sanitizeAiQualityInput.js';
import type { CopilotDraftProvider } from '../../copilot/OllamaCopilotProvider.js';
import type { AuditService } from './AuditService.js';

export interface CopilotDraftConfig {
  enabled: boolean;
  provider: 'disabled' | 'ollama';
  model: string;
  dryRun: boolean;
  maxChars: number;
}

export interface RequestCopilotDraftInput {
  context: CopilotContext;
  tone: CopilotTone;
  requestedBy: number | null;
}

export class CopilotDraftService {
  public constructor(
    private readonly provider: CopilotDraftProvider,
    private readonly config: CopilotDraftConfig,
    private readonly auditService?: AuditService,
  ) {}

  public async requestDraft(input: RequestCopilotDraftInput): Promise<CopilotDraftResult & { draftHash: string }> {
    if (!this.config.enabled || this.config.provider === 'disabled') {
      throw new Error('COPILOT_DISABLED');
    }

    const context = this.normalizeContext(input.context);
    await this.audit('COPILOT_DRAFT_REQUESTED', 'pending', 'info', context, input.requestedBy);

    const result = this.config.dryRun
      ? this.createDryRunDraft(context, input.tone)
      : await this.provider.generate(buildCopilotDraftPrompt(context, input.tone, this.config.maxChars));
    const draftHash = this.hash(result.draftResponse);

    await this.audit('COPILOT_DRAFT_GENERATED', 'success', 'info', context, input.requestedBy, {
      draft_hash: draftHash,
      tone: result.tone,
      confidence_score: result.confidenceScore,
      window_notice: result.windowNotice,
      kb_reference_count: result.kbReferences.length,
    });

    return { ...result, draftHash };
  }

  public async recordUsage(
    eventType: 'COPILOT_DRAFT_USED' | 'COPILOT_DRAFT_DISCARDED',
    input: { conversationId: string; glpiTicketId: number; draftHash: string; userId: number | null },
  ): Promise<void> {
    await this.auditService?.recordAuditEventSafe({
      eventType,
      status: 'success',
      severity: 'info',
      source: 'CopilotDraftService',
      conversationId: input.conversationId,
      ticketId: input.glpiTicketId,
      payload: {
        draft_hash: sanitizeAiQualityText(input.draftHash).slice(0, 80),
        user_id: input.userId,
      },
    });
  }

  public async recordFeedback(input: {
    conversationId: string;
    glpiTicketId: number;
    draftHash: string;
    feedback: 'useful' | 'not_useful';
    notes: string;
    userId: number | null;
  }): Promise<void> {
    await this.auditService?.recordAuditEventSafe({
      eventType: 'COPILOT_FEEDBACK_RECORDED',
      status: 'success',
      severity: 'info',
      source: 'CopilotDraftService',
      conversationId: input.conversationId,
      ticketId: input.glpiTicketId,
      payload: {
        draft_hash: sanitizeAiQualityText(input.draftHash).slice(0, 80),
        feedback: input.feedback,
        notes_present: input.notes.trim() !== '',
        user_id: input.userId,
      },
    });
  }

  private normalizeContext(context: CopilotContext): CopilotContext {
    return {
      conversationId: sanitizeAiQualityText(context.conversationId).slice(0, 80),
      glpiTicketId: Number(context.glpiTicketId),
      ticketTitle: sanitizeAiQualityText(context.ticketTitle).slice(0, 180),
      ticketStatus: sanitizeAiQualityText(context.ticketStatus).slice(0, 80),
      queueName: sanitizeAiQualityText(context.queueName).slice(0, 120),
      slaLabel: sanitizeAiQualityText(context.slaLabel).slice(0, 120),
      windowNotice: context.windowNotice,
      messages: context.messages.slice(-12).map((message) => ({
        direction: sanitizeAiQualityText(message.direction).slice(0, 20),
        messageType: sanitizeAiQualityText(message.messageType).slice(0, 40),
        text: sanitizeAiQualityText(message.text).slice(0, 600),
        createdAt: sanitizeAiQualityText(message.createdAt).slice(0, 40),
      })),
      kbArticles: context.kbArticles.slice(0, 5).map((article) => ({
        articleId: Number(article.articleId),
        title: sanitizeAiQualityText(article.title).slice(0, 180),
        category: sanitizeAiQualityText(article.category).slice(0, 120),
        excerpt: sanitizeAiQualityText(article.excerpt).slice(0, 800),
        internalUrl: sanitizeAiQualityText(article.internalUrl).slice(0, 300),
      })),
      aiQuality: context.aiQuality,
      kbCandidates: context.kbCandidates.slice(0, 5),
      historicalInsights: context.historicalInsights.slice(0, 5),
    };
  }

  private createDryRunDraft(context: CopilotContext, tone: CopilotTone): CopilotDraftResult {
    const templateNotice = context.windowNotice === 'closed_24h'
      ? 'A janela de atendimento está fechada. Você precisará usar um template aprovado.'
      : '';

    return {
      draftResponse: 'Olá! Obrigado pelas informações. Vou revisar o caso com base no histórico e nos procedimentos disponíveis e retorno com a orientação mais adequada. Se puder, confirme também qualquer mensagem de erro que aparece na tela.',
      tone,
      kbReferences: context.kbArticles.slice(0, 3).map((article) => ({
        articleId: article.articleId,
        title: article.title,
        internalUrl: article.internalUrl,
      })),
      assumptions: ['Rascunho gerado em modo dry-run para revisão humana.'],
      missingInformation: ['Confirmar evidências finais antes de enviar ao cliente.'],
      safetyWarnings: ['Nenhuma mensagem foi enviada automaticamente.'],
      technicianChecklist: [
        'Revisar se o rascunho está compatível com o chamado.',
        'Remover qualquer informação sensível antes de enviar.',
        'Confirmar a janela WhatsApp antes do envio manual.',
      ],
      confidenceScore: 25,
      windowNotice: context.windowNotice,
      templateNotice,
      noAutoSend: true,
    };
  }

  private hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private async audit(
    eventType: string,
    status: 'success' | 'failed' | 'ignored' | 'pending',
    severity: 'info' | 'warning' | 'error',
    context: CopilotContext,
    requestedBy: number | null,
    payload: Record<string, unknown> = {},
  ): Promise<void> {
    await this.auditService?.recordAuditEventSafe({
      eventType,
      status,
      severity,
      source: 'CopilotDraftService',
      conversationId: context.conversationId,
      ticketId: context.glpiTicketId,
      payload: {
        provider: this.config.provider,
        model: this.config.model,
        requested_by: requestedBy,
        message_count: context.messages.length,
        kb_article_count: context.kbArticles.length,
        ...payload,
      },
    });
  }
}
