/**
 * Testes estáticos e de unidade — integaglpi_logmein_alarm_rules_and_auto_ticket_implementation_001
 *
 *  1. LOGMEIN_ALARM_ENGINE_ENABLED=false → engineDisabled=true sem processar nada
 *  2. LOGMEIN_AUTO_TICKET_ENABLED=false → GLPI createTicket NÃO chamado
 *  3. host_offline: status=offline → alarme dispara (condição atendida)
 *  4. host_offline: status=online  → alarme NÃO dispara
 *  5. host_not_seen: lastSeenAt > not_seen_days → alarme dispara
 *  6. host_not_seen: lastSeenAt recente → alarme NÃO dispara
 *  7. cooldown ativo (Redis GET ≠ null) → cooldownSkipped++, sem ticket
 *  8. cooldown inativo → alarme dispara, Redis SET EX chamado com TTL correto
 *  9. dedupe: event_hash já existe (INSERT retorna inserted=false) → dedupeSkipped++
 * 10. dedupe: event_hash novo (INSERT retorna inserted=true) → fired++
 * 11. createRule: glpiEntitiesId=0 → erro de validação, sem INSERT
 * 12. createRule: glpiEntitiesId negativo → erro de validação
 * 13. createRule: cooldownMinutes=0 → erro de validação
 * 14. createRule: host_not_seen_days < 7 → erro de validação
 * 15. env: LOGMEIN_AUTO_TICKET_ENABLED=false e LOGMEIN_ALARM_ENGINE_ENABLED=false por padrão
 * 16. Worker não importa serviço de webhook WhatsApp (static check)
 * 17. Worker não chama sendMessage/WhatsApp (static check)
 * 18. Engine não acessa banco GLPI diretamente (static check)
 * 19. buildEventHash: hashes distintos para datas diferentes
 * 20. buildEventHash: hash estável (determinístico)
 * 21. Ticket criado com gate duplo (global flag + rule flag + entity + category + queue)
 * 22. Sem snapshot: hardware_change create_ticket=true blocked in validation
 * 23. Tipo suportado missing_equipment_tag pode criar ticket com duplo gate
 * 24. Forbidden type: validation blocks high_cpu
 * 25. create_ticket=true sem category → erro de validação
 * 26. create_ticket=true sem queue → erro de validação
 * 27. cooldown mín. 60 min para host_offline com create_ticket=true
 * 28. host_offline consecutiveWaiting++ quando threshold não atingido
 * 29. host_offline dispara após atingir threshold consecutivo
 * 31. Redis error no cooldown check → alarm suprimido (fail-safe), sem ticket
 * 32. Redis error nos consecutive checks → thresholdReached=false, sem ticket
 * 33. Worker continua sem lançar exceção quando Redis falha em ambas as etapas
 *
 * PHASE: integaglpi_logmein_alarm_rules_and_auto_ticket_implementation_001
 * PHASE: integaglpi_logmein_alarm_rules_redis_fail_safe_fix_001
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

// ── Helpers ───────────────────────────────────────────────────────────────────

type AlarmType = 'host_offline' | 'host_not_seen' | 'missing_equipment_tag' | 'missing_entity_mapping' | 'hardware_change' | 'low_disk' | 'low_memory';

interface MockRule {
  id: string;
  ruleName: string;
  alarmType: AlarmType;
  enabled: boolean;
  cooldownMinutes: number;
  conditionPayload: Record<string, unknown>;
  glpiEntitiesId: number;
  glpiGroupId: number | null;
  glpiItilCategoryId: number | null;
  createTicket: boolean;
  minConsecutiveChecks: number;
  consecutiveCheckIntervalMinutes: number;
  createdAt: Date;
  updatedAt: Date;
}

interface MockTarget {
  id: string;
  ruleId: string;
  hostId: string;
  hostname: string;
  createdAt: Date;
}

interface MockHost {
  externalId: string;
  groupExternalId: string;
  groupName: string;
  hostName: string;
  equipmentTag: string;
  status: 'online' | 'offline' | 'unknown';
  lastSeenAt: string | null;
}

function makeRule(overrides: Partial<MockRule> = {}): MockRule {
  return {
    id: 'rule-uuid-001',
    ruleName: 'Teste Offline',
    alarmType: 'host_offline',
    enabled: true,
    cooldownMinutes: 60,
    conditionPayload: {},
    glpiEntitiesId: 5,
    glpiGroupId: 10,
    glpiItilCategoryId: 20,
    createTicket: false,
    minConsecutiveChecks: 1,
    consecutiveCheckIntervalMinutes: 5,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeTarget(overrides: Partial<MockTarget> = {}): MockTarget {
  return {
    id: 'target-uuid-001',
    ruleId: 'rule-uuid-001',
    hostId: 'host-abc123',
    hostname: 'PC-ESCRITORIO',
    createdAt: new Date(),
    ...overrides,
  };
}

function makeHost(overrides: Partial<MockHost> = {}): MockHost {
  return {
    externalId: 'host-abc123',
    groupExternalId: 'grp-001',
    groupName: 'Grupo Teste',
    hostName: 'PC-ESCRITORIO',
    equipmentTag: 'TAG001',
    status: 'offline',
    lastSeenAt: null,
    ...overrides,
  };
}

function makeRepository(overrides: Record<string, unknown> = {}) {
  return {
    listEnabledRules: vi.fn().mockResolvedValue([]),
    listTargetsForRule: vi.fn().mockResolvedValue([]),
    getHostsCurrentStatus: vi.fn().mockResolvedValue(new Map()),
    insertEventIfNew: vi.fn().mockResolvedValue({ inserted: true }),
    getRuleById: vi.fn().mockResolvedValue(null),
    createRule: vi.fn(),
    updateRule: vi.fn(),
    deleteRule: vi.fn(),
    addTarget: vi.fn(),
    removeTarget: vi.fn(),
    listAllRules: vi.fn().mockResolvedValue([]),
    listRecentEvents: vi.fn().mockResolvedValue([]),
    isSchemaReady: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

function makeRedis(overrides: Record<string, unknown> = {}) {
  return {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
    ...overrides,
  };
}

function makeGlpiClient() {
  return {
    createTicket: vi.fn().mockResolvedValue(9001),
  };
}

async function withAlarmFlags(
  engineEnabled: boolean,
  autoTicketEnabled: boolean,
  fn: () => Promise<void>,
): Promise<void> {
  const { env } = await import('../src/config/env.js');
  const origEngine = (env as Record<string, unknown>)['LOGMEIN_ALARM_ENGINE_ENABLED'];
  const origTicket = (env as Record<string, unknown>)['LOGMEIN_AUTO_TICKET_ENABLED'];
  (env as Record<string, unknown>)['LOGMEIN_ALARM_ENGINE_ENABLED'] = engineEnabled;
  (env as Record<string, unknown>)['LOGMEIN_AUTO_TICKET_ENABLED'] = autoTicketEnabled;
  try {
    await fn();
  } finally {
    (env as Record<string, unknown>)['LOGMEIN_ALARM_ENGINE_ENABLED'] = origEngine;
    (env as Record<string, unknown>)['LOGMEIN_AUTO_TICKET_ENABLED'] = origTicket;
  }
}

// ── Tests: LogmeinAlarmEngineService ─────────────────────────────────────────

describe('LogmeinAlarmEngineService — guards e avaliação de condições', () => {

  it('1. LOGMEIN_ALARM_ENGINE_ENABLED=false → engineDisabled=true sem processar', async () => {
    const { LogmeinAlarmEngineService } = await import('../src/domain/services/LogmeinAlarmEngineService.js');
    const repo = makeRepository();
    const redis = makeRedis();

    await withAlarmFlags(false, false, async () => {
      const engine = new LogmeinAlarmEngineService(repo as never, redis, null);
      const result = await engine.runOnce();
      expect(result.engineDisabled).toBe(true);
      expect(result.processed).toBe(0);
      expect(repo.listEnabledRules).not.toHaveBeenCalled();
    });
  });

  it('2. LOGMEIN_AUTO_TICKET_ENABLED=false → createTicket NÃO chamado mesmo com create_ticket=true', async () => {
    const { LogmeinAlarmEngineService } = await import('../src/domain/services/LogmeinAlarmEngineService.js');
    const rule = makeRule({ createTicket: true, glpiEntitiesId: 5, glpiGroupId: 10, glpiItilCategoryId: 20 });
    const target = makeTarget();
    const host = makeHost({ status: 'offline' });
    const hostMap = new Map([[target.hostId, host]]);
    const repo = makeRepository({
      listEnabledRules: vi.fn().mockResolvedValue([rule]),
      listTargetsForRule: vi.fn().mockResolvedValue([target]),
      getHostsCurrentStatus: vi.fn().mockResolvedValue(hostMap),
      insertEventIfNew: vi.fn().mockResolvedValue({ inserted: true }),
    });
    const glpiClient = makeGlpiClient();

    await withAlarmFlags(true, false, async () => {
      const engine = new LogmeinAlarmEngineService(repo as never, makeRedis(), glpiClient as never);
      const result = await engine.runOnce();
      expect(result.ticketsCreated).toBe(0);
      expect(glpiClient.createTicket).not.toHaveBeenCalled();
      expect(result.fired).toBe(1);
    });
  });

  it('3. host_offline: status=offline → condição atendida → alarme dispara', async () => {
    const { LogmeinAlarmEngineService } = await import('../src/domain/services/LogmeinAlarmEngineService.js');
    const rule = makeRule({ alarmType: 'host_offline' });
    const target = makeTarget();
    const host = makeHost({ status: 'offline' });
    const hostMap = new Map([[target.hostId, host]]);
    const repo = makeRepository({
      listEnabledRules: vi.fn().mockResolvedValue([rule]),
      listTargetsForRule: vi.fn().mockResolvedValue([target]),
      getHostsCurrentStatus: vi.fn().mockResolvedValue(hostMap),
      insertEventIfNew: vi.fn().mockResolvedValue({ inserted: true }),
    });

    await withAlarmFlags(true, false, async () => {
      const engine = new LogmeinAlarmEngineService(repo as never, makeRedis(), null);
      const result = await engine.runOnce();
      expect(result.fired).toBe(1);
      expect(result.processed).toBe(1);
    });
  });

  it('4. host_offline: status=online → condição NÃO atendida → alarme não dispara', async () => {
    const { LogmeinAlarmEngineService } = await import('../src/domain/services/LogmeinAlarmEngineService.js');
    const rule = makeRule({ alarmType: 'host_offline' });
    const target = makeTarget();
    const host = makeHost({ status: 'online' });
    const hostMap = new Map([[target.hostId, host]]);
    const repo = makeRepository({
      listEnabledRules: vi.fn().mockResolvedValue([rule]),
      listTargetsForRule: vi.fn().mockResolvedValue([target]),
      getHostsCurrentStatus: vi.fn().mockResolvedValue(hostMap),
    });

    await withAlarmFlags(true, false, async () => {
      const engine = new LogmeinAlarmEngineService(repo as never, makeRedis(), null);
      const result = await engine.runOnce();
      expect(result.fired).toBe(0);
      expect(repo.insertEventIfNew).not.toHaveBeenCalled();
    });
  });

  it('5. host_not_seen: lastSeenAt > not_seen_days → alarme dispara', async () => {
    const { LogmeinAlarmEngineService } = await import('../src/domain/services/LogmeinAlarmEngineService.js');
    const rule = makeRule({
      alarmType: 'host_not_seen',
      conditionPayload: { not_seen_days: 7 },
    });
    const target = makeTarget();
    // 10 days ago
    const oldDate = new Date(Date.now() - 10 * 86_400_000).toISOString();
    const host = makeHost({ status: 'unknown', lastSeenAt: oldDate });
    const hostMap = new Map([[target.hostId, host]]);
    const repo = makeRepository({
      listEnabledRules: vi.fn().mockResolvedValue([rule]),
      listTargetsForRule: vi.fn().mockResolvedValue([target]),
      getHostsCurrentStatus: vi.fn().mockResolvedValue(hostMap),
      insertEventIfNew: vi.fn().mockResolvedValue({ inserted: true }),
    });

    await withAlarmFlags(true, false, async () => {
      const engine = new LogmeinAlarmEngineService(repo as never, makeRedis(), null);
      const result = await engine.runOnce();
      expect(result.fired).toBe(1);
    });
  });

  it('6. host_not_seen: lastSeenAt recente → alarme NÃO dispara', async () => {
    const { LogmeinAlarmEngineService } = await import('../src/domain/services/LogmeinAlarmEngineService.js');
    const rule = makeRule({
      alarmType: 'host_not_seen',
      conditionPayload: { not_seen_days: 7 },
    });
    const target = makeTarget();
    // 1 day ago — not yet past threshold
    const recentDate = new Date(Date.now() - 1 * 86_400_000).toISOString();
    const host = makeHost({ status: 'unknown', lastSeenAt: recentDate });
    const hostMap = new Map([[target.hostId, host]]);
    const repo = makeRepository({
      listEnabledRules: vi.fn().mockResolvedValue([rule]),
      listTargetsForRule: vi.fn().mockResolvedValue([target]),
      getHostsCurrentStatus: vi.fn().mockResolvedValue(hostMap),
    });

    await withAlarmFlags(true, false, async () => {
      const engine = new LogmeinAlarmEngineService(repo as never, makeRedis(), null);
      const result = await engine.runOnce();
      expect(result.fired).toBe(0);
      expect(repo.insertEventIfNew).not.toHaveBeenCalled();
    });
  });

  it('7. cooldown ativo → alarme suprimido, cooldownSkipped++', async () => {
    const { LogmeinAlarmEngineService } = await import('../src/domain/services/LogmeinAlarmEngineService.js');
    const rule = makeRule({ alarmType: 'host_offline' });
    const target = makeTarget();
    const host = makeHost({ status: 'offline' });
    const hostMap = new Map([[target.hostId, host]]);
    const repo = makeRepository({
      listEnabledRules: vi.fn().mockResolvedValue([rule]),
      listTargetsForRule: vi.fn().mockResolvedValue([target]),
      getHostsCurrentStatus: vi.fn().mockResolvedValue(hostMap),
    });
    // Redis returns cooldown=active AND consecutive already at threshold
    // Get is called twice: once for consecutive, once for cooldown
    let callCount = 0;
    const redis = makeRedis({
      get: vi.fn().mockImplementation(() => {
        callCount++;
        // First call: consecutive key → return "1:0" (old enough, count=1 threshold=1)
        // Second call: cooldown key → return '1' (active)
        return callCount === 1 ? '1:0' : '1';
      }),
    });

    await withAlarmFlags(true, false, async () => {
      const engine = new LogmeinAlarmEngineService(repo as never, redis, null);
      const result = await engine.runOnce();
      expect(result.cooldownSkipped).toBe(1);
      expect(result.fired).toBe(0);
      expect(repo.insertEventIfNew).not.toHaveBeenCalled();
    });
  });

  it('8. cooldown inativo → alarme dispara, Redis SET EX chamado com TTL correto', async () => {
    const { LogmeinAlarmEngineService } = await import('../src/domain/services/LogmeinAlarmEngineService.js');
    const rule = makeRule({ alarmType: 'host_offline', cooldownMinutes: 60 });
    const target = makeTarget();
    const host = makeHost({ status: 'offline' });
    const hostMap = new Map([[target.hostId, host]]);
    const repo = makeRepository({
      listEnabledRules: vi.fn().mockResolvedValue([rule]),
      listTargetsForRule: vi.fn().mockResolvedValue([target]),
      getHostsCurrentStatus: vi.fn().mockResolvedValue(hostMap),
      insertEventIfNew: vi.fn().mockResolvedValue({ inserted: true }),
    });
    const redisSpy = makeRedis({
      // First get: consecutive key (return old count to reach threshold)
      // Second get: cooldown key (return null = no cooldown)
      get: vi.fn().mockResolvedValueOnce('1:0').mockResolvedValue(null),
    });

    await withAlarmFlags(true, false, async () => {
      const engine = new LogmeinAlarmEngineService(repo as never, redisSpy, null);
      const result = await engine.runOnce();
      expect(result.fired).toBe(1);
      // Cooldown SET with 60 * 60 = 3600 seconds
      expect(redisSpy.set).toHaveBeenCalledWith(
        `logmein:alarm:cooldown:${rule.id}:${target.hostId}`,
        '1',
        'EX',
        60 * 60,
      );
    });
  });

  it('9. dedupe: inserted=false → dedupeSkipped++, fired=0', async () => {
    const { LogmeinAlarmEngineService } = await import('../src/domain/services/LogmeinAlarmEngineService.js');
    const rule = makeRule({ alarmType: 'host_offline' });
    const target = makeTarget();
    const host = makeHost({ status: 'offline' });
    const hostMap = new Map([[target.hostId, host]]);
    const repo = makeRepository({
      listEnabledRules: vi.fn().mockResolvedValue([rule]),
      listTargetsForRule: vi.fn().mockResolvedValue([target]),
      getHostsCurrentStatus: vi.fn().mockResolvedValue(hostMap),
      insertEventIfNew: vi.fn().mockResolvedValue({ inserted: false }),
    });
    const redis = makeRedis({
      get: vi.fn().mockResolvedValueOnce('1:0').mockResolvedValue(null),
    });

    await withAlarmFlags(true, false, async () => {
      const engine = new LogmeinAlarmEngineService(repo as never, redis, null);
      const result = await engine.runOnce();
      expect(result.dedupeSkipped).toBe(1);
      expect(result.fired).toBe(0);
    });
  });

  it('10. dedupe: inserted=true → fired++, nenhum dedupeSkipped', async () => {
    const { LogmeinAlarmEngineService } = await import('../src/domain/services/LogmeinAlarmEngineService.js');
    const rule = makeRule({ alarmType: 'host_offline' });
    const target = makeTarget();
    const host = makeHost({ status: 'offline' });
    const hostMap = new Map([[target.hostId, host]]);
    const repo = makeRepository({
      listEnabledRules: vi.fn().mockResolvedValue([rule]),
      listTargetsForRule: vi.fn().mockResolvedValue([target]),
      getHostsCurrentStatus: vi.fn().mockResolvedValue(hostMap),
      insertEventIfNew: vi.fn().mockResolvedValue({ inserted: true }),
    });
    const redis = makeRedis({
      get: vi.fn().mockResolvedValueOnce('1:0').mockResolvedValue(null),
    });

    await withAlarmFlags(true, false, async () => {
      const engine = new LogmeinAlarmEngineService(repo as never, redis, null);
      const result = await engine.runOnce();
      expect(result.fired).toBe(1);
      expect(result.dedupeSkipped).toBe(0);
    });
  });

});

// ── Tests: LogmeinAlarmRulesService validation ────────────────────────────────

describe('LogmeinAlarmRulesService — validação de createRule', () => {

  it('11. glpiEntitiesId=0 → erro de validação, sem INSERT', async () => {
    const { LogmeinAlarmRulesService } = await import('../src/domain/services/LogmeinAlarmRulesService.js');
    const repo = makeRepository({ createRule: vi.fn() });
    const svc = new LogmeinAlarmRulesService(repo as never);
    const result = await svc.createRule({
      ruleName: 'Inválida', alarmType: 'host_offline', cooldownMinutes: 60,
      conditionPayload: {}, glpiEntitiesId: 0, glpiGroupId: null, glpiItilCategoryId: null, createTicket: false,
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.field === 'glpiEntitiesId')).toBe(true);
    expect(repo.createRule).not.toHaveBeenCalled();
  });

  it('12. glpiEntitiesId negativo → erro de validação', async () => {
    const { LogmeinAlarmRulesService } = await import('../src/domain/services/LogmeinAlarmRulesService.js');
    const repo = makeRepository({ createRule: vi.fn() });
    const svc = new LogmeinAlarmRulesService(repo as never);
    const result = await svc.createRule({
      ruleName: 'Neg', alarmType: 'host_offline', cooldownMinutes: 60,
      conditionPayload: {}, glpiEntitiesId: -1, glpiGroupId: null, glpiItilCategoryId: null, createTicket: false,
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.field === 'glpiEntitiesId')).toBe(true);
  });

  it('13. cooldownMinutes=0 → erro de validação', async () => {
    const { LogmeinAlarmRulesService } = await import('../src/domain/services/LogmeinAlarmRulesService.js');
    const repo = makeRepository({ createRule: vi.fn() });
    const svc = new LogmeinAlarmRulesService(repo as never);
    const result = await svc.createRule({
      ruleName: 'Zero Cool', alarmType: 'host_offline', cooldownMinutes: 0,
      conditionPayload: {}, glpiEntitiesId: 5, glpiGroupId: null, glpiItilCategoryId: null, createTicket: false,
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.field === 'cooldownMinutes')).toBe(true);
  });

  it('14. host_not_seen: not_seen_days < 7 → erro de validação', async () => {
    const { LogmeinAlarmRulesService } = await import('../src/domain/services/LogmeinAlarmRulesService.js');
    const repo = makeRepository({ createRule: vi.fn() });
    const svc = new LogmeinAlarmRulesService(repo as never);
    const result = await svc.createRule({
      ruleName: 'Not Seen Short', alarmType: 'host_not_seen', cooldownMinutes: 60,
      conditionPayload: { not_seen_days: 3 }, // below minimum 7
      glpiEntitiesId: 5, glpiGroupId: null, glpiItilCategoryId: null, createTicket: false,
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.field.includes('not_seen_days'))).toBe(true);
  });

  it('22. sem snapshot: hardware_change create_ticket=true → erro de validação', async () => {
    const { LogmeinAlarmRulesService } = await import('../src/domain/services/LogmeinAlarmRulesService.js');
    const repo = makeRepository({ createRule: vi.fn() });
    const svc = new LogmeinAlarmRulesService(repo as never);
    const result = await svc.createRule({
      ruleName: 'Snapshot With Ticket', alarmType: 'hardware_change', cooldownMinutes: 60,
      conditionPayload: {}, glpiEntitiesId: 5, glpiGroupId: 10, glpiItilCategoryId: 20, createTicket: true,
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.field === 'createTicket')).toBe(true);
  });

  it('24. forbidden type: high_cpu → blocked by validation', async () => {
    const { LogmeinAlarmRulesService } = await import('../src/domain/services/LogmeinAlarmRulesService.js');
    const repo = makeRepository({ createRule: vi.fn() });
    const svc = new LogmeinAlarmRulesService(repo as never);
    const result = await svc.createRule({
      ruleName: 'High CPU', alarmType: 'high_cpu' as never, cooldownMinutes: 30,
      conditionPayload: {}, glpiEntitiesId: 5, glpiGroupId: null, glpiItilCategoryId: null, createTicket: false,
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.field === 'alarmType')).toBe(true);
    expect(repo.createRule).not.toHaveBeenCalled();
  });

  it('25. create_ticket=true sem category → erro de validação', async () => {
    const { LogmeinAlarmRulesService } = await import('../src/domain/services/LogmeinAlarmRulesService.js');
    const repo = makeRepository({ createRule: vi.fn() });
    const svc = new LogmeinAlarmRulesService(repo as never);
    const result = await svc.createRule({
      ruleName: 'No Category', alarmType: 'host_offline', cooldownMinutes: 60,
      conditionPayload: {}, glpiEntitiesId: 5, glpiGroupId: 10,
      glpiItilCategoryId: null, // missing category
      createTicket: true,
      minConsecutiveChecks: 2,
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.field === 'glpiItilCategoryId')).toBe(true);
  });

  it('26. create_ticket=true sem queue/grupo → erro de validação', async () => {
    const { LogmeinAlarmRulesService } = await import('../src/domain/services/LogmeinAlarmRulesService.js');
    const repo = makeRepository({ createRule: vi.fn() });
    const svc = new LogmeinAlarmRulesService(repo as never);
    const result = await svc.createRule({
      ruleName: 'No Queue', alarmType: 'host_offline', cooldownMinutes: 60,
      conditionPayload: {}, glpiEntitiesId: 5,
      glpiGroupId: null, // missing queue
      glpiItilCategoryId: 20, createTicket: true,
      minConsecutiveChecks: 2,
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.field === 'glpiGroupId')).toBe(true);
  });

  it('27. host_offline com create_ticket=true: cooldown < 60 min → erro', async () => {
    const { LogmeinAlarmRulesService } = await import('../src/domain/services/LogmeinAlarmRulesService.js');
    const repo = makeRepository({ createRule: vi.fn() });
    const svc = new LogmeinAlarmRulesService(repo as never);
    const result = await svc.createRule({
      ruleName: 'Short Cooldown', alarmType: 'host_offline',
      cooldownMinutes: 30, // below 60 minimum for auto-ticket
      conditionPayload: {}, glpiEntitiesId: 5, glpiGroupId: 10, glpiItilCategoryId: 20,
      createTicket: true, minConsecutiveChecks: 2,
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.field === 'cooldownMinutes')).toBe(true);
  });

  it('30. host_not_seen: mínimo 7 dias → válido com not_seen_days=7', async () => {
    const { LogmeinAlarmRulesService } = await import('../src/domain/services/LogmeinAlarmRulesService.js');
    const mockRule = { id: 'rule-1', ruleName: 'OK', alarmType: 'host_not_seen' as const };
    const repo = makeRepository({ createRule: vi.fn().mockResolvedValue(mockRule) });
    const svc = new LogmeinAlarmRulesService(repo as never);
    const result = await svc.createRule({
      ruleName: 'Not Seen 7', alarmType: 'host_not_seen', cooldownMinutes: 60,
      conditionPayload: { not_seen_days: 7 },
      glpiEntitiesId: 5, glpiGroupId: null, glpiItilCategoryId: null, createTicket: false,
    });
    // With not_seen_days=7 and no create_ticket=true, should be valid
    expect(result.errors.some((e) => e.field.includes('not_seen_days'))).toBe(false);
  });

});

// ── Tests: env defaults ───────────────────────────────────────────────────────

describe('env defaults — feature flags off por padrão', () => {

  it('15. env.ts tem LOGMEIN_AUTO_TICKET_ENABLED e LOGMEIN_ALARM_ENGINE_ENABLED com default false', () => {
    const source = readFileSync(path.resolve(__dirname, '../src/config/env.ts'), 'utf-8');
    expect(source).toContain('LOGMEIN_ALARM_ENGINE_ENABLED');
    expect(source).toContain('LOGMEIN_AUTO_TICKET_ENABLED');
    const alarmBlock = /LOGMEIN_ALARM_ENGINE_ENABLED[\s\S]{0,200}\.default\('false'\)/.exec(source);
    const ticketBlock = /LOGMEIN_AUTO_TICKET_ENABLED[\s\S]{0,200}\.default\('false'\)/.exec(source);
    expect(alarmBlock).not.toBeNull();
    expect(ticketBlock).not.toBeNull();
  });

});

// ── Tests: static safety checks ──────────────────────────────────────────────

describe('safety — static file checks', () => {

  it('16. logmeinAlarmWorker.ts não importa serviço de webhook WhatsApp', () => {
    const source = readFileSync(path.resolve(__dirname, '../src/jobs/logmeinAlarmWorker.ts'), 'utf-8');
    // The static string "InboundWebhookService" must not appear in the source
    expect(source).not.toContain('InboundWebhookService');
  });

  it('17. logmeinAlarmWorker.ts não chama sendMessage / WhatsApp', () => {
    const source = readFileSync(path.resolve(__dirname, '../src/jobs/logmeinAlarmWorker.ts'), 'utf-8');
    expect(source).not.toMatch(/sendMessage|sendWhatsApp|metaClient|MetaClient/i);
  });

  it('18. LogmeinAlarmEngineService não acessa banco do GLPI diretamente', () => {
    const source = readFileSync(path.resolve(__dirname, '../src/domain/services/LogmeinAlarmEngineService.ts'), 'utf-8');
    expect(source).not.toMatch(/mariadb|mysql|knex|typeorm/i);
  });

  it('16b. LogmeinAlarmEngineService não cria serviço de webhook WhatsApp', () => {
    const source = readFileSync(path.resolve(__dirname, '../src/domain/services/LogmeinAlarmEngineService.ts'), 'utf-8');
    expect(source).not.toContain('InboundWebhookService');
  });

});

// ── Tests: event_hash ─────────────────────────────────────────────────────────

describe('event_hash — dedupe por dia', () => {

  function buildEventHash(ruleId: string, hostId: string, alarmType: string, dateUtc: string): string {
    return createHash('sha256').update(`${ruleId}|${hostId}|${alarmType}|${dateUtc}`).digest('hex');
  }

  it('19. hashes distintos para datas diferentes', () => {
    const h1 = buildEventHash('rule-1', 'host-1', 'host_offline', '2026-06-07');
    const h2 = buildEventHash('rule-1', 'host-1', 'host_offline', '2026-06-08');
    expect(h1).not.toBe(h2);
  });

  it('20. hash estável para mesmos inputs (determinístico)', () => {
    const h1 = buildEventHash('rule-1', 'host-1', 'host_offline', '2026-06-07');
    const h2 = buildEventHash('rule-1', 'host-1', 'host_offline', '2026-06-07');
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(64);
  });

});

// ── Tests: ticket creation guard ─────────────────────────────────────────────

describe('ticket creation — gate duplo + category + queue guard', () => {

  it('21. ticket criado com gate duplo + entity + category + queue', async () => {
    const { LogmeinAlarmEngineService } = await import('../src/domain/services/LogmeinAlarmEngineService.js');
    const rule = makeRule({
      alarmType: 'host_offline', createTicket: true,
      glpiEntitiesId: 7, glpiGroupId: 10, glpiItilCategoryId: 20,
    });
    const target = makeTarget();
    const host = makeHost({ status: 'offline' });
    const hostMap = new Map([[target.hostId, host]]);
    const repo = makeRepository({
      listEnabledRules: vi.fn().mockResolvedValue([rule]),
      listTargetsForRule: vi.fn().mockResolvedValue([target]),
      getHostsCurrentStatus: vi.fn().mockResolvedValue(hostMap),
      insertEventIfNew: vi.fn().mockResolvedValue({ inserted: true }),
    });
    const glpiClient = makeGlpiClient();
    const redis = makeRedis({
      get: vi.fn().mockResolvedValueOnce('1:0').mockResolvedValue(null),
    });

    await withAlarmFlags(true, true, async () => {
      const engine = new LogmeinAlarmEngineService(repo as never, redis, glpiClient as never);
      const result = await engine.runOnce();
      expect(result.ticketsCreated).toBe(1);
      expect(glpiClient.createTicket).toHaveBeenCalledWith(expect.objectContaining({
        title: `[LogMeIn] host_offline - ${host.hostName}`,
        entitiesId: 7,
      }));
    });
  });

  it('23. tipo suportado por cache pode criar ticket com duplo gate', async () => {
    const { LogmeinAlarmEngineService } = await import('../src/domain/services/LogmeinAlarmEngineService.js');
    const rule = makeRule({
      alarmType: 'missing_equipment_tag',
      createTicket: true,
      glpiEntitiesId: 5,
      glpiGroupId: 10,
      glpiItilCategoryId: 20,
    });
    const target = makeTarget();
    // missing_equipment_tag condition: equipmentTag empty
    const host = makeHost({ status: 'online', equipmentTag: '' });
    const hostMap = new Map([[target.hostId, host]]);
    const repo = makeRepository({
      listEnabledRules: vi.fn().mockResolvedValue([rule]),
      listTargetsForRule: vi.fn().mockResolvedValue([target]),
      getHostsCurrentStatus: vi.fn().mockResolvedValue(hostMap),
      insertEventIfNew: vi.fn().mockResolvedValue({ inserted: true }),
    });
    const glpiClient = makeGlpiClient();

    await withAlarmFlags(true, true, async () => {
      const engine = new LogmeinAlarmEngineService(repo as never, makeRedis(), glpiClient as never);
      const result = await engine.runOnce();
      expect(result.ticketsCreated).toBe(1);
      expect(glpiClient.createTicket).toHaveBeenCalledWith(expect.objectContaining({
        entitiesId: 5,
      }));
    });
  });

});

// ── Tests: consecutive checks ─────────────────────────────────────────────────

describe('host_offline — consecutive check guard', () => {

  it('28. consecutiveWaiting++ quando threshold não atingido', async () => {
    const { LogmeinAlarmEngineService } = await import('../src/domain/services/LogmeinAlarmEngineService.js');
    const rule = makeRule({
      alarmType: 'host_offline',
      minConsecutiveChecks: 3,
      consecutiveCheckIntervalMinutes: 5,
    });
    const target = makeTarget();
    const host = makeHost({ status: 'offline' });
    const hostMap = new Map([[target.hostId, host]]);
    const repo = makeRepository({
      listEnabledRules: vi.fn().mockResolvedValue([rule]),
      listTargetsForRule: vi.fn().mockResolvedValue([target]),
      getHostsCurrentStatus: vi.fn().mockResolvedValue(hostMap),
    });
    // Redis: consecutive key null → count=0+1=1, threshold=3 → NOT reached
    const redis = makeRedis({ get: vi.fn().mockResolvedValue(null) });

    await withAlarmFlags(true, false, async () => {
      const engine = new LogmeinAlarmEngineService(repo as never, redis, null);
      const result = await engine.runOnce();
      expect(result.consecutiveWaiting).toBe(1);
      expect(result.fired).toBe(0);
      expect(repo.insertEventIfNew).not.toHaveBeenCalled();
    });
  });

  it('29. dispara após atingir threshold consecutivo', async () => {
    const { LogmeinAlarmEngineService } = await import('../src/domain/services/LogmeinAlarmEngineService.js');
    const rule = makeRule({
      alarmType: 'host_offline',
      minConsecutiveChecks: 2,
      consecutiveCheckIntervalMinutes: 5,
    });
    const target = makeTarget();
    const host = makeHost({ status: 'offline' });
    const hostMap = new Map([[target.hostId, host]]);
    const repo = makeRepository({
      listEnabledRules: vi.fn().mockResolvedValue([rule]),
      listTargetsForRule: vi.fn().mockResolvedValue([target]),
      getHostsCurrentStatus: vi.fn().mockResolvedValue(hostMap),
      insertEventIfNew: vi.fn().mockResolvedValue({ inserted: true }),
    });
    // Consecutive key: already at count=1, last check long ago → increment to 2 → threshold=2 reached
    // Cooldown key: null (no cooldown)
    const nowEpoch = Math.floor(Date.now() / 1000);
    const oldEpoch = nowEpoch - 6 * 60; // 6 minutes ago (> 5 min interval)
    const redis = makeRedis({
      get: vi.fn()
        .mockResolvedValueOnce(`1:${oldEpoch}`) // consecutive: count=1, old enough
        .mockResolvedValue(null),               // cooldown: inactive
    });

    await withAlarmFlags(true, false, async () => {
      const engine = new LogmeinAlarmEngineService(repo as never, redis, null);
      const result = await engine.runOnce();
      expect(result.fired).toBe(1);
      expect(result.consecutiveWaiting).toBe(0);
    });
  });

  // ── Redis fail-safe tests (PHASE: integaglpi_logmein_alarm_rules_redis_fail_safe_fix_001) ──

  it('31. Redis error no cooldown → alarme suprimido (fail-safe), sem ticket criado', async () => {
    const { LogmeinAlarmEngineService } = await import('../src/domain/services/LogmeinAlarmEngineService.js');
    const rule = makeRule({
      alarmType: 'host_offline',
      minConsecutiveChecks: 1,
      consecutiveCheckIntervalMinutes: 5,
      createTicket: true,
      glpiGroupId: 10,
      glpiItilCategoryId: 20,
    });
    const target = makeTarget();
    const host = makeHost({ status: 'offline' });
    const hostMap = new Map([[target.hostId, host]]);
    const glpiCreateTicket = vi.fn().mockResolvedValue(9999);
    const repo = makeRepository({
      listEnabledRules: vi.fn().mockResolvedValue([rule]),
      listTargetsForRule: vi.fn().mockResolvedValue([target]),
      getHostsCurrentStatus: vi.fn().mockResolvedValue(hostMap),
      insertEventIfNew: vi.fn().mockResolvedValue({ inserted: true }),
    });
    // Consecutive: threshold reached (count=1, interval long ago); then cooldown Redis throws.
    const redis = makeRedis({
      get: vi.fn()
        .mockResolvedValueOnce(`1:${Math.floor(Date.now() / 1000) - 9999}`) // consecutive: threshold reached
        .mockRejectedValue(new Error('Redis connection refused')),            // cooldown GET: fail-safe
      set: vi.fn().mockResolvedValue('OK'),
    });
    const glpiClient = { createTicket: glpiCreateTicket } as never;

    await withAlarmFlags(true, true, async () => {
      const engine = new LogmeinAlarmEngineService(repo as never, redis, glpiClient);
      const result = await engine.runOnce();
      // Fail-safe: Redis error on cooldown check → alarm suppressed (no ticket)
      expect(glpiCreateTicket).not.toHaveBeenCalled();
      expect(result.cooldownSkipped).toBe(1);
      expect(result.ticketsCreated).toBe(0);
      expect(result.errors).toBe(0);
    });
  });

  it('32. Redis error nos consecutive checks → thresholdReached=false, sem ticket', async () => {
    const { LogmeinAlarmEngineService } = await import('../src/domain/services/LogmeinAlarmEngineService.js');
    const rule = makeRule({
      alarmType: 'host_offline',
      minConsecutiveChecks: 2,
      consecutiveCheckIntervalMinutes: 5,
      createTicket: true,
      glpiGroupId: 10,
      glpiItilCategoryId: 20,
    });
    const target = makeTarget();
    const host = makeHost({ status: 'offline' });
    const hostMap = new Map([[target.hostId, host]]);
    const glpiCreateTicket = vi.fn().mockResolvedValue(9999);
    const repo = makeRepository({
      listEnabledRules: vi.fn().mockResolvedValue([rule]),
      listTargetsForRule: vi.fn().mockResolvedValue([target]),
      getHostsCurrentStatus: vi.fn().mockResolvedValue(hostMap),
    });
    // Consecutive Redis throws → fail-safe: thresholdReached=false → consecutiveWaiting++
    const redis = makeRedis({
      get: vi.fn().mockRejectedValue(new Error('Redis connection refused')),
      set: vi.fn().mockResolvedValue('OK'),
    });
    const glpiClient = { createTicket: glpiCreateTicket } as never;

    await withAlarmFlags(true, true, async () => {
      const engine = new LogmeinAlarmEngineService(repo as never, redis, glpiClient);
      const result = await engine.runOnce();
      // Fail-safe: Redis error → threshold NOT treated as reached
      expect(glpiCreateTicket).not.toHaveBeenCalled();
      expect(result.fired).toBe(0);
      expect(result.consecutiveWaiting).toBe(1);
      expect(result.ticketsCreated).toBe(0);
      expect(result.errors).toBe(0);
    });
  });

  it('33. Worker não quebra quando Redis falha em todas as etapas', async () => {
    const { LogmeinAlarmEngineService } = await import('../src/domain/services/LogmeinAlarmEngineService.js');
    const rule = makeRule({ alarmType: 'host_offline', minConsecutiveChecks: 1 });
    const target = makeTarget();
    const host = makeHost({ status: 'offline' });
    const hostMap = new Map([[target.hostId, host]]);
    const repo = makeRepository({
      listEnabledRules: vi.fn().mockResolvedValue([rule]),
      listTargetsForRule: vi.fn().mockResolvedValue([target]),
      getHostsCurrentStatus: vi.fn().mockResolvedValue(hostMap),
    });
    // All Redis calls throw
    const redis = makeRedis({
      get: vi.fn().mockRejectedValue(new Error('Redis down')),
      set: vi.fn().mockRejectedValue(new Error('Redis down')),
    });

    await withAlarmFlags(true, false, async () => {
      const engine = new LogmeinAlarmEngineService(repo as never, redis, null);
      await expect(engine.runOnce()).resolves.toBeDefined();
      const result = await engine.runOnce();
      expect(result.errors).toBe(0); // graceful degradation — no crash
    });
  });

});
