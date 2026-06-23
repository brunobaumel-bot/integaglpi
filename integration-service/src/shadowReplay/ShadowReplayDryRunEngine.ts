/**
 * V10 Shadow Replay Lab G8 - pure dry-run replay engine contract.
 *
 * Executes no I/O. The function only validates a G6 sanitized envelope and
 * returns an in-memory synthetic result with all persistence, AI and external
 * action surfaces explicitly blocked.
 */

import { validateShadowReplaySampleEnvelope } from './ShadowReplaySampleValidation.js';
import { hashShadowReplayReference } from './ShadowReplaySampleSanitizer.js';
import type {
  ShadowReplayDryRunInput,
  ShadowReplayDryRunOperation,
  ShadowReplayDryRunResult,
  ShadowReplayDryRunViolation,
} from './ShadowReplayDryRunEngineTypes.js';
import { SHADOW_REPLAY_DRY_RUN_ENGINE_CONTRACT_VERSION } from './ShadowReplayDryRunEngineTypes.js';

const DEFAULT_ENGINE_PROFILE = 'g8_dry_run_replay_engine_contract';
const DEFAULT_CREATED_AT = '2026-06-23T00:00:00.000Z';
const HASH_RE = /^[a-f0-9]{64}$/;

function operation(kind: ShadowReplayDryRunOperation['kind'], status: ShadowReplayDryRunOperation['status'], reason: string): ShadowReplayDryRunOperation {
  return {
    kind,
    status,
    executed: false,
    reason,
  };
}

function blockedViolation(code: ShadowReplayDryRunViolation['code'], path: string, message: string): ShadowReplayDryRunViolation {
  return { code, path, message };
}

function baseOperations(envelopeValid: boolean): readonly ShadowReplayDryRunOperation[] {
  if (!envelopeValid) {
    return [
      operation('validate_envelope', 'blocked', 'Envelope validation failed before replay simulation.'),
      operation('simulate_replay_decision', 'skipped', 'Replay decision skipped because envelope is invalid.'),
      operation('shadow_store_write', 'blocked', 'Dry-run contract never writes Shadow Store.'),
      operation('ai_call', 'blocked', 'Dry-run contract never calls AI.'),
      operation('external_action', 'blocked', 'Dry-run contract never calls external services.'),
      operation('runtime_worker', 'blocked', 'Dry-run contract never creates a persistent worker.'),
    ];
  }

  return [
    operation('validate_envelope', 'simulated', 'Envelope validated in memory.'),
    operation('simulate_replay_decision', 'simulated', 'Replay decision simulated from sanitized metadata only.'),
    operation('shadow_store_write', 'blocked', 'Dry-run contract never writes Shadow Store.'),
    operation('ai_call', 'blocked', 'Dry-run contract never calls AI.'),
    operation('external_action', 'blocked', 'Dry-run contract never calls external services.'),
    operation('runtime_worker', 'blocked', 'Dry-run contract never creates a persistent worker.'),
  ];
}

function resultHash(input: ShadowReplayDryRunInput, envelopeValid: boolean): string {
  const envelope = input.envelope;
  return hashShadowReplayReference([
    SHADOW_REPLAY_DRY_RUN_ENGINE_CONTRACT_VERSION,
    envelope.run_id,
    envelope.sample_id,
    envelope.source_ref_hash,
    envelope.sanitized_problem_summary,
    envelope.sanitized_technical_summary,
    envelopeValid ? 'accepted' : 'rejected',
  ].join('|'));
}

export function runShadowReplayDryRun(input: ShadowReplayDryRunInput): ShadowReplayDryRunResult {
  const validation = validateShadowReplaySampleEnvelope(input.envelope);
  const envelopeValid = validation.ok;
  const operations = baseOperations(envelopeValid);
  const blocked = operations.filter((item) => item.status === 'blocked');
  const violations: ShadowReplayDryRunViolation[] = [];
  const safeSourceRefHash = HASH_RE.test(input.envelope.source_ref_hash)
    ? input.envelope.source_ref_hash
    : hashShadowReplayReference(`${input.envelope.run_id}:${input.envelope.sample_id}:invalid-source-ref`);

  if (!envelopeValid) {
    violations.push(blockedViolation('invalid_envelope', 'envelope', 'Envelope failed G6 validation.'));
  }
  violations.push(
    blockedViolation('shadow_store_write_blocked', 'operations.shadow_store_write', 'Shadow Store persistence is blocked in G8.'),
    blockedViolation('ai_call_blocked', 'operations.ai_call', 'AI calls are blocked in G8.'),
    blockedViolation('external_action_blocked', 'operations.external_action', 'External actions are blocked in G8.'),
    blockedViolation('runtime_worker_blocked', 'operations.runtime_worker', 'Runtime worker creation is blocked in G8.'),
  );

  return {
    contract_version: SHADOW_REPLAY_DRY_RUN_ENGINE_CONTRACT_VERSION,
    run_id: input.envelope.run_id,
    sample_id: input.envelope.sample_id,
    source_ref_hash: safeSourceRefHash,
    result_hash: resultHash(input, envelopeValid),
    status: envelopeValid ? 'passed' : 'blocked',
    decision: envelopeValid ? 'accepted_dry_run' : 'rejected_invalid_envelope',
    engine_profile: input.config?.engine_profile ?? DEFAULT_ENGINE_PROFILE,
    operations_checked: operations,
    operations_blocked: blocked,
    violations,
    envelope_validation_issues: validation.issues,
    sanitized_problem_summary: envelopeValid ? input.envelope.sanitized_problem_summary : '[invalid_envelope_rejected]',
    sanitized_technical_summary: envelopeValid ? input.envelope.sanitized_technical_summary : '',
    sanitized_metadata: envelopeValid ? input.envelope.sanitized_metadata : {},
    synthetic_metadata: {
      synthetic: true,
      phase: 'g8',
      dry_run_only: true,
      ...(input.config?.metadata ?? {}),
    },
    would_persist: false,
    external_actions_allowed: false,
    ai_called: false,
    runtime_worker_created: false,
    created_at: input.config?.created_at ?? DEFAULT_CREATED_AT,
  };
}
