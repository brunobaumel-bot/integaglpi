/**
 * V10 Shadow Replay Lab G9 - dry-run runner HML smoke (SQL emitter only).
 *
 * Requires: `npx tsc -p tsconfig.shadow-replay.json`
 * Imports ONLY compiled G6/G8 pure functions from dist-shadow-replay. No DB/network/env I/O.
 * Emits BEGIN + 4 INSERTs + 2 UPDATEs + SELECT counts + ROLLBACK.
 * COMMIT is always absent — safe for manual HML pipe-to-psql verification.
 *
 * PHASE: integaglpi_v10_shadow_replay_lab_g9_dry_run_runner_001
 */

import { createShadowReplaySampleEnvelope, hashShadowReplayReference } from '../dist-shadow-replay/ShadowReplaySampleSanitizer.js';
import { validateShadowReplaySampleEnvelope } from '../dist-shadow-replay/ShadowReplaySampleValidation.js';
import { runShadowReplayDryRun } from '../dist-shadow-replay/ShadowReplayDryRunEngine.js';

const SYNTHETIC_TICKET_REF = '9999000002';
const SYNTHETIC_PROTOCOL_REF = '999901';

function utcCompactTimestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return (
    String(d.getUTCFullYear()) +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds())
  );
}

function sqlLiteral(value) {
  if (value === null) return 'NULL';
  return `'${String(value).replace(/'/g, "''")}'`;
}

function sqlJson(value) {
  return sqlLiteral(JSON.stringify(value));
}

function sqlBool(value) {
  return value ? 'TRUE' : 'FALSE';
}

function buildRunnerSmokeSql() {
  const ts = utcCompactTimestamp();
  const runId = `shadow-run-g9-smoke-${ts}`;
  const sampleId = `shadow-sample-g9-smoke-${ts}`;
  const resultId = `shadow-result-g9-smoke-${ts}`;
  const startEventId = `shadow-start-event-g9-${ts}`;
  const finishEventId = `shadow-finish-event-g9-${ts}`;
  const createdAt = new Date().toISOString();

  const envelope = createShadowReplaySampleEnvelope({
    run_id: runId,
    sample_id: sampleId,
    source_kind: 'synthetic_case',
    source_ref: 'shadow-source-g9-runner-smoke',
    problem_summary: [
      `Caso sintetico G9 dry-run runner smoke.`,
      `Referencia de ticket ${SYNTHETIC_TICKET_REF} e protocolo ${SYNTHETIC_PROTOCOL_REF} devem ser redigidas.`,
      'VPN sem acesso apos autenticacao bem-sucedida.',
    ].join(' '),
    technical_summary: 'Envelope sanitizado para smoke transacional HML G9 com rollback.',
    classification: { category: 'shadow_lab', confidence: 0.88 },
    metadata: { synthetic: true, phase: 'g9', sanitized: true },
    observed_at: createdAt,
    created_at: createdAt,
  });

  const validation = validateShadowReplaySampleEnvelope(envelope);
  if (!validation.ok) {
    const codes = validation.issues.map((i) => i.code).join(',');
    throw new Error(`G9 envelope validation failed: ${codes}`);
  }

  const dryRunResult = runShadowReplayDryRun({
    envelope,
    config: {
      engine_profile: 'g9_dry_run_runner_v1',
      created_at: createdAt,
    },
  });

  const runHash = hashShadowReplayReference(`${runId}:g9:run`);
  const sampleHash = hashShadowReplayReference(`${sampleId}:g9:sample`);
  const resultHash = dryRunResult.result_hash;
  const startEventHash = hashShadowReplayReference(`${startEventId}:g9:start`);
  const finishEventHash = hashShadowReplayReference(`${finishEventId}:g9:finish`);

  const safetyFlags = { outbound_null_enforced: true, hml_only: true, dry_run: true, g9_runner: true };
  const runMetadata = { runner_version: 'g9_dry_run_runner_v1', envelope_valid: true, synthetic: true };
  const sampleInputMetadata = {
    schema_version: envelope.schema_version,
    source_kind: envelope.source_kind,
    sanitized_problem_summary: envelope.sanitized_problem_summary,
    sanitized_technical_summary: envelope.sanitized_technical_summary,
    classification_metadata: envelope.classification_metadata,
    sanitized_metadata: envelope.sanitized_metadata,
  };
  const resultOutputMetadata = {
    contract_version: dryRunResult.contract_version,
    engine_profile: dryRunResult.engine_profile,
    operations_checked_count: dryRunResult.operations_checked.length,
    operations_blocked_count: dryRunResult.operations_blocked.length,
    violations_count: dryRunResult.violations.length,
    dry_run_only: true,
    synthetic: true,
  };
  const startEventMetadata = {
    event: 'g9_dry_run_start',
    runner_version: 'g9_dry_run_runner_v1',
    envelope_valid: true,
    synthetic: true,
  };
  const finishEventMetadata = {
    event: 'g9_dry_run_finish',
    runner_version: 'g9_dry_run_runner_v1',
    dry_run_status: dryRunResult.status,
    dry_run_decision: dryRunResult.decision,
    stored: true,
    synthetic: true,
  };

  const decisionStatus = dryRunResult.status === 'passed' ? 'simulated' : 'blocked';

  const lines = [
    '-- V10 Shadow Replay G9 dry-run runner smoke (transactional: BEGIN + ROLLBACK only)',
    'BEGIN;',
    `INSERT INTO public.shadow_replay_runs
       (run_id, run_hash, status, dry_run, hml_only, outbound_null_enforced, contract_version, sanitized_metadata_json, safety_flags_json)
     VALUES
       (${sqlLiteral(runId)}, ${sqlLiteral(runHash)}, 'planned', TRUE, TRUE, TRUE, 'g3_shadow_store_v1', ${sqlJson(runMetadata)}, ${sqlJson(safetyFlags)});`,
    `UPDATE public.shadow_replay_runs SET status='running', started_at=${sqlLiteral(createdAt)} WHERE run_id=${sqlLiteral(runId)};`,
    `INSERT INTO public.shadow_replay_audit_events
       (run_id, sample_id, event_id, event_type, event_hash, severity, sanitized_event_metadata_json)
     VALUES
       (${sqlLiteral(runId)}, NULL, ${sqlLiteral(startEventId)}, 'g9_dry_run_start', ${sqlLiteral(startEventHash)}, 'info', ${sqlJson(startEventMetadata)});`,
    `INSERT INTO public.shadow_replay_samples
       (run_id, sample_id, sample_hash, source_ref_hash, sequence_no, sanitized_input_metadata_json, redaction_summary_json, safety_flags_json)
     VALUES
       (${sqlLiteral(runId)}, ${sqlLiteral(sampleId)}, ${sqlLiteral(sampleHash)}, ${sqlLiteral(envelope.source_ref_hash)}, 1, ${sqlJson(sampleInputMetadata)}, ${sqlJson(envelope.redaction_report)}, ${sqlJson(safetyFlags)});`,
    `INSERT INTO public.shadow_replay_results
       (run_id, sample_id, result_id, result_hash, engine_profile, decision_status, confidence_score, latency_ms, sanitized_output_metadata_json, safety_flags_json)
     VALUES
       (${sqlLiteral(runId)}, ${sqlLiteral(sampleId)}, ${sqlLiteral(resultId)}, ${sqlLiteral(resultHash)}, ${sqlLiteral(dryRunResult.engine_profile)}, ${sqlLiteral(decisionStatus)}, NULL, 0, ${sqlJson(resultOutputMetadata)}, ${sqlJson(safetyFlags)});`,
    `INSERT INTO public.shadow_replay_audit_events
       (run_id, sample_id, event_id, event_type, event_hash, severity, sanitized_event_metadata_json)
     VALUES
       (${sqlLiteral(runId)}, ${sqlLiteral(sampleId)}, ${sqlLiteral(finishEventId)}, 'g9_dry_run_finish', ${sqlLiteral(finishEventHash)}, 'info', ${sqlJson(finishEventMetadata)});`,
    `UPDATE public.shadow_replay_runs SET status='completed', finished_at=${sqlLiteral(createdAt)} WHERE run_id=${sqlLiteral(runId)};`,
    `SELECT 'shadow_replay_runs'        AS shadow_table, COUNT(*)::int AS row_count FROM public.shadow_replay_runs         WHERE run_id=${sqlLiteral(runId)}`,
    `UNION ALL SELECT 'shadow_replay_samples',     COUNT(*)::int FROM public.shadow_replay_samples    WHERE run_id=${sqlLiteral(runId)}`,
    `UNION ALL SELECT 'shadow_replay_results',     COUNT(*)::int FROM public.shadow_replay_results    WHERE run_id=${sqlLiteral(runId)}`,
    `UNION ALL SELECT 'shadow_replay_audit_events',COUNT(*)::int FROM public.shadow_replay_audit_events WHERE run_id=${sqlLiteral(runId)};`,
    'ROLLBACK;',
  ];

  return {
    runId,
    sampleId,
    resultId,
    startEventId,
    finishEventId,
    validationOk: validation.ok,
    dryRunStatus: dryRunResult.status,
    sql: `${lines.join('\n')}\n`,
  };
}

const smoke = buildRunnerSmokeSql();
process.stdout.write(smoke.sql);
