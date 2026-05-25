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
    const qualityResult = this.applySupportResponseQuality(context, result, input.tone);
    const draftHash = this.hash(qualityResult.draftResponse);

    await this.audit('COPILOT_DRAFT_GENERATED', 'success', 'info', context, input.requestedBy, {
      draft_hash: draftHash,
      tone: qualityResult.tone,
      confidence_score: qualityResult.confidenceScore,
      window_notice: qualityResult.windowNotice,
      kb_reference_count: qualityResult.kbReferences.length,
    });

    return { ...qualityResult, draftHash };
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

  private applySupportResponseQuality(
    context: CopilotContext,
    result: CopilotDraftResult,
    tone: CopilotTone,
  ): CopilotDraftResult {
    const detectedIssues = this.detectSupportIssues(context);
    if (detectedIssues.length >= 2) {
      return {
        ...result,
        draftResponse: this.buildOperationalSupportDraft(detectedIssues),
        tone,
        missingInformation: this.mergeUnique(
          detectedIssues.flatMap((issue) => issue.missingInformation),
          result.missingInformation,
          6,
        ),
        technicianChecklist: this.mergeUnique([
          'Conferir se cada problema deve virar tarefa separada ou subchamado.',
          'Validar dados mínimos antes de prometer execução.',
          'Enviar a resposta manualmente somente após revisão.',
        ], result.technicianChecklist, 8),
        assumptions: this.mergeUnique([
          'Cliente informou múltiplas demandas no mesmo atendimento.',
        ], result.assumptions, 6),
        confidenceScore: Math.max(result.confidenceScore, 70),
      };
    }

    return {
      ...result,
      draftResponse: this.compactDraftResponse(result.draftResponse),
    };
  }

  /**
   * @return Array<{
   *   label: string;
   *   action: string;
   *   missingInformation: string[];
   * }>
   */
  private detectSupportIssues(context: CopilotContext): Array<{
    label: string;
    action: string;
    missingInformation: string[];
  }> {
    const text = this.normalizeForDetection(
      context.messages
        .filter((message) => message.direction.toLowerCase() !== 'outbound')
        .map((message) => message.text)
        .join(' '),
    );
    const issues: Array<{ label: string; action: string; missingInformation: string[] }> = [];

    if (/\bimpressora\b/.test(text) && /\b(rede|wifi|wi fi|ip)\b/.test(text)) {
      const missing = [];
      if (!this.hasPrinterNetworkDetails(text)) {
        missing.push('modelo e IP/nome da impressora');
      }
      issues.push({
        label: 'Impressora na rede',
        action: missing.length > 0
          ? `envie ${missing.join(' e ')} para eu orientar a instalação correta.`
          : 'já tenho os dados principais; vou validar o procedimento de instalação na rede.',
        missingInformation: missing,
      });
    }

    if (/\b(formatar|formatacao|reinstalar)\b/.test(text) && /\b(computador|notebook|pc|maquina)\b/.test(text)) {
      const missing = [];
      const hasSchedule = this.hasCollectionSchedule(text);
      const hasBackupInfo = /\b(backup|arquivos?|dados|perfil|onedrive)\b/.test(text);
      if (!hasSchedule) {
        missing.push('dia e horário para coleta ou acesso');
      }
      if (!hasBackupInfo) {
        missing.push('se há arquivos para backup');
      }
      issues.push({
        label: 'Formatação do computador',
        action: missing.length > 0 && hasSchedule
          ? `já tenho dia/horário; confirme ${missing.join(' e ')} antes da execução.`
          : missing.length > 0
          ? `confirme ${missing.join(' e ')} antes da execução.`
          : 'já tenho janela e backup indicados; vou encaminhar a execução segura.',
        missingInformation: missing,
      });
    }

    if (/\b(outlook|office|microsoft 365)\b/.test(text) && /\b(licenca|ativacao|ativar|destravar|bloqueado|erro)\b/.test(text)) {
      const missing = [];
      if (!/\b(print|screenshot|captura|codigo)\b|erro\s*0x[0-9a-f]+/.test(text)) {
        missing.push('print ou código do erro');
      }
      if (!/\b(versao|office 2016|office 2019|office 2021|microsoft 365|365)\b/.test(text)) {
        missing.push('versão do Outlook/Office');
      }
      issues.push({
        label: 'Outlook/licença',
        action: missing.length > 0
          ? `envie ${missing.join(' e ')} para validar a licença sem tentativa no escuro.`
          : 'já tenho evidência e versão; vou validar ativação/licenciamento.',
        missingInformation: missing,
      });
    }

    return issues.slice(0, 3);
  }

  private buildOperationalSupportDraft(issues: Array<{ label: string; action: string }>): string {
    const lines = issues.map((issue, index) => `${index + 1}. ${issue.label}: ${issue.action}`);
    lines.push('Próxima ação: com esses dados eu separo as demandas e encaminho o atendimento com segurança.');

    return lines.slice(0, 5).join('\n');
  }

  private hasPrinterNetworkDetails(text: string): boolean {
    return /\b(?:\d{1,3}\.){3}\d{1,3}\b/.test(text)
      || /\b(modelo|marca|hp|epson|brother|canon|ricoh|lexmark|samsung)\b/.test(text)
      || /\b(nome da impressora|fila de impressao)\b/.test(text);
  }

  private hasCollectionSchedule(text: string): boolean {
    return /\b(\d{1,2}[:h]\d{0,2}|hoje|amanha|segunda|terca|quarta|quinta|sexta|sabado|domingo|manha|tarde)\b/.test(text);
  }

  private compactDraftResponse(value: string): string {
    const lines = value
      .split(/\r?\n+/)
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .filter((line) => line !== '');

    const compacted = this.mergeUnique(lines, [], 5).join('\n');
    return compacted !== '' ? compacted : value;
  }

  private mergeUnique(primary: string[], secondary: string[], maxItems: number): string[] {
    const seen = new Set<string>();
    const merged: string[] = [];
    for (const item of [...primary, ...secondary]) {
      const clean = sanitizeAiQualityText(item).replace(/\s+/g, ' ').trim();
      const key = this.normalizeForDetection(clean);
      if (clean === '' || seen.has(key)) {
        continue;
      }
      seen.add(key);
      merged.push(clean);
      if (merged.length >= maxItems) {
        break;
      }
    }

    return merged;
  }

  private normalizeForDetection(value: string): string {
    return sanitizeAiQualityText(value)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
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
