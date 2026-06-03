import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createApp, type AppDependencies } from '../src/app.js';
import { persistKbCandidates } from '../src/kbCandidates/repository.js';
import type { GeneratedKbCandidate } from '../src/kbCandidates/types.js';

const API_KEY = 'fb-key';
const AUTH = `Bearer ${API_KEY}`;

function appWithFeedback(recordFeedback: ReturnType<typeof vi.fn>) {
  const deps = {
    inboundWebhookService: {} as never,
    metaAppSecret: 'x', metaVerifyToken: 'x',
    outboundMessageService: {} as never,
    integrationServiceApiKey: API_KEY,
    feedbackService: { recordFeedback },
  } as unknown as AppDependencies;
  return createApp(deps);
}

describe('POST /internal/glpi/ai/kb-feedback', () => {
  it('records a vote and returns the helpfulness snapshot (bearer-gated)', async () => {
    const recordFeedback = vi.fn(async () => ({
      ok: true, status: 'recorded', message: 'Feedback registrado.',
      helpfulness: { kbCandidateId: 5, glpiKnowbaseitemId: null, helpfulCount: 1, notHelpfulCount: 0, totalVotes: 1, helpfulRatio: 1, score: 0.6667 },
    }));
    const app = appWithFeedback(recordFeedback);

    const res = await request(app)
      .post('/internal/glpi/ai/kb-feedback')
      .set('Authorization', AUTH)
      .send({ ticket_id: 900, kb_candidate_id: 5, helpful: true });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.helpfulness.helpfulCount).toBe(1);
    expect(recordFeedback.mock.calls[0]?.[0]).toMatchObject({ kbCandidateId: 5, glpiTicketId: 900, helpful: true });
  });

  it('rejects without a bearer token (401, not 404 — route is mounted)', async () => {
    const app = appWithFeedback(vi.fn());
    const res = await request(app).post('/internal/glpi/ai/kb-feedback').send({ ticket_id: 1, kb_candidate_id: 5, helpful: true });
    expect(res.status).toBe(401);
  });

  it('returns 400 for invalid target (no article id)', async () => {
    const recordFeedback = vi.fn(async () => ({ ok: false, status: 'invalid_target', message: 'x', helpfulness: null }));
    const app = appWithFeedback(recordFeedback);
    const res = await request(app)
      .post('/internal/glpi/ai/kb-feedback')
      .set('Authorization', AUTH)
      .send({ ticket_id: 1, helpful: true });
    expect(res.status).toBe(400);
  });

  it('returns a typed 500 when feedback persistence is unavailable', async () => {
    const recordFeedback = vi.fn(async () => ({
      ok: false,
      status: 'failed',
      message: 'Não foi possível registrar o feedback agora.',
      helpfulness: null,
    }));
    const app = appWithFeedback(recordFeedback);

    const res = await request(app)
      .post('/internal/glpi/ai/kb-feedback')
      .set('Authorization', AUTH)
      .send({ ticket_id: 1, kb_candidate_id: 5, helpful: true });

    expect(res.status).toBe(500);
    expect(res.body.ok).toBe(false);
    expect(res.body.status).toBe('failed');
    expect(res.body.message).toBe('Não foi possível registrar o feedback agora.');
    expect(JSON.stringify(res.body)).not.toMatch(/relation|schema|token|authorization|bearer/i);
  });

  it('accepts feedback for native GLPI KB articles using glpi_knowbaseitem_id', async () => {
    const recordFeedback = vi.fn(async () => ({
      ok: true, status: 'recorded', message: 'Feedback registrado.',
      helpfulness: { kbCandidateId: null, glpiKnowbaseitemId: 42, helpfulCount: 1, notHelpfulCount: 0, totalVotes: 1, helpfulRatio: 1, score: 0.6667 },
    }));
    const app = appWithFeedback(recordFeedback);

    const res = await request(app)
      .post('/internal/glpi/ai/kb-feedback')
      .set('Authorization', AUTH)
      .send({ ticket_id: 900, glpi_knowbaseitem_id: 42, helpful: true });

    expect(res.status).toBe(200);
    expect(recordFeedback.mock.calls[0]?.[0]).toMatchObject({
      kbCandidateId: null,
      glpiKnowbaseitemId: 42,
      glpiTicketId: 900,
      helpful: true,
    });
  });

  it('treats a repeat vote as an upsert (same target, updated helpful flag)', async () => {
    const recordFeedback = vi.fn(async () => ({
      ok: true, status: 'recorded', message: '',
      helpfulness: { kbCandidateId: 5, glpiKnowbaseitemId: null, helpfulCount: 0, notHelpfulCount: 1, totalVotes: 1, helpfulRatio: 0, score: 0.3333 },
    }));
    const app = appWithFeedback(recordFeedback);

    await request(app).post('/internal/glpi/ai/kb-feedback').set('Authorization', AUTH).send({ ticket_id: 1, kb_candidate_id: 5, technician_id: 7, helpful: true });
    const res = await request(app).post('/internal/glpi/ai/kb-feedback').set('Authorization', AUTH).send({ ticket_id: 1, kb_candidate_id: 5, technician_id: 7, helpful: false });

    expect(res.status).toBe(200);
    // The service (repository upsert) decides — the route just forwards both votes.
    expect(recordFeedback).toHaveBeenCalledTimes(2);
    expect(recordFeedback.mock.calls[1]?.[0].helpful).toBe(false);
  });
});

describe('persistKbCandidates writes migration 044 structured columns', () => {
  function candidate(over: Partial<GeneratedKbCandidate> = {}): GeneratedKbCandidate {
    return {
      candidateKey: 'k1', inputHash: 'h', status: 'suggested', articleType: 'procedimento_tecnico',
      title: 'Office não ativa', contentMarkdown: '# x', problemPattern: 'p', symptoms: [], probableCause: 'c',
      recommendedProcedure: [], checklistItems: [], humanizedCustomerResponse: 'r', tags: [], categorySuggestion: 'Office',
      relatedNativeKbArticles: [], possibleDuplicate: false, duplicateReason: null, sourcePatternIds: [1],
      sourceInsightIds: [], evidenceSummarySanitized: 's', evidenceHashes: [], confidenceScore: 80,
      confidenceReason: 'Score 80: 6 ocorrências; revisão humana obrigatória.',
      difficultyLevel: 'intermediario', targetAudience: 'Técnico N1/N2', limitations: ['x'],
      ...over,
    };
  }

  it('includes confidence_reason / difficulty_level / target_audience in the INSERT', async () => {
    const query = vi.fn(async () => ({ rows: [{ id: 1 }], rowCount: 1 }));
    await persistKbCandidates({ query }, [candidate()], 42);

    // First query is the INSERT into kb_candidates.
    const insert = query.mock.calls[0];
    const sql = String(insert?.[0] ?? '');
    const params = insert?.[1] as unknown[];

    expect(sql).toContain('confidence_reason');
    expect(sql).toContain('difficulty_level');
    expect(sql).toContain('target_audience');
    expect(params).toContain('Score 80: 6 ocorrências; revisão humana obrigatória.');
    expect(params).toContain('intermediario');
    expect(params).toContain('Técnico N1/N2');
    // No destructive SQL.
    expect(sql).not.toMatch(/\bDROP\b|\bDELETE\b|\bTRUNCATE\b/i);
  });
});
