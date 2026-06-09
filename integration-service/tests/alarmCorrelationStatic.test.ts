/**
 * Alarm Correlation — Static Unit Tests (F4)
 *
 * Validação de invariantes sem acesso ao banco:
 *   - deriveSeverity: cobertura dos 4 níveis
 *   - deriveCorrelationReason: não expõe PII, texto determinístico
 *   - LogmeinAlarmCorrelationService.buildReport:
 *       feature_flag_enabled=false quando env não configurado
 *       create_ticket: false (literal invariant)
 *       real_execution_forbidden: true (literal invariant)
 *       grupos classificados por severidade DESC, totalEvents DESC
 *
 * Phase: integaglpi_v9_alarm_correlation_001 — F4
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import {
  deriveSeverity,
  deriveCorrelationReason,
  LogmeinAlarmCorrelationService,
  type CorrelationGroup,
} from '../src/domain/services/LogmeinAlarmCorrelationService.js';
import type { CorrelationAggregate } from '../src/repositories/postgres/PostgresLogmeinAlarmRepository.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeAggregate(overrides: Partial<CorrelationAggregate> = {}): CorrelationAggregate {
  return {
    alarmType: 'host_offline',
    totalEvents: 2,
    distinctHosts: 1,
    firstEvent: new Date('2026-06-01T10:00:00Z'),
    lastEvent: new Date('2026-06-01T11:00:00Z'),
    cooldownSkippedCount: 0,
    dedupeHitCount: 0,
    ticketCreatedCount: 0,
    ...overrides,
  };
}

// ── deriveSeverity ────────────────────────────────────────────────────────────

describe('deriveSeverity — F4 severity matrix', () => {
  it('critical: >= 10 eventos E >= 3 hosts distintos', () => {
    expect(deriveSeverity(makeAggregate({ totalEvents: 10, distinctHosts: 3 }))).toBe('critical');
    expect(deriveSeverity(makeAggregate({ totalEvents: 15, distinctHosts: 5 }))).toBe('critical');
  });

  it('high: >= 5 eventos OU >= 3 hosts (sem atingir critical)', () => {
    expect(deriveSeverity(makeAggregate({ totalEvents: 5, distinctHosts: 1 }))).toBe('high');
    expect(deriveSeverity(makeAggregate({ totalEvents: 2, distinctHosts: 3 }))).toBe('high');
  });

  it('medium: >= 2 eventos OU >= 2 hosts', () => {
    expect(deriveSeverity(makeAggregate({ totalEvents: 2, distinctHosts: 1 }))).toBe('medium');
    expect(deriveSeverity(makeAggregate({ totalEvents: 1, distinctHosts: 2 }))).toBe('medium');
  });

  it('low: 1 evento, 1 host (default)', () => {
    expect(deriveSeverity(makeAggregate({ totalEvents: 1, distinctHosts: 1 }))).toBe('low');
  });

  it('critical precede high mesmo com hosts < 3', () => {
    // 10 eventos E 3 hosts → critical (não high)
    const s = deriveSeverity(makeAggregate({ totalEvents: 10, distinctHosts: 3 }));
    expect(s).toBe('critical');
    expect(s).not.toBe('high');
  });
});

// ── deriveCorrelationReason ───────────────────────────────────────────────────

describe('deriveCorrelationReason — determinístico, sem PII', () => {
  it('critical → texto com "crítica" e contagem', () => {
    const agg = makeAggregate({ totalEvents: 12, distinctHosts: 4 });
    const r = deriveCorrelationReason(agg, 'critical');
    expect(r.toLowerCase()).toContain('crít');
    expect(r).toContain('12');
  });

  it('high → texto com "alto" e contagem', () => {
    const agg = makeAggregate({ totalEvents: 7, distinctHosts: 2 });
    const r = deriveCorrelationReason(agg, 'high');
    expect(r.toLowerCase()).toContain('alto');
  });

  it('medium → texto com "moderado"', () => {
    const agg = makeAggregate({ totalEvents: 3, distinctHosts: 1 });
    const r = deriveCorrelationReason(agg, 'medium');
    expect(r.toLowerCase()).toContain('moderado');
  });

  it('low → texto informativo', () => {
    const agg = makeAggregate({ totalEvents: 1, distinctHosts: 1 });
    const r = deriveCorrelationReason(agg, 'low');
    expect(typeof r).toBe('string');
    expect(r.length).toBeGreaterThan(0);
  });

  it('inclui porcentagem suprimidos quando há suprimidos', () => {
    const agg = makeAggregate({ totalEvents: 10, cooldownSkippedCount: 4, dedupeHitCount: 1, distinctHosts: 3 });
    const r = deriveCorrelationReason(agg, 'critical');
    expect(r).toContain('%');
    expect(r.toLowerCase()).toContain('suprimid');
  });

  it('inclui contagem de tickets quando há tickets', () => {
    const agg = makeAggregate({ totalEvents: 5, ticketCreatedCount: 2, distinctHosts: 1 });
    const r = deriveCorrelationReason(agg, 'high');
    expect(r).toContain('2');
    expect(r.toLowerCase()).toContain('ticket');
  });

  it('nenhum texto de reason contém tokens sensíveis', () => {
    const severities = ['critical', 'high', 'medium', 'low'] as const;
    const piiPatterns = [/password|senha|token|api_key|bearer/i, /\d{11}/];
    for (const s of severities) {
      const r = deriveCorrelationReason(makeAggregate({ totalEvents: 10, distinctHosts: 4 }), s);
      for (const p of piiPatterns) {
        expect(r).not.toMatch(p);
      }
    }
  });
});

// ── LogmeinAlarmCorrelationService ────────────────────────────────────────────

describe('LogmeinAlarmCorrelationService — F4 invariants', () => {
  let savedEnv: string | undefined;

  beforeEach(() => {
    savedEnv = process.env['ALARM_CORRELATION_ENABLED'];
    delete process.env['ALARM_CORRELATION_ENABLED'];
  });

  afterEach(() => {
    if (savedEnv === undefined) {
      delete process.env['ALARM_CORRELATION_ENABLED'];
    } else {
      process.env['ALARM_CORRELATION_ENABLED'] = savedEnv;
    }
  });

  function makeRepo(aggregates: CorrelationAggregate[] = []) {
    return {
      listCorrelationAggregates: vi.fn().mockResolvedValue(aggregates),
    };
  }

  it('feature_flag_enabled=false quando env não configurado', async () => {
    const svc = new LogmeinAlarmCorrelationService(makeRepo() as never);
    const report = await svc.buildReport();
    expect(report.feature_flag_enabled).toBe(false);
  });

  it('feature_flag_enabled=true quando ALARM_CORRELATION_ENABLED=true', async () => {
    process.env['ALARM_CORRELATION_ENABLED'] = 'true';
    const svc = new LogmeinAlarmCorrelationService(makeRepo() as never);
    const report = await svc.buildReport();
    expect(report.feature_flag_enabled).toBe(true);
  });

  it('create_ticket é sempre false (literal invariant)', async () => {
    const svc = new LogmeinAlarmCorrelationService(makeRepo() as never);
    const report = await svc.buildReport();
    expect(report.create_ticket).toBe(false);
    expect(report.create_ticket).not.toBeTruthy();
  });

  it('real_execution_forbidden é sempre true (literal invariant)', async () => {
    const svc = new LogmeinAlarmCorrelationService(makeRepo() as never);
    const report = await svc.buildReport();
    expect(report.real_execution_forbidden).toBe(true);
  });

  it('groups sem aggregates → empty array', async () => {
    const svc = new LogmeinAlarmCorrelationService(makeRepo([]) as never);
    const report = await svc.buildReport();
    expect(report.groups).toHaveLength(0);
    expect(report.total_groups).toBe(0);
  });

  it('groups ordenados: severity DESC, totalEvents DESC', async () => {
    const aggs: CorrelationAggregate[] = [
      makeAggregate({ alarmType: 'low_disk', totalEvents: 2, distinctHosts: 1 }),   // medium
      makeAggregate({ alarmType: 'host_offline', totalEvents: 12, distinctHosts: 4 }), // critical
      makeAggregate({ alarmType: 'host_not_seen', totalEvents: 5, distinctHosts: 1 }), // high
    ];
    const svc = new LogmeinAlarmCorrelationService(makeRepo(aggs) as never);
    const report = await svc.buildReport();

    expect(report.groups[0].severity).toBe('critical');
    expect(report.groups[1].severity).toBe('high');
    expect(report.groups[2].severity).toBe('medium');
  });

  it('cada group tem todos os campos obrigatórios', async () => {
    const agg = makeAggregate({ totalEvents: 3, distinctHosts: 2 });
    const svc = new LogmeinAlarmCorrelationService(makeRepo([agg]) as never);
    const report = await svc.buildReport();
    const g = report.groups[0] as CorrelationGroup;

    expect(typeof g.alarmType).toBe('string');
    expect(typeof g.totalEvents).toBe('number');
    expect(typeof g.distinctHosts).toBe('number');
    expect(typeof g.windowMinutes).toBe('number');
    expect(typeof g.firstEvent).toBe('string');
    expect(typeof g.lastEvent).toBe('string');
    expect(typeof g.durationMinutes).toBe('number');
    expect(['critical', 'high', 'medium', 'low']).toContain(g.severity);
    expect(typeof g.reason).toBe('string');
    expect(g.reason.length).toBeGreaterThan(0);
    expect(typeof g.ticketsCreated).toBe('number');
  });

  it('window_minutes defaults e validados (1..10080)', async () => {
    const repo = makeRepo();
    const svc = new LogmeinAlarmCorrelationService(repo as never);

    await svc.buildReport(0); // below min → 1
    expect(repo.listCorrelationAggregates).toHaveBeenCalledWith(1, expect.any(Number));

    await svc.buildReport(99999); // above max → 10080
    expect(repo.listCorrelationAggregates).toHaveBeenCalledWith(10_080, expect.any(Number));
  });

  it('limit defaults e validados (1..100)', async () => {
    const repo = makeRepo();
    const svc = new LogmeinAlarmCorrelationService(repo as never);

    await svc.buildReport(60, 0); // below min → 1
    expect(repo.listCorrelationAggregates).toHaveBeenCalledWith(expect.any(Number), 1);

    await svc.buildReport(60, 9999); // above max → 100
    expect(repo.listCorrelationAggregates).toHaveBeenCalledWith(expect.any(Number), 100);
  });

  it('nenhum campo do report contém PII', async () => {
    const svc = new LogmeinAlarmCorrelationService(makeRepo() as never);
    const report = await svc.buildReport();
    const json = JSON.stringify(report);
    const piiPatterns = [/password|senha|token|bearer/i, /\d{11}/];
    for (const p of piiPatterns) {
      expect(json).not.toMatch(p);
    }
  });
});
