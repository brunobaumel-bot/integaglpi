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

export interface CopilotDraftRuntimeConfig {
  enabled?: boolean;
  provider?: 'disabled' | 'ollama';
  model?: string;
  dryRun?: boolean;
  maxChars?: number;
  timeoutMs?: number;
  source?: string;
}

export interface RequestCopilotDraftInput {
  context: CopilotContext;
  tone: CopilotTone;
  requestedBy: number | null;
  runtimeConfig?: CopilotDraftRuntimeConfig;
}

export type CopilotDraftRuntimeConfigLoader = () => Promise<CopilotDraftRuntimeConfig | undefined>;

type SupportIssueKey = 'printer' | 'formatting' | 'outlook';

interface SupportIssueCoverage {
  key: SupportIssueKey;
  label: string;
  guidance: string;
  missingInformation: string[];
}

const COPILOT_MAX_CONTEXT_MESSAGES = 5;
const COPILOT_MESSAGE_TEXT_CHARS = 360;
const COPILOT_MAX_KB_ARTICLES = 3;
const COPILOT_KB_EXCERPT_CHARS = 500;
const COPILOT_MAX_AUXILIARY_ITEMS = 3;
const COPILOT_MAX_CONTEXT_CHARS = 6_000;
const COPILOT_FAILURE_THRESHOLD = 3;
const COPILOT_COOLDOWN_MS = 60_000;
const COPILOT_MAX_CONCURRENT_CALLS = 3;
const COPILOT_MIN_TIMEOUT_MS = 5_000;
const COPILOT_MAX_TIMEOUT_MS = 8_000;

type CopilotCircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export class CopilotDraftService {
  private circuitState: CopilotCircuitState = 'CLOSED';
  private consecutiveFailures = 0;
  private circuitOpenedUntil = 0;
  private activeProviderCalls = 0;
  private halfOpenProbeInFlight = false;

  public constructor(
    private readonly provider: CopilotDraftProvider,
    private readonly config: CopilotDraftConfig,
    private readonly auditService?: AuditService,
    private readonly runtimeConfigLoader?: CopilotDraftRuntimeConfigLoader,
  ) {}

  public async requestDraft(input: RequestCopilotDraftInput): Promise<CopilotDraftResult & { draftHash: string }> {
    const loadedRuntimeConfig = input.runtimeConfig ?? await this.loadRuntimeConfig();
    const effectiveConfig = this.resolveRuntimeConfig(loadedRuntimeConfig);
    if (!effectiveConfig.enabled || effectiveConfig.provider === 'disabled') {
      throw new Error('COPILOT_DISABLED');
    }

    const context = this.normalizeContext(input.context);
    await this.audit('COPILOT_DRAFT_REQUESTED', 'pending', 'info', context, input.requestedBy, effectiveConfig);

    const result = effectiveConfig.dryRun
      ? this.createDryRunDraft(context, input.tone)
      : await this.generateWithCircuitBreaker(buildCopilotDraftPrompt(
        context,
        input.tone,
        Math.min(effectiveConfig.maxChars, COPILOT_MAX_CONTEXT_CHARS),
      ), {
        model: effectiveConfig.model,
        timeoutMs: effectiveConfig.timeoutMs,
      });
    const qualityResult = this.applyDraftSourceLabel(effectiveConfig, this.applyLocalKnowledgeFirst(
      context,
      this.applySupportResponseQuality(context, result, input.tone),
    ));
    const draftHash = this.hash(qualityResult.draftResponse);

    await this.audit('COPILOT_DRAFT_GENERATED', 'success', 'info', context, input.requestedBy, effectiveConfig, {
      draft_hash: draftHash,
      tone: qualityResult.tone,
      confidence_score: qualityResult.confidenceScore,
      window_notice: qualityResult.windowNotice,
      kb_reference_count: qualityResult.kbReferences.length,
      draft_source: this.draftSourceLabel(effectiveConfig),
    });

    return { ...qualityResult, draftHash };
  }

  private async loadRuntimeConfig(): Promise<CopilotDraftRuntimeConfig | undefined> {
    try {
      return await this.runtimeConfigLoader?.();
    } catch {
      return undefined;
    }
  }

  private resolveRuntimeConfig(runtimeConfig?: CopilotDraftRuntimeConfig): Required<CopilotDraftConfig> & { timeoutMs?: number; source?: string } {
    const provider = runtimeConfig?.provider === 'ollama' ? 'ollama' : runtimeConfig?.provider === 'disabled' ? 'disabled' : this.config.provider;
    const model = typeof runtimeConfig?.model === 'string' && runtimeConfig.model.trim() !== ''
      ? runtimeConfig.model.trim().slice(0, 120)
      : this.config.model;
    const maxChars = typeof runtimeConfig?.maxChars === 'number' && Number.isFinite(runtimeConfig.maxChars)
      ? Math.max(1_000, Math.min(12_000, Math.trunc(runtimeConfig.maxChars)))
      : this.config.maxChars;
    const timeoutMs = typeof runtimeConfig?.timeoutMs === 'number' && Number.isFinite(runtimeConfig.timeoutMs)
      ? Math.max(COPILOT_MIN_TIMEOUT_MS, Math.min(COPILOT_MAX_TIMEOUT_MS, Math.trunc(runtimeConfig.timeoutMs)))
      : COPILOT_MAX_TIMEOUT_MS;

    return {
      enabled: typeof runtimeConfig?.enabled === 'boolean' ? runtimeConfig.enabled : this.config.enabled,
      provider,
      model,
      dryRun: typeof runtimeConfig?.dryRun === 'boolean' ? runtimeConfig.dryRun : this.config.dryRun,
      maxChars,
      timeoutMs,
      source: typeof runtimeConfig?.source === 'string' && runtimeConfig.source !== '' ? runtimeConfig.source : 'env_or_request',
    };
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

  public async recordJobEvent(input: {
    eventType: 'COPILOT_DRAFT_JOB_CREATED' | 'COPILOT_DRAFT_JOB_COMPLETED' | 'COPILOT_DRAFT_JOB_FAILED';
    status: 'success' | 'failed' | 'pending';
    severity: 'info' | 'warning' | 'error';
    conversationId: string;
    glpiTicketId: number;
    userId: number | null;
    jobId: string;
    errorType?: string;
    draftHash?: string;
  }): Promise<void> {
    await this.auditService?.recordAuditEventSafe({
      eventType: input.eventType,
      status: input.status,
      severity: input.severity,
      source: 'CopilotDraftService',
      conversationId: sanitizeAiQualityText(input.conversationId).slice(0, 80),
      ticketId: input.glpiTicketId,
      payload: {
        job_id: sanitizeAiQualityText(input.jobId).slice(0, 80),
        user_id: input.userId,
        error_type: sanitizeAiQualityText(input.errorType ?? '').slice(0, 80),
        draft_hash: sanitizeAiQualityText(input.draftHash ?? '').slice(0, 80),
        no_auto_send: true,
      },
    });
  }

  private async generateWithCircuitBreaker(
    prompt: string,
    runtimeConfig: { model?: string; timeoutMs?: number },
  ): Promise<CopilotDraftResult> {
    const now = Date.now();
    if (this.circuitState === 'OPEN') {
      if (now < this.circuitOpenedUntil) {
        throw new Error('COPILOT_CIRCUIT_OPEN');
      }
      this.circuitState = 'HALF_OPEN';
      this.halfOpenProbeInFlight = false;
    }

    if (this.activeProviderCalls >= COPILOT_MAX_CONCURRENT_CALLS) {
      throw new Error('COPILOT_PROVIDER_BUSY');
    }

    if (this.circuitState === 'HALF_OPEN' && this.halfOpenProbeInFlight) {
      throw new Error('COPILOT_PROVIDER_BUSY');
    }

    this.activeProviderCalls += 1;
    if (this.circuitState === 'HALF_OPEN') {
      this.halfOpenProbeInFlight = true;
    }

    try {
      const result = await this.provider.generate(prompt, runtimeConfig);
      this.recordProviderSuccess();

      return result;
    } catch (error: unknown) {
      await this.recordProviderFailure(error);
      throw error;
    } finally {
      this.activeProviderCalls = Math.max(0, this.activeProviderCalls - 1);
      this.halfOpenProbeInFlight = false;
    }
  }

  private recordProviderSuccess(): void {
    this.consecutiveFailures = 0;
    this.circuitOpenedUntil = 0;
    this.circuitState = 'CLOSED';
  }

  private async recordProviderFailure(error: unknown): Promise<void> {
    this.consecutiveFailures += 1;
    if (this.circuitState !== 'HALF_OPEN' && this.consecutiveFailures < COPILOT_FAILURE_THRESHOLD) {
      return;
    }

    this.circuitState = 'OPEN';
    this.circuitOpenedUntil = Date.now() + COPILOT_COOLDOWN_MS;
    this.halfOpenProbeInFlight = false;
    await this.auditService?.recordAuditEventSafe({
      eventType: 'COPILOT_CIRCUIT_OPENED',
      status: 'failed',
      severity: 'warning',
      source: 'CopilotDraftService',
      payload: {
        state: this.circuitState,
        cooldown_ms: COPILOT_COOLDOWN_MS,
        failure_count: this.consecutiveFailures,
        error_type: this.safeErrorType(error),
        no_prompt_logged: true,
      },
    });
  }

  private safeErrorType(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    if (/timeout|timed out|aborted/i.test(message)) {
      return 'timeout';
    }
    if (/fetch failed|econnrefused|COPILOT_OLLAMA_HTTP_/i.test(message)) {
      return 'provider_unavailable';
    }

    return 'provider_error';
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
      messages: context.messages.slice(-COPILOT_MAX_CONTEXT_MESSAGES).map((message) => ({
        direction: sanitizeAiQualityText(message.direction).slice(0, 20),
        messageType: sanitizeAiQualityText(message.messageType).slice(0, 40),
        text: sanitizeAiQualityText(message.text).slice(0, COPILOT_MESSAGE_TEXT_CHARS),
        createdAt: sanitizeAiQualityText(message.createdAt).slice(0, 40),
      })),
      kbArticles: context.kbArticles.slice(0, COPILOT_MAX_KB_ARTICLES).map((article) => ({
        articleId: Number(article.articleId),
        title: sanitizeAiQualityText(article.title).slice(0, 180),
        category: sanitizeAiQualityText(article.category).slice(0, 120),
        excerpt: sanitizeAiQualityText(article.excerpt).slice(0, COPILOT_KB_EXCERPT_CHARS),
        internalUrl: sanitizeAiQualityText(article.internalUrl).slice(0, 300),
      })),
      aiQuality: context.aiQuality,
      kbCandidates: context.kbCandidates.slice(0, COPILOT_MAX_AUXILIARY_ITEMS),
      historicalInsights: context.historicalInsights.slice(0, COPILOT_MAX_AUXILIARY_ITEMS),
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
      assumptions: ['Rascunho gerado em modo dry-run ativo para revisão humana.'],
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
    let draftResponse = this.compactDraftResponse(result.draftResponse);
    draftResponse = this.removeTemplatePhrases(draftResponse, detectedIssues);
    draftResponse = this.ensureIssueCoverage(draftResponse, detectedIssues);
    draftResponse = this.ensureNextAction(draftResponse, detectedIssues);
    draftResponse = this.compactDraftResponse(draftResponse);

    return {
      ...result,
      draftResponse,
      tone,
      missingInformation: this.mergeUnique(
        detectedIssues.flatMap((issue) => issue.missingInformation),
        result.missingInformation,
        6,
      ),
      technicianChecklist: this.mergeUnique([
        'Conferir se o rascunho responde ao caso real, não a um modelo genérico.',
        'Validar dados mínimos antes de prometer execução.',
        'Enviar a resposta manualmente somente após revisão.',
      ], result.technicianChecklist, 8),
      assumptions: detectedIssues.length >= 2
        ? this.mergeUnique(['Cliente informou múltiplas demandas no mesmo atendimento.'], result.assumptions, 6)
        : result.assumptions,
    };
  }

  private applyLocalKnowledgeFirst(context: CopilotContext, result: CopilotDraftResult): CopilotDraftResult {
    const localReferences = context.kbArticles.slice(0, COPILOT_MAX_KB_ARTICLES).map((article) => ({
      articleId: article.articleId,
      title: sanitizeAiQualityText(article.title).slice(0, 180),
      internalUrl: sanitizeAiQualityText(article.internalUrl).slice(0, 300),
    }));
    const seenReferences = new Set<string>();
    const kbReferences = [...localReferences, ...result.kbReferences]
      .map((reference) => ({
        articleId: Number(reference.articleId),
        title: sanitizeAiQualityText(reference.title).slice(0, 180),
        internalUrl: sanitizeAiQualityText(reference.internalUrl).slice(0, 300),
      }))
      .filter((reference) => {
        const key = `${reference.articleId}:${reference.internalUrl}`;
        if (reference.title === '' || seenReferences.has(key)) {
          return false;
        }
        seenReferences.add(key);
        return true;
      })
      .slice(0, COPILOT_MAX_KB_ARTICLES);

    return {
      ...result,
      kbReferences,
      assumptions: context.kbArticles.length > 0
        ? this.mergeUnique(['KB local consultada antes da sugestão de resposta.'], result.assumptions, 6)
        : result.assumptions,
      safetyWarnings: this.mergeUnique([
        'Nenhuma mensagem foi enviada automaticamente.',
        context.kbArticles.length > 0
          ? 'Valide se os artigos da KB local se aplicam ao caso antes de enviar.'
          : 'Sem artigo de KB local suficiente; revise tecnicamente antes de enviar.',
      ], result.safetyWarnings, 6),
      technicianChecklist: this.mergeUnique([
        'Conferir artigos da KB local relacionados antes de enviar.',
        'Usar a IA apenas como rascunho revisável pelo técnico.',
      ], result.technicianChecklist, 8),
      noAutoSend: true,
    };
  }

  private applyDraftSourceLabel(
    config: Required<CopilotDraftConfig> & { timeoutMs?: number; source?: string },
    result: CopilotDraftResult,
  ): CopilotDraftResult {
    const source = this.draftSourceLabel(config);
    const draftResponse = result.draftResponse.startsWith('[')
      ? result.draftResponse
      : `${source} ${result.draftResponse}`;

    return {
      ...result,
      sourceType: result.kbReferences.length > 0 ? 'kb' : config.provider === 'ollama' && !config.dryRun ? 'ai' : 'fallback',
      sourceName: result.kbReferences[0]?.title ?? source.replace(/^\[|\]$/g, ''),
      confidence: result.confidenceScore >= 70 ? 'high' : result.confidenceScore >= 40 ? 'medium' : 'low',
      warnings: result.safetyWarnings,
      draftResponse,
      safetyWarnings: this.mergeUnique([
        `Origem do rascunho: ${source}`,
      ], result.safetyWarnings, 6),
    };
  }

  private draftSourceLabel(config: Required<CopilotDraftConfig> & { timeoutMs?: number }): string {
    if (config.provider === 'ollama' && !config.dryRun && config.model.trim() !== '') {
      return `[IA Local - ${sanitizeAiQualityText(config.model).slice(0, 80)}]`;
    }
    if (config.provider === 'ollama' && config.dryRun) {
      return '[Fallback local - dry-run ativo]';
    }

    return '[Fallback local - IA indisponível]';
  }

  /**
   * @return SupportIssueCoverage[]
   */
  private detectSupportIssues(context: CopilotContext): SupportIssueCoverage[] {
    const text = this.normalizeForDetection(
      context.messages
        .filter((message) => message.direction.toLowerCase() !== 'outbound')
        .map((message) => message.text)
        .join(' '),
    );
    const issues: SupportIssueCoverage[] = [];

    if (/\bimpressora\b/.test(text) && /\b(rede|wifi|wi fi|ip|instalar|configurar|computador)\b/.test(text)) {
      const missing = [];
      const customerDoesNotKnowPrinter = this.customerDoesNotKnowPrinterDetails(text);
      if (!this.hasPrinterNetworkDetails(text) && !customerDoesNotKnowPrinter) {
        missing.push('algum identificador da impressora, se disponível');
      }
      issues.push({
        key: 'printer',
        label: 'Impressora na rede',
        guidance: customerDoesNotKnowPrinter
          ? 'Sobre a impressora, não precisa levantar IP ou modelo agora; o técnico verifica no computador, no equipamento e na rede durante o atendimento.'
          : missing.length > 0
          ? 'Sobre a impressora, qualquer identificação que tiver ajuda, mas se não souber o técnico confere no local e na rede.'
          : 'Sobre a impressora, vou usar os dados informados para validar instalação no computador e acesso na rede.',
        missingInformation: missing,
      });
    }

    if (/\b(formatar|formatacao|reinstalar)\b/.test(text) && /\b(computador|notebook|pc|maquina)\b/.test(text)) {
      const missing = [];
      const hasSchedule = this.hasCollectionSchedule(text);
      const scheduleSummary = this.extractScheduleSummary(text);
      const hasBackupInfo = /\b(backup|arquivos?|dados|perfil|onedrive)\b/.test(text);
      const hasPickup = /\b(retirar|retirada|coletar|coleta|buscar|pegar|empresa|local)\b/.test(text);
      if (!hasSchedule) {
        missing.push(hasPickup ? 'melhor dia e horário para retirada' : 'forma de atendimento e melhor dia/horário');
      }
      if (!hasBackupInfo) {
        missing.push('se há arquivos para backup');
      }
      issues.push({
        key: 'formatting',
        label: 'Formatação do computador',
        guidance: missing.length > 0 && hasSchedule
          ? `A retirada já está encaminhada${scheduleSummary !== '' ? ` para ${scheduleSummary}` : ''}; falta confirmar se há arquivos, perfil ou dados que precisam de backup antes da formatação.`
          : missing.length > 0 && hasPickup
          ? 'Como o equipamento será retirado, preciso do melhor dia/horário de coleta e confirmar se há arquivos para backup.'
          : missing.length > 0
          ? 'Para a formatação, confirme se será coleta, acesso remoto ou atendimento local, além de backup necessário.'
          : 'Para a formatação, já há informação suficiente para preparar a execução segura e revisar backup antes de iniciar.',
        missingInformation: missing,
      });
    }

    if (/\b(outlook|office|microsoft 365)\b/.test(text) && /\b(licenca|ativacao|ativar|destravar|bloqueado|erro)\b/.test(text)) {
      const missing = [];
      if (!/\b(print|screenshot|captura|codigo)\b|erro\s*0x[0-9a-f]+/.test(text)) {
        missing.push('print ou código do erro');
      }
      if (!/\b(versao|office 2016|office 2019|office 2021|microsoft 365|365)\b/.test(text)) {
        missing.push('se é Microsoft 365 ou licença local');
      }
      issues.push({
        key: 'outlook',
        label: 'Outlook/licença',
        guidance: missing.length > 0
          ? `Para o Outlook, preciso de ${missing.join(' e ')} para validar ativação/licenciamento sem tentativa no escuro.`
          : 'Para o Outlook, vou usar o erro informado para validar conta/licença antes de reinstalar ou alterar configuração.',
        missingInformation: missing,
      });
    }

    return issues.slice(0, 3);
  }

  private hasPrinterNetworkDetails(text: string): boolean {
    return /\b(?:\d{1,3}\.){3}\d{1,3}\b/.test(text)
      || /\b(modelo|marca|hp|epson|brother|canon|ricoh|lexmark|samsung)\b/.test(text)
      || /\b(nome da impressora|fila de impressao)\b/.test(text);
  }

  private customerDoesNotKnowPrinterDetails(text: string): boolean {
    return /\b(nao sei|nao sabe|nao tenho|desconheco|sem informacao|não sei|não sabe|não tenho)\b/.test(text)
      && /\b(impressora|ip|modelo|nome)\b/.test(text);
  }

  private hasCollectionSchedule(text: string): boolean {
    return /\b(\d{1,2}[:h]\d{0,2}|hoje|amanha|segunda|terca|quarta|quinta|sexta|sabado|domingo|manha|tarde)\b/.test(text);
  }

  private extractScheduleSummary(text: string): string {
    const day = text.match(/\b(hoje|amanha|segunda|terca|quarta|quinta|sexta|sabado|domingo)\b/)?.[1] ?? '';
    const time = text.match(/\b\d{1,2}(?::\d{2}|h\d{0,2})\b/)?.[0] ?? '';
    if (day !== '' && time !== '') {
      return `${day} às ${time}`;
    }
    return day || time;
  }

  private removeTemplatePhrases(value: string, issues: SupportIssueCoverage[]): string {
    const printerIssue = issues.find((issue) => issue.key === 'printer');
    const customerDoesNotKnowPrinter = printerIssue !== undefined
      && this.normalizeForDetection(printerIssue.guidance).includes('nao precisa levantar');
    const printerReplacement = customerDoesNotKnowPrinter
      ? 'não precisa levantar os dados técnicos da impressora agora; verificamos no local/rede.'
      : 'se tiver algum identificador da impressora, informe; se não tiver, verificamos no local/rede.';
    const nextAction = this.nextActionText(issues);
    const nextActionWithoutPrefix = nextAction.replace(/^Próxima ação:\s*/i, '');

    return value
      .replace(/Próxima ação:\s*com esses dados eu separo as demandas[^.\n]*\.?/gi, nextAction)
      .replace(/com esses dados eu separo as demandas[^.\n]*\.?/gi, nextActionWithoutPrefix)
      .replace(/envie modelo e IP\/nome da impressora\.?/gi, printerReplacement)
      .replace(/envie[^.\n]*(?:modelo|ip)[^.\n]*impressora[^.\n]*\.?/gi, printerReplacement);
  }

  private ensureIssueCoverage(value: string, issues: SupportIssueCoverage[]): string {
    if (issues.length === 0) {
      return value;
    }
    const lines = this.linesFromDraft(value);
    for (const issue of issues) {
      if (!this.draftCoversIssue(lines.join(' '), issue)) {
        lines.push(issue.guidance);
      }
    }

    return lines.join('\n');
  }

  private draftCoversIssue(value: string, issue: SupportIssueCoverage): boolean {
    const text = this.normalizeForDetection(value);
    if (issue.key === 'printer') {
      return /\bimpressora\b/.test(text)
        && (/\b(verific|rede|local|computador|equipamento|instal)\b/.test(text)
          || /\b(modelo|fila|identificador|ip)\b/.test(text));
    }
    if (issue.key === 'formatting') {
      return /\b(format|retir|colet|backup|horario|dia|agenda)\b/.test(text);
    }
    if (issue.key === 'outlook') {
      return /\b(outlook|licenca|ativacao|erro|print|codigo|365|office)\b/.test(text);
    }

    return false;
  }

  private ensureNextAction(value: string, issues: SupportIssueCoverage[]): string {
    if (/\bproxima acao\b/.test(this.normalizeForDetection(value))) {
      return value;
    }
    const lines = this.linesFromDraft(value);
    lines.push(this.nextActionText(issues));

    return lines.join('\n');
  }

  private nextActionText(issues: SupportIssueCoverage[]): string {
    const missing = issues.flatMap((issue) => issue.missingInformation);
    if (missing.length > 0) {
      return `Próxima ação: confirme ${this.humanJoin(missing.slice(0, 3))} para o técnico avançar com segurança.`;
    }

    return 'Próxima ação: validar os pontos acima e seguir com o atendimento manual pelo técnico responsável.';
  }

  private compactDraftResponse(value: string): string {
    const lines = this.linesFromDraft(value);

    const compacted = this.mergeUnique(lines, [], 5).join('\n');
    return compacted !== '' ? compacted : value;
  }

  private linesFromDraft(value: string): string[] {
    return value
      .split(/\r?\n+/)
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .filter((line) => line !== '');
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

  private humanJoin(items: string[]): string {
    if (items.length <= 1) {
      return items[0] ?? '';
    }
    if (items.length === 2) {
      return `${items[0]} e ${items[1]}`;
    }

    return `${items.slice(0, -1).join(', ')} e ${items[items.length - 1]}`;
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
    config: Required<CopilotDraftConfig> & { timeoutMs?: number; source?: string },
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
        provider: config.provider,
        model: config.model,
        timeout_ms: config.timeoutMs ?? null,
        config_source: config.source ?? 'env_or_request',
        requested_by: requestedBy,
        message_count: context.messages.length,
        kb_article_count: context.kbArticles.length,
        ...payload,
      },
    });
  }
}
