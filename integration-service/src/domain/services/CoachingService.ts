import { generateCoachingRecommendations } from '../../coaching/engine.js';
import type { CoachingSignalInput } from '../../coaching/types.js';
import { CoachingRecommendationRepository } from '../../coaching/repository.js';
import type { SqlExecutor } from '../../infra/db/postgres.js';
import type { AuditService } from './AuditService.js';

/** Onboarding window: extra coaching content for a technician's first N tickets. */
export const ONBOARDING_TICKET_WINDOW = 30;

/** Port: resolves a technician's onboarding status + tickets handled so far. */
export interface OnboardingStatusPort {
  getStatus(technicianId: number): Promise<{ onboardingActive: boolean; ticketsHandled: number }>;
}

/** Port: builds a KB draft from a SINGLE resolved ticket (post-resolution flow). */
export interface KbDraftPort {
  buildDraftFromTicket(ticketId: number): Promise<{
    title: string;
    contentMarkdown: string;
    confidenceScore: number;
  } | null>;
}

export interface CoachingChecklistInput {
  ticketId: number;
  technicianId: number | null;
  category?: string;
}

export interface CoachingChecklistResult {
  onboarding: boolean;
  ticketsHandled: number | null;
  items: string[];
  pops: string[];
}

export interface SuggestKbResult {
  ok: boolean;
  candidate: { title: string; contentMarkdown: string; confidenceScore: number } | null;
  message: string;
}

export class CoachingService {
  private readonly repository: CoachingRecommendationRepository;

  public constructor(
    executor: SqlExecutor,
    private readonly auditService?: AuditService,
    private readonly onboardingStatus?: OnboardingStatusPort,
    private readonly kbDraft?: KbDraftPort,
  ) {
    this.repository = new CoachingRecommendationRepository(executor);
  }

  /**
   * Practical onboarding assist: only for technicians with onboarding active AND
   * within their first ONBOARDING_TICKET_WINDOW tickets. Returns an empty payload
   * otherwise. Never ranks or penalizes — purely supportive content.
   */
  public async getChecklist(input: CoachingChecklistInput): Promise<CoachingChecklistResult> {
    const technicianId = input.technicianId;
    if (!this.onboardingStatus || technicianId === null || technicianId <= 0) {
      return { onboarding: false, ticketsHandled: null, items: [], pops: [] };
    }

    let status: { onboardingActive: boolean; ticketsHandled: number };
    try {
      status = await this.onboardingStatus.getStatus(technicianId);
    } catch {
      return { onboarding: false, ticketsHandled: null, items: [], pops: [] };
    }

    const eligible = status.onboardingActive && status.ticketsHandled < ONBOARDING_TICKET_WINDOW;
    if (!eligible) {
      return { onboarding: false, ticketsHandled: status.ticketsHandled, items: [], pops: [] };
    }

    await this.auditService?.recordAuditEventSafe({
      eventType: 'ONBOARDING_ASSIST_SHOWN',
      status: 'success',
      severity: 'info',
      source: 'CoachingService',
      payload: { tickets_handled: status.ticketsHandled, non_punitive: true },
    });

    return {
      onboarding: true,
      ticketsHandled: status.ticketsHandled,
      items: [
        'Confirme a identidade e a entidade do solicitante antes de agir.',
        'Reproduza o problema e registre evidências objetivas no chamado.',
        'Consulte a Base de Conhecimento antes de escalar.',
        'Valide a solução com o usuário antes de encerrar.',
      ],
      pops: [
        'POP-001: Abertura e triagem de chamado',
        'POP-002: Registro de solução e evidências',
        'POP-003: Encerramento e CSAT',
      ],
    };
  }

  /**
   * Post-resolution "virar artigo?" — builds a KB draft from a single resolved
   * ticket for HUMAN REVIEW. Never publishes; never mutates the ticket.
   */
  public async suggestKbArticle(ticketId: number): Promise<SuggestKbResult> {
    if (!this.kbDraft) {
      return { ok: false, candidate: null, message: 'Gerador de rascunho não configurado.' };
    }
    try {
      const draft = await this.kbDraft.buildDraftFromTicket(ticketId);
      if (draft === null) {
        return { ok: false, candidate: null, message: 'Sem conhecimento reutilizável suficiente neste chamado.' };
      }
      await this.auditService?.recordAuditEventSafe({
        eventType: 'KB_CANDIDATE_GENERATED',
        status: 'success',
        severity: 'info',
        source: 'CoachingService',
        payload: { ticket_id: ticketId, confidence_score: draft.confidenceScore, manual_review_required: true },
      });
      return { ok: true, candidate: draft, message: 'Rascunho gerado para revisão manual.' };
    } catch {
      return { ok: false, candidate: null, message: 'Não foi possível gerar o rascunho agora.' };
    }
  }

  public async generateAndPersist(input: CoachingSignalInput): Promise<{ generated: number; persisted: number }> {
    const recommendations = generateCoachingRecommendations(input);
    const persisted = await this.repository.upsertMany(recommendations);
    await this.auditService?.recordAuditEventSafe({
      eventType: 'COACHING_RECOMMENDATIONS_GENERATED',
      status: 'success',
      severity: 'info',
      source: 'CoachingService',
      payload: {
        scope_type: input.scopeType,
        recommendations: recommendations.length,
        input_hash: recommendations[0]?.inputHash ?? input.inputHash ?? null,
        recommendation_version: recommendations[0]?.recommendationVersion ?? null,
      },
    });

    return { generated: recommendations.length, persisted };
  }
}
