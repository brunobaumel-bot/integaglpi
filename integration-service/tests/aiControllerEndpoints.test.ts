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
  scrubSummaryFabrications,
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

  it('POST external-research/preview returns cloud-safe context + safe_for_cloud for clean summary', async () => {
    const service = {
      rewriteCloudSafe: vi.fn(() => ({
        cloudSafeContext: 'office trava ao abrir documento grande',
        safeForCloudResidual: true, safeForCloudStrict: true,
        detectedKinds: [], removedKinds: [], blockedReason: null,
        payloadHash: 'h2', charCount: 38, source: 'summary_rewrite' as const,
      })),
    };
    const res = await request(app('/prev', 'post', createExternalResearchPreviewController(service as never)))
      .post('/prev').send({ ticket_id: 5, context: 'office trava ao abrir documento grande' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.safe_for_cloud).toBe(true);
    expect(res.body.cloud_safe_context).toContain('office trava');
    expect(res.body.source).toBe('summary_rewrite');
    expect(res.body.read_only).toBe(true);
  });

  it('POST external-research/preview blocks (safe_for_cloud=false) and never echoes raw context', async () => {
    const service = {
      rewriteCloudSafe: vi.fn(() => ({
        cloudSafeContext: 'Cliente [nome], CPF [documento], telefone [telefone], email [email]',
        safeForCloudResidual: false, safeForCloudStrict: false,
        detectedKinds: ['cpf_cnpj', 'email', 'name', 'phone'],
        removedKinds: ['cpf_cnpj', 'email', 'name', 'phone'],
        blockedReason: 'RESIDUAL_PII_AFTER_REWRITE', payloadHash: 'h2', charCount: 60,
        source: 'summary_rewrite' as const,
      })),
    };
    const res = await request(app('/prev', 'post', createExternalResearchPreviewController(service as never)))
      .post('/prev').send({ ticket_id: 5, context: 'Cliente João da Silva, CPF 123.456.789-00, joao@empresa.com.br' });
    expect(res.status).toBe(200);
    expect(res.body.safe_for_cloud).toBe(false);
    expect(res.body.removed_kinds).toEqual(expect.arrayContaining(['email', 'name']));
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

  it('POST technical-summary scrubs hallucinated GLPI/banco/registro absent from the conversation', async () => {
    const summarizer = {
      generate: vi.fn(async () => (
        'O usuário está realizando um teste com o sistema GLPI e relata que o problema afeta a '
        + 'funcionalidade de registro ou atualização de informações em banco de dados existente, '
        + 'com possível falha no processamento dos registros relacionados à sincronização do AD.'
      )),
    };
    const res = await request(app('/ts', 'post', createTechnicalSummaryController(summarizer as never)))
      .post('/ts').send({ ticket_id: 7, context: 'quero urgencia. problema grave. estou com problemas. problemas de sync do ad' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const out = String(res.body.technical_summary);
    // Fabricated context (not in the conversation) is removed.
    expect(out).not.toMatch(/\bGLPI\b/i);
    expect(out).not.toMatch(/banco de dados/i);
    expect(out).not.toMatch(/registro ou atualiza/i);
    expect(out).not.toMatch(/processamento dos registros/i);
    // The real technical term from the conversation is preserved.
    expect(out.toLowerCase()).toContain('sincronização do ad');
  });

  it('POST technical-summary neutralizes residual name/company/placeholders and keeps AD sync terms', async () => {
    const summarizer = {
      generate: vi.fn(async () => (
        'O [nome removido], representante da empresa Ethica Informática, realizou um teste do sistema via WhatsApp, '
        + 'relatando que está recebendo a mensagem de erro "sync do AD falhou".'
      )),
    };
    const res = await request(app('/ts', 'post', createTechnicalSummaryController(summarizer as never)))
      .post('/ts').send({
        ticket_id: 7,
        context: 'erro de sync do AD falhou; validar Active Directory, DNS, NTP e replicacao',
      });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const out = String(res.body.technical_summary);
    expect(out).not.toMatch(/Ethica|Inform[aá]tica/i);
    expect(out).not.toMatch(/\[nome|nome removido/i);
    expect(out).not.toMatch(/representante da empresa|cliente da empresa/i);
    expect(out).toMatch(/Foi relatado|Foi informado|O solicitante relatou/i);
    expect(out).toMatch(/sync do AD|Active Directory/i);
  });

  it('scrubSummaryFabrications keeps GLPI when it IS in the conversation', async () => {
    const kept = scrubSummaryFabrications('Erro ao acessar o GLPI ao abrir chamado.', 'não consigo abrir o glpi');
    expect(kept).toMatch(/GLPI/i);
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
