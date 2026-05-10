import type { SqlExecutor } from '../../infra/db/postgres.js';
import { DATABASE_TABLES } from '../../infra/db/databaseConstants.js';
import type {
  CreateWebhookEventInput,
  WebhookEventRepository,
} from '../contracts/WebhookEventRepository.js';

import { mapWebhookEventRow } from './postgresRowMappers.js';

export class PostgresWebhookEventRepository implements WebhookEventRepository {
  public constructor(private readonly executor: SqlExecutor) {}

  public async create(input: CreateWebhookEventInput) {
    const result = await this.executor.query<Parameters<typeof mapWebhookEventRow>[0]>(
      `
        INSERT INTO ${DATABASE_TABLES.webhookEvents} (
          event_id,
          event_type,
          payload,
          signature_valid,
          received_at,
          processing_status
        )
        VALUES ($1, $2, $3::jsonb, $4, NOW(), $5)
        ON CONFLICT (event_id)
        DO UPDATE SET
          event_type = EXCLUDED.event_type,
          payload = EXCLUDED.payload,
          signature_valid = EXCLUDED.signature_valid,
          processing_status = EXCLUDED.processing_status
        RETURNING *
      `,
      [input.eventId, input.eventType, JSON.stringify(input.payload), input.signatureValid, input.processingStatus],
    );

    return mapWebhookEventRow(result.rows[0]);
  }

  public async updateStatus(eventId: string, processingStatus: CreateWebhookEventInput['processingStatus']): Promise<void> {
    await this.executor.query(
      `
        UPDATE ${DATABASE_TABLES.webhookEvents}
        SET processing_status = $2
        WHERE event_id = $1
      `,
      [eventId, processingStatus],
    );
  }
}

