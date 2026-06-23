/**
 * V10 Shadow Replay Lab G10 - results reporter report types.
 */

import type { ShadowReplayResultsReporterFilter } from './ShadowReplayStoreReadContract.js';

export const SHADOW_REPLAY_RESULTS_REPORT_VERSION = 'g10_results_reporter_v1' as const;

export interface ShadowReplayResultsReportRunSummary {
  readonly run_id: string;
  readonly status: string;
  readonly duration_ms: number | null;
  readonly sample_count: number;
  readonly result_decision_statuses: readonly string[];
  readonly audit_event_types: readonly string[];
  readonly safety_flags: Readonly<Record<string, boolean | number | string | null>>;
}

export interface ShadowReplayResultsReport {
  readonly report_version: typeof SHADOW_REPLAY_RESULTS_REPORT_VERSION;
  readonly generated_at: string;
  readonly filters: ShadowReplayResultsReporterFilter;
  readonly totals: {
    readonly runs: number;
    readonly samples: number;
    readonly results: number;
    readonly audit_events: number;
  };
  readonly runs_by_status: Readonly<Record<string, number>>;
  readonly results_by_decision_status: Readonly<Record<string, number>>;
  readonly blocked_failed_pass: {
    readonly blocked: number;
    readonly failed: number;
    readonly pass: number;
  };
  readonly durations_ms: {
    readonly count: number;
    readonly min: number | null;
    readonly max: number | null;
    readonly avg: number | null;
  };
  readonly top_blocking_reasons: readonly { readonly reason: string; readonly count: number }[];
  readonly safety_flags_observed: readonly string[];
  readonly runs: readonly ShadowReplayResultsReportRunSummary[];
  readonly read_only: true;
  readonly runtime_worker_created: false;
  readonly external_actions_allowed: false;
}
