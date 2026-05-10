import type { SqlExecutor } from '../../infra/db/postgres.js';
import { DATABASE_TABLES } from '../../infra/db/databaseConstants.js';
import type { AuditEventInput, AuditEventRepository } from '../contracts/AuditEventRepository.js';

export class PostgresAuditEventRepository implements AuditEventRepository {
  public constructor(private readonly executor: SqlExecutor) {}

  public async create(input: AuditEventInput): Promise<void> {
    await this.executor.query(
      `
        INSERT INTO ${DATABASE_TABLES.auditEvents} (
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
          error_message
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11)
      `,
      [
        input.correlationId ?? null,
        input.ticketId ?? null,
        input.conversationId ?? null,
        input.messageId ?? null,
        input.direction ?? null,
        input.eventType,
        input.status,
        input.severity,
        input.source,
        input.payload === undefined ? null : JSON.stringify(input.payload),
        input.errorMessage ?? null,
      ],
    );
  }
}
