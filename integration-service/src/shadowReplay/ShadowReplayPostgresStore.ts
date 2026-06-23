/**
 * V10 Shadow Replay Lab G9 - PostgreSQL implementation of ShadowReplayStoreContract.
 *
 * Writes ONLY to shadow_replay_* tables. Never touches operational tables.
 * Pool is injected — this module never reads env vars or creates its own connection.
 */

import type { Pool } from 'pg';

import type { ShadowReplayStoreContract } from './ShadowReplayStoreContract.js';
import type {
  ShadowReplayAuditEvent,
  ShadowReplayAuditEventCreate,
  ShadowReplayResult,
  ShadowReplayResultCreate,
  ShadowReplayRun,
  ShadowReplayRunCreate,
  ShadowReplaySample,
  ShadowReplaySampleCreate,
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
    throw new Error(`ShadowReplayPostgresStore: write to operational table '${name}' is forbidden.`);
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
    confidence_score: (row['confidence_score'] as number | null) ?? null,
    latency_ms: (row['latency_ms'] as number | null) ?? null,
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

export class ShadowReplayPostgresStore implements ShadowReplayStoreContract {
  constructor(private readonly pool: Pool) {}

  async createRun(input: ShadowReplayRunCreate): Promise<ShadowReplayRun> {
    guardTable('shadow_replay_runs');
    const { rows } = await this.pool.query<Record<string, unknown>>(
      `INSERT INTO public.shadow_replay_runs
         (run_id, run_hash, source_window_hash, status, dry_run, hml_only,
          outbound_null_enforced, contract_version, created_by_ref_hash,
          sanitized_metadata_json, safety_flags_json)
       VALUES ($1,$2,$3,$4,TRUE,TRUE,TRUE,$5,$6,$7,$8)
       RETURNING *`,
      [
        input.run_id,
        input.run_hash,
        input.source_window_hash ?? null,
        input.status ?? 'planned',
        input.contract_version,
        input.created_by_ref_hash ?? null,
        JSON.stringify(input.sanitized_metadata),
        JSON.stringify(input.safety_flags),
      ],
    );
    return rowToRun(rows[0]!);
  }

  async markRunStarted(runId: string, at: string): Promise<ShadowReplayRun> {
    guardTable('shadow_replay_runs');
    const { rows } = await this.pool.query<Record<string, unknown>>(
      `UPDATE public.shadow_replay_runs
          SET status='running', started_at=$2
        WHERE run_id=$1
       RETURNING *`,
      [runId, at],
    );
    return rowToRun(rows[0]!);
  }

  async markRunFinished(
    runId: string,
    status: 'completed' | 'failed' | 'aborted',
    at: string,
  ): Promise<ShadowReplayRun> {
    guardTable('shadow_replay_runs');
    const { rows } = await this.pool.query<Record<string, unknown>>(
      `UPDATE public.shadow_replay_runs
          SET status=$2, finished_at=$3
        WHERE run_id=$1
       RETURNING *`,
      [runId, status, at],
    );
    return rowToRun(rows[0]!);
  }

  async recordSample(input: ShadowReplaySampleCreate): Promise<ShadowReplaySample> {
    guardTable('shadow_replay_samples');
    const { rows } = await this.pool.query<Record<string, unknown>>(
      `INSERT INTO public.shadow_replay_samples
         (run_id, sample_id, sample_hash, source_ref_hash, tenant_ref_hash,
          category_key, sequence_no, sanitized_input_metadata_json,
          redaction_summary_json, safety_flags_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [
        input.run_id,
        input.sample_id,
        input.sample_hash,
        input.source_ref_hash,
        input.tenant_ref_hash ?? null,
        input.category_key ?? null,
        input.sequence_no,
        JSON.stringify(input.sanitized_input_metadata),
        JSON.stringify(input.redaction_summary),
        JSON.stringify(input.safety_flags),
      ],
    );
    return rowToSample(rows[0]!);
  }

  async recordResult(input: ShadowReplayResultCreate): Promise<ShadowReplayResult> {
    guardTable('shadow_replay_results');
    const { rows } = await this.pool.query<Record<string, unknown>>(
      `INSERT INTO public.shadow_replay_results
         (run_id, sample_id, result_id, result_hash, engine_profile, decision_status,
          confidence_score, latency_ms, output_summary_hash, evidence_hash, error_code,
          sanitized_output_metadata_json, safety_flags_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [
        input.run_id,
        input.sample_id,
        input.result_id,
        input.result_hash,
        input.engine_profile,
        input.decision_status,
        input.confidence_score ?? null,
        input.latency_ms ?? null,
        input.output_summary_hash ?? null,
        input.evidence_hash ?? null,
        input.error_code ?? null,
        JSON.stringify(input.sanitized_output_metadata),
        JSON.stringify(input.safety_flags),
      ],
    );
    return rowToResult(rows[0]!);
  }

  async recordAuditEvent(input: ShadowReplayAuditEventCreate): Promise<ShadowReplayAuditEvent> {
    guardTable('shadow_replay_audit_events');
    const { rows } = await this.pool.query<Record<string, unknown>>(
      `INSERT INTO public.shadow_replay_audit_events
         (run_id, sample_id, event_id, event_type, event_hash, actor_ref_hash,
          severity, sanitized_event_metadata_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [
        input.run_id,
        input.sample_id ?? null,
        input.event_id,
        input.event_type,
        input.event_hash,
        input.actor_ref_hash ?? null,
        input.severity,
        JSON.stringify(input.sanitized_event_metadata),
      ],
    );
    return rowToAuditEvent(rows[0]!);
  }

  async findRunById(runId: string): Promise<ShadowReplayRun | null> {
    guardTable('shadow_replay_runs');
    const { rows } = await this.pool.query<Record<string, unknown>>(
      `SELECT * FROM public.shadow_replay_runs WHERE run_id=$1 LIMIT 1`,
      [runId],
    );
    return rows[0] != null ? rowToRun(rows[0]) : null;
  }

  async listSamplesByRun(runId: string, limit: number): Promise<readonly ShadowReplaySample[]> {
    guardTable('shadow_replay_samples');
    const { rows } = await this.pool.query<Record<string, unknown>>(
      `SELECT * FROM public.shadow_replay_samples WHERE run_id=$1 ORDER BY sequence_no LIMIT $2`,
      [runId, limit],
    );
    return rows.map(rowToSample);
  }
}
