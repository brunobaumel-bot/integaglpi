import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createApp, type AppDependencies } from '../src/app.js';

const API_KEY = 'test-internal-key';
const AUTH = `Bearer ${API_KEY}`;

/**
 * Builds the REAL app with mocked AI/KB services to prove the 5 routes mount and
 * are reachable (blocker #1: SmartHelp/Coaching were never registered, so their
 * routes never mounted). We assert the routes are NOT 404 — i.e. they exist.
 */
function buildAppWithAiServices(): ReturnType<typeof createApp> {
  const smartHelpService = {
    assist: vi.fn(async () => ({
      ok: true, ticketId: 1, localResolved: false, bestArticle: null,
      relatedArticles: [], checklist: ['a'], suggestedQuestions: ['q'],
      cloudOffer: { available: true, reason: '' }, cloudInvoked: false as const,
    })),
  };
  const externalResearchService = {
    researchDynamic: vi.fn(async () => ({
      ok: false, status: 'provider_unavailable' as const,
      message: 'Pesquisa externa não configurada. Contate o administrador.',
      answer: null, piiDetectedKinds: [],
    })),
  };
  const coachingService = {
    getChecklist: vi.fn(async () => ({ onboarding: false, ticketsHandled: null, items: [], pops: [] })),
    suggestKbArticle: vi.fn(async () => ({ ok: false, candidate: null, message: '' })),
  };
  const feedbackService = { getCategoryEffectiveness: vi.fn(async () => []) };
  const cloudAuditRepository = { getCloudGapByCategory: vi.fn(async () => []) };

  const deps = {
    inboundWebhookService: {} as never,
    metaAppSecret: 'x',
    metaVerifyToken: 'x',
    outboundMessageService: {} as never,
    integrationServiceApiKey: API_KEY,
    smartHelpService,
    externalResearchService,
    coachingService,
    feedbackService,
    cloudAuditRepository,
  } as unknown as AppDependencies;

  return createApp(deps);
}

describe('AI/KB routes are mounted in the real app (blocker #1)', () => {
  const app = buildAppWithAiServices();

  const routes: Array<{ method: 'get' | 'post'; path: string; body?: object }> = [
    { method: 'post', path: '/internal/glpi/ai/smart-help', body: { ticket_id: 1, summary: 'x' } },
    { method: 'post', path: '/internal/glpi/ai/external-research/dynamic', body: { ticket_id: 1, context: 'x', human_consent: true } },
    { method: 'get', path: '/internal/glpi/ai/coaching/checklist?ticket_id=1&technician_id=2' },
    { method: 'post', path: '/internal/glpi/ai/coaching/suggest-kb', body: { ticket_id: 1 } },
    { method: 'get', path: '/internal/glpi/ai/metrics/effectiveness' },
  ];

  for (const r of routes) {
    it(`${r.method.toUpperCase()} ${r.path.split('?')[0]} is mounted (not 404) and bearer-gated`, async () => {
      // Without bearer → 401 (route exists, auth rejects) — proves it is NOT 404.
      const unauth = r.method === 'get'
        ? await request(app).get(r.path)
        : await request(app).post(r.path).send(r.body ?? {});
      expect(unauth.status).not.toBe(404);
      expect(unauth.status).toBe(401);

      // With bearer → handler runs (200/4xx from the handler, never 404).
      const authed = r.method === 'get'
        ? await request(app).get(r.path).set('Authorization', AUTH)
        : await request(app).post(r.path).set('Authorization', AUTH).send(r.body ?? {});
      expect(authed.status).not.toBe(404);
      expect(authed.status).not.toBe(401);
    });
  }
});
