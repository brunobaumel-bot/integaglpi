/**
 * V10 Shadow Replay Lab G10 - read-only Shadow Store contract.
 *
 * Manual reporter boundary. SELECT-only on shadow_replay_* tables.
 */

import type {
  ShadowReplayAuditEvent,
  ShadowReplayResult,
  ShadowReplayRun,
  ShadowReplayRunStatus,
  ShadowReplaySample,
} from './ShadowReplayStoreTypes.js';

export interface ShadowReplayResultsReporterFilter {
  readonly run_id?: string;
  readonly status?: ShadowReplayRunStatus | readonly ShadowReplayRunStatus[];
  readonly from?: string;
  readonly to?: string;
  readonly synthetic_only?: boolean;
  readonly limit?: number;
}

export interface ShadowReplayStoreReadContract {
  listRuns(filter: ShadowReplayResultsReporterFilter): Promise<readonly ShadowReplayRun[]>;
  listSamples(filter: ShadowReplayResultsReporterFilter): Promise<readonly ShadowReplaySample[]>;
  listResults(filter: ShadowReplayResultsReporterFilter): Promise<readonly ShadowReplayResult[]>;
  listAuditEvents(filter: ShadowReplayResultsReporterFilter): Promise<readonly ShadowReplayAuditEvent[]>;
}
