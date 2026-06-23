/**
 * V10 Shadow Replay Lab G9 - manual dry-run runner.
 *
 * Accepts a G6 sanitized envelope, executes the G8 dry-run engine and
 * persists the result to the Shadow Store via the injected contract.
 * No external services, no operational tables, no real tickets, no AI.
 */

import { runShadowReplayDryRun } from './ShadowReplayDryRunEngine.js';
import type { ShadowReplayDryRunEngineConfig } from './ShadowReplayDryRunEngineTypes.js';
import { validateShadowReplaySampleEnvelope } from './ShadowReplaySampleValidation.js';
import type { ShadowReplaySampleEnvelope } from './ShadowReplaySampleEnvelope.js';
import { hashShadowReplayReference } from './ShadowReplaySampleSanitizer.js';
import type { ShadowReplayStoreContract } from './ShadowReplayStoreContract.js';
import type {
  ShadowReplayAuditEvent,
  ShadowReplayResult,
  ShadowReplayRun,
  ShadowReplaySample,
  ShadowReplaySanitizedMetadata,
} from './ShadowReplayStoreTypes.js';

export const SHADOW_REPLAY_DRY_RUN_RUNNER_VERSION = 'g9_dry_run_runner_v1' as const;

export interface ShadowReplayDryRunRunnerInput {
  readonly envelope: ShadowReplaySampleEnvelope;
  readonly runId: string;
  readonly sampleId: string;
  readonly resultId: string;
  readonly startAuditEventId: string;
  readonly finishAuditEventId: string;
  readonly sequenceNo?: number;
  readonly createdAt?: string;
  readonly engineConfig?: ShadowReplayDryRunEngineConfig;
}

export interface ShadowReplayDryRunRunnerOutput {
  readonly runner_version: typeof SHADOW_REPLAY_DRY_RUN_RUNNER_VERSION;
  readonly run_id: string;
  readonly sample_id: string;
  readonly result_id: string;
  readonly envelope_valid: boolean;
  readonly blocked: boolean;
  readonly dry_run_status: string;
  readonly dry_run_decision: string;
  readonly result_hash: string;
  readonly stored: boolean;
  readonly run: ShadowReplayRun;
  readonly sample: ShadowReplaySample;
  readonly result: ShadowReplayResult;
  readonly audit_events: readonly ShadowReplayAuditEvent[];
  readonly would_persist: false;
  readonly external_actions_allowed: false;
  readonly ai_called: false;
  readonly runtime_worker_created: false;
}

const SAFETY_FLAGS: ShadowReplaySanitizedMetadata = {
  outbound_null_enforced: true,
  hml_only: true,
  dry_run: true,
  g9_runner: true,
};

function toReporterSafeRedactionSummary(envelope: ShadowReplaySampleEnvelope): ShadowReplaySanitizedMetadata {
  return {
    redacted_counts: Object.entries(envelope.redaction_report.redacted).map(([kind, count]) => ({ kind, count })),
    truncated_field_count: envelope.redaction_report.truncated_fields.length,
    forbidden_key_count: envelope.redaction_report.forbidden_keys.length,
    residual_pii_detected: envelope.redaction_report.residual_pii_detected,
  };
}

function toDecisionStatus(dryRunStatus: string): 'not_run' | 'simulated' | 'blocked' | 'failed' {
  if (dryRunStatus === 'passed') return 'simulated';
  if (dryRunStatus === 'blocked') return 'blocked';
  return 'failed';
}

export async function runShadowReplayDryRunManual(
  input: ShadowReplayDryRunRunnerInput,
  store: ShadowReplayStoreContract,
): Promise<ShadowReplayDryRunRunnerOutput> {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const {
    runId,
    sampleId,
    resultId,
    startAuditEventId,
    finishAuditEventId,
    envelope,
  } = input;
  const sequenceNo = input.sequenceNo ?? 1;

  const preValidation = validateShadowReplaySampleEnvelope(envelope);
  const envelopeValid = preValidation.ok;

  const dryRunResult = runShadowReplayDryRun({
    envelope,
    config: {
      engine_profile: SHADOW_REPLAY_DRY_RUN_RUNNER_VERSION,
      created_at: createdAt,
      ...input.engineConfig,
    },
  });

  const runHash = hashShadowReplayReference(`${runId}:g9:run`);
  const sampleHash = hashShadowReplayReference(`${sampleId}:g9:sample`);
  const resultHash = dryRunResult.result_hash;
  const startEventHash = hashShadowReplayReference(`${startAuditEventId}:g9:start`);
  const finishEventHash = hashShadowReplayReference(`${finishAuditEventId}:g9:finish`);

  const runMetadata: ShadowReplaySanitizedMetadata = {
    runner_version: SHADOW_REPLAY_DRY_RUN_RUNNER_VERSION,
    envelope_valid: envelopeValid,
    synthetic: true,
  };

  const sampleInputMetadata: ShadowReplaySanitizedMetadata = envelopeValid
    ? {
        schema_version: envelope.schema_version,
        source_kind: envelope.source_kind,
        sanitized_problem_summary: envelope.sanitized_problem_summary,
        sanitized_technical_summary: envelope.sanitized_technical_summary,
        classification_metadata: envelope.classification_metadata as unknown as ShadowReplaySanitizedMetadata,
        sanitized_metadata: envelope.sanitized_metadata as unknown as ShadowReplaySanitizedMetadata,
      }
    : {
        schema_version: envelope.schema_version,
        source_kind: envelope.source_kind,
        sanitized_problem_summary: '[invalid_envelope_rejected]',
        sanitized_technical_summary: '',
        classification_metadata: {},
        sanitized_metadata: {},
      };

  const resultOutputMetadata: ShadowReplaySanitizedMetadata = {
    contract_version: dryRunResult.contract_version,
    engine_profile: dryRunResult.engine_profile,
    operations_checked_count: dryRunResult.operations_checked.length,
    operations_blocked_count: dryRunResult.operations_blocked.length,
    violations_count: dryRunResult.violations.length,
    envelope_issues_count: dryRunResult.envelope_validation_issues.length,
    dry_run_only: true,
    synthetic: true,
  };

  const startEventMetadata: ShadowReplaySanitizedMetadata = {
    event: 'g9_dry_run_start',
    runner_version: SHADOW_REPLAY_DRY_RUN_RUNNER_VERSION,
    envelope_valid: envelopeValid,
    synthetic: true,
  };

  const finishEventMetadata: ShadowReplaySanitizedMetadata = {
    event: 'g9_dry_run_finish',
    runner_version: SHADOW_REPLAY_DRY_RUN_RUNNER_VERSION,
    dry_run_status: dryRunResult.status,
    dry_run_decision: dryRunResult.decision,
    stored: true,
    synthetic: true,
  };

  const run = await store.createRun({
    run_id: runId,
    run_hash: runHash,
    source_window_hash: null,
    dry_run: true,
    hml_only: true,
    outbound_null_enforced: true,
    contract_version: 'g3_shadow_store_v1',
    created_by_ref_hash: null,
    sanitized_metadata: runMetadata,
    safety_flags: SAFETY_FLAGS,
  });

  await store.markRunStarted(runId, createdAt);

  const startEvent = await store.recordAuditEvent({
    run_id: runId,
    sample_id: null,
    event_id: startAuditEventId,
    event_type: 'g9_dry_run_start',
    event_hash: startEventHash,
    actor_ref_hash: null,
    severity: 'info',
    sanitized_event_metadata: startEventMetadata,
  });

  const sample = await store.recordSample({
    run_id: runId,
    sample_id: sampleId,
    sample_hash: sampleHash,
    source_ref_hash: envelope.source_ref_hash,
    tenant_ref_hash: null,
    category_key: null,
    sequence_no: sequenceNo,
    sanitized_input_metadata: sampleInputMetadata,
    redaction_summary: toReporterSafeRedactionSummary(envelope),
    safety_flags: SAFETY_FLAGS,
  });

  const result = await store.recordResult({
    run_id: runId,
    sample_id: sampleId,
    result_id: resultId,
    result_hash: resultHash,
    engine_profile: dryRunResult.engine_profile,
    decision_status: toDecisionStatus(dryRunResult.status),
    confidence_score: null,
    latency_ms: 0,
    output_summary_hash: null,
    evidence_hash: null,
    error_code: envelopeValid ? null : 'invalid_envelope',
    sanitized_output_metadata: resultOutputMetadata,
    safety_flags: SAFETY_FLAGS,
  });

  const finishEvent = await store.recordAuditEvent({
    run_id: runId,
    sample_id: sampleId,
    event_id: finishAuditEventId,
    event_type: 'g9_dry_run_finish',
    event_hash: finishEventHash,
    actor_ref_hash: null,
    severity: envelopeValid ? 'info' : 'warning',
    sanitized_event_metadata: finishEventMetadata,
  });

  await store.markRunFinished(runId, envelopeValid ? 'completed' : 'failed', createdAt);

  const storedRun = (await store.findRunById(runId)) ?? run;

  return {
    runner_version: SHADOW_REPLAY_DRY_RUN_RUNNER_VERSION,
    run_id: runId,
    sample_id: sampleId,
    result_id: resultId,
    envelope_valid: envelopeValid,
    blocked: !envelopeValid,
    dry_run_status: dryRunResult.status,
    dry_run_decision: dryRunResult.decision,
    result_hash: resultHash,
    stored: true,
    run: storedRun,
    sample,
    result,
    audit_events: [startEvent, finishEvent],
    would_persist: false,
    external_actions_allowed: false,
    ai_called: false,
    runtime_worker_created: false,
  };
}
