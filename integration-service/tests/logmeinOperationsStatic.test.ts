/**
 * LogMeIn Operations — Static Unit Tests (F2B)
 *
 * Validação de invariantes de segurança sem acesso ao banco:
 *   - Nenhum ticket criado (create_ticket: false sempre)
 *   - Nenhuma mensagem WhatsApp enviada
 *   - Nenhuma mutação de estado
 *   - DATA_UNAVAILABLE quando partições não estão populadas (F2B_3)
 *   - simulatedOnly: true em toda simulação (F2B_4)
 *   - Nenhum PII em relatórios (F2B_1, F2B_5)
 *   - deriveResultType cobre todos os casos do contrato (F2B_2)
 *   - Coverage queries são read-only e paginadas (F2B_5)
 *
 * Phase: integaglpi_v9_logmein_operations_001
 */

import { describe, expect, it, vi } from 'vitest';

import {
  deriveResultType,
  type AlarmHistoryFilters,
  type AlarmHistoryPage,
} from '../src/repositories/postgres/PostgresLogmeinAlarmRepository.js';

import {
  LogmeinLowDiskCheckService,
} from '../src/domain/services/LogmeinLowDiskCheckService.js';

import {
  LogmeinRuleTestService,
} from '../src/domain/services/LogmeinRuleTestService.js';

import {
  LogmeinOperationsDashboardService,
} from '../src/domain/services/LogmeinOperationsDashboardService.js';

import {
  LogmeinCoverageReportService,
} from '../src/domain/services/LogmeinCoverageReportService.js';

import type { LogmeinAlarmRule } from '../src/repositories/postgres/PostgresLogmeinAlarmRepository.js';
import type { LogmeinHostContext } from '../src/domain/services/LogmeinReadonlyContextService.js';
import type { LogmeinHardwareInventory } from '../src/domain/services/LogmeinHardwareInventoryService.js';
import type { LogmeinHealthSummary } from '../src/domain/services/LogmeinReadonlyContextService.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRule(overrides: Partial<LogmeinAlarmRule> = {}): LogmeinAlarmRule {
  return {
    id: 'rule-001',
    ruleName: 'Test Rule',
    alarmType: 'host_offline',
    enabled: true,
    cooldownMinutes: 60,
    conditionPayload: {},
    glpiEntitiesId: 1,
    glpiGroupId: null,
    glpiItilCategoryId: null,
    createTicket: false,
    minConsecutiveChecks: 1,
    consecutiveCheckIntervalMinutes: 5,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeHost(overrides: Partial<LogmeinHostContext> = {}): LogmeinHostContext {
  return {
    externalId: 'host-001',
    groupExternalId: 'group-001',
    groupName: 'Grupo Teste',
    hostName: 'DESKTOP-TEST',
    equipmentTag: '1234',
    status: 'online',
    lastSeenAt: new Date().toISOString(),
    glpiEntityCandidateId: 42,
    ...overrides,
  };
}

function makeHardware(
  partitions: Array<{ drive?: string; freeSpaceMb?: number | null; totalSizeMb?: number | null }>,
): LogmeinHardwareInventory {
  return {
    hostId: 1,
    serviceTag: null,
    manufacturer: null,
    model: null,
    memoryMb: 8192,
    memoryModules: null,
    batteryName: null,
    motherboardChipset: null,
    motherboardMemorySlots: null,
    primaryScreenResolution: null,
    processors: [],
    drives: [],
    displays: [],
    networkConnections: [],
    partitions: partitions.map((p) => ({
      drive: p.drive ?? 'C:',
      fileSystem: 'NTFS',
      name: p.drive ?? 'C:',
      raidFailingDiskNumber: null,
      raidStatus: null,
      freeSpaceMb: p.freeSpaceMb !== undefined ? p.freeSpaceMb : 10240,
      totalSizeMb: p.totalSizeMb !== undefined ? p.totalSizeMb : 102400,
    })),
  };
}

function makeEmptyHealthSummary(): LogmeinHealthSummary {
  return {
    ok: true,
    status: 'ok',
    lastSyncTimestamp: null,
    lastSyncStatus: 'completed',
    lastSyncDurationMs: null,
    groupsImported: 0,
    hostsImported: 0,
    lastSyncErrorSanitized: null,
    totalHosts: 10,
    tagsValid: 8,
    tagsInvalid: 0,
    hostsWithoutTag: 2,
    groupsWithoutEntity: 1,
    cacheAgeHours: 1,
    tagCoveragePercent: 80,
    consecutiveFailures: 0,
    alerts: { syncFailing: false, cacheStale: false, lowTagCoverage: false, groupsWithoutEntity: true },
    thresholds: { cacheStaleWarningHours: 6, cacheStaleCriticalHours: 24, consecutiveFailuresWarning: 3, tagCoverageWarningPercent: 70 },
    readOnly: true,
  };
}

// ── F2B_2: deriveResultType ───────────────────────────────────────────────────

describe('deriveResultType — F2B_2 contract', () => {
  it('cooldown_skipped=true → suppressed_cooldown (prioridade 1)', () => {
    expect(deriveResultType({
      cooldown_skipped: true,
      dedupe_hit: true,
      glpi_ticket_id: 123,
      alarm_type: 'dry_run_test',
    })).toBe('suppressed_cooldown');
  });

  it('dedupe_hit=true (sem cooldown) → suppressed_dedupe (prioridade 2)', () => {
    expect(deriveResultType({
      cooldown_skipped: false,
      dedupe_hit: true,
      glpi_ticket_id: 123,
      alarm_type: 'dry_run_test',
    })).toBe('suppressed_dedupe');
  });

  it('glpi_ticket_id preenchido → ticket_created (prioridade 3)', () => {
    expect(deriveResultType({
      cooldown_skipped: false,
      dedupe_hit: false,
      glpi_ticket_id: 456,
      alarm_type: 'dry_run_test',
    })).toBe('ticket_created');
  });

  it("alarm_type contém 'dry_run' → dry_run (prioridade 4)", () => {
    expect(deriveResultType({
      cooldown_skipped: false,
      dedupe_hit: false,
      glpi_ticket_id: null,
      alarm_type: 'dry_run_host_offline',
    })).toBe('dry_run');
  });

  it('nenhuma condição especial → fired (default)', () => {
    expect(deriveResultType({
      cooldown_skipped: false,
      dedupe_hit: false,
      glpi_ticket_id: null,
      alarm_type: 'host_offline',
    })).toBe('fired');
  });

  it('todos os AlarmResultType cobertos pelo switch', () => {
    const types = ['fired', 'suppressed_cooldown', 'suppressed_dedupe', 'ticket_created', 'dry_run'];
    expect(types).toHaveLength(5);
    // Confirm that deriveResultType can return all 5
    const r1 = deriveResultType({ cooldown_skipped: false, dedupe_hit: false, glpi_ticket_id: null, alarm_type: 'host_offline' });
    const r2 = deriveResultType({ cooldown_skipped: true, dedupe_hit: false, glpi_ticket_id: null, alarm_type: 'host_offline' });
    const r3 = deriveResultType({ cooldown_skipped: false, dedupe_hit: true, glpi_ticket_id: null, alarm_type: 'host_offline' });
    const r4 = deriveResultType({ cooldown_skipped: false, dedupe_hit: false, glpi_ticket_id: 1, alarm_type: 'host_offline' });
    const r5 = deriveResultType({ cooldown_skipped: false, dedupe_hit: false, glpi_ticket_id: null, alarm_type: 'dry_run_low_disk' });
    expect(new Set([r1, r2, r3, r4, r5]).size).toBe(5);
  });
});

// ── F2B_3: LogmeinLowDiskCheckService ────────────────────────────────────────

describe('LogmeinLowDiskCheckService — F2B_3', () => {
  const svc = new LogmeinLowDiskCheckService(10);

  it('create_ticket é sempre false (invariante literal)', () => {
    const result = svc.check('host-001', null);
    expect(result.create_ticket).toBe(false);
    // TypeScript literal type: the value can only ever be false
    const _: false = result.create_ticket; // compile-time check
    expect(_).toBe(false);
  });

  it('simulatedOnly é sempre true', () => {
    const result = svc.check('host-001', null);
    expect(result.simulatedOnly).toBe(true);
  });

  it('hardware=null → status DATA_UNAVAILABLE', () => {
    const result = svc.check('host-001', null);
    expect(result.status).toBe('data_unavailable');
    expect(result.partitions).toHaveLength(0);
  });

  it('partitions vazio → DATA_UNAVAILABLE', () => {
    const hw = makeHardware([]);
    const result = svc.check('host-001', hw);
    expect(result.status).toBe('data_unavailable');
  });

  it('totalSizeMb=null → partição DATA_UNAVAILABLE', () => {
    const hw = makeHardware([{ freeSpaceMb: 5000, totalSizeMb: null }]);
    const result = svc.check('host-001', hw);
    expect(result.partitions[0]!.status).toBe('data_unavailable');
  });

  it('freeSpaceMb=null → partição DATA_UNAVAILABLE', () => {
    const hw = makeHardware([{ freeSpaceMb: null, totalSizeMb: 100000 }]);
    const result = svc.check('host-001', hw);
    expect(result.partitions[0]!.status).toBe('data_unavailable');
  });

  it('todas partições unavailable → aggregate DATA_UNAVAILABLE', () => {
    const hw = makeHardware([
      { freeSpaceMb: null, totalSizeMb: null },
      { freeSpaceMb: null, totalSizeMb: null },
    ]);
    const result = svc.check('host-001', hw);
    expect(result.status).toBe('data_unavailable');
  });

  it('freePercent < 10% → alert', () => {
    // 5% free
    const hw = makeHardware([{ freeSpaceMb: 5000, totalSizeMb: 100000 }]);
    const result = svc.check('host-001', hw);
    expect(result.status).toBe('alert');
    expect(result.partitions[0]!.status).toBe('alert');
    expect(result.partitions[0]!.freePercent).toBe(5);
    expect(result.create_ticket).toBe(false);
  });

  it('freePercent >= 10% → ok', () => {
    // 20% free
    const hw = makeHardware([{ freeSpaceMb: 20000, totalSizeMb: 100000 }]);
    const result = svc.check('host-001', hw);
    expect(result.status).toBe('ok');
    expect(result.partitions[0]!.freePercent).toBe(20);
    expect(result.create_ticket).toBe(false);
  });

  it('uma partição em alert → status agregado é alert', () => {
    const hw = makeHardware([
      { drive: 'C:', freeSpaceMb: 50000, totalSizeMb: 100000 }, // 50% ok
      { drive: 'D:', freeSpaceMb: 2000, totalSizeMb: 100000 },  // 2% alert
    ]);
    const result = svc.check('host-001', hw);
    expect(result.status).toBe('alert');
    expect(result.create_ticket).toBe(false);
  });

  it('resultado NÃO contém PII (token, senha, MAC, IP, usuário)', () => {
    const hw = makeHardware([{ freeSpaceMb: 5000, totalSizeMb: 100000 }]);
    const result = svc.check('host-001', hw);
    const json = JSON.stringify(result);
    expect(json).not.toMatch(/password|token|secret|mac_address|ip_address|usuario/i);
  });
});

// ── F2B_4: LogmeinRuleTestService ─────────────────────────────────────────────

describe('LogmeinRuleTestService — F2B_4', () => {
  const svc = new LogmeinRuleTestService(10);

  it('simulatedOnly é sempre true', () => {
    const result = svc.evaluate(makeRule(), makeHost(), null);
    expect(result.simulatedOnly).toBe(true);
  });

  it('createTicket é sempre false', () => {
    const result = svc.evaluate(makeRule(), makeHost(), null);
    expect(result.createTicket).toBe(false);
  });

  it('whatsAppSent é sempre false', () => {
    const result = svc.evaluate(makeRule(), makeHost(), null);
    expect(result.whatsAppSent).toBe(false);
  });

  it('stateModified é sempre false', () => {
    const result = svc.evaluate(makeRule(), makeHost(), null);
    expect(result.stateModified).toBe(false);
  });

  it('regra disabled → suppressed (sem avaliar condição)', () => {
    const rule = makeRule({ enabled: false });
    const result = svc.evaluate(rule, makeHost({ status: 'offline' }), null);
    expect(result.outcome).toBe('suppressed');
    expect(result.conditionMet).toBeNull();
  });

  it('host_offline: host online → suppressed', () => {
    const rule = makeRule({ alarmType: 'host_offline' });
    const result = svc.evaluate(rule, makeHost({ status: 'online' }), null);
    expect(result.outcome).toBe('suppressed');
    expect(result.conditionMet).toBe(false);
  });

  it('host_offline: host offline → fired', () => {
    const rule = makeRule({ alarmType: 'host_offline' });
    const result = svc.evaluate(rule, makeHost({ status: 'offline' }), null);
    expect(result.outcome).toBe('fired');
    expect(result.conditionMet).toBe(true);
    expect(result.createTicket).toBe(false);
  });

  it('host_offline: status unknown → data_unavailable', () => {
    const rule = makeRule({ alarmType: 'host_offline' });
    const result = svc.evaluate(rule, makeHost({ status: 'unknown' }), null);
    expect(result.outcome).toBe('data_unavailable');
    expect(result.conditionMet).toBeNull();
  });

  it('missing_equipment_tag: tag ausente → fired', () => {
    const rule = makeRule({ alarmType: 'missing_equipment_tag' });
    const result = svc.evaluate(rule, makeHost({ equipmentTag: '' }), null);
    expect(result.outcome).toBe('fired');
    expect(result.conditionMet).toBe(true);
  });

  it('missing_equipment_tag: tag presente → suppressed', () => {
    const rule = makeRule({ alarmType: 'missing_equipment_tag' });
    const result = svc.evaluate(rule, makeHost({ equipmentTag: '1234' }), null);
    expect(result.outcome).toBe('suppressed');
    expect(result.conditionMet).toBe(false);
  });

  it('missing_entity_mapping: sem entidade → fired', () => {
    const rule = makeRule({ alarmType: 'missing_entity_mapping' });
    const result = svc.evaluate(rule, makeHost({ glpiEntityCandidateId: null }), null);
    expect(result.outcome).toBe('fired');
  });

  it('low_disk: hardware=null → data_unavailable', () => {
    const rule = makeRule({ alarmType: 'low_disk' });
    const result = svc.evaluate(rule, makeHost(), null);
    expect(result.outcome).toBe('data_unavailable');
    expect(result.createTicket).toBe(false);
  });

  it('low_disk: partições sem dados → data_unavailable', () => {
    const rule = makeRule({ alarmType: 'low_disk' });
    const hw = makeHardware([{ freeSpaceMb: null, totalSizeMb: null }]);
    const result = svc.evaluate(rule, makeHost(), hw);
    expect(result.outcome).toBe('data_unavailable');
    expect(result.createTicket).toBe(false);
  });

  it('low_disk: 5% free → fired (limiar 10%)', () => {
    const rule = makeRule({
      alarmType: 'low_disk',
      conditionPayload: { free_percent_threshold: 10 },
    });
    const hw = makeHardware([{ freeSpaceMb: 5000, totalSizeMb: 100000 }]);
    const result = svc.evaluate(rule, makeHost(), hw);
    expect(result.outcome).toBe('fired');
    expect(result.createTicket).toBe(false);
  });

  it('hardware_change → data_unavailable (sem snapshot anterior)', () => {
    const rule = makeRule({ alarmType: 'hardware_change' });
    const result = svc.evaluate(rule, makeHost(), null);
    expect(result.outcome).toBe('data_unavailable');
  });

  it('resultado sempre tem evaluatedAt como ISO 8601', () => {
    const result = svc.evaluate(makeRule(), makeHost(), null);
    expect(result.evaluatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
});

// ── F2B_1: LogmeinOperationsDashboardService ──────────────────────────────────

describe('LogmeinOperationsDashboardService — F2B_1', () => {
  function makeMockAlarmRepo() {
    return {
      listAllRules: vi.fn().mockResolvedValue([makeRule(), makeRule({ id: 'rule-002', alarmType: 'low_disk' })]),
      listEnabledRules: vi.fn().mockResolvedValue([makeRule()]),
      listAlarmHistory: vi.fn(),
      listRecentEvents: vi.fn(),
      insertEventIfNew: vi.fn(),
      isSchemaReady: vi.fn().mockResolvedValue(true),
      getRuleById: vi.fn(),
      createRule: vi.fn(),
      updateRule: vi.fn(),
      deleteRule: vi.fn(),
      listTargetsForRule: vi.fn(),
      addTarget: vi.fn(),
      removeTarget: vi.fn(),
      getHostsCurrentStatus: vi.fn(),
    };
  }

  it('create_ticket é sempre false no dashboard', async () => {
    const repo = makeMockAlarmRepo();
    const svc = new LogmeinOperationsDashboardService(repo as never);
    const dashboard = await svc.buildDashboard(makeEmptyHealthSummary());
    expect(dashboard.create_ticket).toBe(false);
  });

  it('dashboard tem schema_version, phase, deliverable', async () => {
    const repo = makeMockAlarmRepo();
    const svc = new LogmeinOperationsDashboardService(repo as never);
    const dashboard = await svc.buildDashboard(makeEmptyHealthSummary());
    expect(dashboard.schema_version).toBe('1.0');
    expect(dashboard.phase).toBe('integaglpi_v9_logmein_operations_001');
    expect(dashboard.deliverable).toBe('F2B_1');
  });

  it('alarm_stats reflete regras do repositório', async () => {
    const repo = makeMockAlarmRepo();
    const svc = new LogmeinOperationsDashboardService(repo as never);
    const dashboard = await svc.buildDashboard(makeEmptyHealthSummary());
    expect(dashboard.alarm_stats.totalRules).toBe(2);
    expect(dashboard.alarm_stats.enabledRules).toBe(1);
    expect(dashboard.alarm_stats.byType['host_offline']).toBe(1);
  });

  it('coverage_summary espelha health summary', async () => {
    const repo = makeMockAlarmRepo();
    const svc = new LogmeinOperationsDashboardService(repo as never);
    const health = makeEmptyHealthSummary();
    const dashboard = await svc.buildDashboard(health);
    expect(dashboard.coverage_summary.hostsWithoutTag).toBe(health.hostsWithoutTag);
    expect(dashboard.coverage_summary.groupsWithoutEntity).toBe(health.groupsWithoutEntity);
  });

  it('dashboard NÃO contém PII', async () => {
    const repo = makeMockAlarmRepo();
    const svc = new LogmeinOperationsDashboardService(repo as never);
    const dashboard = await svc.buildDashboard(makeEmptyHealthSummary());
    const json = JSON.stringify(dashboard);
    expect(json).not.toContain('phone');
    expect(json).not.toContain('token');
    expect(json).not.toContain('password');
    expect(json).not.toContain('credential');
  });

  it('readonly_note presente e informativo', async () => {
    const repo = makeMockAlarmRepo();
    const svc = new LogmeinOperationsDashboardService(repo as never);
    const dashboard = await svc.buildDashboard(makeEmptyHealthSummary());
    expect(dashboard.readonly_note.length).toBeGreaterThan(10);
  });
});

// ── F2B_5: LogmeinCoverageReportService ──────────────────────────────────────

describe('LogmeinCoverageReportService — F2B_5', () => {
  function makeMockReadonlyRepo() {
    const emptyPage = { entries: [], total: 0, limit: 100, offset: 0 };
    return {
      listHostsWithoutEntity: vi.fn().mockResolvedValue(emptyPage),
      listGroupsWithoutEntity: vi.fn().mockResolvedValue(emptyPage),
      listHostsWithoutTag: vi.fn().mockResolvedValue(emptyPage),
      // Other methods not needed for coverage service
      isSchemaReady: vi.fn().mockResolvedValue(true),
      getHealthSummary: vi.fn(),
      upsertHosts: vi.fn(),
      insertSyncAudit: vi.fn(),
      listHostsByGroup: vi.fn(),
      findHostByEquipmentTag: vi.fn(),
    };
  }

  it('buildReport retorna três seções', async () => {
    const repo = makeMockReadonlyRepo();
    const svc = new LogmeinCoverageReportService(repo as never);
    const report = await svc.buildReport();
    expect(report).toHaveProperty('hostsWithoutEntity');
    expect(report).toHaveProperty('groupsWithoutEntity');
    expect(report).toHaveProperty('hostsWithoutTag');
  });

  it('buildReport tem schema_version, phase, deliverable', async () => {
    const repo = makeMockReadonlyRepo();
    const svc = new LogmeinCoverageReportService(repo as never);
    const report = await svc.buildReport();
    expect(report.schema_version).toBe('1.0');
    expect(report.phase).toBe('integaglpi_v9_logmein_operations_001');
    expect(report.deliverable).toBe('F2B_5');
  });

  it('chama os três métodos do repositório', async () => {
    const repo = makeMockReadonlyRepo();
    const svc = new LogmeinCoverageReportService(repo as never);
    await svc.buildReport();
    expect(repo.listHostsWithoutEntity).toHaveBeenCalledOnce();
    expect(repo.listGroupsWithoutEntity).toHaveBeenCalledOnce();
    expect(repo.listHostsWithoutTag).toHaveBeenCalledOnce();
  });

  it('readonly_note presente', async () => {
    const repo = makeMockReadonlyRepo();
    const svc = new LogmeinCoverageReportService(repo as never);
    const report = await svc.buildReport();
    expect(report.readonly_note.length).toBeGreaterThan(10);
  });

  it('limit capado em 500', async () => {
    const repo = makeMockReadonlyRepo();
    const svc = new LogmeinCoverageReportService(repo as never);
    await svc.listHostsWithoutEntity(9999, 0);
    expect(repo.listHostsWithoutEntity).toHaveBeenCalledWith(500, 0);
  });

  it('offset mínimo 0', async () => {
    const repo = makeMockReadonlyRepo();
    const svc = new LogmeinCoverageReportService(repo as never);
    await svc.listGroupsWithoutEntity(10, -5);
    expect(repo.listGroupsWithoutEntity).toHaveBeenCalledWith(10, 0);
  });

  it('entries não contém PII (MAC, IP, telefone, senha)', async () => {
    const repo = makeMockReadonlyRepo();
    (repo.listHostsWithoutEntity as ReturnType<typeof vi.fn>).mockResolvedValue({
      entries: [{
        externalId: 'host-001',
        hostName: 'DESKTOP-TEST',
        groupExternalId: 'grp-001',
        groupName: 'Grupo A',
        equipmentTag: null,
        lastSeenAt: null,
      }],
      total: 1,
      limit: 100,
      offset: 0,
    });
    const svc = new LogmeinCoverageReportService(repo as never);
    const report = await svc.buildReport();
    const json = JSON.stringify(report);
    expect(json).not.toMatch(/mac_address|ip_address|phone|password|token/i);
  });
});

// ── Cross-cutting: invariantes globais F2B ────────────────────────────────────

describe('F2B — invariantes globais', () => {
  it('LowDiskCheckService NÃO possui método sendWhatsApp', () => {
    const svc = new LogmeinLowDiskCheckService();
    expect(typeof (svc as unknown as Record<string, unknown>)['sendWhatsApp']).toBe('undefined');
  });

  it('LowDiskCheckService NÃO possui método createTicket', () => {
    const svc = new LogmeinLowDiskCheckService();
    expect(typeof (svc as unknown as Record<string, unknown>)['createTicket']).toBe('undefined');
  });

  it('RuleTestService NÃO possui método sendWhatsApp', () => {
    const svc = new LogmeinRuleTestService();
    expect(typeof (svc as unknown as Record<string, unknown>)['sendWhatsApp']).toBe('undefined');
  });

  it('RuleTestService NÃO possui método createTicket', () => {
    const svc = new LogmeinRuleTestService();
    expect(typeof (svc as unknown as Record<string, unknown>)['createTicket']).toBe('undefined');
  });

  it('CoverageReportService NÃO possui método insert ou update', () => {
    const mockRepo = {
      listHostsWithoutEntity: vi.fn(),
      listGroupsWithoutEntity: vi.fn(),
      listHostsWithoutTag: vi.fn(),
    };
    const svc = new LogmeinCoverageReportService(mockRepo as never);
    const svcKeys = Object.getOwnPropertyNames(Object.getPrototypeOf(svc));
    expect(svcKeys.some((k) => k.toLowerCase().includes('insert'))).toBe(false);
    expect(svcKeys.some((k) => k.toLowerCase().includes('update'))).toBe(false);
    expect(svcKeys.some((k) => k.toLowerCase().includes('delete'))).toBe(false);
    expect(svcKeys.some((k) => k.toLowerCase().includes('mutate'))).toBe(false);
  });
});
