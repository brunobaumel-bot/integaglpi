/**
 * V10 Shadow Replay Lab G7 - sanitized envelope store HML smoke (SQL emitter only).
 *
 * Requires: `npx tsc -p tsconfig.shadow-replay.json`
 * Imports ONLY compiled G6 pure functions from dist-shadow-replay. No DB/network/env I/O.
 *
 * PHASE: integaglpi_v10_shadow_replay_lab_g7_sanitized_envelope_store_smoke_001
 */

import { createShadowReplaySampleEnvelope, hashShadowReplayReference } from '../dist-shadow-replay/ShadowReplaySampleSanitizer.js';
import { validateShadowReplaySampleEnvelope } from '../dist-shadow-replay/ShadowReplaySampleValidation.js';

const SYNTHETIC_TICKET_REF = '9999000001';
const SYNTHETIC_PROTOCOL_REF = '999900';

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
  return `'${String(value).replace(/'/g, "''")}'`;
}

function sqlJson(value) {
  return sqlLiteral(JSON.stringify(value));
}

function buildSmokeSql() {
  const ts = utcCompactTimestamp();
  const runId = `shadow-envelope-smoke-${ts}`;
  const sampleId = `shadow-sample-envelope-smoke-${ts}`;
  const resultId = `shadow-result-envelope-smoke-${ts}`;
  const eventId = `shadow-event-envelope-smoke-${ts}`;

  const envelope = createShadowReplaySampleEnvelope({
    run_id: runId,
    sample_id: sampleId,
    source_kind: 'synthetic_case',
    source_ref: 'shadow-source-g7-envelope-smoke',
    problem_summary: [
      'Caso sintetico de envelope G7 para shadow store.',
      `Referencia de ticket ${SYNTHETIC_TICKET_REF} e protocolo ${SYNTHETIC_PROTOCOL_REF} devem ser redigidas.`,
    ].join(' '),
    technical_summary: 'Envelope sanitizado apenas para smoke transacional HML com rollback.',
    classification: { category: 'shadow_lab', confidence: 0.91 },
    metadata: { synthetic: true, phase: 'g7', sanitized: true },
    observed_at: '2026-06-23T00:00:00.000Z',
    created_at: '2026-06-23T00:00:00.000Z',
  });

  const validation = validateShadowReplaySampleEnvelope(envelope);
  if (!validation.ok) {
    const codes = validation.issues.map((issue) => issue.code).join(',');
    throw new Error(`G7 envelope validation failed: ${codes}`);
  }

  const runMetadata = { synthetic: true, phase: 'g7', sanitized: true };
  const runHash = hashShadowReplayReference(`${runId}:run`);
  const sampleHash = hashShadowReplayReference(`${sampleId}:sample`);
  const resultHash = hashShadowReplayReference(`${resultId}:result`);
  const eventHash = hashShadowReplayReference(`${eventId}:event`);
  const safetyFlags = { outbound_null_enforced: true, hml_only: true, dry_run: true };

  const sampleInputMetadata = {
    schema_version: envelope.schema_version,
    source_kind: envelope.source_kind,
    sanitized_problem_summary: envelope.sanitized_problem_summary,
    sanitized_technical_summary: envelope.sanitized_technical_summary,
    classification_metadata: envelope.classification_metadata,
    sanitized_metadata: envelope.sanitized_metadata,
  };

  const resultOutputMetadata = {
    synthetic: true,
    phase: 'g7',
    decision: 'simulated',
    envelope_schema_version: envelope.schema_version,
  };

  const auditMetadata = {
    synthetic: true,
    phase: 'g7',
    event: 'sanitized_envelope_store_smoke',
    validation_ok: true,
  };

  const lines = [
    '-- V10 Shadow Replay G7 sanitized envelope store smoke (BEGIN + ROLLBACK only)',
    'BEGIN;',
    `INSERT INTO public.shadow_replay_runs (` +
      'run_id, run_hash, status, dry_run, hml_only, outbound_null_enforced, contract_version, sanitized_metadata_json, safety_flags_json' +
      ') VALUES (' +
      `${sqlLiteral(runId)}, ${sqlLiteral(runHash)}, 'planned', TRUE, TRUE, TRUE, 'g3_shadow_store_v1', ${sqlJson(runMetadata)}, ${sqlJson(safetyFlags)});`,
    `INSERT INTO public.shadow_replay_samples (` +
      'run_id, sample_id, sample_hash, source_ref_hash, sequence_no, sanitized_input_metadata_json, redaction_summary_json, safety_flags_json' +
      ') VALUES (' +
      `${sqlLiteral(runId)}, ${sqlLiteral(sampleId)}, ${sqlLiteral(sampleHash)}, ${sqlLiteral(envelope.source_ref_hash)}, 1, ${sqlJson(sampleInputMetadata)}, ${sqlJson(envelope.redaction_report)}, ${sqlJson(safetyFlags)});`,
    `INSERT INTO public.shadow_replay_results (` +
      'run_id, sample_id, result_id, result_hash, engine_profile, decision_status, confidence_score, latency_ms, sanitized_output_metadata_json, safety_flags_json' +
      ') VALUES (' +
      `${sqlLiteral(runId)}, ${sqlLiteral(sampleId)}, ${sqlLiteral(resultId)}, ${sqlLiteral(resultHash)}, 'g7_sanitized_envelope_smoke', 'simulated', 0.9100, 0, ${sqlJson(resultOutputMetadata)}, ${sqlJson(safetyFlags)});`,
    `INSERT INTO public.shadow_replay_audit_events (` +
      'run_id, sample_id, event_id, event_type, event_hash, severity, sanitized_event_metadata_json' +
      ') VALUES (' +
      `${sqlLiteral(runId)}, ${sqlLiteral(sampleId)}, ${sqlLiteral(eventId)}, 'g7_envelope_store_smoke', ${sqlLiteral(eventHash)}, 'info', ${sqlJson(auditMetadata)});`,
    `SELECT 'shadow_replay_runs' AS shadow_table, COUNT(*)::int AS row_count FROM public.shadow_replay_runs WHERE run_id = ${sqlLiteral(runId)}`,
    `UNION ALL SELECT 'shadow_replay_samples', COUNT(*)::int FROM public.shadow_replay_samples WHERE run_id = ${sqlLiteral(runId)}`,
    `UNION ALL SELECT 'shadow_replay_results', COUNT(*)::int FROM public.shadow_replay_results WHERE run_id = ${sqlLiteral(runId)}`,
    `UNION ALL SELECT 'shadow_replay_audit_events', COUNT(*)::int FROM public.shadow_replay_audit_events WHERE run_id = ${sqlLiteral(runId)};`,
    'ROLLBACK;',
  ];

  return {
    runId,
    sampleId,
    validationOk: validation.ok,
    sql: `${lines.join('\n')}\n`,
  };
}

const smoke = buildSmokeSql();
process.stdout.write(smoke.sql);