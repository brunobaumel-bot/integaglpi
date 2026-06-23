/**
 * V10 Shadow Replay Lab G11 - manual JSONL batch runner.
 *
 * Processes one G6 sanitized envelope per JSONL line through the G9 manual
 * runner and reuses the G10 reporter for the final summary. No runtime
 * registration, no worker, no external calls and no operational table access.
 */

import { runShadowReplayDryRunManual, type ShadowReplayDryRunRunnerOutput } from './ShadowReplayDryRunRunner.js';
import {
  buildShadowReplayResultsReport,
  maskShadowReplayResultsReportForOutput,
} from './ShadowReplayResultsReporter.js';
import type { ShadowReplayResultsReport } from './ShadowReplayResultsReporterTypes.js';
import type { ShadowReplaySampleEnvelope } from './ShadowReplaySampleEnvelope.js';
import { hashShadowReplayReference } from './ShadowReplaySampleSanitizer.js';
import { validateShadowReplaySampleEnvelope } from './ShadowReplaySampleValidation.js';
import type { ShadowReplayStoreContract } from './ShadowReplayStoreContract.js';
import type { ShadowReplayStoreReadContract } from './ShadowReplayStoreReadContract.js';
import type {
  ShadowReplayAuditEvent,
  ShadowReplayAuditEventCreate,
  ShadowReplayResult,
  ShadowReplayResultCreate,
  ShadowReplayRun,
  ShadowReplayRunCreate,
  ShadowReplayRunStatus,
  ShadowReplaySample,
  ShadowReplaySampleCreate,
} from './ShadowReplayStoreTypes.js';

export const SHADOW_REPLAY_MANUAL_BATCH_RUNNER_VERSION = 'g11_manual_batch_runner_v1' as const;

const HASH_RE = /^[a-f0-9]{64}$/;
const FORBIDDEN_RAW_KEY_RE = /^(raw_payload|messages?|transcript)$/i;

export interface ShadowReplayManualBatchRunnerOptions {
  readonly dryRun?: boolean;
  readonly rollback?: boolean;
  readonly syntheticOnly?: boolean;
  readonly failFast?: boolean;
  readonly reportFormat?: 'json' | 'markdown';
  readonly createdAt?: string;
  readonly generatedAt?: string;
}

export interface ShadowReplayManualBatchRejectedLine {
  readonly line_no: number;
  readonly reason: string;
  readonly code: 'invalid_json' | 'raw_key_forbidden' | 'source_ref_not_hash' | 'invalid_envelope';
}

export interface ShadowReplayManualBatchSummary {
  readonly runner_version: typeof SHADOW_REPLAY_MANUAL_BATCH_RUNNER_VERSION;
  readonly total_lines: number;
  readonly processed: number;
  readonly simulated: number;
  readonly blocked: number;
  readonly rejected: number;
  readonly failed_fast: boolean;
  readonly dry_run: boolean;
  readonly rollback: boolean;
  readonly synthetic_only: boolean;
  readonly runtime_registered: false;
  readonly worker_created: false;
  readonly external_actions_allowed: false;
  readonly glpi_called: false;
  readonly meta_called: false;
  readonly redis_touched: false;
  readonly ai_called: false;
  readonly operational_table_writes: false;
}

export interface ShadowReplayManualBatchResult {
  readonly summary: ShadowReplayManualBatchSummary;
  readonly outputs: readonly ShadowReplayDryRunRunnerOutput[];
  readonly rejected_lines: readonly ShadowReplayManualBatchRejectedLine[];
  readonly report: ShadowReplayResultsReport;
}

function nowIso(input?: string): string {
  return input ?? new Date().toISOString();
}

function collectForbiddenRawKeys(value: unknown, path = '$', found: ShadowReplayManualBatchRejectedLine[] = []): ShadowReplayManualBatchRejectedLine[] {
  if (!value || typeof value !== 'object') return found;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const childPath = `${path}.${key}`;
    if (FORBIDDEN_RAW_KEY_RE.test(key)) {
      found.push({ line_no: 0, reason: `Forbidden raw key at ${childPath}`, code: 'raw_key_forbidden' });
      continue;
    }
    if (key === 'source_ref' && (typeof child !== 'string' || !HASH_RE.test(child))) {
      found.push({ line_no: 0, reason: `source_ref must not carry a raw/non-hash reference at ${childPath}`, code: 'source_ref_not_hash' });
      continue;
    }
    collectForbiddenRawKeys(child, childPath, found);
  }
  return found;
}

function resultIds(envelope: ShadowReplaySampleEnvelope, lineNo: number): {
  resultId: string;
  startAuditEventId: string;
  finishAuditEventId: string;
} {
  const fingerprint = hashShadowReplayReference([
    SHADOW_REPLAY_MANUAL_BATCH_RUNNER_VERSION,
    envelope.run_id,
    envelope.sample_id,
    envelope.source_ref_hash,
    lineNo,
  ].join('|')).slice(0, 16);
  return {
    resultId: `shadow-result-g11-${lineNo}-${fingerprint}`,
    startAuditEventId: `shadow-start-g11-${lineNo}-${fingerprint}`,
    finishAuditEventId: `shadow-finish-g11-${lineNo}-${fingerprint}`,
  };
}

function readRows(outputs: readonly ShadowReplayDryRunRunnerOutput[]): {
  runs: ShadowReplayRun[];
  samples: ShadowReplaySample[];
  results: ShadowReplayResult[];
  auditEvents: ShadowReplayAuditEvent[];
} {
  return {
    runs: outputs.map((output) => output.run),
    samples: outputs.map((output) => output.sample),
    results: outputs.map((output) => output.result),
    auditEvents: outputs.flatMap((output) => output.audit_events),
  };
}

export class InMemoryShadowReplayBatchStore implements ShadowReplayStoreContract, ShadowReplayStoreReadContract {
  readonly runs = new Map<string, ShadowReplayRun>();
  readonly samples = new Map<string, ShadowReplaySample>();
  readonly results = new Map<string, ShadowReplayResult>();
  readonly auditEvents: ShadowReplayAuditEvent[] = [];
  operationalTableWrites = 0;

  constructor(private readonly createdAt = '2026-06-23T00:00:00.000Z') {}

  async createRun(input: ShadowReplayRunCreate): Promise<ShadowReplayRun> {
    const run: ShadowReplayRun = {
      ...input,
      status: input.status ?? 'planned',
      dry_run: true,
      hml_only: true,
      outbound_null_enforced: true,
      contract_version: 'g3_shadow_store_v1',
      started_at: null,
      finished_at: null,
      created_at: this.createdAt,
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
    const sample: ShadowReplaySample = { ...input, created_at: this.createdAt };
    this.samples.set(sample.sample_id, sample);
    return sample;
  }

  async recordResult(input: ShadowReplayResultCreate): Promise<ShadowReplayResult> {
    const result: ShadowReplayResult = { ...input, created_at: this.createdAt };
    this.results.set(result.result_id, result);
    return result;
  }

  async recordAuditEvent(input: ShadowReplayAuditEventCreate): Promise<ShadowReplayAuditEvent> {
    const event: ShadowReplayAuditEvent = { ...input, created_at: this.createdAt };
    this.auditEvents.push(event);
    return event;
  }

  async findRunById(runId: string): Promise<ShadowReplayRun | null> {
    return this.runs.get(runId) ?? null;
  }

  async listSamplesByRun(runId: string, limit: number): Promise<readonly ShadowReplaySample[]> {
    return [...this.samples.values()].filter((sample) => sample.run_id === runId).slice(0, limit);
  }

  async listRuns(filter: { readonly status?: ShadowReplayRunStatus | readonly ShadowReplayRunStatus[]; readonly limit?: number }): Promise<readonly ShadowReplayRun[]> {
    const statusFilter = filter.status;
    const statuses = statusFilter == null
      ? null
      : Array.isArray(statusFilter)
        ? new Set(statusFilter)
        : new Set([statusFilter]);
    return [...this.runs.values()]
      .filter((run) => !statuses || statuses.has(run.status))
      .slice(0, filter.limit ?? 500);
  }

  async listSamples(filter: { readonly limit?: number }): Promise<readonly ShadowReplaySample[]> {
    return [...this.samples.values()].slice(0, filter.limit ?? 2000);
  }

  async listResults(filter: { readonly limit?: number }): Promise<readonly ShadowReplayResult[]> {
    return [...this.results.values()].slice(0, filter.limit ?? 2000);
  }

  async listAuditEvents(filter: { readonly limit?: number }): Promise<readonly ShadowReplayAuditEvent[]> {
    return this.auditEvents.slice(0, filter.limit ?? 5000);
  }
}

function parseJsonlLine(line: string, lineNo: number): ShadowReplaySampleEnvelope | ShadowReplayManualBatchRejectedLine {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return { line_no: lineNo, reason: 'Invalid JSONL line.', code: 'invalid_json' };
  }

  const rawKeyIssues = collectForbiddenRawKeys(parsed).map((issue) => ({ ...issue, line_no: lineNo }));
  if (rawKeyIssues[0]) return rawKeyIssues[0];

  const envelope = parsed as ShadowReplaySampleEnvelope;
  const validation = validateShadowReplaySampleEnvelope(envelope);
  if (!validation.ok && validation.issues.some((issue) => issue.code === 'schema_version_mismatch' || issue.code === 'invalid_reference')) {
    return {
      line_no: lineNo,
      reason: validation.issues.map((issue) => issue.code).join(','),
      code: 'invalid_envelope',
    };
  }
  return envelope;
}

export function parseShadowReplayJsonl(jsonl: string, options: Pick<ShadowReplayManualBatchRunnerOptions, 'failFast'> = {}): {
  readonly envelopes: readonly { readonly lineNo: number; readonly envelope: ShadowReplaySampleEnvelope }[];
  readonly rejected: readonly ShadowReplayManualBatchRejectedLine[];
  readonly totalLines: number;
  readonly failedFast: boolean;
} {
  const envelopes: { lineNo: number; envelope: ShadowReplaySampleEnvelope }[] = [];
  const rejected: ShadowReplayManualBatchRejectedLine[] = [];
  const lines = jsonl.split(/\r?\n/).filter((line) => line.trim() !== '');
  let failedFast = false;

  for (const [index, line] of lines.entries()) {
    const lineNo = index + 1;
    const parsed = parseJsonlLine(line, lineNo);
    if ('code' in parsed) {
      rejected.push(parsed);
      if (options.failFast) {
        failedFast = true;
        break;
      }
      continue;
    }
    envelopes.push({ lineNo, envelope: parsed });
  }

  return { envelopes, rejected, totalLines: lines.length, failedFast };
}

export async function runShadowReplayManualBatch(
  jsonl: string,
  store: ShadowReplayStoreContract,
  options: ShadowReplayManualBatchRunnerOptions = {},
): Promise<ShadowReplayManualBatchResult> {
  const createdAt = nowIso(options.createdAt);
  const parsed = parseShadowReplayJsonl(jsonl, { failFast: options.failFast });
  const rejected: ShadowReplayManualBatchRejectedLine[] = [...parsed.rejected];
  const outputs: ShadowReplayDryRunRunnerOutput[] = [];

  const activeStore = options.dryRun ? new InMemoryShadowReplayBatchStore(createdAt) : store;

  for (const item of parsed.envelopes) {
    const validation = validateShadowReplaySampleEnvelope(item.envelope);
    if (options.syntheticOnly && (!item.envelope.run_id.startsWith('shadow-') || !item.envelope.sample_id.startsWith('shadow-'))) {
      rejected.push({
        line_no: item.lineNo,
        reason: 'Synthetic-only mode requires shadow-* identifiers.',
        code: 'invalid_envelope',
      });
      if (options.failFast) break;
      continue;
    }
    const ids = resultIds(item.envelope, item.lineNo);
    const output = await runShadowReplayDryRunManual(
      {
        envelope: item.envelope,
        runId: item.envelope.run_id,
        sampleId: item.envelope.sample_id,
        resultId: ids.resultId,
        startAuditEventId: ids.startAuditEventId,
        finishAuditEventId: ids.finishAuditEventId,
        sequenceNo: item.lineNo,
        createdAt,
        engineConfig: {
          engine_profile: SHADOW_REPLAY_MANUAL_BATCH_RUNNER_VERSION,
          created_at: createdAt,
          metadata: {
            phase: 'g11',
            batch_runner: true,
            line_no: item.lineNo,
          },
        },
      },
      activeStore,
    );
    outputs.push(output);
    if (!validation.ok && options.failFast) break;
  }

  const rows = readRows(outputs);
  const report = maskShadowReplayResultsReportForOutput(buildShadowReplayResultsReport({
    ...rows,
    filter: { synthetic_only: options.syntheticOnly ?? false },
    generatedAt: nowIso(options.generatedAt ?? createdAt),
  }));

  const simulated = outputs.filter((output) => output.result.decision_status === 'simulated').length;
  const blocked = outputs.filter((output) => output.result.decision_status === 'blocked').length;

  return {
    summary: {
      runner_version: SHADOW_REPLAY_MANUAL_BATCH_RUNNER_VERSION,
      total_lines: parsed.totalLines,
      processed: outputs.length,
      simulated,
      blocked,
      rejected: rejected.length,
      failed_fast: parsed.failedFast,
      dry_run: options.dryRun === true,
      rollback: options.rollback === true,
      synthetic_only: options.syntheticOnly === true,
      runtime_registered: false,
      worker_created: false,
      external_actions_allowed: false,
      glpi_called: false,
      meta_called: false,
      redis_touched: false,
      ai_called: false,
      operational_table_writes: false,
    },
    outputs,
    rejected_lines: rejected,
    report,
  };
}

export function serializeShadowReplayManualBatchJson(result: ShadowReplayManualBatchResult): string {
  return `${JSON.stringify({
    summary: result.summary,
    rejected_lines: result.rejected_lines,
    report: result.report,
  }, null, 2)}\n`;
}

export function serializeShadowReplayManualBatchMarkdown(result: ShadowReplayManualBatchResult): string {
  const lines = [
    '# Shadow Replay Manual Batch Runner',
    '',
    `- runner_version: ${result.summary.runner_version}`,
    `- total_lines: ${result.summary.total_lines}`,
    `- processed: ${result.summary.processed}`,
    `- simulated: ${result.summary.simulated}`,
    `- blocked: ${result.summary.blocked}`,
    `- rejected: ${result.summary.rejected}`,
    `- dry_run: ${result.summary.dry_run}`,
    `- rollback: ${result.summary.rollback}`,
    `- runtime_registered: ${result.summary.runtime_registered}`,
    `- worker_created: ${result.summary.worker_created}`,
    '',
    '## G10 Report',
    `- runs: ${result.report.totals.runs}`,
    `- samples: ${result.report.totals.samples}`,
    `- results: ${result.report.totals.results}`,
    `- audit_events: ${result.report.totals.audit_events}`,
    '',
  ];
  return `${lines.join('\n')}\n`;
}
