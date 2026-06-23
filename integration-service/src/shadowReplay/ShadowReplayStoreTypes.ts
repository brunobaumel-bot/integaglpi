/**
 * V10 Shadow Replay Lab G3 - Shadow Store contract types.
 *
 * Type-only model for a future isolated store. These types intentionally use
 * hash references and sanitized metadata only: no raw source bodies and no
 * direct references to operational records.
 */

export type ShadowReplayHash = string;
export type ShadowReplayReferenceId = string;

export type ShadowReplaySanitizedValue =
  | string
  | number
  | boolean
  | null
  | readonly ShadowReplaySanitizedValue[]
  | { readonly [key: string]: ShadowReplaySanitizedValue };

export type ShadowReplaySanitizedMetadata = Readonly<Record<string, ShadowReplaySanitizedValue>>;

export type ShadowReplayRunStatus = 'planned' | 'running' | 'completed' | 'failed' | 'aborted';
export type ShadowReplayDecisionStatus = 'not_run' | 'simulated' | 'blocked' | 'failed';
export type ShadowReplayAuditSeverity = 'debug' | 'info' | 'warning' | 'error';

export interface ShadowReplayRun {
  readonly run_id: ShadowReplayReferenceId;
  readonly run_hash: ShadowReplayHash;
  readonly source_window_hash: ShadowReplayHash | null;
  readonly status: ShadowReplayRunStatus;
  readonly dry_run: true;
  readonly hml_only: true;
  readonly outbound_null_enforced: true;
  readonly contract_version: 'g3_shadow_store_v1';
  readonly created_by_ref_hash: ShadowReplayHash | null;
  readonly started_at: string | null;
  readonly finished_at: string | null;
  readonly created_at: string;
  readonly sanitized_metadata: ShadowReplaySanitizedMetadata;
  readonly safety_flags: ShadowReplaySanitizedMetadata;
}

export interface ShadowReplaySample {
  readonly run_id: ShadowReplayReferenceId;
  readonly sample_id: ShadowReplayReferenceId;
  readonly sample_hash: ShadowReplayHash;
  readonly source_ref_hash: ShadowReplayHash;
  readonly tenant_ref_hash: ShadowReplayHash | null;
  readonly category_key: string | null;
  readonly sequence_no: number;
  readonly created_at: string;
  readonly sanitized_input_metadata: ShadowReplaySanitizedMetadata;
  readonly redaction_summary: ShadowReplaySanitizedMetadata;
  readonly safety_flags: ShadowReplaySanitizedMetadata;
}

export interface ShadowReplayResult {
  readonly run_id: ShadowReplayReferenceId;
  readonly sample_id: ShadowReplayReferenceId;
  readonly result_id: ShadowReplayReferenceId;
  readonly result_hash: ShadowReplayHash;
  readonly engine_profile: string;
  readonly decision_status: ShadowReplayDecisionStatus;
  readonly confidence_score: number | null;
  readonly latency_ms: number | null;
  readonly output_summary_hash: ShadowReplayHash | null;
  readonly evidence_hash: ShadowReplayHash | null;
  readonly error_code: string | null;
  readonly created_at: string;
  readonly sanitized_output_metadata: ShadowReplaySanitizedMetadata;
  readonly safety_flags: ShadowReplaySanitizedMetadata;
}

export interface ShadowReplayAuditEvent {
  readonly run_id: ShadowReplayReferenceId;
  readonly sample_id: ShadowReplayReferenceId | null;
  readonly event_id: ShadowReplayReferenceId;
  readonly event_type: string;
  readonly event_hash: ShadowReplayHash;
  readonly actor_ref_hash: ShadowReplayHash | null;
  readonly severity: ShadowReplayAuditSeverity;
  readonly created_at: string;
  readonly sanitized_event_metadata: ShadowReplaySanitizedMetadata;
}

export type ShadowReplayRunCreate = Omit<ShadowReplayRun, 'created_at' | 'started_at' | 'finished_at' | 'status'> & {
  readonly status?: ShadowReplayRunStatus;
};

export type ShadowReplaySampleCreate = Omit<ShadowReplaySample, 'created_at'>;
export type ShadowReplayResultCreate = Omit<ShadowReplayResult, 'created_at'>;
export type ShadowReplayAuditEventCreate = Omit<ShadowReplayAuditEvent, 'created_at'>;
