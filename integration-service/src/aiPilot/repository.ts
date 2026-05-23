import type { SqlExecutor } from '../infra/db/postgres.js';
import type { AiPilotUsageRecord } from './types.js';

export class AiPilotRepository {
  public constructor(private readonly executor: SqlExecutor) {}

  public async recordUsage(record: AiPilotUsageRecord): Promise<void> {
    await this.executor.query(
      `
        INSERT INTO public.glpi_plugin_integaglpi_ai_pilot_usage (
          request_id,
          provider,
          model,
          operation_type,
          status,
          estimated_cost,
          actual_cost,
          input_hash,
          anonymized_payload_hash,
          blocked_reason,
          latency_ms,
          requested_by_glpi_user_id,
          created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
        ON CONFLICT (request_id) DO NOTHING
      `,
      [
        record.requestId,
        record.provider,
        record.model,
        record.operationType,
        record.status,
        record.estimatedCost,
        record.actualCost,
        record.inputHash,
        record.anonymizedPayloadHash,
        record.blockedReason,
        record.latencyMs,
        record.requestedByGlpiUserId,
      ],
    );
  }
}
