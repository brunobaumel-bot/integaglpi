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
}

interface CountRow {
  count: string;
}

type InvalidConversationRow = {
  id: string;
  status: string;
  glpi_ticket_id: string | null;
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

    return {
      orphanMessages,
      mediaWithoutInfo,
      invalidConversationStates,
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
}
