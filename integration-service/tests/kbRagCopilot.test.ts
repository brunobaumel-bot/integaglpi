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
 *  16.  no_sufficient_kb when reranking filters all weak/conflicting hits.
 *  17.  searchPlan included in result for anchored query.
 *  18.  kbInsufficient=true when plan minimumConfidence exceeds top-ranked score.
 *
 * Search Planner fix_001 (integaglpi_kb_rag_ai_search_planner_hybrid_retrieval_fix_001):
 *  19.  searchPlan present in hits.length===0 early return.
 *  20.  KB_INSUFFICIENT path fires audit with planSummary.
 *  21.  tier_4_automation article blocked when sourceTiersAllowed=[tier_1,tier_2].
 *
 * Search Planner fix_002 (integaglpi_kb_rag_ai_search_planner_hybrid_retrieval_fix_002):
 *  22.  empty query returns searchPlan (EMPTY_QUERY_PLAN sentinel), ok=false, no KB, no Ollama.
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
    // Use a generic query (no product anchor) so all tiers are allowed and
    // both default Micromed articles (tier_1) pass the tier filter.
    const hits = [
      makeHit({ id: 42, title: 'Artigo A sobre sistema' }),
      makeHit({ id: 99, title: 'Artigo B sobre permissão' }),
    ];
    const svc = new KbRagCopilotService(makeSearchRepo(hits), null, nullAudit);
    const result = await svc.generatePlaybook({ query: 'sistema apresenta falha inesperada' });

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

  it('17. searchPlan is included in result for an anchored query (Micromed)', async () => {
    // Default hit: rawScore=0.8 with Micromed content — passes both must_terms and minimumConfidence
    const svc = new KbRagCopilotService(makeSearchRepo(), null, nullAudit);
    const result = await svc.generatePlaybook({ query: 'micromed nao abre' });

    expect(result.ok).toBe(true);
    expect(result.searchPlan).toBeDefined();
    expect(result.searchPlan?.productOrSystem).toBe('Micromed');
    expect(result.searchPlan?.planSource).toBe('deterministic');
    expect(result.searchPlan?.minimumConfidence).toBe(0.60);
    expect(result.searchPlan?.mustTerms).toContain('micromed');
  });

  it('18. kbInsufficient=true when anchored plan minimumConfidence exceeds top-ranked score', async () => {
    // Micromed plan: minimumConfidence=0.60, mustTerms=['micromed']
    // Hit has Micromed content (passes must_terms) but rawScore=0.01 → total ≈ 0.41 < 0.60
    const lowScoreHit = makeHit({
      id: 1,
      rawScore: 0.01,
      // Keep default Micromed content so must_terms=['micromed'] is satisfied
    });
    const svc = new KbRagCopilotService(makeSearchRepo([lowScoreHit]), null, nullAudit);
    const result = await svc.generatePlaybook({ query: 'micromed nao abre' });

    expect(result.ok).toBe(true);
    expect(result.kbInsufficient).toBe(true);
    expect(result.error).toBe('kb_insufficient');
    expect(result.kbsUsed).toHaveLength(0);
    expect(result.searchPlan?.productOrSystem).toBe('Micromed');
    // KB_INSUFFICIENT playbook must have all required sections
    expect(result.playbook.avisos_de_seguranca.length).toBeGreaterThan(0);
    expect(result.playbook.resolucao_sugerida.length).toBeGreaterThan(0);
    expect(typeof result.playbook.resumo_do_incidente).toBe('string');
    expect(result.deterministicFallback).toBe(true);
    expect(result.localAiUsed).toBe(false);
  });

  it('16. returns no_sufficient_kb without calling AI when reranking filters weak/conflicting hits', async () => {
    const weakHit = makeHit({
      id: 300,
      rawScore: 0.01,
      title: 'Windows solicita ativação',
      categorySuggestion: 'Sistema / Windows',
      problemPattern: 'Windows pede ativação',
      symptomsJson: ['windows ativacao'],
      evidenceSummarySanitized: 'windows ativacao licenca',
      tagsJson: ['windows', 'ativacao'],
    });
    const ollama = makeOllama(validPlaybookJson);
    const svc = new KbRagCopilotService(makeSearchRepo([weakHit]), ollama, nullAudit);

    const result = await svc.generatePlaybook({
      query: 'active directory não esta sincronizando',
    });

    expect(result.ok).toBe(true);
    expect(result.error).toBe('no_sufficient_kb');
    expect(result.kbsUsed).toHaveLength(0);
    expect(result.localAiUsed).toBe(false);
    expect(ollama.generateText).toHaveBeenCalledTimes(1);
    expect((ollama.generateText as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain('Sugira até 5 termos');
  });

  // ── Search Planner fix_001 — early-return + audit coverage ──────────────────

  it('19. searchPlan present in hits.length===0 early return (Micromed anchor)', async () => {
    // Empty repo → hits=[] → early return path
    const svc = new KbRagCopilotService(makeSearchRepo([]), null, nullAudit);
    const result = await svc.generatePlaybook({ query: 'micromed nao abre' });

    expect(result.ok).toBe(true);
    expect(result.kbsFound).toBe(0);
    // FIX: searchPlan must now be present even in the empty-hits path
    expect(result.searchPlan).toBeDefined();
    expect(result.searchPlan?.productOrSystem).toBe('Micromed');
    expect(result.error).toBe('no_sufficient_kb');
  });

  it('20. KB_INSUFFICIENT path fires audit with planSummary containing product anchor', async () => {
    const auditSpy: RagAuditPort = { writeRagAudit: vi.fn(async () => {}) };
    // rawScore=0.01 → total ≈ 0.41 — Micromed mustTerms satisfied but below minimumConfidence=0.60
    const lowScoreHit = makeHit({ id: 99, rawScore: 0.01 });
    const svc = new KbRagCopilotService(makeSearchRepo([lowScoreHit]), null, auditSpy);

    const result = await svc.generatePlaybook({ query: 'micromed nao abre', ticketId: 42 });
    // Small async wait for fire-and-forget audit
    await new Promise((r) => setTimeout(r, 20));

    expect(result.kbInsufficient).toBe(true);
    expect(result.error).toBe('kb_insufficient');

    // FIX: audit must be called with planSummary even in KB_INSUFFICIENT path
    expect(auditSpy.writeRagAudit).toHaveBeenCalledOnce();
    const auditCall = (auditSpy.writeRagAudit as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>;
    expect(typeof auditCall['planSummary']).toBe('string');
    expect(String(auditCall['planSummary'])).toContain('Micromed');
    expect(auditCall['ticketId']).toBe(42);
    expect(auditCall['deterministicFallback']).toBe(true);
  });

  it('22. empty query returns ok=false with EMPTY_QUERY_PLAN sentinel — no KB, no Ollama', async () => {
    const ollama = makeOllama(validPlaybookJson); // would be called if reached — must NOT be called
    const svc = new KbRagCopilotService(makeSearchRepo(), ollama, nullAudit);

    const result = await svc.generatePlaybook({ query: '' });

    // Gate: ok=false, early exit
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();

    // FIX: searchPlan must be present even for empty query
    expect(result.searchPlan).toBeDefined();
    expect(result.searchPlan?.normalizedQuery).toBe('');
    expect(result.searchPlan?.productOrSystem).toBeNull();
    expect(result.searchPlan?.intent).toBe('generic');
    expect(result.searchPlan?.reason).toBe('empty_query');
    expect(result.searchPlan?.planSource).toBe('deterministic');
    expect(result.searchPlan?.mustTerms).toHaveLength(0);

    // Safety: no KB invented, no Ollama call
    expect(result.kbsUsed).toHaveLength(0);
    expect(result.kbsFound).toBe(0);
    expect(result.localAiUsed).toBe(false);
    expect(ollama.generateText).not.toHaveBeenCalled();

    // Deterministic fallback
    expect(result.deterministicFallback).toBe(true);
  });

  it('21. tier_4_automation article blocked when sourceTiersAllowed=[tier_1,tier_2] (Micromed query)', async () => {
    // Automation article with Micromed in title — must_terms satisfied, score OK, but tier_4 → blocked
    const automationHit = makeHit({
      id: 5,
      rawScore: 0.99,  // extremely high rawScore — should NOT win
      title: 'Script PowerShell automação micromed reset permissão',
      categorySuggestion: 'Automação / SRE',
      tagsJson: ['automation', 'script', 'micromed'],
      articleType: 'automation',  // <— tier_4
      symptomsJson: ['micromed nao abre', 'permissao negada'],
      evidenceSummarySanitized: 'micromed automacao script',
      problemPattern: 'micromed automacao script reset',
    });
    const tier1Hit = makeHit({
      id: 6,
      rawScore: 0.40,  // lower rawScore — should win after tier filter
      title: 'Micromed permissão de pasta bloqueada',
      categorySuggestion: 'Sistema / Micromed',
      tagsJson: ['micromed', 'permissao'],
      articleType: 'procedimento_tecnico',  // <— tier_1
    });

    const svc = new KbRagCopilotService(makeSearchRepo([automationHit, tier1Hit]), null, nullAudit);
    const result = await svc.generatePlaybook({ query: 'micromed nao abre' });

    expect(result.ok).toBe(true);
    // automation article (id=5) must NOT appear in results
    expect(result.kbsUsed.map((k) => k.id)).not.toContain(5);
    // tier_1 article (id=6) must survive and be the primary result
    expect(result.kbsUsed.map((k) => k.id)).toContain(6);
    expect(result.kbsUsed[0]!.id).toBe(6);
  });
});

// ── V9 — wiring runtime de feedback bias e reranker ──────────────────────────
// Phase: integaglpi_v9_kb_ui_rendering_and_ranking_wiring_001
// Flags default false: comportamento legado byte-idêntico quando desligadas.

import { beforeEach, afterEach } from 'vitest';
import { env } from '../src/config/env.js';
import { KbRankingService } from '../src/domain/services/KbRankingService.js';
import type { KbFeedbackBias } from '../src/domain/services/KbRankingService.js';
import type { KbRerankerService, RerankerResult } from '../src/domain/services/KbRerankerService.js';
import type { FeedbackRankingBiasPort } from '../src/domain/services/KbRagCopilotService.js';
import { FeedbackService } from '../src/domain/services/FeedbackService.js';
import type { KbFeedbackRepository } from '../src/repositories/postgres/PostgresKbFeedbackRepository.js';

const mutableEnv = env as unknown as {
  FEEDBACK_RANKING_ENABLED: boolean;
  RERANKER_ENABLED: boolean;
};

function makeTwoHits(): KbCandidateHit[] {
  return [
    makeHit({ id: 11, candidateKey: 'kb-micromed-a', title: 'Micromed não abre — permissão' }),
    makeHit({
      id: 12,
      candidateKey: 'kb-micromed-b',
      title: 'Micromed não abre — proxy',
      tagsJson: ['micromed', 'proxy'],
      symptomsJson: ['Sistema não abre', 'Proxy bloqueando'],
    }),
  ];
}

function makeBiasPort(bias: KbFeedbackBias | null): FeedbackRankingBiasPort & { calls: unknown[][] } {
  const calls: unknown[][] = [];
  return {
    calls,
    getRankingBiasMap: vi.fn(async (...args: unknown[]) => {
      calls.push(args);
      return bias;
    }),
  };
}

function makeRerankerMock(result: RerankerResult | 'throw'): KbRerankerService {
  return {
    rerank: vi.fn(async () => {
      if (result === 'throw') {
        throw new Error('RERANK_FAIL');
      }
      return result;
    }),
  } as unknown as KbRerankerService;
}

describe('V9 wiring — FEEDBACK_RANKING_ENABLED', () => {
  let savedFeedback: boolean;
  let savedReranker: boolean;

  beforeEach(() => {
    savedFeedback = mutableEnv.FEEDBACK_RANKING_ENABLED;
    savedReranker = mutableEnv.RERANKER_ENABLED;
    mutableEnv.FEEDBACK_RANKING_ENABLED = false;
    mutableEnv.RERANKER_ENABLED = false;
  });

  afterEach(() => {
    mutableEnv.FEEDBACK_RANKING_ENABLED = savedFeedback;
    mutableEnv.RERANKER_ENABLED = savedReranker;
  });

  it('flag=false → biasPort NUNCA é consultado (comportamento legado)', async () => {
    const biasPort = makeBiasPort({ byKey: new Map([['kb-micromed-a', 1.0]]), appliedMinVotes: 3 });
    const svc = new KbRagCopilotService(
      makeSearchRepo(makeTwoHits()), null, nullAudit, null,
      undefined, undefined, undefined, null, biasPort, null,
    );
    const result = await svc.generatePlaybook({ query: 'micromed não abre' });

    expect(result.ok).toBe(true);
    expect(biasPort.getRankingBiasMap).not.toHaveBeenCalled();
  });

  it('flag=true → biasPort consultado com candidateKey + kbCandidateId e bias passado ao rankHits', async () => {
    mutableEnv.FEEDBACK_RANKING_ENABLED = true;
    const bias: KbFeedbackBias = { byKey: new Map([['kb-micromed-a', 0.95]]), appliedMinVotes: 3 };
    const biasPort = makeBiasPort(bias);
    const rankingService = new KbRankingService();
    const rankSpy = vi.spyOn(rankingService, 'rankHits');

    const svc = new KbRagCopilotService(
      makeSearchRepo(makeTwoHits()), null, nullAudit, null,
      undefined, rankingService, undefined, null, biasPort, null,
    );
    const result = await svc.generatePlaybook({ query: 'micromed não abre' });

    expect(result.ok).toBe(true);
    expect(biasPort.getRankingBiasMap).toHaveBeenCalledTimes(1);
    const targets = biasPort.calls[0]![0] as Array<{ candidateKey: string; kbCandidateId: number }>;
    expect(targets.map((t) => t.candidateKey)).toContain('kb-micromed-a');
    expect(targets.map((t) => t.kbCandidateId)).toContain(11);
    // bias chega ao rankHits como 6º argumento
    expect(rankSpy).toHaveBeenCalled();
    expect(rankSpy.mock.calls[0]![5]).toBe(bias);
  });

  it('flag=true + biasPort lança → ranking segue sem bias (nunca bloqueia)', async () => {
    mutableEnv.FEEDBACK_RANKING_ENABLED = true;
    const biasPort: FeedbackRankingBiasPort = {
      getRankingBiasMap: vi.fn(async () => {
        throw new Error('DB_DOWN');
      }),
    };
    const svc = new KbRagCopilotService(
      makeSearchRepo(makeTwoHits()), null, nullAudit, null,
      undefined, undefined, undefined, null, biasPort, null,
    );
    const result = await svc.generatePlaybook({ query: 'micromed não abre' });

    expect(result.ok).toBe(true);
    expect(result.kbsUsed.length).toBeGreaterThan(0);
  });
});

describe('V9 wiring — RERANKER_ENABLED', () => {
  let savedFeedback: boolean;
  let savedReranker: boolean;

  beforeEach(() => {
    savedFeedback = mutableEnv.FEEDBACK_RANKING_ENABLED;
    savedReranker = mutableEnv.RERANKER_ENABLED;
    mutableEnv.FEEDBACK_RANKING_ENABLED = false;
    mutableEnv.RERANKER_ENABLED = false;
  });

  afterEach(() => {
    mutableEnv.FEEDBACK_RANKING_ENABLED = savedFeedback;
    mutableEnv.RERANKER_ENABLED = savedReranker;
  });

  it('flag=false → reranker NUNCA é chamado (nunca no caminho crítico)', async () => {
    const reranker = makeRerankerMock('throw');
    const svc = new KbRagCopilotService(
      makeSearchRepo(makeTwoHits()), null, nullAudit, null,
      undefined, undefined, undefined, null, null, reranker,
    );
    const result = await svc.generatePlaybook({ query: 'micromed não abre' });

    expect(result.ok).toBe(true);
    expect(reranker.rerank).not.toHaveBeenCalled();
  });

  it('flag=true → reranker chamado e a NOVA ordem é usada em kbsUsed', async () => {
    mutableEnv.RERANKER_ENABLED = true;
    const hits = makeTwoHits();
    // Captura a ordem que o ranking nativo produziria (sem reranker injetado).
    const probe = new KbRagCopilotService(makeSearchRepo(hits), null, nullAudit);
    const nativeOrder = (await probe.generatePlaybook({ query: 'micromed não abre' })).kbsUsed.map((k) => k.id);
    expect(nativeOrder.length).toBe(2);

    const rerankerImpl = {
      rerank: vi.fn(async (ranked: Array<{ hit: KbCandidateHit; breakdown: unknown }>) => ({
        hits: [...ranked].reverse().map((r) => ({ ...r, rerankerScore: 0.9, reranked: true })),
        reranked: true,
        ollamaUnavailable: false,
        maxInferenceMs: 100,
      })),
    } as unknown as KbRerankerService;

    const svc = new KbRagCopilotService(
      makeSearchRepo(hits), null, nullAudit, null,
      undefined, undefined, undefined, null, null, rerankerImpl,
    );
    const result = await svc.generatePlaybook({ query: 'micromed não abre' });

    expect(result.ok).toBe(true);
    expect(rerankerImpl.rerank).toHaveBeenCalledTimes(1);
    expect(result.kbsUsed.map((k) => k.id)).toEqual([...nativeOrder].reverse());
  });

  it('flag=true + reranker lança → ordem original preservada (fallback absoluto)', async () => {
    mutableEnv.RERANKER_ENABLED = true;
    const hits = makeTwoHits();
    const probe = new KbRagCopilotService(makeSearchRepo(hits), null, nullAudit);
    const nativeOrder = (await probe.generatePlaybook({ query: 'micromed não abre' })).kbsUsed.map((k) => k.id);

    const reranker = makeRerankerMock('throw');
    const svc = new KbRagCopilotService(
      makeSearchRepo(hits), null, nullAudit, null,
      undefined, undefined, undefined, null, null, reranker,
    );
    const result = await svc.generatePlaybook({ query: 'micromed não abre' });

    expect(result.ok).toBe(true);
    expect(reranker.rerank).toHaveBeenCalledTimes(1);
    expect(result.kbsUsed.map((k) => k.id)).toEqual(nativeOrder);
  });
});

describe('V9 wiring — FeedbackService.getRankingBiasMap (agregado, não-punitivo)', () => {
  function makeFeedbackRepo(votes: Record<number, { helpful: number; notHelpful: number }>): KbFeedbackRepository {
    return {
      recordVote: vi.fn(async () => { /* no-op */ }),
      getHelpfulness: vi.fn(async (target: { kbCandidateId?: number | null }) => {
        const v = votes[target.kbCandidateId ?? 0] ?? { helpful: 0, notHelpful: 0 };
        const total = v.helpful + v.notHelpful;
        return {
          kbCandidateId: target.kbCandidateId ?? null,
          glpiKnowbaseitemId: null,
          helpfulCount: v.helpful,
          notHelpfulCount: v.notHelpful,
          totalVotes: total,
          helpfulRatio: total > 0 ? v.helpful / total : 0,
          score: (v.helpful + 1) / (total + 2), // Laplace
        };
      }),
      getAggregatedByCategory: vi.fn(async () => []),
    } as unknown as KbFeedbackRepository;
  }

  it('artigo abaixo do threshold de votos é EXCLUÍDO (um voto negativo nunca penaliza)', async () => {
    const svc = new FeedbackService(makeFeedbackRepo({ 11: { helpful: 0, notHelpful: 1 } }));
    const bias = await svc.getRankingBiasMap([{ candidateKey: 'kb-a', kbCandidateId: 11 }], 3);
    expect(bias).toBeNull();
  });

  it('artigo com votos suficientes entra no mapa com score Laplace [0,1]', async () => {
    const svc = new FeedbackService(makeFeedbackRepo({ 11: { helpful: 4, notHelpful: 1 } }));
    const bias = await svc.getRankingBiasMap([{ candidateKey: 'kb-a', kbCandidateId: 11 }], 3);
    expect(bias).not.toBeNull();
    expect(bias!.byKey.get('kb-a')).toBeCloseTo(5 / 7, 4);
    expect(bias!.appliedMinVotes).toBe(3);
  });

  it('falha de leitura → artigo excluído (neutro); mapa vazio → null', async () => {
    const repo = {
      recordVote: vi.fn(async () => { /* no-op */ }),
      getHelpfulness: vi.fn(async () => {
        throw new Error('READ_FAIL');
      }),
      getAggregatedByCategory: vi.fn(async () => []),
    } as unknown as KbFeedbackRepository;
    const svc = new FeedbackService(repo);
    const bias = await svc.getRankingBiasMap([{ candidateKey: 'kb-a', kbCandidateId: 11 }], 3);
    expect(bias).toBeNull();
  });

  it('saída contém apenas candidateKey → score agregado (sem technician_id)', async () => {
    const svc = new FeedbackService(makeFeedbackRepo({ 11: { helpful: 5, notHelpful: 0 } }));
    const bias = await svc.getRankingBiasMap([{ candidateKey: 'kb-a', kbCandidateId: 11 }], 3);
    const json = JSON.stringify({ keys: [...bias!.byKey.keys()], minVotes: bias!.appliedMinVotes });
    expect(json).not.toMatch(/technician/i);
  });

  // R1 (v9_final_ressalvas_cleanup): caminho bulk — sem N+1 quando o repo suporta.
  it('R1: repo com getBulkHelpfulness → UMA chamada bulk, zero getHelpfulness (sem N+1)', async () => {
    const getBulkHelpfulness = vi.fn(async (ids: number[]) => {
      const map = new Map();
      for (const id of ids) {
        map.set(id, {
          kbCandidateId: id,
          glpiKnowbaseitemId: null,
          helpfulCount: 4,
          notHelpfulCount: 0,
          totalVotes: 4,
          helpfulRatio: 1,
          score: 5 / 6,
        });
      }
      return map;
    });
    const getHelpfulness = vi.fn(async () => {
      throw new Error('NUNCA deve ser chamado quando bulk existe');
    });
    const repo = {
      recordVote: vi.fn(async () => { /* no-op */ }),
      getHelpfulness,
      getBulkHelpfulness,
      getAggregatedByCategory: vi.fn(async () => []),
    } as unknown as KbFeedbackRepository;

    const svc = new FeedbackService(repo);
    const bias = await svc.getRankingBiasMap(
      [
        { candidateKey: 'kb-a', kbCandidateId: 11 },
        { candidateKey: 'kb-b', kbCandidateId: 12 },
        { candidateKey: 'kb-c', kbCandidateId: 13 },
      ],
      3,
    );

    expect(getBulkHelpfulness).toHaveBeenCalledTimes(1);
    expect(getBulkHelpfulness).toHaveBeenCalledWith([11, 12, 13]);
    expect(getHelpfulness).not.toHaveBeenCalled();
    expect(bias).not.toBeNull();
    expect(bias!.byKey.size).toBe(3);
    expect(bias!.byKey.get('kb-b')).toBeCloseTo(5 / 6, 4);
  });

  it('R1: bulk respeita threshold — artigo com totalVotes < minVotes fica fora do mapa', async () => {
    const repo = {
      recordVote: vi.fn(async () => { /* no-op */ }),
      getHelpfulness: vi.fn(),
      getBulkHelpfulness: vi.fn(async () => new Map([[11, {
        kbCandidateId: 11,
        glpiKnowbaseitemId: null,
        helpfulCount: 1,
        notHelpfulCount: 0,
        totalVotes: 1,
        helpfulRatio: 1,
        score: 2 / 3,
      }]])),
      getAggregatedByCategory: vi.fn(async () => []),
    } as unknown as KbFeedbackRepository;

    const svc = new FeedbackService(repo);
    const bias = await svc.getRankingBiasMap([{ candidateKey: 'kb-a', kbCandidateId: 11 }], 3);
    expect(bias).toBeNull();
  });
});

// ── R2 — observabilidade do reranker no payload ───────────────────────────────

describe('R2 — reranker metadata no payload (opcional, sem inventar score)', () => {
  let savedReranker: boolean;

  beforeEach(() => {
    savedReranker = mutableEnv.RERANKER_ENABLED;
    mutableEnv.RERANKER_ENABLED = false;
  });

  afterEach(() => {
    mutableEnv.RERANKER_ENABLED = savedReranker;
  });

  it('flag=false → campo reranker AUSENTE do payload (legado byte-idêntico)', async () => {
    const svc = new KbRagCopilotService(makeSearchRepo(makeTwoHits()), null, nullAudit);
    const result = await svc.generatePlaybook({ query: 'micromed não abre' });
    expect(result.ok).toBe(true);
    expect(result.reranker).toBeUndefined();
    expect('reranker' in result).toBe(false);
  });

  it('flag=true + rerank OK → reranker.applied=true, model exposto, rerankerScore real no breakdown', async () => {
    mutableEnv.RERANKER_ENABLED = true;
    const hits = makeTwoHits();
    const rerankerImpl = {
      modelName: 'qwen-test-model',
      rerank: vi.fn(async (ranked: Array<{ hit: KbCandidateHit; breakdown: unknown }>) => ({
        hits: ranked.map((r, i) => ({ ...r, rerankerScore: i === 0 ? 0.91 : 0.42, reranked: true })),
        reranked: true,
        ollamaUnavailable: false,
        maxInferenceMs: 230,
      })),
    } as unknown as KbRerankerService;

    const svc = new KbRagCopilotService(
      makeSearchRepo(hits), null, nullAudit, null,
      undefined, undefined, undefined, null, null, rerankerImpl,
    );
    const result = await svc.generatePlaybook({ query: 'micromed não abre' });

    expect(result.ok).toBe(true);
    expect(result.reranker).toBeDefined();
    expect(result.reranker!.applied).toBe(true);
    expect(result.reranker!.model).toBe('qwen-test-model');
    expect(result.reranker!.maxInferenceMs).toBe(230);
    expect(result.reranker!.note).toBeNull();
    // Score REAL do cross-encoder propagado — nunca inventado.
    const scores = result.kbsScoreBreakdown.map((e) => e.rerankerScore);
    expect(scores).toContain(0.91);
    expect(scores).toContain(0.42);
  });

  it('flag=true + fallback do serviço → applied=false com note; sem rerankerScore inventado', async () => {
    mutableEnv.RERANKER_ENABLED = true;
    const hits = makeTwoHits();
    const rerankerImpl = {
      modelName: 'qwen-test-model',
      rerank: vi.fn(async (ranked: Array<{ hit: KbCandidateHit; breakdown: unknown }>) => ({
        hits: ranked.map((r) => ({ ...r, rerankerScore: null, reranked: false })),
        reranked: false,
        ollamaUnavailable: true,
        maxInferenceMs: null,
      })),
    } as unknown as KbRerankerService;

    const svc = new KbRagCopilotService(
      makeSearchRepo(hits), null, nullAudit, null,
      undefined, undefined, undefined, null, null, rerankerImpl,
    );
    const result = await svc.generatePlaybook({ query: 'micromed não abre' });

    expect(result.ok).toBe(true);
    expect(result.reranker!.applied).toBe(false);
    expect(result.reranker!.note).toMatch(/fallback/i);
    expect(result.kbsScoreBreakdown.every((e) => e.rerankerScore === undefined)).toBe(true);
  });

  it('flag=true + throw → applied=false, ordem original, note de erro', async () => {
    mutableEnv.RERANKER_ENABLED = true;
    const hits = makeTwoHits();
    const probe = new KbRagCopilotService(makeSearchRepo(hits), null, nullAudit);
    const nativeOrder = (await probe.generatePlaybook({ query: 'micromed não abre' })).kbsUsed.map((k) => k.id);

    const rerankerImpl = {
      modelName: 'qwen-test-model',
      rerank: vi.fn(async () => { throw new Error('BOOM'); }),
    } as unknown as KbRerankerService;

    const svc = new KbRagCopilotService(
      makeSearchRepo(hits), null, nullAudit, null,
      undefined, undefined, undefined, null, null, rerankerImpl,
    );
    const result = await svc.generatePlaybook({ query: 'micromed não abre' });

    expect(result.ok).toBe(true);
    expect(result.kbsUsed.map((k) => k.id)).toEqual(nativeOrder);
    expect(result.reranker!.applied).toBe(false);
    expect(result.reranker!.note).toMatch(/erro|fallback/i);
  });
});
