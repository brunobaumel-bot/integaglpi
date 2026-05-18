import { describe, expect, it, vi } from 'vitest';

import { AiSupervisorService, type AiQualityProvider } from '../src/domain/services/AiSupervisorService.js';
import type {
  AiQualityAnalysisRecord,
  AiQualityAnalysisRepository,
  AiQualitySupervisorFeedback,
  CreateAiQualityPendingInput,
} from '../src/repositories/contracts/AiQualityAnalysisRepository.js';
import type { AiQualityContext, AiQualityResult } from '../src/ai/aiQualityTypes.js';

const now = new Date('2026-05-16T12:00:00.000Z');

function makeRecord(overrides: Partial<AiQualityAnalysisRecord> = {}): AiQualityAnalysisRecord {
  return {
    id: '1',
    conversationId: 'conv-1',
    glpiTicketId: 123,
    analysisVersion: 'ai_quality_v1',
    provider: 'ollama',
    model: 'llama3.1',
    status: 'pending',
    classificationResolution: null,
    sentiment: null,
    flags: [],
    summary: null,
    recommendation: null,
    resultJson: null,
    supervisorFeedback: null,
    feedbackNotes: null,
    createdBy: 7,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeContext(overrides: Partial<AiQualityContext> = {}): AiQualityContext {
  return {
    conversationId: 'conv-1',
    glpiTicketId: 123,
    ticketStatus: 'open',
    csatRating: null,
    supervisorReviewRequired: false,
    inactivityStatus: null,
    requesterName: 'Cliente Teste',
    messages: [
      {
        direction: 'inbound',
        messageType: 'text',
        messageText: 'Meu telefone e 5541999999999 e email cliente@example.com',
        createdAt: now,
      },
    ],
    ...overrides,
  };
}

class FakeRepository implements AiQualityAnalysisRepository {
  public context: AiQualityContext | null = makeContext();
  public pendingInputs: CreateAiQualityPendingInput[] = [];
  public failedReasons: string[] = [];
  public skippedReasons: string[] = [];
  public completedResults: AiQualityResult[] = [];
  public feedbacks: Array<{ id: string; feedback: AiQualitySupervisorFeedback; notes: string | null }> = [];

  public async getContext(): Promise<AiQualityContext | null> {
    return this.context;
  }

  public async createPending(input: CreateAiQualityPendingInput): Promise<AiQualityAnalysisRecord> {
    this.pendingInputs.push(input);
    return makeRecord({
      id: String(this.pendingInputs.length),
      conversationId: input.conversationId,
      glpiTicketId: input.glpiTicketId,
      createdBy: input.createdBy,
    });
  }

  public async markCompleted(id: string, result: AiQualityResult): Promise<AiQualityAnalysisRecord> {
    this.completedResults.push(result);
    return makeRecord({
      id,
      status: 'completed',
      classificationResolution: result.resolution,
      sentiment: result.sentiment,
      flags: result.flags,
      summary: result.summary,
      recommendation: result.recommendation,
      resultJson: result,
    });
  }

  public async markFailed(id: string, errorMessage: string): Promise<AiQualityAnalysisRecord> {
    this.failedReasons.push(errorMessage);
    return makeRecord({ id, status: 'failed', resultJson: { error: errorMessage } });
  }

  public async markSkipped(id: string, reason: string): Promise<AiQualityAnalysisRecord> {
    this.skippedReasons.push(reason);
    return makeRecord({ id, status: 'skipped', resultJson: { error: reason } });
  }

  public async saveFeedback(
    id: string,
    feedback: AiQualitySupervisorFeedback,
    notes: string | null,
  ): Promise<AiQualityAnalysisRecord | null> {
    this.feedbacks.push({ id, feedback, notes });
    return makeRecord({ id, supervisorFeedback: feedback, feedbackNotes: notes });
  }
}

function createService(overrides: {
  enabled?: boolean;
  dryRun?: boolean;
  repository?: FakeRepository;
  provider?: AiQualityProvider;
} = {}) {
  const repository = overrides.repository ?? new FakeRepository();
  const provider = overrides.provider ?? {
    analyze: vi.fn().mockResolvedValue({
      summary: 'Atendimento resumido.',
      resolution: 'resolved',
      sentiment: 'satisfied',
      flags: [],
      recommendation: 'Sem ação automática.',
    } satisfies AiQualityResult),
  };
  const service = new AiSupervisorService(repository, provider, {
    enabled: overrides.enabled ?? true,
    provider: 'ollama',
    model: 'llama3.1',
    maxMessages: 30,
    maxChars: 12000,
    dryRun: overrides.dryRun ?? true,
  });

  return { service, repository, provider };
}

describe('AiSupervisorService', () => {
  it('blocks analysis when feature flag is disabled', async () => {
    const { service, repository } = createService({ enabled: false });

    await expect(service.requestAnalysis({
      conversationId: 'conv-1',
      glpiTicketId: 123,
      createdBy: 7,
    })).rejects.toThrow('AI_SUPERVISOR_DISABLED');

    expect(repository.pendingInputs).toHaveLength(0);
  });

  it('skips conversations without text messages', async () => {
    const repository = new FakeRepository();
    repository.context = makeContext({ messages: [] });
    const { service } = createService({ repository });

    const result = await service.requestAnalysis({
      conversationId: 'conv-1',
      glpiTicketId: 123,
      createdBy: 7,
    });

    expect(result.status).toBe('skipped');
    expect(repository.skippedReasons).toEqual(['conversation_without_text_messages']);
  });

  it('uses dry-run without calling Ollama', async () => {
    const provider = { analyze: vi.fn() };
    const { service, repository } = createService({ provider, dryRun: true });

    const result = await service.requestAnalysis({
      conversationId: 'conv-1',
      glpiTicketId: 123,
      createdBy: 7,
    });

    expect(result.status).toBe('completed');
    expect(provider.analyze).not.toHaveBeenCalled();
    expect(repository.completedResults[0]).toMatchObject({
      resolution: 'uncertain',
      sentiment: 'neutral',
      flags: ['supervisor_review_required'],
    });
  });

  it('marks provider errors as failed without throwing', async () => {
    const provider = { analyze: vi.fn().mockRejectedValue(new Error('ollama offline')) };
    const { service, repository } = createService({ provider, dryRun: false });

    const result = await service.requestAnalysis({
      conversationId: 'conv-1',
      glpiTicketId: 123,
      createdBy: 7,
    });

    expect(result.status).toBe('failed');
    expect(repository.failedReasons).toEqual(['ollama offline']);
  });

  it('persists supervisor feedback only when enabled', async () => {
    const { service, repository } = createService();

    const result = await service.saveFeedback('analysis-1', 'incorrect', 'Resumo não condiz com a conversa.');

    expect(result?.supervisorFeedback).toBe('incorrect');
    expect(repository.feedbacks).toEqual([{
      id: 'analysis-1',
      feedback: 'incorrect',
      notes: 'Resumo não condiz com a conversa.',
    }]);
  });
});
