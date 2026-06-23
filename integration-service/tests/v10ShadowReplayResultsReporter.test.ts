import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  assertShadowReplayStoreDataSanitized,
  buildShadowReplayResultsReport,
  generateShadowReplayResultsReportFromStore,
  maskShadowReplayResultsReportForOutput,
  serializeShadowReplayResultsReportJson,
  ShadowReplayResultsReporterError,
} from '../src/shadowReplay/ShadowReplayResultsReporter.js';
import type {
  ShadowReplayResultsReporterFilter,
  ShadowReplayStoreReadContract,
} from '../src/shadowReplay/ShadowReplayStoreReadContract.js';
import { SHADOW_REPLAY_RESULTS_REPORT_VERSION } from '../src/shadowReplay/ShadowReplayResultsReporterTypes.js';
import type {
  ShadowReplayAuditEvent,
  ShadowReplayResult,
  ShadowReplayRun,
  ShadowReplaySample,
} from '../src/shadowReplay/ShadowReplayStoreTypes.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const REPORTER_FILES = [
  join(ROOT, 'src', 'shadowReplay', 'ShadowReplayResultsReporter.ts'),
  join(ROOT, 'src', 'shadowReplay', 'ShadowReplayPostgresReader.ts'),
  join(ROOT, 'scripts', 'v10ShadowReplayResultsReporter.mjs'),
];

const FIXED_AT = '2026-06-23T12:00:00.000Z';

function reporterSource(): string {
  return REPORTER_FILES.map((path) => readFileSync(path, 'utf8')).join('\n');
}

function syntheticRun(overrides: Partial<ShadowReplayRun> = {}): ShadowReplayRun {
  return {
    run_id: 'shadow-run-g10-test-001',
    run_hash: 'a'.repeat(64),
    source_window_hash: null,
    status: 'completed',
    dry_run: true,
    hml_only: true,
    outbound_null_enforced: true,
    contract_version: 'g3_shadow_store_v1',
    created_by_ref_hash: null,
    started_at: '2026-06-23T11:59:50.000Z',
    finished_at: '2026-06-23T12:00:00.000Z',
    created_at: FIXED_AT,
    sanitized_metadata: { synthetic: true, phase: 'g10' },
    safety_flags: { outbound_null_enforced: true, dry_run: true, synthetic: true },
    ...overrides,
  };
}

function syntheticSample(overrides: Partial<ShadowReplaySample> = {}): ShadowReplaySample {
  return {
    run_id: 'shadow-run-g10-test-001',
    sample_id: 'shadow-sample-g10-test-001',
    sample_hash: 'b'.repeat(64),
    source_ref_hash: 'c'.repeat(64),
    tenant_ref_hash: null,
    category_key: 'vpn',
    sequence_no: 1,
    created_at: FIXED_AT,
    sanitized_input_metadata: { synthetic: true, phase: 'g10', category: 'vpn' },
    redaction_summary: { redacted_fields: 0 },
    safety_flags: { synthetic: true },
    ...overrides,
  };
}

function syntheticResult(overrides: Partial<ShadowReplayResult> = {}): ShadowReplayResult {
  return {
    run_id: 'shadow-run-g10-test-001',
    sample_id: 'shadow-sample-g10-test-001',
    result_id: 'shadow-result-g10-test-001',
    result_hash: 'd'.repeat(64),
    engine_profile: 'g9_dry_run_runner_v1',
    decision_status: 'simulated',
    confidence_score: 0.91,
    latency_ms: 42,
    output_summary_hash: 'e'.repeat(64),
    evidence_hash: null,
    error_code: null,
    created_at: FIXED_AT,
    sanitized_output_metadata: { dry_run_status: 'simulated', synthetic: true },
    safety_flags: { outbound_null_enforced: true },
    ...overrides,
  };
}

function syntheticAudit(overrides: Partial<ShadowReplayAuditEvent> = {}): ShadowReplayAuditEvent {
  return {
    run_id: 'shadow-run-g10-test-001',
    sample_id: 'shadow-sample-g10-test-001',
    event_id: 'shadow-event-g10-test-001',
    event_type: 'dry_run_finished',
    event_hash: 'f'.repeat(64),
    actor_ref_hash: null,
    severity: 'info',
    created_at: FIXED_AT,
    sanitized_event_metadata: { synthetic: true, phase: 'g10' },
    ...overrides,
  };
}

class InMemoryReadStore implements ShadowReplayStoreReadContract {
  public writeAttempts = 0;

  constructor(
    private readonly data: {
      runs: ShadowReplayRun[];
      samples: ShadowReplaySample[];
      results: ShadowReplayResult[];
      auditEvents: ShadowReplayAuditEvent[];
    },
  ) {}

  private guardWrite(): void {
    this.writeAttempts += 1;
    throw new Error('InMemoryReadStore: writes are forbidden');
  }

  async listRuns(filter: ShadowReplayResultsReporterFilter): Promise<readonly ShadowReplayRun[]> {
    return this.data.runs.filter((run) => this.matches(run, filter, true)).slice(0, filter.limit ?? 500);
  }

  async listSamples(filter: ShadowReplayResultsReporterFilter): Promise<readonly ShadowReplaySample[]> {
    return this.data.samples.filter((sample) => this.matches(sample, filter, false)).slice(0, filter.limit ?? 2000);
  }

  async listResults(filter: ShadowReplayResultsReporterFilter): Promise<readonly ShadowReplayResult[]> {
    return this.data.results.filter((result) => this.matches(result, filter, false)).slice(0, filter.limit ?? 2000);
  }

  async listAuditEvents(filter: ShadowReplayResultsReporterFilter): Promise<readonly ShadowReplayAuditEvent[]> {
    return this.data.auditEvents.filter((event) => this.matches(event, filter, false)).slice(0, filter.limit ?? 5000);
  }

  private matches(
    row: { run_id: string; created_at: string; status?: ShadowReplayRun['status'] },
    filter: ShadowReplayResultsReporterFilter,
    includeStatus: boolean,
  ): boolean {
    if (filter.run_id && row.run_id !== filter.run_id) return false;
    if (filter.from && row.created_at < filter.from) return false;
    if (filter.to && row.created_at > filter.to) return false;
    if (includeStatus && filter.status && row.status && row.status !== filter.status) return false;
    if (filter.synthetic_only && !row.run_id.startsWith('shadow-')) return false;
    return true;
  }

  async createRun(): Promise<never> {
    return this.guardWrite() as never;
  }
}

describe('V10 Shadow Replay G10 results reporter', () => {
  it('aggregates synthetic store rows in-memory', async () => {
    const store = new InMemoryReadStore({
      runs: [syntheticRun()],
      samples: [syntheticSample()],
      results: [
        syntheticResult(),
        syntheticResult({
          result_id: 'shadow-result-g10-test-002',
          decision_status: 'blocked',
          error_code: 'OUTBOUND_NULL_BLOCKED',
        }),
      ],
      auditEvents: [syntheticAudit(), syntheticAudit({ event_id: 'shadow-event-g10-test-002', event_type: 'dry_run_started' })],
    });

    const report = await generateShadowReplayResultsReportFromStore(store, { synthetic_only: true }, FIXED_AT);

    expect(report.report_version).toBe(SHADOW_REPLAY_RESULTS_REPORT_VERSION);
    expect(report.totals).toEqual({ runs: 1, samples: 1, results: 2, audit_events: 2 });
    expect(report.blocked_failed_pass).toEqual({ blocked: 1, failed: 0, pass: 1 });
    expect(report.runs_by_status.completed).toBe(1);
    expect(report.durations_ms.avg).toBe(10000);
    expect(report.safety_flags_observed).toContain('outbound_null_enforced');
    expect(report.read_only).toBe(true);
    expect(report.runtime_worker_created).toBe(false);
    expect(store.writeAttempts).toBe(0);
  });

  it('rejects forbidden raw metadata keys', () => {
    expect(() =>
      buildShadowReplayResultsReport({
        runs: [
          syntheticRun({
            sanitized_metadata: { raw_payload: 'secret-body' } as unknown as ShadowReplayRun['sanitized_metadata'],
          }),
        ],
        samples: [],
        results: [],
        auditEvents: [],
        filter: {},
        generatedAt: FIXED_AT,
      }),
    ).toThrow(ShadowReplayResultsReporterError);
  });

  it('filters synthetic_only runs and dependent rows', () => {
    const report = buildShadowReplayResultsReport({
      runs: [syntheticRun(), syntheticRun({ run_id: 'prod-run-real-001', sanitized_metadata: {}, safety_flags: {} })],
      samples: [
        syntheticSample(),
        syntheticSample({ run_id: 'prod-run-real-001', sample_id: 'prod-sample-001' }),
      ],
      results: [syntheticResult()],
      auditEvents: [syntheticAudit()],
      filter: { synthetic_only: true },
      generatedAt: FIXED_AT,
    });

    expect(report.totals.runs).toBe(1);
    expect(report.totals.samples).toBe(1);
    expect(report.runs[0]?.run_id).toBe('shadow-run-g10-test-001');
  });

  it('serializes deterministic JSON for fixed input', () => {
    const input = {
      runs: [syntheticRun()],
      samples: [syntheticSample()],
      results: [syntheticResult()],
      auditEvents: [syntheticAudit()],
      filter: { synthetic_only: true },
      generatedAt: FIXED_AT,
    };
    const first = serializeShadowReplayResultsReportJson(buildShadowReplayResultsReport(input));
    const second = serializeShadowReplayResultsReportJson(buildShadowReplayResultsReport(input));
    expect(first).toBe(second);
    expect(first).toContain('"report_version": "g10_results_reporter_v1"');
  });

  it('masks PII-like values in output', () => {
    const report = buildShadowReplayResultsReport({
      runs: [
        syntheticRun({
          safety_flags: {
            synthetic: true,
            note: 'contato cliente@example.com',
          },
        }),
      ],
      samples: [],
      results: [],
      auditEvents: [],
      filter: {},
      generatedAt: FIXED_AT,
    });

    const masked = maskShadowReplayResultsReportForOutput(report);
    const json = serializeShadowReplayResultsReportJson(masked);
    expect(json).not.toContain('cliente@example.com');
    expect(json).toContain('[redacted]');
  });

  it('assertShadowReplayStoreDataSanitized rejects transcript keys', () => {
    expect(() =>
      assertShadowReplayStoreDataSanitized(
        [],
        [
          syntheticSample({
            sanitized_input_metadata: { transcript: 'hello' } as unknown as ShadowReplaySample['sanitized_input_metadata'],
          }),
        ],
        [],
        [],
      ),
    ).toThrow(/Forbidden raw-data keys/);
  });

  it('source isolation: no GLPI/Meta/Redis/IA/runtime wiring', () => {
    const src = reporterSource();
    expect(src).not.toMatch(/\bredis\b/i);
    expect(src).not.toMatch(/\bglpi\b/i);
    expect(src).not.toMatch(/\bwhatsapp\b/i);
    expect(src).not.toMatch(/\bollama\b/i);
    expect(src).not.toMatch(/\bopenai\b/i);
    expect(src).not.toMatch(/\bapp\.ts\b/);
    expect(src).not.toMatch(/\bdotenv\b/);
    expect(src).toContain('shadow_replay_runs');
    expect(src).toContain('shadow_replay_samples');
    expect(src).toContain('shadow_replay_results');
    expect(src).toContain('shadow_replay_audit_events');
  });

  it('Postgres reader guards operational tables', () => {
    const readerSrc = readFileSync(join(ROOT, 'src', 'shadowReplay', 'ShadowReplayPostgresReader.ts'), 'utf8');
    expect(readerSrc).toContain('ALLOWED_TABLES');
    expect(readerSrc).not.toMatch(/\bINSERT\b|\bUPDATE\b|\bDELETE\b/);
  });

  it('CLI script requires explicit database env and avoids dotenv', () => {
    const scriptSrc = readFileSync(join(ROOT, 'scripts', 'v10ShadowReplayResultsReporter.mjs'), 'utf8');
    expect(scriptSrc).toContain('SHADOW_REPLAY_REPORT_DATABASE_URL');
    expect(scriptSrc).not.toMatch(/\bdotenv\b/);
    expect(scriptSrc).not.toMatch(/process\.stdout\.write\(databaseUrl/);
  });
});
