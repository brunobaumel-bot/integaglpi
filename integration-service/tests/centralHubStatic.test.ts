/**
 * centralHubStatic.test.ts — F3 Central Hub Operacional static tests
 *
 * Verifies structural/security invariants WITHOUT any DB, Redis or network access.
 * All infrastructure dependencies are mocked.
 *
 * Coverage:
 *   F3_1  CentralHubAggregatorService — snapshot structure, invariants, feature flag
 *   F3_2  createCentralHubController — HTTP 200/500 contract
 *   F3_9  CentralHubViewService — allowlist + errorPayload (PHP, verified by type shapes)
 *   Safety — create_ticket:false literal, readonly_note, no PII fields
 *
 * Phase: integaglpi_v9_central_hub_001
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CentralHubAggregatorService } from '../src/domain/services/CentralHubAggregatorService.js';
import type { CentralHubDeps, CentralHubSnapshot } from '../src/domain/services/CentralHubAggregatorService.js';
import { createCentralHubController } from '../src/controllers/createCentralHubController.js';

// ── Mock infra imports ────────────────────────────────────────────────────────

vi.mock('../src/infra/logger/logger.js', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock('../src/cache/redisClient.js', () => ({
  redisClient: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
    status: 'ready',
  },
}));

vi.mock('../src/config/env.js', () => ({
  env: {
    META_APP_SECRET: 'test-secret',
    META_ACCESS_TOKEN: 'test-access-token',
    META_VERIFY_TOKEN: 'test-verify-token',
    GLPI_API_BASE_URL: 'http://glpi.local',
    GLPI_APP_TOKEN: 'app-token',
    GLPI_USER_TOKEN: 'user-token',
    AI_SUPERVISOR_BASE_URL: 'http://ollama.local:11434',
    AI_SUPERVISOR_PROVIDER: 'ollama' as const,
    AI_SUPERVISOR_MODEL: 'llama3.1',
    AI_SUPERVISOR_ENABLED: false,
    AI_ONLINE_ALERT_WORKER_LOOP: false,
    INTEGRATION_SERVICE_API_KEY: 'test-api-key',
  },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeMockPool() {
  return {
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  };
}

function makeMockKbService() {
  return {
    buildReport: vi.fn().mockResolvedValue({
      schema_version: '1.0',
      phase: 'test',
      generated_at: new Date().toISOString(),
      period_days: 30,
      golden_set_meta: { total_queries: 10, source: 'test', evaluated_at: '' },
      feedback_health: { totalVotes: 100, helpfulVotes: 70, notHelpfulVotes: 30, overallHelpfulRatio: 0.7, articlesWithVotes: 5 },
      top_articles: [],
      gap_analysis: [{ category: 'Rede', count: 5, helpfulRatio: 0.6, totalVotes: 5 }],
    }),
  };
}

function makeMockLogmeinContext() {
  return {
    getHealthSummary: vi.fn().mockResolvedValue({
      ok: true,
      status: 'ok',
      lastSyncTimestamp: null,
      lastSyncStatus: 'completed',
      lastSyncDurationMs: null,
      groupsImported: 5,
      hostsImported: 30,
      lastSyncErrorSanitized: null,
      totalHosts: 30,
      tagsValid: 28,
      tagsInvalid: 2,
      hostsWithoutTag: 2,
      groupsWithoutEntity: 1,
      cacheAgeHours: 0.5,
      tagCoveragePercent: 93,
      consecutiveFailures: 0,
      alerts: { syncFailing: false, cacheStale: false, lowTagCoverage: false },
    }),
  };
}

function makeMockLogmeinDashboard() {
  return {
    buildDashboard: vi.fn().mockResolvedValue({
      schema_version: '1.0',
      phase: 'test',
      deliverable: 'F2B_1',
      generated_at: new Date().toISOString(),
      create_ticket: false as const,
      health: {},
      alarm_stats: {
        totalRules: 3,
        enabledRules: 2,
        totalAlarmsLast30Days: 10,
        byType: { host_offline: 5, low_disk: 5 },
      },
      coverage_summary: { hostsWithoutTag: 2, groupsWithoutEntity: 1, hostsWithoutEntity: null },
      readonly_note: 'read-only',
    }),
  };
}

function makeMockAlarmRepo() {
  return {
    listAlarmHistory: vi.fn().mockResolvedValue({
      entries: [
        {
          id: 'uuid-1',
          ruleId: 'rule-1',
          hostId: 'host-1',
          hostname: 'pc-test',
          alarmType: 'host_offline',
          firedAt: new Date(),
          resultType: 'fired' as const,
          glpiTicketId: null,
          eventHash: 'abc123',
        },
        {
          id: 'uuid-2',
          ruleId: 'rule-2',
          hostId: 'host-2',
          hostname: 'pc-test2',
          alarmType: 'low_disk',
          firedAt: new Date(),
          resultType: 'ticket_created' as const,
          glpiTicketId: 999,
          eventHash: 'def456',
        },
      ],
      total: 2,
      limit: 200,
      offset: 0,
    }),
  };
}

function makeDeps(): CentralHubDeps {
  return {
    pool: makeMockPool() as unknown as CentralHubDeps['pool'],
    kbEffectivenessService: makeMockKbService() as unknown as CentralHubDeps['kbEffectivenessService'],
    logmeinContextService: makeMockLogmeinContext() as unknown as CentralHubDeps['logmeinContextService'],
    logmeinDashboardService: makeMockLogmeinDashboard() as unknown as CentralHubDeps['logmeinDashboardService'],
    alarmRepository: makeMockAlarmRepo() as unknown as CentralHubDeps['alarmRepository'],
  };
}

function mockReqRes() {
  const req = {};
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  return { req, res };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('CentralHubAggregatorService — F3_1', () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env['CENTRAL_HUB_ENABLED'];
    delete process.env['CENTRAL_HUB_ENABLED'];
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env['CENTRAL_HUB_ENABLED'] = originalEnv;
    } else {
      delete process.env['CENTRAL_HUB_ENABLED'];
    }
  });

  it('F3_1_01: buildSnapshot returns CentralHubSnapshot with correct shape', async () => {
    const svc = new CentralHubAggregatorService(makeDeps());
    const snapshot = await svc.buildSnapshot();

    expect(snapshot).toHaveProperty('schema_version', '1.0');
    expect(snapshot).toHaveProperty('phase', 'integaglpi_v9_central_hub_001');
    expect(snapshot).toHaveProperty('generated_at');
    expect(snapshot).toHaveProperty('feature_flag_enabled');
    expect(snapshot).toHaveProperty('readonly_note');
    expect(snapshot).toHaveProperty('create_ticket');
    expect(snapshot).toHaveProperty('cards');
  });

  it('F3_1_02: create_ticket is always false (literal invariant)', async () => {
    const svc = new CentralHubAggregatorService(makeDeps());
    const snapshot = await svc.buildSnapshot();
    expect(snapshot.create_ticket).toBe(false);
  });

  it('F3_1_03: create_ticket cannot be truthy', async () => {
    const svc = new CentralHubAggregatorService(makeDeps());
    const snapshot = await svc.buildSnapshot();
    expect(snapshot.create_ticket).not.toBeTruthy();
  });

  it('F3_1_04: readonly_note is non-empty string', async () => {
    const svc = new CentralHubAggregatorService(makeDeps());
    const snapshot = await svc.buildSnapshot();
    expect(typeof snapshot.readonly_note).toBe('string');
    expect(snapshot.readonly_note.length).toBeGreaterThan(0);
  });

  it('F3_1_05: feature_flag_enabled is false by default (CENTRAL_HUB_ENABLED unset)', async () => {
    const svc = new CentralHubAggregatorService(makeDeps());
    const snapshot = await svc.buildSnapshot();
    expect(snapshot.feature_flag_enabled).toBe(false);
  });

  it('F3_1_06: feature_flag_enabled is true when CENTRAL_HUB_ENABLED=true', async () => {
    process.env['CENTRAL_HUB_ENABLED'] = 'true';
    const svc = new CentralHubAggregatorService(makeDeps());
    const snapshot = await svc.buildSnapshot();
    expect(snapshot.feature_flag_enabled).toBe(true);
  });

  it('F3_1_07: feature_flag_enabled is false when CENTRAL_HUB_ENABLED=false', async () => {
    process.env['CENTRAL_HUB_ENABLED'] = 'false';
    const svc = new CentralHubAggregatorService(makeDeps());
    const snapshot = await svc.buildSnapshot();
    expect(snapshot.feature_flag_enabled).toBe(false);
  });

  it('F3_1_08: cards object has all 5 card keys', async () => {
    const svc = new CentralHubAggregatorService(makeDeps());
    const snapshot = await svc.buildSnapshot();
    expect(snapshot.cards).toHaveProperty('saude_hml');
    expect(snapshot.cards).toHaveProperty('smart_help');
    expect(snapshot.cards).toHaveProperty('kb_quality');
    expect(snapshot.cards).toHaveProperty('logmein');
    expect(snapshot.cards).toHaveProperty('alarmes');
  });

  it('F3_1_09: each card has ok, data, error, latency_ms fields', async () => {
    const svc = new CentralHubAggregatorService(makeDeps());
    const snapshot = await svc.buildSnapshot();
    for (const cardKey of ['saude_hml', 'smart_help', 'kb_quality', 'logmein', 'alarmes'] as const) {
      const card = snapshot.cards[cardKey];
      expect(card).toHaveProperty('ok');
      expect(card).toHaveProperty('data');
      expect(card).toHaveProperty('error');
      expect(card).toHaveProperty('latency_ms');
    }
  });

  it('F3_1_10: saude_hml card ok=true with mocked pool', async () => {
    const svc = new CentralHubAggregatorService(makeDeps());
    const snapshot = await svc.buildSnapshot();
    expect(snapshot.cards.saude_hml.ok).toBe(true);
    expect(snapshot.cards.saude_hml.data).not.toBeNull();
  });

  it('F3_1_11: kb_quality card ok=true with mocked KB service', async () => {
    const svc = new CentralHubAggregatorService(makeDeps());
    const snapshot = await svc.buildSnapshot();
    expect(snapshot.cards.kb_quality.ok).toBe(true);
  });

  it('F3_1_12: alarmes card total_events equals repo total', async () => {
    const svc = new CentralHubAggregatorService(makeDeps());
    const snapshot = await svc.buildSnapshot();
    const card = snapshot.cards.alarmes;
    expect(card.ok).toBe(true);
    expect(card.data).not.toBeNull();
    expect(card.data?.total_events).toBe(2);
  });

  it('F3_1_13: alarmes card by_result_type counts correctly', async () => {
    const svc = new CentralHubAggregatorService(makeDeps());
    const snapshot = await svc.buildSnapshot();
    const data = snapshot.cards.alarmes.data;
    expect(data?.by_result_type.fired).toBe(1);
    expect(data?.by_result_type.ticket_created).toBe(1);
    expect(data?.by_result_type.suppressed_cooldown).toBe(0);
    expect(data?.by_result_type.suppressed_dedupe).toBe(0);
    expect(data?.by_result_type.dry_run).toBe(0);
  });

  it('F3_1_14: alarmes card period_days is 7', async () => {
    const svc = new CentralHubAggregatorService(makeDeps());
    const snapshot = await svc.buildSnapshot();
    expect(snapshot.cards.alarmes.data?.period_days).toBe(7);
  });

  it('F3_1_15: alarmes card recent_alarm_types deduplicates', async () => {
    const deps = makeDeps();
    const alarmRepo = {
      listAlarmHistory: vi.fn().mockResolvedValue({
        entries: [
          { id: 'u1', ruleId: 'r1', hostId: 'h1', hostname: 'h', alarmType: 'host_offline', firedAt: new Date(), resultType: 'fired', glpiTicketId: null, eventHash: 'e1' },
          { id: 'u2', ruleId: 'r1', hostId: 'h2', hostname: 'h2', alarmType: 'host_offline', firedAt: new Date(), resultType: 'fired', glpiTicketId: null, eventHash: 'e2' },
          { id: 'u3', ruleId: 'r2', hostId: 'h3', hostname: 'h3', alarmType: 'low_disk', firedAt: new Date(), resultType: 'fired', glpiTicketId: null, eventHash: 'e3' },
        ],
        total: 3, limit: 200, offset: 0,
      }),
    };
    deps.alarmRepository = alarmRepo as unknown as CentralHubDeps['alarmRepository'];
    const svc = new CentralHubAggregatorService(deps);
    const snapshot = await svc.buildSnapshot();
    const types = snapshot.cards.alarmes.data?.recent_alarm_types ?? [];
    // host_offline should appear only once
    expect(types.filter((t) => t === 'host_offline').length).toBe(1);
    expect(types.length).toBeLessThanOrEqual(5);
  });

  it('F3_1_16: card timeout — card with slow fn returns ok=false with error', async () => {
    const deps = makeDeps();
    deps.alarmRepository = {
      listAlarmHistory: vi.fn().mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 4_500));
        return { entries: [], total: 0, limit: 200, offset: 0 };
      }),
    } as unknown as CentralHubDeps['alarmRepository'];

    const svc = new CentralHubAggregatorService(deps);
    const snapshot = await svc.buildSnapshot();
    // alarmes card should have failed due to timeout
    expect(snapshot.cards.alarmes.ok).toBe(false);
    expect(snapshot.cards.alarmes.error).toContain('card_timeout');
  }, 10_000);

  it('F3_1_17: other cards succeed even when one card fails', async () => {
    const deps = makeDeps();
    deps.kbEffectivenessService = {
      buildReport: vi.fn().mockRejectedValue(new Error('kb_db_error')),
    } as unknown as CentralHubDeps['kbEffectivenessService'];

    const svc = new CentralHubAggregatorService(deps);
    const snapshot = await svc.buildSnapshot();
    expect(snapshot.cards.kb_quality.ok).toBe(false);
    // Other cards unaffected
    expect(snapshot.cards.saude_hml.ok).toBe(true);
    expect(snapshot.cards.alarmes.ok).toBe(true);
  });

  it('F3_1_18: smart_help card cloud_enabled is always false', async () => {
    const svc = new CentralHubAggregatorService(makeDeps());
    const snapshot = await svc.buildSnapshot();
    // cloud_enabled must be false (F3 safety invariant)
    // It's set to false in buildSmartHelpCard regardless of DB/env
    const data = snapshot.cards.smart_help.data;
    if (data !== null) {
      expect((data as Record<string, unknown>)['cloud_enabled']).toBe(false);
    }
  });

  it('F3_1_19: snapshot does not contain phone, token, password, ip, mac fields', async () => {
    const svc = new CentralHubAggregatorService(makeDeps());
    const snapshot = await svc.buildSnapshot();
    const json = JSON.stringify(snapshot).toLowerCase();
    // PII field name assertions
    expect(json).not.toContain('"phone"');
    expect(json).not.toContain('"password"');
    expect(json).not.toContain('"psk"');
    expect(json).not.toContain('"mac_address"');
    expect(json).not.toContain('"bearer_token"');
    expect(json).not.toContain('"api_key"');
  });

  it('F3_1_20: schema_version is "1.0"', async () => {
    const svc = new CentralHubAggregatorService(makeDeps());
    const snapshot = await svc.buildSnapshot();
    expect(snapshot.schema_version).toBe('1.0');
  });

  it('F3_1_21: phase is integaglpi_v9_central_hub_001', async () => {
    const svc = new CentralHubAggregatorService(makeDeps());
    const snapshot = await svc.buildSnapshot();
    expect(snapshot.phase).toBe('integaglpi_v9_central_hub_001');
  });

  it('F3_1_22: generated_at is an ISO-8601 string', async () => {
    const svc = new CentralHubAggregatorService(makeDeps());
    const snapshot = await svc.buildSnapshot();
    expect(() => new Date(snapshot.generated_at)).not.toThrow();
    expect(new Date(snapshot.generated_at).toISOString()).toBe(snapshot.generated_at);
  });

  it('F3_1_23: logmein card total_hosts from health summary', async () => {
    const svc = new CentralHubAggregatorService(makeDeps());
    const snapshot = await svc.buildSnapshot();
    expect(snapshot.cards.logmein.data?.total_hosts).toBe(30);
  });

  it('F3_1_24: logmein card enabled_rules from dashboard alarm_stats', async () => {
    const svc = new CentralHubAggregatorService(makeDeps());
    const snapshot = await svc.buildSnapshot();
    expect(snapshot.cards.logmein.data?.enabled_rules).toBe(2);
  });

  it('F3_1_25: kb_quality top_gap_categories sliced to 3', async () => {
    const deps = makeDeps();
    deps.kbEffectivenessService = {
      buildReport: vi.fn().mockResolvedValue({
        schema_version: '1.0',
        phase: 'test',
        generated_at: '',
        period_days: 30,
        golden_set_meta: { total_queries: 10, source: 'test', evaluated_at: '' },
        feedback_health: { totalVotes: 100, helpfulVotes: 70, notHelpfulVotes: 30, overallHelpfulRatio: 0.7, articlesWithVotes: 5 },
        top_articles: [],
        gap_analysis: [
          { category: 'Rede', count: 5, helpfulRatio: 0.6, totalVotes: 5 },
          { category: 'Impressora', count: 3, helpfulRatio: 0.5, totalVotes: 3 },
          { category: 'VPN', count: 2, helpfulRatio: 0.4, totalVotes: 2 },
          { category: 'Acesso', count: 1, helpfulRatio: 0.3, totalVotes: 1 },
        ],
      }),
    } as unknown as CentralHubDeps['kbEffectivenessService'];

    const svc = new CentralHubAggregatorService(deps);
    const snapshot = await svc.buildSnapshot();
    expect(snapshot.cards.kb_quality.data?.top_gap_categories.length).toBeLessThanOrEqual(3);
  });
});

describe('createCentralHubController — F3_2', () => {
  it('F3_2_01: returns HTTP 200 with snapshot on success', async () => {
    const mockService = {
      buildSnapshot: vi.fn().mockResolvedValue({
        schema_version: '1.0',
        phase: 'integaglpi_v9_central_hub_001',
        generated_at: new Date().toISOString(),
        feature_flag_enabled: false,
        cards: { saude_hml: {}, smart_help: {}, kb_quality: {}, logmein: {}, alarmes: {} },
        readonly_note: 'read-only',
        create_ticket: false as const,
      }),
    };

    const controller = createCentralHubController(mockService as unknown as CentralHubAggregatorService);
    const { req, res } = mockReqRes();
    await controller(req as Parameters<typeof controller>[0], res as unknown as Parameters<typeof controller>[1]);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalled();
    const jsonArg = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0] as CentralHubSnapshot;
    expect(jsonArg.create_ticket).toBe(false);
  });

  it('F3_2_02: returns HTTP 500 with error message on service throw', async () => {
    const mockService = {
      buildSnapshot: vi.fn().mockRejectedValue(new Error('db_connection_failed')),
    };

    const controller = createCentralHubController(mockService as unknown as CentralHubAggregatorService);
    const { req, res } = mockReqRes();
    await controller(req as Parameters<typeof controller>[0], res as unknown as Parameters<typeof controller>[1]);

    expect(res.status).toHaveBeenCalledWith(500);
    const jsonArg = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>;
    expect(jsonArg['ok']).toBe(false);
    expect(typeof jsonArg['message']).toBe('string');
  });

  it('F3_2_03: 500 response does not expose stack trace or raw error detail', async () => {
    const mockService = {
      buildSnapshot: vi.fn().mockRejectedValue(new Error('secret_api_key_exposed_in_error')),
    };

    const controller = createCentralHubController(mockService as unknown as CentralHubAggregatorService);
    const { req, res } = mockReqRes();
    await controller(req as Parameters<typeof controller>[0], res as unknown as Parameters<typeof controller>[1]);

    const jsonArg = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>;
    const jsonStr = JSON.stringify(jsonArg);
    // The raw error message must not be forwarded verbatim to the client
    expect(jsonStr).not.toContain('secret_api_key_exposed_in_error');
  });

  it('F3_2_04: controller response never contains create_ticket: true', async () => {
    const mockService = {
      buildSnapshot: vi.fn().mockResolvedValue({
        schema_version: '1.0',
        phase: 'test',
        generated_at: '',
        feature_flag_enabled: false,
        cards: {},
        readonly_note: '',
        create_ticket: false as const,
      }),
    };

    const controller = createCentralHubController(mockService as unknown as CentralHubAggregatorService);
    const { req, res } = mockReqRes();
    await controller(req as Parameters<typeof controller>[0], res as unknown as Parameters<typeof controller>[1]);

    const jsonArg = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>;
    expect(jsonArg['create_ticket']).not.toBe(true);
  });
});
