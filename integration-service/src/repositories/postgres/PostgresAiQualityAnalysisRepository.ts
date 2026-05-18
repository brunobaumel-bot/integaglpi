import type { QueryResultRow } from 'pg';

import type { AiQualityContext } from '../../ai/aiQualityTypes.js';
import { DATABASE_TABLES } from '../../infra/db/databaseConstants.js';
import type { SqlExecutor } from '../../infra/db/postgres.js';
import type {
  AiQualityAnalysisRecord,
  AiQualityAnalysisRepository,
  AiQualityAnalysisStatus,
  AiQualitySupervisorFeedback,
  CreateAiQualityPendingInput,
} from '../contracts/AiQualityAnalysisRepository.js';
import type { AiQualityResult } from '../../ai/aiQualityTypes.js';

interface AiQualityAnalysisRow extends QueryResultRow {
  id: string | number;
  conversation_id: string;
  glpi_ticket_id: string | number;
  analysis_version: string;
  provider: string;
  model: string;
  status: AiQualityAnalysisStatus;
  classification_resolution: string | null;
  sentiment: string | null;
  flags: string[] | string | null;
  summary: string | null;
  recommendation: string | null;
  result_json: Record<string, unknown> | null;
  supervisor_feedback: AiQualitySupervisorFeedback | null;
  feedback_notes: string | null;
  created_by: string | number | null;
  created_at: Date;
  updated_at: Date;
}

interface AiQualityContextRow extends QueryResultRow {
  conversation_id: string;
  glpi_ticket_id: string | number;
  ticket_status: string | null;
  csat_rating: string | null;
  supervisor_review_required: boolean | null;
  inactivity_status: string | null;
  requester_name: string | null;
}

interface AiQualityMessageRow extends QueryResultRow {
  direction: string;
  message_type: string;
  message_text: string | null;
  created_at: Date;
}

function parseFlags(value: string[] | string | null): string[] {
  if (Array.isArray(value)) {
    return value.map(String);
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function mapAiQualityAnalysisRow(row: AiQualityAnalysisRow): AiQualityAnalysisRecord {
  return {
    id: String(row.id),
    conversationId: row.conversation_id,
    glpiTicketId: typeof row.glpi_ticket_id === 'number' ? row.glpi_ticket_id : Number(row.glpi_ticket_id),
    analysisVersion: row.analysis_version,
    provider: row.provider,
    model: row.model,
    status: row.status,
    classificationResolution: row.classification_resolution,
    sentiment: row.sentiment,
    flags: parseFlags(row.flags),
    summary: row.summary,
    recommendation: row.recommendation,
    resultJson: row.result_json,
    supervisorFeedback: row.supervisor_feedback,
    feedbackNotes: row.feedback_notes,
    createdBy: row.created_by === null ? null : Number(row.created_by),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class PostgresAiQualityAnalysisRepository implements AiQualityAnalysisRepository {
  public constructor(private readonly executor: SqlExecutor) {}

  public async getContext(
    conversationId: string,
    glpiTicketId: number,
    maxMessages: number,
  ): Promise<AiQualityContext | null> {
    const contextResult = await this.executor.query<AiQualityContextRow>(
      `
        SELECT
          c.id AS conversation_id,
          c.glpi_ticket_id,
          c.status AS ticket_status,
          cp.requester_name,
          sa.csat_rating,
          COALESCE(sa.supervisor_review_required, FALSE) AS supervisor_review_required,
          it.status AS inactivity_status
        FROM ${DATABASE_TABLES.conversations} c
        LEFT JOIN ${DATABASE_TABLES.contactProfile} cp
          ON cp.phone_e164 = c.phone_e164
         AND cp.is_active = TRUE
        LEFT JOIN LATERAL (
          SELECT csat_rating, supervisor_review_required
          FROM ${DATABASE_TABLES.solutionActions}
          WHERE ticket_id = c.glpi_ticket_id
          ORDER BY updated_at DESC
          LIMIT 1
        ) sa ON TRUE
        LEFT JOIN ${DATABASE_TABLES.inactivityTracking} it
          ON it.conversation_id = c.id
        WHERE c.id = $1
          AND c.glpi_ticket_id = $2
        LIMIT 1
      `,
      [conversationId, glpiTicketId],
    );

    if (!contextResult.rowCount) {
      return null;
    }

    const messagesResult = await this.executor.query<AiQualityMessageRow>(
      `
        SELECT direction, message_type, message_text, created_at
        FROM (
          SELECT direction, message_type, message_text, created_at
          FROM ${DATABASE_TABLES.messages}
          WHERE conversation_id = $1
            AND message_text IS NOT NULL
            AND trim(message_text) <> ''
          ORDER BY created_at DESC, id DESC
          LIMIT $2
        ) recent_messages
        ORDER BY created_at ASC
      `,
      [conversationId, Math.max(1, Math.min(maxMessages, 30))],
    );

    const context = contextResult.rows[0];

    return {
      conversationId: context.conversation_id,
      glpiTicketId: Number(context.glpi_ticket_id),
      ticketStatus: context.ticket_status,
      csatRating: context.csat_rating,
      supervisorReviewRequired: context.supervisor_review_required === true,
      inactivityStatus: context.inactivity_status,
      requesterName: context.requester_name,
      messages: messagesResult.rows.map((row) => ({
        direction: row.direction,
        messageType: row.message_type,
        messageText: row.message_text ?? '',
        createdAt: row.created_at,
      })),
    };
  }

  public async createPending(input: CreateAiQualityPendingInput): Promise<AiQualityAnalysisRecord> {
    const result = await this.executor.query<AiQualityAnalysisRow>(
      `
        INSERT INTO ${DATABASE_TABLES.aiQualityAnalyses} (
          conversation_id,
          glpi_ticket_id,
          analysis_version,
          provider,
          model,
          status,
          created_by
        )
        VALUES ($1, $2, $3, $4, $5, 'pending', $6)
        RETURNING *
      `,
      [
        input.conversationId,
        input.glpiTicketId,
        input.analysisVersion,
        input.provider,
        input.model,
        input.createdBy,
      ],
    );

    return mapAiQualityAnalysisRow(result.rows[0]);
  }

  public async markCompleted(id: string, result: AiQualityResult): Promise<AiQualityAnalysisRecord> {
    const updated = await this.executor.query<AiQualityAnalysisRow>(
      `
        UPDATE ${DATABASE_TABLES.aiQualityAnalyses}
        SET
          status = 'completed',
          classification_resolution = $2,
          sentiment = $3,
          flags = $4::jsonb,
          summary = $5,
          recommendation = $6,
          result_json = $7::jsonb,
          updated_at = NOW()
        WHERE id = $1
        RETURNING *
      `,
      [
        id,
        result.resolution,
        result.sentiment,
        JSON.stringify(result.flags),
        result.summary,
        result.recommendation,
        JSON.stringify(result),
      ],
    );

    return mapAiQualityAnalysisRow(updated.rows[0]);
  }

  public async markFailed(id: string, errorMessage: string): Promise<AiQualityAnalysisRecord> {
    return this.markTerminal(id, 'failed', errorMessage);
  }

  public async markSkipped(id: string, reason: string): Promise<AiQualityAnalysisRecord> {
    return this.markTerminal(id, 'skipped', reason);
  }

  public async saveFeedback(
    id: string,
    feedback: AiQualitySupervisorFeedback,
    notes: string | null,
  ): Promise<AiQualityAnalysisRecord | null> {
    const result = await this.executor.query<AiQualityAnalysisRow>(
      `
        UPDATE ${DATABASE_TABLES.aiQualityAnalyses}
        SET
          supervisor_feedback = $2,
          feedback_notes = $3,
          updated_at = NOW()
        WHERE id = $1
        RETURNING *
      `,
      [id, feedback, notes],
    );

    return result.rowCount ? mapAiQualityAnalysisRow(result.rows[0]) : null;
  }

  private async markTerminal(
    id: string,
    status: 'failed' | 'skipped',
    reason: string,
  ): Promise<AiQualityAnalysisRecord> {
    const result = await this.executor.query<AiQualityAnalysisRow>(
      `
        UPDATE ${DATABASE_TABLES.aiQualityAnalyses}
        SET
          status = $2,
          result_json = $3::jsonb,
          updated_at = NOW()
        WHERE id = $1
        RETURNING *
      `,
      [id, status, JSON.stringify({ error: reason.slice(0, 200) })],
    );

    return mapAiQualityAnalysisRow(result.rows[0]);
  }
}
