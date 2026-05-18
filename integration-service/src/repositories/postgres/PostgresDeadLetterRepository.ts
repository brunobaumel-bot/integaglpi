import type { DeadLetterAppendInput, DeadLetterRepository } from '../../domain/repositories/DeadLetterRepository.js';
import type { SqlExecutor } from '../../infra/db/postgres.js';
import { DATABASE_TABLES } from '../../infra/db/databaseConstants.js';

interface DeadLetterIdRow {
  id: number | string;
}

export class PostgresDeadLetterRepository implements DeadLetterRepository {
  public constructor(private readonly executor: SqlExecutor) {}

  public async append(input: DeadLetterAppendInput): Promise<string> {
    const result = await this.executor.query<DeadLetterIdRow>(
      `
        INSERT INTO ${DATABASE_TABLES.deadLetter} (
          correlation_id,
          conversation_id,
          message_id,
          ticket_id,
          operation_type,
          failure_type,
          failure_reason,
          payload_json,
          status,
          last_attempt_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, NOW())
        RETURNING id
      `,
      [
        input.correlationId ?? null,
        input.conversationId ?? null,
        input.messageId ?? null,
        input.ticketId ?? null,
        input.operationType,
        input.failureType,
        input.failureReason ?? null,
        JSON.stringify(input.payloadJson ?? {}),
        input.status ?? 'open',
      ],
    );

    if (!result.rowCount) {
      throw new Error('dead_letter insert did not return id');
    }

    return String(result.rows[0].id);
  }
}
