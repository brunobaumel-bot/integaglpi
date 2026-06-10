/**
 * KbEnrichmentService — F5 (draft enriquecido) + F6 (gap analysis)
 * Phase: integaglpi_v9_kb_enrichment_and_search_optimization_001
 *
 * Também cobre os casos anti-falso-positivo obrigatórios da fase (F2) via
 * SearchPlanner + Ranking, e o bloqueio de external_research na busca local.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  KbEnrichmentService,
  INFO_UNAVAILABLE,
  GAP_MIN_OCCURRENCES,
} from '../src/domain/services/KbEnrichmentService.js';
import { KbSearchPlannerService } from '../src/domain/services/KbSearchPlannerService.js';
import { KbRankingService } from '../src/domain/services/KbRankingService.js';
import type { KbCandidateHit } from '../src/repositories/postgres/PostgresKbCandidateSearchRepository.js';
import { env } from '../src/config/env.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const mutableEnv = env as unknown as {
  KB_ENRICHMENT_ENABLED: boolean;
  KB_GAP_ANALYSIS_ENABLED: boolean;
};

function makeHit(overrides: Partial<KbCandidateHit> = {}): KbCandidateHit {
  return {
    id: 11,
    candidateKey: 'kb-legacy-011',
    title: 'Synology — restaurar arquivo do backup',
    articleType: 'procedimento_tecnico',
    categorySuggestion: 'Backup',
    problemPattern: 'usuario precisa restaurar arquivo apagado do NAS',
    symptomsJson: ['Arquivo apagado', 'Versão anterior necessária'],
    probableCause: 'Exclusão acidental',
    recommendedProcedureJson: ['Abrir Hyper Backup', 'Selecionar versão', 'Restaurar arquivo'],
    checklistJson: ['Arquivo restaurado e acessível'],
    tagsJson: ['synology', 'backup', 'restore'],
    evidenceSummarySanitized: 'Procedimento validado em incidentes anteriores.',
    confidenceScore: 80,
    rawScore: 0.7,
    ...overrides,
  };
}

// ── F5: draft enriquecido ─────────────────────────────────────────────────────

describe('KbEnrichmentService — F5 draft enriquecido', () => {
  let flagBackup: boolean;

  beforeEach(() => {
    flagBackup = mutableEnv.KB_ENRICHMENT_ENABLED;
    mutableEnv.KB_ENRICHMENT_ENABLED = false;
  });

  afterEach(() => {
    mutableEnv.KB_ENRICHMENT_ENABLED = flagBackup;
  });

  it('detecta lacunas estruturais do KB legado', () => {
    const svc = new KbEnrichmentService();
    const gaps = svc.detectGaps(makeHit({ symptomsJson: [], tagsJson: [] }));
    expect(gaps).toContain('symptoms');
    expect(gaps).toContain('tags');
    expect(gaps).toContain('triage_questions');
    expect(gaps).toContain('rollback_or_safe_exit');
  });

  it('draft contém TODOS os campos estruturados do contrato', async () => {
    const svc = new KbEnrichmentService();
    const result = await svc.buildEnrichedDraft(makeHit());
    const required = [
      'title', 'slug', 'product_or_system', 'source_tier', 'category', 'aliases',
      'symptoms', 'tags', 'ai_hint', 'context', 'triage_questions', 'incident_tree',
      'commands_or_checks', 'likely_causes', 'resolution_steps', 'validation_steps',
      'rollback_or_safe_exit', 'escalation_when', 'prevention',
      'known_false_positives', 'forbidden_terms', 'confidence_notes',
      'human_review_required',
    ];
    for (const field of required) {
      expect(result.draft, field).toHaveProperty(field);
    }
  });

  it('original é preservado (snapshot intacto + flags literais)', async () => {
    const hit = makeHit();
    const svc = new KbEnrichmentService();
    const result = await svc.buildEnrichedDraft(hit);
    expect(result.original_preserved).toBe(true);
    expect(result.auto_publish).toBe(false);
    expect(result.draft.human_review_required).toBe(true);
    expect(result.original_snapshot.title).toBe(hit.title);
    expect(result.original_snapshot.procedure).toEqual(hit.recommendedProcedureJson);
    expect(result.source_kb_id).toBe(hit.id);
  });

  it('gera original_hash e enriched_hash distintos para diff', async () => {
    const svc = new KbEnrichmentService();
    const result = await svc.buildEnrichedDraft(makeHit());
    expect(result.original_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.enriched_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.original_hash).not.toBe(result.enriched_hash);
    expect(result.enrichment_version).toBe(1);
  });

  it('campos sem evidência recebem INFORMACAO_INDISPONIVEL — nunca inventa', async () => {
    const svc = new KbEnrichmentService();
    const result = await svc.buildEnrichedDraft(makeHit());
    expect(result.draft.triage_questions).toEqual([INFO_UNAVAILABLE]);
    expect(result.draft.rollback_or_safe_exit).toEqual([INFO_UNAVAILABLE]);
    expect(result.draft.prevention).toEqual([INFO_UNAVAILABLE]);
  });

  it('flag off → não chama Ollama (draft determinístico, status needs_review)', async () => {
    const ollama = { generateText: vi.fn() };
    const svc = new KbEnrichmentService(ollama);
    const result = await svc.buildEnrichedDraft(makeHit());
    expect(ollama.generateText).not.toHaveBeenCalled();
    expect(result.status).toBe('needs_review');
  });

  it('flag on + Ollama → complementa campos e marca ready_for_human_review', async () => {
    mutableEnv.KB_ENRICHMENT_ENABLED = true;
    const ollama = {
      generateText: vi.fn().mockResolvedValue(JSON.stringify({
        aliases: ['hyper backup', 'nas synology'],
        triage_questions: ['Qual a data da versão a restaurar?'],
        incident_tree: ['Arquivo apagado → verificar lixeira → restaurar do backup'],
        rollback_or_safe_exit: ['Restaurar para pasta alternativa primeiro'],
        escalation_when: ['Backup corrompido'],
        prevention: ['Habilitar versionamento'],
        known_false_positives: ['Arquivo movido, não apagado'],
      })),
    };
    const svc = new KbEnrichmentService(ollama);
    const result = await svc.buildEnrichedDraft(makeHit());
    expect(result.status).toBe('ready_for_human_review');
    expect(result.draft.aliases).toContain('hyper backup');
    expect(result.draft.human_review_required).toBe(true);
  });

  it('persistDraft (gate histórico) ainda documenta a proposta de schema', () => {
    const svc = new KbEnrichmentService();
    const r = svc.persistDraft();
    expect(r.status).toBe('BLOCK_SCHEMA_REQUIRED');
    expect(r.migration_proposal.join('\n')).toContain('source_kb_id');
  });
});

// ── F5: aplicação real autorizada (migration 052) ────────────────────────────

describe('KbEnrichmentService — F5 aplicação autorizada', () => {
  let flagBackup: boolean;

  beforeEach(() => {
    flagBackup = mutableEnv.KB_ENRICHMENT_ENABLED;
    mutableEnv.KB_ENRICHMENT_ENABLED = true;
  });

  afterEach(() => {
    mutableEnv.KB_ENRICHMENT_ENABLED = flagBackup;
  });

  function makeRepoMock() {
    return {
      listCandidatesForEnrichment: vi.fn().mockResolvedValue([makeHit()]),
      applyEnrichedContent: vi.fn().mockResolvedValue(true),
      rollbackEnrichment: vi.fn().mockResolvedValue(true),
      getContentMarkdown: vi.fn().mockResolvedValue('# original markdown'),
      insertGapCandidate: vi.fn().mockResolvedValue(true),
      searchCandidates: vi.fn(),
    };
  }

  it('migration 052 existe, é aditiva e usa NOT VALID no CHECK (boot seguro)', async () => {
    const sql = await readFile(
      resolve(repoRoot, 'integration-service/schema-migrations/052_kb_candidates_enrichment_traceability.sql'),
      'utf8',
    );
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS source_kb_id');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS original_hash');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS enriched_hash');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS structured_draft_json');
    expect(sql).toContain('NOT VALID');
    // Statements destrutivos (início de linha) — comentários de contrato permitidos.
    expect(sql).not.toMatch(/^\s*(DROP TABLE|TRUNCATE|DELETE\s+FROM)/im);
    expect(sql).not.toMatch(/glpi_tickets|glpi_users|glpi_knowbaseitems/);
  });

  it('flag off → applyEnrichment bloqueado (nada gravado)', async () => {
    mutableEnv.KB_ENRICHMENT_ENABLED = false;
    const repo = makeRepoMock();
    const svc = new KbEnrichmentService();
    const hit = makeHit();
    const result = await svc.buildEnrichedDraft(hit);
    const outcome = await svc.applyEnrichment(repo as never, hit, result);
    expect(outcome.ok).toBe(false);
    expect(repo.applyEnrichedContent).not.toHaveBeenCalled();
  });

  it('applyEnrichment grava com backup completo do original (rollback possível)', async () => {
    const repo = makeRepoMock();
    const svc = new KbEnrichmentService();
    const hit = makeHit();
    const result = await svc.buildEnrichedDraft(hit);
    const outcome = await svc.applyEnrichment(repo as never, hit, result);
    expect(outcome.ok).toBe(true);
    const input = repo.applyEnrichedContent.mock.calls[0]![0] as Record<string, unknown>;
    const backup = input['originalBackup'] as Record<string, unknown>;
    expect(backup['title']).toBe(hit.title);
    expect(backup['procedure']).toEqual(hit.recommendedProcedureJson);
    expect(backup['content_markdown']).toBe('# original markdown');
    expect(input['originalHash']).toBe(result.original_hash);
    expect(input['enrichmentVersion']).toBe(1);
  });

  it('INFORMACAO_INDISPONIVEL nunca sobrescreve conteúdo original existente', async () => {
    const repo = makeRepoMock();
    const svc = new KbEnrichmentService(); // sem Ollama → campos novos = INDISPONIVEL
    const hit = makeHit();
    const result = await svc.buildEnrichedDraft(hit);
    await svc.applyEnrichment(repo as never, hit, result);
    const input = repo.applyEnrichedContent.mock.calls[0]![0] as Record<string, unknown>;
    // symptoms/procedure/checklist preservados do original (draft tinha conteúdo real do hit).
    expect(input['symptoms']).toEqual(hit.symptomsJson);
    expect(input['procedure']).toEqual(hit.recommendedProcedureJson);
  });

  it('enrichAndApplyBatch SEM contribuição de IA pula o apply (preserva elegibilidade)', async () => {
    const repo = makeRepoMock();
    const svc = new KbEnrichmentService(); // sem Ollama → ai_enriched=false
    const summary = await svc.enrichAndApplyBatch(repo as never, 5);
    expect(summary.processed).toBe(1);
    expect(summary.applied).toBe(0);
    expect(repo.applyEnrichedContent).not.toHaveBeenCalled();
    expect(summary.items[0]!.error).toContain('ollama_indisponivel');
  });

  it('enrichAndApplyBatch com allowDeterministic aplica mesmo sem IA', async () => {
    const repo = makeRepoMock();
    const svc = new KbEnrichmentService();
    const summary = await svc.enrichAndApplyBatch(repo as never, 5, { allowDeterministic: true });
    expect(repo.listCandidatesForEnrichment).toHaveBeenCalledWith(5, 0);
    expect(summary.processed).toBe(1);
    expect(summary.applied).toBe(1);
    expect(summary.items[0]).toMatchObject({ ok: true });
  });

  it('com IA respondendo, ai_enriched=true e o apply procede', async () => {
    const repo = makeRepoMock();
    const ollama = {
      generateText: vi.fn().mockResolvedValue(JSON.stringify({
        symptoms: ['Sintoma expandido pela IA'],
        likely_causes: ['Causa detalhada'],
        resolution_steps: ['1. Passo melhorado'],
      })),
    };
    const svc = new KbEnrichmentService(ollama);
    const summary = await svc.enrichAndApplyBatch(repo as never, 5);
    expect(summary.applied).toBe(1);
    const input = repo.applyEnrichedContent.mock.calls[0]![0] as Record<string, unknown>;
    expect(input['symptoms']).toEqual(['Sintoma expandido pela IA']);
  });

  it('persistGapCandidates insere draft_gap_candidate idempotente', async () => {
    mutableEnv.KB_GAP_ANALYSIS_ENABLED = true;
    const executor = {
      query: vi.fn().mockResolvedValue({
        rows: [{ pattern: 'Micromed:application_not_opening:deterministic', occurrences: '5', first_seen: '2026-06-01', last_seen: '2026-06-09' }],
      }),
    };
    const repo = makeRepoMock();
    const svc = new KbEnrichmentService(null, executor as never);
    const result = await svc.persistGapCandidates(repo as never, 30);
    expect(result.detected).toBe(1);
    expect(result.inserted).toBe(1);
    const arg = repo.insertGapCandidate.mock.calls[0]![0] as Record<string, unknown>;
    expect(String(arg['candidateKey'])).toMatch(/^gap-[a-f0-9]{24}$/);
    mutableEnv.KB_GAP_ANALYSIS_ENABLED = false;
  });

  it('repositório: UPDATE em linha única, rollback usa original_backup, gap insert é ON CONFLICT DO NOTHING', async () => {
    const repoSrc = await readFile(
      resolve(repoRoot, 'integration-service/src/repositories/postgres/PostgresKbCandidateSearchRepository.ts'),
      'utf8',
    );
    expect(repoSrc).toContain('WHERE id = $1');
    expect(repoSrc).toContain("structured_draft_json ? 'original_backup'");
    expect(repoSrc).toContain('ON CONFLICT (candidate_key) DO NOTHING');
    expect(repoSrc).toContain('enrichment_version IS NULL');
    expect(repoSrc).not.toMatch(/DELETE\s+FROM/i);
  });
});

// ── F6: gap analysis ──────────────────────────────────────────────────────────

describe('KbEnrichmentService — F6 gap analysis', () => {
  let flagBackup: boolean;

  beforeEach(() => {
    flagBackup = mutableEnv.KB_GAP_ANALYSIS_ENABLED;
    mutableEnv.KB_GAP_ANALYSIS_ENABLED = true;
  });

  afterEach(() => {
    mutableEnv.KB_GAP_ANALYSIS_ENABLED = flagBackup;
  });

  it('threshold mínimo é 3 ocorrências (no SQL HAVING)', () => {
    expect(GAP_MIN_OCCURRENCES).toBe(3);
  });

  it('flag off → lista vazia sem query', async () => {
    mutableEnv.KB_GAP_ANALYSIS_ENABLED = false;
    const executor = { query: vi.fn() };
    const svc = new KbEnrichmentService(null, executor as never);
    const gaps = await svc.detectRecurringGaps(30);
    expect(gaps).toEqual([]);
    expect(executor.query).not.toHaveBeenCalled();
  });

  it('padrões generic são descartados (query genérica/teste não vira lacuna)', async () => {
    const executor = {
      query: vi.fn().mockResolvedValue({
        rows: [
          { pattern: 'generic:generic:deterministic', occurrences: '9', first_seen: '2026-06-01', last_seen: '2026-06-09' },
          { pattern: 'Micromed:application_not_opening:deterministic', occurrences: '4', first_seen: '2026-06-01', last_seen: '2026-06-09' },
        ],
      }),
    };
    const svc = new KbEnrichmentService(null, executor as never);
    const gaps = await svc.detectRecurringGaps(30);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]!.pattern).toContain('Micromed');
    expect(gaps[0]!.status).toBe('draft_gap_candidate');
    expect(gaps[0]!.human_review_required).toBe(true);
    expect(gaps[0]!.auto_publish).toBe(false);
  });

  it('SQL aplica HAVING COUNT >= 3 e nunca lê query bruta', async () => {
    const executor = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    const svc = new KbEnrichmentService(null, executor as never);
    await svc.detectRecurringGaps(30);
    const sql = String(executor.query.mock.calls[0]?.[0] ?? '');
    expect(sql).toContain('HAVING COUNT(*) >= $2');
    expect(sql).toContain("plan_summary");
    expect(sql).not.toContain('raw_query');
    const params = executor.query.mock.calls[0]?.[1] as unknown[];
    expect(params?.[1]).toBe(GAP_MIN_OCCURRENCES);
  });
});

// ── F2: anti-falso-positivo obrigatórios (planner + ranking) ─────────────────

describe('F2 — casos obrigatórios de busca local', () => {
  const planner = new KbSearchPlannerService(null);
  const ranking = new KbRankingService();

  const windowsActivationHit = makeHit({
    id: 90,
    title: 'Windows pedindo ativação — slmgr',
    tagsJson: ['windows', 'ativacao', 'slmgr', 'licenca'],
    problemPattern: 'windows exibe marca dagua de ativacao',
    categorySuggestion: 'Licenciamento',
  });

  it('micromed não abre → plano ancorado em Micromed; ativação Windows excluída', async () => {
    const plan = await planner.buildPlan('meu micromed nao esta abrindo', null);
    expect(String(plan.productOrSystem ?? '').toLowerCase()).toContain('micromed');
    expect(plan.intent).toBe('application_not_opening');
    const ranked = ranking.rankHits(
      [windowsActivationHit],
      ['micromed', 'abrindo'],
      null,
      5,
      plan,
    );
    expect(ranked.every((r) => !/slmgr|ativa/i.test(r.hit.title))).toBe(true);
  });

  it('AD sync → plano de identidade; Micromed não aparece', async () => {
    const plan = await planner.buildPlan('active directory não esta sincronizando', null);
    expect(plan.intent).toBe('identity_sync');
    const micromedHit = makeHit({ id: 91, title: 'Micromed não abre', tagsJson: ['micromed'] });
    const ranked = ranking.rankHits([micromedHit], ['active', 'directory', 'sincronizando'], null, 5, plan);
    expect(ranked.every((r) => !/micromed/i.test(r.hit.title))).toBe(true);
  });

  it('synology restore → KB específica vence playbook genérico', async () => {
    const plan = await planner.buildPlan('restaurar arquivo do backup synology', null);
    const specific = makeHit(); // Synology específica (tier via tags)
    const generic = makeHit({
      id: 92,
      title: 'Playbook genérico de troubleshooting',
      tagsJson: ['generico'],
      problemPattern: 'roteiro generico de diagnostico',
      categorySuggestion: 'Geral',
    });
    const ranked = ranking.rankHits([generic, specific], ['restaurar', 'arquivo', 'backup', 'synology'], null, 5, plan);
    expect(ranked.length).toBeGreaterThan(0);
    expect(ranked[0]!.hit.title).toContain('Synology');
  });
});

// ── Invariantes estáticos transversais ────────────────────────────────────────

describe('F-KB-OPT — invariantes estáticos', () => {
  it('busca local exclui external_research/cloud e gap drafts', async () => {
    const repo = await readFile(
      resolve(repoRoot, 'integration-service/src/repositories/postgres/PostgresKbCandidateSearchRepository.ts'),
      'utf8',
    );
    expect(repo).toContain("NOT IN ('external_research', 'cloud_preview', 'external_ai')");
    expect(repo).toContain('draft_gap_candidate');
  });

  it('pesquisa externa PHP: contexto estruturado + circuit breaker 8s + consentimento preservado', async () => {
    const php = await readFile(resolve(repoRoot, 'integaglpi/src/Service/ExternalResearchService.php'), 'utf8');
    const smartHelp = await readFile(resolve(repoRoot, 'integaglpi/src/Service/SmartHelpService.php'), 'utf8');
    expect(php).toContain('buildStructuredCloudContext');
    expect(php).toContain('KBs locais consultadas sem resultado');
    expect(php).toContain('postProcessCloudResponse');
    expect(php).toContain('CLOUD_POST_PROCESSING_ENABLED');
    // Hardening preservado: ExternalResearchService NÃO executa HTTP direto;
    // o circuit breaker de 8s vive no SmartHelpService (delegação).
    expect(php).not.toContain('curl_exec');
    expect(php).toContain('polishCloudTextLocally');
    expect(smartHelp).toContain('public function polishCloudTextLocally');
    expect(smartHelp).toMatch(/polishCloudTextLocally[\s\S]{0,600}\], 8\)/);
    // Consentimento e PII Guard continuam no fluxo cloud.
    expect(php).toContain('containsSensitiveData');
    expect(php).toContain('EXTERNAL_RESEARCH_BLOCKED_PII');
    expect(php).toContain("'auto_publish' => false");
  });

  it('SmartHelp PHP: RAG por problema + perfis estruturados F1', async () => {
    const php = await readFile(resolve(repoRoot, 'integaglpi/src/Service/SmartHelpService.php'), 'utf8');
    expect(php).toContain('buildProblemProfiles');
    expect(php).toContain("'query_para_busca'");
    expect(php).toContain('ragPerProblem');
    expect(php).toContain("'problem_index'");
  });

  it('flags novas tipadas com default false em env.ts', async () => {
    const envSrc = await readFile(resolve(repoRoot, 'integration-service/src/config/env.ts'), 'utf8');
    for (const flag of ['KB_ENRICHMENT_ENABLED', 'CUSTOM_RESPONSE_ENABLED', 'KB_GAP_ANALYSIS_ENABLED', 'CLOUD_POST_PROCESSING_ENABLED']) {
      const idx = envSrc.indexOf(`${flag}: z`);
      expect(idx, flag).toBeGreaterThan(-1);
      expect(envSrc.slice(idx, idx + 220), flag).toContain(".default('false')");
    }
  });

  it('serviços novos não enviam WhatsApp, não criam ticket, não acessam MariaDB', async () => {
    for (const file of [
      'integration-service/src/domain/services/KbCustomResponseService.ts',
      'integration-service/src/domain/services/KbEnrichmentService.ts',
    ]) {
      const src = await readFile(resolve(repoRoot, file), 'utf8');
      expect(src, file).not.toMatch(/sendWhatsApp|sendOutbound|createTicket/);
      // Imports/uso real — comentários de contrato ("No MariaDB") são permitidos.
      expect(src, file).not.toMatch(/from\s+['"]mysql|require\(['"]mysql|mysqli|createConnection/i);
      expect(src, file).not.toMatch(/qdrant|pgvector/i);
    }
  });
});
