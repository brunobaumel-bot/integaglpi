import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  buildShadowReplayBatchScorecard,
  serializeShadowReplayBatchScorecardJson,
  serializeShadowReplayBatchScorecardMarkdown,
  SHADOW_REPLAY_BATCH_SCORECARD_VERSION,
  type ShadowReplayBatchExpectedManifest,
  type ShadowReplayBatchReportInput,
} from '../src/shadowReplay/ShadowReplayBatchScorecard.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SCORECARD_SOURCE = join(ROOT, 'src', 'shadowReplay', 'ShadowReplayBatchScorecard.ts');
const SCORECARD_SCRIPT = join(ROOT, 'scripts', 'v10ShadowReplayBatchScorecard.mjs');

const EXPECTED: ShadowReplayBatchExpectedManifest = {
  expected_processed: 2,
  expected_simulated: 2,
  expected_rejected: 1,
  expected_rejection_codes: ['raw_key_forbidden'],
  required_safety_flags: ['dry_run', 'g9_runner', 'hml_only', 'outbound_null_enforced'],
  max_failed: 0,
  max_unexpected_blocked: 0,
  pii_must_be_absent: true,
  credentials_must_be_absent: true,
};

function batchReport(overrides: Partial<ShadowReplayBatchReportInput> = {}): ShadowReplayBatchReportInput {
  return {
    summary: {
      runner_version: 'g11_manual_batch_runner_v1',
      total_lines: 3,
      processed: 2,
      simulated: 2,
      blocked: 0,
      rejected: 1,
      failed_fast: false,
      dry_run: false,
      rollback: true,
      synthetic_only: true,
      runtime_registered: false,
      worker_created: false,
      external_actions_allowed: false,
      glpi_called: false,
      meta_called: false,
      redis_touched: false,
      ai_called: false,
      operational_table_writes: false,
    },
    rejected_lines: [{ code: 'raw_key_forbidden', reason: 'Forbidden raw key at $.raw_payload' }],
    report: {
      report_version: 'g10_results_reporter_v1',
      generated_at: '2026-06-23T00:00:00.000Z',
      filters: { synthetic_only: true },
      totals: { runs: 2, samples: 2, results: 2, audit_events: 4 },
      runs_by_status: { completed: 2 },
      results_by_decision_status: { simulated: 2 },
      blocked_failed_pass: { blocked: 0, failed: 0, pass: 2 },
      durations_ms: { count: 2, min: 1, max: 2, avg: 2 },
      top_blocking_reasons: [],
      safety_flags_observed: ['dry_run', 'g9_runner', 'hml_only', 'outbound_null_enforced'],
      runs: [
        {
          run_id: 'shadow-run-g13-scorecard-001',
          status: 'completed',
          duration_ms: 1,
          sample_count: 1,
          result_decision_statuses: ['simulated'],
          audit_event_types: ['g9_dry_run_finish', 'g9_dry_run_start'],
          safety_flags: { dry_run: true, hml_only: true, outbound_null_enforced: true },
        },
      ],
      read_only: true,
      runtime_worker_created: false,
      external_actions_allowed: false,
    },
    ...overrides,
  };
}

describe('V10 Shadow Replay G13 batch scorecard', () => {
  it('returns PASS for the synthetic G12 batch shape', () => {
    const scorecard = buildShadowReplayBatchScorecard(batchReport(), EXPECTED);
    expect(scorecard.scorecard_version).toBe(SHADOW_REPLAY_BATCH_SCORECARD_VERSION);
    expect(scorecard.verdict).toBe('PASS');
    expect(scorecard.metrics.processed).toBe(2);
    expect(scorecard.metrics.rejected).toBe(1);
    expect(scorecard.safety.external_action_detected).toBe(false);
    expect(scorecard.read_only).toBe(true);
  });

  it('fails if PII is present in the report', () => {
    const report = batchReport({
      report: {
        ...batchReport().report,
        runs: [{ ...batchReport().report.runs[0]!, safety_flags: { note: 'cliente@example.com' } }],
      },
    });
    const scorecard = buildShadowReplayBatchScorecard(report, EXPECTED);
    expect(scorecard.verdict).toBe('FAIL');
    expect(scorecard.reasons).toContain('pii_detected');
  });

  it('fails if credential-like content is present', () => {
    const report = batchReport({
      report: {
        ...batchReport().report,
        runs: [{ ...batchReport().report.runs[0]!, safety_flags: { note: 'Bearer abcdefghijklmnopqrstuvwxyz' } }],
      },
    });
    const scorecard = buildShadowReplayBatchScorecard(report, EXPECTED);
    expect(scorecard.verdict).toBe('FAIL');
    expect(scorecard.reasons).toContain('credentials_detected');
  });

  it('fails if external actions are allowed', () => {
    const scorecard = buildShadowReplayBatchScorecard(
      batchReport({ summary: { ...batchReport().summary, external_actions_allowed: true } }),
      EXPECTED,
    );
    expect(scorecard.verdict).toBe('FAIL');
    expect(scorecard.reasons).toContain('external_action_detected');
  });

  it('fails if runtime or worker is reported', () => {
    const scorecard = buildShadowReplayBatchScorecard(
      batchReport({ summary: { ...batchReport().summary, worker_created: true } }),
      EXPECTED,
    );
    expect(scorecard.verdict).toBe('FAIL');
    expect(scorecard.reasons).toContain('runtime_worker_detected');
  });

  it('fails if operational tables were touched', () => {
    const scorecard = buildShadowReplayBatchScorecard(
      batchReport({ summary: { ...batchReport().summary, operational_table_writes: true } }),
      EXPECTED,
    );
    expect(scorecard.verdict).toBe('FAIL');
    expect(scorecard.reasons).toContain('operational_table_touch_detected');
  });

  it('fails on expected counter divergence', () => {
    const scorecard = buildShadowReplayBatchScorecard(
      batchReport({ summary: { ...batchReport().summary, processed: 1 } }),
      EXPECTED,
    );
    expect(scorecard.verdict).toBe('FAIL');
    expect(scorecard.reasons).toContain('processed_below_expected');
  });

  it('returns PASS_WITH_RESSALVAS for generated_at epoch cosmetic warning', () => {
    const scorecard = buildShadowReplayBatchScorecard(
      batchReport({ report: { ...batchReport().report, generated_at: '1970-01-01T00:00:00.000Z' } }),
      EXPECTED,
    );
    expect(scorecard.verdict).toBe('PASS_WITH_RESSALVAS');
    expect(scorecard.warnings).toContain('generated_at_epoch_cosmetic');
  });

  it('serializes deterministic JSON and Markdown without PII', () => {
    const scorecard = buildShadowReplayBatchScorecard(batchReport(), EXPECTED);
    const json = serializeShadowReplayBatchScorecardJson(scorecard);
    const markdown = serializeShadowReplayBatchScorecardMarkdown(scorecard);
    expect(json).toContain('"scorecard_version": "g13_batch_scorecard_v1"');
    expect(json).toContain('"verdict": "PASS"');
    expect(markdown).toContain('# Shadow Replay Batch Scorecard');
    expect(markdown).not.toContain('@');
  });
});

describe('V10 Shadow Replay G13 source isolation', () => {
  it('scorecard source is read-only and does not import DB/runtime/external adapters', () => {
    const source = readFileSync(SCORECARD_SOURCE, 'utf8');
    expect(source).not.toMatch(/from\s+['"]pg['"]/);
    expect(source).not.toMatch(/from\s+['"]ioredis['"]/);
    expect(source).not.toMatch(/from\s+['"]redis['"]/);
    expect(source).not.toMatch(/from\s+['"]node:http['"]/);
    expect(source).not.toMatch(/from\s+['"]node:https['"]/);
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/\bprocess\.env\b/);
    expect(source).not.toMatch(/\bapp\.ts\b/);
    expect(source).not.toContain('MetaClient');
    expect(source).not.toContain('GlpiClient');
  });

  it('manual CLI reads local files only and does not load dotenv or DB clients', () => {
    const source = readFileSync(SCORECARD_SCRIPT, 'utf8');
    expect(source).not.toMatch(/\bdotenv\b/);
    expect(source).not.toMatch(/from\s+['"]pg['"]/);
    expect(source).toContain('--report <batch-report.json>');
    expect(source).toContain('--expect <expected-manifest.json>');
  });
});
