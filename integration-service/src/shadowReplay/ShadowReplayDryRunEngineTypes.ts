/**
 * V10 Shadow Replay Lab G8 - dry-run replay engine contract types.
 *
 * Contract-only boundary for in-memory synthetic replay simulation. No database,
 * cache, network, AI provider or operational adapter is allowed in this layer.
 */

import type { ShadowReplaySampleEnvelope, ShadowReplaySampleValidationIssue } from './ShadowReplaySampleEnvelope.js';
import type { ShadowReplayHash, ShadowReplaySanitizedMetadata } from './ShadowReplayStoreTypes.js';

export const SHADOW_REPLAY_DRY_RUN_ENGINE_CONTRACT_VERSION = 'g8_dry_run_engine_v1' as const;

export type ShadowReplayDryRunDecision = 'accepted_dry_run' | 'rejected_invalid_envelope';

export type ShadowReplayDryRunStatus = 'passed' | 'blocked';

export type ShadowReplayDryRunOperationKind =
  | 'validate_envelope'
  | 'simulate_replay_decision'
  | 'shadow_store_write'
  | 'ai_call'
  | 'external_action'
  | 'runtime_worker';

export type ShadowReplayDryRunOperationStatus = 'simulated' | 'blocked' | 'skipped';

export type ShadowReplayDryRunViolationCode =
  | 'invalid_envelope'
  | 'shadow_store_write_blocked'
  | 'ai_call_blocked'
  | 'external_action_blocked'
  | 'runtime_worker_blocked';

export interface ShadowReplayDryRunEngineConfig {
  readonly engine_profile?: string;
  readonly created_at?: string;
  readonly metadata?: ShadowReplaySanitizedMetadata;
}

export interface ShadowReplayDryRunInput {
  readonly envelope: ShadowReplaySampleEnvelope;
  readonly config?: ShadowReplayDryRunEngineConfig;
}

export interface ShadowReplayDryRunOperation {
  readonly kind: ShadowReplayDryRunOperationKind;
  readonly status: ShadowReplayDryRunOperationStatus;
  readonly executed: false;
  readonly reason: string;
}

export interface ShadowReplayDryRunViolation {
  readonly code: ShadowReplayDryRunViolationCode;
  readonly path: string;
  readonly message: string;
}

export interface ShadowReplayDryRunResult {
  readonly contract_version: typeof SHADOW_REPLAY_DRY_RUN_ENGINE_CONTRACT_VERSION;
  readonly run_id: string;
  readonly sample_id: string;
  readonly source_ref_hash: ShadowReplayHash;
  readonly result_hash: ShadowReplayHash;
  readonly status: ShadowReplayDryRunStatus;
  readonly decision: ShadowReplayDryRunDecision;
  readonly engine_profile: string;
  readonly operations_checked: readonly ShadowReplayDryRunOperation[];
  readonly operations_blocked: readonly ShadowReplayDryRunOperation[];
  readonly violations: readonly ShadowReplayDryRunViolation[];
  readonly envelope_validation_issues: readonly ShadowReplaySampleValidationIssue[];
  readonly sanitized_problem_summary: string;
  readonly sanitized_technical_summary: string;
  readonly sanitized_metadata: ShadowReplaySanitizedMetadata;
  readonly synthetic_metadata: ShadowReplaySanitizedMetadata;
  readonly would_persist: false;
  readonly external_actions_allowed: false;
  readonly ai_called: false;
  readonly runtime_worker_created: false;
  readonly created_at: string;
}
