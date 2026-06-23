/**
 * V10 Shadow Replay Lab G13 - manual batch scorecard.
 *
 * Read-only evaluator for JSON produced by G11/G10. It performs no DB access,
 * no runtime registration and no external calls. All decisions are derived
 * from the supplied local report and expected manifest.
 */

import type { ShadowReplayManualBatchSummary } from './ShadowReplayManualBatchRunner.js';
import type { ShadowReplayResultsReport } from './ShadowReplayResultsReporterTypes.js';

export const SHADOW_REPLAY_BATCH_SCORECARD_VERSION = 'g13_batch_scorecard_v1' as const;

export type ShadowReplayBatchScorecardVerdict = 'PASS' | 'PASS_WITH_RESSALVAS' | 'FAIL';

export interface ShadowReplayBatchExpectedManifest {
  readonly expected_processed: number;
  readonly expected_simulated: number;
  readonly expected_rejected: number;
  readonly expected_rejection_codes: readonly string[];
  readonly required_safety_flags: readonly string[];
  readonly max_failed: number;
  readonly max_unexpected_blocked: number;
  readonly pii_must_be_absent: boolean;
  readonly credentials_must_be_absent: boolean;
}

export interface ShadowReplayBatchReportInput {
  readonly summary: ShadowReplayManualBatchSummary;
  readonly rejected_lines?: readonly { readonly code?: string; readonly reason?: string }[];
  readonly report: ShadowReplayResultsReport;
}

export interface ShadowReplayBatchScorecardResult {
  readonly scorecard_version: typeof SHADOW_REPLAY_BATCH_SCORECARD_VERSION;
  readonly verdict: ShadowReplayBatchScorecardVerdict;
  readonly reasons: readonly string[];
  readonly warnings: readonly string[];
  readonly metrics: {
    readonly processed: number;
    readonly simulated: number;
    readonly rejected: number;
    readonly failed: number;
    readonly blocked: number;
    readonly unexpected_blocked: number;
    readonly rejection_codes: readonly string[];
  };
  readonly safety: {
    readonly pii_detected: boolean;
    readonly credentials_detected: boolean;
    readonly external_action_detected: boolean;
    readonly runtime_worker_detected: boolean;
    readonly operational_table_touch_detected: boolean;
    readonly glpi_detected: boolean;
    readonly meta_detected: boolean;
    readonly redis_detected: boolean;
    readonly ai_detected: boolean;
  };
  readonly read_only: true;
  readonly runtime_started: false;
  readonly worker_started: false;
  readonly db_written: false;
}

const PII_VALUE_RE =
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|\b(?:\+?55\s?)?(?:\(?\d{2}\)?\s?)?(?:9\s?)?\d{4}[-.\s]?\d{4}\b|\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b|\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/i;
const CREDENTIAL_VALUE_RE = /postgres(?:ql)?:\/\/|Bearer\s+[A-Za-z0-9._~+/=-]{12,}|password\s*=|api[_-]?key\s*=|access[_-]?token\s*=|secret\s*=/i;

function hasTruthyKey(value: unknown, keyPattern: RegExp): boolean {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some((child) => hasTruthyKey(child, keyPattern));
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (keyPattern.test(key) && child === true) return true;
    if (hasTruthyKey(child, keyPattern)) return true;
  }
  return false;
}

function uniqueSorted(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort();
}

function rejectionCodes(report: ShadowReplayBatchReportInput): readonly string[] {
  return uniqueSorted((report.rejected_lines ?? []).map((line) => String(line.code ?? 'unknown')));
}

function exactArrayMismatch(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return true;
  return left.some((value, index) => value !== right[index]);
}

function stringifyForScan(value: unknown): string {
  return JSON.stringify(value);
}

export function buildShadowReplayBatchScorecard(
  batchReport: ShadowReplayBatchReportInput,
  expected: ShadowReplayBatchExpectedManifest,
): ShadowReplayBatchScorecardResult {
  const reasons: string[] = [];
  const warnings: string[] = [];
  const serialized = stringifyForScan(batchReport);
  const piiDetected = expected.pii_must_be_absent && PII_VALUE_RE.test(serialized);
  const credentialsDetected = expected.credentials_must_be_absent && CREDENTIAL_VALUE_RE.test(serialized);

  const failed = batchReport.report.blocked_failed_pass?.failed ?? 0;
  const blocked = batchReport.summary.blocked ?? batchReport.report.blocked_failed_pass?.blocked ?? 0;
  const unexpectedBlocked = Math.max(0, blocked - expected.expected_rejected);
  const actualRejectionCodes = rejectionCodes(batchReport);
  const expectedRejectionCodes = uniqueSorted(expected.expected_rejection_codes);
  const safetyFlags = new Set(batchReport.report.safety_flags_observed ?? []);

  if (piiDetected) reasons.push('pii_detected');
  if (credentialsDetected) reasons.push('credentials_detected');
  if (batchReport.summary.processed < expected.expected_processed) reasons.push('processed_below_expected');
  if (batchReport.summary.simulated !== expected.expected_simulated) reasons.push('simulated_count_mismatch');
  if (batchReport.summary.rejected !== expected.expected_rejected) reasons.push('rejected_count_mismatch');
  if (exactArrayMismatch(actualRejectionCodes, expectedRejectionCodes)) reasons.push('rejection_codes_mismatch');
  if (failed > expected.max_failed) reasons.push('failed_count_above_threshold');
  if (unexpectedBlocked > expected.max_unexpected_blocked) reasons.push('unexpected_blocked_above_threshold');

  for (const flag of expected.required_safety_flags) {
    if (!safetyFlags.has(flag)) reasons.push(`missing_safety_flag:${flag}`);
  }

  const externalActionDetected = hasTruthyKey(batchReport, /^(external_actions_allowed|external_action_triggered)$/i);
  const runtimeWorkerDetected = hasTruthyKey(batchReport, /^(runtime_worker_created|runtime_started|worker_created|worker_started)$/i);
  const operationalTableTouchDetected = hasTruthyKey(batchReport, /^(operational_table_writes|operational_table_touch_detected|writes_operational_tables)$/i);
  const glpiDetected = hasTruthyKey(batchReport, /^(glpi_called|glpi_detected)$/i);
  const metaDetected = hasTruthyKey(batchReport, /^(meta_called|meta_detected|whatsapp_used)$/i);
  const redisDetected = hasTruthyKey(batchReport, /^(redis_touched|redis_detected)$/i);
  const aiDetected = hasTruthyKey(batchReport, /^(ai_called|ai_detected)$/i);

  if (externalActionDetected) reasons.push('external_action_detected');
  if (runtimeWorkerDetected) reasons.push('runtime_worker_detected');
  if (operationalTableTouchDetected) reasons.push('operational_table_touch_detected');
  if (glpiDetected) reasons.push('glpi_detected');
  if (metaDetected) reasons.push('meta_detected');
  if (redisDetected) reasons.push('redis_detected');
  if (aiDetected) reasons.push('ai_detected');

  if (batchReport.report.generated_at?.startsWith('1970-01-01')) {
    warnings.push('generated_at_epoch_cosmetic');
  }
  if (!Array.isArray(batchReport.report.top_blocking_reasons)) {
    warnings.push('top_blocking_reasons_optional_missing');
  }

  const verdict: ShadowReplayBatchScorecardVerdict =
    reasons.length > 0 ? 'FAIL' : warnings.length > 0 ? 'PASS_WITH_RESSALVAS' : 'PASS';

  return {
    scorecard_version: SHADOW_REPLAY_BATCH_SCORECARD_VERSION,
    verdict,
    reasons,
    warnings,
    metrics: {
      processed: batchReport.summary.processed,
      simulated: batchReport.summary.simulated,
      rejected: batchReport.summary.rejected,
      failed,
      blocked,
      unexpected_blocked: unexpectedBlocked,
      rejection_codes: actualRejectionCodes,
    },
    safety: {
      pii_detected: piiDetected,
      credentials_detected: credentialsDetected,
      external_action_detected: externalActionDetected,
      runtime_worker_detected: runtimeWorkerDetected,
      operational_table_touch_detected: operationalTableTouchDetected,
      glpi_detected: glpiDetected,
      meta_detected: metaDetected,
      redis_detected: redisDetected,
      ai_detected: aiDetected,
    },
    read_only: true,
    runtime_started: false,
    worker_started: false,
    db_written: false,
  };
}

export function serializeShadowReplayBatchScorecardJson(result: ShadowReplayBatchScorecardResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}

export function serializeShadowReplayBatchScorecardMarkdown(result: ShadowReplayBatchScorecardResult): string {
  const lines = [
    '# Shadow Replay Batch Scorecard',
    '',
    `- scorecard_version: ${result.scorecard_version}`,
    `- verdict: ${result.verdict}`,
    `- processed: ${result.metrics.processed}`,
    `- simulated: ${result.metrics.simulated}`,
    `- rejected: ${result.metrics.rejected}`,
    `- failed: ${result.metrics.failed}`,
    `- unexpected_blocked: ${result.metrics.unexpected_blocked}`,
    '',
    '## Reasons',
    ...(result.reasons.length > 0 ? result.reasons.map((reason) => `- ${reason}`) : ['- none']),
    '',
    '## Warnings',
    ...(result.warnings.length > 0 ? result.warnings.map((warning) => `- ${warning}`) : ['- none']),
    '',
  ];
  return `${lines.join('\n')}\n`;
}
