import { describe, expect, it, vi } from 'vitest';

import { FeedbackService } from '../src/domain/services/FeedbackService.js';
import {
  helpfulnessScore,
  PostgresKbFeedbackRepository,
} from '../src/repositories/postgres/PostgresKbFeedbackRepository.js';
import type { KbArticleHelpfulness, KbFeedbackRepository } from '../src/repositories/postgres/PostgresKbFeedbackRepository.js';

function makeRepoMock(over: Partial<KbArticleHelpfulness> = {}): {
  repo: KbFeedbackRepository;
  recordVote: ReturnType<typeof vi.fn>;
} {
  const helpfulness: KbArticleHelpfulness = {
    kbCandidateId: 5,
    glpiKnowbaseitemId: null,
    helpfulCount: 3,
    notHelpfulCount: 1,
    totalVotes: 4,
    helpfulRatio: 0.75,
    score: helpfulnessScore(3, 1),
    ...over,
  };
  const recordVote = vi.fn(async () => undefined);
  const repo: KbFeedbackRepository = {
    recordVote,
    getHelpfulness: vi.fn(async () => helpfulness),
    getAggregatedByCategory: vi.fn(async () => [
      { category: 'Office', helpfulCount: 10, notHelpfulCount: 2, helpfulRatio: 0.8333 },
    ]),
  };
  return { repo, recordVote };
}

describe('FeedbackService (KB helpfulness loop)', () => {
  it('records a helpful vote and returns the updated helpfulness snapshot', async () => {
    const { repo, recordVote } = makeRepoMock();
    const service = new FeedbackService(repo);

    const result = await service.recordFeedback({
      kbCandidateId: 5,
      glpiTicketId: 900,
      technicianId: 12,
      helpful: true,
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe('recorded');
    expect(result.helpfulness?.helpfulCount).toBe(3);
    expect(recordVote).toHaveBeenCalledOnce();
    const arg = recordVote.mock.calls[0]?.[0];
    expect(arg.helpful).toBe(true);
    expect(arg.kbCandidateId).toBe(5);
  });

  it('rejects feedback with no article target', async () => {
    const { repo, recordVote } = makeRepoMock();
    const service = new FeedbackService(repo);

    const result = await service.recordFeedback({ helpful: true, glpiTicketId: 1 });

    expect(result.ok).toBe(false);
    expect(result.status).toBe('invalid_target');
    expect(recordVote).not.toHaveBeenCalled();
  });

  it('returns a safe failed status when migration 044 feedback persistence is unavailable', async () => {
    const { repo, recordVote } = makeRepoMock();
    recordVote.mockRejectedValueOnce(new Error('relation "glpi_plugin_integaglpi_kb_article_helpfulness" does not exist'));
    const service = new FeedbackService(repo);

    const result = await service.recordFeedback({
      kbCandidateId: 5,
      glpiTicketId: 900,
      technicianId: 12,
      helpful: true,
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe('failed');
    expect(result.message).toBe('Não foi possível registrar o feedback agora.');
    expect(result.helpfulness).toBeNull();
    expect(recordVote).toHaveBeenCalledOnce();
  });

  it('does not emit a successful feedback audit event when persistence fails', async () => {
    const audit = {
      recordAuditEventSafe: vi.fn(async () => undefined),
    };
    const { repo, recordVote } = makeRepoMock();
    recordVote.mockRejectedValueOnce(new Error('schema 044 unavailable'));
    const service = new FeedbackService(repo, audit);

    await service.recordFeedback({ kbCandidateId: 5, technicianId: 77, helpful: false });

    expect(audit.recordAuditEventSafe).not.toHaveBeenCalled();
  });

  it('emits a non-punitive audit event without technician identity or free text', async () => {
    const events: { type: string; payload: Record<string, unknown> }[] = [];
    const audit = {
      recordAuditEventSafe: vi.fn(async (e: { eventType: string; payload: Record<string, unknown> }) => {
        events.push({ type: e.eventType, payload: e.payload });
      }),
    };
    const { repo } = makeRepoMock();
    const service = new FeedbackService(repo, audit);

    await service.recordFeedback({ kbCandidateId: 5, technicianId: 77, helpful: false, feedbackText: 'João ligou do 11 99999-9999' });

    const ev = events.find((e) => e.type === 'KB_ARTICLE_NOT_HELPFUL_FEEDBACK');
    expect(ev).toBeDefined();
    expect(ev?.payload.non_punitive).toBe(true);
    // No technician id, no free text in the audit payload.
    const serialized = JSON.stringify(ev?.payload ?? {});
    expect(serialized).not.toContain('77');
    expect(serialized).not.toContain('João');
    expect(serialized).not.toContain('99999');
  });

  it('biases ranking toward helpful articles without hard-hiding', async () => {
    // Very helpful → bias > 1.0; very unhelpful → bias < 1.0; never 0.
    const helpful = new FeedbackService(makeRepoMock({ helpfulCount: 20, notHelpfulCount: 0, score: helpfulnessScore(20, 0) }).repo);
    const unhelpful = new FeedbackService(makeRepoMock({ helpfulCount: 0, notHelpfulCount: 20, score: helpfulnessScore(0, 20) }).repo);

    const biasHelpful = await helpful.getRankingBias({ kbCandidateId: 5 });
    const biasUnhelpful = await unhelpful.getRankingBias({ kbCandidateId: 5 });

    expect(biasHelpful).toBeGreaterThan(1.0);
    expect(biasUnhelpful).toBeLessThan(1.0);
    expect(biasUnhelpful).toBeGreaterThan(0); // never hard-hidden
  });

  it('exposes aggregated category effectiveness with no technician data', async () => {
    const { repo } = makeRepoMock();
    const service = new FeedbackService(repo);

    const metrics = await service.getCategoryEffectiveness(10);

    expect(metrics[0].category).toBe('Office');
    expect(metrics[0].helpfulRatio).toBeCloseTo(0.8333, 3);
    expect(JSON.stringify(metrics)).not.toMatch(/technician|tecnico|user_id/i);
  });

  it('helpfulnessScore is Laplace-smoothed (neutral prior, never 0/1 on one vote)', () => {
    expect(helpfulnessScore(0, 0)).toBe(0.5);          // neutral prior
    expect(helpfulnessScore(1, 0)).toBeLessThan(1);    // one helpful ≠ certainty
    expect(helpfulnessScore(0, 1)).toBeGreaterThan(0); // one unhelpful ≠ zero
    expect(helpfulnessScore(100, 0)).toBeGreaterThan(0.97);
  });
});

describe('PostgresKbFeedbackRepository (SQL shape)', () => {
  it('upserts on the unique vote key (technician may change their vote)', async () => {
    const query = vi.fn(async () => ({ rows: [], rowCount: 0 }));
    const repo = new PostgresKbFeedbackRepository({ query });

    await repo.recordVote({
      kbCandidateId: 5,
      glpiKnowbaseitemId: null,
      glpiTicketId: 900,
      technicianId: 12,
      helpful: true,
    });

    const sql = String(query.mock.calls[0]?.[0] ?? '');
    expect(sql).toContain('INSERT INTO glpi_plugin_integaglpi_kb_article_helpfulness');
    expect(sql).toContain('ON CONFLICT');
    expect(sql).toContain('DO UPDATE SET');
    // No destructive SQL.
    expect(sql).not.toMatch(/\bDELETE\b|\bDROP\b|\bTRUNCATE\b/i);
  });

  it('aggregated-by-category query never selects technician columns', async () => {
    const query = vi.fn(async () => ({ rows: [], rowCount: 0 }));
    const repo = new PostgresKbFeedbackRepository({ query });

    await repo.getAggregatedByCategory(10);

    const sql = String(query.mock.calls[0]?.[0] ?? '');
    expect(sql).toContain('GROUP BY');
    expect(sql).not.toMatch(/technician_id/i);
  });
});
