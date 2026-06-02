import type { SqlExecutor } from '../../infra/db/postgres.js';

const CLOUD_AUDIT_TABLE = 'glpi_plugin_integaglpi_cloud_compliance_audit';

export interface CloudResearchAuditInput {
  glpiTicketId: number | null;
  /** Profile id — never the nominal technician id. */
  glpiProfileId: number | null;
  category: string | null;
  provider: string | null;
  /** Whether the PII Guard passed (true) or blocked the payload (false). */
  piiGuardPassed: boolean;
  /** Sanitizer-detected PII kinds (e.g. ['email','phone']). */
  piiDetectedKinds: string[];
  /** Size of the sanitized context, in chars — NOT the content. */
  requestContextChars: number;
  /** Bounded, already-sanitized request summary (no raw prompt, no PII). */
  requestSummarySanitized: string | null;
  /** sha256 of the sanitized input (for dedup/trace). */
  inputHash: string | null;
  status?: 'requested' | 'responded' | 'blocked' | 'failed';
}

export interface CloudResearchResponseInput {
  auditId: number;
  /** Bounded, sanitized response summary — never the verbatim model output beyond a summary. */
  responseSummary: string | null;
  status: 'responded' | 'failed';
}

export interface CloudAuditRepository {
  recordRequest(input: CloudResearchAuditInput): Promise<number>;
  recordResponse(input: CloudResearchResponseInput): Promise<void>;
  /** Aggregated gap report — themes that drove the most cloud usage. No technician identity. */
  getCloudGapByCategory(limit: number): Promise<Array<{ category: string; cloudCalls: number }>>;
}

function boundText(value: string | null | undefined, max: number): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const cleaned = String(value).replace(/\s+/g, ' ').trim();
  return cleaned === '' ? null : cleaned.slice(0, max);
}

export class PostgresCloudAuditRepository implements CloudAuditRepository {
  public constructor(private readonly executor: SqlExecutor) {}

  public async recordRequest(input: CloudResearchAuditInput): Promise<number> {
    const result = await this.executor.query<{ id: string }>(
      `
        INSERT INTO ${CLOUD_AUDIT_TABLE} (
          glpi_ticket_id, glpi_profile_id, category, provider, status,
          pii_guard_passed, pii_detected_kinds_json, request_context_chars,
          request_summary_sanitized, input_hash, requested_at, created_at, updated_at
        )
        VALUES (
          $1::bigint, $2::bigint, $3::text, $4::text, $5::text,
          $6::boolean, $7::jsonb, $8::int, $9::text, $10::text, NOW(), NOW(), NOW()
        )
        RETURNING id::text
      `,
      [
        input.glpiTicketId,
        input.glpiProfileId,
        boundText(input.category, 120),
        boundText(input.provider, 60),
        input.status ?? (input.piiGuardPassed ? 'requested' : 'blocked'),
        input.piiGuardPassed,
        JSON.stringify(input.piiDetectedKinds ?? []),
        Math.max(0, Math.trunc(input.requestContextChars || 0)),
        boundText(input.requestSummarySanitized, 1_000),
        boundText(input.inputHash, 80),
      ],
    );
    return parseInt(result.rows[0]?.id ?? '0', 10) || 0;
  }

  public async recordResponse(input: CloudResearchResponseInput): Promise<void> {
    await this.executor.query(
      `
        UPDATE ${CLOUD_AUDIT_TABLE}
        SET response_summary = $2::text,
            status = $3::text,
            responded_at = NOW(),
            updated_at = NOW()
        WHERE id = $1::bigint
      `,
      [input.auditId, boundText(input.responseSummary, 2_000), input.status],
    );
  }

  public async getCloudGapByCategory(limit: number): Promise<Array<{ category: string; cloudCalls: number }>> {
    const bounded = Math.max(1, Math.min(limit, 200));
    const result = await this.executor.query<{ category: string; cloud_calls: string }>(
      `
        SELECT COALESCE(category, 'sem_categoria') AS category, COUNT(*)::text AS cloud_calls
        FROM ${CLOUD_AUDIT_TABLE}
        WHERE status IN ('requested', 'responded')
        GROUP BY COALESCE(category, 'sem_categoria')
        ORDER BY COUNT(*) DESC
        LIMIT $1::int
      `,
      [bounded],
    );
    return result.rows.map((r) => ({ category: r.category, cloudCalls: parseInt(r.cloud_calls, 10) || 0 }));
  }
}
