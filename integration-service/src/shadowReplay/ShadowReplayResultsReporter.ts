/**
 * V10 Shadow Replay Lab G10 - manual read-only results reporter.
 *
 * Aggregates Shadow Store rows into a deterministic technical report.
 * No writes, no external services, no raw payload surfaces.
 */

import type { ShadowReplayResultsReporterFilter, ShadowReplayStoreReadContract } from './ShadowReplayStoreReadContract.js';
import type {
  ShadowReplayResultsReport,
  ShadowReplayResultsReportRunSummary,
} from './ShadowReplayResultsReporterTypes.js';
import { SHADOW_REPLAY_RESULTS_REPORT_VERSION } from './ShadowReplayResultsReporterTypes.js';
import type {
  ShadowReplayAuditEvent,
  ShadowReplayResult,
  ShadowReplayRun,
  ShadowReplaySample,
  ShadowReplaySanitizedValue,
} from './ShadowReplayStoreTypes.js';

const FORBIDDEN_METADATA_KEY_RE =
  /(^|_)(raw|payload|payload_json|raw_payload|transcript|messages?|body|body_text|message_text|phone|telefone|email|e_mail|mail|cpf|cnpj|ticket_id|ticket|protocolo|protocol|token|secret|api[_-]?key|password|senha)(_|$)/i;

const PII_VALUE_RE =
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|\b(?:\+?55\s?)?(?:\(?\d{2}\)?\s?)?(?:9\s?)?\d{4}[-.\s]?\d{4}\b|\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b|\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b/i;

export class ShadowReplayResultsReporterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ShadowReplayResultsReporterError';
  }
}

function isSyntheticRecord(metadata: Record<string, unknown>, safetyFlags: Record<string, unknown>, id: string): boolean {
  if (metadata['synthetic'] === true) return true;
  if (safetyFlags['synthetic'] === true) return true;
  return id.startsWith('shadow-');
}

function scanForbiddenKeys(value: unknown, path = '$', found: string[] = []): string[] {
  if (!value || typeof value !== 'object') return found;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const childPath = `${path}.${key}`;
    if (FORBIDDEN_METADATA_KEY_RE.test(key)) {
      found.push(childPath);
    }
    scanForbiddenKeys(child, childPath, found);
  }
  return found;
}

export function assertShadowReplayStoreDataSanitized(
  runs: readonly ShadowReplayRun[],
  samples: readonly ShadowReplaySample[],
  results: readonly ShadowReplayResult[],
  auditEvents: readonly ShadowReplayAuditEvent[],
): void {
  const offenders: string[] = [];
  for (const run of runs) {
    offenders.push(...scanForbiddenKeys(run.sanitized_metadata, `run.${run.run_id}.sanitized_metadata`));
    offenders.push(...scanForbiddenKeys(run.safety_flags, `run.${run.run_id}.safety_flags`));
  }
  for (const sample of samples) {
    offenders.push(...scanForbiddenKeys(sample.sanitized_input_metadata, `sample.${sample.sample_id}.sanitized_input_metadata`));
    offenders.push(...scanForbiddenKeys(sample.redaction_summary, `sample.${sample.sample_id}.redaction_summary`));
  }
  for (const result of results) {
    offenders.push(...scanForbiddenKeys(result.sanitized_output_metadata, `result.${result.result_id}.sanitized_output_metadata`));
  }
  for (const event of auditEvents) {
    offenders.push(...scanForbiddenKeys(event.sanitized_event_metadata, `audit.${event.event_id}.sanitized_event_metadata`));
  }
  if (offenders.length > 0) {
    throw new ShadowReplayResultsReporterError(
      `Forbidden raw-data keys detected in Shadow Store metadata: ${offenders.slice(0, 5).join(', ')}`,
    );
  }
}

function maskString(value: string): string {
  if (PII_VALUE_RE.test(value)) {
    return '[redacted]';
  }
  return value;
}

function maskSanitizedValue(value: ShadowReplaySanitizedValue): boolean | number | string | null {
  if (typeof value === 'string') return maskString(value);
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
  return '[object]';
}

function maskSafetyFlags(flags: Record<string, ShadowReplaySanitizedValue>): Record<string, boolean | number | string | null> {
  const out: Record<string, boolean | number | string | null> = {};
  for (const [key, value] of Object.entries(flags)) {
    if (FORBIDDEN_METADATA_KEY_RE.test(key)) continue;
    out[key] = maskSanitizedValue(value);
  }
  return out;
}

function parseDurationMs(run: ShadowReplayRun): number | null {
  if (!run.started_at || !run.finished_at) return null;
  const start = Date.parse(run.started_at);
  const end = Date.parse(run.finished_at);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return null;
  return end - start;
}

function increment(map: Record<string, number>, key: string): void {
  map[key] = (map[key] ?? 0) + 1;
}

export function filterShadowReplayStoreRows<T extends { readonly run_id: string; readonly created_at?: string }>(
  rows: readonly T[],
  filter: ShadowReplayResultsReporterFilter,
  isSynthetic: (row: T) => boolean,
): readonly T[] {
  const statuses = filter.status == null
    ? null
    : Array.isArray(filter.status)
      ? new Set(filter.status)
      : new Set([filter.status]);

  return rows.filter((row) => {
    if (filter.run_id && row.run_id !== filter.run_id) return false;
    if (filter.synthetic_only && !isSynthetic(row)) return false;
    if (filter.from && row.created_at && row.created_at < filter.from) return false;
    if (filter.to && row.created_at && row.created_at > filter.to) return false;
    if ('status' in row && statuses && !statuses.has((row as unknown as ShadowReplayRun).status)) return false;
    return true;
  });
}

export interface ShadowReplayResultsReporterInput {
  readonly runs: readonly ShadowReplayRun[];
  readonly samples: readonly ShadowReplaySample[];
  readonly results: readonly ShadowReplayResult[];
  readonly auditEvents: readonly ShadowReplayAuditEvent[];
  readonly filter: ShadowReplayResultsReporterFilter;
  readonly generatedAt: string;
}

export function buildShadowReplayResultsReport(input: ShadowReplayResultsReporterInput): ShadowReplayResultsReport {
  assertShadowReplayStoreDataSanitized(input.runs, input.samples, input.results, input.auditEvents);

  const runs = filterShadowReplayStoreRows(input.runs, input.filter, (run) =>
    isSyntheticRecord(run.sanitized_metadata as Record<string, unknown>, run.safety_flags as Record<string, unknown>, run.run_id),
  );
  const runIds = new Set(runs.map((run) => run.run_id));

  const samples = input.samples.filter((sample) => {
    if (!runIds.has(sample.run_id)) return false;
    if (input.filter.synthetic_only) {
      return isSyntheticRecord(
        sample.sanitized_input_metadata as Record<string, unknown>,
        sample.safety_flags as Record<string, unknown>,
        sample.sample_id,
      );
    }
    return true;
  });

  const sampleIds = new Set(samples.map((sample) => sample.sample_id));
  const results = input.results.filter((result) => runIds.has(result.run_id) && sampleIds.has(result.sample_id));
  const auditEvents = input.auditEvents.filter((event) => runIds.has(event.run_id));

  const runsByStatus: Record<string, number> = {};
  const resultsByDecision: Record<string, number> = {};
  let blocked = 0;
  let failed = 0;
  let pass = 0;
  const reasonCounts = new Map<string, number>();
  const safetyFlagSet = new Set<string>();
  const durations: number[] = [];

  for (const run of runs) {
    increment(runsByStatus, run.status);
    const duration = parseDurationMs(run);
    if (duration != null) durations.push(duration);
    for (const [key, value] of Object.entries(run.safety_flags)) {
      if (value === true) safetyFlagSet.add(key);
    }
  }

  for (const result of results) {
    increment(resultsByDecision, result.decision_status);
    if (result.decision_status === 'blocked') blocked += 1;
    else if (result.decision_status === 'failed') failed += 1;
    else if (result.decision_status === 'simulated') pass += 1;
    const reason = result.error_code ?? result.sanitized_output_metadata['dry_run_status']?.toString() ?? result.decision_status;
    if (result.decision_status === 'blocked' || result.decision_status === 'failed') {
      reasonCounts.set(String(reason), (reasonCounts.get(String(reason)) ?? 0) + 1);
    }
  }

  const topBlockingReasons = [...reasonCounts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 10)
    .map(([reason, count]) => ({ reason, count }));

  const runSummaries: ShadowReplayResultsReportRunSummary[] = runs
    .slice()
    .sort((left, right) => left.run_id.localeCompare(right.run_id))
    .map((run) => {
      const runSamples = samples.filter((sample) => sample.run_id === run.run_id);
      const runResults = results.filter((result) => result.run_id === run.run_id);
      const runEvents = auditEvents.filter((event) => event.run_id === run.run_id);
      return {
        run_id: run.run_id,
        status: run.status,
        duration_ms: parseDurationMs(run),
        sample_count: runSamples.length,
        result_decision_statuses: [...new Set(runResults.map((result) => result.decision_status))].sort(),
        audit_event_types: [...new Set(runEvents.map((event) => event.event_type))].sort(),
        safety_flags: maskSafetyFlags(run.safety_flags as Record<string, ShadowReplaySanitizedValue>),
      };
    });

  const durationCount = durations.length;
  const durationSum = durations.reduce((acc, value) => acc + value, 0);

  return {
    report_version: SHADOW_REPLAY_RESULTS_REPORT_VERSION,
    generated_at: input.generatedAt,
    filters: input.filter,
    totals: {
      runs: runs.length,
      samples: samples.length,
      results: results.length,
      audit_events: auditEvents.length,
    },
    runs_by_status: runsByStatus,
    results_by_decision_status: resultsByDecision,
    blocked_failed_pass: { blocked, failed, pass },
    durations_ms: {
      count: durationCount,
      min: durationCount > 0 ? Math.min(...durations) : null,
      max: durationCount > 0 ? Math.max(...durations) : null,
      avg: durationCount > 0 ? Math.round(durationSum / durationCount) : null,
    },
    top_blocking_reasons: topBlockingReasons,
    safety_flags_observed: [...safetyFlagSet].sort(),
    runs: runSummaries,
    read_only: true,
    runtime_worker_created: false,
    external_actions_allowed: false,
  };
}

export function serializeShadowReplayResultsReportJson(report: ShadowReplayResultsReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

export function serializeShadowReplayResultsReportMarkdown(report: ShadowReplayResultsReport): string {
  const lines = [
    '# Shadow Replay Results Report',
    '',
    `- report_version: ${report.report_version}`,
    `- generated_at: ${report.generated_at}`,
    `- read_only: ${report.read_only}`,
    '',
    '## Totals',
    `- runs: ${report.totals.runs}`,
    `- samples: ${report.totals.samples}`,
    `- results: ${report.totals.results}`,
    `- audit_events: ${report.totals.audit_events}`,
    '',
    '## Decision summary',
    `- blocked: ${report.blocked_failed_pass.blocked}`,
    `- failed: ${report.blocked_failed_pass.failed}`,
    `- pass: ${report.blocked_failed_pass.pass}`,
    '',
    '## Top blocking reasons',
    ...report.top_blocking_reasons.map((item) => `- ${item.reason}: ${item.count}`),
    '',
    '## Runs',
    ...report.runs.map(
      (run) =>
        `- ${run.run_id} status=${run.status} samples=${run.sample_count} duration_ms=${run.duration_ms ?? 'n/a'}`,
    ),
    '',
  ];
  return `${lines.join('\n')}\n`;
}

export function maskShadowReplayResultsReportForOutput(report: ShadowReplayResultsReport): ShadowReplayResultsReport {
  const serialized = serializeShadowReplayResultsReportJson(report);
  if (!PII_VALUE_RE.test(serialized)) {
    return report;
  }
  return {
    ...report,
    runs: report.runs.map((run) => ({
      ...run,
      safety_flags: Object.fromEntries(
        Object.entries(run.safety_flags).map(([key, value]) => [key, typeof value === 'string' ? maskString(value) : value]),
      ),
    })),
  };
}

export async function generateShadowReplayResultsReportFromStore(
  store: ShadowReplayStoreReadContract,
  filter: ShadowReplayResultsReporterFilter,
  generatedAt = new Date(0).toISOString(),
): Promise<ShadowReplayResultsReport> {
  const [runs, samples, results, auditEvents] = await Promise.all([
    store.listRuns(filter),
    store.listSamples(filter),
    store.listResults(filter),
    store.listAuditEvents(filter),
  ]);
  return buildShadowReplayResultsReport({
    runs,
    samples,
    results,
    auditEvents,
    filter,
    generatedAt,
  });
}
