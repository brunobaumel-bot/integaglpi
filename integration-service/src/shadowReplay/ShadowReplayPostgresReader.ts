/**
 * V10 Shadow Replay Lab G10 - PostgreSQL read-only Shadow Store adapter.
 *
 * SELECT-only on shadow_replay_* tables. Pool is injected; no env reads here.
 */

import type { Pool } from 'pg';

import type { ShadowReplayResultsReporterFilter, ShadowReplayStoreReadContract } from './ShadowReplayStoreReadContract.js';
import type {
  ShadowReplayAuditEvent,
  ShadowReplayResult,
  ShadowReplayRun,
  ShadowReplaySample,
  ShadowReplaySanitizedMetadata,
} from './ShadowReplayStoreTypes.js';

const ALLOWED_TABLES = new Set([
  'shadow_replay_runs',
  'shadow_replay_samples',
  'shadow_replay_results',
  'shadow_replay_audit_events',
]);

function guardTable(name: string): void {
  if (!ALLOWED_TABLES.has(name)) {
    throw new Error(`ShadowReplayPostgresReader: read from operational table '${name}' is forbidden.`);
  }
}

function rowToRun(row: Record<string, unknown>): ShadowReplayRun {
  return {
    run_id: row['run_id'] as string,
    run_hash: row['run_hash'] as string,
    source_window_hash: (row['source_window_hash'] as string | null) ?? null,
    status: row['status'] as ShadowReplayRun['status'],
    dry_run: true,
    hml_only: true,
    outbound_null_enforced: true,
    contract_version: 'g3_shadow_store_v1',
    created_by_ref_hash: (row['created_by_ref_hash'] as string | null) ?? null,
    started_at: (row['started_at'] as string | null) ?? null,
    finished_at: (row['finished_at'] as string | null) ?? null,
    created_at: row['created_at'] as string,
    sanitized_metadata: ((row['sanitized_metadata_json'] ?? {}) as unknown) as ShadowReplaySanitizedMetadata,
    safety_flags: ((row['safety_flags_json'] ?? {}) as unknown) as ShadowReplaySanitizedMetadata,
  };
}

function rowToSample(row: Record<string, unknown>): ShadowReplaySample {
  return {
    run_id: row['run_id'] as string,
    sample_id: row['sample_id'] as string,
    sample_hash: row['sample_hash'] as string,
    source_ref_hash: row['source_ref_hash'] as string,
    tenant_ref_hash: (row['tenant_ref_hash'] as string | null) ?? null,
    category_key: (row['category_key'] as string | null) ?? null,
    sequence_no: row['sequence_no'] as number,
    created_at: row['created_at'] as string,
    sanitized_input_metadata: ((row['sanitized_input_metadata_json'] ?? {}) as unknown) as ShadowReplaySanitizedMetadata,
    redaction_summary: ((row['redaction_summary_json'] ?? {}) as unknown) as ShadowReplaySanitizedMetadata,
    safety_flags: ((row['safety_flags_json'] ?? {}) as unknown) as ShadowReplaySanitizedMetadata,
  };
}

function rowToResult(row: Record<string, unknown>): ShadowReplayResult {
  return {
    run_id: row['run_id'] as string,
    sample_id: row['sample_id'] as string,
    result_id: row['result_id'] as string,
    result_hash: row['result_hash'] as string,
    engine_profile: row['engine_profile'] as string,
    decision_status: row['decision_status'] as ShadowReplayResult['decision_status'],
    confidence_score: row['confidence_score'] == null ? null : Number(row['confidence_score']),
    latency_ms: row['latency_ms'] == null ? null : Number(row['latency_ms']),
    output_summary_hash: (row['output_summary_hash'] as string | null) ?? null,
    evidence_hash: (row['evidence_hash'] as string | null) ?? null,
    error_code: (row['error_code'] as string | null) ?? null,
    created_at: row['created_at'] as string,
    sanitized_output_metadata: ((row['sanitized_output_metadata_json'] ?? {}) as unknown) as ShadowReplaySanitizedMetadata,
    safety_flags: ((row['safety_flags_json'] ?? {}) as unknown) as ShadowReplaySanitizedMetadata,
  };
}

function rowToAuditEvent(row: Record<string, unknown>): ShadowReplayAuditEvent {
  return {
    run_id: row['run_id'] as string,
    sample_id: (row['sample_id'] as string | null) ?? null,
    event_id: row['event_id'] as string,
    event_type: row['event_type'] as string,
    event_hash: row['event_hash'] as string,
    actor_ref_hash: (row['actor_ref_hash'] as string | null) ?? null,
    severity: row['severity'] as ShadowReplayAuditEvent['severity'],
    created_at: row['created_at'] as string,
    sanitized_event_metadata: ((row['sanitized_event_metadata_json'] ?? {}) as unknown) as ShadowReplaySanitizedMetadata,
  };
}

type ShadowReplayReadTable = 'runs' | 'samples' | 'results' | 'audit_events';

function syntheticOnlyClause(table: ShadowReplayReadTable, alias: string): string {
  if (table === 'runs') {
    return `(COALESCE((${alias}.sanitized_metadata_json->>'synthetic')::boolean, FALSE) = TRUE OR COALESCE((${alias}.safety_flags_json->>'synthetic')::boolean, FALSE) = TRUE OR ${alias}.run_id LIKE 'shadow-%')`;
  }
  if (table === 'samples') {
    return `(COALESCE((${alias}.sanitized_input_metadata_json->>'synthetic')::boolean, FALSE) = TRUE OR COALESCE((${alias}.safety_flags_json->>'synthetic')::boolean, FALSE) = TRUE OR ${alias}.run_id LIKE 'shadow-%' OR ${alias}.sample_id LIKE 'shadow-%')`;
  }
  if (table === 'results') {
    return `(COALESCE((${alias}.safety_flags_json->>'synthetic')::boolean, FALSE) = TRUE OR ${alias}.run_id LIKE 'shadow-%')`;
  }
  return `(COALESCE((${alias}.sanitized_event_metadata_json->>'synthetic')::boolean, FALSE) = TRUE OR ${alias}.run_id LIKE 'shadow-%')`;
}

function buildWhereClause(
  filter: ShadowReplayResultsReporterFilter,
  table: ShadowReplayReadTable,
  alias: string,
): { sql: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (filter.run_id) {
    params.push(filter.run_id);
    clauses.push(`${alias}.run_id = $${params.length}`);
  }
  if (table === 'runs' && filter.status) {
    const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
    params.push(statuses);
    clauses.push(`${alias}.status = ANY($${params.length}::text[])`);
  }
  if (filter.from) {
    params.push(filter.from);
    clauses.push(`${alias}.created_at >= $${params.length}::timestamptz`);
  }
  if (filter.to) {
    params.push(filter.to);
    clauses.push(`${alias}.created_at <= $${params.length}::timestamptz`);
  }
  if (filter.synthetic_only) {
    clauses.push(syntheticOnlyClause(table, alias));
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  return { sql: where, params };
}

export class ShadowReplayPostgresReader implements ShadowReplayStoreReadContract {
  constructor(private readonly pool: Pool) {}

  async listRuns(filter: ShadowReplayResultsReporterFilter): Promise<readonly ShadowReplayRun[]> {
    guardTable('shadow_replay_runs');
    const limit = filter.limit ?? 500;
    const { sql, params } = buildWhereClause(filter, 'runs', 'r');
    params.push(limit);
    const { rows } = await this.pool.query<Record<string, unknown>>(
      `SELECT * FROM public.shadow_replay_runs r ${sql} ORDER BY r.created_at DESC LIMIT $${params.length}`,
      params,
    );
    return rows.map(rowToRun);
  }

  async listSamples(filter: ShadowReplayResultsReporterFilter): Promise<readonly ShadowReplaySample[]> {
    guardTable('shadow_replay_samples');
    const limit = filter.limit ?? 2000;
    const { sql, params } = buildWhereClause(filter, 'samples', 's');
    params.push(limit);
    const { rows } = await this.pool.query<Record<string, unknown>>(
      `SELECT * FROM public.shadow_replay_samples s ${sql} ORDER BY s.created_at DESC LIMIT $${params.length}`,
      params,
    );
    return rows.map(rowToSample);
  }

  async listResults(filter: ShadowReplayResultsReporterFilter): Promise<readonly ShadowReplayResult[]> {
    guardTable('shadow_replay_results');
    const limit = filter.limit ?? 2000;
    const { sql, params } = buildWhereClause(filter, 'results', 'r');
    params.push(limit);
    const { rows } = await this.pool.query<Record<string, unknown>>(
      `SELECT * FROM public.shadow_replay_results r ${sql} ORDER BY r.created_at DESC LIMIT $${params.length}`,
      params,
    );
    return rows.map(rowToResult);
  }

  async listAuditEvents(filter: ShadowReplayResultsReporterFilter): Promise<readonly ShadowReplayAuditEvent[]> {
    guardTable('shadow_replay_audit_events');
    const limit = filter.limit ?? 5000;
    const { sql, params } = buildWhereClause(filter, 'audit_events', 'e');
    params.push(limit);
    const { rows } = await this.pool.query<Record<string, unknown>>(
      `SELECT * FROM public.shadow_replay_audit_events e ${sql} ORDER BY e.created_at DESC LIMIT $${params.length}`,
      params,
    );
    return rows.map(rowToAuditEvent);
  }
}
