import type { SqlExecutor } from '../../infra/db/postgres.js';
import { DATABASE_TABLES } from '../../infra/db/databaseConstants.js';
import type { AuditService } from './AuditService.js';
import { createCorrelationId } from './correlationId.js';

export interface OperationalIntegrityAuditOptions {
  since?: Date;
  limit?: number;
  correlationId?: string;
}

export interface OperationalIntegrityAuditResult {
  orphanMessages: number;
  mediaWithoutInfo: number;
  invalidConversationStates: number;
  staleAwaitingQueueSelection: number;
}

interface CountRow {
  count: string;
}

type InvalidConversationRow = {
  id: string;
  status: string;
  glpi_ticket_id: string | null;
};

type StaleAwaitingQueueSelectionRow = {
  id: string;
  updated_at: string | Date;
  inbound_messages_count: string | number;
  last_inbound_at: string | Date | null;
};

export class OperationalIntegrityAuditService {
  public constructor(
    private readonly executor: SqlExecutor,
    private readonly auditService: AuditService,
  ) {}

  public async auditOperationalIntegrity(
    options: OperationalIntegrityAuditOptions = {},
  ): Promise<OperationalIntegrityAuditResult> {
    const since = options.since ?? new Date(Date.now() - 24 * 60 * 60 * 1_000);
    const limit = Math.max(1, Math.min(options.limit ?? 100, 500));
    const correlationId = options.correlationId ?? createCorrelationId();

    const orphanMessages = await this.auditOrphanMessages(since, limit, correlationId);
    const mediaWithoutInfo = await this.auditMediaWithoutInfo(since, limit, correlationId);
    const invalidConversationStates = await this.auditInvalidConversationStates(limit, correlationId);
    const staleAwaitingQueueSelection = await this.auditStaleAwaitingQueueSelection(since, limit, correlationId);

    return {
      orphanMessages,
      mediaWithoutInfo,
      invalidConversationStates,
      staleAwaitingQueueSelection,
    };
  }

  private async auditOrphanMessages(since: Date, limit: number, correlationId: string): Promise<number> {
    const result = await this.executor.query<{ id: string; message_id: string }>(
      `
        SELECT id, message_id
        FROM ${DATABASE_TABLES.messages}
        WHERE created_at >= $1
          AND processing_status IN ('processed', 'sent')
          AND conversation_id IS NULL
        ORDER BY created_at DESC
        LIMIT $2
      `,
      [since, limit],
    );

    for (const row of result.rows) {
      this.auditService.recordAuditEventFireAndForget({
        correlationId,
        messageId: row.message_id,
        eventType: 'ORPHAN_MESSAGE',
        status: 'failed',
        severity: 'warning',
        source: 'OperationalIntegrityAuditService',
        payload: { message_row_id: row.id },
      });
    }

    return result.rowCount ?? result.rows.length;
  }

  private async auditMediaWithoutInfo(since: Date, limit: number, correlationId: string): Promise<number> {
    const result = await this.executor.query<{ id: string; message_id: string; conversation_id: string | null }>(
      `
        SELECT id, message_id, conversation_id
        FROM ${DATABASE_TABLES.messages}
        WHERE created_at >= $1
          AND message_type IN ('image', 'document', 'audio')
          AND media_info IS NULL
        ORDER BY created_at DESC
        LIMIT $2
      `,
      [since, limit],
    );

    for (const row of result.rows) {
      this.auditService.recordAuditEventFireAndForget({
        correlationId,
        conversationId: row.conversation_id,
        messageId: row.message_id,
        eventType: 'ORPHAN_MESSAGE',
        status: 'failed',
        severity: 'warning',
        source: 'OperationalIntegrityAuditService',
        payload: { message_row_id: row.id, reason: 'media_info_missing' },
      });
    }

    return result.rowCount ?? result.rows.length;
  }

  private async auditInvalidConversationStates(limit: number, correlationId: string): Promise<number> {
    const result = await this.executor.query<InvalidConversationRow>(
      `
        SELECT id, status, glpi_ticket_id
        FROM ${DATABASE_TABLES.conversations}
        WHERE status NOT IN ('awaiting_queue_selection', 'open', 'closed', 'pending_glpi')
           OR (status = 'open' AND glpi_ticket_id IS NULL)
        ORDER BY updated_at DESC
        LIMIT $1
      `,
      [limit],
    );

    for (const row of result.rows) {
      this.auditService.recordAuditEventFireAndForget({
        correlationId,
        conversationId: row.id,
        ticketId: row.glpi_ticket_id === null ? null : Number(row.glpi_ticket_id),
        eventType: row.status === 'open' && row.glpi_ticket_id === null ? 'ORPHAN_CONVERSATION' : 'INVALID_STATE',
        status: 'failed',
        severity: 'warning',
        source: 'OperationalIntegrityAuditService',
        payload: { conversation_status: row.status },
      });
    }

    return result.rowCount ?? result.rows.length;
  }

  private async auditStaleAwaitingQueueSelection(since: Date, limit: number, correlationId: string): Promise<number> {
    const result = await this.executor.query<StaleAwaitingQueueSelectionRow>(
      `
        SELECT
          c.id,
          c.updated_at,
          COUNT(m.id) FILTER (WHERE m.direction = 'inbound') AS inbound_messages_count,
          MAX(m.created_at) FILTER (WHERE m.direction = 'inbound') AS last_inbound_at
        FROM ${DATABASE_TABLES.conversations} c
        LEFT JOIN ${DATABASE_TABLES.messages} m ON m.conversation_id = c.id
        WHERE c.status = 'awaiting_queue_selection'
          AND c.updated_at < $1
        GROUP BY c.id, c.updated_at
        ORDER BY c.updated_at ASC
        LIMIT $2
      `,
      [since, limit],
    );

    for (const row of result.rows) {
      this.auditService.recordAuditEventFireAndForget({
        correlationId,
        conversationId: row.id,
        eventType: 'AWAITING_QUEUE_SELECTION_STALE',
        status: 'pending',
        severity: 'warning',
        source: 'OperationalIntegrityAuditService',
        payload: {
          conversation_status: 'awaiting_queue_selection',
          updated_at: row.updated_at,
          inbound_messages_count: Number(row.inbound_messages_count ?? 0),
          last_inbound_at: row.last_inbound_at,
          remediation: 'manual_queue_selection_required',
        },
      });
    }

    return result.rowCount ?? result.rows.length;
  }
}
