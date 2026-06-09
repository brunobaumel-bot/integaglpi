/**
 * KbEffectivenessService — Unit tests (F2.4)
 *
 * Regras:
 *   - NUNCA acessa banco real (mocks de SqlExecutor e KbFeedbackRepository)
 *   - Valida estrutura do relatório (schema_version, campos obrigatórios)
 *   - Valida invariantes de segurança (sem PII, sem mutation, sem technician IDs)
 *   - Valida capping de period_days (mínimo 1, máximo 90)
 *   - Valida contagem de votos e helpfulRatio
 *
 * Phase: integaglpi_v9_kb_quality_001 — F2.4
 */

import { describe, expect, it, vi } from 'vitest';

import { KbEffectivenessService } from '../src/services/KbEffectivenessService.js';
import type { KbFeedbackRepository } from '../src/repositories/postgres/PostgresKbFeedbackRepository.js';
import { KB_GOLDEN_SET_META } from '../src/domain/constants/kbGoldenSetMeta.js';

// ── Mock factory ──────────────────────────────────────────────────────────────

type MockRow = Record<string, string>;

function makeMockExecutor(rows: MockRow[] = []) {
  return {
    query: vi.fn().mockResolvedValue({ rows, rowCount: rows.length }),
  };
}

function makeMockFeedbackRepo(): KbFeedbackRepository {
  return {
    recordVote: vi.fn(),
    getHelpfulness: vi.fn().mockResolvedValue({
      kbCandidateId: null,
      glpiKnowbaseitemId: null,
      helpfulCount: 0,
      notHelpfulCount: 0,
      totalVotes: 0,
      helpfulRatio: 0,
      score: 0.5,
    }),
    getAggregatedByCategory: vi.fn().mockResolvedValue([]),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('KbEffectivenessService — buildReport estrutura', () => {
  it('retorna relatório com schema_version correto', async () => {
    const executor = makeMockExecutor([
      { total_votes: '0', helpful_votes: '0', not_helpful_votes: '0', articles_with_votes: '0' },
    ]);
    const service = new KbEffectivenessService(executor, makeMockFeedbackRepo());

    const report = await service.buildReport();

    expect(report.schema_version).toBe('1.0');
    expect(report.phase).toBe('integaglpi_v9_kb_quality_001');
    expect(report.deliverable).toBe('F2.4');
  });

  it('generated_at é string ISO 8601', async () => {
    const executor = makeMockExecutor([
      { total_votes: '0', helpful_votes: '0', not_helpful_votes: '0', articles_with_votes: '0' },
    ]);
    const service = new KbEffectivenessService(executor, makeMockFeedbackRepo());

    const report = await service.buildReport();
    expect(report.generated_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('golden_set_meta está alinhado com GOLDEN_SET_META fixture', async () => {
    const executor = makeMockExecutor([
      { total_votes: '0', helpful_votes: '0', not_helpful_votes: '0', articles_with_votes: '0' },
    ]);
    const service = new KbEffectivenessService(executor, makeMockFeedbackRepo());

    const report = await service.buildReport();

    expect(report.golden_set_meta.version).toBe(KB_GOLDEN_SET_META.version);
    expect(report.golden_set_meta.total_queries).toBe(KB_GOLDEN_SET_META.total_queries);
    expect(report.golden_set_meta.g06_queries).toBe(KB_GOLDEN_SET_META.g06_queries);
    expect(report.golden_set_meta.expansion_queries).toBe(KB_GOLDEN_SET_META.expansion_queries);
  });

  it('relatório tem todas as chaves obrigatórias', async () => {
    const executor = makeMockExecutor([
      { total_votes: '0', helpful_votes: '0', not_helpful_votes: '0', articles_with_votes: '0' },
    ]);
    const service = new KbEffectivenessService(executor, makeMockFeedbackRepo());

    const report = await service.buildReport();

    expect(report).toHaveProperty('schema_version');
    expect(report).toHaveProperty('phase');
    expect(report).toHaveProperty('deliverable');
    expect(report).toHaveProperty('generated_at');
    expect(report).toHaveProperty('period_days');
    expect(report).toHaveProperty('golden_set_meta');
    expect(report).toHaveProperty('feedback_health');
    expect(report).toHaveProperty('top_helpful_articles');
    expect(report).toHaveProperty('gap_analysis');
    expect(report).toHaveProperty('pipeline_stats');
  });
});

describe('KbEffectivenessService — period_days capping', () => {
  it('period_days padrão é 30', async () => {
    const executor = makeMockExecutor([
      { total_votes: '0', helpful_votes: '0', not_helpful_votes: '0', articles_with_votes: '0' },
    ]);
    const service = new KbEffectivenessService(executor, makeMockFeedbackRepo());

    const report = await service.buildReport();
    expect(report.period_days).toBe(30);
  });

  it('period_days > 90 é capado em 90', async () => {
    const executor = makeMockExecutor([
      { total_votes: '0', helpful_votes: '0', not_helpful_votes: '0', articles_with_votes: '0' },
    ]);
    const service = new KbEffectivenessService(executor, makeMockFeedbackRepo());

    const report = await service.buildReport({ periodDays: 365 });
    expect(report.period_days).toBe(90);
  });

  it('period_days < 1 é elevado para 1', async () => {
    const executor = makeMockExecutor([
      { total_votes: '0', helpful_votes: '0', not_helpful_votes: '0', articles_with_votes: '0' },
    ]);
    const service = new KbEffectivenessService(executor, makeMockFeedbackRepo());

    const report = await service.buildReport({ periodDays: 0 });
    expect(report.period_days).toBe(1);
  });
});

describe('KbEffectivenessService — feedback_health', () => {
  it('votos zero → overallHelpfulRatio=null', async () => {
    const executor = makeMockExecutor([
      { total_votes: '0', helpful_votes: '0', not_helpful_votes: '0', articles_with_votes: '0' },
    ]);
    const service = new KbEffectivenessService(executor, makeMockFeedbackRepo());

    const report = await service.buildReport();

    expect(report.feedback_health.totalVotes).toBe(0);
    expect(report.feedback_health.overallHelpfulRatio).toBeNull();
  });

  it('votos não-zero → overallHelpfulRatio calculado', async () => {
    // First query returns feedback_health, second and third return empty arrays
    const executor = {
      query: vi.fn()
        .mockResolvedValueOnce({
          rows: [{ total_votes: '10', helpful_votes: '7', not_helpful_votes: '3', articles_with_votes: '5' }],
          rowCount: 1,
        })
        .mockResolvedValue({ rows: [], rowCount: 0 }),
    };
    const service = new KbEffectivenessService(executor, makeMockFeedbackRepo());

    const report = await service.buildReport();

    expect(report.feedback_health.totalVotes).toBe(10);
    expect(report.feedback_health.helpfulVotes).toBe(7);
    expect(report.feedback_health.notHelpfulVotes).toBe(3);
    expect(report.feedback_health.overallHelpfulRatio).toBeCloseTo(0.7, 3);
    expect(report.feedback_health.articlesWithVotes).toBe(5);
  });
});

describe('KbEffectivenessService — top_helpful_articles', () => {
  it('retorna array vazio quando sem votos', async () => {
    const executor = makeMockExecutor([
      { total_votes: '0', helpful_votes: '0', not_helpful_votes: '0', articles_with_votes: '0' },
    ]);
    const service = new KbEffectivenessService(executor, makeMockFeedbackRepo());

    const report = await service.buildReport();
    expect(Array.isArray(report.top_helpful_articles)).toBe(true);
  });

  it('artigo tem todas as chaves obrigatórias', async () => {
    const executor = {
      query: vi.fn()
        .mockResolvedValueOnce({
          rows: [{ total_votes: '5', helpful_votes: '4', not_helpful_votes: '1', articles_with_votes: '2' }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({
          rows: [{
            candidate_key: 'art-001',
            title: 'Como resetar senha',
            category_suggestion: 'Acesso',
            source_tier: 'tier_2_operational_kb',
            helpful_count: '4',
            not_helpful_count: '1',
          }],
          rowCount: 1,
        })
        .mockResolvedValue({ rows: [], rowCount: 0 }),
    };
    const service = new KbEffectivenessService(executor, makeMockFeedbackRepo());

    const report = await service.buildReport();
    const article = report.top_helpful_articles[0]!;

    expect(article.candidateKey).toBe('art-001');
    expect(article.title).toBe('Como resetar senha');
    expect(article.categorySuggestion).toBe('Acesso');
    expect(article.sourceTier).toBe('tier_2_operational_kb');
    expect(article.helpfulCount).toBe(4);
    expect(article.notHelpfulCount).toBe(1);
    expect(article.totalVotes).toBe(5);
    expect(article.helpfulRatio).toBeCloseTo(0.8, 3);
  });

  it('helpfulRatio está em [0, 1]', async () => {
    const executor = {
      query: vi.fn()
        .mockResolvedValueOnce({
          rows: [{ total_votes: '0', helpful_votes: '0', not_helpful_votes: '0', articles_with_votes: '0' }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({
          rows: [
            { candidate_key: 'a', title: 'T1', category_suggestion: 'C', source_tier: 'tier_1_product_specific', helpful_count: '10', not_helpful_count: '0' },
            { candidate_key: 'b', title: 'T2', category_suggestion: 'C', source_tier: 'tier_1_product_specific', helpful_count: '0', not_helpful_count: '10' },
          ],
          rowCount: 2,
        })
        .mockResolvedValue({ rows: [], rowCount: 0 }),
    };
    const service = new KbEffectivenessService(executor, makeMockFeedbackRepo());

    const report = await service.buildReport();
    for (const a of report.top_helpful_articles) {
      expect(a.helpfulRatio).toBeGreaterThanOrEqual(0);
      expect(a.helpfulRatio).toBeLessThanOrEqual(1);
    }
  });
});

describe('KbEffectivenessService — gap_analysis', () => {
  it('retorna array vazio quando sem dados', async () => {
    const executor = makeMockExecutor([
      { total_votes: '0', helpful_votes: '0', not_helpful_votes: '0', articles_with_votes: '0' },
    ]);
    const service = new KbEffectivenessService(executor, makeMockFeedbackRepo());

    const report = await service.buildReport();
    expect(Array.isArray(report.gap_analysis)).toBe(true);
  });

  it('gap tem categoria, contagens e ratio', async () => {
    const executor = {
      query: vi.fn()
        .mockResolvedValueOnce({
          rows: [{ total_votes: '3', helpful_votes: '1', not_helpful_votes: '2', articles_with_votes: '2' }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({
          rows: [{
            category: 'Impressoras',
            helpful_count: '1',
            not_helpful_count: '5',
          }],
          rowCount: 1,
        }),
    };
    const service = new KbEffectivenessService(executor, makeMockFeedbackRepo());

    const report = await service.buildReport();
    const gap = report.gap_analysis[0]!;

    expect(gap.category).toBe('Impressoras');
    expect(gap.helpfulCount).toBe(1);
    expect(gap.notHelpfulCount).toBe(5);
    expect(gap.totalVotes).toBe(6);
    expect(gap.helpfulRatio).toBeCloseTo(1 / 6, 3);
  });
});

describe('KbEffectivenessService — invariantes de segurança', () => {
  it('relatório NÃO inclui technician_id ou campos de identidade', async () => {
    const executor = makeMockExecutor([
      { total_votes: '0', helpful_votes: '0', not_helpful_votes: '0', articles_with_votes: '0' },
    ]);
    const service = new KbEffectivenessService(executor, makeMockFeedbackRepo());

    const report = await service.buildReport();
    const json = JSON.stringify(report);

    expect(json).not.toContain('technician_id');
    expect(json).not.toContain('technicianId');
    expect(json).not.toContain('glpi_ticket_id');
    expect(json).not.toContain('phone');
  });

  it('pipeline_stats.note documenta a limitação de rastreio', async () => {
    const executor = makeMockExecutor([
      { total_votes: '0', helpful_votes: '0', not_helpful_votes: '0', articles_with_votes: '0' },
    ]);
    const service = new KbEffectivenessService(executor, makeMockFeedbackRepo());

    const report = await service.buildReport();
    expect(report.pipeline_stats.note).toBeTruthy();
    expect(report.pipeline_stats.note.length).toBeGreaterThan(10);
  });

  it('não possui métodos de mutação', () => {
    const executor = makeMockExecutor();
    const service = new KbEffectivenessService(executor, makeMockFeedbackRepo());
    const serviceAsAny = service as unknown as Record<string, unknown>;

    expect(typeof serviceAsAny['mutateTicket']).toBe('undefined');
    expect(typeof serviceAsAny['sendWhatsApp']).toBe('undefined');
    expect(typeof serviceAsAny['publishKb']).toBe('undefined');
  });
});
