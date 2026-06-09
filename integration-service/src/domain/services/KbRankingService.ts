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
 * SearchPlan integration (phase: integaglpi_kb_rag_ai_search_planner_hybrid_retrieval_001):
 *   - mustTerms: hard exclusion — article must contain at least one must_term
 *   - negativeDomains: plan-based domain exclusion (broader than hardcoded)
 *   - sourceTiersAllowed: applied via applyTierFilter() after rankHits()
 *
 * Source tier classification (deterministic, no AI):
 *   tier_1_product_specific — named software product (Micromed, AD, Synology, …)
 *   tier_2_operational_kb   — operational topic (backup, firewall, server, …)
 *   tier_3_generic_playbook — catch-all / generic troubleshooting
 *   tier_4_automation       — automation scripts (never primary; never executable)
 *
 * Invariants:
 *   - No cloud AI. No DB access. Pure computation.
 *   - No ticket mutation. No command execution.
 *   - Score breakdown is transparent (visible to UI).
 *
 * Phase: integaglpi_local_kb_rag_model_query_expansion_adendum_001
 * Search Planner: integaglpi_kb_rag_ai_search_planner_hybrid_retrieval_001
 */

import type { KbCandidateHit } from '../../repositories/postgres/PostgresKbCandidateSearchRepository.js';
import { NEGATIVE_DOMAIN_PATTERNS } from './KbSearchPlannerService.js';
import type { SearchPlan, SourceTier } from './KbSearchPlannerService.js';

// ── Domain types ──────────────────────────────────────────────────────────────

/**
 * Feedback bias map for non-punitive ranking (F2.2 — FEEDBACK_RANKING_ENABLED).
 *
 * Preconditions guaranteed by the caller:
 *   - Caller only passes this when FEEDBACK_RANKING_ENABLED=true (env/flag).
 *   - Only articles with totalVotes >= MIN_VOTES_FOR_RANKING are included in byKey.
 *   - Identity of individual technicians is NEVER included here — aggregated scores only.
 *
 * Multiplier formula:
 *   helpfulness score ∈ [0, 1] (Laplace-smoothed from PostgresKbFeedbackRepository)
 *   multiplier = 0.80 + score × 0.40  → [0.80, 1.20]
 *   score=0.5 (neutral / no data) → multiplier=1.0 (no effect)
 *   score→1.0 (very helpful)     → multiplier→1.2 (+20%)
 *   score→0.0 (never helpful)    → multiplier→0.8 (−20% — soft, never eliminates)
 *
 * Invariants:
 *   - Hard domain filters and mustTerms exclusions run BEFORE the multiplier.
 *   - Score cap at 1.0 is applied AFTER the multiplier.
 *   - A single negative vote NEVER penalises (volume threshold enforced by caller).
 */
export interface KbFeedbackBias {
  /** Map from candidateKey → Laplace-smoothed helpfulness score [0, 1]. */
  byKey: ReadonlyMap<string, number>;
  /**
   * Minimum votes that were required before inclusion in byKey.
   * Informational — allows F2.4 dashboard to show this threshold.
   */
  appliedMinVotes: number;
}

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

// ── Source tier classification constants ──────────────────────────────────────

/**
 * Named software products that identify tier_1 articles.
 * These are specific product names — NOT generic operational terms.
 */
const TIER_1_PRODUCT_TERMS: readonly string[] = [
  // Medical/vertical ERP
  'micromed', 'smarthealth',
  // Identity management
  'active directory', 'azure ad', 'ad connect', 'entra id',
  // NAS/backup appliance
  'synology', 'veeam',
  // Cloud productivity suite
  'microsoft 365', 'm365', 'office 365',
  // Security / monitoring
  'zabbix', 'nagios', 'fortinet', 'sophos',
];

/**
 * Regex identifying automation/scripting articles — tier_4.
 * These NEVER serve as primary KB results. Executable content is forbidden.
 */
const AUTOMATION_TIER_PATTERNS =
  /\b(automation|automacao|script|powershell|bash|runbook|playbook automatizado|sre)\b/i;

/**
 * Regex identifying operational KB articles — tier_2.
 * Checked ONLY when no tier_1 product term matches.
 */
const OPERATIONAL_TIER_PATTERNS =
  /\b(backup|restore|firewall|proxy|pfsense|servidor|dns|vpn|email|exchange|storage|sincronizacao|replicacao)\b/i;

/** Lower number = higher priority in mixed-tier result sets. */
const TIER_PRIORITY: Record<SourceTier, number> = {
  tier_1_product_specific: 1,
  tier_2_operational_kb: 2,
  tier_3_generic_playbook: 3,
  tier_4_automation: 4,
};

// ── Service ───────────────────────────────────────────────────────────────────

export class KbRankingService {
  /**
   * Rank hits using hybrid scoring.
   *
   * @param hits          Raw hits from PostgreSQL search (any order).
   * @param queryTokens   De-accented lowercase tokens from the expanded query.
   * @param clientContext Optional client context for boost (never hard filter).
   * @param topK          Maximum results to return (3–5).
   * @param plan          Optional SearchPlan for plan-based hard filters (mustTerms, negativeDomains).
   * @param feedbackBias  F2.2 — pre-fetched helpfulness bias (null = FEEDBACK_RANKING_ENABLED=false).
   *                      Caller is responsible for enforcing the feature flag and min votes threshold.
   */
  public rankHits(
    hits: KbCandidateHit[],
    queryTokens: string[],
    clientContext?: KbClientContext | null,
    topK = 5,
    plan?: SearchPlan | null,
    feedbackBias?: KbFeedbackBias | null,
  ): RankedKbHit[] {
    const safeTopK = Math.max(3, Math.min(5, topK));

    const scored = hits.map((hit) => ({
      hit,
      breakdown: this.scoreHit(hit, queryTokens, clientContext),
    }));

    return scored
      // Hard exclusion: domain conflict (hardcoded + plan negative_domains)
      .filter((r) => !this.hasDomainConflict(queryTokens, r.hit, plan))
      // Hard exclusion: plan must_terms — article must contain at least one must_term
      .filter((r) => plan ? !this.doesNotMeetMustTerms(r.hit, plan.mustTerms) : true)
      // If no tokens (degenerate query), accept all hits above threshold
      .filter((r) =>
        queryTokens.length === 0
          ? r.breakdown.total >= 0
          : r.breakdown.total >= MIN_SCORE_THRESHOLD,
      )
      // F2.2 — apply non-punitive feedback multiplier (only when bias provided)
      .map((r) => feedbackBias ? this.applyFeedbackBias(r, feedbackBias) : r)
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

  /**
   * Hard exclusion: article must contain at least one term from plan.mustTerms.
   * Returns true (i.e. "does not meet") when none of the must_terms appear in the article.
   * Always returns false when mustTerms is empty (no restriction).
   */
  private doesNotMeetMustTerms(hit: KbCandidateHit, mustTerms: readonly string[]): boolean {
    if (!mustTerms || mustTerms.length === 0) return false;

    const hitText = [
      hit.title,
      hit.categorySuggestion,
      hit.symptomsJson.join(' '),
      hit.tagsJson.join(' '),
      hit.evidenceSummarySanitized,
      hit.problemPattern,
    ]
      .join(' ')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '');

    return !mustTerms.some((term) => {
      const normTerm = term
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '');
      return hitText.includes(normTerm);
    });
  }

  // ── Source tier enforcement ─────────────────────────────────────────────────

  /**
   * Classify a KB article into a source tier deterministically (no AI).
   *
   * Classification order (first match wins):
   *   1. tier_4_automation — article type or automation keyword in metadata
   *   2. tier_1_product_specific — named software product in metadata
   *   3. tier_2_operational_kb — operational topic keyword in metadata
   *   4. tier_3_generic_playbook — catch-all
   *
   * @param hit  Raw KB candidate hit.
   * @returns    The source tier for this article.
   */
  public static computeArticleTier(hit: KbCandidateHit): SourceTier {
    const hitText = [hit.title, hit.categorySuggestion, hit.tagsJson.join(' ')]
      .join(' ')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '');

    // tier_4: automation/script articles — never primary, executable forbidden
    if (
      hit.articleType === 'automation' ||
      hit.articleType === 'script' ||
      AUTOMATION_TIER_PATTERNS.test(hitText)
    ) {
      return 'tier_4_automation';
    }

    // tier_1: specific named products — highest trust for product-anchored queries
    if (TIER_1_PRODUCT_TERMS.some((term) => hitText.includes(term))) {
      return 'tier_1_product_specific';
    }

    // tier_2: operational topics (backup, firewall, mail, server…)
    if (OPERATIONAL_TIER_PATTERNS.test(hitText)) {
      return 'tier_2_operational_kb';
    }

    // tier_3: generic playbook — catch-all
    return 'tier_3_generic_playbook';
  }

  /**
   * Apply source tier filter to an already-ranked result list.
   *
   * Articles whose tier is NOT in `tiersAllowed` are removed.
   * Among remaining articles, tier_1 always sorts before tier_2, which sorts
   * before tier_3 — even if a lower-tier article had a higher score.
   * Within the same tier, score descending order is preserved.
   *
   * @param ranked       Output of rankHits().
   * @param tiersAllowed Allowed tiers from SearchPlan.sourceTiersAllowed.
   * @returns            Filtered and tier-sorted result list.
   */
  public applyTierFilter(
    ranked: RankedKbHit[],
    tiersAllowed: readonly SourceTier[],
  ): RankedKbHit[] {
    const tiersSet = new Set(tiersAllowed);

    return ranked
      .filter((r) => tiersSet.has(KbRankingService.computeArticleTier(r.hit)))
      .sort((a, b) => {
        const prioA = TIER_PRIORITY[KbRankingService.computeArticleTier(a.hit)] ?? 99;
        const prioB = TIER_PRIORITY[KbRankingService.computeArticleTier(b.hit)] ?? 99;
        if (prioA !== prioB) return prioA - prioB; // lower number = higher rank
        return b.breakdown.total - a.breakdown.total; // same tier: score desc
      });
  }

  /**
   * F2.2 — Apply non-punitive feedback multiplier.
   *
   * Multiplier formula: 0.80 + helpfulnessScore × 0.40 → [0.80, 1.20]
   * Neutral score (0.5) → multiplier 1.0 (no effect).
   * Applied AFTER hard filters so exclusion logic is never softened.
   * Score is capped at 1.0 after the multiplier.
   */
  private applyFeedbackBias(ranked: RankedKbHit, bias: KbFeedbackBias): RankedKbHit {
    const score = bias.byKey.get(ranked.hit.candidateKey);
    if (score === undefined) {
      // No bias entry → article either has insufficient votes or is new → neutral (no change)
      return ranked;
    }
    const multiplier = 0.80 + score * 0.40; // [0.80, 1.20]
    const adjustedTotal = Number(Math.min(1.0, ranked.breakdown.total * multiplier).toFixed(4));
    return {
      hit: ranked.hit,
      breakdown: { ...ranked.breakdown, total: adjustedTotal },
    };
  }

  private hasDomainConflict(queryTokens: string[], hit: KbCandidateHit, plan?: SearchPlan | null): boolean {
    const query = queryTokens.join(' ');
    const hitText = [
      hit.title,
      hit.categorySuggestion,
      hit.problemPattern,
      hit.symptomsJson.join(' '),
      hit.tagsJson.join(' '),
      hit.evidenceSummarySanitized,
    ].join(' ').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ' ');

    // Helper: KB is about Windows license activation
    const hitIsWindowsActivation =
      /\b(ativacao|ativar|ativa|licenca|license)\b/.test(hitText)
      && /\bwindows\b/.test(hitText);

    // AD-sync query must not return Windows activation KB
    const queryIsDirectorySync =
      /\b(active|directory|azure|entra|dominio|domain|ad)\b/.test(query)
      && /\b(sync|sincron|sincronizacao|sincronizando|replicacao|replicar)\b/.test(query);
    if (queryIsDirectorySync) {
      return hitIsWindowsActivation
        || (/\bwindows\b/.test(hitText) && !/\b(active|directory|azure|entra|dominio|domain|ad|sync|sincron)\b/.test(hitText));
    }

    // Windows-activation query must not return AD/sync KB
    const queryIsWindowsActivation =
      /\bwindows\b/.test(query)
      && /\b(ativacao|ativar|ativa|licenca|license)\b/.test(query);
    if (queryIsWindowsActivation) {
      return /\b(active|directory|azure|entra|dominio|domain|ad|sync|sincron)\b/.test(hitText);
    }

    // Specific-product query must not return Windows activation KB.
    // Products that have their own ecosystems unrelated to Windows licensing.
    const ISOLATED_PRODUCTS = ['micromed', 'veeam', 'synology', 'zabbix', 'nagios', 'fortinet', 'sophos'];
    const queryHasIsolatedProduct = ISOLATED_PRODUCTS.some((p) =>
      queryTokens.some((t) => t.includes(p)),
    );
    if (queryHasIsolatedProduct && hitIsWindowsActivation) {
      return true;
    }

    // Plan-based negative domain exclusion (broader, structured by SearchPlan).
    // Takes precedence over hardcoded rules where plan is available.
    if (plan?.negativeDomains && plan.negativeDomains.length > 0) {
      for (const domain of plan.negativeDomains) {
        const pattern = NEGATIVE_DOMAIN_PATTERNS[domain];
        if (pattern !== undefined && pattern.test(hitText)) {
          return true;
        }
      }
    }

    return false;
  }
}
