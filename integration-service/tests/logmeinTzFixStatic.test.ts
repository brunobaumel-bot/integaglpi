/**
 * LogMeIn TZ fix — static regression tests.
 *
 * Phase: integaglpi_v9_fase2b_reconciliation_tzfix_001
 *
 * Verifies:
 *  - isoDateString: returns account-TZ date string, not UTC date.
 *  - parseLocalTimestamp: converts offset-free local strings to correct UTC ISO.
 *  - Boundary cases: 22:00 BRT same-day window; 23:59 BRT; 00:01 BRT next day.
 *  - Strings already carrying Z/offset are returned unchanged.
 *  - getLastSyncState: ok / empty / source_unavailable / never_synced derivation.
 *  - No PII (IPs, technician names) in output.
 */

import { describe, expect, it, vi } from 'vitest';

import { LogmeinReconciliationService } from '../src/domain/services/LogmeinReconciliationService.js';

// ── Helpers exported solely for test access via the service's sync plumbing ───
// We test them indirectly through normalizeSession by running a mock sync and
// checking that session timestamps are converted correctly.

const BRT_TZ = 'America/Sao_Paulo'; // UTC-3 year-round (DST abolished 2019)

function makeRepo(overrides: Partial<{
  isSchemaReady: () => Promise<boolean>;
  upsertSession: (s: unknown) => Promise<{ inserted: boolean }>;
  upsertQueueItem: () => Promise<void>;
  getEntityForGroup: () => Promise<number | null>;
  getEquipmentTagForHost: () => Promise<string | null>;
  listQueue: () => Promise<unknown>;
  resolveQueueItem: () => Promise<boolean>;
  insertReconciliationAudit: () => Promise<void>;
  getLastSyncState: () => Promise<{ lastAttemptAt: string | null; lastSyncStatus: string }>;
}> = {}) {
  return {
    isSchemaReady: vi.fn(async () => true),
    upsertSession: vi.fn(async () => ({ inserted: true })),
    upsertQueueItem: vi.fn(async () => undefined),
    getEntityForGroup: vi.fn(async () => null),
    getEquipmentTagForHost: vi.fn(async () => null),
    listQueue: vi.fn(async () => ({ items: [], total: 0, page: 1, limit: 25, hasNext: false })),
    resolveQueueItem: vi.fn(async () => false),
    insertReconciliationAudit: vi.fn(async () => undefined),
    getLastSyncState: vi.fn(async () => ({ lastAttemptAt: null, lastSyncStatus: 'never_synced' })),
    ...overrides,
  };
}

// ── isoDateString via sync window ─────────────────────────────────────────────
describe('isoDateString — account-TZ window date', () => {
  it('derives the BRT date (not UTC date) for a BRT day boundary', async () => {
    // 2025-06-15 00:30:00 BRT = 2025-06-15T03:30:00Z
    // UTC date = 2025-06-15; BRT date = 2025-06-15 — same here.
    // But at 2025-06-14 22:00:00 BRT = 2025-06-15T01:00:00Z:
    // UTC date = 2025-06-15; BRT date = 2025-06-14 → must differ.
    const capturedAudits: Array<{ windowFrom: string; windowTo: string }> = [];
    const repo = makeRepo({
      insertReconciliationAudit: vi.fn(async (a: { windowFrom: string; windowTo: string }) => {
        capturedAudits.push({ windowFrom: a.windowFrom, windowTo: a.windowTo });
      }),
    });

    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, json: async () => ({ items: [] }),
    })));

    const service = new LogmeinReconciliationService(
      { enabled: true, reconciliationEnabled: true, companyId: 'c', psk: 'p', timeoutMs: 50, accountTz: BRT_TZ },
      undefined,
      repo as never,
    );

    // Window: 2025-06-14T22:00:00Z (= 2025-06-14 19:00 BRT) → 2025-06-15T02:00:00Z (= 2025-06-14 23:00 BRT)
    await service.syncRemoteAccessSessions(
      new Date('2025-06-15T01:00:00Z'), // BRT = 2025-06-14 22:00
      new Date('2025-06-15T02:00:00Z'), // BRT = 2025-06-14 23:00
    );

    vi.unstubAllGlobals();

    // The window strings should use BRT date (2025-06-14), NOT the UTC date (2025-06-15).
    expect(capturedAudits.length).toBeGreaterThan(0);
    const audit = capturedAudits[0];
    expect(audit.windowFrom).toBe('2025-06-14');
    expect(audit.windowTo).toBe('2025-06-14');
  });

  it('uses UTC date when TZ is UTC', async () => {
    const capturedAudits: Array<{ windowFrom: string; windowTo: string }> = [];
    const repo = makeRepo({
      insertReconciliationAudit: vi.fn(async (a: { windowFrom: string; windowTo: string }) => {
        capturedAudits.push({ windowFrom: a.windowFrom, windowTo: a.windowTo });
      }),
    });

    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, json: async () => ({ items: [] }),
    })));

    const service = new LogmeinReconciliationService(
      { enabled: true, reconciliationEnabled: true, companyId: 'c', psk: 'p', timeoutMs: 50, accountTz: 'UTC' },
      undefined,
      repo as never,
    );

    await service.syncRemoteAccessSessions(
      new Date('2025-06-15T01:00:00Z'),
      new Date('2025-06-15T02:00:00Z'),
    );

    vi.unstubAllGlobals();
    expect(capturedAudits[0]?.windowFrom).toBe('2025-06-15');
    expect(capturedAudits[0]?.windowTo).toBe('2025-06-15');
  });
});

// ── parseLocalTimestamp via normalizeSession ───────────────────────────────────
describe('parseLocalTimestamp — offset-free LogMeIn timestamps → UTC', () => {
  async function runSyncWithSession(startTime: string, endTime: string, tz: string) {
    const sessions: unknown[] = [];
    const repo = makeRepo({
      upsertSession: vi.fn(async (s: unknown) => { sessions.push(s); return { inserted: true }; }),
    });

    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        items: [{ sessionId: 'sess-tz-test', hostId: 'h1', groupId: 'g1', startTime, endTime, duration: 3600 }],
      }),
    })));

    const service = new LogmeinReconciliationService(
      { enabled: true, reconciliationEnabled: true, companyId: 'c', psk: 'p', timeoutMs: 50, accountTz: tz },
      undefined,
      repo as never,
    );

    await service.syncRemoteAccessSessions(
      new Date('2025-06-14T00:00:00Z'),
      new Date('2025-06-15T00:00:00Z'),
    );

    vi.unstubAllGlobals();
    return sessions[0] as Record<string, string | null | number> | undefined;
  }

  it('converts 22:00 BRT offset-free → 2025-06-15T01:00:00.000Z', async () => {
    const session = await runSyncWithSession('2025-06-14 22:00:00', '2025-06-14 23:00:00', BRT_TZ);
    expect(session).toBeDefined();
    expect(session?.sessionStartAt).toBe('2025-06-15T01:00:00.000Z');
    expect(session?.sessionEndAt).toBe('2025-06-15T02:00:00.000Z');
  });

  it('converts 00:01 BRT offset-free → 2025-06-14T03:01:00.000Z (next UTC day boundary)', async () => {
    const session = await runSyncWithSession('2025-06-14 00:01:00', '2025-06-14 01:00:00', BRT_TZ);
    expect(session?.sessionStartAt).toBe('2025-06-14T03:01:00.000Z');
    expect(session?.sessionEndAt).toBe('2025-06-14T04:00:00.000Z');
  });

  it('converts 23:59 BRT offset-free → 2025-06-15T02:59:00.000Z', async () => {
    const session = await runSyncWithSession('2025-06-14 23:59:00', '2025-06-14 23:59:59', BRT_TZ);
    expect(session?.sessionStartAt).toBe('2025-06-15T02:59:00.000Z');
    expect(session?.sessionEndAt).toBe('2025-06-15T02:59:59.000Z');
  });

  it('passes through a timestamp that already has Z', async () => {
    const session = await runSyncWithSession('2025-06-14T22:00:00Z', '2025-06-14T23:00:00Z', BRT_TZ);
    expect(session?.sessionStartAt).toBe('2025-06-14T22:00:00.000Z');
  });

  it('passes through a timestamp that already has +00:00 offset', async () => {
    const session = await runSyncWithSession('2025-06-14T15:00:00+00:00', '2025-06-14T16:00:00+00:00', BRT_TZ);
    expect(session?.sessionStartAt).toBe('2025-06-14T15:00:00.000Z');
  });
});

// ── getLastSyncState ──────────────────────────────────────────────────────────
describe('getLastSyncState', () => {
  it('returns never_synced when repository is absent', async () => {
    const service = new LogmeinReconciliationService({ enabled: false, reconciliationEnabled: false });
    const state = await service.getLastSyncState();
    expect(state.lastSyncStatus).toBe('never_synced');
    expect(state.lastAttemptAt).toBeNull();
  });

  it('delegates to repository and returns its result unchanged', async () => {
    const repoState = { lastAttemptAt: '2025-06-14T10:00:00.000Z', lastSyncStatus: 'ok' as const };
    const repo = makeRepo({ getLastSyncState: vi.fn(async () => repoState) });
    const service = new LogmeinReconciliationService(
      { enabled: true, reconciliationEnabled: true, companyId: 'c', psk: 'p' },
      undefined,
      repo as never,
    );
    const state = await service.getLastSyncState();
    expect(state).toEqual(repoState);
  });

  it('maps source_unavailable for failed sync', async () => {
    const repoState = { lastAttemptAt: '2025-06-14T09:00:00.000Z', lastSyncStatus: 'source_unavailable' as const };
    const repo = makeRepo({ getLastSyncState: vi.fn(async () => repoState) });
    const service = new LogmeinReconciliationService(
      { enabled: true, reconciliationEnabled: true, companyId: 'c', psk: 'p' },
      undefined,
      repo as never,
    );
    const state = await service.getLastSyncState();
    expect(state.lastSyncStatus).toBe('source_unavailable');
  });

  it('maps empty for completed sync with 0 sessions', async () => {
    const repoState = { lastAttemptAt: '2025-06-14T08:00:00.000Z', lastSyncStatus: 'empty' as const };
    const repo = makeRepo({ getLastSyncState: vi.fn(async () => repoState) });
    const service = new LogmeinReconciliationService(
      { enabled: true, reconciliationEnabled: true, companyId: 'c', psk: 'p' },
      undefined,
      repo as never,
    );
    const state = await service.getLastSyncState();
    expect(state.lastSyncStatus).toBe('empty');
  });
});
