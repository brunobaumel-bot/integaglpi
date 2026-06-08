/**
 * KbRankingService — Hybrid score ranking for KB candidates.
 *
 * Combines PostgreSQL lexical/FTS score with manual field-match weights
 * to produce a deterministic, transparent ranking.
 *
 * Score formula (per RANKING_POLICY):
 *   total = 0.60 × lexicalScore
 *         + 0.20 × symptomsMatch (0/1)
 *         + 0.10 × aiHintMatch   (0/1)
 *         + 0.07 × tagsMatch     (0/1)
 *         + 0.03 × titleMatch    (0/1)
 *         + contextBoostAmount   (0.10 if productOrSystem matches, 0.05 if category)
 *
 * Client context:
 *   - productOrSystem: boost if hit title/category/tags contain the product name
 *   - category: softer boost (0.5x) if hit category contains the ticket category
 *   - entityId/clientName: reserved for future use (no MariaDB access here)
 *
 * Invariants:
 *   - No cloud AI. No DB access. Pure computation.
 *   - No ticket mutation. No command execution.
 *   - Score breakdown is transparent (visible to UI).
 *
 * Phase: integaglpi_local_kb_rag_model_query_expansion_adendum_001
 */

import type { KbCandidateHit } from '../../repositories/postgres/PostgresKbCandidateSearchRepository.js';

// ── Domain types ──────────────────────────────────────────────────────────────

export interface KbClientContext {
  entityId?: number | null;
  clientName?: string | null;
  /** Product/system name for context boost (e.g. "Micromed", "Microsoft 365"). */
  productOrSystem?: string | null;
  /** Ticket category for softer boost (e.g. "Backup", "Firewall"). */
  category?: string | null;
}

export interface KbScoreBreakdown {
  /** ts_rank from PostgreSQL, normalised to [0,1]. */
  lexicalScore: number;
  /** Query tokens matched in symptoms_json / problem_pattern. */
  symptomsMatch: boolean;
  /** Query tokens matched in evidence_summary_sanitized (ai_hint). */
  aiHintMatch: boolean;
  /** Query tokens matched in tags_json. */
  tagsMatch: boolean;
  /** Query tokens matched in title. */
  titleMatch: boolean;
  /** Client context (productOrSystem or category) matched in hit fields. */
  contextBoost: boolean;
  /** Final weighted score [0,1]. */
  total: number;
}

export interface RankedKbHit {
  hit: KbCandidateHit;
  breakdown: KbScoreBreakdown;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const SCORE_WEIGHTS = {
  lexical: 0.60,
  symptoms: 0.20,
  aiHint: 0.10,
  tags: 0.07,
  title: 0.03,
  contextBoostProduct: 0.10,  // full boost for productOrSystem match
  contextBoostCategory: 0.05, // softer boost for category match
} as const;

/** Minimum score to include in results (excludes weak lexical noise). */
const MIN_SCORE_THRESHOLD = 0.25;

// ── Service ───────────────────────────────────────────────────────────────────

export class KbRankingService {
  /**
   * Rank hits using hybrid scoring.
   *
   * @param hits          Raw hits from PostgreSQL search (any order).
   * @param queryTokens   De-accented lowercase tokens from the expanded query.
   * @param clientContext Optional client context for boost (never hard filter).
   * @param topK          Maximum results to return (3–5).
   */
  public rankHits(
    hits: KbCandidateHit[],
    queryTokens: string[],
    clientContext?: KbClientContext | null,
    topK = 5,
  ): RankedKbHit[] {
    const safeTopK = Math.max(3, Math.min(5, topK));

    const scored = hits.map((hit) => ({
      hit,
      breakdown: this.scoreHit(hit, queryTokens, clientContext),
    }));

    return scored
      .filter((r) => !this.hasDomainConflict(queryTokens, r.hit))
      // If no tokens (degenerate query), accept all hits above threshold
      .filter((r) =>
        queryTokens.length === 0
          ? r.breakdown.total >= 0
          : r.breakdown.total >= MIN_SCORE_THRESHOLD,
      )
      .sort((a, b) => b.breakdown.total - a.breakdown.total)
      .slice(0, safeTopK);
  }

  private scoreHit(
    hit: KbCandidateHit,
    queryTokens: string[],
    clientContext?: KbClientContext | null,
  ): KbScoreBreakdown {
    const matchIn = (text: string): boolean => {
      if (queryTokens.length === 0) return false;
      return queryTokens.some((t) => text.toLowerCase().includes(t));
    };

    const symptomsText = hit.symptomsJson.join(' ') + ' ' + hit.problemPattern;
    const symptomsMatch = matchIn(symptomsText);
    const aiHintMatch = matchIn(hit.evidenceSummarySanitized);
    const tagsMatch = matchIn(hit.tagsJson.join(' '));
    const titleMatch = matchIn(hit.title);

    let total =
      SCORE_WEIGHTS.lexical * hit.rawScore +
      SCORE_WEIGHTS.symptoms * (symptomsMatch ? 1 : 0) +
      SCORE_WEIGHTS.aiHint * (aiHintMatch ? 1 : 0) +
      SCORE_WEIGHTS.tags * (tagsMatch ? 1 : 0) +
      SCORE_WEIGHTS.title * (titleMatch ? 1 : 0);

    let contextBoost = false;

    // Product/system boost (highest priority)
    if (clientContext?.productOrSystem) {
      const product = clientContext.productOrSystem.trim();
      if (product.length >= 2) {
        const productLower = product.toLowerCase();
        const inTitle = hit.title.toLowerCase().includes(productLower);
        const inCategory = hit.categorySuggestion.toLowerCase().includes(productLower);
        const inTags = hit.tagsJson.some((t) => t.toLowerCase().includes(productLower));
        const inSymptoms = symptomsText.toLowerCase().includes(productLower);
        if (inTitle || inCategory || inTags || inSymptoms) {
          total = Math.min(1, total + SCORE_WEIGHTS.contextBoostProduct);
          contextBoost = true;
        }
      }
    }

    // Category softer boost (applied if product didn't already boost)
    if (!contextBoost && clientContext?.category) {
      const catLower = clientContext.category.toLowerCase().trim();
      if (catLower.length >= 2 && hit.categorySuggestion.toLowerCase().includes(catLower)) {
        total = Math.min(1, total + SCORE_WEIGHTS.contextBoostCategory);
        contextBoost = true;
      }
    }

    return {
      lexicalScore: Number(hit.rawScore.toFixed(4)),
      symptomsMatch,
      aiHintMatch,
      tagsMatch,
      titleMatch,
      contextBoost,
      total: Number(total.toFixed(4)),
    };
  }

  private hasDomainConflict(queryTokens: string[], hit: KbCandidateHit): boolean {
    const query = queryTokens.join(' ');
    const hitText = [
      hit.title,
      hit.categorySuggestion,
      hit.problemPattern,
      hit.symptomsJson.join(' '),
      hit.tagsJson.join(' '),
      hit.evidenceSummarySanitized,
    ].join(' ').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ' ');

    const queryIsDirectorySync =
      /\b(active|directory|azure|entra|dominio|domain|ad)\b/.test(query)
      && /\b(sync|sincron|sincronizacao|sincronizando|replicacao|replicar)\b/.test(query);
    if (queryIsDirectorySync) {
      const hitIsActivation =
        /\b(ativacao|ativar|ativa|licenca|license)\b/.test(hitText)
        || (/\bwindows\b/.test(hitText) && !/\b(active|directory|azure|entra|dominio|domain|ad|sync|sincron)\b/.test(hitText));
      return hitIsActivation;
    }

    const queryIsWindowsActivation =
      /\bwindows\b/.test(query)
      && /\b(ativacao|ativar|ativa|licenca|license)\b/.test(query);
    if (queryIsWindowsActivation) {
      return /\b(active|directory|azure|entra|dominio|domain|ad|sync|sincron)\b/.test(hitText);
    }

    return false;
  }
}
