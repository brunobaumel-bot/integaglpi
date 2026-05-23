import { buildAiQualityPrompt } from '../../ai/aiQualityPrompt.js';
import { AI_QUALITY_ANALYSIS_VERSION, type AiQualityResult } from '../../ai/aiQualityTypes.js';
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
}

export interface AiQualityProvider {
  analyze(prompt: string): Promise<AiQualityResult>;
}

export interface RequestAiQualityAnalysisInput {
  conversationId: string;
  glpiTicketId: number;
  createdBy: number | null;
}

export class AiSupervisorService {
  public constructor(
    private readonly repository: AiQualityAnalysisRepository,
    private readonly provider: AiQualityProvider,
    private readonly config: AiSupervisorConfig,
    private readonly auditService?: AuditService,
  ) {}

  public isEnabled(): boolean {
    return this.config.enabled;
  }

  public async requestAnalysis(input: RequestAiQualityAnalysisInput): Promise<AiQualityAnalysisRecord> {
    if (!this.config.enabled || this.config.provider === 'disabled') {
      throw new Error('AI_SUPERVISOR_DISABLED');
    }

    await this.audit('AI_SUPERVISOR_ANALYSIS_REQUESTED', 'pending', 'info', input);

    const pending = await this.repository.createPending({
      conversationId: input.conversationId,
      glpiTicketId: input.glpiTicketId,
      analysisVersion: AI_QUALITY_ANALYSIS_VERSION,
      provider: this.config.provider,
      model: this.config.model,
      createdBy: input.createdBy,
    });

    try {
      await this.audit('AI_SUPERVISOR_ANALYSIS_STARTED', 'pending', 'info', input, { analysis_id: pending.id });

      const context = await this.repository.getContext(
        input.conversationId,
        input.glpiTicketId,
        this.config.maxMessages,
      );

      if (context === null) {
        const skipped = await this.repository.markSkipped(pending.id, 'conversation_not_found');
        await this.audit('AI_SUPERVISOR_ANALYSIS_BLOCKED', 'ignored', 'warning', input, {
          analysis_id: pending.id,
          reason: 'conversation_not_found',
        });
        return skipped;
      }

      if (context.messages.length === 0) {
        const skipped = await this.repository.markSkipped(pending.id, 'conversation_without_text_messages');
        await this.audit('AI_SUPERVISOR_ANALYSIS_BLOCKED', 'ignored', 'warning', input, {
          analysis_id: pending.id,
          reason: 'conversation_without_text_messages',
        });
        return skipped;
      }

      const result = this.config.dryRun
        ? this.createDryRunResult(context.messages.length)
        : await this.provider.analyze(buildAiQualityPrompt(context, this.config.maxChars));

      const completed = await this.repository.markCompleted(pending.id, result);
      await this.audit('AI_SUPERVISOR_ANALYSIS_COMPLETED', 'success', 'info', input, {
        analysis_id: pending.id,
        result_status: completed.status,
      });
      return completed;
    } catch (error: unknown) {
      const message = sanitizeAiQualityText(error instanceof Error ? error.message : String(error));
      const failed = await this.repository.markFailed(pending.id, message);
      await this.audit('AI_SUPERVISOR_ANALYSIS_FAILED', 'failed', 'error', input, {
        analysis_id: pending.id,
        error_sanitized: message.slice(0, 200),
      });
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

  private createDryRunResult(messageCount: number): AiQualityResult {
    return {
      summary: `Analise sintética de ${messageCount} mensagem(ns).`,
      resolution: 'uncertain',
      sentiment: 'neutral',
      flags: ['supervisor_review_required'],
      recommendation: 'Revisar manualmente o contexto antes de qualquer decisão.',
    };
  }

  private async audit(
    eventType: string,
    status: 'success' | 'failed' | 'ignored' | 'pending',
    severity: 'info' | 'warning' | 'error',
    input: RequestAiQualityAnalysisInput,
    payload: Record<string, unknown> = {},
  ): Promise<void> {
    await this.auditService?.recordAuditEventSafe({
      eventType,
      status,
      severity,
      source: 'AiSupervisorService',
      ticketId: input.glpiTicketId,
      conversationId: input.conversationId,
      payload: {
        provider: this.config.provider,
        model: this.config.model,
        requested_by: input.createdBy,
        ...payload,
      },
    });
  }
}
