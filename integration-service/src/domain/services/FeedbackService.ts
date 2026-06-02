import type {
  KbArticleHelpfulness,
  KbFeedbackRepository,
  KbFeedbackVote,
} from '../../repositories/postgres/PostgresKbFeedbackRepository.js';

export interface FeedbackVoteInput {
  kbCandidateId?: number | null;
  glpiKnowbaseitemId?: number | null;
  glpiTicketId?: number | null;
  technicianId?: number | null;
  helpful: boolean;
  feedbackText?: string | null;
  source?: string;
}

export interface FeedbackRecordResult {
  ok: boolean;
  status: 'recorded' | 'invalid_target' | 'failed';
  message: string;
  /** Updated helpfulness snapshot after recording (null on failure). */
  helpfulness: KbArticleHelpfulness | null;
}

/** Audit hook — optional; receives only sanitized, non-PII metadata. */
export interface FeedbackAuditPort {
  recordAuditEventSafe(event: {
    eventType: string;
    status: 'success' | 'failed';
    severity: 'info' | 'warning';
    source: string;
    payload: Record<string, unknown>;
  }): Promise<void>;
}

/**
 * FeedbackService — closed loop for "ajudou / não ajudou" on KB articles and
 * candidate suggestions. The vote adjusts future ranking via a Laplace-smoothed
 * helpfulness score. Reporting is aggregated only; technician identity is never
 * surfaced in any metric (no punitive metrics).
 */
export class FeedbackService {
  public constructor(
    private readonly repository: KbFeedbackRepository,
    private readonly audit?: FeedbackAuditPort,
  ) {}

  public async recordFeedback(input: FeedbackVoteInput): Promise<FeedbackRecordResult> {
    const kbCandidateId = this.normalizeId(input.kbCandidateId);
    const glpiKnowbaseitemId = this.normalizeId(input.glpiKnowbaseitemId);

    // Exactly one target must be present.
    if (kbCandidateId === null && glpiKnowbaseitemId === null) {
      return {
        ok: false,
        status: 'invalid_target',
        message: 'É necessário um artigo (candidato ou KB nativa) para registrar feedback.',
        helpfulness: null,
      };
    }

    const vote: KbFeedbackVote = {
      kbCandidateId,
      glpiKnowbaseitemId,
      glpiTicketId: this.normalizeId(input.glpiTicketId),
      technicianId: this.normalizeId(input.technicianId),
      helpful: input.helpful === true,
      feedbackText: input.feedbackText ?? null,
      source: input.source ?? 'smart_help',
    };

    try {
      await this.repository.recordVote(vote);
      const helpfulness = await this.repository.getHelpfulness({ kbCandidateId, glpiKnowbaseitemId });

      await this.audit?.recordAuditEventSafe({
        eventType: vote.helpful ? 'KB_ARTICLE_HELPFUL_FEEDBACK' : 'KB_ARTICLE_NOT_HELPFUL_FEEDBACK',
        status: 'success',
        severity: 'info',
        source: 'FeedbackService',
        payload: {
          // No technician identity, no free text — aggregated counters only.
          kb_candidate_id: kbCandidateId,
          glpi_knowbaseitem_id: glpiKnowbaseitemId,
          helpful: vote.helpful,
          helpful_count: helpfulness.helpfulCount,
          not_helpful_count: helpfulness.notHelpfulCount,
          score: helpfulness.score,
          non_punitive: true,
        },
      });

      return {
        ok: true,
        status: 'recorded',
        message: 'Feedback registrado.',
        helpfulness,
      };
    } catch {
      return {
        ok: false,
        status: 'failed',
        message: 'Não foi possível registrar o feedback agora.',
        helpfulness: null,
      };
    }
  }

  /**
   * Returns a ranking bias multiplier in [0.5, 1.5] derived from the helpfulness
   * score, so articles voted helpful surface earlier and unhelpful ones sink —
   * without ever hard-hiding an article.
   */
  public async getRankingBias(target: {
    kbCandidateId?: number | null;
    glpiKnowbaseitemId?: number | null;
  }): Promise<number> {
    try {
      const h = await this.repository.getHelpfulness(target);
      // score 0.5 (neutral) → 1.0; score 1 → 1.5; score 0 → 0.5.
      return Number((0.5 + h.score).toFixed(4));
    } catch {
      return 1.0; // neutral on error — never penalize due to a read failure
    }
  }

  /** Aggregated helpfulness by category (supervisor view). No technician data. */
  public async getCategoryEffectiveness(limit = 50): Promise<Array<{
    category: string;
    helpfulCount: number;
    notHelpfulCount: number;
    helpfulRatio: number;
  }>> {
    try {
      return await this.repository.getAggregatedByCategory(limit);
    } catch {
      return [];
    }
  }

  private normalizeId(value: number | null | undefined): number | null {
    if (value === null || value === undefined) {
      return null;
    }
    const n = Number(value);
    return Number.isInteger(n) && n > 0 ? n : null;
  }
}
