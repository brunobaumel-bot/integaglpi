import type { QueryResultRow } from 'pg';

import { DATABASE_TABLES } from '../../infra/db/databaseConstants.js';
import type { SqlExecutor } from '../../infra/db/postgres.js';
import type {
  ReserveSolutionActionInput,
  ReserveSolutionActionResult,
  SolutionAction,
  SolutionActionRepository,
} from '../contracts/SolutionActionRepository.js';

interface SolutionActionRow extends QueryResultRow {
  id: string;
  action_key: string;
  whatsapp_message_id: string;
  ticket_id: string | number;
  conversation_id: string;
  phone_e164: string;
  action: 'approve' | 'reopen';
  status: 'processing' | 'success' | 'error' | 'ignored';
  previous_ticket_status: number | null;
  final_ticket_status: number | null;
  error_code: string | null;
  error_message: string | null;
  csat_rating: 'very_satisfied' | 'satisfied' | 'dissatisfied' | null;
  supervisor_review_required: boolean | null;
  created_at: Date;
  updated_at: Date;
}

function mapSolutionActionRow(row: SolutionActionRow): SolutionAction {
  return {
    id: row.id,
    actionKey: row.action_key,
    whatsappMessageId: row.whatsapp_message_id,
    ticketId: typeof row.ticket_id === 'number' ? row.ticket_id : Number.parseInt(row.ticket_id, 10),
    conversationId: row.conversation_id,
    phoneE164: row.phone_e164,
    action: row.action,
    status: row.status,
    previousTicketStatus: row.previous_ticket_status,
    finalTicketStatus: row.final_ticket_status,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    csatRating: row.csat_rating,
    supervisorReviewRequired: row.supervisor_review_required ?? false,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class PostgresSolutionActionRepository implements SolutionActionRepository {
  public constructor(private readonly executor: SqlExecutor) {}

  public async reserveAction(input: ReserveSolutionActionInput): Promise<ReserveSolutionActionResult> {
    const inserted = await this.executor.query<SolutionActionRow>(
      `
        INSERT INTO ${DATABASE_TABLES.solutionActions} (
          action_key,
          whatsapp_message_id,
          ticket_id,
          conversation_id,
          phone_e164,
          action,
          status,
          previous_ticket_status,
          csat_rating,
          supervisor_review_required
        )
        VALUES ($1, $2, $3, $4, $5, $6, 'processing', $7, $8, $9)
        ON CONFLICT (whatsapp_message_id) DO NOTHING
        RETURNING *
      `,
      [
        input.actionKey,
        input.whatsappMessageId,
        input.ticketId,
        input.conversationId,
        input.phoneE164,
        input.action,
        input.previousTicketStatus,
        input.csatRating ?? null,
        input.supervisorReviewRequired === true,
      ],
    );

    if (inserted.rowCount === 1) {
      return { reserved: true, action: mapSolutionActionRow(inserted.rows[0]) };
    }

    const existing = await this.findByWhatsappMessageId(input.whatsappMessageId);
    if (existing === null) {
      throw new Error('SOLUTION_ACTION_RESERVE_CONFLICT_WITHOUT_ROW');
    }

    return { reserved: false, action: existing };
  }

  public async markSuccess(id: string, finalTicketStatus: number): Promise<void> {
    await this.executor.query(
      `
        UPDATE ${DATABASE_TABLES.solutionActions}
        SET status = 'success',
            final_ticket_status = $2,
            error_code = NULL,
            error_message = NULL,
            updated_at = NOW()
        WHERE id = $1
      `,
      [id, finalTicketStatus],
    );
  }

  public async markError(id: string, errorCode: string, errorMessage: string): Promise<void> {
    await this.markTerminal(id, 'error', errorCode, errorMessage);
  }

  public async markIgnored(id: string, errorCode: string, errorMessage: string): Promise<void> {
    await this.markTerminal(id, 'ignored', errorCode, errorMessage);
  }

  public async findByWhatsappMessageId(messageId: string): Promise<SolutionAction | null> {
    const result = await this.executor.query<SolutionActionRow>(
      `
        SELECT *
        FROM ${DATABASE_TABLES.solutionActions}
        WHERE whatsapp_message_id = $1
        LIMIT 1
      `,
      [messageId],
    );

    return result.rowCount ? mapSolutionActionRow(result.rows[0]) : null;
  }

  public async findSuccessfulAction(actionKey: string): Promise<SolutionAction | null> {
    const result = await this.executor.query<SolutionActionRow>(
      `
        SELECT *
        FROM ${DATABASE_TABLES.solutionActions}
        WHERE action_key = $1
          AND status = 'success'
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [actionKey],
    );

    return result.rowCount ? mapSolutionActionRow(result.rows[0]) : null;
  }

  private async markTerminal(
    id: string,
    status: 'error' | 'ignored',
    errorCode: string,
    errorMessage: string,
  ): Promise<void> {
    await this.executor.query(
      `
        UPDATE ${DATABASE_TABLES.solutionActions}
        SET status = $2,
            error_code = $3,
            error_message = $4,
            updated_at = NOW()
        WHERE id = $1
      `,
      [id, status, errorCode, errorMessage.slice(0, 1000)],
    );
  }
}
