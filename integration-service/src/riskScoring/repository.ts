import type { SqlExecutor } from '../infra/db/postgres.js';
import { calculatePredictiveRiskScore } from './engine.js';
import type {
  AiQualityRiskSignals,
  RiskScoreResult,
  RiskScoringInput,
} from './types.js';

interface AiQualityRow {
  result_json: Record<string, unknown> | string | null;
  risk_level: string | null;
  urgency: string | null;
  sentiment: string | null;
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

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean).slice(0, 10) : [];
}

function numberOrNull(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function tableExists(executor: SqlExecutor, tableName: string): Promise<boolean> {
  const result = await executor.query<{ exists: boolean }>('SELECT to_regclass($1) IS NOT NULL AS exists', [`public.${tableName}`]);
  return result.rows[0]?.exists === true;
}

export function mapAiQualityRow(row: AiQualityRow | undefined): AiQualityRiskSignals | null {
  if (!row) {
    return null;
  }
  const result = jsonObject(row.result_json);
  const communication = jsonObject(result.communicationQuality ?? result.communication_quality);
  return {
    riskLevel: String(result.riskLevel ?? result.risk_level ?? row.risk_level ?? ''),
    urgency: String(result.urgency ?? row.urgency ?? ''),
    sentiment: String(result.sentiment ?? row.sentiment ?? ''),
    clientSatisfactionRisk: String(result.clientSatisfactionRisk ?? result.client_satisfaction_risk ?? ''),
    communicationQuality: {
      clarity: numberOrNull(communication.clarity),
      empathy: numberOrNull(communication.empathy),
      completeness: numberOrNull(communication.completeness),
    },
    kbAlignment: String(result.kbAlignment ?? result.kb_alignment ?? ''),
    procedureFollowed: String(result.procedureFollowed ?? result.procedure_followed ?? ''),
    missingContext: stringArray(result.missingContext ?? result.missing_context),
    riskFlags: stringArray(result.riskFlags ?? result.risk_flags),
    qualityFlags: stringArray(result.qualityFlags ?? result.quality_flags),
  };
}

export async function loadRiskScoringInput(
  executor: SqlExecutor,
  params: { conversationId?: string; glpiTicketId?: number },
): Promise<RiskScoringInput> {
  const input: RiskScoringInput = {
    conversationId: params.conversationId ?? null,
    glpiTicketId: params.glpiTicketId ?? null,
  };

  if (await tableExists(executor, 'glpi_plugin_integaglpi_ai_quality_analyses')) {
    const result = await executor.query<AiQualityRow>(
      `
        SELECT result_json, risk_level, urgency, sentiment
          FROM public.glpi_plugin_integaglpi_ai_quality_analyses
         WHERE ($1::text IS NULL OR conversation_id = $1)
           AND ($2::bigint IS NULL OR glpi_ticket_id = $2)
         ORDER BY created_at DESC
         LIMIT 1
      `,
      [params.conversationId ?? null, params.glpiTicketId ?? null],
    );
    input.aiQuality = mapAiQualityRow(result.rows[0]);
  }

  if (await tableExists(executor, 'glpi_plugin_integaglpi_hist_patterns')) {
    const historical = await executor.query<{
      reopen_severity: 'low' | 'medium' | 'high' | null;
      dissatisfaction_severity: 'low' | 'medium' | 'high' | null;
      rework_frequency: number | null;
    }>(
      `
        SELECT
          MAX(severity) FILTER (WHERE pattern_type = 'reopen_hotspot') AS reopen_severity,
          MAX(severity) FILTER (WHERE pattern_type = 'frustration_signal') AS dissatisfaction_severity,
          COALESCE(SUM(frequency_abs) FILTER (WHERE pattern_type IN ('reopen_hotspot', 'communication_gap')), 0)::int AS rework_frequency
        FROM public.glpi_plugin_integaglpi_hist_patterns
        WHERE created_at >= NOW() - INTERVAL '180 days'
      `,
    );
    input.historical = {
      reopenPatternSeverity: historical.rows[0]?.reopen_severity ?? null,
      dissatisfactionPatternSeverity: historical.rows[0]?.dissatisfaction_severity ?? null,
      reworkCategoryFrequency: Number(historical.rows[0]?.rework_frequency ?? 0),
    };
  }

  if (await tableExists(executor, 'glpi_plugin_integaglpi_kb_candidates')) {
    const candidates = await executor.query<{ pending_count: number; duplicate_count: number }>(
      `
        SELECT
          COUNT(*) FILTER (WHERE status IN ('suggested', 'in_review', 'possible_duplicate'))::int AS pending_count,
          COUNT(*) FILTER (WHERE possible_duplicate = TRUE)::int AS duplicate_count
        FROM public.glpi_plugin_integaglpi_kb_candidates
        WHERE created_at >= NOW() - INTERVAL '180 days'
      `,
    );
    input.kbCandidates = {
      pendingCount: Number(candidates.rows[0]?.pending_count ?? 0),
      possibleDuplicateCount: Number(candidates.rows[0]?.duplicate_count ?? 0),
    };
  }

  if (await tableExists(executor, 'glpi_plugin_integaglpi_conversations')) {
    const conversation = await executor.query<{
      message_count: number;
      last_activity_age_minutes: number | null;
      reopen_count: number;
      csat_rating: string | null;
      supervisor_review_required: boolean | null;
    }>(
      `
        SELECT
          COUNT(m.id)::int AS message_count,
          EXTRACT(EPOCH FROM (NOW() - MAX(m.created_at)))::int / 60 AS last_activity_age_minutes,
          COALESCE(COUNT(sa.id) FILTER (WHERE sa.action = 'reopen' AND sa.status = 'success'), 0)::int AS reopen_count,
          MAX(sa.csat_rating) AS csat_rating,
          BOOL_OR(COALESCE(sa.supervisor_review_required, FALSE)) AS supervisor_review_required
        FROM public.glpi_plugin_integaglpi_conversations c
        LEFT JOIN public.glpi_plugin_integaglpi_messages m ON m.conversation_id = c.id
        LEFT JOIN public.glpi_plugin_integaglpi_solution_actions sa ON sa.conversation_id = c.id
        WHERE ($1::text IS NULL OR c.id = $1)
          AND ($2::bigint IS NULL OR c.glpi_ticket_id = $2)
        GROUP BY c.id
        ORDER BY MAX(m.created_at) DESC NULLS LAST
        LIMIT 1
      `,
      [params.conversationId ?? null, params.glpiTicketId ?? null],
    );
    const row = conversation.rows[0];
    if (row) {
      input.messageMetadata = {
        messageCount: Number(row.message_count ?? 0),
        lastActivityAgeMinutes: numberOrNull(row.last_activity_age_minutes),
        reopenCount: Number(row.reopen_count ?? 0),
      };
      input.csat = {
        rating: row.csat_rating,
        supervisorReviewRequired: row.supervisor_review_required === true,
      };
    }
  }

  if (params.conversationId && await tableExists(executor, 'glpi_plugin_integaglpi_inactivity_tracking')) {
    const inactivity = await executor.query<{ status: string | null; minutes_without_response: number | null }>(
      `
        SELECT
          status,
          EXTRACT(EPOCH FROM (NOW() - updated_at))::int / 60 AS minutes_without_response
        FROM public.glpi_plugin_integaglpi_inactivity_tracking
        WHERE conversation_id = $1
        LIMIT 1
      `,
      [params.conversationId],
    );
    input.slaInactivity = {
      inactivityStatus: inactivity.rows[0]?.status ?? null,
      minutesWithoutTechnicianResponse: numberOrNull(inactivity.rows[0]?.minutes_without_response),
    };
  }

  return input;
}

export async function generateAndPersistRiskScore(
  executor: SqlExecutor,
  input: RiskScoringInput,
): Promise<RiskScoreResult> {
  const result = calculatePredictiveRiskScore(input);
  await persistRiskScore(executor, result);
  return result;
}

export async function persistRiskScore(executor: SqlExecutor, result: RiskScoreResult): Promise<void> {
  await executor.query(
    `
      INSERT INTO public.glpi_plugin_integaglpi_risk_scores (
        score_id,
        conversation_id,
        glpi_ticket_id,
        model_version,
        input_hash,
        reopen_risk,
        dissatisfaction_risk,
        abandonment_risk,
        risk_score,
        confidence_score,
        reasons_json,
        suggested_human_action,
        signals_used_json,
        data_quality_warnings_json,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13::jsonb, $14::jsonb, NOW())
      ON CONFLICT (score_id) DO UPDATE SET
        risk_score = EXCLUDED.risk_score,
        confidence_score = EXCLUDED.confidence_score,
        reasons_json = EXCLUDED.reasons_json,
        suggested_human_action = EXCLUDED.suggested_human_action,
        signals_used_json = EXCLUDED.signals_used_json,
        data_quality_warnings_json = EXCLUDED.data_quality_warnings_json,
        updated_at = NOW()
    `,
    [
      result.scoreId,
      result.conversationId,
      result.glpiTicketId,
      result.modelVersion,
      result.inputHash,
      result.reopenRisk,
      result.dissatisfactionRisk,
      result.abandonmentRisk,
      result.riskScore,
      result.confidenceScore,
      JSON.stringify(result.reasons),
      result.suggestedHumanAction,
      JSON.stringify(result.signalsUsed),
      JSON.stringify(result.dataQualityWarnings),
    ],
  );

  await executor.query(
    `
      INSERT INTO public.glpi_plugin_integaglpi_audit_events (
        correlation_id,
        ticket_id,
        conversation_id,
        event_type,
        status,
        severity,
        source,
        payload_json,
        created_at
      )
      VALUES ($1, $2, $3, 'RISK_SCORE_GENERATED', 'success', 'info', 'RiskScoringService', $4::jsonb, NOW())
    `,
    [
      `risk_score:${result.scoreId}`,
      result.glpiTicketId,
      result.conversationId,
      JSON.stringify({
        score_id: result.scoreId,
        risk_score: result.riskScore,
        confidence_score: result.confidenceScore,
        model_version: result.modelVersion,
        signals_used_count: result.signalsUsed.length,
      }),
    ],
  );
}
