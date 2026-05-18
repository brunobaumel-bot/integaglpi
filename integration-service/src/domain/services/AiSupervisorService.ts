import { buildAiQualityPrompt } from '../../ai/aiQualityPrompt.js';
import { AI_QUALITY_ANALYSIS_VERSION, type AiQualityResult } from '../../ai/aiQualityTypes.js';
import type {
  AiQualityAnalysisRecord,
  AiQualityAnalysisRepository,
  AiQualitySupervisorFeedback,
} from '../../repositories/contracts/AiQualityAnalysisRepository.js';

export interface AiSupervisorConfig {
  enabled: boolean;
  provider: 'ollama';
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
  ) {}

  public isEnabled(): boolean {
    return this.config.enabled;
  }

  public async requestAnalysis(input: RequestAiQualityAnalysisInput): Promise<AiQualityAnalysisRecord> {
    if (!this.config.enabled) {
      throw new Error('AI_SUPERVISOR_DISABLED');
    }

    const pending = await this.repository.createPending({
      conversationId: input.conversationId,
      glpiTicketId: input.glpiTicketId,
      analysisVersion: AI_QUALITY_ANALYSIS_VERSION,
      provider: this.config.provider,
      model: this.config.model,
      createdBy: input.createdBy,
    });

    try {
      const context = await this.repository.getContext(
        input.conversationId,
        input.glpiTicketId,
        this.config.maxMessages,
      );

      if (context === null) {
        return await this.repository.markSkipped(pending.id, 'conversation_not_found');
      }

      if (context.messages.length === 0) {
        return await this.repository.markSkipped(pending.id, 'conversation_without_text_messages');
      }

      const result = this.config.dryRun
        ? this.createDryRunResult(context.messages.length)
        : await this.provider.analyze(buildAiQualityPrompt(context, this.config.maxChars));

      return await this.repository.markCompleted(pending.id, result);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return await this.repository.markFailed(pending.id, message);
    }
  }

  public async saveFeedback(
    analysisId: string,
    feedback: AiQualitySupervisorFeedback,
    notes: string | null,
  ): Promise<AiQualityAnalysisRecord | null> {
    if (!this.config.enabled) {
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
}
