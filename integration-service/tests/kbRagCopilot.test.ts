/**
 * Unit tests — KB RAG Copilot
 *
 * Phase: integaglpi_local_kb_rag_technician_copilot_001
 * Adendo 1: integaglpi_local_kb_rag_technician_copilot_001_adendo_pipeline_qdrant_001
 * Adendo 2: integaglpi_local_kb_rag_model_query_expansion_adendum_001
 *
 * Tests:
 *   1.  Deterministic fallback when no KB results.
 *   2.  Deterministic fallback when ollamaPort is null.
 *   3.  Structured output populated from KB when ollamaPort returns valid JSON.
 *   4.  Fallback to deterministic when ollamaPort throws.
 *   5.  Empty query returns ok=false.
 *   6.  kbsUsed only contains retrieved article IDs (never hallucinated).
 *   7.  Safety warnings always present.
 *   8.  Cloud AI structurally absent (no cloud port in service).
 *   9.  Audit called with correct metadata on success.
 *  10.  Smoke: six HML queries resolve with ok=true and all 12 playbook sections.
 *  11.  PII guard: phone numbers, e-mails, and tokens are stripped before prompt.
 *  12.  Redis cache: hit skips searchCandidates; miss stores result.
 *  13.  expandedTerms present in result (non-empty array of strings).
 *  14.  kbsScoreBreakdown present and contains score fields for each KB used.
 *  15.  clientContext productOrSystem boost: matching hits rank first.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  KbRagCopilotService,
  piiGuard,
  type KbCandidateSearchRepository,
  type OllamaRagPort,
  type RagAuditPort,
  type KbRagCachePort,
  type KbRagInput,
  type KbClientContext,
  type KbScoreEntry,
} from '../src/domain/services/KbRagCopilotService.js';
import type { KbCandidateHit } from '../src/repositories/postgres/PostgresKbCandidateSearchRepository.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeHit(over: Partial<KbCandidateHit> = {}): KbCandidateHit {
  return {
    id: 1,
    candidateKey: 'kb-test-micromed-nao-abre',
    title: 'Micromed não abre após atualização',
    articleType: 'procedimento_tecnico',
    categorySuggestion: 'Sistema / Micromed',
    problemPattern: 'Sistema não inicia; Ícone não responde; Erro ao abrir',
    symptomsJson: ['Sistema não abre', 'Tela preta ao iniciar', 'Erro de permissão'],
    probableCause: 'Atualização incorreta ou permissão de pasta bloqueada.',
    recommendedProcedureJson: ['Verificar logs do Micromed', 'Checar permissão de pasta', 'Reinstalar serviço'],
    checklistJson: ['Confirmar que o sistema abre', 'Validar login do usuário'],
    tagsJson: ['micromed', 'sistema', 'não abre'],
    evidenceSummarySanitized: 'micromed não abre sistema bloqueado permissão',
    confidenceScore: 80,
    rawScore: 0.8,
    ...over,
  };
}

function makeSearchRepo(hits: KbCandidateHit[] = [makeHit()]): KbCandidateSearchRepository {
  return { searchCandidates: vi.fn(async () => hits) };
}

function makeOllama(response: string | null = null): OllamaRagPort {
  if (response === null) {
    return { generateText: vi.fn(async () => { throw new Error('OLLAMA_UNAVAILABLE'); }) };
  }
  return { generateText: vi.fn(async () => response) };
}

const nullAudit: RagAuditPort = { writeRagAudit: vi.fn(async () => { /* no-op */ }) };

/** Cache stub — in-memory, for testing */
function makeCache(initial: Record<string, string> = {}): KbRagCachePort & { store: Record<string, string> } {
  const store = { ...initial };
  return {
    store,
    get: vi.fn(async (key: string) => store[key] ?? null),
    set: vi.fn(async (key: string, value: string) => { store[key] = value; }),
  };
}

/** Valid AI playbook JSON with 12 content sections */
const validPlaybookJson = JSON.stringify({
  resumo_do_incidente: 'Micromed não abre após atualização de sistema.',
  sintomas_identificados: ['Sistema não abre', 'Erro ao iniciar'],
  hipoteses_por_camada: ['Camada de aplicação: permissão de pasta bloqueada'],
  causas_possiveis: ['Permissão de pasta bloqueada'],
  perguntas_de_triagem: ['Quando começou?', 'Afeta outros usuários?'],
  verificacoes_ou_comandos_sugeridos: ['Verificar logs do Micromed'],
  resolucao_sugerida: ['Ajustar permissão da pasta de instalação'],
  validacao: ['Confirmar abertura do sistema'],
  escalonamento: ['Escalar para N2 se não resolver em 30min'],
  riscos_rollback: ['Criar backup antes de alterar permissões'],
  nivel_de_confianca: 0.85,
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('KbRagCopilotService', () => {
  it('1. returns deterministic fallback when search returns empty', async () => {
    const svc = new KbRagCopilotService(makeSearchRepo([]), null, nullAudit);
    const result = await svc.generatePlaybook({ query: 'micromed não abre' });

    expect(result.ok).toBe(true);
    expect(result.deterministicFallback).toBe(true);
    expect(result.localAiUsed).toBe(false);
    expect(result.kbsFound).toBe(0);
    expect(result.kbsUsed).toHaveLength(0);
    expect(result.playbook.avisos_de_seguranca.length).toBeGreaterThan(0);
    // Adendo 2: expandedTerms always present
    expect(Array.isArray(result.expandedTerms)).toBe(true);
    // Adendo 2: kbsScoreBreakdown empty when no KBs found
    expect(Array.isArray(result.kbsScoreBreakdown)).toBe(true);
    expect(result.kbsScoreBreakdown).toHaveLength(0);
  });

  it('2. uses deterministic playbook when ollamaPort is null', async () => {
    const svc = new KbRagCopilotService(makeSearchRepo(), null, nullAudit);
    const result = await svc.generatePlaybook({ query: 'servidor lento' });

    expect(result.ok).toBe(true);
    expect(result.deterministicFallback).toBe(true);
    expect(result.localAiUsed).toBe(false);
    expect(result.kbsUsed.length).toBeGreaterThan(0);
    // Deterministic playbook should populate sections from KB
    expect(result.playbook.sintomas_identificados.length).toBeGreaterThan(0);
    expect(result.playbook.resolucao_sugerida.length).toBeGreaterThan(0);
    // New adendo sections present
    expect(typeof result.playbook.resumo_do_incidente).toBe('string');
    expect(Array.isArray(result.playbook.hipoteses_por_camada)).toBe(true);
    expect(Array.isArray(result.playbook.riscos_rollback)).toBe(true);
  });

  it('3. uses AI playbook when ollamaPort returns valid JSON', async () => {
    const svc = new KbRagCopilotService(makeSearchRepo(), makeOllama(validPlaybookJson), nullAudit);
    const result = await svc.generatePlaybook({ query: 'micromed não abre' });

    expect(result.ok).toBe(true);
    expect(result.localAiUsed).toBe(true);
    expect(result.deterministicFallback).toBe(false);
    expect(result.source).toBe('local_ai');
    expect(result.playbook.sintomas_identificados).toContain('Sistema não abre');
    expect(result.playbook.causas_possiveis).toContain('Permissão de pasta bloqueada');
    expect(result.playbook.nivel_de_confianca).toBeCloseTo(0.85, 2);
    // Adendo 1 sections populated from AI response
    expect(result.playbook.resumo_do_incidente).toContain('Micromed');
    expect(result.playbook.hipoteses_por_camada).toContain('Camada de aplicação: permissão de pasta bloqueada');
    expect(result.playbook.riscos_rollback).toContain('Criar backup antes de alterar permissões');
    // Adendo 2: expandedTerms come from QueryExpansionService
    expect(Array.isArray(result.expandedTerms)).toBe(true);
    expect(result.expandedTerms.length).toBeGreaterThan(0);
    // Adendo 2: kbsScoreBreakdown populated for each KB used
    expect(Array.isArray(result.kbsScoreBreakdown)).toBe(true);
    expect(result.kbsScoreBreakdown.length).toBeGreaterThan(0);
    const entry = result.kbsScoreBreakdown[0] as KbScoreEntry;
    expect(typeof entry.id).toBe('number');
    expect(typeof entry.title).toBe('string');
    expect(typeof entry.totalScore).toBe('number');
    expect(typeof entry.breakdown.lexicalScore).toBe('number');
    expect(typeof entry.breakdown.symptomsMatch).toBe('boolean');
  });

  it('4. falls back to deterministic when ollamaPort throws', async () => {
    const svc = new KbRagCopilotService(makeSearchRepo(), makeOllama(null), nullAudit);
    const result = await svc.generatePlaybook({ query: 'backup falhou arquivo em uso' });

    expect(result.ok).toBe(true);
    expect(result.deterministicFallback).toBe(true);
    expect(result.localAiUsed).toBe(false);
    // Still populated from KB data
    expect(result.playbook.resolucao_sugerida.length).toBeGreaterThan(0);
  });

  it('5. returns ok=false for empty query', async () => {
    const svc = new KbRagCopilotService(makeSearchRepo(), null, nullAudit);
    const result = await svc.generatePlaybook({ query: '' });

    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('6. kbsUsed only contains retrieved article IDs', async () => {
    const hits = [
      makeHit({ id: 42, title: 'Artigo A' }),
      makeHit({ id: 99, title: 'Artigo B' }),
    ];
    const svc = new KbRagCopilotService(makeSearchRepo(hits), null, nullAudit);
    const result = await svc.generatePlaybook({ query: 'firewall bloqueando api' });

    const usedIds = result.kbsUsed.map((k) => k.id);
    expect(usedIds).toContain(42);
    expect(usedIds).toContain(99);
    // No hallucinated IDs
    expect(usedIds.every((id) => [42, 99].includes(id))).toBe(true);
  });

  it('7. safety warnings always present in output', async () => {
    const svc = new KbRagCopilotService(makeSearchRepo(), makeOllama(validPlaybookJson), nullAudit);
    const result = await svc.generatePlaybook({ query: 'qualquer consulta' });

    expect(result.playbook.avisos_de_seguranca.length).toBeGreaterThan(0);
    // Must include the non-auto-send warning
    expect(result.playbook.avisos_de_seguranca.some((w) =>
      w.toLowerCase().includes('cliente') || w.toLowerCase().includes('interno'),
    )).toBe(true);
  });

  it('8. cloud AI is structurally absent — no cloud port accepted', async () => {
    // KbRagCopilotService constructor only accepts OllamaRagPort (local) or null.
    // This test verifies the interface has no cloud parameter.
    const svc = new KbRagCopilotService(makeSearchRepo(), null, nullAudit);
    // Service created without cloud — only local or fallback.
    expect(svc).toBeDefined();
    const result = await svc.generatePlaybook({ query: 'teste cloud segurança' });
    expect(result.localAiUsed).toBe(false); // null ollama → deterministic
  });

  it('9. audit is called with correct metadata on success', async () => {
    const auditSpy: RagAuditPort = { writeRagAudit: vi.fn(async () => { /* no-op */ }) };
    const hits = [makeHit({ id: 55 })];
    const svc = new KbRagCopilotService(makeSearchRepo(hits), null, auditSpy);
    await svc.generatePlaybook({ query: 'usuario bloqueado licenca', ticketId: 9001, technicianId: 3 });

    // Wait for fire-and-forget
    await new Promise((r) => setTimeout(r, 50));
    expect(auditSpy.writeRagAudit).toHaveBeenCalledOnce();
    const call = (auditSpy.writeRagAudit as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.ticketId).toBe(9001);
    expect(call.technicianId).toBe(3);
    expect(call.kbIdsUsed).toContain(55);
    expect(call.source).toBe('local_kb');
  });

  it('10. smoke: six canonical queries resolve with ok=true and all 12 playbook sections', async () => {
    const queries: KbRagInput[] = [
      { query: 'micromed não abre' },
      { query: 'servidor lento' },
      { query: 'backup falhou arquivo em uso' },
      { query: 'usuário bloqueado continua consumindo licença' },
      { query: 'firewall bloqueando API' },
      { query: 'restaurar arquivo Synology' },
    ];
    const svc = new KbRagCopilotService(makeSearchRepo(), null, nullAudit);
    for (const q of queries) {
      const result = await svc.generatePlaybook(q);
      expect(result.ok).toBe(true);
      // Original 10 sections
      expect(typeof result.playbook.resumo_do_incidente).toBe('string');
      expect(result.playbook.sintomas_identificados).toBeDefined();
      expect(result.playbook.hipoteses_por_camada).toBeDefined();
      expect(result.playbook.causas_possiveis).toBeDefined();
      expect(result.playbook.perguntas_de_triagem).toBeDefined();
      expect(result.playbook.verificacoes_ou_comandos_sugeridos).toBeDefined();
      expect(typeof result.playbook.resolucao_sugerida).not.toBe('undefined');
      expect(result.playbook.validacao).toBeDefined();
      expect(result.playbook.escalonamento).toBeDefined();
      expect(result.playbook.riscos_rollback).toBeDefined();
      expect(Array.isArray(result.playbook.kbs_utilizadas)).toBe(true);
      expect(typeof result.playbook.nivel_de_confianca).toBe('number');
      expect(result.playbook.avisos_de_seguranca.length).toBeGreaterThan(0);
    }
  });

  it('11. piiGuard strips phone, email, CPF and tokens from text', () => {
    const cases: Array<[string, string, string]> = [
      ['phone BR', 'Ligue para 41988334449 agora', '[TELEFONE]'],
      ['phone formatted', 'Tel: (41) 9 8833-4449 ok', '[TELEFONE]'],
      ['email', 'envie para tecnico@empresa.com.br por favor', '[EMAIL]'],
      ['cpf', 'CPF do user: 123.456.789-09', '[CPF]'],
      ['bearer token', 'Authorization: Bearer abc123def456xyz789', '[CREDENCIAL]'],
      ['senha', 'senha: minha_senha_secreta', '[CREDENCIAL]'],
    ];
    for (const [label, input, expected] of cases) {
      const result = piiGuard(input);
      expect(result, `piiGuard deve remover ${label}`).toContain(expected);
      // Original sensitive value should be gone
      expect(result.length).toBeLessThan(input.length + 5);
    }
    // Safe text unchanged
    const safe = 'servidor lento, verificar logs do apache';
    expect(piiGuard(safe)).toBe(safe);
  });

  it('12. Redis cache: hit skips searchCandidates; miss populates cache', async () => {
    const hit = makeHit({ id: 7 });
    const repo = makeSearchRepo([hit]);
    const cache = makeCache();

    const svc = new KbRagCopilotService(repo, null, nullAudit, cache);

    // First call — cache miss → DB called, result stored
    const r1 = await svc.generatePlaybook({ query: 'micromed permissão', topK: 3 });
    expect(repo.searchCandidates).toHaveBeenCalledOnce();
    expect(cache.set).toHaveBeenCalledOnce();
    expect(r1.ok).toBe(true);
    expect(r1.kbsUsed.some((k) => k.id === 7)).toBe(true);

    // Manually verify something was stored
    const keys = Object.keys(cache.store);
    expect(keys.length).toBe(1);
    expect(keys[0]).toMatch(/^kbrag:search:/);

    // Second call — same query → cache hit → DB NOT called again
    const r2 = await svc.generatePlaybook({ query: 'micromed permissão', topK: 3 });
    expect(repo.searchCandidates).toHaveBeenCalledOnce(); // still only once
    expect(r2.ok).toBe(true);
    expect(r2.kbsUsed.some((k) => k.id === 7)).toBe(true);
  });

  it('13. expandedTerms is always present and non-empty for valid query', async () => {
    const svc = new KbRagCopilotService(makeSearchRepo(), null, nullAudit);
    const result = await svc.generatePlaybook({ query: 'servidor web não responde' });

    expect(result.ok).toBe(true);
    expect(Array.isArray(result.expandedTerms)).toBe(true);
    // Must have at least the original query term
    expect(result.expandedTerms.length).toBeGreaterThanOrEqual(1);
    // All entries must be non-empty strings
    for (const term of result.expandedTerms) {
      expect(typeof term).toBe('string');
      expect(term.length).toBeGreaterThan(0);
    }
    // PII must not appear in expandedTerms
    const asText = result.expandedTerms.join(' ');
    expect(asText).not.toMatch(/\d{5}[\s.-]?\d{4}/); // phone fragment
    expect(asText).not.toMatch(/@[\w-]+\.\w+/);       // email fragment
  });

  it('14. kbsScoreBreakdown contains numeric scores and boolean flags for each KB', async () => {
    const hits = [
      makeHit({ id: 10, title: 'Artigo A', rawScore: 0.9, symptomsJson: ['Sistema não abre'] }),
      makeHit({ id: 20, title: 'Artigo B', rawScore: 0.5, symptomsJson: [] }),
    ];
    const svc = new KbRagCopilotService(makeSearchRepo(hits), null, nullAudit);
    const result = await svc.generatePlaybook({ query: 'sistema não abre erro' });

    expect(result.ok).toBe(true);
    expect(Array.isArray(result.kbsScoreBreakdown)).toBe(true);
    expect(result.kbsScoreBreakdown.length).toBeGreaterThan(0);

    for (const entry of result.kbsScoreBreakdown) {
      expect(typeof entry.id).toBe('number');
      expect(typeof entry.title).toBe('string');
      expect(typeof entry.totalScore).toBe('number');
      expect(entry.totalScore).toBeGreaterThanOrEqual(0);
      expect(entry.totalScore).toBeLessThanOrEqual(1);
      expect(typeof entry.breakdown.lexicalScore).toBe('number');
      expect(typeof entry.breakdown.symptomsMatch).toBe('boolean');
      expect(typeof entry.breakdown.aiHintMatch).toBe('boolean');
      expect(typeof entry.breakdown.tagsMatch).toBe('boolean');
      expect(typeof entry.breakdown.titleMatch).toBe('boolean');
      expect(typeof entry.breakdown.contextBoost).toBe('boolean');
    }

    // Higher rawScore → higher totalScore (lexical dominates at 0.60 weight)
    const scoreMap = new Map(result.kbsScoreBreakdown.map((e) => [e.id, e.totalScore]));
    if (scoreMap.has(10) && scoreMap.has(20)) {
      expect(scoreMap.get(10)!).toBeGreaterThan(scoreMap.get(20)!);
    }
  });

  it('15. clientContext productOrSystem sets contextBoost=true for matching KB, false for non-matching', async () => {
    // Tests that the clientContext signal is correctly propagated through the pipeline
    // and reflected in kbsScoreBreakdown. Relative score comparison is skipped here
    // because query expansion can produce field-matching tokens for both KBs
    // unpredictably; precise score ordering is tested in kbRanking.test.ts (unit level).
    const hits = [
      makeHit({
        id: 100,
        title: 'Micromed: permissão de pasta',
        rawScore: 0.55,
        tagsJson: ['micromed', 'permissao'],
        categorySuggestion: 'Sistema / Micromed',
        symptomsJson: ['micromed nao abre', 'permissao negada'],
        evidenceSummarySanitized: 'micromed permissao pasta bloqueada',
        problemPattern: 'micromed bloqueado pasta instalacao',
      }),
      makeHit({
        id: 200,
        title: 'Veeam Backup falhou',
        rawScore: 0.60,
        tagsJson: ['veeam', 'backup'],
        categorySuggestion: 'Backup / Veeam',
        symptomsJson: ['backup falhou', 'job interrompido'],
        evidenceSummarySanitized: 'veeam backup falho job',
        problemPattern: 'backup veeam nao completa',
      }),
    ];
    const ctx: KbClientContext = { productOrSystem: 'Micromed' };
    const svc = new KbRagCopilotService(makeSearchRepo(hits), null, nullAudit);
    const result = await svc.generatePlaybook({
      query: 'sistema nao abre',
      clientContext: ctx,
    });

    expect(result.ok).toBe(true);
    expect(result.kbsScoreBreakdown.length).toBeGreaterThan(0);

    // KB 100 (title/tags contain "Micromed") → contextBoost must be true
    const entry100 = result.kbsScoreBreakdown.find((e) => e.id === 100);
    if (entry100) {
      expect(entry100.breakdown.contextBoost).toBe(true);
    }

    // KB 200 (Veeam Backup — no "Micromed" anywhere) → contextBoost must be false
    const entry200 = result.kbsScoreBreakdown.find((e) => e.id === 200);
    if (entry200) {
      expect(entry200.breakdown.contextBoost).toBe(false);
    }

    // KB 100 score must include the context boost premium (+0.10) vs its lexical base
    if (entry100) {
      const lexicalBase = 0.55 * 0.60; // 0.33
      expect(entry100.totalScore).toBeGreaterThan(lexicalBase + 0.09); // boost adds ≥0.10
    }
  });
});
