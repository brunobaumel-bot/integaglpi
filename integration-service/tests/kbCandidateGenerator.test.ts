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

    // recurrenceThreshold relaxed to 1 so the single-occurrence pattern is allowed
    // through the gate; it should still score low and stay out of 'suggested'.
    const candidates = generateKbCandidatesFromHistory(input, {
      minConfidence: 80,
      maxCandidates: 10,
      recurrenceThreshold: 1,
    });

    expect(candidates[0].status).toBe('low_confidence');
    expect(candidates[0].confidenceScore).toBeLessThan(80);
  });

  it('marks possible duplicates against read-only native KB export at the 75% threshold', () => {
    const input = baseInput();
    // The native article title mirrors the new structured candidate title so the
    // token overlap clears the 0.75 duplicate threshold.
    input.nativeArticles = [
      {
        articleId: 99,
        title: 'Procedimento técnico: Office — tema recorrente solucao curta retrabalho',
        category: 'Office',
        excerpt: 'Ativacao e validacao de licenca Microsoft Office.',
        internalUrl: '/front/knowbaseitem.form.php?id=99',
      },
    ];

    const candidates = generateKbCandidatesFromHistory(input, { minConfidence: 65, maxCandidates: 10 });

    expect(candidates[0].possibleDuplicate).toBe(true);
    expect(candidates[0].status).toBe('possible_duplicate');
    expect(candidates[0].relatedNativeKbArticles[0].articleId).toBe(99);
    expect(candidates[0].duplicateReason).toContain('artigo nativo semelhante');
    expect(candidates[0].duplicateReason).toContain('similaridade');
  });

  it('does NOT flag a duplicate when similarity is between 28% and 75%', () => {
    const input = baseInput();
    input.nativeArticles = [
      {
        articleId: 50,
        title: 'Office — apenas licenciamento corporativo',
        category: 'Office',
        excerpt: 'Compra e renovação de licenças por volume.',
        internalUrl: '/front/knowbaseitem.form.php?id=50',
      },
    ];

    const candidates = generateKbCandidatesFromHistory(input, { minConfidence: 65, maxCandidates: 10 });

    // Related (shares "Office") but below the 75% duplicate threshold.
    expect(candidates[0].possibleDuplicate).toBe(false);
    expect(candidates[0].status).not.toBe('possible_duplicate');
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

  // ── Quality hardening (anti-generic / confidence reason / recurrence) ────────

  it('rejects a generic candidate with no distinctive descriptor (e.g. bare "Hardware")', () => {
    const input = baseInput();
    input.patterns[0] = {
      ...input.patterns[0],
      category: 'Hardware',
      // No distinctive tokens (all stopwords / too short) → no descriptor.
      descriptionSanitized: 'um de da a o e que',
    };
    input.insights = [];

    const candidates = generateKbCandidatesFromHistory(input, { minConfidence: 65, maxCandidates: 10 });

    // Generic single-word "Hardware" title with no descriptor must be dropped.
    expect(candidates).toHaveLength(0);
  });

  it('keeps a specific candidate when the description yields a distinctive descriptor', () => {
    const input = baseInput();
    input.patterns[0] = {
      ...input.patterns[0],
      category: 'Hardware',
      descriptionSanitized: 'impressora fiscal trava apos atualizacao firmware',
    };

    const candidates = generateKbCandidatesFromHistory(input, { minConfidence: 65, maxCandidates: 10 });

    expect(candidates).toHaveLength(1);
    // Title is specific, not just "Hardware".
    expect(candidates[0].title.toLowerCase()).not.toBe('hardware');
    expect(candidates[0].title).toContain('Hardware');
    expect(candidates[0].title).toMatch(/impressora|firmware|trava|atualizacao/i);
  });

  it('attaches a confidence justification and never an artificial 100%', () => {
    const candidates = generateKbCandidatesFromHistory(baseInput(), { minConfidence: 65, maxCandidates: 10 });

    expect(candidates[0].confidenceReason).toMatch(/^Score \d+:/);
    expect(candidates[0].confidenceReason).toContain('ocorrência');
    expect(candidates[0].confidenceReason).toContain('revisão humana obrigatória');
    // Hard cap — no perfect score.
    expect(candidates[0].confidenceScore).toBeLessThanOrEqual(92);
  });

  it('respects the recurrence threshold of 5 occurrences by default', () => {
    const input = baseInput();
    input.patterns[0] = { ...input.patterns[0], frequencyAbs: 4 };

    // Default threshold (5) → a 4-occurrence pattern yields no candidate.
    const defaultRun = generateKbCandidatesFromHistory(input, { minConfidence: 65, maxCandidates: 10 });
    expect(defaultRun).toHaveLength(0);

    // Relaxed threshold (3) for low-volume/homologação → now allowed.
    const relaxed = generateKbCandidatesFromHistory(input, {
      minConfidence: 65,
      maxCandidates: 10,
      recurrenceThreshold: 3,
    });
    expect(relaxed).toHaveLength(1);
  });

  it('emits a structured article with the required operational sections', () => {
    const candidates = generateKbCandidatesFromHistory(baseInput(), { minConfidence: 65, maxCandidates: 10 });
    const md = candidates[0].contentMarkdown;

    for (const section of [
      'Resumo executivo',
      'Público-alvo e dificuldade',
      'Quando usar',
      'Quando NÃO usar',
      'Quando escalar',
      'Sintomas',
      'Causa provável',
      'Procedimento técnico',
      'Como validar que resolveu',
      'Confiança (justificativa)',
      'Limitações',
    ]) {
      expect(md).toContain(section);
    }
    expect(candidates[0].difficultyLevel).toMatch(/^(basico|intermediario|avancado)$/);
    expect(candidates[0].targetAudience.length).toBeGreaterThan(0);
  });
});
