import { buildAiQualityPrompt, normalizeAiQualityKbContext } from '../../ai/aiQualityPrompt.js';
import { AI_QUALITY_ANALYSIS_VERSION, type AiQualityKbArticle, type AiQualityResult } from '../../ai/aiQualityTypes.js';
import { sanitizeAiQualityText } from '../../ai/sanitizeAiQualityInput.js';
import type { AuditService } from './AuditService.js';
import type {
  AiQualityAnalysisRecord,
  AiQualityAnalysisRepository,
  AiQualitySupervisorFeedback,
} from '../../repositories/contracts/AiQualityAnalysisRepository.js';

export interface AiSupervisorConfig {
  enabled: boolean;
  provider: 'disabled' | 'ollama';
  model: string;
  maxMessages: number;
  maxChars: number;
  dryRun: boolean;
  timeoutMs?: number;
  source?: string;
}

export interface AiQualityProvider {
  analyze(prompt: string, runtimeConfig?: { model?: string; timeoutMs?: number }): Promise<AiQualityResult>;
}

export type AiSupervisorRuntimeConfigLoader = () => Promise<Partial<AiSupervisorConfig> | undefined>;

export interface RequestAiQualityAnalysisInput {
  conversationId: string;
  glpiTicketId: number;
  createdBy: number | null;
  kbContext?: AiQualityKbArticle[];
}

export class AiSupervisorService {
  public constructor(
    private readonly repository: AiQualityAnalysisRepository,
    private readonly provider: AiQualityProvider,
    private readonly config: AiSupervisorConfig,
    private readonly auditService?: AuditService,
    private readonly runtimeConfigLoader?: AiSupervisorRuntimeConfigLoader,
  ) {}

  public isEnabled(): boolean {
    return this.config.enabled;
  }

  public async requestAnalysis(input: RequestAiQualityAnalysisInput): Promise<AiQualityAnalysisRecord> {
    const effectiveConfig = await this.resolveRuntimeConfig();
    if (!effectiveConfig.enabled || effectiveConfig.provider === 'disabled') {
      throw new Error('AI_SUPERVISOR_DISABLED');
    }

    await this.audit('AI_SUPERVISOR_ANALYSIS_REQUESTED', 'pending', 'info', input, {}, effectiveConfig);

    const pending = await this.repository.createPending({
      conversationId: input.conversationId,
      glpiTicketId: input.glpiTicketId,
      analysisVersion: AI_QUALITY_ANALYSIS_VERSION,
      provider: effectiveConfig.provider,
      model: effectiveConfig.model,
      createdBy: input.createdBy,
    });

    try {
      await this.audit('AI_SUPERVISOR_ANALYSIS_STARTED', 'pending', 'info', input, { analysis_id: pending.id }, effectiveConfig);

      const context = await this.repository.getContext(
        input.conversationId,
        input.glpiTicketId,
        effectiveConfig.maxMessages,
      );

      if (context === null) {
        const skipped = await this.repository.markSkipped(pending.id, 'conversation_not_found');
        await this.audit('AI_SUPERVISOR_ANALYSIS_BLOCKED', 'ignored', 'warning', input, {
          analysis_id: pending.id,
          reason: 'conversation_not_found',
        }, effectiveConfig);
        return skipped;
      }

      if (context.messages.length === 0) {
        const skipped = await this.repository.markSkipped(pending.id, 'conversation_without_text_messages');
        await this.audit('AI_SUPERVISOR_ANALYSIS_BLOCKED', 'ignored', 'warning', input, {
          analysis_id: pending.id,
          reason: 'conversation_without_text_messages',
        }, effectiveConfig);
        return skipped;
      }

      context.kbContext = normalizeAiQualityKbContext(input.kbContext ?? context.kbContext ?? []);
      const result = effectiveConfig.dryRun
        ? this.createDryRunResult(context.messages.length, context.kbContext.length)
        : await this.provider.analyze(buildAiQualityPrompt(context, effectiveConfig.maxChars), {
          model: effectiveConfig.model,
          timeoutMs: effectiveConfig.timeoutMs,
        });
      this.assertKbReferencesAllowed(result, context.kbContext);

      const completed = await this.repository.markCompleted(pending.id, result);
      await this.audit('AI_SUPERVISOR_ANALYSIS_COMPLETED', 'success', 'info', input, {
        analysis_id: pending.id,
        result_status: completed.status,
      }, effectiveConfig);
      return completed;
    } catch (error: unknown) {
      const message = sanitizeAiQualityText(error instanceof Error ? error.message : String(error));
      const failed = await this.repository.markFailed(pending.id, message);
      await this.audit('AI_SUPERVISOR_ANALYSIS_FAILED', 'failed', 'error', input, {
        analysis_id: pending.id,
        error_sanitized: message.slice(0, 200),
      }, effectiveConfig);
      return failed;
    }
  }

  public async saveFeedback(
    analysisId: string,
    feedback: AiQualitySupervisorFeedback,
    notes: string | null,
  ): Promise<AiQualityAnalysisRecord | null> {
    if (!this.config.enabled || this.config.provider === 'disabled') {
      throw new Error('AI_SUPERVISOR_DISABLED');
    }

    return await this.repository.saveFeedback(analysisId, feedback, notes);
  }

  private createDryRunResult(messageCount: number, kbArticleCount: number): AiQualityResult {
    return {
      summary: `Analise sintética de ${messageCount} mensagem(ns).`,
      resolution: 'uncertain',
      sentiment: 'neutral',
      urgency: 'low',
      riskLevel: 'low',
      riskFlags: [],
      qualityFlags: ['supervisor_review_required'],
      missingContext: ['Análise em modo dry-run sem chamada ao modelo local.'],
      probableCause: 'Não identificado com segurança',
      suggestedNextAction: 'Revisar manualmente o contexto antes de qualquer decisão.',
      supervisorNotes: 'Modo laboratório dry-run; resultado não foi gerado por provider.',
      confidenceScore: 20,
      safetyNotes: ['Nenhuma ação é executada automaticamente.'],
      flags: ['supervisor_review_required'],
      recommendation: 'Revisar manualmente o contexto antes de qualquer decisão.',
      relatedKbArticles: [],
      kbAlignment: kbArticleCount > 0 ? 'partially_aligned' : 'no_article_found',
      procedureFollowed: 'unknown',
      procedureNotes: kbArticleCount > 0
        ? 'Modo dry-run: artigos da KB foram recebidos, mas não avaliados por modelo.'
        : 'Nenhum artigo da KB foi fornecido ao modo dry-run.',
      communicationQuality: {
        clarity: 5,
        empathy: 5,
        completeness: 5,
        tone: 'professional',
      },
      clientSatisfactionRisk: 'low',
      keyInsights: ['Modo dry-run não executa inferência semântica.'],
      suggestedImprovementsForTechnician: ['Revisar o atendimento com base nos procedimentos documentados disponíveis.'],
      supervisorRecommendation: ['Validar manualmente antes de orientar o técnico.'],
    };
  }

  private async resolveRuntimeConfig(): Promise<Required<Omit<AiSupervisorConfig, 'timeoutMs' | 'source'>> & { timeoutMs?: number; source: string }> {
    let loaded: Partial<AiSupervisorConfig> | undefined;
    try {
      loaded = await this.runtimeConfigLoader?.();
    } catch {
      loaded = undefined;
    }

    const provider = loaded?.provider === 'ollama' || loaded?.provider === 'disabled'
      ? loaded.provider
      : this.config.provider;
    const model = typeof loaded?.model === 'string' && loaded.model.trim() !== ''
      ? loaded.model.trim().slice(0, 120)
      : this.config.model;
    const maxMessages = typeof loaded?.maxMessages === 'number' && Number.isFinite(loaded.maxMessages)
      ? Math.max(1, Math.min(30, Math.trunc(loaded.maxMessages)))
      : this.config.maxMessages;
    const maxChars = typeof loaded?.maxChars === 'number' && Number.isFinite(loaded.maxChars)
      ? Math.max(500, Math.min(12_000, Math.trunc(loaded.maxChars)))
      : this.config.maxChars;
    const timeoutMs = typeof loaded?.timeoutMs === 'number' && Number.isFinite(loaded.timeoutMs)
      ? Math.max(15_000, Math.min(180_000, Math.trunc(loaded.timeoutMs)))
      : this.config.timeoutMs;

    return {
      enabled: typeof loaded?.enabled === 'boolean' ? loaded.enabled : this.config.enabled,
      provider,
      model,
      maxMessages,
      maxChars,
      dryRun: typeof loaded?.dryRun === 'boolean' ? loaded.dryRun : this.config.dryRun,
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
      source: typeof loaded?.source === 'string' && loaded.source !== '' ? loaded.source : (this.config.source ?? 'env'),
    };
  }

  private assertKbReferencesAllowed(result: AiQualityResult, kbContext: AiQualityKbArticle[]): void {
    if (result.relatedKbArticles.length > 0 && result.kbAlignment === 'no_article_found') {
      throw new Error('AI_QUALITY_KB_ALIGNMENT_CONFLICT');
    }

    const allowed = new Set(kbContext.map((article) => article.articleId));
    if (allowed.size === 0) {
      if (result.relatedKbArticles.length > 0 || result.kbAlignment !== 'no_article_found') {
        throw new Error('AI_QUALITY_UNKNOWN_KB_ARTICLE');
      }
      return;
    }

    for (const article of result.relatedKbArticles) {
      if (!allowed.has(article.articleId)) {
        throw new Error('AI_QUALITY_UNKNOWN_KB_ARTICLE');
      }
    }
  }

  private async audit(
    eventType: string,
    status: 'success' | 'failed' | 'ignored' | 'pending',
    severity: 'info' | 'warning' | 'error',
    input: RequestAiQualityAnalysisInput,
    payload: Record<string, unknown> = {},
    config: Required<Omit<AiSupervisorConfig, 'timeoutMs' | 'source'>> & { timeoutMs?: number; source?: string } = {
      enabled: this.config.enabled,
      provider: this.config.provider,
      model: this.config.model,
      maxMessages: this.config.maxMessages,
      maxChars: this.config.maxChars,
      dryRun: this.config.dryRun,
      ...(this.config.timeoutMs !== undefined ? { timeoutMs: this.config.timeoutMs } : {}),
      source: this.config.source ?? 'env',
    },
  ): Promise<void> {
    await this.auditService?.recordAuditEventSafe({
      eventType,
      status,
      severity,
      source: 'AiSupervisorService',
      ticketId: input.glpiTicketId,
      conversationId: input.conversationId,
      payload: {
        provider: config.provider,
        model: config.model,
        timeout_ms: config.timeoutMs ?? null,
        config_source: config.source ?? 'env',
        requested_by: input.createdBy,
        ...payload,
      },
    });
  }
}
