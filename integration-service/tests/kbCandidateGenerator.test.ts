import { describe, expect, it } from 'vitest';

import { generateKbCandidatesFromHistory } from '../src/kbCandidates/generator.js';
import type { KbCandidateGenerationInput } from '../src/kbCandidates/types.js';

function baseInput(): KbCandidateGenerationInput {
  return {
    runId: 'run-001',
    inputHash: 'input-hash',
    patterns: [
      {
        id: 10,
        patternType: 'kb_gap_candidate',
        category: 'Office',
        frequencyAbs: 7,
        severity: 'medium',
        descriptionSanitized: 'Tema recorrente com solucao curta e retrabalho.',
        evidenceHashes: ['hash-a', 'hash-b'],
      },
    ],
    insights: [
      {
        id: 20,
        insightType: 'kb_opportunity',
        priority: 'medium',
        title: 'Oportunidade de KB para Office',
        summarySanitized: 'Chamados de Office se repetem no historico sanitizado.',
        recommendationSanitized: 'Criar procedimento revisado para ativacao e validacao.',
        confidenceScore: 80,
        filters: { category: 'Office' },
      },
    ],
    evidence: [
      { ticketIdHash: 'hash-a', anonymizedExcerpt: 'Office nao ativa apos reinstalacao.' },
      { ticketIdHash: 'hash-b', anonymizedExcerpt: 'Usuario relatou erro de ativacao do Office.' },
    ],
    nativeArticles: [],
  };
}

describe('KB candidate generation from P2 history', () => {
  it('generates formal candidates only from sanitized P2 patterns, insights and evidence', () => {
    const candidates = generateKbCandidatesFromHistory(baseInput(), { minConfidence: 65, maxCandidates: 10 });

    expect(candidates).toHaveLength(1);
    expect(candidates[0].status).toBe('suggested');
    expect(candidates[0].confidenceScore).toBeGreaterThanOrEqual(65);
    expect(candidates[0].sourcePatternIds).toEqual([10]);
    expect(candidates[0].sourceInsightIds).toEqual([20]);
    expect(candidates[0].evidenceHashes).toEqual(['hash-a', 'hash-b']);
    expect(candidates[0].contentMarkdown).toContain('Revisao humana obrigatoria');
  });

  it('keeps low confidence candidates out of the ready status', () => {
    const input = baseInput();
    input.patterns[0] = {
      ...input.patterns[0],
      frequencyAbs: 1,
      severity: 'low',
      evidenceHashes: [],
    };
    input.insights = [];

    const candidates = generateKbCandidatesFromHistory(input, { minConfidence: 80, maxCandidates: 10 });

    expect(candidates[0].status).toBe('low_confidence');
    expect(candidates[0].confidenceScore).toBeLessThan(80);
  });

  it('marks possible duplicates against read-only native KB export', () => {
    const input = baseInput();
    input.nativeArticles = [
      {
        articleId: 99,
        title: 'Procedimento sugerido: Office',
        category: 'Office',
        excerpt: 'Ativacao e validacao de licenca Microsoft Office.',
        internalUrl: '/front/knowbaseitem.form.php?id=99',
      },
    ];

    const candidates = generateKbCandidatesFromHistory(input, { minConfidence: 65, maxCandidates: 10 });

    expect(candidates[0].possibleDuplicate).toBe(true);
    expect(candidates[0].status).toBe('possible_duplicate');
    expect(candidates[0].relatedNativeKbArticles[0].articleId).toBe(99);
    expect(candidates[0].duplicateReason).toContain('Possivel artigo nativo semelhante');
  });

  it('does not emit candidates containing obvious secrets or PII', () => {
    const input = baseInput();
    input.patterns[0] = {
      ...input.patterns[0],
      descriptionSanitized: 'token=abc123 ainda apareceu no texto',
    };

    const candidates = generateKbCandidatesFromHistory(input, { minConfidence: 65, maxCandidates: 10 });

    expect(candidates).toHaveLength(0);
  });

  it('is idempotent for the same run, pattern and insight input', () => {
    const first = generateKbCandidatesFromHistory(baseInput(), { minConfidence: 65, maxCandidates: 10 });
    const second = generateKbCandidatesFromHistory(baseInput(), { minConfidence: 65, maxCandidates: 10 });

    expect(first[0].candidateKey).toBe(second[0].candidateKey);
  });
});
