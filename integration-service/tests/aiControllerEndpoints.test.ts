import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import {
  createAiMetricsController,
  createCoachingChecklistController,
  createCoachingSuggestKbController,
  createExternalResearchDynamicController,
  createExternalResearchPreviewController,
  createSmartHelpController,
  createTechnicalSummaryController,
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

  it('POST external-research/preview returns sanitized text + safe_for_cloud=true for clean context', async () => {
    const service = {
      preview: vi.fn(() => ({
        inputHash: 'h1', anonymizedPayloadHash: 'h2',
        sanitizedText: 'office trava ao abrir documento grande',
        detectedKinds: [], blocked: false, blockedReason: null,
      })),
    };
    const res = await request(app('/prev', 'post', createExternalResearchPreviewController(service as never)))
      .post('/prev').send({ ticket_id: 5, context: 'office trava ao abrir documento grande' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.safe_for_cloud).toBe(true);
    expect(res.body.sanitized_text).toContain('office trava');
    expect(res.body.detected_kinds).toEqual([]);
    expect(res.body.read_only).toBe(true);
  });

  it('POST external-research/preview blocks (safe_for_cloud=false) and never echoes raw context', async () => {
    const service = {
      preview: vi.fn(() => ({
        inputHash: 'h1', anonymizedPayloadHash: 'h2',
        sanitizedText: 'Cliente [nome], CPF [documento], telefone [telefone], email [email]',
        detectedKinds: ['cpf_cnpj', 'email', 'name', 'phone'], blocked: true,
        blockedReason: 'EXTERNAL_RESEARCH_PAYLOAD_BLOCKED_PII_OR_SECRET',
      })),
    };
    const res = await request(app('/prev', 'post', createExternalResearchPreviewController(service as never)))
      .post('/prev').send({ ticket_id: 5, context: 'Cliente João da Silva, CPF 123.456.789-00, joao@empresa.com.br' });
    expect(res.status).toBe(200);
    expect(res.body.safe_for_cloud).toBe(false);
    expect(res.body.detected_kinds).toEqual(expect.arrayContaining(['email', 'name']));
    // The raw PII must NOT be present anywhere in the response.
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain('João');
    expect(raw).not.toContain('123.456.789');
    expect(raw).not.toContain('joao@empresa.com.br');
  });

  it('POST external-research/preview rejects empty context', async () => {
    const service = { preview: vi.fn() };
    const res = await request(app('/prev', 'post', createExternalResearchPreviewController(service as never)))
      .post('/prev').send({ ticket_id: 5, context: '   ' });
    expect(res.status).toBe(400);
    expect(res.body.safe_for_cloud).toBe(false);
    expect(service.preview).not.toHaveBeenCalled();
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

  it('POST technical-summary returns local_ai summary when the local provider answers', async () => {
    const summarizer = {
      generate: vi.fn(async () => 'Problema relatado: impressora não imprime.\nContexto técnico: spooler travado.\nPróxima ação sugerida: reiniciar spooler.'),
    };
    const res = await request(app('/ts', 'post', createTechnicalSummaryController(summarizer as never)))
      .post('/ts').send({ ticket_id: 7, context: 'impressora nao imprime, spooler travado' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.summary_source).toBe('local_ai');
    expect(res.body.technical_summary).toContain('Problema relatado');
    expect(summarizer.generate).toHaveBeenCalledOnce();
    expect(summarizer.generate.mock.calls[0]?.[0].ticketId).toBe(7);
  });

  it('POST technical-summary rejects missing ticket_id', async () => {
    const summarizer = { generate: vi.fn() };
    const res = await request(app('/ts', 'post', createTechnicalSummaryController(summarizer as never)))
      .post('/ts').send({ context: 'x' });
    expect(res.status).toBe(400);
    expect(summarizer.generate).not.toHaveBeenCalled();
  });

  it('POST technical-summary degrades to fallback with typed error on provider failure', async () => {
    const summarizer = { generate: vi.fn(async () => { throw new Error('OLLAMA timeout'); }) };
    const res = await request(app('/ts', 'post', createTechnicalSummaryController(summarizer as never)))
      .post('/ts').send({ ticket_id: 7, context: 'algum contexto' });
    // 200 (parseable) so PHP can apply its deterministic fallback.
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.summary_source).toBe('fallback');
    expect(res.body.error_type).toBe('local_ai_timeout');
  });

  it('POST technical-summary never calls cloud / sends WhatsApp / mutates ticket', async () => {
    const summarizer = { generate: vi.fn(async () => 'Problema relatado: x.\nContexto técnico: y.\nPróxima ação sugerida: z.') };
    const res = await request(app('/ts', 'post', createTechnicalSummaryController(summarizer as never)))
      .post('/ts').send({ ticket_id: 1, context: 'abc' });
    expect(res.body.read_only).toBe(true);
    expect(JSON.stringify(res.body)).not.toMatch(/cloud|whatsapp|sendOutbound|update_ticket/i);
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
