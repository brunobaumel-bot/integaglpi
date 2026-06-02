import type { SqlExecutor } from '../infra/db/postgres.js';
import type {
  GeneratedKbCandidate,
  KbCandidateGenerationInput,
  KbCandidateSourceEvidence,
  KbCandidateSourceInsight,
  KbCandidateSourcePattern,
} from './types.js';

interface PatternRow {
  id: number;
  pattern_type: string;
  category: string | null;
  frequency_abs: number;
  severity: 'low' | 'medium' | 'high';
  description_sanitized: string;
  evidence_hashes_json: string[] | string | null;
}

interface InsightRow {
  id: number;
  insight_type: string;
  priority: 'low' | 'medium' | 'high';
  title: string;
  summary_sanitized: string;
  recommendation_sanitized: string;
  confidence_score: number;
  filters_json: Record<string, unknown> | string | null;
}

interface EvidenceRow {
  ticket_id_hash: string;
  anonymized_excerpt: string;
}

function jsonArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item)).filter(Boolean);
  }
  if (typeof value === 'string' && value !== '') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? parsed.map((item) => String(item)).filter(Boolean) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function jsonObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === 'string' && value !== '') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
    } catch {
      return {};
    }
  }
  return {};
}

export async function loadKbCandidateGenerationInput(
  executor: SqlExecutor,
  runId: string,
): Promise<KbCandidateGenerationInput> {
  const run = await executor.query<{ run_id: string; input_hash: string }>(
    `
      SELECT run_id, input_hash
        FROM public.glpi_plugin_integaglpi_hist_mining_runs
       WHERE run_id = $1
       LIMIT 1
    `,
    [runId],
  );
  if (run.rowCount === 0) {
    throw new Error(`Historical mining run not found: ${runId}`);
  }

  const patterns = await executor.query<PatternRow>(
    `
      SELECT id, pattern_type, category, frequency_abs, severity, description_sanitized, evidence_hashes_json
        FROM public.glpi_plugin_integaglpi_hist_patterns
       WHERE run_id = $1
       ORDER BY frequency_abs DESC, id ASC
    `,
    [runId],
  );
  const insights = await executor.query<InsightRow>(
    `
      SELECT id, insight_type, priority, title, summary_sanitized, recommendation_sanitized, confidence_score, filters_json
        FROM public.glpi_plugin_integaglpi_hist_insights
       WHERE run_id = $1
       ORDER BY confidence_score DESC, id ASC
    `,
    [runId],
  );
  const evidence = await executor.query<EvidenceRow>(
    `
      SELECT ticket_id_hash, anonymized_excerpt
        FROM public.glpi_plugin_integaglpi_hist_evidence
       WHERE run_id = $1
       ORDER BY id ASC
       LIMIT 500
    `,
    [runId],
  );

  return {
    runId: run.rows[0].run_id,
    inputHash: run.rows[0].input_hash,
    patterns: patterns.rows.map((row): KbCandidateSourcePattern => ({
      id: row.id,
      patternType: row.pattern_type,
      category: row.category ?? 'Sem categoria',
      frequencyAbs: row.frequency_abs,
      severity: row.severity,
      descriptionSanitized: row.description_sanitized,
      evidenceHashes: jsonArray(row.evidence_hashes_json),
    })),
    insights: insights.rows.map((row): KbCandidateSourceInsight => ({
      id: row.id,
      insightType: row.insight_type,
      priority: row.priority,
      title: row.title,
      summarySanitized: row.summary_sanitized,
      recommendationSanitized: row.recommendation_sanitized,
      confidenceScore: row.confidence_score,
      filters: jsonObject(row.filters_json),
    })),
    evidence: evidence.rows.map((row): KbCandidateSourceEvidence => ({
      ticketIdHash: row.ticket_id_hash,
      anonymizedExcerpt: row.anonymized_excerpt,
    })),
  };
}

export async function persistKbCandidates(
  executor: SqlExecutor,
  candidates: GeneratedKbCandidate[],
  createdByGlpiUserId: number | null = null,
): Promise<number> {
  let inserted = 0;
  for (const candidate of candidates) {
    const result = await executor.query<{ id: number }>(
      `
        INSERT INTO public.glpi_plugin_integaglpi_kb_candidates (
          candidate_key,
          input_hash,
          status,
          article_type,
          title,
          content_markdown,
          problem_pattern,
          symptoms_json,
          probable_cause,
          recommended_procedure_json,
          checklist_json,
          humanized_customer_response,
          tags_json,
          category_suggestion,
          related_native_kb_json,
          possible_duplicate,
          duplicate_reason,
          source_pattern_ids_json,
          source_insight_ids_json,
          evidence_hashes_json,
          evidence_summary_sanitized,
          confidence_score,
          limitations_json,
          confidence_reason,
          difficulty_level,
          target_audience,
          created_by_glpi_user_id
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7,
          $8::jsonb, $9, $10::jsonb, $11::jsonb, $12, $13::jsonb, $14, $15::jsonb,
          $16, $17, $18::jsonb, $19::jsonb, $20::jsonb, $21, $22, $23::jsonb,
          $24, $25, $26, $27
        )
        ON CONFLICT (candidate_key) DO NOTHING
        RETURNING id
      `,
      [
        candidate.candidateKey,
        candidate.inputHash,
        candidate.status,
        candidate.articleType,
        candidate.title,
        candidate.contentMarkdown,
        candidate.problemPattern,
        JSON.stringify(candidate.symptoms),
        candidate.probableCause,
        JSON.stringify(candidate.recommendedProcedure),
        JSON.stringify(candidate.checklistItems),
        candidate.humanizedCustomerResponse,
        JSON.stringify(candidate.tags),
        candidate.categorySuggestion,
        JSON.stringify(candidate.relatedNativeKbArticles),
        candidate.possibleDuplicate,
        candidate.duplicateReason,
        JSON.stringify(candidate.sourcePatternIds),
        JSON.stringify(candidate.sourceInsightIds),
        JSON.stringify(candidate.evidenceHashes),
        candidate.evidenceSummarySanitized,
        candidate.confidenceScore,
        JSON.stringify(candidate.limitations),
        // ── migration 044 structured columns (mirror content_markdown) ──
        candidate.confidenceReason ?? null,
        candidate.difficultyLevel ?? null,
        candidate.targetAudience ?? null,
        createdByGlpiUserId,
      ],
    );
    if ((result.rowCount ?? 0) > 0) {
      inserted++;
      await auditCandidateGeneration(executor, result.rows[0].id, candidate, createdByGlpiUserId);
    }
  }

  return inserted;
}

async function auditCandidateGeneration(
  executor: SqlExecutor,
  candidateId: number,
  candidate: GeneratedKbCandidate,
  createdByGlpiUserId: number | null,
): Promise<void> {
  const eventType = candidate.possibleDuplicate
    ? 'KB_CANDIDATE_DUPLICATE_DETECTED'
    : candidate.status === 'low_confidence'
      ? 'KB_CANDIDATE_LOW_CONFIDENCE'
      : 'KB_CANDIDATE_GENERATED';

  await executor.query(
    `
      INSERT INTO public.glpi_plugin_integaglpi_audit_events (
        correlation_id,
        ticket_id,
        conversation_id,
        message_id,
        direction,
        event_type,
        status,
        severity,
        source,
        payload_json,
        created_at
      )
      VALUES (
        $1,
        NULL,
        NULL,
        NULL,
        NULL,
        $2,
        'success',
        'info',
        'KbCandidateGenerator',
        $3::jsonb,
        NOW()
      )
    `,
    [
      `kb_candidate:${candidateId}`,
      eventType,
      JSON.stringify({
        candidate_id: candidateId,
        status: candidate.status,
        article_type: candidate.articleType,
        confidence_score: candidate.confidenceScore,
        possible_duplicate: candidate.possibleDuplicate,
        source_pattern_ids: candidate.sourcePatternIds,
        source_insight_ids: candidate.sourceInsightIds,
        created_by_glpi_user_id: createdByGlpiUserId,
      }),
    ],
  );
}
