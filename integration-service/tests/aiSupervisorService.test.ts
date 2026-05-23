import { describe, expect, it, vi } from 'vitest';

import { AiSupervisorService, type AiQualityProvider } from '../src/domain/services/AiSupervisorService.js';
import type { AuditService } from '../src/domain/services/AuditService.js';
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
    analysisVersion: 'ai_quality_v2',
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
    conversationStatus: 'open',
    queueName: 'Suporte',
    entityName: 'Empresa Teste',
    serviceName: 'Service Desk',
    slaResponseDeadline: new Date('2026-05-16T13:00:00.000Z'),
    slaSolutionDeadline: new Date('2026-05-16T18:00:00.000Z'),
    accumulatedPausedMinutes: 0,
    reopenCount: 1,
    csatRating: null,
    supervisorReviewRequired: false,
    inactivityStatus: null,
    inactivitySkipReason: null,
    requesterName: 'Cliente Teste',
    messages: [
      {
        direction: 'inbound',
        messageType: 'text',
        messageText: 'Meu telefone e 5541999999999 e email cliente@example.com',
        createdAt: now,
      },
    ],
    recentEvents: [{
      eventType: 'DELIVERY_FAILED',
      status: 'failed',
      severity: 'warning',
      errorSummary: 'Meta error token=secret123',
      createdAt: now,
    }],
    attachmentMetadata: [{
      messageType: 'document',
      status: 'validated',
      mimeDetected: 'application/pdf',
      sizeBytes: 1234,
      fileName: 'documento.pdf',
      createdAt: now,
    }],
    deliveryFailures: [{
      messageType: 'template',
      deliveryStatus: 'failed',
      metaErrorMessage: 'OAuthException',
      createdAt: now,
    }],
    kbContext: [{
      articleId: 10,
      title: 'Procedimento GLPI',
      category: 'Suporte',
      excerpt: 'Validar dados e registrar orientação no chamado.',
      internalUrl: '/front/knowbaseitem.form.php?id=10',
    }],
    ...overrides,
  };
}

function makeAiResult(overrides: Partial<AiQualityResult> = {}): AiQualityResult {
  return {
    summary: 'Atendimento resumido.',
    resolution: 'resolved',
    sentiment: 'positive',
    urgency: 'medium',
    riskLevel: 'low',
    riskFlags: [],
    qualityFlags: ['complete_context'],
    missingContext: [],
    probableCause: 'Hipótese: dúvida operacional do cliente.',
    suggestedNextAction: 'Supervisor deve revisar a orientação registrada.',
    supervisorNotes: 'Sem indício de ação automática.',
    confidenceScore: 80,
    safetyNotes: ['Nenhuma ação automática executada.'],
    flags: [],
    recommendation: 'Supervisor deve revisar a orientação registrada.',
    relatedKbArticles: [{
      articleId: 10,
      title: 'Procedimento GLPI',
      category: 'Suporte',
      relevanceScore: 90,
      whyRelevant: 'Cobre a orientação registrada.',
      internalUrl: '/front/knowbaseitem.form.php?id=10',
    }],
    kbAlignment: 'aligned',
    procedureFollowed: 'yes',
    procedureNotes: 'Atendimento compatível com o procedimento fornecido.',
    communicationQuality: {
      clarity: 8,
      empathy: 7,
      completeness: 8,
      tone: 'professional',
    },
    clientSatisfactionRisk: 'low',
    keyInsights: ['Procedimento documentado foi considerado.'],
    suggestedImprovementsForTechnician: ['Registrar evidência da validação no ticket.'],
    supervisorRecommendation: ['Manter acompanhamento consultivo.'],
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
  providerName?: 'disabled' | 'ollama';
  dryRun?: boolean;
  repository?: FakeRepository;
  provider?: AiQualityProvider;
  auditService?: Pick<AuditService, 'recordAuditEventSafe'>;
} = {}) {
  const repository = overrides.repository ?? new FakeRepository();
  const provider = overrides.provider ?? {
    analyze: vi.fn().mockResolvedValue(makeAiResult()),
  };
  const auditService = overrides.auditService ?? {
    recordAuditEventSafe: vi.fn().mockResolvedValue(undefined),
  };
  const service = new AiSupervisorService(repository, provider, {
    enabled: overrides.enabled ?? true,
    provider: overrides.providerName ?? 'ollama',
    model: 'llama3.1',
    maxMessages: 30,
    maxChars: 12000,
    dryRun: overrides.dryRun ?? true,
  }, auditService as AuditService);

  return { service, repository, provider, auditService };
}

describe('AiSupervisorService', () => {
  it('blocks analysis when feature flag is disabled', async () => {
    const provider = { analyze: vi.fn() };
    const { service, repository } = createService({ enabled: false, provider });

    await expect(service.requestAnalysis({
      conversationId: 'conv-1',
      glpiTicketId: 123,
      createdBy: 7,
    })).rejects.toThrow('AI_SUPERVISOR_DISABLED');

    expect(repository.pendingInputs).toHaveLength(0);
    expect(provider.analyze).not.toHaveBeenCalled();
  });

  it('blocks analysis when provider is disabled even if feature flag is enabled', async () => {
    const provider = { analyze: vi.fn() };
    const { service, repository } = createService({ enabled: true, providerName: 'disabled', provider });

    await expect(service.requestAnalysis({
      conversationId: 'conv-1',
      glpiTicketId: 123,
      createdBy: 7,
    })).rejects.toThrow('AI_SUPERVISOR_DISABLED');

    expect(repository.pendingInputs).toHaveLength(0);
    expect(provider.analyze).not.toHaveBeenCalled();
  });

  it('skips missing context without calling the provider', async () => {
    const repository = new FakeRepository();
    repository.context = null;
    const provider = { analyze: vi.fn() };
    const { service } = createService({ repository, provider, dryRun: false });

    const result = await service.requestAnalysis({
      conversationId: 'conv-1',
      glpiTicketId: 123,
      createdBy: 7,
    });

    expect(result.status).toBe('skipped');
    expect(repository.skippedReasons).toEqual(['conversation_not_found']);
    expect(provider.analyze).not.toHaveBeenCalled();
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
      urgency: 'low',
      riskLevel: 'low',
      flags: ['supervisor_review_required'],
      kbAlignment: 'partially_aligned',
      procedureFollowed: 'unknown',
    });
  });

  it('calls the provider only in explicit non-dry-run mode and persists the insight', async () => {
    const provider = {
      analyze: vi.fn().mockResolvedValue(makeAiResult({
        summary: 'Cliente atendido.',
        sentiment: 'positive',
        urgency: 'high',
        riskLevel: 'medium',
        qualityFlags: ['needs_follow_up'],
        flags: ['needs_training'],
      })),
    };
    const { service, repository } = createService({ provider, dryRun: false });

    const result = await service.requestAnalysis({
      conversationId: 'conv-1',
      glpiTicketId: 123,
      createdBy: 7,
    });

    expect(result.status).toBe('completed');
    expect(provider.analyze).toHaveBeenCalledTimes(1);
    expect(repository.completedResults[0]).toMatchObject({
      resolution: 'resolved',
      sentiment: 'positive',
      urgency: 'high',
      riskLevel: 'medium',
      flags: ['needs_training'],
    });
  });

  it('marks provider errors as failed without throwing', async () => {
    const provider = { analyze: vi.fn().mockRejectedValue(new Error('ollama offline token=secret123')) };
    const { service, repository } = createService({ provider, dryRun: false });

    const result = await service.requestAnalysis({
      conversationId: 'conv-1',
      glpiTicketId: 123,
      createdBy: 7,
    });

    expect(result.status).toBe('failed');
    expect(repository.failedReasons).toEqual(['ollama offline [SEGREDO_REMOVIDO]']);
  });

  it('fails safely when provider references a KB article not sent in context', async () => {
    const provider = { analyze: vi.fn().mockResolvedValue(makeAiResult({
      relatedKbArticles: [{
        articleId: 999,
        title: 'Artigo inexistente',
        category: 'Suporte',
        relevanceScore: 90,
        whyRelevant: 'Não deveria ser aceito.',
        internalUrl: '/front/knowbaseitem.form.php?id=999',
      }],
    })) };
    const { service, repository } = createService({ provider, dryRun: false });

    const result = await service.requestAnalysis({
      conversationId: 'conv-1',
      glpiTicketId: 123,
      createdBy: 7,
    });

    expect(result.status).toBe('failed');
    expect(repository.failedReasons).toEqual(['AI_QUALITY_UNKNOWN_KB_ARTICLE']);
  });

  it('fails safely when provider returns KB articles with no_article_found alignment', async () => {
    const provider = { analyze: vi.fn().mockResolvedValue(makeAiResult({
      kbAlignment: 'no_article_found',
      relatedKbArticles: [{
        articleId: 10,
        title: 'Procedimento GLPI',
        category: 'Suporte',
        relevanceScore: 90,
        whyRelevant: 'Cobre a orientação registrada.',
        internalUrl: '/front/knowbaseitem.form.php?id=10',
      }],
    })) };
    const { service, repository } = createService({ provider, dryRun: false });

    const result = await service.requestAnalysis({
      conversationId: 'conv-1',
      glpiTicketId: 123,
      createdBy: 7,
    });

    expect(result.status).toBe('failed');
    expect(repository.failedReasons).toEqual(['AI_QUALITY_KB_ALIGNMENT_CONFLICT']);
  });

  it('records sanitized audit events for manual analysis lifecycle', async () => {
    const auditService = { recordAuditEventSafe: vi.fn().mockResolvedValue(undefined) };
    const { service } = createService({ auditService });

    await service.requestAnalysis({
      conversationId: 'conv-1',
      glpiTicketId: 123,
      createdBy: 7,
    });

    expect(auditService.recordAuditEventSafe).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'AI_SUPERVISOR_ANALYSIS_REQUESTED',
      source: 'AiSupervisorService',
      ticketId: 123,
      conversationId: 'conv-1',
    }));
    expect(auditService.recordAuditEventSafe).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'AI_SUPERVISOR_ANALYSIS_COMPLETED',
      status: 'success',
    }));
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
