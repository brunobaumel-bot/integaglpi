import { describe, expect, it, vi } from 'vitest';

import {
  SMART_HELP_HIGH_CONFIDENCE,
  SmartHelpService,
} from '../src/domain/services/SmartHelpService.js';
import type { KbSearchHit, KbSearchPort, RankingBiasPort } from '../src/domain/services/SmartHelpService.js';

function hit(over: Partial<KbSearchHit> = {}): KbSearchHit {
  return {
    kbCandidateId: 1,
    glpiKnowbaseitemId: null,
    title: 'Office não ativa após reinstalação',
    category: 'Office',
    excerpt: 'Procedimento de ativação e validação de licença.',
    score: 0.9,
    ...over,
  };
}

function searchPort(hits: KbSearchHit[]): { port: KbSearchPort; search: ReturnType<typeof vi.fn> } {
  const search = vi.fn(async () => hits);
  return { port: { searchNativeKb: search }, search };
}

describe('SmartHelpService (local-first, cloud offered not invoked)', () => {
  it('returns the best local article when confidence >= 0.80 and does NOT offer cloud', async () => {
    const { port } = searchPort([hit({ score: 0.92 })]);
    const service = new SmartHelpService(port);

    const result = await service.assist({ ticketId: 900, summary: 'office nao ativa', category: 'Office' });

    expect(result.localResolved).toBe(true);
    expect(result.bestArticle?.confidence).toBeGreaterThanOrEqual(SMART_HELP_HIGH_CONFIDENCE);
    expect(result.cloudOffer.available).toBe(false);
    expect(result.cloudInvoked).toBe(false);
    // Proactive content always present.
    expect(result.checklist.length).toBeGreaterThan(0);
    expect(result.suggestedQuestions.length).toBeLessThanOrEqual(3);
  });

  it('offers cloud (but never invokes it) when no local article clears 0.80', async () => {
    const { port } = searchPort([hit({ score: 0.45 }), hit({ kbCandidateId: 2, score: 0.6 })]);
    const service = new SmartHelpService(port);

    const result = await service.assist({ ticketId: 901, summary: 'algo incomum', category: 'Rede' });

    expect(result.localResolved).toBe(false);
    expect(result.bestArticle).toBeNull();
    expect(result.cloudOffer.available).toBe(true);
    expect(result.cloudInvoked).toBe(false);
    // Related articles still surfaced for the technician to consider.
    expect(result.relatedArticles.length).toBeGreaterThan(0);
  });

  it('never calls any cloud port automatically (no cloud dependency exists)', async () => {
    // The service has NO cloud port — it is structurally impossible to auto-invoke cloud.
    const { port, search } = searchPort([hit({ score: 0.3 })]);
    const service = new SmartHelpService(port);

    await service.assist({ ticketId: 902, summary: 'teste', category: '' });

    // Only the local KB search was called.
    expect(search).toHaveBeenCalledOnce();
  });

  it('caps related articles at 3 and questions at 3', async () => {
    const many = Array.from({ length: 8 }, (_, i) => hit({ kbCandidateId: i + 1, score: 0.5 + i * 0.01 }));
    const { port } = searchPort(many);
    const service = new SmartHelpService(port);

    const result = await service.assist({ ticketId: 903, summary: 'muitos artigos', category: 'Office' });

    expect(result.relatedArticles.length).toBe(3);
    expect(result.suggestedQuestions.length).toBe(3);
    expect(result.checklist.length).toBe(3);
  });

  it('applies feedback ranking bias so a helpful article can clear the threshold', async () => {
    // Raw score 0.75 (below 0.80); a strong helpful bias (1.2) lifts it to 0.90.
    const { port } = searchPort([hit({ kbCandidateId: 5, score: 0.75 })]);
    const bias: RankingBiasPort = { getRankingBias: vi.fn(async () => 1.2) };
    const service = new SmartHelpService(port, bias);

    const result = await service.assist({ ticketId: 904, summary: 'caso util', category: 'Office' });

    expect(result.bestArticle?.confidence).toBeCloseTo(0.9, 2);
    expect(result.localResolved).toBe(true);
    expect(bias.getRankingBias).toHaveBeenCalled();
  });

  it('returns a safe empty-ish result on blank context without searching', async () => {
    const { port, search } = searchPort([hit()]);
    const service = new SmartHelpService(port);

    const result = await service.assist({ ticketId: 905, summary: '   ', category: '' });

    expect(result.localResolved).toBe(false);
    expect(result.bestArticle).toBeNull();
    expect(result.cloudOffer.available).toBe(false);
    expect(result.cloudInvoked).toBe(false);
    // Checklist/questions still provided; no KB search attempted on empty context.
    expect(result.checklist.length).toBeGreaterThan(0);
    expect(search).not.toHaveBeenCalled();
  });

  it('degrades gracefully when the KB search throws', async () => {
    const port: KbSearchPort = { searchNativeKb: vi.fn(async () => { throw new Error('db down'); }) };
    const service = new SmartHelpService(port);

    const result = await service.assist({ ticketId: 906, summary: 'erro de busca', category: 'Rede' });

    expect(result.ok).toBe(true);
    expect(result.localResolved).toBe(false);
    expect(result.cloudOffer.available).toBe(true); // local failed → cloud offered (still not invoked)
    expect(result.cloudInvoked).toBe(false);
  });
});
