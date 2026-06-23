import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  InMemoryShadowReplayBatchStore,
  parseShadowReplayJsonl,
  runShadowReplayManualBatch,
  serializeShadowReplayManualBatchJson,
  serializeShadowReplayManualBatchMarkdown,
  SHADOW_REPLAY_MANUAL_BATCH_RUNNER_VERSION,
} from '../src/shadowReplay/ShadowReplayManualBatchRunner.js';
import { SHADOW_REPLAY_SAMPLE_ENVELOPE_SCHEMA_VERSION, type ShadowReplaySampleEnvelope } from '../src/shadowReplay/ShadowReplaySampleEnvelope.js';
import { createShadowReplaySampleEnvelope } from '../src/shadowReplay/ShadowReplaySampleSanitizer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const BATCH_RUNNER_SOURCE = join(ROOT, 'src', 'shadowReplay', 'ShadowReplayManualBatchRunner.ts');
const BATCH_SCRIPT_SOURCE = join(ROOT, 'scripts', 'v10ShadowReplayManualBatchRunner.mjs');

function envelope(index: number): ShadowReplaySampleEnvelope {
  return createShadowReplaySampleEnvelope({
    run_id: `shadow-run-g11-test-${String(index).padStart(3, '0')}`,
    sample_id: `shadow-sample-g11-test-${String(index).padStart(3, '0')}`,
    source_kind: 'synthetic_case',
    source_ref: `shadow-source-g11-test-${index}`,
    problem_summary: `Caso sintetico G11 ${index}: VPN sem acesso ao sistema.`,
    technical_summary: `Resumo tecnico sintetico G11 ${index}.`,
    classification: { category: 'vpn', confidence: 0.9 },
    metadata: { synthetic: true, phase: 'g11', fixture_index: index },
    observed_at: '2026-06-23T00:00:00.000Z',
    created_at: '2026-06-23T00:00:00.000Z',
  });
}

function jsonl(items: readonly unknown[]): string {
  return `${items.map((item) => JSON.stringify(item)).join('\n')}\n`;
}

describe('V10 Shadow Replay G11 manual batch runner', () => {
  it('processes valid JSONL with multiple sanitized envelopes', async () => {
    const store = new InMemoryShadowReplayBatchStore();
    const result = await runShadowReplayManualBatch(
      jsonl([envelope(1), envelope(2)]),
      store,
      { syntheticOnly: true, createdAt: '2026-06-23T00:00:00.000Z' },
    );

    expect(result.summary.runner_version).toBe(SHADOW_REPLAY_MANUAL_BATCH_RUNNER_VERSION);
    expect(result.summary.total_lines).toBe(2);
    expect(result.summary.processed).toBe(2);
    expect(result.summary.simulated).toBe(2);
    expect(result.summary.blocked).toBe(0);
    expect(result.summary.rejected).toBe(0);
    expect(result.report.totals).toEqual({ runs: 2, samples: 2, results: 2, audit_events: 4 });
  });

  it('reports invalid JSONL lines without executing them', () => {
    const parsed = parseShadowReplayJsonl(`${JSON.stringify(envelope(1))}\n{not-json}\n`);
    expect(parsed.envelopes).toHaveLength(1);
    expect(parsed.rejected).toEqual([{ line_no: 2, reason: 'Invalid JSONL line.', code: 'invalid_json' }]);
  });

  it('rejects raw_payload before calling G9', async () => {
    const store = new InMemoryShadowReplayBatchStore();
    const contaminated = { ...envelope(1), raw_payload: { text: 'raw body' } };
    const result = await runShadowReplayManualBatch(jsonl([contaminated]), store);
    expect(result.summary.processed).toBe(0);
    expect(result.summary.rejected).toBe(1);
    expect(result.rejected_lines[0]?.code).toBe('raw_key_forbidden');
  });

  it('rejects source_ref when it is not a hash', async () => {
    const store = new InMemoryShadowReplayBatchStore();
    const contaminated = { ...envelope(1), source_ref: 'raw-ticket-or-message-ref' };
    const result = await runShadowReplayManualBatch(jsonl([contaminated]), store);
    expect(result.summary.processed).toBe(0);
    expect(result.rejected_lines[0]?.code).toBe('source_ref_not_hash');
  });

  it('blocks residual PII through G6/G9 without echoing the value', async () => {
    const store = new InMemoryShadowReplayBatchStore();
    const contaminated = {
      ...envelope(1),
      sanitized_problem_summary: 'contato residual cliente@example.com',
    };
    const result = await runShadowReplayManualBatch(jsonl([contaminated]), store);
    const serialized = JSON.stringify(result);
    expect(result.summary.processed).toBe(1);
    expect(result.summary.blocked).toBe(1);
    expect(result.outputs[0]?.result.decision_status).toBe('blocked');
    expect(serialized).not.toContain('cliente@example.com');
  });

  it('supports fail-fast for rejected lines', async () => {
    const store = new InMemoryShadowReplayBatchStore();
    const result = await runShadowReplayManualBatch(`{bad-json}\n${JSON.stringify(envelope(2))}\n`, store, { failFast: true });
    expect(result.summary.failed_fast).toBe(true);
    expect(result.summary.processed).toBe(0);
    expect(result.summary.rejected).toBe(1);
  });

  it('dry-run uses in-memory storage even when a store is provided', async () => {
    const store = new InMemoryShadowReplayBatchStore();
    const result = await runShadowReplayManualBatch(jsonl([envelope(1)]), store, { dryRun: true });
    expect(result.summary.dry_run).toBe(true);
    expect(result.summary.processed).toBe(1);
    expect(store.runs.size).toBe(0);
    expect(store.operationalTableWrites).toBe(0);
  });

  it('marks rollback intent in the deterministic summary', async () => {
    const store = new InMemoryShadowReplayBatchStore();
    const result = await runShadowReplayManualBatch(jsonl([envelope(1)]), store, { rollback: true });
    expect(result.summary.rollback).toBe(true);
    expect(result.summary.operational_table_writes).toBe(false);
  });

  it('serializes final JSON and Markdown summaries via G10 report data', async () => {
    const store = new InMemoryShadowReplayBatchStore();
    const result = await runShadowReplayManualBatch(jsonl([envelope(1)]), store);
    const serializedJson = serializeShadowReplayManualBatchJson(result);
    const serializedMarkdown = serializeShadowReplayManualBatchMarkdown(result);
    expect(serializedJson).toContain('"runner_version": "g11_manual_batch_runner_v1"');
    expect(serializedJson).toContain('"report_version": "g10_results_reporter_v1"');
    expect(serializedMarkdown).toContain('# Shadow Replay Manual Batch Runner');
    expect(serializedMarkdown).toContain('## G10 Report');
  });

  it('rejects schema/reference-invalid envelopes before store writes', async () => {
    const store = new InMemoryShadowReplayBatchStore();
    const invalid: ShadowReplaySampleEnvelope = {
      ...envelope(1),
      schema_version: SHADOW_REPLAY_SAMPLE_ENVELOPE_SCHEMA_VERSION,
      source_ref_hash: 'not-a-hash',
    };
    const result = await runShadowReplayManualBatch(jsonl([invalid]), store);
    expect(result.summary.processed).toBe(0);
    expect(result.rejected_lines[0]?.code).toBe('invalid_envelope');
  });
});

describe('V10 Shadow Replay G11 source isolation', () => {
  it('batch runner source does not import runtime, network, Redis, GLPI, Meta or AI adapters', () => {
    const source = readFileSync(BATCH_RUNNER_SOURCE, 'utf8');
    expect(source).not.toMatch(/from\s+['"]pg['"]/);
    expect(source).not.toMatch(/from\s+['"]ioredis['"]/);
    expect(source).not.toMatch(/from\s+['"]redis['"]/);
    expect(source).not.toMatch(/from\s+['"]node:http['"]/);
    expect(source).not.toMatch(/from\s+['"]node:https['"]/);
    expect(source).not.toContain('MetaClient');
    expect(source).not.toContain('GlpiClient');
    expect(source).not.toContain('OutboundMessageService');
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/\bprocess\.env\b/);
    expect(source).not.toMatch(/\bapp\.ts\b/);
  });

  it('manual CLI requires explicit DB env and does not load dotenv or print the URL', () => {
    const source = readFileSync(BATCH_SCRIPT_SOURCE, 'utf8');
    expect(source).toContain('SHADOW_REPLAY_BATCH_DATABASE_URL');
    expect(source).not.toMatch(/\bdotenv\b/);
    expect(source).not.toMatch(/process\.stdout\.write\(databaseUrl/);
    expect(source).toContain('ROLLBACK');
    expect(source).toContain('COMMIT');
  });

  it('manual CLI does not import operational clients or external service adapters', () => {
    const source = readFileSync(BATCH_SCRIPT_SOURCE, 'utf8');
    expect(source).not.toContain('MetaClient');
    expect(source).not.toContain('GlpiClient');
    expect(source).not.toContain('OutboundMessageService');
    expect(source).not.toMatch(/from\s+['"]ioredis['"]/);
    expect(source).not.toMatch(/from\s+['"]node:http['"]/);
    expect(source).not.toMatch(/from\s+['"]node:https['"]/);
  });
});
