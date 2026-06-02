import type { SqlExecutor } from '../../infra/db/postgres.js';

const HELPFULNESS_TABLE = 'glpi_plugin_integaglpi_kb_article_helpfulness';

export interface KbFeedbackVote {
  /** Internal KB candidate id, if the suggestion was a candidate. */
  kbCandidateId: number | null;
  /** Native GLPI knowbaseitem id, if the suggestion was a published article. */
  glpiKnowbaseitemId: number | null;
  /** Context ticket. */
  glpiTicketId: number | null;
  /** Technician id — used only to de-duplicate votes, never to rank. */
  technicianId: number | null;
  helpful: boolean;
  feedbackText?: string | null;
  source?: string;
}

export interface KbArticleHelpfulness {
  kbCandidateId: number | null;
  glpiKnowbaseitemId: number | null;
  helpfulCount: number;
  notHelpfulCount: number;
  totalVotes: number;
  helpfulRatio: number;
  /** Smoothed score in [0,1] used to bias future ranking (Laplace-smoothed). */
  score: number;
}

export interface KbFeedbackRepository {
  recordVote(vote: KbFeedbackVote): Promise<void>;
  getHelpfulness(target: { kbCandidateId?: number | null; glpiKnowbaseitemId?: number | null }): Promise<KbArticleHelpfulness>;
  /** Aggregated helpfulness by category — never returns technician identities. */
  getAggregatedByCategory(limit: number): Promise<Array<{ category: string; helpfulCount: number; notHelpfulCount: number; helpfulRatio: number }>>;
}

/** Laplace-smoothed helpful ratio so a single vote does not dominate ranking. */
export function helpfulnessScore(helpfulCount: number, notHelpfulCount: number): number {
  const total = helpfulCount + notHelpfulCount;
  // (helpful + 1) / (total + 2) — neutral 0.5 prior, converges to true ratio.
  return Number(((helpfulCount + 1) / (total + 2)).toFixed(4));
}

function sanitizeFeedbackText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  // Bounded, tag-stripped, no control characters. PII scrubbing for cloud is
  // handled separately by the existing sanitizer; this is a short internal note.
  const cleaned = String(value).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned === '' ? null : cleaned.slice(0, 500);
}

export class PostgresKbFeedbackRepository implements KbFeedbackRepository {
  public constructor(private readonly executor: SqlExecutor) {}

  public async recordVote(vote: KbFeedbackVote): Promise<void> {
    // Upsert: a technician may change their vote on the same article/ticket.
    await this.executor.query(
      `
        INSERT INTO ${HELPFULNESS_TABLE} (
          kb_candidate_id, glpi_knowbaseitem_id, glpi_ticket_id, technician_id,
          helpful, feedback_text, source, created_at, updated_at
        )
        VALUES ($1::bigint, $2::bigint, $3::bigint, $4::bigint, $5::boolean, $6::text, $7::text, NOW(), NOW())
        ON CONFLICT (kb_candidate_id, glpi_knowbaseitem_id, glpi_ticket_id, technician_id)
        DO UPDATE SET
          helpful = EXCLUDED.helpful,
          feedback_text = EXCLUDED.feedback_text,
          source = EXCLUDED.source,
          updated_at = NOW()
      `,
      [
        vote.kbCandidateId,
        vote.glpiKnowbaseitemId,
        vote.glpiTicketId,
        vote.technicianId,
        vote.helpful,
        sanitizeFeedbackText(vote.feedbackText),
        vote.source ?? 'smart_help',
      ],
    );
  }

  public async getHelpfulness(target: {
    kbCandidateId?: number | null;
    glpiKnowbaseitemId?: number | null;
  }): Promise<KbArticleHelpfulness> {
    const kbCandidateId = target.kbCandidateId ?? null;
    const glpiKnowbaseitemId = target.glpiKnowbaseitemId ?? null;

    const result = await this.executor.query<{ helpful_count: string; not_helpful_count: string }>(
      `
        SELECT
          COUNT(*) FILTER (WHERE helpful = TRUE)::text  AS helpful_count,
          COUNT(*) FILTER (WHERE helpful = FALSE)::text AS not_helpful_count
        FROM ${HELPFULNESS_TABLE}
        WHERE ($1::bigint IS NULL OR kb_candidate_id = $1::bigint)
          AND ($2::bigint IS NULL OR glpi_knowbaseitem_id = $2::bigint)
          AND ($1::bigint IS NOT NULL OR $2::bigint IS NOT NULL)
      `,
      [kbCandidateId, glpiKnowbaseitemId],
    );

    const row = result.rows[0] ?? { helpful_count: '0', not_helpful_count: '0' };
    const helpfulCount = parseInt(row.helpful_count, 10) || 0;
    const notHelpfulCount = parseInt(row.not_helpful_count, 10) || 0;
    const totalVotes = helpfulCount + notHelpfulCount;

    return {
      kbCandidateId,
      glpiKnowbaseitemId,
      helpfulCount,
      notHelpfulCount,
      totalVotes,
      helpfulRatio: totalVotes > 0 ? Number((helpfulCount / totalVotes).toFixed(4)) : 0,
      score: helpfulnessScore(helpfulCount, notHelpfulCount),
    };
  }

  public async getAggregatedByCategory(
    limit: number,
  ): Promise<Array<{ category: string; helpfulCount: number; notHelpfulCount: number; helpfulRatio: number }>> {
    // Joins to the candidate category. Aggregated only — no technician columns.
    const bounded = Math.max(1, Math.min(limit, 200));
    const result = await this.executor.query<{
      category: string;
      helpful_count: string;
      not_helpful_count: string;
    }>(
      `
        SELECT
          COALESCE(c.category_suggestion, 'sem_categoria') AS category,
          COUNT(*) FILTER (WHERE h.helpful = TRUE)::text  AS helpful_count,
          COUNT(*) FILTER (WHERE h.helpful = FALSE)::text AS not_helpful_count
        FROM ${HELPFULNESS_TABLE} h
        LEFT JOIN glpi_plugin_integaglpi_kb_candidates c ON c.id = h.kb_candidate_id
        GROUP BY COALESCE(c.category_suggestion, 'sem_categoria')
        ORDER BY COUNT(*) DESC
        LIMIT $1::int
      `,
      [bounded],
    );

    return result.rows.map((r) => {
      const helpfulCount = parseInt(r.helpful_count, 10) || 0;
      const notHelpfulCount = parseInt(r.not_helpful_count, 10) || 0;
      const total = helpfulCount + notHelpfulCount;
      return {
        category: r.category,
        helpfulCount,
        notHelpfulCount,
        helpfulRatio: total > 0 ? Number((helpfulCount / total).toFixed(4)) : 0,
      };
    });
  }
}
