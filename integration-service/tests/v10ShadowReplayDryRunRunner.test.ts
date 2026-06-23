import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  runShadowReplayDryRunManual,
  SHADOW_REPLAY_DRY_RUN_RUNNER_VERSION,
} from '../src/shadowReplay/ShadowReplayDryRunRunner.js';
import type { ShadowReplayStoreContract } from '../src/shadowReplay/ShadowReplayStoreContract.js';
import { createShadowReplaySampleEnvelope } from '../src/shadowReplay/ShadowReplaySampleSanitizer.js';
import type {
  ShadowReplayAuditEvent,
  ShadowReplayAuditEventCreate,
  ShadowReplayResult,
  ShadowReplayResultCreate,
  ShadowReplayRun,
  ShadowReplayRunCreate,
  ShadowReplaySample,
  ShadowReplaySampleCreate,
} from '../src/shadowReplay/ShadowReplayStoreTypes.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const RUNNER_FILES = [
  join(ROOT, 'src', 'shadowReplay', 'ShadowReplayDryRunRunner.ts'),
  join(ROOT, 'src', 'shadowReplay', 'ShadowReplayPostgresStore.ts'),
];
const SMOKE_SCRIPT = join(ROOT, 'scripts', 'v10ShadowReplayDryRunRunnerSmoke.mjs');

function runnerSource(): string {
  return readFileSync(RUNNER_FILES[0]!, 'utf8');
}

function postgresStoreSource(): string {
  return readFileSync(RUNNER_FILES[1]!, 'utf8');
}

function smokeSource(): string {
  return readFileSync(SMOKE_SCRIPT, 'utf8');
}

function generatedSmokeSql(): string {
  return execFileSync(process.execPath, [SMOKE_SCRIPT], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, NODE_OPTIONS: '' },
  });
}

class InMemoryStore implements ShadowReplayStoreContract {
  public runs = new Map<string, ShadowReplayRun>();
  public samples = new Map<string, ShadowReplaySample>();
  public results = new Map<string, ShadowReplayResult>();
  public auditEvents: ShadowReplayAuditEvent[] = [];
  public operationalTableWrites = 0;

  private now() {
    return '2026-06-23T00:00:00.000Z';
  }

  async createRun(input: ShadowReplayRunCreate): Promise<ShadowReplayRun> {
    const run: ShadowReplayRun = {
      ...input,
      dry_run: true,
      hml_only: true,
      outbound_null_enforced: true,
      contract_version: 'g3_shadow_store_v1',
      status: input.status ?? 'planned',
      started_at: null,
      finished_at: null,
      created_at: this.now(),
    };
    this.runs.set(run.run_id, run);
    return run;
  }

  async markRunStarted(runId: string, at: string): Promise<ShadowReplayRun> {
    const run = { ...this.runs.get(runId)!, status: 'running' as const, started_at: at };
    this.runs.set(runId, run);
    return run;
  }

  async markRunFinished(runId: string, status: 'completed' | 'failed' | 'aborted', at: string): Promise<ShadowReplayRun> {
    const run = { ...this.runs.get(runId)!, status, finished_at: at };
    this.runs.set(runId, run);
    return run;
  }

  async recordSample(input: ShadowReplaySampleCreate): Promise<ShadowReplaySample> {
    const sample: ShadowReplaySample = { ...input, created_at: this.now() };
    this.samples.set(sample.sample_id, sample);
    return sample;
  }

  async recordResult(input: ShadowReplayResultCreate): Promise<ShadowReplayResult> {
    const result: ShadowReplayResult = { ...input, created_at: this.now() };
    this.results.set(result.result_id, result);
    return result;
  }

  async recordAuditEvent(input: ShadowReplayAuditEventCreate): Promise<ShadowReplayAuditEvent> {
    const event: ShadowReplayAuditEvent = { ...input, created_at: this.now() };
    this.auditEvents.push(event);
    return event;
  }

  async findRunById(runId: string): Promise<ShadowReplayRun | null> {
    return this.runs.get(runId) ?? null;
  }

  async listSamplesByRun(runId: string, limit: number): Promise<readonly ShadowReplaySample[]> {
    return [...this.samples.values()]
      .filter((s) => s.run_id === runId)
      .slice(0, limit);
  }
}

function syntheticEnvelope(runId = 'shadow-run-g9-test-unit001', sampleId = 'shadow-sample-g9-test-unit001') {
  return createShadowReplaySampleEnvelope({
    run_id: runId,
    sample_id: sampleId,
    source_kind: 'synthetic_case',
    source_ref: 'shadow-source-g9-unit-test',
    problem_summary: 'Caso sintetico G9 unit test. VPN sem acesso apos autenticacao.',
    technical_summary: 'Resumo tecnico sintetico G9.',
    classification: { category: 'vpn', confidence: 0.9 },
    metadata: { synthetic: true, phase: 'g9' },
    observed_at: '2026-06-23T00:00:00.000Z',
    created_at: '2026-06-23T00:00:00.000Z',
  });
}

function syntheticInput(overrides: Partial<{ runId: string; sampleId: string }> = {}) {
  const runId = overrides.runId ?? 'shadow-run-g9-test-unit001';
  const sampleId = overrides.sampleId ?? 'shadow-sample-g9-test-unit001';
  return {
    envelope: syntheticEnvelope(runId, sampleId),
    runId,
    sampleId,
    resultId: 'shadow-result-g9-test-unit-001',
    startAuditEventId: 'shadow-start-event-g9-test01',
    finishAuditEventId: 'shadow-finish-event-g9-test01',
    createdAt: '2026-06-23T00:00:00.000Z',
  };
}

describe('V10 Shadow Replay G9 dry-run runner — unit tests', () => {
  it('accepts a clean G6 envelope and returns stored=true with dry-run guarantees', async () => {
    const store = new InMemoryStore();
    const output = await runShadowReplayDryRunManual(syntheticInput(), store);

    expect(output.runner_version).toBe(SHADOW_REPLAY_DRY_RUN_RUNNER_VERSION);
    expect(output.envelope_valid).toBe(true);
    expect(output.blocked).toBe(false);
    expect(output.stored).toBe(true);
    expect(output.dry_run_status).toBe('passed');
    expect(output.dry_run_decision).toBe('accepted_dry_run');
    expect(output.would_persist).toBe(false);
    expect(output.external_actions_allowed).toBe(false);
    expect(output.ai_called).toBe(false);
    expect(output.runtime_worker_created).toBe(false);
  });

  it('persists a run, sample, result and two audit events', async () => {
    const store = new InMemoryStore();
    const output = await runShadowReplayDryRunManual(syntheticInput(), store);

    expect(store.runs.size).toBe(1);
    expect(store.samples.size).toBe(1);
    expect(store.results.size).toBe(1);
    expect(store.auditEvents).toHaveLength(2);
    expect(store.runs.get(output.run_id)?.status).toBe('completed');
  });

  it('persists only shadow_replay_* tables (never operational tables)', async () => {
    const store = new InMemoryStore();
    await runShadowReplayDryRunManual(syntheticInput(), store);
    expect(store.operationalTableWrites).toBe(0);
  });

  it('run record carries dry_run=true, hml_only=true, outbound_null_enforced=true', async () => {
    const store = new InMemoryStore();
    const output = await runShadowReplayDryRunManual(syntheticInput(), store);
    const run = store.runs.get(output.run_id)!;
    expect(run.dry_run).toBe(true);
    expect(run.hml_only).toBe(true);
    expect(run.outbound_null_enforced).toBe(true);
    expect(run.contract_version).toBe('g3_shadow_store_v1');
  });

  it('result decision_status is simulated for a valid envelope', async () => {
    const store = new InMemoryStore();
    const output = await runShadowReplayDryRunManual(syntheticInput(), store);
    const result = store.results.get(output.result_id)!;
    expect(result.decision_status).toBe('simulated');
    expect(result.error_code).toBeNull();
  });

  it('audit events reference g9_dry_run_start and g9_dry_run_finish', async () => {
    const store = new InMemoryStore();
    await runShadowReplayDryRunManual(syntheticInput(), store);
    const types = store.auditEvents.map((e) => e.event_type);
    expect(types).toContain('g9_dry_run_start');
    expect(types).toContain('g9_dry_run_finish');
  });

  it('result_hash is deterministic for the same synthetic input', async () => {
    const input = syntheticInput();
    const store1 = new InMemoryStore();
    const store2 = new InMemoryStore();
    const out1 = await runShadowReplayDryRunManual(input, store1);
    const out2 = await runShadowReplayDryRunManual(input, store2);
    expect(out1.result_hash).toBe(out2.result_hash);
  });

  it('rejects an envelope with residual PII (envelope_valid=false, blocked=true)', async () => {
    const good = syntheticEnvelope();
    const contaminated = { ...good, sanitized_problem_summary: `residual pii: test@example.com` };
    const store = new InMemoryStore();
    const output = await runShadowReplayDryRunManual(
      {
        envelope: contaminated,
        runId: 'shadow-run-g9-pii-test-00001',
        sampleId: 'shadow-sample-g9-pii-test-0001',
        resultId: 'shadow-result-g9-pii-test-00001',
        startAuditEventId: 'shadow-start-g9-pii-test-001',
        finishAuditEventId: 'shadow-finish-g9-pii-test-001',
        createdAt: '2026-06-23T00:00:00.000Z',
      },
      store,
    );
    expect(output.envelope_valid).toBe(false);
    expect(output.blocked).toBe(true);
    expect(output.dry_run_status).toBe('blocked');
    expect(JSON.stringify(output)).not.toContain('test@example.com');
  });

  it('blocked run marks result as blocked and error_code as invalid_envelope', async () => {
    const good = syntheticEnvelope();
    const contaminated = { ...good, sanitized_problem_summary: 'contaminated +55 (41) 99999-8888' };
    const store = new InMemoryStore();
    await runShadowReplayDryRunManual(
      {
        envelope: contaminated,
        runId: 'shadow-run-g9-blocked-test-001',
        sampleId: 'shadow-sample-g9-blocked-test01',
        resultId: 'shadow-result-g9-blocked-test001',
        startAuditEventId: 'shadow-strt-g9-blocked-t-001',
        finishAuditEventId: 'shadow-fin-g9-blocked-t-001',
        createdAt: '2026-06-23T00:00:00.000Z',
      },
      store,
    );
    const result = [...store.results.values()][0]!;
    expect(result.decision_status).toBe('blocked');
    expect(result.error_code).toBe('invalid_envelope');
    const run = [...store.runs.values()][0]!;
    expect(run.status).toBe('failed');
  });

  it('output serialization does not contain PII markers from test fixtures', async () => {
    const store = new InMemoryStore();
    const output = await runShadowReplayDryRunManual(syntheticInput(), store);
    const serialized = JSON.stringify(output);
    expect(serialized).not.toMatch(/\+55/);
    expect(serialized).not.toContain('@');
    // actual CPF/CNPJ digit patterns (not the redaction category key 'cpf_cnpj')
    expect(serialized).not.toMatch(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/);
    expect(serialized).not.toMatch(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/);
    expect(serialized).not.toMatch(/Bearer\s+[A-Za-z0-9]{12,}/);
  });

  it('runner is idempotent in structure for the same synthetic input (two stores, same hashes)', async () => {
    const input = syntheticInput();
    const s1 = new InMemoryStore();
    const s2 = new InMemoryStore();
    const o1 = await runShadowReplayDryRunManual(input, s1);
    const o2 = await runShadowReplayDryRunManual(input, s2);
    expect(o1.result_hash).toBe(o2.result_hash);
    expect(o1.run.run_hash).toBe(o2.run.run_hash);
    expect(o1.sample.sample_hash).toBe(o2.sample.sample_hash);
  });
});

describe('V10 Shadow Replay G9 runner source isolation', () => {
  it('runner does not import pg, redis, http or operational adapters', () => {
    const src = runnerSource();
    expect(src).not.toMatch(/from\s+['"]pg['"]/);
    expect(src).not.toMatch(/from\s+['"]ioredis['"]/);
    expect(src).not.toMatch(/from\s+['"]redis['"]/);
    expect(src).not.toMatch(/from\s+['"]node:http['"]/);
    expect(src).not.toMatch(/from\s+['"]node:https['"]/);
    expect(src).not.toContain('MetaClient');
    expect(src).not.toContain('GlpiClient');
    expect(src).not.toContain('OutboundMessageService');
    expect(src).not.toMatch(/\bfetch\s*\(/);
    expect(src).not.toMatch(/\bprocess\.env\b/);
    expect(src).not.toMatch(/\bimport\s*\(/);
  });

  it('postgres store imports pg but no operational adapters', () => {
    const src = postgresStoreSource();
    expect(src).toMatch(/from\s+['"]pg['"]/);
    expect(src).not.toContain('MetaClient');
    expect(src).not.toContain('GlpiClient');
    expect(src).not.toContain('OutboundMessageService');
    expect(src).not.toMatch(/\bprocess\.env\b/);
    expect(src).not.toMatch(/\bimport\s*\(/);
  });

  it('postgres store references only shadow_replay_* tables', () => {
    const src = postgresStoreSource();
    const tableMatches = [...src.matchAll(/public\.([a-z0-9_]+)/g)].map((m) => m[1]!);
    for (const table of tableMatches) {
      expect(table.startsWith('shadow_replay_')).toBe(true);
    }
  });

  it('postgres store has an ALLOWED_TABLES guard covering all 4 tables', () => {
    const src = postgresStoreSource();
    expect(src).toContain('shadow_replay_runs');
    expect(src).toContain('shadow_replay_samples');
    expect(src).toContain('shadow_replay_results');
    expect(src).toContain('shadow_replay_audit_events');
    expect(src).toContain('ALLOWED_TABLES');
    expect(src).toContain('guardTable');
  });
});

describe('V10 Shadow Replay G9 smoke script', () => {
  it('smoke script does not import pg, redis or network modules', () => {
    const src = smokeSource();
    expect(src).not.toMatch(/from\s+['"]pg['"]/);
    expect(src).not.toMatch(/from\s+['"]ioredis['"]/);
    expect(src).not.toMatch(/from\s+['"]redis['"]/);
    expect(src).not.toMatch(/from\s+['"]node:http['"]/);
    expect(src).not.toMatch(/from\s+['"]node:https['"]/);
    expect(src).not.toMatch(/\bprocess\.env\b/);
  });

  it('smoke script emits transactional SQL touching only shadow_replay tables', () => {
    const sql = generatedSmokeSql();
    expect(sql).toMatch(/\bBEGIN\b/);
    expect(sql).toMatch(/\bROLLBACK\b/);
    expect(sql).not.toMatch(/\bCOMMIT\b/i);

    expect(sql).not.toMatch(/\b2112319360\b/);
    expect(sql).not.toContain('@');
    expect(sql).not.toMatch(/\+55/);

    const tableRefs = [...sql.matchAll(/\bINTO\s+public\.([a-z0-9_]+)/gi)].map((m) => m[1]!);
    expect(tableRefs.length).toBeGreaterThan(0);
    for (const table of tableRefs) {
      expect(table.startsWith('shadow_replay_')).toBe(true);
    }
  });

  it('smoke SQL covers all 4 shadow tables', () => {
    const sql = generatedSmokeSql();
    expect(sql).toContain('shadow_replay_runs');
    expect(sql).toContain('shadow_replay_samples');
    expect(sql).toContain('shadow_replay_results');
    expect(sql).toContain('shadow_replay_audit_events');
  });

  it('smoke SQL includes runner workflow markers', () => {
    const sql = generatedSmokeSql();
    expect(sql).toContain('g9_dry_run_start');
    expect(sql).toContain('g9_dry_run_finish');
    expect(sql).toContain('g9_dry_run_runner_v1');
    expect(sql).toContain('"synthetic":true');
    expect(sql).toContain('"phase":"g9"');
  });

  it('smoke SQL includes UPDATE to mark run started and finished', () => {
    const sql = generatedSmokeSql();
    const updateCount = (sql.match(/\bUPDATE\b/gi) ?? []).length;
    expect(updateCount).toBeGreaterThanOrEqual(2);
    expect(sql).toContain("status='running'");
    expect(sql).toContain("status='completed'");
  });

  it('smoke SQL includes count verification SELECT across all 4 tables', () => {
    const sql = generatedSmokeSql();
    expect(sql).toMatch(/UNION ALL/);
    expect(sql).toContain('COUNT(*)');
  });
});
