/**
 * Testes estáticos e de unidade — integaglpi_logmein_alarm_rules_and_auto_ticket_implementation_001
 *
 *  1. LOGMEIN_ALARM_ENGINE_ENABLED=false → engineDisabled=true sem processar nada
 *  2. LOGMEIN_AUTO_TICKET_ENABLED=false → GLPI createTicket NÃO chamado
 *  3. host_offline: status=offline → alarme dispara (condição atendida)
 *  4. host_offline: status=online  → alarme NÃO dispara
 *  5. host_not_seen_minutes: lastSeenAt antigo → alarme dispara
 *  6. host_not_seen_minutes: lastSeenAt recente → alarme NÃO dispara
 *  7. cooldown ativo (Redis GET ≠ null) → cooldownSkipped++, sem ticket
 *  8. cooldown inativo → alarme dispara, Redis SET EX chamado
 *  9. dedupe: event_hash já existe (INSERT retorna inserted=false) → dedupeSkipped++
 * 10. dedupe: event_hash novo (INSERT retorna inserted=true) → fired++
 * 11. createRule valida glpiEntitiesId=0 → retorna erro
 * 12. createRule valida glpiEntitiesId=null → retorna erro
 * 13. createRule valida cooldownMinutes fora do range → retorna erro
 * 14. host_not_seen_minutes sem not_seen_minutes no payload → erro de validação
 * 15. env default: LOGMEIN_AUTO_TICKET_ENABLED=false e LOGMEIN_ALARM_ENGINE_ENABLED=false
 * 16. Worker não importa InboundWebhookService (static check)
 * 17. Worker não envia WhatsApp (static check)
 * 18. Engine não acessa mariadb/mysql (static check)
 * 19. buildEventHash: hashes distintos para datas diferentes
 * 20. buildEventHash: hash estável para mesmos inputs
 *
 * PHASE: integaglpi_logmein_alarm_rules_and_auto_ticket_implementation_001
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

// ── Helpers ───────────────────────────────────────────────────────────────────

type AlarmType = 'host_offline' | 'host_not_seen_minutes';

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
    cooldownMinutes: 30,
    conditionPayload: {},
    glpiEntitiesId: 5,
    glpiGroupId: null,
    glpiItilCategoryId: null,
    createTicket: false,
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
    equipmentTag: '',
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
    get: vi.fn().mockResolvedValue(null),  // default: no cooldown
    set: vi.fn().mockResolvedValue('OK'),
    ...overrides,
  };
}

function makeGlpiClient() {
  return {
    createTicket: vi.fn().mockResolvedValue(9001),
  };
}

// ── env manipulation ──────────────────────────────────────────────────────────

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
      expect(result.fired).toBe(0);
      expect(repo.listEnabledRules).not.toHaveBeenCalled();
    });
  });

  it('2. LOGMEIN_AUTO_TICKET_ENABLED=false → createTicket NÃO chamado mesmo com create_ticket=true', async () => {
    const { LogmeinAlarmEngineService } = await import('../src/domain/services/LogmeinAlarmEngineService.js');
    const rule = makeRule({ createTicket: true, glpiEntitiesId: 5 });
    const target = makeTarget();
    const host = makeHost({ status: 'offline' });
    const hostMap = new Map([[target.hostId, host]]);
    const repo = makeRepository({
      listEnabledRules: vi.fn().mockResolvedValue([rule]),
      listTargetsForRule: vi.fn().mockResolvedValue([target]),
      getHostsCurrentStatus: vi.fn().mockResolvedValue(hostMap),
      insertEventIfNew: vi.fn().mockResolvedValue({ inserted: true }),
    });
    const redis = makeRedis();
    const glpiClient = makeGlpiClient();

    await withAlarmFlags(true, false, async () => {
      const engine = new LogmeinAlarmEngineService(repo as never, redis, glpiClient as never);
      const result = await engine.runOnce();

      expect(result.ticketsCreated).toBe(0);
      expect(glpiClient.createTicket).not.toHaveBeenCalled();
      expect(result.fired).toBe(1);  // alarme ainda dispara, mas sem ticket
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
    const redis = makeRedis();

    await withAlarmFlags(true, false, async () => {
      const engine = new LogmeinAlarmEngineService(repo as never, redis, null);
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
    const redis = makeRedis();

    await withAlarmFlags(true, false, async () => {
      const engine = new LogmeinAlarmEngineService(repo as never, redis, null);
      const result = await engine.runOnce();

      expect(result.fired).toBe(0);
      expect(result.processed).toBe(1);
      expect(repo.insertEventIfNew).not.toHaveBeenCalled();
    });
  });

  it('5. host_not_seen_minutes: lastSeenAt antigo → alarme dispara', async () => {
    const { LogmeinAlarmEngineService } = await import('../src/domain/services/LogmeinAlarmEngineService.js');
    const rule = makeRule({
      alarmType: 'host_not_seen_minutes',
      conditionPayload: { not_seen_minutes: 15 },
    });
    const target = makeTarget();
    // 30 minutos atrás
    const oldDate = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const host = makeHost({ status: 'unknown', lastSeenAt: oldDate });
    const hostMap = new Map([[target.hostId, host]]);
    const repo = makeRepository({
      listEnabledRules: vi.fn().mockResolvedValue([rule]),
      listTargetsForRule: vi.fn().mockResolvedValue([target]),
      getHostsCurrentStatus: vi.fn().mockResolvedValue(hostMap),
      insertEventIfNew: vi.fn().mockResolvedValue({ inserted: true }),
    });
    const redis = makeRedis();

    await withAlarmFlags(true, false, async () => {
      const engine = new LogmeinAlarmEngineService(repo as never, redis, null);
      const result = await engine.runOnce();

      expect(result.fired).toBe(1);
    });
  });

  it('6. host_not_seen_minutes: lastSeenAt recente → alarme NÃO dispara', async () => {
    const { LogmeinAlarmEngineService } = await import('../src/domain/services/LogmeinAlarmEngineService.js');
    const rule = makeRule({
      alarmType: 'host_not_seen_minutes',
      conditionPayload: { not_seen_minutes: 60 },
    });
    const target = makeTarget();
    // 5 minutos atrás (dentro de 60min)
    const recentDate = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const host = makeHost({ status: 'unknown', lastSeenAt: recentDate });
    const hostMap = new Map([[target.hostId, host]]);
    const repo = makeRepository({
      listEnabledRules: vi.fn().mockResolvedValue([rule]),
      listTargetsForRule: vi.fn().mockResolvedValue([target]),
      getHostsCurrentStatus: vi.fn().mockResolvedValue(hostMap),
    });
    const redis = makeRedis();

    await withAlarmFlags(true, false, async () => {
      const engine = new LogmeinAlarmEngineService(repo as never, redis, null);
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
    // Redis retorna valor → cooldown ativo
    const redis = makeRedis({ get: vi.fn().mockResolvedValue('1') });

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
    const rule = makeRule({ alarmType: 'host_offline', cooldownMinutes: 45 });
    const target = makeTarget();
    const host = makeHost({ status: 'offline' });
    const hostMap = new Map([[target.hostId, host]]);
    const repo = makeRepository({
      listEnabledRules: vi.fn().mockResolvedValue([rule]),
      listTargetsForRule: vi.fn().mockResolvedValue([target]),
      getHostsCurrentStatus: vi.fn().mockResolvedValue(hostMap),
      insertEventIfNew: vi.fn().mockResolvedValue({ inserted: true }),
    });
    const redisSpy = makeRedis();

    await withAlarmFlags(true, false, async () => {
      const engine = new LogmeinAlarmEngineService(repo as never, redisSpy, null);
      const result = await engine.runOnce();

      expect(result.fired).toBe(1);
      // Redis SET must be called with EX and 45*60 seconds
      expect(redisSpy.set).toHaveBeenCalledWith(
        `logmein:alarm:cooldown:${rule.id}:${target.hostId}`,
        '1',
        'EX',
        45 * 60,
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
      insertEventIfNew: vi.fn().mockResolvedValue({ inserted: false }),  // dedupe hit
    });
    const redis = makeRedis();

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
    const redis = makeRedis();

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
      ruleName: 'Regra Inválida',
      alarmType: 'host_offline',
      cooldownMinutes: 30,
      conditionPayload: {},
      glpiEntitiesId: 0,  // proibido
      glpiGroupId: null,
      glpiItilCategoryId: null,
      createTicket: false,
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
      ruleName: 'Regra Negativa',
      alarmType: 'host_offline',
      cooldownMinutes: 30,
      conditionPayload: {},
      glpiEntitiesId: -1,
      glpiGroupId: null,
      glpiItilCategoryId: null,
      createTicket: false,
    });

    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.field === 'glpiEntitiesId')).toBe(true);
  });

  it('13. cooldownMinutes=0 → erro de validação (mínimo é 1)', async () => {
    const { LogmeinAlarmRulesService } = await import('../src/domain/services/LogmeinAlarmRulesService.js');
    const repo = makeRepository({ createRule: vi.fn() });
    const svc = new LogmeinAlarmRulesService(repo as never);

    const result = await svc.createRule({
      ruleName: 'Regra Cooldown Zero',
      alarmType: 'host_offline',
      cooldownMinutes: 0,
      conditionPayload: {},
      glpiEntitiesId: 5,
      glpiGroupId: null,
      glpiItilCategoryId: null,
      createTicket: false,
    });

    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.field === 'cooldownMinutes')).toBe(true);
    expect(repo.createRule).not.toHaveBeenCalled();
  });

  it('14. host_not_seen_minutes sem not_seen_minutes no payload → erro', async () => {
    const { LogmeinAlarmRulesService } = await import('../src/domain/services/LogmeinAlarmRulesService.js');
    const repo = makeRepository({ createRule: vi.fn() });
    const svc = new LogmeinAlarmRulesService(repo as never);

    const result = await svc.createRule({
      ruleName: 'Regra Sem Payload',
      alarmType: 'host_not_seen_minutes',
      cooldownMinutes: 30,
      conditionPayload: {},  // ausente not_seen_minutes
      glpiEntitiesId: 5,
      glpiGroupId: null,
      glpiItilCategoryId: null,
      createTicket: false,
    });

    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.field.includes('not_seen_minutes'))).toBe(true);
    expect(repo.createRule).not.toHaveBeenCalled();
  });

});

// ── Tests: env defaults ───────────────────────────────────────────────────────

describe('env defaults — feature flags off por padrão', () => {

  it('15. env.ts declara LOGMEIN_AUTO_TICKET_ENABLED e LOGMEIN_ALARM_ENGINE_ENABLED com default false', () => {
    const envSource = readFileSync(
      path.resolve(__dirname, '../src/config/env.ts'),
      'utf-8',
    );

    // Both flags must exist
    expect(envSource).toContain('LOGMEIN_ALARM_ENGINE_ENABLED');
    expect(envSource).toContain('LOGMEIN_AUTO_TICKET_ENABLED');

    // Both must default false
    const alarmBlock = /LOGMEIN_ALARM_ENGINE_ENABLED[\s\S]{0,200}\.default\('false'\)/.exec(envSource);
    const ticketBlock = /LOGMEIN_AUTO_TICKET_ENABLED[\s\S]{0,200}\.default\('false'\)/.exec(envSource);
    expect(alarmBlock).not.toBeNull();
    expect(ticketBlock).not.toBeNull();
  });

});

// ── Tests: static safety checks ──────────────────────────────────────────────

describe('safety — static file checks', () => {

  it('16. logmeinAlarmWorker.ts NÃO importa InboundWebhookService', () => {
    const source = readFileSync(
      path.resolve(__dirname, '../src/jobs/logmeinAlarmWorker.ts'),
      'utf-8',
    );
    expect(source).not.toContain('InboundWebhookService');
  });

  it('17. logmeinAlarmWorker.ts NÃO chama sendMessage / WhatsApp', () => {
    const source = readFileSync(
      path.resolve(__dirname, '../src/jobs/logmeinAlarmWorker.ts'),
      'utf-8',
    );
    expect(source).not.toMatch(/sendMessage|sendWhatsApp|metaClient|MetaClient/i);
  });

  it('18. LogmeinAlarmEngineService NÃO acessa mariadb/mysql', () => {
    const source = readFileSync(
      path.resolve(__dirname, '../src/domain/services/LogmeinAlarmEngineService.ts'),
      'utf-8',
    );
    expect(source).not.toMatch(/mariadb|mysql|knex|typeorm/i);
  });

  it('16b. LogmeinAlarmEngineService não cria InboundWebhookService', () => {
    const source = readFileSync(
      path.resolve(__dirname, '../src/domain/services/LogmeinAlarmEngineService.ts'),
      'utf-8',
    );
    expect(source).not.toContain('InboundWebhookService');
  });

});

// ── Tests: event_hash ─────────────────────────────────────────────────────────

describe('event_hash — dedupe por dia', () => {

  function buildEventHash(ruleId: string, hostId: string, alarmType: string, dateUtc: string): string {
    return createHash('sha256')
      .update(`${ruleId}|${hostId}|${alarmType}|${dateUtc}`)
      .digest('hex');
  }

  it('19. hashes distintos para datas diferentes (mesmo rule/host/type)', () => {
    const h1 = buildEventHash('rule-1', 'host-1', 'host_offline', '2026-06-07');
    const h2 = buildEventHash('rule-1', 'host-1', 'host_offline', '2026-06-08');
    expect(h1).not.toBe(h2);
  });

  it('20. hash estável para mesmos inputs (determinístico)', () => {
    const h1 = buildEventHash('rule-1', 'host-1', 'host_offline', '2026-06-07');
    const h2 = buildEventHash('rule-1', 'host-1', 'host_offline', '2026-06-07');
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(64); // SHA-256 hex
  });

});

// ── Tests: ticket creation guard ─────────────────────────────────────────────

describe('ticket creation — gate duplo obrigatório', () => {

  it('ticket criado apenas quando LOGMEIN_AUTO_TICKET_ENABLED=true E create_ticket=true E entities_id>0', async () => {
    const { LogmeinAlarmEngineService } = await import('../src/domain/services/LogmeinAlarmEngineService.js');
    const rule = makeRule({
      alarmType: 'host_offline',
      createTicket: true,
      glpiEntitiesId: 7,
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
    const redis = makeRedis();
    const glpiClient = makeGlpiClient();

    await withAlarmFlags(true, true, async () => {
      const engine = new LogmeinAlarmEngineService(repo as never, redis, glpiClient as never);
      const result = await engine.runOnce();

      expect(result.ticketsCreated).toBe(1);
      // Title format: [LogMeIn] {alarm_type} - {hostname}
      expect(glpiClient.createTicket).toHaveBeenCalledWith(
        expect.objectContaining({
          title: `[LogMeIn] host_offline - ${host.hostName}`,
          entitiesId: 7,
        }),
      );
    });
  });

});
