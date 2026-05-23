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
  conversation_status: string | null;
  queue_name: string | null;
  glpi_entity_name: string | null;
  service_name: string | null;
  sla_response_deadline: Date | null;
  sla_solution_deadline: Date | null;
  accumulated_paused_minutes: string | number | null;
  reopen_count: string | number | null;
  csat_rating: string | null;
  supervisor_review_required: boolean | null;
  inactivity_status: string | null;
  inactivity_skip_reason: string | null;
  requester_name: string | null;
}

interface AiQualityMessageRow extends QueryResultRow {
  direction: string;
  message_type: string;
  message_text: string | null;
  created_at: Date;
}

interface AiQualityEventRow extends QueryResultRow {
  event_type: string;
  status: string | null;
  severity: string | null;
  error_message: string | null;
  created_at: Date;
}

interface AiQualityAttachmentRow extends QueryResultRow {
  message_type: string;
  attachment_status: string | null;
  attachment_mime_detected: string | null;
  attachment_size_bytes: string | number | null;
  attachment_filename_sanitized: string | null;
  created_at: Date;
}

interface AiQualityDeliveryFailureRow extends QueryResultRow {
  message_type: string;
  delivery_status: string | null;
  meta_error_message_sanitized: string | null;
  created_at: Date;
}

interface AiQualityTemplateEventRow extends QueryResultRow {
  template_name: string | null;
  delivery_status: string | null;
  meta_error_message_sanitized: string | null;
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

function legacySentimentForStorage(result: AiQualityResult): string {
  if (result.riskLevel === 'critical') {
    return 'high_risk';
  }

  return matchSentiment(result.sentiment);
}

function matchSentiment(sentiment: AiQualityResult['sentiment']): string {
  switch (sentiment) {
    case 'positive':
      return 'satisfied';
    case 'negative':
    case 'frustrated':
      return 'dissatisfied';
    case 'neutral':
    case 'unknown':
    default:
      return 'neutral';
  }
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
          c.status AS conversation_status,
          q.name AS queue_name,
          c.glpi_entity_name,
          sc.name AS service_name,
          c.sla_response_deadline,
          c.sla_solution_deadline,
          c.accumulated_paused_minutes,
          c.reopen_count,
          c.inactivity_skip_reason,
          cp.requester_name,
          sa.csat_rating,
          COALESCE(sa.supervisor_review_required, FALSE) AS supervisor_review_required,
          it.status AS inactivity_status
        FROM ${DATABASE_TABLES.conversations} c
        LEFT JOIN ${DATABASE_TABLES.queues} q
          ON q.id = c.queue_id
        LEFT JOIN ${DATABASE_TABLES.serviceCatalog} sc
          ON sc.id = c.glpi_service_catalog_id
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
    const eventsResult = await this.executor.query<AiQualityEventRow>(
      `
        SELECT event_type, status, severity, error_message, created_at
        FROM ${DATABASE_TABLES.auditEvents}
        WHERE conversation_id = $1
           OR ticket_id = $2
        ORDER BY created_at DESC, id DESC
        LIMIT 8
      `,
      [conversationId, glpiTicketId],
    );
    const attachmentsResult = await this.executor.query<AiQualityAttachmentRow>(
      `
        SELECT
          message_type,
          attachment_status,
          attachment_mime_detected,
          attachment_size_bytes,
          attachment_filename_sanitized,
          created_at
        FROM ${DATABASE_TABLES.messages}
        WHERE conversation_id = $1
          AND (
            attachment_status IS NOT NULL
            OR attachment_mime_detected IS NOT NULL
            OR attachment_filename_sanitized IS NOT NULL
            OR message_type IN ('image', 'audio', 'video', 'document')
          )
        ORDER BY created_at DESC, id DESC
        LIMIT 8
      `,
      [conversationId],
    );
    const deliveryFailuresResult = await this.executor.query<AiQualityDeliveryFailureRow>(
      `
        SELECT message_type, delivery_status, meta_error_message_sanitized, created_at
        FROM ${DATABASE_TABLES.messages}
        WHERE conversation_id = $1
          AND (
            delivery_status = 'failed'
            OR meta_error_message_sanitized IS NOT NULL
          )
        ORDER BY created_at DESC, id DESC
        LIMIT 5
      `,
      [conversationId],
    );
    const templateEventsResult = await this.executor.query<AiQualityTemplateEventRow>(
      `
        SELECT raw_payload->>'template_name' AS template_name, delivery_status, meta_error_message_sanitized, created_at
        FROM ${DATABASE_TABLES.messages}
        WHERE conversation_id = $1
          AND message_type = 'template'
        ORDER BY created_at DESC, id DESC
        LIMIT 5
      `,
      [conversationId],
    );

    const context = contextResult.rows[0];

    return {
      conversationId: context.conversation_id,
      glpiTicketId: Number(context.glpi_ticket_id),
      ticketStatus: context.ticket_status,
      conversationStatus: context.conversation_status,
      queueName: context.queue_name,
      entityName: context.glpi_entity_name,
      serviceName: context.service_name,
      slaResponseDeadline: context.sla_response_deadline,
      slaSolutionDeadline: context.sla_solution_deadline,
      accumulatedPausedMinutes: context.accumulated_paused_minutes === null ? null : Number(context.accumulated_paused_minutes),
      reopenCount: context.reopen_count === null ? null : Number(context.reopen_count),
      csatRating: context.csat_rating,
      supervisorReviewRequired: context.supervisor_review_required === true,
      inactivityStatus: context.inactivity_status,
      inactivitySkipReason: context.inactivity_skip_reason,
      requesterName: context.requester_name,
      messages: messagesResult.rows.map((row) => ({
        direction: row.direction,
        messageType: row.message_type,
        messageText: row.message_text ?? '',
        createdAt: row.created_at,
      })),
      recentEvents: eventsResult.rows.map((row) => ({
        eventType: row.event_type,
        status: row.status,
        severity: row.severity,
        errorSummary: row.error_message,
        createdAt: row.created_at,
      })),
      attachmentMetadata: attachmentsResult.rows.map((row) => ({
        messageType: row.message_type,
        status: row.attachment_status,
        mimeDetected: row.attachment_mime_detected,
        sizeBytes: row.attachment_size_bytes === null ? null : Number(row.attachment_size_bytes),
        fileName: row.attachment_filename_sanitized,
        createdAt: row.created_at,
      })),
      deliveryFailures: deliveryFailuresResult.rows.map((row) => ({
        messageType: row.message_type,
        deliveryStatus: row.delivery_status,
        metaErrorMessage: row.meta_error_message_sanitized,
        createdAt: row.created_at,
      })),
      templateEvents: templateEventsResult.rows.map((row) => ({
        templateName: row.template_name,
        deliveryStatus: row.delivery_status,
        metaErrorMessage: row.meta_error_message_sanitized,
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
        legacySentimentForStorage(result),
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
