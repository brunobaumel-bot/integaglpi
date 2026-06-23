/**
 * V10 Shadow Replay Lab G3 - Shadow Store contract.
 *
 * This file defines a future storage boundary only. It has no database client,
 * no operational adapter imports and no executable write implementation.
 */

import type {
  ShadowReplayAuditEvent,
  ShadowReplayAuditEventCreate,
  ShadowReplayResult,
  ShadowReplayResultCreate,
  ShadowReplayRun,
  ShadowReplayRunCreate,
  ShadowReplaySample,
  ShadowReplaySampleCreate,
} from './ShadowReplayStoreTypes.js';

export type {
  ShadowReplayAuditEvent,
  ShadowReplayAuditEventCreate,
  ShadowReplayResult,
  ShadowReplayResultCreate,
  ShadowReplayRun,
  ShadowReplayRunCreate,
  ShadowReplaySample,
  ShadowReplaySampleCreate,
} from './ShadowReplayStoreTypes.js';

export const SHADOW_REPLAY_STORE_CONTRACT_VERSION = 'g3_shadow_store_v1' as const;
export const SHADOW_REPLAY_STORE_SCHEMA_MIGRATION = '061_shadow_replay_store.sql' as const;

export interface ShadowReplayStoreContract {
  createRun(input: ShadowReplayRunCreate): Promise<ShadowReplayRun>;
  markRunStarted(runId: string, at: string): Promise<ShadowReplayRun>;
  markRunFinished(
    runId: string,
    status: 'completed' | 'failed' | 'aborted',
    at: string,
  ): Promise<ShadowReplayRun>;
  recordSample(input: ShadowReplaySampleCreate): Promise<ShadowReplaySample>;
  recordResult(input: ShadowReplayResultCreate): Promise<ShadowReplayResult>;
  recordAuditEvent(input: ShadowReplayAuditEventCreate): Promise<ShadowReplayAuditEvent>;
  findRunById(runId: string): Promise<ShadowReplayRun | null>;
  listSamplesByRun(runId: string, limit: number): Promise<readonly ShadowReplaySample[]>;
}
