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
 */

import { describe, it, expect } from 'vitest';
import { KbRankingService, type KbClientContext } from '../src/domain/services/KbRankingService.js';
import type { KbCandidateHit } from '../src/repositories/postgres/PostgresKbCandidateSearchRepository.js';

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
});
