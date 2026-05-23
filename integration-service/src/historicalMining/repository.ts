import type { SqlExecutor } from '../infra/db/postgres.js';
import type { HistoricalMiningResult } from './types.js';

export async function persistHistoricalMiningResult(
  executor: SqlExecutor,
  result: HistoricalMiningResult,
  createdBy: string | null = null,
): Promise<void> {
  await executor.query(
    `
      INSERT INTO public.glpi_plugin_integaglpi_hist_mining_runs (
        run_id,
        input_hash,
        window_start,
        window_end,
        status,
        rows_seen,
        rows_processed,
        created_by,
        completed_at
      )
      VALUES ($1, $2, $3, $4, 'completed', $5, $6, $7, NOW())
      ON CONFLICT (run_id) DO NOTHING
    `,
    [
      result.run.runId,
      result.run.inputHash,
      result.run.windowStart,
      result.run.windowEnd,
      result.run.rowsSeen,
      result.run.rowsProcessed,
      createdBy,
    ],
  );

  const patternIds = new Map<number, number>();
  for (const [index, pattern] of result.patterns.entries()) {
    const saved = await executor.query<{ id: number }>(
      `
        INSERT INTO public.glpi_plugin_integaglpi_hist_patterns (
          run_id,
          pattern_type,
          category,
          entity_label_sanitized,
          frequency_abs,
          severity,
          description_sanitized,
          evidence_hashes_json
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
        RETURNING id
      `,
      [
        result.run.runId,
        pattern.patternType,
        pattern.category,
        pattern.entityLabelSanitized,
        pattern.frequencyAbs,
        pattern.severity,
        pattern.descriptionSanitized,
        JSON.stringify(pattern.evidenceHashes),
      ],
    );
    patternIds.set(index, saved.rows[0].id);
  }

  const insightIds = new Map<number, number>();
  for (const [index, insight] of result.insights.entries()) {
    const saved = await executor.query<{ id: number }>(
      `
        INSERT INTO public.glpi_plugin_integaglpi_hist_insights (
          run_id,
          insight_type,
          priority,
          title,
          summary_sanitized,
          recommendation_sanitized,
          confidence_score,
          filters_json
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
        RETURNING id
      `,
      [
        result.run.runId,
        insight.insightType,
        insight.priority,
        insight.title,
        insight.summarySanitized,
        insight.recommendationSanitized,
        insight.confidenceScore,
        JSON.stringify(insight.filters),
      ],
    );
    insightIds.set(index, saved.rows[0].id);
  }

  for (const evidence of result.evidence.slice(0, 200)) {
    const patternIndex = result.patterns.findIndex((pattern) => pattern.patternType === evidence.patternType);
    const insightIndex = result.insights.findIndex((insight) => insight.insightType === evidence.insightType);
    await executor.query(
      `
        INSERT INTO public.glpi_plugin_integaglpi_hist_evidence (
          run_id,
          ticket_id_hash,
          pattern_id,
          insight_id,
          anonymized_excerpt
        )
        VALUES ($1, $2, $3, $4, $5)
      `,
      [
        result.run.runId,
        evidence.ticketIdHash,
        patternIndex >= 0 ? patternIds.get(patternIndex) ?? null : null,
        insightIndex >= 0 ? insightIds.get(insightIndex) ?? null : null,
        evidence.anonymizedExcerpt,
      ],
    );
  }
}
