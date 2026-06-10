/**
 * PostgresKbCandidateSearchRepository
 *
 * Lexical full-text search over kb_candidates using PostgreSQL ts_vector.
 * Searches approved and candidate articles across weighted fields.
 * Falls back to ILIKE when ts_query returns no results.
 *
 * Weights (per RANKING_POLICY):
 *   A → symptoms_json + problem_pattern  (5)
 *   B → evidence_summary_sanitized       (4)
 *   C → tags_json + probable_cause       (3)
 *   D → title + category_suggestion      (2+1 combined)
 *
 * Phase: integaglpi_local_kb_rag_technician_copilot_001
 * Read-only. No ticket mutation. No cloud. No MariaDB.
 */

import type { SqlExecutor } from '../../infra/db/postgres.js';

export const KB_CANDIDATES_TABLE = 'glpi_plugin_integaglpi_kb_candidates';
const SEARCHABLE_STATUSES = ['approved', 'candidate'];

export interface KbCandidateHit {
  id: number;
  candidateKey: string;
  title: string;
  articleType: string;
  categorySuggestion: string;
  problemPattern: string;
  symptomsJson: string[];
  probableCause: string;
  recommendedProcedureJson: string[];
  checklistJson: string[];
  tagsJson: string[];
  evidenceSummarySanitized: string;
  confidenceScore: number;
  /** Raw search relevance from ts_rank, normalised to [0,1]. */
  rawScore: number;
}

export interface KbCandidateSearchRepository {
  searchCandidates(query: string, topK: number): Promise<KbCandidateHit[]>;
}

function safeJsonArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === 'string');
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed.filter((v): v is string => typeof v === 'string');
      }
    } catch {
      return [value];
    }
  }
  return [];
}

function normScore(raw: number): number {
  // ts_rank returns values roughly in [0, 1] but can exceed 1 for high-frequency
  // matches. Clamp to [0,1] with a soft cap so single matches don't dominate.
  if (!Number.isFinite(raw) || raw <= 0) {
    return 0;
  }
  return Math.min(1, raw * 5); // amplify small ts_rank values
}

// Row shape returned by the main search query
interface SearchRow {
  id: string;
  candidate_key: string;
  title: string;
  article_type: string;
  category_suggestion: string;
  problem_pattern: string;
  symptoms_json: unknown;
  probable_cause: string;
  recommended_procedure_json: unknown;
  checklist_json: unknown;
  tags_json: unknown;
  evidence_summary_sanitized: string;
  confidence_score: string;
  ts_score: string;
}

function rowToHit(row: SearchRow, tsScore: number): KbCandidateHit {
  return {
    id: parseInt(row.id, 10),
    candidateKey: row.candidate_key,
    title: String(row.title ?? '').slice(0, 250),
    articleType: String(row.article_type ?? ''),
    categorySuggestion: String(row.category_suggestion ?? '').slice(0, 120),
    problemPattern: String(row.problem_pattern ?? '').slice(0, 500),
    symptomsJson: safeJsonArray(row.symptoms_json),
    probableCause: String(row.probable_cause ?? '').slice(0, 500),
    recommendedProcedureJson: safeJsonArray(row.recommended_procedure_json),
    checklistJson: safeJsonArray(row.checklist_json),
    tagsJson: safeJsonArray(row.tags_json),
    evidenceSummarySanitized: String(row.evidence_summary_sanitized ?? '').slice(0, 1000),
    confidenceScore: Math.max(0, Math.min(100, parseInt(row.confidence_score ?? '70', 10))),
    rawScore: normScore(tsScore),
  };
}

export class PostgresKbCandidateSearchRepository implements KbCandidateSearchRepository {
  public constructor(private readonly executor: SqlExecutor) {}

  public async searchCandidates(query: string, topK: number): Promise<KbCandidateHit[]> {
    const clean = String(query ?? '').trim();
    if (clean === '') {
      return [];
    }
    const k = Math.max(1, Math.min(20, topK));
    const statusPlaceholders = SEARCHABLE_STATUSES.map((_, i) => `$${i + 2}`).join(', ');

    // Primary: full-text search using Portuguese dictionary with field weights
    const ftsResult = await this.executor.query<SearchRow>(
      `
      SELECT
        id::text,
        candidate_key,
        title,
        article_type,
        category_suggestion,
        COALESCE(problem_pattern, '') AS problem_pattern,
        symptoms_json,
        COALESCE(probable_cause, '') AS probable_cause,
        recommended_procedure_json,
        checklist_json,
        tags_json,
        COALESCE(evidence_summary_sanitized, '') AS evidence_summary_sanitized,
        confidence_score::text,
        ts_rank(
          setweight(to_tsvector('portuguese', COALESCE(problem_pattern,'') || ' ' || COALESCE(symptoms_json::text,'[]')), 'A') ||
          setweight(to_tsvector('portuguese', COALESCE(evidence_summary_sanitized,'')), 'B') ||
          setweight(to_tsvector('portuguese', COALESCE(tags_json::text,'[]') || ' ' || COALESCE(probable_cause,'')), 'C') ||
          setweight(to_tsvector('portuguese', COALESCE(title,'') || ' ' || COALESCE(category_suggestion,'')), 'D'),
          plainto_tsquery('portuguese', $1),
          32
        )::float8::text AS ts_score
      FROM ${KB_CANDIDATES_TABLE}
      WHERE status IN (${statusPlaceholders})
        AND COALESCE(title, '') NOT ILIKE '%Ajuda externa por IA%'
        AND COALESCE(article_type, '') NOT IN ('external_research', 'cloud_preview', 'external_ai')
        AND NOT (tags_json @> '["draft_gap_candidate"]'::jsonb)
        AND (
          setweight(to_tsvector('portuguese', COALESCE(problem_pattern,'') || ' ' || COALESCE(symptoms_json::text,'[]')), 'A') ||
          setweight(to_tsvector('portuguese', COALESCE(evidence_summary_sanitized,'')), 'B') ||
          setweight(to_tsvector('portuguese', COALESCE(tags_json::text,'[]') || ' ' || COALESCE(probable_cause,'')), 'C') ||
          setweight(to_tsvector('portuguese', COALESCE(title,'') || ' ' || COALESCE(category_suggestion,'')), 'D')
        ) @@ plainto_tsquery('portuguese', $1)
      ORDER BY ts_score DESC, confidence_score DESC
      LIMIT $${SEARCHABLE_STATUSES.length + 2}
      `,
      [clean, ...SEARCHABLE_STATUSES, k],
    );

    if (ftsResult.rows.length > 0) {
      return ftsResult.rows.map((r) => rowToHit(r, parseFloat(r.ts_score) || 0));
    }

    // Fallback: ILIKE across all key fields (handles terms not in Portuguese dictionary)
    return this.ilikeSearch(clean, k);
  }

  private async ilikeSearch(query: string, topK: number): Promise<KbCandidateHit[]> {
    // Build tokens (max 5 significant tokens from the query)
    const tokens = query
      .toLowerCase()
      .replace(/[^\w\sáéíóúâêîôûàèìòùãõçñü]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length >= 3)
      .slice(0, 5);

    if (tokens.length === 0) {
      return [];
    }

    const statusPlaceholders = SEARCHABLE_STATUSES.map((_, i) => `$${tokens.length + i + 1}`).join(', ');

    // Build ILIKE condition: each token against concatenated searchable text
    const tokenConditions = tokens
      .map((_, i) => `search_text ILIKE $${i + 1}`)
      .join(' OR ');
    const tokenScoring = tokens
      .map(
        (_, i) =>
          `(CASE WHEN COALESCE(problem_pattern,'') || ' ' || COALESCE(symptoms_json::text,'') ILIKE $${i + 1} THEN 5 ELSE 0 END)` +
          `+(CASE WHEN COALESCE(evidence_summary_sanitized,'') ILIKE $${i + 1} THEN 4 ELSE 0 END)` +
          `+(CASE WHEN COALESCE(tags_json::text,'') ILIKE $${i + 1} THEN 3 ELSE 0 END)` +
          `+(CASE WHEN COALESCE(title,'') ILIKE $${i + 1} THEN 2 ELSE 0 END)` +
          `+(CASE WHEN COALESCE(category_suggestion,'') ILIKE $${i + 1} THEN 1 ELSE 0 END)`,
      )
      .join('+');

    const params: unknown[] = [
      ...tokens.map((t) => `%${t}%`),
      ...SEARCHABLE_STATUSES,
      topK,
    ];

    const result = await this.executor.query<SearchRow>(
      `
      SELECT
        id::text,
        candidate_key,
        title,
        article_type,
        category_suggestion,
        COALESCE(problem_pattern, '') AS problem_pattern,
        symptoms_json,
        COALESCE(probable_cause, '') AS probable_cause,
        recommended_procedure_json,
        checklist_json,
        tags_json,
        COALESCE(evidence_summary_sanitized, '') AS evidence_summary_sanitized,
        confidence_score::text,
        (${tokenScoring})::float8::text AS ts_score
      FROM (
        SELECT *,
          COALESCE(problem_pattern,'') || ' ' || COALESCE(symptoms_json::text,'') ||
          COALESCE(evidence_summary_sanitized,'') || COALESCE(tags_json::text,'') ||
          COALESCE(title,'') || COALESCE(category_suggestion,'') AS search_text
        FROM ${KB_CANDIDATES_TABLE}
        WHERE status IN (${statusPlaceholders})
          AND COALESCE(title, '') NOT ILIKE '%Ajuda externa por IA%'
          AND COALESCE(article_type, '') NOT IN ('external_research', 'cloud_preview', 'external_ai')
          AND NOT (tags_json @> '["draft_gap_candidate"]'::jsonb)
      ) sub
      WHERE ${tokenConditions}
      ORDER BY ts_score DESC, confidence_score DESC
      LIMIT $${tokens.length + SEARCHABLE_STATUSES.length + 1}
      `,
      params,
    );

    return result.rows.map((r) => {
      const rawScore = parseFloat(r.ts_score) || 0;
      // Normalise ILIKE score (max = 5 fields × 5 weight × nTokens)
      const maxPossible = (5 + 4 + 3 + 2 + 1) * tokens.length;
      const normalised = maxPossible > 0 ? rawScore / maxPossible : 0;
      return rowToHit(r, normalised);
    });
  }

  // ── F5/F6 — Enriquecimento persistente (autorizado pelo operador 2026-06-10) ──

  /**
   * Lista candidatos elegíveis para enriquecimento: ainda não enriquecidos
   * (enrichment_version IS NULL) e que são fonte de busca local. Batch limitado
   * (nunca global irrestrito) e ordenado por id para idempotência entre execuções.
   */
  public async listCandidatesForEnrichment(limit = 10, offset = 0): Promise<KbCandidateHit[]> {
    const k = Math.max(1, Math.min(50, limit));
    const statusPlaceholders = SEARCHABLE_STATUSES.map((_, i) => `$${i + 1}`).join(', ');

    const result = await this.executor.query<SearchRow>(
      `
      SELECT
        id::text, candidate_key, title, article_type, category_suggestion,
        COALESCE(problem_pattern, '') AS problem_pattern,
        symptoms_json,
        COALESCE(probable_cause, '') AS probable_cause,
        recommended_procedure_json, checklist_json, tags_json,
        COALESCE(evidence_summary_sanitized, '') AS evidence_summary_sanitized,
        confidence_score::text,
        '0'::text AS ts_score
      FROM ${KB_CANDIDATES_TABLE}
      WHERE status IN (${statusPlaceholders})
        AND COALESCE(title, '') NOT ILIKE '%Ajuda externa por IA%'
        AND COALESCE(article_type, '') NOT IN ('external_research', 'cloud_preview', 'external_ai')
        AND NOT (tags_json @> '["draft_gap_candidate"]'::jsonb)
        AND enrichment_version IS NULL
      ORDER BY id ASC
      LIMIT $${SEARCHABLE_STATUSES.length + 1} OFFSET $${SEARCHABLE_STATUSES.length + 2}
      `,
      [...SEARCHABLE_STATUSES, k, Math.max(0, offset)],
    );

    return result.rows.map((r) => rowToHit(r, 0));
  }

  /**
   * Aplica o conteúdo ENRIQUECIDO ao candidato original (autorização explícita
   * do operador). O conteúdo original completo é preservado em
   * structured_draft_json.original_backup — rollback sempre possível.
   * UPDATE parametrizado em linha única (WHERE id) — nunca em massa.
   */
  public async applyEnrichedContent(input: {
    id: number;
    title: string;
    problemPattern: string;
    symptoms: string[];
    probableCause: string;
    procedure: string[];
    checklist: string[];
    tags: string[];
    evidenceSummary: string;
    sourceTier: string;
    contentMarkdown: string;
    structuredDraft: Record<string, unknown>;
    originalBackup: Record<string, unknown>;
    originalHash: string;
    enrichedHash: string;
    enrichmentVersion: number;
  }): Promise<boolean> {
    const result = await this.executor.query<{ id: string }>(
      `
      UPDATE ${KB_CANDIDATES_TABLE}
      SET title = $2,
          problem_pattern = $3,
          symptoms_json = $4::jsonb,
          probable_cause = $5,
          recommended_procedure_json = $6::jsonb,
          checklist_json = $7::jsonb,
          tags_json = $8::jsonb,
          evidence_summary_sanitized = $9,
          source_tier = $10,
          content_markdown = $11,
          structured_draft_json = $12::jsonb,
          original_hash = $13,
          enriched_hash = $14,
          enrichment_version = $15,
          source_kb_id = $1,
          enriched_at = NOW(),
          updated_at = NOW()
      WHERE id = $1
      RETURNING id::text
      `,
      [
        input.id,
        input.title.slice(0, 250),
        input.problemPattern.slice(0, 500),
        JSON.stringify(input.symptoms.slice(0, 12)),
        input.probableCause.slice(0, 500),
        JSON.stringify(input.procedure.slice(0, 15)),
        JSON.stringify(input.checklist.slice(0, 12)),
        JSON.stringify(input.tags.slice(0, 15)),
        input.evidenceSummary.slice(0, 1000),
        input.sourceTier,
        input.contentMarkdown.slice(0, 12000),
        JSON.stringify({ draft: input.structuredDraft, original_backup: input.originalBackup }),
        input.originalHash,
        input.enrichedHash,
        input.enrichmentVersion,
      ],
    );
    return result.rows.length > 0;
  }

  /**
   * Reverte um enriquecimento aplicado usando o original_backup persistido.
   */
  public async rollbackEnrichment(id: number): Promise<boolean> {
    const result = await this.executor.query<{ id: string }>(
      `
      UPDATE ${KB_CANDIDATES_TABLE}
      SET title = COALESCE(structured_draft_json->'original_backup'->>'title', title),
          problem_pattern = COALESCE(structured_draft_json->'original_backup'->>'problem_pattern', problem_pattern),
          symptoms_json = COALESCE(structured_draft_json->'original_backup'->'symptoms', symptoms_json),
          probable_cause = COALESCE(structured_draft_json->'original_backup'->>'probable_cause', probable_cause),
          recommended_procedure_json = COALESCE(structured_draft_json->'original_backup'->'procedure', recommended_procedure_json),
          checklist_json = COALESCE(structured_draft_json->'original_backup'->'checklist', checklist_json),
          tags_json = COALESCE(structured_draft_json->'original_backup'->'tags', tags_json),
          evidence_summary_sanitized = COALESCE(structured_draft_json->'original_backup'->>'evidence_summary', evidence_summary_sanitized),
          content_markdown = COALESCE(structured_draft_json->'original_backup'->>'content_markdown', content_markdown),
          enrichment_version = NULL,
          enriched_hash = NULL,
          enriched_at = NULL,
          updated_at = NOW()
      WHERE id = $1 AND structured_draft_json ? 'original_backup'
      RETURNING id::text
      `,
      [id],
    );
    return result.rows.length > 0;
  }

  /**
   * Lê content_markdown do candidato (não faz parte do hit de busca).
   */
  public async getContentMarkdown(id: number): Promise<string> {
    const result = await this.executor.query<{ content_markdown: string }>(
      `SELECT COALESCE(content_markdown, '') AS content_markdown FROM ${KB_CANDIDATES_TABLE} WHERE id = $1`,
      [id],
    );
    return String(result.rows[0]?.content_markdown ?? '');
  }

  /**
   * F6: insere um candidato de lacuna (draft_gap_candidate) com revisão humana.
   * Idempotente por candidate_key (ON CONFLICT DO NOTHING). Nunca publicado.
   */
  public async insertGapCandidate(input: {
    candidateKey: string;
    title: string;
    pattern: string;
    occurrences: number;
  }): Promise<boolean> {
    const result = await this.executor.query<{ id: string }>(
      `
      INSERT INTO ${KB_CANDIDATES_TABLE} (
        candidate_key, input_hash, status, article_type, title, content_markdown,
        problem_pattern, symptoms_json, tags_json, category_suggestion,
        evidence_summary_sanitized, confidence_score
      ) VALUES (
        $1, $2, 'draft_gap_candidate', 'checklist_diagnostico', $3, $4,
        $5, '[]'::jsonb, '["draft_gap_candidate"]'::jsonb, 'Lacuna de KB',
        $6, 10
      )
      ON CONFLICT (candidate_key) DO NOTHING
      RETURNING id::text
      `,
      [
        input.candidateKey,
        input.candidateKey,
        input.title.slice(0, 250),
        `# Lacuna de KB detectada\n\nPadrão: ${input.pattern}\nOcorrências: ${input.occurrences}\n\nEste é um rascunho de lacuna — requer redação e revisão humana antes de qualquer uso.`,
        `Lacuna recorrente sem cobertura local: ${input.pattern}`.slice(0, 500),
        `Detectado pelo gap analysis (>= ${input.occurrences} buscas sem KB suficiente).`.slice(0, 1000),
      ],
    );
    return result.rows.length > 0;
  }
}
