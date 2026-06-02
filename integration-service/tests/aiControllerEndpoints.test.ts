import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import {
  createAiMetricsController,
  createCoachingChecklistController,
  createCoachingSuggestKbController,
  createExternalResearchDynamicController,
  createSmartHelpController,
} from '../src/controllers/ai.controller.js';

function app(path: string, method: 'get' | 'post', handler: express.RequestHandler) {
  const a = express();
  a.use(express.json());
  a[method](path, handler);
  return a;
}

describe('AI controller endpoints', () => {
  it('POST smart-help returns local-first result and never auto-invokes cloud', async () => {
    const service = {
      assist: vi.fn(async () => ({
        ok: true, ticketId: 5, localResolved: true,
        bestArticle: { kbCandidateId: 1, glpiKnowbaseitemId: null, title: 'X', category: 'Office', excerpt: '', confidence: 0.9 },
        relatedArticles: [], checklist: ['a'], suggestedQuestions: ['q'],
        cloudOffer: { available: false, reason: '' }, cloudInvoked: false as const,
      })),
    };
    const res = await request(app('/smart-help', 'post', createSmartHelpController(service as never)))
      .post('/smart-help').send({ ticket_id: 5, summary: 'office trava' });

    expect(res.status).toBe(200);
    expect(res.body.cloudInvoked).toBe(false);
    expect(service.assist).toHaveBeenCalledOnce();
  });

  it('POST smart-help rejects missing ticket_id', async () => {
    const service = { assist: vi.fn() };
    const res = await request(app('/smart-help', 'post', createSmartHelpController(service as never)))
      .post('/smart-help').send({ summary: 'x' });
    expect(res.status).toBe(400);
    expect(service.assist).not.toHaveBeenCalled();
  });

  it('POST external-research returns 403 without human_consent', async () => {
    const service = { researchDynamic: vi.fn(async () => ({ ok: false, status: 'no_consent', message: '', answer: null, piiDetectedKinds: [] })) };
    const res = await request(app('/er', 'post', createExternalResearchDynamicController(service as never)))
      .post('/er').send({ ticket_id: 1, context: 'x', human_consent: false });
    expect(res.status).toBe(403);
    expect(service.researchDynamic).toHaveBeenCalledOnce();
    expect(service.researchDynamic.mock.calls[0]?.[0].humanConsent).toBe(false);
  });

  it('POST external-research returns 422 when PII is blocked', async () => {
    const service = { researchDynamic: vi.fn(async () => ({ ok: false, status: 'blocked_pii', message: '', answer: null, piiDetectedKinds: ['email'] })) };
    const res = await request(app('/er', 'post', createExternalResearchDynamicController(service as never)))
      .post('/er').send({ ticket_id: 1, context: 'x', human_consent: true });
    expect(res.status).toBe(422);
    expect(res.body.status).toBe('blocked_pii');
  });

  it('GET coaching checklist returns onboarding payload', async () => {
    const service = { getChecklist: vi.fn(async () => ({ onboarding: true, ticketsHandled: 3, items: ['a', 'b'], pops: ['POP-001'] })) };
    const res = await request(app('/checklist', 'get', createCoachingChecklistController(service as never)))
      .get('/checklist?ticket_id=5&technician_id=12');
    expect(res.status).toBe(200);
    expect(res.body.onboarding).toBe(true);
    expect(service.getChecklist.mock.calls[0]?.[0].technicianId).toBe(12);
  });

  it('POST suggest-kb never auto-publishes (auto_publish:false)', async () => {
    const service = { suggestKbArticle: vi.fn(async () => ({ ok: true, candidate: { title: 'T', contentMarkdown: '# T', confidenceScore: 50 }, message: '' })) };
    const res = await request(app('/suggest', 'post', createCoachingSuggestKbController(service as never)))
      .post('/suggest').send({ ticket_id: 5 });
    expect(res.status).toBe(200);
    expect(res.body.auto_publish).toBe(false);
    expect(res.body.candidate.title).toBe('T');
  });

  it('GET metrics returns aggregated data with no technician identity', async () => {
    const feedback = { getCategoryEffectiveness: vi.fn(async () => [{ category: 'Office', helpfulCount: 5, notHelpfulCount: 1, helpfulRatio: 0.83 }]) };
    const cloudAudit = { getCloudGapByCategory: vi.fn(async () => [{ category: 'Rede', cloudCalls: 9 }]) };
    const res = await request(app('/metrics', 'get', createAiMetricsController(feedback as never, cloudAudit as never)))
      .get('/metrics');

    expect(res.status).toBe(200);
    expect(res.body.aggregated).toBe(true);
    expect(res.body.non_punitive).toBe(true);
    expect(res.body.article_effectiveness_by_category[0].category).toBe('Office');
    expect(res.body.cloud_gap_by_category[0].category).toBe('Rede');
    expect(JSON.stringify(res.body)).not.toMatch(/technician|tecnico|user_id|profile_id/i);
  });
});
