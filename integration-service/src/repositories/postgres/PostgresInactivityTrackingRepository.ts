import type { QueryResultRow } from 'pg';

import type { SqlExecutor } from '../../infra/db/postgres.js';
import { DATABASE_TABLES } from '../../infra/db/databaseConstants.js';
import type {
  InactivityTrackingRecord,
  InactivityTrackingRepository,
  InactivityTrackingStatus,
  PendingCsatTimeoutCandidate,
  ProfileCollectionReminderCandidate,
  TrackOutboundActivityInput,
} from '../contracts/InactivityTrackingRepository.js';

interface InactivityTrackingRow extends QueryResultRow {
  conversation_id: string;
  ticket_id: number | string | null;
  conversation_status?: string | null;
  phone_e164?: string | null;
  status: string;
  reminder_1_sent_at: Date | string | null;
  reminder_2_sent_at: Date | string | null;
  reminder_3_sent_at: Date | string | null;
  autoclose_attempted_at: Date | string | null;
  autoclose_completed_at: Date | string | null;
  last_client_activity_at: Date | string | null;
  last_outbound_activity_at: Date | string | null;
  manual_hold_until: Date | string | null;
  manual_hold_reason: string | null;
  skip_reason: string | null;
  updated_at: Date | string;
}

function asDate(value: Date | string | null): Date | null {
  if (value === null) {
    return null;
  }
  return value instanceof Date ? value : new Date(value);
}

function asNumber(value: number | string | null): number | null {
  if (value === null || value === '') {
    return null;
  }
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function asStatus(value: string): InactivityTrackingStatus {
  if (
    value === 'pending'
    || value === 'reminder_1_sent'
    || value === 'reminder_2_sent'
    || value === 'reminder_3_sent'
    || value === 'autoclose_done'
    || value === 'skipped_by_response'
    || value === 'skipped_by_hold'
    || value === 'skipped_by_closed_ticket'
    || value === 'skipped_by_feature_flag'
    || value === 'failed'
  ) {
    return value;
  }

  return 'pending';
}

function mapRow(row: InactivityTrackingRow): InactivityTrackingRecord {
  return {
    conversationId: row.conversation_id,
    ticketId: asNumber(row.ticket_id),
    conversationStatus: row.conversation_status ?? null,
    phoneE164: row.phone_e164 ?? null,
    status: asStatus(row.status),
    reminder1SentAt: asDate(row.reminder_1_sent_at),
    reminder2SentAt: asDate(row.reminder_2_sent_at),
    reminder3SentAt: asDate(row.reminder_3_sent_at),
    autocloseAttemptedAt: asDate(row.autoclose_attempted_at),
    autocloseCompletedAt: asDate(row.autoclose_completed_at),
    lastClientActivityAt: asDate(row.last_client_activity_at),
    lastOutboundActivityAt: asDate(row.last_outbound_activity_at),
    manualHoldUntil: asDate(row.manual_hold_until),
    manualHoldReason: row.manual_hold_reason,
    skipReason: row.skip_reason,
    updatedAt: asDate(row.updated_at) ?? new Date(),
  };
}

export class PostgresInactivityTrackingRepository implements InactivityTrackingRepository {
  public constructor(private readonly executor: SqlExecutor) {}

  public async trackOutboundActivity(input: TrackOutboundActivityInput): Promise<void> {
    await this.executor.query(
      `
        INSERT INTO ${DATABASE_TABLES.inactivityTracking} (
          conversation_id,
          ticket_id,
          status,
          last_outbound_activity_at,
          skip_reason,
          updated_at
        )
        VALUES ($1, $2, 'pending', $3, NULL, NOW())
        ON CONFLICT (conversation_id) DO UPDATE
        SET
          ticket_id = EXCLUDED.ticket_id,
          status = 'pending',
          reminder_1_sent_at = NULL,
          reminder_2_sent_at = NULL,
          reminder_3_sent_at = NULL,
          autoclose_attempted_at = NULL,
          autoclose_completed_at = NULL,
          last_outbound_activity_at = EXCLUDED.last_outbound_activity_at,
          skip_reason = NULL,
          updated_at = NOW()
      `,
      [input.conversationId, input.ticketId, input.occurredAt],
    );
  }

  public async findDueCandidates(limit: number): Promise<InactivityTrackingRecord[]> {
    const result = await this.executor.query<InactivityTrackingRow>(
      `
        SELECT
          t.*,
          c.status AS conversation_status,
          c.phone_e164,
          COALESCE(c.glpi_ticket_id, t.ticket_id) AS ticket_id,
          activity.last_client_activity_at,
          COALESCE(activity.last_outbound_activity_at, t.last_outbound_activity_at) AS last_outbound_activity_at
        FROM ${DATABASE_TABLES.inactivityTracking} t
        JOIN ${DATABASE_TABLES.conversations} c ON c.id = t.conversation_id
        LEFT JOIN LATERAL (
          SELECT
            MAX(created_at) FILTER (WHERE direction = 'inbound') AS last_client_activity_at,
            MAX(created_at) FILTER (
              WHERE direction = 'outbound'
                AND (idempotency_key IS NULL OR idempotency_key NOT LIKE 'inactivity:%')
            ) AS last_outbound_activity_at
          FROM ${DATABASE_TABLES.messages}
          WHERE conversation_id = t.conversation_id
        ) activity ON TRUE
        WHERE t.status IN ('pending', 'reminder_1_sent', 'reminder_2_sent', 'reminder_3_sent')
        ORDER BY COALESCE(activity.last_outbound_activity_at, t.last_outbound_activity_at, t.updated_at) ASC
        LIMIT $1
      `,
      [limit],
    );

    return result.rows.map(mapRow);
  }

  public async findProfileCollectionReminderCandidates(
    reminderCutoff: Date,
    autocloseCutoff: Date,
    limit: number,
  ): Promise<ProfileCollectionReminderCandidate[]> {
    const result = await this.executor.query<{
      id: string;
      phone_e164: string;
      status: string;
      profile_collection_state: Record<string, unknown> | null;
      last_message_at: Date | string;
      updated_at: Date | string;
    }>(
      `
        SELECT
          id,
          phone_e164,
          contact_id,
          queue_id,
          glpi_entity_id,
          glpi_entity_name,
          status,
          COALESCE(profile_collection_state, '{}'::jsonb) AS profile_collection_state,
          last_message_at,
          updated_at
        FROM ${DATABASE_TABLES.conversations}
        WHERE status IN ('collecting_contact_profile', 'awaiting_entity_selection')
          AND (glpi_ticket_id IS NULL OR glpi_ticket_id = 0)
          AND (
            (
              status = 'collecting_contact_profile'
              AND COALESCE(profile_collection_state->>'step', '') <> ''
              AND COALESCE(profile_collection_state->>'step', '') <> 'complete'
            )
            OR status = 'awaiting_entity_selection'
          )
          AND last_message_at <= $1
          AND (
            last_message_at <= $2
            OR profile_collection_state->>'profile_reminder_sent_at' IS NULL
            OR profile_collection_state->>'profile_reminder_sent_for_step'
              IS DISTINCT FROM CASE
                WHEN status = 'awaiting_entity_selection' THEN 'awaiting_entity_selection'
                ELSE COALESCE(profile_collection_state->>'step', '')
              END
          )
        ORDER BY last_message_at ASC, updated_at ASC
        LIMIT $3
      `,
      [reminderCutoff, autocloseCutoff, limit],
    );

    return result.rows.map((row) => ({
      conversationId: row.id,
      phoneE164: row.phone_e164,
      contactId: String((row as { contact_id?: unknown }).contact_id ?? ''),
      queueId: asNumber((row as { queue_id?: number | string | null }).queue_id ?? null),
      glpiEntityId: asNumber((row as { glpi_entity_id?: number | string | null }).glpi_entity_id ?? null),
      glpiEntityName: (row as { glpi_entity_name?: string | null }).glpi_entity_name ?? null,
      conversationStatus: row.status,
      profileCollectionState: row.profile_collection_state ?? {},
      lastMessageAt: row.last_message_at instanceof Date ? row.last_message_at : new Date(String(row.last_message_at)),
      updatedAt: row.updated_at instanceof Date ? row.updated_at : new Date(String(row.updated_at)),
    }));
  }

  public async findByConversationId(conversationId: string): Promise<InactivityTrackingRecord | null> {
    const result = await this.executor.query<InactivityTrackingRow>(
      `
        SELECT
          t.*,
          c.status AS conversation_status,
          c.phone_e164,
          COALESCE(c.glpi_ticket_id, t.ticket_id) AS ticket_id,
          activity.last_client_activity_at,
          COALESCE(activity.last_outbound_activity_at, t.last_outbound_activity_at) AS last_outbound_activity_at
        FROM ${DATABASE_TABLES.inactivityTracking} t
        JOIN ${DATABASE_TABLES.conversations} c ON c.id = t.conversation_id
        LEFT JOIN LATERAL (
          SELECT
            MAX(created_at) FILTER (WHERE direction = 'inbound') AS last_client_activity_at,
            MAX(created_at) FILTER (
              WHERE direction = 'outbound'
                AND (idempotency_key IS NULL OR idempotency_key NOT LIKE 'inactivity:%')
            ) AS last_outbound_activity_at
          FROM ${DATABASE_TABLES.messages}
          WHERE conversation_id = t.conversation_id
        ) activity ON TRUE
        WHERE t.conversation_id = $1
        LIMIT 1
      `,
      [conversationId],
    );

    return result.rowCount ? mapRow(result.rows[0]) : null;
  }

  public async markProfileCollectionReminderSent(
    conversationId: string,
    step: string,
    sentAt: Date,
  ): Promise<boolean> {
    const result = await this.executor.query(
      `
        UPDATE ${DATABASE_TABLES.conversations}
        SET
          profile_collection_state = COALESCE(profile_collection_state, '{}'::jsonb)
            || jsonb_build_object(
              'profile_reminder_sent_at', $3::text,
              'profile_reminder_sent_for_step', $2::text
            ),
          updated_at = NOW()
        WHERE id = $1
          AND status IN ('collecting_contact_profile', 'awaiting_entity_selection')
          AND (glpi_ticket_id IS NULL OR glpi_ticket_id = 0)
          AND CASE
            WHEN status = 'awaiting_entity_selection' THEN 'awaiting_entity_selection'
            ELSE COALESCE(profile_collection_state->>'step', '')
          END = $2
          AND (
            profile_collection_state->>'profile_reminder_sent_at' IS NULL
            OR profile_collection_state->>'profile_reminder_sent_for_step' IS DISTINCT FROM $2
          )
      `,
      [conversationId, step, sentAt.toISOString()],
    );

    return (result.rowCount ?? 0) > 0;
  }

  public async markProfileCollectionSecondReminderSent(
    conversationId: string,
    step: string,
    sentAt: Date,
  ): Promise<boolean> {
    const result = await this.executor.query(
      `
        UPDATE ${DATABASE_TABLES.conversations}
        SET
          profile_collection_state = COALESCE(profile_collection_state, '{}'::jsonb)
            || jsonb_build_object(
              'profile_reminder_2_sent_at', $3::text,
              'profile_reminder_2_sent_for_step', $2::text
            ),
          updated_at = NOW()
        WHERE id = $1
          AND status IN ('collecting_contact_profile', 'awaiting_entity_selection')
          AND (glpi_ticket_id IS NULL OR glpi_ticket_id = 0)
          AND CASE
            WHEN status = 'awaiting_entity_selection' THEN 'awaiting_entity_selection'
            ELSE COALESCE(profile_collection_state->>'step', '')
          END = $2
          AND (
            profile_collection_state->>'profile_reminder_2_sent_at' IS NULL
            OR profile_collection_state->>'profile_reminder_2_sent_for_step' IS DISTINCT FROM $2
          )
      `,
      [conversationId, step, sentAt.toISOString()],
    );

    return (result.rowCount ?? 0) > 0;
  }

  public async tryReserveProfileCollectionTimeout(
    conversationId: string,
    step: string,
    attemptedAt: Date,
  ): Promise<boolean> {
    const result = await this.executor.query(
      `
        UPDATE ${DATABASE_TABLES.conversations}
        SET
          profile_collection_state = COALESCE(profile_collection_state, '{}'::jsonb)
            || jsonb_build_object(
              'preticket_timeout_attempted_at', $3::text,
              'preticket_timeout_for_step', $2::text
            ),
          updated_at = NOW()
        WHERE id = $1
          AND status IN ('collecting_contact_profile', 'awaiting_entity_selection')
          AND (glpi_ticket_id IS NULL OR glpi_ticket_id = 0)
          AND CASE
            WHEN status = 'awaiting_entity_selection' THEN 'awaiting_entity_selection'
            ELSE COALESCE(profile_collection_state->>'step', '')
          END = $2
          AND (
            profile_collection_state->>'preticket_timeout_attempted_at' IS NULL
            OR profile_collection_state->>'preticket_timeout_for_step' IS DISTINCT FROM $2
          )
      `,
      [conversationId, step, attemptedAt.toISOString()],
    );

    return (result.rowCount ?? 0) > 0;
  }

  public async markProfileCollectionTicketOpened(
    conversationId: string,
    ticketId: number,
    openedAt: Date,
    glpiEntityId: number,
    glpiEntityName: string | null,
  ): Promise<void> {
    await this.executor.query(
      `
        UPDATE ${DATABASE_TABLES.conversations}
        SET
          glpi_ticket_id = $2,
          glpi_entity_id = $4,
          glpi_entity_name = COALESCE($5, glpi_entity_name),
          status = 'open',
          profile_collection_state = COALESCE(profile_collection_state, '{}'::jsonb)
            || jsonb_build_object(
              'preticket_timeout_ticket_opened_at', $3::text,
              'preticket_timeout_ticket_id', $2::bigint
            ),
          updated_at = NOW()
        WHERE id = $1
          AND (glpi_ticket_id IS NULL OR glpi_ticket_id = 0)
      `,
      [conversationId, ticketId, openedAt.toISOString(), glpiEntityId, glpiEntityName],
    );
  }

  public async markProfileCollectionAttentionRequired(
    conversationId: string,
    reason: string,
    occurredAt: Date,
  ): Promise<void> {
    await this.executor.query(
      `
        UPDATE ${DATABASE_TABLES.conversations}
        SET
          profile_collection_state = COALESCE(profile_collection_state, '{}'::jsonb)
            || jsonb_build_object(
              'attention_required', true,
              'attention_reason', $2::text,
              'attention_required_at', $3::text
            ),
          updated_at = NOW()
        WHERE id = $1
      `,
      [conversationId, reason.slice(0, 200), occurredAt.toISOString()],
    );
  }

  public async cancelProfileCollectionConversation(
    conversationId: string,
    step: string,
    cancelledAt: Date,
    reason: 'preticket_timeout',
  ): Promise<boolean> {
    const result = await this.executor.query(
      `
        UPDATE ${DATABASE_TABLES.conversations}
        SET
          status = 'cancelled',
          profile_collection_state = COALESCE(profile_collection_state, '{}'::jsonb)
            || jsonb_build_object(
              'close_reason', $3::text,
              'preticket_cancelled_at', $4::text,
              'preticket_cancelled_for_step', $2::text
            ),
          updated_at = NOW()
        WHERE id = $1
          AND status IN ('collecting_contact_profile', 'awaiting_entity_selection')
          AND (glpi_ticket_id IS NULL OR glpi_ticket_id = 0)
          AND CASE
            WHEN status = 'awaiting_entity_selection' THEN 'awaiting_entity_selection'
            ELSE COALESCE(profile_collection_state->>'step', '')
          END = $2
      `,
      [conversationId, step, reason, cancelledAt.toISOString()],
    );

    return (result.rowCount ?? 0) > 0;
  }

  public async markReminderSent(conversationId: string, reminderNumber: 1 | 2 | 3, sentAt: Date): Promise<void> {
    const status = `reminder_${reminderNumber}_sent`;
    const column = `reminder_${reminderNumber}_sent_at`;
    await this.executor.query(
      `
        UPDATE ${DATABASE_TABLES.inactivityTracking}
        SET ${column} = COALESCE(${column}, $2),
            status = $3,
            skip_reason = NULL,
            updated_at = NOW()
        WHERE conversation_id = $1
      `,
      [conversationId, sentAt, status],
    );
  }

  public async tryMarkAutocloseAttempted(conversationId: string, attemptedAt: Date): Promise<boolean> {
    const result = await this.executor.query(
      `
        UPDATE ${DATABASE_TABLES.inactivityTracking}
        SET autoclose_attempted_at = COALESCE(autoclose_attempted_at, $2),
            updated_at = NOW()
        WHERE conversation_id = $1
          AND autoclose_attempted_at IS NULL
          AND autoclose_completed_at IS NULL
      `,
      [conversationId, attemptedAt],
    );

    return (result.rowCount ?? 0) > 0;
  }

  public async markAutocloseCompleted(conversationId: string, completedAt: Date): Promise<void> {
    await this.executor.query(
      `
        UPDATE ${DATABASE_TABLES.inactivityTracking}
        SET autoclose_completed_at = COALESCE(autoclose_completed_at, $2),
            status = 'autoclose_done',
            skip_reason = NULL,
            updated_at = NOW()
        WHERE conversation_id = $1
      `,
      [conversationId, completedAt],
    );
  }

  public async markSkipped(conversationId: string, status: InactivityTrackingStatus, reason: string): Promise<void> {
    await this.executor.query(
      `
        UPDATE ${DATABASE_TABLES.inactivityTracking}
        SET status = $2,
            skip_reason = $3,
            updated_at = NOW()
        WHERE conversation_id = $1
      `,
      [conversationId, status, reason],
    );
  }

  public async markFailed(conversationId: string, reason: string): Promise<void> {
    await this.executor.query(
      `
        UPDATE ${DATABASE_TABLES.inactivityTracking}
        SET status = 'failed',
            skip_reason = $2,
            updated_at = NOW()
        WHERE conversation_id = $1
      `,
      [conversationId, reason.slice(0, 500)],
    );
  }

  public async findPendingCsatTimeoutCandidates(cutoff: Date, limit: number): Promise<PendingCsatTimeoutCandidate[]> {
    const result = await this.executor.query<{
      id: string;
      conversation_id: string;
      ticket_id: number | string;
      phone_e164: string;
      created_at: Date | string;
      latest_inbound_at: Date | string | null;
    }>(
      `
        SELECT
          approve.id,
          approve.conversation_id,
          approve.ticket_id,
          approve.phone_e164,
          approve.created_at,
          activity.latest_inbound_at
        FROM ${DATABASE_TABLES.solutionActions} approve
        JOIN ${DATABASE_TABLES.conversations} c ON c.id = approve.conversation_id
        LEFT JOIN LATERAL (
          SELECT MAX(created_at) FILTER (WHERE direction = 'inbound') AS latest_inbound_at
          FROM ${DATABASE_TABLES.messages}
          WHERE conversation_id = approve.conversation_id
        ) activity ON TRUE
        WHERE approve.action = 'approve'
          AND approve.status = 'success'
          AND approve.csat_rating IS NULL
          AND approve.created_at <= $1
          AND approve.csat_timeout_closed_at IS NULL
          AND approve.csat_timeout_close_attempted_at IS NULL
          AND NOT EXISTS (
            SELECT 1
            FROM ${DATABASE_TABLES.solutionActions} csat
            WHERE csat.ticket_id = approve.ticket_id
              AND csat.conversation_id = approve.conversation_id
              AND csat.action = 'approve'
              AND csat.status = 'success'
              AND csat.csat_rating IS NOT NULL
              AND csat.created_at >= approve.created_at
          )
          AND NOT EXISTS (
            SELECT 1
            FROM ${DATABASE_TABLES.solutionActions} reopen
            WHERE reopen.ticket_id = approve.ticket_id
              AND reopen.conversation_id = approve.conversation_id
              AND reopen.action = 'reopen'
              AND reopen.status = 'success'
              AND reopen.created_at > approve.created_at
          )
        ORDER BY approve.created_at ASC
        LIMIT $2
      `,
      [cutoff, limit],
    );

    return result.rows.map((row) => ({
      solutionActionId: row.id,
      conversationId: row.conversation_id,
      ticketId: Number(row.ticket_id),
      phoneE164: row.phone_e164,
      createdAt: row.created_at instanceof Date ? row.created_at : new Date(String(row.created_at)),
      latestInboundAt: row.latest_inbound_at === null
        ? null
        : row.latest_inbound_at instanceof Date
          ? row.latest_inbound_at
          : new Date(String(row.latest_inbound_at)),
    }));
  }

  public async tryReserveCsatTimeoutClose(solutionActionId: string, attemptedAt: Date): Promise<boolean> {
    const result = await this.executor.query(
      `
        UPDATE ${DATABASE_TABLES.solutionActions}
        SET csat_timeout_close_attempted_at = COALESCE(csat_timeout_close_attempted_at, $2),
            csat_timeout_skip_reason = NULL,
            updated_at = NOW()
        WHERE id = $1
          AND csat_timeout_close_attempted_at IS NULL
          AND csat_timeout_closed_at IS NULL
          AND csat_rating IS NULL
      `,
      [solutionActionId, attemptedAt],
    );

    return (result.rowCount ?? 0) > 0;
  }

  public async markCsatTimeoutClosed(solutionActionId: string, closedAt: Date): Promise<void> {
    await this.executor.query(
      `
        UPDATE ${DATABASE_TABLES.solutionActions}
        SET csat_timeout_closed_at = COALESCE(csat_timeout_closed_at, $2),
            csat_timeout_skip_reason = NULL,
            updated_at = NOW()
        WHERE id = $1
      `,
      [solutionActionId, closedAt],
    );
  }

  public async markCsatTimeoutSkipped(solutionActionId: string, reason: string): Promise<void> {
    await this.executor.query(
      `
        UPDATE ${DATABASE_TABLES.solutionActions}
        SET csat_timeout_skip_reason = $2,
            updated_at = NOW()
        WHERE id = $1
      `,
      [solutionActionId, reason.slice(0, 200)],
    );
  }

  public async setManualHold(conversationId: string, holdUntil: Date | null, reason: string | null): Promise<void> {
    await this.executor.query(
      `
        UPDATE ${DATABASE_TABLES.inactivityTracking}
        SET manual_hold_until = $2,
            manual_hold_reason = $3,
            updated_at = NOW()
        WHERE conversation_id = $1
      `,
      [conversationId, holdUntil, reason],
    );
  }
}
