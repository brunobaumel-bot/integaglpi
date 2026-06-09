/**
 * KbEffectivenessService — Read-only KB effectiveness metrics (F2.4).
 *
 * Provides structured metrics for the KB Quality dashboard:
 *   - KB_INSUFFICIENT rate (searches that found no confident result)
 *   - Top helpful articles (aggregated feedback — no technician identity)
 *   - Feedback loop health (total votes, avg helpfulness)
 *   - Pipeline stats (plan sources, tier distribution)
 *   - Gap analysis (categories with highest KB_INSUFFICIENT rate)
 *
 * Safety invariants:
 *   - Read-only: no mutation of tickets, KB, WhatsApp, or config.
 *   - No cloud AI, no MariaDB (GLPI), no PII exposure.
 *   - Technician identities NEVER included in any metric.
 *   - All queries use parameterised SQL — no string interpolation.
 *   - Query timeout: 5 000ms hard cap.
 *
 * Exposed via an internal API endpoint (backend only — no GLPI PHP UI in this phase).
 *
 * Phase: integaglpi_v9_kb_quality_001 — F2.4
 */

import type { SqlExecutor } from '../infra/db/postgres.js';
import type { KbFeedbackRepository } from '../repositories/postgres/PostgresKbFeedbackRepository.js';
import { KB_GOLDEN_SET_META } from '../domain/constants/kbGoldenSetMeta.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const QUERY_TIMEOUT_MS = 5_000;
const DEFAULT_PERIOD_DAYS = 30;
const MAX_PERIOD_DAYS = 90;
const TOP_ARTICLES_LIMIT = 10;
const TOP_GAPS_LIMIT = 10;

const HELPFULNESS_TABLE = 'glpi_plugin_integaglpi_kb_article_helpfulness';
const CANDIDATES_TABLE = 'glpi_plugin_integaglpi_kb_candidates';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface KbEffectivenessFilters {
  /** Look-back window in days. Capped at MAX_PERIOD_DAYS. Default: 30. */
  periodDays?: number;
}

export interface KbTopArticle {
  candidateKey: string;
  title: string;
  categorySuggestion: string;
  sourceTier: string;
  helpfulCount: number;
  notHelpfulCount: number;
  totalVotes: number;
  helpfulRatio: number;
}

export interface KbGapCategory {
  /** Category suggestion field from the candidate table. */
  category: string;
  /** Absolute vote count that had not-helpful feedback. */
  notHelpfulCount: number;
  helpfulCount: number;
  totalVotes: number;
  helpfulRatio: number;
}

export interface KbFeedbackHealth {
  totalVotes: number;
  helpfulVotes: number;
  notHelpfulVotes: number;
  /** Overall helpful ratio across all articles. */
  overallHelpfulRatio: number | null;
  /** Articles that received at least 1 vote in the period. */
  articlesWithVotes: number;
}

export interface KbPipelineStats {
  /** Searches where planSource was 'deterministic' vs 'ollama'. */
  planSourceCounts: { deterministic: number; ollama: number; unknown: number };
  /** Tier distribution in SmartHelp outcomes (if persisted). Informational. */
  note: string;
}

export interface KbEffectivenessReport {
  schema_version: string;
  phase: string;
  deliverable: string;
  generated_at: string;
  period_days: number;
  golden_set_meta: {
    version: string;
    total_queries: number;
    g06_queries: number;
    expansion_queries: number;
  };
  feedback_health: KbFeedbackHealth;
  top_helpful_articles: KbTopArticle[];
  gap_analysis: KbGapCategory[];
  pipeline_stats: KbPipelineStats;
}

// ── Service ───────────────────────────────────────────────────────────────────

export class KbEffectivenessService {
  public constructor(
    private readonly executor: SqlExecutor,
    private readonly feedbackRepo: KbFeedbackRepository,
  ) {}

  /**
   * Build the full KB effectiveness report.
   *
   * @param filters  Optional period + scope filters.
   * @returns        KbEffectivenessReport — fully read-only, no mutations.
   */
  public async buildReport(filters: KbEffectivenessFilters = {}): Promise<KbEffectivenessReport> {
    const periodDays = Math.max(1, Math.min(filters.periodDays ?? DEFAULT_PERIOD_DAYS, MAX_PERIOD_DAYS));

    const [feedbackHealth, topHelpful, gapAnalysis] = await Promise.all([
      this.queryFeedbackHealth(periodDays),
      this.queryTopHelpfulArticles(periodDays),
      this.queryGapAnalysis(periodDays),
    ]);

    return {
      schema_version: '1.0',
      phase: 'integaglpi_v9_kb_quality_001',
      deliverable: 'F2.4',
      generated_at: new Date().toISOString(),
      period_days: periodDays,
      golden_set_meta: {
        version: KB_GOLDEN_SET_META.version,
        total_queries: KB_GOLDEN_SET_META.total_queries,
        g06_queries: KB_GOLDEN_SET_META.g06_queries,
        expansion_queries: KB_GOLDEN_SET_META.expansion_queries,
      },
      feedback_health: feedbackHealth,
      top_helpful_articles: topHelpful,
      gap_analysis: gapAnalysis,
      pipeline_stats: {
        planSourceCounts: { deterministic: 0, ollama: 0, unknown: 0 },
        note:
          'Pipeline stats não persistidos nesta fase — adicionar quando search_log table for criada.',
      },
    };
  }

  // ── Private queries ──────────────────────────────────────────────────────────

  private async queryFeedbackHealth(periodDays: number): Promise<KbFeedbackHealth> {
    const result = await this.withTimeout(
      this.executor.query<{
        total_votes: string;
        helpful_votes: string;
        not_helpful_votes: string;
        articles_with_votes: string;
      }>(
        `
          SELECT
            COUNT(*)::text                                           AS total_votes,
            COUNT(*) FILTER (WHERE helpful = TRUE)::text            AS helpful_votes,
            COUNT(*) FILTER (WHERE helpful = FALSE)::text           AS not_helpful_votes,
            COUNT(DISTINCT COALESCE(kb_candidate_id::text, glpi_knowbaseitem_id::text))::text
                                                                    AS articles_with_votes
          FROM ${HELPFULNESS_TABLE}
          WHERE updated_at >= NOW() - ($1::int || ' days')::interval
        `,
        [periodDays],
      ),
    );

    const row = result.rows[0] ?? {
      total_votes: '0',
      helpful_votes: '0',
      not_helpful_votes: '0',
      articles_with_votes: '0',
    };

    const totalVotes = parseInt(row.total_votes, 10) || 0;
    const helpfulVotes = parseInt(row.helpful_votes, 10) || 0;
    const notHelpfulVotes = parseInt(row.not_helpful_votes, 10) || 0;

    return {
      totalVotes,
      helpfulVotes,
      notHelpfulVotes,
      overallHelpfulRatio:
        totalVotes > 0 ? Number((helpfulVotes / totalVotes).toFixed(4)) : null,
      articlesWithVotes: parseInt(row.articles_with_votes, 10) || 0,
    };
  }

  private async queryTopHelpfulArticles(periodDays: number): Promise<KbTopArticle[]> {
    const result = await this.withTimeout(
      this.executor.query<{
        candidate_key: string;
        title: string;
        category_suggestion: string;
        source_tier: string;
        helpful_count: string;
        not_helpful_count: string;
      }>(
        `
          SELECT
            c.candidate_key,
            c.title,
            COALESCE(c.category_suggestion, 'sem_categoria') AS category_suggestion,
            COALESCE(c.source_tier, 'tier_3_generic_playbook') AS source_tier,
            COUNT(*) FILTER (WHERE h.helpful = TRUE)::text   AS helpful_count,
            COUNT(*) FILTER (WHERE h.helpful = FALSE)::text  AS not_helpful_count
          FROM ${HELPFULNESS_TABLE} h
          INNER JOIN ${CANDIDATES_TABLE} c ON c.id = h.kb_candidate_id
          WHERE h.updated_at >= NOW() - ($1::int || ' days')::interval
            AND h.kb_candidate_id IS NOT NULL
          GROUP BY c.candidate_key, c.title, c.category_suggestion, c.source_tier
          ORDER BY COUNT(*) FILTER (WHERE h.helpful = TRUE) DESC,
                   COUNT(*) DESC
          LIMIT $2::int
        `,
        [periodDays, TOP_ARTICLES_LIMIT],
      ),
    );

    return result.rows.map((r) => {
      const helpfulCount = parseInt(r.helpful_count, 10) || 0;
      const notHelpfulCount = parseInt(r.not_helpful_count, 10) || 0;
      const totalVotes = helpfulCount + notHelpfulCount;
      return {
        candidateKey: r.candidate_key,
        title: r.title,
        categorySuggestion: r.category_suggestion,
        sourceTier: r.source_tier,
        helpfulCount,
        notHelpfulCount,
        totalVotes,
        helpfulRatio: totalVotes > 0 ? Number((helpfulCount / totalVotes).toFixed(4)) : 0,
      };
    });
  }

  private async queryGapAnalysis(periodDays: number): Promise<KbGapCategory[]> {
    // Gap = categories where not_helpful_count dominates → coverage gap
    const result = await this.withTimeout(
      this.executor.query<{
        category: string;
        helpful_count: string;
        not_helpful_count: string;
      }>(
        `
          SELECT
            COALESCE(c.category_suggestion, 'sem_categoria') AS category,
            COUNT(*) FILTER (WHERE h.helpful = TRUE)::text   AS helpful_count,
            COUNT(*) FILTER (WHERE h.helpful = FALSE)::text  AS not_helpful_count
          FROM ${HELPFULNESS_TABLE} h
          LEFT JOIN ${CANDIDATES_TABLE} c ON c.id = h.kb_candidate_id
          WHERE h.updated_at >= NOW() - ($1::int || ' days')::interval
          GROUP BY COALESCE(c.category_suggestion, 'sem_categoria')
          ORDER BY COUNT(*) FILTER (WHERE h.helpful = FALSE) DESC,
                   COUNT(*) DESC
          LIMIT $2::int
        `,
        [periodDays, TOP_GAPS_LIMIT],
      ),
    );

    return result.rows.map((r) => {
      const helpfulCount = parseInt(r.helpful_count, 10) || 0;
      const notHelpfulCount = parseInt(r.not_helpful_count, 10) || 0;
      const totalVotes = helpfulCount + notHelpfulCount;
      return {
        category: r.category,
        helpfulCount,
        notHelpfulCount,
        totalVotes,
        helpfulRatio: totalVotes > 0 ? Number((helpfulCount / totalVotes).toFixed(4)) : 0,
      };
    });
  }

  /** Wraps a promise with a hard timeout to prevent long-running DB queries. */
  private withTimeout<T>(promise: Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const id = setTimeout(() => reject(new Error('KbEffectivenessService: query timeout')), QUERY_TIMEOUT_MS);
      promise.then(
        (v) => { clearTimeout(id); resolve(v); },
        (e: unknown) => { clearTimeout(id); reject(e); },
      );
    });
  }
}
