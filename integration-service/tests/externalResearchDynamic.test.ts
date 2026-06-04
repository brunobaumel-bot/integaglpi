import { describe, expect, it, vi } from 'vitest';

import {
  ExternalResearchService,
  type CloudResearchProvider,
  type DynamicResearchAnswer,
} from '../src/domain/services/ExternalResearchService.js';
import { PostgresCloudAuditRepository } from '../src/repositories/postgres/PostgresCloudAuditRepository.js';
import type { CloudAuditRepository } from '../src/repositories/postgres/PostgresCloudAuditRepository.js';

function answer(): DynamicResearchAnswer {
  return {
    diagnosis: 'Provável conflito de driver após atualização.',
    steps: ['Reverter o driver', 'Reiniciar', 'Validar'],
    risks: ['Perda temporária de conectividade'],
    commands: ['pnputil /delete-driver ...'],
    confirmationQuestions: ['O problema começou após a atualização?'],
    references: [],
  };
}

function auditMock(): { repo: CloudAuditRepository; recordRequest: ReturnType<typeof vi.fn>; recordResponse: ReturnType<typeof vi.fn> } {
  const recordRequest = vi.fn(async () => 101);
  const recordResponse = vi.fn(async () => undefined);
  return {
    repo: { recordRequest, recordResponse, getCloudGapByCategory: vi.fn(async () => []) },
    recordRequest,
    recordResponse,
  };
}

describe('ExternalResearchService.researchDynamic (cloud, human-gated, PII-safe)', () => {
  it('refuses to call cloud without explicit human consent', async () => {
    const provider: CloudResearchProvider = { research: vi.fn(async () => answer()) };
    const { repo, recordRequest } = auditMock();
    const service = new ExternalResearchService(provider, repo);

    const result = await service.researchDynamic({
      context: 'office trava ao abrir',
      ticketId: 1, profileId: 9, category: 'Office', humanConsent: false,
    });

    expect(result.status).toBe('no_consent');
    expect(provider.research).not.toHaveBeenCalled();
    expect(recordRequest).not.toHaveBeenCalled();
  });

  it('blocks PII context and NEVER sends it to the cloud (records blocked audit)', async () => {
    const provider: CloudResearchProvider = { research: vi.fn(async () => answer()) };
    const { repo, recordRequest } = auditMock();
    const service = new ExternalResearchService(provider, repo);

    const result = await service.researchDynamic({
      context: 'Cliente João da Silva, CPF 123.456.789-00, telefone 11 99999-8888, email joao@empresa.com.br',
      ticketId: 2, profileId: 9, category: 'Rede', humanConsent: true,
    });

    expect(result.status).toBe('blocked_pii');
    expect(result.answer).toBeNull();
    expect(result.piiDetectedKinds.length).toBeGreaterThan(0);
    // Cloud provider must NOT be called.
    expect(provider.research).not.toHaveBeenCalled();
    // A blocked-audit row is recorded with piiGuardPassed=false and NO raw summary.
    expect(recordRequest).toHaveBeenCalledOnce();
    const auditArg = recordRequest.mock.calls[0]?.[0];
    expect(auditArg.piiGuardPassed).toBe(false);
    expect(auditArg.requestSummarySanitized).toBeNull();
    // The raw PII must not appear anywhere in the audit payload.
    expect(JSON.stringify(auditArg)).not.toContain('João');
    expect(JSON.stringify(auditArg)).not.toContain('123.456.789');
    expect(JSON.stringify(auditArg)).not.toContain('99999');
  });

  it('sends only sanitized (PII-free) context to the cloud and records request+response audit', async () => {
    let receivedCtx = '';
    const research = vi.fn(async (ctx: string) => {
      receivedCtx = ctx;
      return answer();
    });
    const provider: CloudResearchProvider = { research };
    const { repo, recordRequest, recordResponse } = auditMock();
    const service = new ExternalResearchService(provider, repo, true); // cloudEnabled

    // Clean technical context with NO PII — the only path that reaches the cloud.
    const result = await service.researchDynamic({
      context: 'office trava ao abrir documento grande; sistema apresenta lentidao geral apos atualizacao',
      ticketId: 3, profileId: 9, category: 'Office', provider: 'ollama-cloud', humanConsent: true,
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe('completed');
    expect(result.answer?.diagnosis).toContain('driver');
    expect(research).toHaveBeenCalledOnce();
    // The cloud received the sanitized text only.
    expect(receivedCtx).not.toMatch(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    expect(recordRequest).toHaveBeenCalledOnce();
    expect(recordRequest.mock.calls[0]?.[0].piiGuardPassed).toBe(true);
    expect(recordResponse).toHaveBeenCalledOnce();
    expect(recordResponse.mock.calls[0]?.[0].status).toBe('responded');
  });

  it('records a failed audit when the cloud provider throws', async () => {
    const provider: CloudResearchProvider = { research: vi.fn(async () => { throw new Error('cloud down'); }) };
    const { repo, recordResponse } = auditMock();
    const service = new ExternalResearchService(provider, repo, true); // cloudEnabled

    const result = await service.researchDynamic({
      context: 'rede lenta no setor', ticketId: 4, profileId: 9, category: 'Rede', humanConsent: true,
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe('failed');
    expect(recordResponse).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }));
  });

  it('returns an informative provider_unavailable message (not generic failed) and records a blocked audit', async () => {
    const { repo, recordRequest } = auditMock();
    // No provider AND flag default off → provider unavailable.
    const service = new ExternalResearchService(undefined, repo);

    const result = await service.researchDynamic({
      context: 'rede lenta sem dados pessoais', ticketId: 5, profileId: 9, category: 'Rede', humanConsent: true,
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe('provider_unavailable');
    expect(result.message).toContain('não configurada');
    expect(result.message).toContain('administrador');
    // The blocked attempt is audited with PII guard passed (payload was clean).
    expect(recordRequest).toHaveBeenCalledOnce();
    expect(recordRequest.mock.calls[0]?.[0].status).toBe('blocked');
    expect(recordRequest.mock.calls[0]?.[0].piiGuardPassed).toBe(true);
  });

  it('still returns provider_unavailable when a provider exists but the flag is OFF', async () => {
    const provider: CloudResearchProvider = { research: vi.fn(async () => answer()) };
    const { repo } = auditMock();
    const service = new ExternalResearchService(provider, repo, false); // cloudEnabled=false

    const result = await service.researchDynamic({
      context: 'office lento ao abrir documento grande apos atualizacao', ticketId: 6, profileId: 9, category: 'X', humanConsent: true,
    });

    expect(result.status).toBe('provider_unavailable');
    expect(provider.research).not.toHaveBeenCalled();
  });

  it('returns no_actionable_result (not completed) when the provider answers with no usable guidance', async () => {
    // Provider responds, but with neither a real diagnosis nor concrete steps.
    const emptyAnswer: DynamicResearchAnswer = {
      diagnosis: '', steps: [], risks: [], commands: [], confirmationQuestions: [], references: [],
    };
    const research = vi.fn(async () => emptyAnswer);
    const provider: CloudResearchProvider = { research };
    const { repo, recordResponse } = auditMock();
    const service = new ExternalResearchService(provider, repo, true); // cloudEnabled

    const result = await service.researchDynamic({
      context: 'office lento ao abrir documento grande apos atualizacao', ticketId: 8, profileId: 9, category: 'Office', humanConsent: true,
    });

    expect(research).toHaveBeenCalledOnce();
    expect(result.ok).toBe(false);
    expect(result.status).toBe('no_actionable_result');
    expect(result.actionable).toBe(false);
    // No reviewable candidate can be built from a null answer.
    expect(result.answer).toBeNull();
    expect(result.message).toBe('A pesquisa não retornou orientação técnica utilizável.');
    // The provider DID respond — audit reflects a response, not a transport failure.
    expect(recordResponse).toHaveBeenCalledWith(expect.objectContaining({ status: 'responded' }));
  });

  it('marks an actionable completed answer with actionable=true', async () => {
    const provider: CloudResearchProvider = { research: vi.fn(async () => answer()) };
    const { repo } = auditMock();
    const service = new ExternalResearchService(provider, repo, true);

    const result = await service.researchDynamic({
      context: 'office lento ao abrir documento grande apos atualizacao', ticketId: 9, profileId: 9, category: 'Office', humanConsent: true,
    });

    expect(result.status).toBe('completed');
    expect(result.actionable).toBe(true);
    expect(result.answer?.steps.length).toBeGreaterThan(0);
  });

  it('a source-less answer is still a valid suggestion (external_ai_no_sources, never alta)', async () => {
    const noRefs = (): DynamicResearchAnswer => ({ ...answer(), references: [] });
    const provider: CloudResearchProvider = { research: vi.fn(async () => noRefs()) };
    const { repo } = auditMock();
    const service = new ExternalResearchService(provider, repo, true);

    const result = await service.researchDynamic({
      context: 'falha de autenticacao em estacao windows ao acessar dominio', ticketId: 9, profileId: 9, category: 'Rede', humanConsent: true,
    });

    // Sources are optional: still a success/suggestion.
    expect(result.ok).toBe(true);
    expect(result.status).toBe('completed');
    expect(result.sourceType).toBe('external_ai_no_sources');
    expect(result.reviewRequired).toBe(true);
    // Without sources, confidence is never 'alta'.
    expect(result.confidenceLabel).not.toBe('alta');
  });

  it('an answer WITH references is labeled external_ai_with_sources', async () => {
    const withRefs = (): DynamicResearchAnswer => ({ ...answer(), references: ['https://learn.microsoft.com/x'] });
    const provider: CloudResearchProvider = { research: vi.fn(async () => withRefs()) };
    const { repo } = auditMock();
    const service = new ExternalResearchService(provider, repo, true);

    const result = await service.researchDynamic({
      context: 'spooler de impressao travado apos atualizacao', ticketId: 9, profileId: 9, category: 'Office', humanConsent: true,
    });

    expect(result.status).toBe('completed');
    expect(result.sourceType).toBe('external_ai_with_sources');
    expect(result.reviewRequired).toBe(true);
  });

  it('calls the cloud only when the flag is ON and a provider exists', async () => {
    const provider: CloudResearchProvider = { research: vi.fn(async () => answer()) };
    const { repo } = auditMock();
    const service = new ExternalResearchService(provider, repo, true); // cloudEnabled=true

    const result = await service.researchDynamic({
      context: 'office lento ao abrir documento grande apos atualizacao', ticketId: 7, profileId: 9, category: 'Office', humanConsent: true,
    });

    expect(result.status).toBe('completed');
    expect(provider.research).toHaveBeenCalledOnce();
  });
});

describe('PostgresCloudAuditRepository (SQL shape, no raw payload)', () => {
  it('inserts an audit row returning its id; stores size not content', async () => {
    const query = vi.fn(async () => ({ rows: [{ id: '55' }], rowCount: 1 }));
    const repo = new PostgresCloudAuditRepository({ query });

    const id = await repo.recordRequest({
      glpiTicketId: 1, glpiProfileId: 9, category: 'Office', provider: 'ollama',
      piiGuardPassed: true, piiDetectedKinds: [], requestContextChars: 240,
      requestSummarySanitized: 'resumo sanitizado', inputHash: 'abc',
    });

    expect(id).toBe(55);
    const sql = String(query.mock.calls[0]?.[0] ?? '');
    expect(sql).toContain('INSERT INTO glpi_plugin_integaglpi_cloud_compliance_audit');
    expect(sql).toContain('request_context_chars');
    expect(sql).not.toMatch(/\bDELETE\b|\bDROP\b|\bTRUNCATE\b/i);
  });

  it('cloud gap report groups by category, never by technician', async () => {
    const query = vi.fn(async () => ({ rows: [{ category: 'Office', cloud_calls: '12' }], rowCount: 1 }));
    const repo = new PostgresCloudAuditRepository({ query });

    const gaps = await repo.getCloudGapByCategory(10);

    expect(gaps[0]).toEqual({ category: 'Office', cloudCalls: 12 });
    const sql = String(query.mock.calls[0]?.[0] ?? '');
    expect(sql).toContain('GROUP BY');
    expect(sql).not.toMatch(/technician|profile_id|user_id/i);
  });
});

describe('ExternalResearchService.rewriteCloudSafe (cloud-safe summary rewrite)', () => {
  const svc = new ExternalResearchService();

  it('removes name/company/phone/email/cpf/cnpj/ticket-id from the summary', async () => {
    const out = svc.rewriteCloudSafe(
      'Cliente João da Silva da Empresa ACME Ltda, ticket 2112319359, CPF 123.456.789-00, '
      + 'telefone 11 99999-8888, email joao@empresa.com.br: office trava ao abrir documento grande.',
    );
    expect(out.cloudSafeContext).not.toMatch(/joao@empresa\.com\.br/i);
    expect(out.cloudSafeContext).not.toContain('123.456.789');
    expect(out.cloudSafeContext).not.toContain('99999-8888');
    expect(out.cloudSafeContext).not.toContain('João da Silva');
    expect(out.detectedKinds.length).toBeGreaterThan(0);
    expect(out.source).toBe('summary_rewrite');
    // The cloud-safe text keeps the technical signal.
    expect(out.cloudSafeContext.toLowerCase()).toContain('office');
  });

  it('placeholders alone do NOT make it unsafe (residual policy), real residual PII does', async () => {
    const clean = svc.rewriteCloudSafe('office trava ao abrir documento grande apos atualizacao');
    expect(clean.safeForCloudResidual).toBe(true);

    // A raw email injected survives sanitization? It must be redacted; residual must catch any leak.
    const dirty = svc.rewriteCloudSafe('Contato: alguem@dominio.com.br precisa de ajuda com a rede');
    // Email is redacted → not residual → may be cloud-safe under residual policy,
    // but it must NOT contain the raw email regardless.
    expect(dirty.cloudSafeContext).not.toMatch(/alguem@dominio\.com\.br/i);
  });

  it('caps the cloud-safe context length and never returns raw beyond the cap', async () => {
    const long = 'erro tecnico generico '.repeat(100);
    const out = svc.rewriteCloudSafe(long);
    expect(out.charCount).toBeLessThanOrEqual(600);
    expect(out.cloudSafeContext.length).toBeLessThanOrEqual(600);
  });

  it("residual policy in researchDynamic rewrites and sends only the cloud-safe text", async () => {
    let received = '';
    const provider: CloudResearchProvider = { research: vi.fn(async (ctx: string) => { received = ctx; return answer(); }) };
    const { repo } = auditMock();
    const service = new ExternalResearchService(provider, repo, true);
    const result = await service.researchDynamic({
      context: 'Cliente Maria, email maria@x.com: impressora nao imprime, spooler travado',
      ticketId: 9, profileId: 1, category: 'Office', humanConsent: true, policy: 'residual',
    });
    expect(result.ok).toBe(true);
    // Provider received the rewritten cloud-safe text — never the raw email.
    expect(received).not.toMatch(/maria@x\.com/i);
  });
});
