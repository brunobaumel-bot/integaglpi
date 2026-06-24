/**
 * PostgresRagAuditRepository
 *
 * Writes RAG copilot audit records to the existing audit_events table.
 * Never stores raw queries, PII, or technician identities beyond the
 * hashed query and a numeric technician_id for de-duplication.
 *
 * Phase: integaglpi_local_kb_rag_technician_copilot_001
 */

import type { SqlExecutor } from '../../infra/db/postgres.js';
import type { RagAuditPort, RagAuditEvent } from '../../domain/services/KbRagCopilotService.js';

const AUDIT_TABLE = 'glpi_plugin_integaglpi_audit_events';

export class PostgresRagAuditRepository implements RagAuditPort {
  public constructor(private readonly executor: SqlExecutor) {}

  public async writeRagAudit(event: RagAuditEvent): Promise<void> {
    const payload = {
      query_hash: event.queryHash,
      kb_ids_used: event.kbIdsUsed,
      ranking_scores: event.rankingScores,
      source: event.source,
      local_ai_used: event.localAiUsed,
      deterministic_fallback: event.deterministicFallback,
      technician_id: event.technicianId,
      kb_count: event.kbIdsUsed.length,
      // Search Planner summary (product:intent:source) — stored in payload_json, no migration needed
      plan_summary: event.planSummary ?? null,
    };

    await this.executor.query(
      `
        INSERT INTO ${AUDIT_TABLE} (
          correlation_id, ticket_id, event_type, status, severity, source, payload_json, created_at
        )
        VALUES (
          $1::text, $2::bigint, 'kb_rag_search', 'ok', 'info', 'local_kb', $3::jsonb, NOW()
        )
      `,
      [
        `rag-${event.queryHash}-${Date.now()}`,
        event.ticketId,
        JSON.stringify(payload),
      ],
    );
  }
}
