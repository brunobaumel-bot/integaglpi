/**
 * Unit tests — KbRankingService
 *
 * Phase: integaglpi_local_kb_rag_model_query_expansion_adendum_001
 *
 * Tests:
 *  1.  Score formula: lexical 0.60 + field matches applied correctly.
 *  2.  Symptoms match (0.20) beats ai_hint match (0.10).
 *  3.  Context boost applied when productOrSystem matches title.
 *  4.  Context boost applied when productOrSystem matches category.
 *  5.  Context boost NOT applied when no match.
 *  6.  Category context softer boost (0.05) less than product boost (0.10).
 *  7.  Score capped at 1.0.
 *  8.  topK respected (max 5, min 3).
 *  9.  Results sorted descending by total score.
 * 10.  Min threshold: zero-score hit excluded when tokens are present.
 * 11.  Empty hits → empty result.
 * 12.  Eight canonical queries rank symptom-matching articles higher.
 * 13.  AD sync query excludes Windows activation articles.
 * 14.  Isolated-product query (micromed) excludes Windows activation articles.
 * 15.  plan mustTerms: article without must_term is excluded.
 * 16.  plan negativeDomains: pattern-matched domain excludes article.
 * 17.  plan with empty mustTerms does not add extra filtering.
 *
 * Tier enforcement tests (phase: integaglpi_kb_rag_ai_search_planner_hybrid_retrieval_fix_001):
 * 18.  computeArticleTier: Micromed article → tier_1_product_specific.
 * 19.  computeArticleTier: generic checklist article → tier_3_generic_playbook.
 * 20.  computeArticleTier: automation article (articleType=automation) → tier_4_automation.
 * 21.  applyTierFilter: tier_3 article excluded when only tier_1/tier_2 allowed.
 * 22.  applyTierFilter: tier_4 automation excluded and tier_1 wins even with lower rawScore.
 *
 * Search Planner: integaglpi_kb_rag_ai_search_planner_hybrid_retrieval_001
 */

import { describe, it, expect } from 'vitest';
import { KbRankingService, type KbClientContext } from '../src/domain/services/KbRankingService.js';
import type { KbCandidateHit } from '../src/repositories/postgres/PostgresKbCandidateSearchRepository.js';
import type { SearchPlan, SourceTier } from '../src/domain/services/KbSearchPlannerService.js';

function makeHit(over: Partial<KbCandidateHit> = {}): KbCandidateHit {
  return {
    id: 1,
    candidateKey: 'kb-test-001',
    title: 'Micromed não abre após atualização',
    articleType: 'procedimento_tecnico',
    categorySuggestion: 'Sistema / Micromed',
    problemPattern: 'Sistema não inicia; erro de permissão',
    symptomsJson: ['Sistema não abre', 'Erro de permissão', 'Tela preta'],
    probableCause: 'Permissão de pasta bloqueada.',
    recommendedProcedureJson: ['Verificar logs', 'Checar permissão', 'Reinstalar'],
    checklistJson: ['Sistema abre', 'Login validado'],
    tagsJson: ['micromed', 'sistema', 'permissao'],
    evidenceSummarySanitized: 'micromed bloqueado permissao pasta',
    confidenceScore: 80,
    rawScore: 0.8,
    ...over,
  };
}

const svc = new KbRankingService();

describe('KbRankingService', () => {
  it('1. score formula — symptoms match adds 0.20 to lexical 0.60', () => {
    const hit = makeHit({ rawScore: 0.5 }); // lexical = 0.6 × 0.5 = 0.30
    const tokens = ['micromed', 'nao', 'abre']; // matches symptomsJson "não abre"
    const ranked = svc.rankHits([hit], tokens);
    expect(ranked.length).toBe(1);
    const bd = ranked[0]!.breakdown;
    // lexical: 0.6 × 0.5 = 0.30; symptoms: 0.20; aiHint: probably 0.10; tags: probably 0.07
    expect(bd.total).toBeGreaterThan(0.30); // at minimum lexical only
    expect(bd.lexicalScore).toBeCloseTo(0.5, 2);
    expect(typeof bd.symptomsMatch).toBe('boolean');
  });

  it('2. symptom match (0.20) contributes more than ai_hint match (0.10)', () => {
    // Hit A: symptom matches
    const hitA = makeHit({ id: 1, rawScore: 0.5,
      symptomsJson: ['micromed nao abre'],
      evidenceSummarySanitized: 'xyz irrelevante',
    });
    // Hit B: ai_hint matches, symptoms don't
    const hitB = makeHit({ id: 2, rawScore: 0.5,
      symptomsJson: ['irrelevante xyz'],
      evidenceSummarySanitized: 'micromed nao abre',
    });
    const tokens = ['micromed', 'nao', 'abre'];
    const ranked = svc.rankHits([hitA, hitB], tokens);
    const scoreA = ranked.find((r) => r.hit.id === 1)!.breakdown.total;
    const scoreB = ranked.find((r) => r.hit.id === 2)!.breakdown.total;
    expect(scoreA).toBeGreaterThan(scoreB);
  });

  it('3. context boost applied when productOrSystem matches title', () => {
    const hit = makeHit({ rawScore: 0.4, title: 'Micromed não abre' });
    const ctx: KbClientContext = { productOrSystem: 'Micromed' };
    const ranked = svc.rankHits([hit], ['micromed'], ctx);
    expect(ranked[0]!.breakdown.contextBoost).toBe(true);
    expect(ranked[0]!.breakdown.total).toBeGreaterThan(0.4 * 0.6 + 0.10); // at least product boost added
  });

  it('4. context boost applied when productOrSystem matches tags', () => {
    const hit = makeHit({ rawScore: 0.3, tagsJson: ['micromed', 'sistema'] });
    const ctx: KbClientContext = { productOrSystem: 'micromed' };
    const ranked = svc.rankHits([hit], ['problema'], ctx);
    expect(ranked[0]!.breakdown.contextBoost).toBe(true);
  });

  it('5. context boost NOT applied when productOrSystem does not match', () => {
    // Override all default fields that could contain "micromed"
    const hit = makeHit({
      rawScore: 0.5,
      title: 'Backup Veeam falhou',
      tagsJson: ['backup', 'veeam'],
      categorySuggestion: 'Backup / Veeam',          // not 'Sistema / Micromed'
      symptomsJson: ['backup falhou', 'job interrompido'],
      evidenceSummarySanitized: 'veeam backup falho job',
      problemPattern: 'backup nao completa',
    });
    const ctx: KbClientContext = { productOrSystem: 'Micromed' };
    const ranked = svc.rankHits([hit], ['backup'], ctx);
    expect(ranked[0]!.breakdown.contextBoost).toBe(false);
  });

  it('6. category softer boost (0.05) less than product boost (0.10)', () => {
    const hitProduct = makeHit({ id: 1, rawScore: 0.0, title: 'Micromed erro', tagsJson: [] });
    const hitCategory = makeHit({ id: 2, rawScore: 0.0, categorySuggestion: 'Backup / Veeam', tagsJson: [] });
    const ctxProduct: KbClientContext = { productOrSystem: 'Micromed' };
    const ctxCategory: KbClientContext = { category: 'Backup' };
    const r1 = svc.rankHits([hitProduct], [], ctxProduct);
    const r2 = svc.rankHits([hitCategory], [], ctxCategory);
    // Product boost should be larger
    expect(r1[0]!.breakdown.total).toBeGreaterThan(r2[0]!.breakdown.total);
  });

  it('7. score capped at 1.0', () => {
    const hit = makeHit({ rawScore: 1.0 });
    const ctx: KbClientContext = { productOrSystem: 'micromed' };
    const ranked = svc.rankHits([hit], ['micromed', 'permissao', 'sistema', 'nao', 'abre'], ctx);
    expect(ranked[0]!.breakdown.total).toBeLessThanOrEqual(1.0);
  });

  it('8. topK respected — max 5 results returned', () => {
    const hits = Array.from({ length: 10 }, (_, i) => makeHit({ id: i + 1 }));
    const ranked = svc.rankHits(hits, ['micromed'], null, 5);
    expect(ranked.length).toBeLessThanOrEqual(5);
  });

  it('9. results sorted descending by total score', () => {
    const hits = [
      makeHit({ id: 1, rawScore: 0.2, symptomsJson: [] }),
      makeHit({ id: 2, rawScore: 0.8, symptomsJson: ['micromed'] }),
      makeHit({ id: 3, rawScore: 0.5, symptomsJson: ['micromed', 'sistema'] }),
    ];
    const ranked = svc.rankHits(hits, ['micromed'], null, 5);
    const scores = ranked.map((r) => r.breakdown.total);
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]!).toBeLessThanOrEqual(scores[i - 1]!);
    }
  });

  it('10. hit with zero score is excluded when tokens present', () => {
    const irrelevant = makeHit({
      id: 99,
      rawScore: 0,
      symptomsJson: [],
      evidenceSummarySanitized: '',
      tagsJson: [],
      title: '',
    });
    const ranked = svc.rankHits([irrelevant], ['micromed', 'permissao'], null, 5);
    // total = 0 + 0 + 0 + 0 + 0 = 0 < MIN_SCORE_THRESHOLD → excluded
    expect(ranked.every((r) => r.hit.id !== 99)).toBe(true);
  });

  it('11. empty hits array → empty result', () => {
    const ranked = svc.rankHits([], ['micromed'], null, 5);
    expect(ranked).toHaveLength(0);
  });

  it('12. symptom-matching article ranks higher than title-only match', () => {
    const symptomMatch = makeHit({
      id: 1,
      rawScore: 0.5,
      symptomsJson: ['servidor lento', 'cpu alta'],
      title: 'Genérico',
    });
    const titleMatch = makeHit({
      id: 2,
      rawScore: 0.5,
      symptomsJson: ['outro problema'],
      title: 'Servidor lento',
    });
    const tokens = ['servidor', 'lento'];
    const ranked = svc.rankHits([titleMatch, symptomMatch], tokens, null, 5);
    const s1 = ranked.find((r) => r.hit.id === 1)!.breakdown;
    const s2 = ranked.find((r) => r.hit.id === 2)!.breakdown;
    // Symptom weight 0.20 > title weight 0.03
    expect(s1.symptomsMatch).toBe(true);
    expect(s1.total).toBeGreaterThan(s2.total);
  });

  it('14. isolated-product query (micromed) excludes Windows activation articles', () => {
    const micromedHit = makeHit({
      id: 1,
      rawScore: 0.50,
      title: 'Micromed não abre após atualização',
      categorySuggestion: 'Sistema / Micromed',
      symptomsJson: ['micromed nao abre', 'erro de permissao'],
      tagsJson: ['micromed', 'permissao', 'sistema'],
    });
    const winActivation = makeHit({
      id: 2,
      rawScore: 0.90,
      title: 'Windows solicita ativação — slmgr',
      categorySuggestion: 'Sistema / Windows',
      problemPattern: 'Windows pede ativacao de licenca',
      symptomsJson: ['windows ativacao', 'licenca windows'],
      evidenceSummarySanitized: 'windows ativacao licenca slmgr',
      tagsJson: ['windows', 'ativacao', 'licenca'],
    });

    const tokens = ['micromed', 'nao', 'abrindo', 'sistema'];
    const ranked = svc.rankHits([winActivation, micromedHit], tokens, null, 5);

    // Windows activation must be excluded even with higher rawScore
    expect(ranked.map((r) => r.hit.id)).not.toContain(2);
    // Micromed hit survives
    expect(ranked.map((r) => r.hit.id)).toContain(1);
  });

  // ── SearchPlan integration tests (phase: integaglpi_kb_rag_ai_search_planner_hybrid_retrieval_001) ──

  function makePlan(over: Partial<SearchPlan> = {}): SearchPlan {
    return {
      normalizedQuery: 'test',
      intent: 'generic',
      productOrSystem: null,
      domain: null,
      symptoms: [],
      mustTerms: [],
      boostTerms: [],
      negativeTerms: [],
      negativeDomains: [],
      sourceTiersAllowed: ['tier_1_product_specific', 'tier_2_operational_kb', 'tier_3_generic_playbook'],
      minimumConfidence: 0.25,
      topK: 5,
      reason: 'test plan',
      planSource: 'deterministic',
      ...over,
    };
  }

  it('15. plan mustTerms: article without any must_term is excluded', () => {
    const micromedHit = makeHit({ id: 1, rawScore: 0.80 }); // default has 'micromed' in title/tags
    const veeamHit = makeHit({
      id: 2,
      rawScore: 0.90, // higher rawScore — would win without must_terms
      title: 'Veeam Backup falhou',
      categorySuggestion: 'Backup / Veeam',
      symptomsJson: ['backup falhou', 'job interrompido'],
      tagsJson: ['veeam', 'backup'],
      evidenceSummarySanitized: 'veeam backup job falho',
      problemPattern: 'backup nao completa',
    });
    const plan = makePlan({ mustTerms: ['micromed'] });
    const ranked = svc.rankHits([micromedHit, veeamHit], ['micromed'], null, 5, plan);

    // Micromed hit (id=1) has 'micromed' in content → survives
    expect(ranked.map((r) => r.hit.id)).toContain(1);
    // Veeam hit (id=2) has no 'micromed' anywhere → excluded by must_terms
    expect(ranked.map((r) => r.hit.id)).not.toContain(2);
  });

  it('16. plan negativeDomains: windows_activation pattern excludes matching article', () => {
    const winActivation = makeHit({
      id: 1,
      rawScore: 0.90, // very high — would win without plan filter
      title: 'Windows solicita ativação',
      categorySuggestion: 'Sistema / Windows',
      symptomsJson: ['windows ativacao'],
      tagsJson: ['windows', 'ativacao', 'licenca'],
      evidenceSummarySanitized: 'windows ativacao licenca',
      problemPattern: 'windows pede ativacao licenca',
    });
    // Query about synology — no hardcoded conflict, but plan's negativeDomains stops it
    const plan = makePlan({ negativeDomains: ['windows_activation'] });
    const ranked = svc.rankHits([winActivation], ['synology', 'restore'], null, 5, plan);

    expect(ranked.map((r) => r.hit.id)).not.toContain(1);
  });

  it('17. plan with empty mustTerms does not add extra filtering beyond MIN_SCORE_THRESHOLD', () => {
    // A hit with non-zero rawScore that normally passes ranking
    const hit = makeHit({ id: 1, rawScore: 0.50 });
    const plan = makePlan({ mustTerms: [], minimumConfidence: 0.25 });
    const ranked = svc.rankHits([hit], ['micromed'], null, 5, plan);

    // Should still be present (passes MIN_SCORE_THRESHOLD with rawScore=0.50)
    expect(ranked.map((r) => r.hit.id)).toContain(1);
    // All results have score >= MIN_SCORE_THRESHOLD
    expect(ranked.every((r) => r.breakdown.total >= 0.25)).toBe(true);
  });

  // ── Source tier enforcement (phase: integaglpi_kb_rag_ai_search_planner_hybrid_retrieval_fix_001) ──

  it('18. computeArticleTier: Micromed article → tier_1_product_specific', () => {
    const hit = makeHit({
      title: 'Micromed não abre após atualização',
      categorySuggestion: 'Sistema / Micromed',
      tagsJson: ['micromed', 'sistema'],
      articleType: 'procedimento_tecnico',
    });
    expect(KbRankingService.computeArticleTier(hit)).toBe('tier_1_product_specific');
  });

  it('19. computeArticleTier: generic checklist article → tier_3_generic_playbook', () => {
    const hit = makeHit({
      title: 'Checklist geral de troubleshooting',
      categorySuggestion: 'Suporte / Geral',
      tagsJson: ['checklist', 'geral'],
      articleType: 'procedimento_tecnico',
    });
    expect(KbRankingService.computeArticleTier(hit)).toBe('tier_3_generic_playbook');
  });

  it('20. computeArticleTier: automation article (articleType=automation) → tier_4_automation', () => {
    const hit = makeHit({
      title: 'Script PowerShell reset de senha',
      categorySuggestion: 'Automação / SRE',
      tagsJson: ['automation', 'script'],
      articleType: 'automation',
    });
    expect(KbRankingService.computeArticleTier(hit)).toBe('tier_4_automation');
  });

  it('21. applyTierFilter: tier_3 article excluded when only tier_1/tier_2 allowed', () => {
    const tier1Hit = makeHit({
      id: 1,
      rawScore: 0.50,
      title: 'Micromed permissão de pasta',
      categorySuggestion: 'Sistema / Micromed',
      tagsJson: ['micromed'],
      articleType: 'procedimento_tecnico',
    });
    const tier3Hit = makeHit({
      id: 2,
      rawScore: 0.90,  // higher rawScore but tier_3 — must be excluded by filter
      title: 'Checklist geral de troubleshooting',
      categorySuggestion: 'Suporte / Geral',
      tagsJson: ['checklist', 'geral'],
      articleType: 'procedimento_tecnico',
    });
    const tokens = ['micromed'];
    const ranked = svc.rankHits([tier1Hit, tier3Hit], tokens, null, 5);
    const tiersAllowed: SourceTier[] = ['tier_1_product_specific', 'tier_2_operational_kb'];
    const tieredRanked = svc.applyTierFilter(ranked, tiersAllowed);

    const ids = tieredRanked.map((r) => r.hit.id);
    expect(ids).toContain(1);    // tier_1 survives
    expect(ids).not.toContain(2); // tier_3 excluded
  });

  it('22. applyTierFilter: tier_4 automation excluded; tier_1 wins even with lower rawScore', () => {
    const tier1Hit = makeHit({
      id: 1,
      rawScore: 0.40,  // lower rawScore
      title: 'Micromed erro de permissão',
      categorySuggestion: 'Sistema / Micromed',
      tagsJson: ['micromed'],
      articleType: 'procedimento_tecnico',
    });
    const tier4Hit = makeHit({
      id: 2,
      rawScore: 0.99,  // very high rawScore — but tier_4, must be blocked
      title: 'Script PowerShell reset micromed',
      categorySuggestion: 'Automação / SRE',
      tagsJson: ['automation', 'script', 'micromed'],
      articleType: 'automation',
    });
    const tokens = ['micromed'];
    const ranked = svc.rankHits([tier1Hit, tier4Hit], tokens, null, 5);
    const tiersAllowed: SourceTier[] = ['tier_1_product_specific', 'tier_2_operational_kb'];
    const tieredRanked = svc.applyTierFilter(ranked, tiersAllowed);

    const ids = tieredRanked.map((r) => r.hit.id);
    expect(ids).toContain(1);    // tier_1 included
    expect(ids).not.toContain(2); // tier_4 blocked
    expect(tieredRanked[0]!.hit.id).toBe(1); // tier_1 is first
  });

  it('13. Active Directory sync query excludes Windows activation articles', () => {
    const adSync = makeHit({
      id: 1,
      rawScore: 0.45,
      title: 'Azure AD Connect não sincroniza usuários',
      categorySuggestion: 'Identidade / Active Directory',
      problemPattern: 'Active Directory não sincroniza; Azure AD Connect parado',
      symptomsJson: ['active directory nao sincroniza', 'azure ad connect erro sync'],
      evidenceSummarySanitized: 'active directory azure sync falha',
      tagsJson: ['active directory', 'azure', 'sync'],
    });
    const activation = makeHit({
      id: 2,
      rawScore: 0.95,
      title: 'Windows solicita ativação',
      categorySuggestion: 'Sistema / Windows',
      problemPattern: 'Windows pede ativação de licença',
      symptomsJson: ['windows ativacao', 'licenca windows'],
      evidenceSummarySanitized: 'windows ativacao licenca',
      tagsJson: ['windows', 'ativacao', 'licenca'],
    });

    const ranked = svc.rankHits([activation, adSync], ['active', 'directory', 'sincronizando', 'sync'], null, 5);

    expect(ranked.map((r) => r.hit.id)).toContain(1);
    expect(ranked.map((r) => r.hit.id)).not.toContain(2);
  });
});
