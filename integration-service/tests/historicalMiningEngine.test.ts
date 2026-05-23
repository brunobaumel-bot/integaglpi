import { describe, expect, it } from 'vitest';

import { analyzeHistoricalMiningDataset } from '../src/historicalMining/engine.js';
import type { HistoricalMiningDataset, HistoricalTicketRecord } from '../src/historicalMining/types.js';
import { hasObviousSensitiveContent } from '../src/historicalMining/sanitizer.js';

function record(index: number, overrides: Partial<HistoricalTicketRecord> = {}): HistoricalTicketRecord {
  return {
    ticketIdHash: String(index).padStart(64, 'a').slice(0, 64),
    openedAt: new Date(`2026-01-${String(index).padStart(2, '0')}T10:00:00.000Z`),
    solvedAt: new Date(`2026-01-${String(index + 1).padStart(2, '0')}T10:00:00.000Z`),
    status: 'solved',
    category: 'Email',
    entity: 'Etica',
    group: 'Suporte',
    priority: null,
    urgency: null,
    titleText: 'Problema de email recorrente',
    descriptionText: 'Cliente informou que nao funciona novamente e esta sem retorno',
    followupText: 'Atendimento com texto confuso',
    solutionText: 'Reconfigurado perfil e validado com usuario',
    reopenedCount: index % 2,
    satisfactionScore: null,
    ...overrides,
  };
}

describe('historical mining deterministic engine', () => {
  it('generates aggregate, reopen, communication and KB opportunity insights without PII', () => {
    const dataset: HistoricalMiningDataset = {
      inputHash: 'input-hash',
      rowsSeen: 4,
      rowsRejected: 0,
      records: [
        record(1),
        record(2),
        record(3, { category: 'Rede', solutionText: 'ok' }),
        record(4, { category: 'Rede', solutionText: 'ok', reopenedCount: 1 }),
      ],
    };

    const result = analyzeHistoricalMiningDataset(dataset, {
      windowStart: new Date('2026-01-01T00:00:00.000Z'),
      windowEnd: new Date('2026-12-31T23:59:59.000Z'),
    });

    expect(result.run.rowsProcessed).toBe(4);
    expect(result.patterns.map((pattern) => pattern.patternType)).toEqual(expect.arrayContaining([
      'recurring_category',
      'reopen_hotspot',
      'frustration_signal',
      'communication_gap',
      'kb_gap_candidate',
    ]));
    expect(result.insights.map((insight) => insight.insightType)).toEqual(expect.arrayContaining([
      'volume',
      'reopen',
      'communication',
      'kb_opportunity',
    ]));
    for (const insight of result.insights) {
      expect(hasObviousSensitiveContent(insight.summarySanitized)).toBe(false);
      expect(insight.recommendationSanitized).not.toMatch(/punir|ranking/i);
    }
    for (const evidence of result.evidence) {
      expect(evidence.ticketIdHash).toMatch(/^[a-f0-9]{64}$/);
      expect(hasObviousSensitiveContent(evidence.anonymizedExcerpt)).toBe(false);
    }
  });
});
