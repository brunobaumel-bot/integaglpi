/**
 * LogMeIn Operations HTTP — Static Controller Tests (F2B)
 *
 * Testa os 5 controllers como funções puras (sem framework real):
 *   1. createLogmeinOperationsDashboardController
 *   2. createLogmeinAlarmHistoryController
 *   3. createLogmeinRuleTestController
 *   4. createLogmeinLowDiskDryRunController
 *   5. createLogmeinCoverageController
 *
 * Cada controller é instanciado com mocks vitest.
 * Não inicia servidor real (sem supertest).
 *
 * Invariantes verificadas:
 *   - create_ticket: false em toda resposta de simulação
 *   - simulatedOnly: true em test-rule e low-disk dry-run
 *   - Erros de serviço → 500 com mensagem genérica (raw error NÃO exposto)
 *   - Parâmetros inválidos em test-rule → 400
 *
 * Phase: integaglpi_v9_logmein_operations_001 — F2B
 */

import { describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';

import {
  createLogmeinOperationsDashboardController,
  createLogmeinAlarmHistoryController,
  createLogmeinRuleTestController,
  createLogmeinLowDiskDryRunController,
  createLogmeinCoverageController,
} from '../src/controllers/logmein.controller.js';

// ── Mock helpers ──────────────────────────────────────────────────────────────

function makeRes() {
  const json = vi.fn().mockReturnThis();
  const status = vi.fn().mockReturnThis();
  return { json, status, _calls: { json, status } } as unknown as Response;
}

function makeReq(overrides: Partial<Request> = {}): Request {
  return {
    query: {},
    body: {},
    params: {},
    ...overrides,
  } as Request;
}

function getJsonArg(res: Response): Record<string, unknown> {
  return (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>;
}

function getStatusArg(res: Response): number {
  return (res.status as ReturnType<typeof vi.fn>).mock.calls[0][0] as number;
}

// ── 1. Dashboard controller ───────────────────────────────────────────────────

describe('createLogmeinOperationsDashboardController', () => {
  const fakeDashboard = {
    schema_version: '1.0',
    create_ticket: false as const,
    health: {},
    alarm_stats: {},
    coverage_summary: {},
  };
  const fakeHealth = { totalHosts: 5 };

  function makeDeps(overrides: Record<string, unknown> = {}) {
    return {
      dashboardService: {
        buildDashboard: vi.fn().mockResolvedValue(fakeDashboard),
        ...overrides,
      },
      contextService: {
        getHealthSummary: vi.fn().mockResolvedValue(fakeHealth),
      },
    };
  }

  it('200 com dashboard no payload', async () => {
    const deps = makeDeps();
    const ctrl = createLogmeinOperationsDashboardController(deps as never);
    const req = makeReq();
    const res = makeRes();

    await ctrl(req, res);

    expect(getStatusArg(res)).toBe(200);
    const body = getJsonArg(res);
    expect(body['create_ticket']).toBe(false);
  });

  it('500 quando serviço lança exceção — raw error não exposto', async () => {
    const deps = makeDeps({ buildDashboard: vi.fn().mockRejectedValue(new Error('DB_DOWN: connection refused')) });
    const ctrl = createLogmeinOperationsDashboardController(deps as never);
    const res = makeRes();

    await ctrl(makeReq(), res);

    expect(getStatusArg(res)).toBe(500);
    const body = getJsonArg(res);
    expect(JSON.stringify(body)).not.toContain('DB_DOWN');
    expect(JSON.stringify(body)).not.toContain('connection refused');
    expect(body['ok']).toBe(false);
  });
});

// ── 2. Alarm history controller ───────────────────────────────────────────────

describe('createLogmeinAlarmHistoryController', () => {
  const fakePage = {
    entries: [
      {
        id: 'evt-001',
        ruleId: 'rule-001',
        hostId: 'host-001',
        hostname: 'DESKTOP-TEST',
        alarmType: 'host_offline',
        firedAt: new Date(),
        resultType: 'fired' as const,
        reason: 'Evento de alarme registrado.',
        glpiTicketId: null,
        eventHash: 'abc123',
      },
    ],
    total: 1,
    limit: 50,
    offset: 0,
  };

  function makeRepo() {
    return { listAlarmHistory: vi.fn().mockResolvedValue(fakePage) };
  }

  it('200 com página de entradas', async () => {
    const repo = makeRepo();
    const ctrl = createLogmeinAlarmHistoryController(repo as never);
    const res = makeRes();

    await ctrl(makeReq(), res);

    expect(getStatusArg(res)).toBe(200);
    const body = getJsonArg(res);
    expect(body['ok']).toBe(true);
    expect(body['total']).toBe(1);
    expect(Array.isArray(body['entries'])).toBe(true);
  });

  it('entries incluem campo reason', async () => {
    const repo = makeRepo();
    const ctrl = createLogmeinAlarmHistoryController(repo as never);
    const res = makeRes();

    await ctrl(makeReq(), res);

    const body = getJsonArg(res);
    const entries = body['entries'] as Array<Record<string, unknown>>;
    expect(entries[0]['reason']).toBe('Evento de alarme registrado.');
  });

  it('query params limit/offset/period_days são repassados', async () => {
    const repo = makeRepo();
    const ctrl = createLogmeinAlarmHistoryController(repo as never);
    const req = makeReq({ query: { limit: '10', offset: '20', period_days: '7' } });
    const res = makeRes();

    await ctrl(req, res);

    expect(repo.listAlarmHistory).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 10, offset: 20, periodDays: 7 }),
    );
  });

  it('500 quando repo lança exceção', async () => {
    const repo = { listAlarmHistory: vi.fn().mockRejectedValue(new Error('timeout')) };
    const ctrl = createLogmeinAlarmHistoryController(repo as never);
    const res = makeRes();

    await ctrl(makeReq(), res);

    expect(getStatusArg(res)).toBe(500);
    expect(getJsonArg(res)['ok']).toBe(false);
  });
});

// ── 3. Rule test controller ───────────────────────────────────────────────────

describe('createLogmeinRuleTestController', () => {
  const fakeResult = {
    outcome: 'condition_met' as const,
    conditionMet: true,
    reason: 'Host está offline.',
    create_ticket: false as const,
    simulatedOnly: true as const,
  };

  function makeService() {
    return { evaluate: vi.fn().mockReturnValue(fakeResult) };
  }

  const validBody = {
    rule: {
      id: 'rule-001',
      rule_name: 'Test Rule',
      alarm_type: 'host_offline',
      enabled: true,
      cooldown_minutes: 15,
      condition_payload: {},
      glpi_entities_id: 1,
      create_ticket: false,
    },
    host: {
      external_id: 'host-001',
      group_external_id: 'grp-001',
      group_name: 'Grupo',
      host_name: 'DESKTOP',
      equipment_tag: '1234',
      status: 'offline',
      last_seen_at: null,
    },
    hardware: null,
  };

  it('200 com resultado de simulação, create_ticket=false, simulatedOnly=true', async () => {
    const svc = makeService();
    const ctrl = createLogmeinRuleTestController(svc as never);
    const req = makeReq({ body: validBody });
    const res = makeRes();

    await ctrl(req, res);

    expect(getStatusArg(res)).toBe(200);
    const body = getJsonArg(res);
    expect(body['create_ticket']).toBe(false);
    expect(body['simulatedOnly']).toBe(true);
    expect(body['ok']).toBe(true);
  });

  it('400 quando rule ausente', async () => {
    const svc = makeService();
    const ctrl = createLogmeinRuleTestController(svc as never);
    const req = makeReq({ body: { host: validBody.host } });
    const res = makeRes();

    await ctrl(req, res);

    expect(getStatusArg(res)).toBe(400);
    expect(getJsonArg(res)['status']).toBe('invalid_body');
  });

  it('400 quando host ausente', async () => {
    const svc = makeService();
    const ctrl = createLogmeinRuleTestController(svc as never);
    const req = makeReq({ body: { rule: validBody.rule } });
    const res = makeRes();

    await ctrl(req, res);

    expect(getStatusArg(res)).toBe(400);
    expect(getJsonArg(res)['status']).toBe('invalid_body');
  });

  it('500 quando serviço lança exceção — raw error não exposto', async () => {
    const svc = { evaluate: vi.fn().mockImplementation(() => { throw new Error('INTERNAL_SECRET'); }) };
    const ctrl = createLogmeinRuleTestController(svc as never);
    const req = makeReq({ body: validBody });
    const res = makeRes();

    await ctrl(req, res);

    expect(getStatusArg(res)).toBe(500);
    expect(JSON.stringify(getJsonArg(res))).not.toContain('INTERNAL_SECRET');
  });
});

// ── 4. Low disk dry-run controller ────────────────────────────────────────────

describe('createLogmeinLowDiskDryRunController', () => {
  const fakeCheckResult = {
    create_ticket: false as const,
    simulatedOnly: true as const,
    status: 'ok' as const,
    partitions: [],
    message: 'Todos os discos com espaço suficiente.',
    hostId: 'host-001',
    thresholdPercent: 15,
  };

  function makeService() {
    return { check: vi.fn().mockReturnValue(fakeCheckResult) };
  }

  const validBody = {
    host_id: 'host-001',
    hardware: {
      host_id: 1,
      partitions: [],
    },
  };

  it('200 com resultado contendo create_ticket=false e simulatedOnly=true', async () => {
    const svc = makeService();
    const ctrl = createLogmeinLowDiskDryRunController(svc as never);
    const req = makeReq({ body: validBody });
    const res = makeRes();

    await ctrl(req, res);

    expect(getStatusArg(res)).toBe(200);
    const body = getJsonArg(res);
    expect(body['ok']).toBe(true);
    const result = body['result'] as Record<string, unknown>;
    expect(result['create_ticket']).toBe(false);
    expect(result['simulatedOnly']).toBe(true);
  });

  it('400 quando hardware ausente', async () => {
    const svc = makeService();
    const ctrl = createLogmeinLowDiskDryRunController(svc as never);
    const req = makeReq({ body: { host_id: 'host-001' } });
    const res = makeRes();

    await ctrl(req, res);

    expect(getStatusArg(res)).toBe(400);
    expect(getJsonArg(res)['status']).toBe('invalid_body');
  });

  it('500 quando serviço lança exceção', async () => {
    const svc = { check: vi.fn().mockImplementation(() => { throw new Error('DISK_ERROR_SECRET'); }) };
    const ctrl = createLogmeinLowDiskDryRunController(svc as never);
    const req = makeReq({ body: validBody });
    const res = makeRes();

    await ctrl(req, res);

    expect(getStatusArg(res)).toBe(500);
    expect(JSON.stringify(getJsonArg(res))).not.toContain('DISK_ERROR_SECRET');
  });
});

// ── 5. Coverage controller ────────────────────────────────────────────────────

describe('createLogmeinCoverageController', () => {
  const fakeCoverage = {
    schema_version: '1.0',
    hostsWithoutEntity: { entries: [], total: 0, limit: 50, offset: 0 },
    groupsWithoutEntity: { entries: [], total: 0, limit: 50, offset: 0 },
    hostsWithoutTag: { entries: [], total: 3, limit: 50, offset: 0 },
  };

  function makeService() {
    return { buildReport: vi.fn().mockResolvedValue(fakeCoverage) };
  }

  it('200 com relatório de cobertura', async () => {
    const svc = makeService();
    const ctrl = createLogmeinCoverageController(svc as never);
    const res = makeRes();

    await ctrl(makeReq(), res);

    expect(getStatusArg(res)).toBe(200);
    const body = getJsonArg(res);
    expect(body['ok']).toBe(true);
    expect(body['report']).toBeDefined();
  });

  it('query params limit/offset repassados ao serviço', async () => {
    const svc = makeService();
    const ctrl = createLogmeinCoverageController(svc as never);
    const req = makeReq({ query: { limit: '100', offset: '50' } });
    const res = makeRes();

    await ctrl(req, res);

    expect(svc.buildReport).toHaveBeenCalledWith({ limit: 100, offset: 50 });
  });

  it('500 quando serviço lança exceção', async () => {
    const svc = { buildReport: vi.fn().mockRejectedValue(new Error('COVERAGE_FAIL')) };
    const ctrl = createLogmeinCoverageController(svc as never);
    const res = makeRes();

    await ctrl(makeReq(), res);

    expect(getStatusArg(res)).toBe(500);
    expect(JSON.stringify(getJsonArg(res))).not.toContain('COVERAGE_FAIL');
  });
});
