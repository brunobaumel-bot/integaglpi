/**
 * KbEnrichmentService — F5 (enriquecimento draft) + F6 (gap analysis)
 * Phase: integaglpi_v9_kb_enrichment_and_search_optimization_001
 *
 * F5 — Enriquecimento sob demanda:
 *   - Lê um candidato de KB existente, detecta lacunas estruturais e gera um
 *     DRAFT enriquecido em memória com todos os campos estruturados do contrato.
 *   - O ORIGINAL é sempre preservado (o serviço nunca o altera/apaga).
 *   - Rastreabilidade: source_kb_id + original_hash + enriched_hash + version.
 *   - human_review_required: true — literal, imutável.
 *   - Campos sem evidência recebem 'INFORMACAO_INDISPONIVEL' (nunca inventa).
 *   - PERSISTÊNCIA/APLICAÇÃO: AUTORIZADA pelo operador em 2026-06-10 (migration
 *     052 aditiva). applyEnrichment() atualiza o candidato ORIGINAL com o
 *     conteúdo enriquecido, preservando o original completo em
 *     structured_draft_json.original_backup (rollback via rollbackEnrichment()).
 *     persistDraft() permanece como referência histórica do gate de schema.
 *
 * F6 — Gap analysis:
 *   - Agrega eventos kb_rag_search com deterministic_fallback e zero KBs usadas
 *     (KB_INSUFFICIENT) por plan_summary (produto:intent — sem PII).
 *   - Threshold: padrão aparece >= 3 vezes na janela; queries genéricas/teste
 *     são descartadas (plan generic sem produto não gera lacuna).
 *   - Saída: draft_gap_candidate em memória com human_review_required=true.
 *     NUNCA cria KB publicada.
 *
 * Invariantes globais: sem cloud, sem WhatsApp, sem ticket, sem MariaDB,
 * sem publicação automática, sem batch global irrestrito (1 candidato por chamada).
 */

import { createHash } from 'node:crypto';

import { env } from '../../config/env.js';
import { piiGuard } from './KbRagCopilotService.js';
import type { OllamaRagPort } from './KbRagCopilotService.js';
import type { KbCandidateHit, PostgresKbCandidateSearchRepository } from '../../repositories/postgres/PostgresKbCandidateSearchRepository.js';
import type { SqlExecutor } from '../../infra/db/postgres.js';

// ── F5 types ──────────────────────────────────────────────────────────────────

export const INFO_UNAVAILABLE = 'INFORMACAO_INDISPONIVEL';

export type EnrichedDraftStatus = 'draft_enriched' | 'needs_review' | 'ready_for_human_review';

/** Estrutura completa exigida pelo contrato F5. */
export interface EnrichedKbDraft {
  title: string;
  slug: string;
  product_or_system: string;
  source_tier: string;
  category: string;
  aliases: string[];
  symptoms: string[];
  tags: string[];
  ai_hint: string;
  context: string;
  triage_questions: string[];
  incident_tree: string[];
  commands_or_checks: string[];
  likely_causes: string[];
  resolution_steps: string[];
  validation_steps: string[];
  rollback_or_safe_exit: string[];
  escalation_when: string[];
  prevention: string[];
  known_false_positives: string[];
  forbidden_terms: string[];
  confidence_notes: string;
  /** Literal — revisão humana sempre obrigatória. */
  readonly human_review_required: true;
}

export interface EnrichmentResult {
  ok: boolean;
  status: EnrichedDraftStatus;
  /** true somente quando a IA local contribuiu de fato (Ollama respondeu e parseou). */
  ai_enriched: boolean;
  /** ID do candidato original (preservado, nunca alterado). */
  source_kb_id: number;
  original_hash: string;
  enriched_hash: string;
  enrichment_version: number;
  /** Lacunas detectadas no original (campos ausentes/vazios). */
  gaps_detected: string[];
  draft: EnrichedKbDraft;
  /** Original intacto para diff lado a lado na revisão humana. */
  original_snapshot: {
    id: number;
    title: string;
    problem_pattern: string;
    symptoms: string[];
    probable_cause: string;
    procedure: string[];
    checklist: string[];
    tags: string[];
  };
  readonly original_preserved: true;
  readonly auto_publish: false;
  error?: string;
}

export interface PersistDraftResult {
  ok: false;
  status: 'BLOCK_SCHEMA_REQUIRED';
  reason: string;
  migration_proposal: string[];
}

// ── F6 types ──────────────────────────────────────────────────────────────────

export const GAP_MIN_OCCURRENCES = 3;
export const GAP_MIN_TECHNICAL_TOKENS = 3;

export interface KbGapSuggestion {
  pattern: string;          // plan_summary (produto:intent) — sem PII
  occurrences: number;
  first_seen: string;
  last_seen: string;
  suggested_title: string;
  status: 'draft_gap_candidate';
  readonly human_review_required: true;
  readonly auto_publish: false;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 80);
}

function fillOrUnavailable(values: string[]): string[] {
  const clean = values.map((v) => piiGuard(v).trim()).filter(Boolean);
  return clean.length > 0 ? clean : [INFO_UNAVAILABLE];
}

function originalHashOf(hit: KbCandidateHit): string {
  return sha256(JSON.stringify({
    title: hit.title,
    problem_pattern: hit.problemPattern,
    symptoms: hit.symptomsJson,
    probable_cause: hit.probableCause,
    procedure: hit.recommendedProcedureJson,
    checklist: hit.checklistJson,
    tags: hit.tagsJson,
  }));
}

const REQUIRED_FIELD_SOURCES: Array<[string, (h: KbCandidateHit) => boolean]> = [
  ['symptoms', (h) => h.symptomsJson.length > 0],
  ['likely_causes', (h) => h.probableCause.trim() !== ''],
  ['resolution_steps', (h) => h.recommendedProcedureJson.length > 0],
  ['validation_steps', (h) => h.checklistJson.length > 0],
  ['tags', (h) => h.tagsJson.length > 0],
  ['category', (h) => h.categorySuggestion.trim() !== ''],
  ['context', (h) => h.evidenceSummarySanitized.trim() !== ''],
];

// ── Service ───────────────────────────────────────────────────────────────────

export class KbEnrichmentService {
  public constructor(
    private readonly ollamaPort: OllamaRagPort | null = null,
    private readonly executor: SqlExecutor | null = null,
  ) {}

  // ── F5: análise de lacunas ─────────────────────────────────────────────────

  public detectGaps(hit: KbCandidateHit): string[] {
    const gaps: string[] = [];
    for (const [field, present] of REQUIRED_FIELD_SOURCES) {
      if (!present(hit)) gaps.push(field);
    }
    // Campos estruturados novos do contrato que o schema legado nunca teve.
    gaps.push(
      ...['aliases', 'ai_hint', 'triage_questions', 'incident_tree',
        'rollback_or_safe_exit', 'escalation_when', 'prevention',
        'known_false_positives', 'forbidden_terms']
        .filter(() => true),
    );
    return gaps;
  }

  // ── F5: draft enriquecido (em memória; original preservado) ───────────────

  /**
   * Gera o draft enriquecido SOB DEMANDA para UM candidato (nunca batch global).
   * Quando KB_ENRICHMENT_ENABLED=false retorna needs_review com draft
   * determinístico mínimo (sem chamada Ollama) — comportamento seguro.
   */
  public async buildEnrichedDraft(hit: KbCandidateHit): Promise<EnrichmentResult> {
    const gaps = this.detectGaps(hit);
    const originalHash = originalHashOf(hit);

    // Draft determinístico: deriva tudo do conteúdo existente; nunca inventa.
    const draft: EnrichedKbDraft = {
      title: piiGuard(hit.title).slice(0, 200),
      slug: slugify(hit.title),
      product_or_system: this.inferProduct(hit) ?? INFO_UNAVAILABLE,
      source_tier: 'tier_3_generic_playbook',
      category: hit.categorySuggestion || INFO_UNAVAILABLE,
      aliases: [INFO_UNAVAILABLE],
      symptoms: fillOrUnavailable(hit.symptomsJson),
      tags: fillOrUnavailable(hit.tagsJson),
      ai_hint: piiGuard(hit.evidenceSummarySanitized).slice(0, 300) || INFO_UNAVAILABLE,
      context: piiGuard(hit.problemPattern).slice(0, 500) || INFO_UNAVAILABLE,
      triage_questions: [INFO_UNAVAILABLE],
      incident_tree: [INFO_UNAVAILABLE],
      commands_or_checks: fillOrUnavailable(hit.recommendedProcedureJson),
      likely_causes: fillOrUnavailable([hit.probableCause]),
      resolution_steps: fillOrUnavailable(hit.recommendedProcedureJson),
      validation_steps: fillOrUnavailable(hit.checklistJson),
      rollback_or_safe_exit: [INFO_UNAVAILABLE],
      escalation_when: [INFO_UNAVAILABLE],
      prevention: [INFO_UNAVAILABLE],
      known_false_positives: [INFO_UNAVAILABLE],
      forbidden_terms: [],
      confidence_notes: `Draft determinístico gerado a partir do candidato #${hit.id}; lacunas: ${gaps.slice(0, 8).join(', ')}.`,
      human_review_required: true,
    };

    // Enriquecimento opcional via Ollama LOCAL (flag-gated; nunca cloud).
    // Autorizado a MELHORAR o conteúdo (sintomas/causas/passos/validação/contexto),
    // sempre ancorado no original — rastreável e reversível via backup.
    let aiEnriched = false;
    if (env.KB_ENRICHMENT_ENABLED && this.ollamaPort !== null) {
      try {
        const enriched = await this.tryOllamaEnrichment(hit, draft);
        if (enriched !== null) {
          Object.assign(draft, enriched);
          draft.confidence_notes += ' Campos complementados/melhorados por IA local — rastreável; rollback disponível.';
          aiEnriched = true;
        }
      } catch {
        // Falha de IA nunca bloqueia o draft determinístico.
      }
    }

    return {
      ok: true,
      status: env.KB_ENRICHMENT_ENABLED ? 'ready_for_human_review' : 'needs_review',
      ai_enriched: aiEnriched,
      source_kb_id: hit.id,
      original_hash: originalHash,
      enriched_hash: sha256(JSON.stringify(draft)),
      enrichment_version: 1,
      gaps_detected: gaps,
      draft,
      original_snapshot: {
        id: hit.id,
        title: hit.title,
        problem_pattern: hit.problemPattern,
        symptoms: hit.symptomsJson,
        probable_cause: hit.probableCause,
        procedure: hit.recommendedProcedureJson,
        checklist: hit.checklistJson,
        tags: hit.tagsJson,
      },
      original_preserved: true,
      auto_publish: false,
    };
  }

  /**
   * APLICA o enriquecimento ao candidato original no banco (autorização do
   * operador em 2026-06-10 + migration 052). O original completo é gravado em
   * structured_draft_json.original_backup ANTES da substituição — rollback
   * disponível via repositório. 1 candidato por chamada — nunca em massa cega.
   */
  public async applyEnrichment(
    repo: PostgresKbCandidateSearchRepository,
    hit: KbCandidateHit,
    result: EnrichmentResult,
  ): Promise<{ ok: boolean; id: number; error?: string }> {
    if (!env.KB_ENRICHMENT_ENABLED) {
      return { ok: false, id: hit.id, error: 'KB_ENRICHMENT_ENABLED=false — aplicação desabilitada.' };
    }

    const d = result.draft;
    const cleanList = (values: string[]): string[] =>
      values.filter((v) => v !== INFO_UNAVAILABLE && v.trim() !== '');

    // Merge: campos enriquecidos substituem; INFORMACAO_INDISPONIVEL preserva original.
    const symptoms = cleanList(d.symptoms).length > 0 ? cleanList(d.symptoms) : hit.symptomsJson;
    const procedure = cleanList(d.resolution_steps).length > 0 ? cleanList(d.resolution_steps) : hit.recommendedProcedureJson;
    const checklist = cleanList(d.validation_steps).length > 0 ? cleanList(d.validation_steps) : hit.checklistJson;
    const tags = Array.from(new Set([
      ...hit.tagsJson,
      ...cleanList(d.tags),
      ...cleanList(d.aliases),
      'enriched_v' + result.enrichment_version,
    ]));
    const probableCause = cleanList(d.likely_causes).join('; ') || hit.probableCause;

    const originalContentMarkdown = await repo.getContentMarkdown(hit.id);
    const contentMarkdown = this.renderEnrichedMarkdown(d, result);

    const applied = await repo.applyEnrichedContent({
      id: hit.id,
      title: d.title || hit.title,
      problemPattern: d.context !== INFO_UNAVAILABLE ? d.context : hit.problemPattern,
      symptoms,
      probableCause,
      procedure,
      checklist,
      tags,
      evidenceSummary: d.ai_hint !== INFO_UNAVAILABLE ? d.ai_hint : hit.evidenceSummarySanitized,
      sourceTier: d.source_tier,
      contentMarkdown,
      structuredDraft: d as unknown as Record<string, unknown>,
      originalBackup: {
        title: hit.title,
        problem_pattern: hit.problemPattern,
        symptoms: hit.symptomsJson,
        probable_cause: hit.probableCause,
        procedure: hit.recommendedProcedureJson,
        checklist: hit.checklistJson,
        tags: hit.tagsJson,
        evidence_summary: hit.evidenceSummarySanitized,
        content_markdown: originalContentMarkdown,
      },
      originalHash: result.original_hash,
      enrichedHash: result.enriched_hash,
      enrichmentVersion: result.enrichment_version,
    });

    return applied
      ? { ok: true, id: hit.id }
      : { ok: false, id: hit.id, error: 'UPDATE não afetou nenhuma linha.' };
  }

  /**
   * Batch CONTROLADO: enriquece e aplica até `limit` candidatos elegíveis
   * (enrichment_version IS NULL). Nunca global irrestrito; resumo por item.
   */
  public async enrichAndApplyBatch(
    repo: PostgresKbCandidateSearchRepository,
    limit = 10,
    options: { allowDeterministic?: boolean } = {},
  ): Promise<{
    processed: number;
    applied: number;
    failed: number;
    items: Array<{ id: number; title: string; ok: boolean; gaps: number; error?: string }>;
  }> {
    const safeLimit = Math.max(1, Math.min(limit, 50));
    const candidates = await repo.listCandidatesForEnrichment(safeLimit, 0);
    const items: Array<{ id: number; title: string; ok: boolean; gaps: number; error?: string }> = [];
    let applied = 0;
    let failed = 0;

    for (const hit of candidates) {
      try {
        const result = await this.buildEnrichedDraft(hit);
        // Guard de elegibilidade: sem contribuição REAL da IA, aplicar marcaria o
        // candidato como enriquecido (enrichment_version=1) e o tiraria da fila
        // para sempre — sem ganho de conteúdo. Pula por padrão (Ollama offline).
        if (!result.ai_enriched && options.allowDeterministic !== true) {
          failed++;
          items.push({
            id: hit.id,
            title: hit.title.slice(0, 80),
            ok: false,
            gaps: result.gaps_detected.length,
            error: 'ollama_indisponivel — apply pulado para preservar elegibilidade (use --allow-deterministic para forçar)',
          });
          continue;
        }
        const outcome = await this.applyEnrichment(repo, hit, result);
        items.push({
          id: hit.id,
          title: hit.title.slice(0, 80),
          ok: outcome.ok,
          gaps: result.gaps_detected.length,
          ...(outcome.error !== undefined ? { error: outcome.error } : {}),
        });
        outcome.ok ? applied++ : failed++;
      } catch (err) {
        failed++;
        items.push({
          id: hit.id,
          title: hit.title.slice(0, 80),
          ok: false,
          gaps: 0,
          error: err instanceof Error ? err.message.slice(0, 160) : 'erro desconhecido',
        });
      }
    }

    return { processed: candidates.length, applied, failed, items };
  }

  /**
   * F6: persiste lacunas recorrentes como draft_gap_candidate (revisão humana).
   */
  public async persistGapCandidates(
    repo: PostgresKbCandidateSearchRepository,
    windowDays = 30,
  ): Promise<{ detected: number; inserted: number }> {
    const gaps = await this.detectRecurringGaps(windowDays);
    let inserted = 0;
    for (const gap of gaps) {
      const ok = await repo.insertGapCandidate({
        candidateKey: 'gap-' + sha256(gap.pattern).slice(0, 24),
        title: gap.suggested_title,
        pattern: gap.pattern,
        occurrences: gap.occurrences,
      });
      if (ok) inserted++;
    }
    return { detected: gaps.length, inserted };
  }

  private renderEnrichedMarkdown(d: EnrichedKbDraft, result: EnrichmentResult): string {
    const list = (items: string[]): string =>
      items.filter((i) => i !== INFO_UNAVAILABLE).map((i) => `- ${i}`).join('\n') || '- (a completar na revisão)';
    return [
      `# ${d.title}`,
      '',
      `> Enriquecido por IA local (v${result.enrichment_version}) — original preservado para rollback. Revisão humana recomendada.`,
      '',
      `**Sistema/Produto:** ${d.product_or_system}  `,
      `**Categoria:** ${d.category} · **Tier:** ${d.source_tier}`,
      '',
      '## Contexto', d.context !== INFO_UNAVAILABLE ? d.context : '(a completar)',
      '', '## Sintomas', list(d.symptoms),
      '', '## Perguntas de triagem', list(d.triage_questions),
      '', '## Causas prováveis', list(d.likely_causes),
      '', '## Verificações (consultivas — execução manual)', list(d.commands_or_checks),
      '', '## Resolução', list(d.resolution_steps),
      '', '## Validação', list(d.validation_steps),
      '', '## Rollback / saída segura', list(d.rollback_or_safe_exit),
      '', '## Quando escalar', list(d.escalation_when),
      '', '## Prevenção', list(d.prevention),
      '', '## Falsos positivos conhecidos', list(d.known_false_positives),
      '', `_${d.confidence_notes}_`,
    ].join('\n');
  }

  /**
   * Referência histórica do gate de schema (pré-autorização). A migration 052
   * foi autorizada e criada em 2026-06-10 — use applyEnrichment().
   */
  public persistDraft(): PersistDraftResult {
    return {
      ok: false,
      status: 'BLOCK_SCHEMA_REQUIRED',
      reason:
        'kb_candidates.status CHECK não inclui os status de draft enriquecido e '
        + 'faltam colunas de rastreabilidade (source_kb_id/original_hash/enriched_hash/enrichment_version). '
        + 'Draft permanece em memória/resposta; aprovação humana e migration aditiva são pré-requisitos.',
      migration_proposal: [
        '-- 052_kb_candidates_enrichment_traceability.sql (PROPOSTA — não criada)',
        'ALTER TABLE glpi_plugin_integaglpi_kb_candidates ADD COLUMN IF NOT EXISTS source_kb_id BIGINT NULL;',
        'ALTER TABLE glpi_plugin_integaglpi_kb_candidates ADD COLUMN IF NOT EXISTS original_hash TEXT NULL;',
        'ALTER TABLE glpi_plugin_integaglpi_kb_candidates ADD COLUMN IF NOT EXISTS enriched_hash TEXT NULL;',
        'ALTER TABLE glpi_plugin_integaglpi_kb_candidates ADD COLUMN IF NOT EXISTS enrichment_version INTEGER NULL;',
        'ALTER TABLE glpi_plugin_integaglpi_kb_candidates ADD COLUMN IF NOT EXISTS structured_draft_json JSONB NULL;',
        "ALTER TABLE glpi_plugin_integaglpi_kb_candidates DROP CONSTRAINT IF EXISTS glpi_integaglpi_kb_candidates_status_chk;",
        "ALTER TABLE glpi_plugin_integaglpi_kb_candidates ADD CONSTRAINT glpi_integaglpi_kb_candidates_status_chk CHECK (status IN ('suggested','in_review','approved','rejected','low_confidence','possible_duplicate','candidate','draft_enriched','needs_review','ready_for_human_review','draft_gap_candidate'));",
      ],
    };
  }

  // ── F6: gap analysis ───────────────────────────────────────────────────────

  /**
   * Detecta lacunas RECORRENTES de KB a partir do rag_audit.
   * Read-only; agrega por plan_summary (produto:intent — nunca query bruta/PII).
   * Gate: KB_GAP_ANALYSIS_ENABLED=false → lista vazia.
   */
  public async detectRecurringGaps(windowDays = 30): Promise<KbGapSuggestion[]> {
    if (!env.KB_GAP_ANALYSIS_ENABLED || this.executor === null) {
      return [];
    }
    const safeWindow = Math.max(1, Math.min(windowDays, 90));

    const result = await this.executor.query<{
      pattern: string;
      occurrences: string;
      first_seen: string;
      last_seen: string;
    }>(
      `
        SELECT
          payload_json->>'plan_summary'                       AS pattern,
          COUNT(*)::text                                      AS occurrences,
          MIN(created_at)::text                               AS first_seen,
          MAX(created_at)::text                               AS last_seen
        FROM glpi_plugin_integaglpi_audit_events
        WHERE event_type = 'kb_rag_search'
          AND created_at >= NOW() - ($1::int || ' days')::interval
          AND (payload_json->>'deterministic_fallback')::boolean = TRUE
          AND COALESCE(jsonb_array_length(payload_json->'kb_ids_used'), 0) = 0
          AND payload_json->>'plan_summary' IS NOT NULL
        GROUP BY payload_json->>'plan_summary'
        HAVING COUNT(*) >= $2::int
        ORDER BY COUNT(*) DESC
        LIMIT 20
      `,
      [safeWindow, GAP_MIN_OCCURRENCES],
    );

    return result.rows
      .filter((r) => {
        const pattern = String(r.pattern ?? '');
        // Queries genéricas/teste não geram lacuna: exige produto ancorado
        // (plan_summary 'generic:...' é descartado) e tokens técnicos no padrão.
        if (pattern.startsWith('generic:')) return false;
        const tokens = pattern.split(/[:\s_-]+/).filter((t) => t.length >= 3);
        return tokens.length >= GAP_MIN_TECHNICAL_TOKENS - 1; // produto + intent + source
      })
      .map((r) => {
        const [product, intent] = String(r.pattern).split(':');
        return {
          pattern: String(r.pattern),
          occurrences: parseInt(r.occurrences, 10) || 0,
          first_seen: String(r.first_seen),
          last_seen: String(r.last_seen),
          suggested_title: `[GAP] KB sugerida: ${product ?? 'produto'} — ${intent ?? 'intent'} (sem cobertura local)`,
          status: 'draft_gap_candidate',
          human_review_required: true,
          auto_publish: false,
        };
      });
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private inferProduct(hit: KbCandidateHit): string | null {
    const text = `${hit.title} ${hit.tagsJson.join(' ')} ${hit.categorySuggestion}`.toLowerCase();
    const known = ['micromed', 'synology', 'veeam', 'active directory', 'azure', 'windows', 'office', 'glpi', 'logmein'];
    for (const product of known) {
      if (text.includes(product)) return product;
    }
    return null;
  }

  private async tryOllamaEnrichment(
    hit: KbCandidateHit,
    base: EnrichedKbDraft,
  ): Promise<Partial<EnrichedKbDraft> | null> {
    if (this.ollamaPort === null) return null;
    // Autorizado (2026-06-10) a MELHORAR o conteúdo existente: expandir sintomas,
    // causas, passos, validação e contexto com conhecimento técnico do modelo,
    // SEMPRE ancorado no artigo original. Original preservado em backup (rollback).
    const prompt = [
      'Você é um analista técnico sênior enriquecendo um artigo de base de conhecimento INTERNO de suporte.',
      'Melhore e EXPANDA o conteúdo: complete sintomas, causas prováveis, passos de resolução (numerados e específicos), validação, triagem, rollback, escalonamento e prevenção.',
      'Pode usar conhecimento técnico geral do produto/sistema para complementar, mas NUNCA contradiga o artigo original.',
      'Comandos são SUGESTÃO consultiva (execução manual humana). Sem PII (nomes, telefones, e-mails, tokens).',
      'Para um campo onde realmente não há nada útil a dizer, use exatamente "INFORMACAO_INDISPONIVEL".',
      'Responda APENAS JSON válido com as chaves:',
      '{"context":"","symptoms":[],"likely_causes":[],"resolution_steps":[],"validation_steps":[],"commands_or_checks":[],"ai_hint":"","aliases":[],"triage_questions":[],"incident_tree":[],"rollback_or_safe_exit":[],"escalation_when":[],"prevention":[],"known_false_positives":[]}',
      '',
      '=== ARTIGO ORIGINAL ===',
      `Título: ${piiGuard(hit.title)}`,
      `Categoria: ${hit.categorySuggestion}`,
      `Sintomas: ${hit.symptomsJson.join('; ') || 'N/D'}`,
      `Causa: ${piiGuard(hit.probableCause) || 'N/D'}`,
      `Passos: ${hit.recommendedProcedureJson.join(' → ') || 'N/D'}`,
      `Validação: ${hit.checklistJson.join('; ') || 'N/D'}`,
      `Contexto: ${base.context}`,
      `Tags: ${hit.tagsJson.join(', ') || 'N/D'}`,
    ].join('\n');

    const raw = await this.ollamaPort.generateText(prompt, { temperature: 0.2 });
    const match = raw?.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      const parsed = JSON.parse(match[0]) as Record<string, unknown>;
      const arr = (v: unknown): string[] | undefined => {
        if (!Array.isArray(v)) return undefined;
        const clean = v
          .filter((s): s is string => typeof s === 'string')
          .map((s) => piiGuard(s).trim())
          .filter((s) => s !== '' && s !== INFO_UNAVAILABLE)
          .slice(0, 10);
        return clean.length > 0 ? clean : undefined;
      };
      const str = (v: unknown): string | undefined => {
        if (typeof v !== 'string') return undefined;
        const clean = piiGuard(v).trim().slice(0, 600);
        return clean !== '' && clean !== INFO_UNAVAILABLE ? clean : undefined;
      };
      const out: Partial<EnrichedKbDraft> = {};
      const context = str(parsed['context']);
      if (context) out.context = context;
      const symptoms = arr(parsed['symptoms']);
      if (symptoms) out.symptoms = symptoms;
      const causes = arr(parsed['likely_causes']);
      if (causes) out.likely_causes = causes;
      const resolution = arr(parsed['resolution_steps']);
      if (resolution) out.resolution_steps = resolution;
      const validation = arr(parsed['validation_steps']);
      if (validation) out.validation_steps = validation;
      const checks = arr(parsed['commands_or_checks']);
      if (checks) out.commands_or_checks = checks;
      const aiHint = str(parsed['ai_hint']);
      if (aiHint) out.ai_hint = aiHint;
      const aliases = arr(parsed['aliases']);
      if (aliases) out.aliases = aliases;
      const triage = arr(parsed['triage_questions']);
      if (triage) out.triage_questions = triage;
      const tree = arr(parsed['incident_tree']);
      if (tree) out.incident_tree = tree;
      const rollback = arr(parsed['rollback_or_safe_exit']);
      if (rollback) out.rollback_or_safe_exit = rollback;
      const escal = arr(parsed['escalation_when']);
      if (escal) out.escalation_when = escal;
      const prev = arr(parsed['prevention']);
      if (prev) out.prevention = prev;
      const falsePos = arr(parsed['known_false_positives']);
      if (falsePos) out.known_false_positives = falsePos;
      return out;
    } catch {
      return null;
    }
  }
}
