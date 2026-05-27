import { describe, expect, it } from 'vitest';

import { AiOnlineSupervisorAlertService } from '../src/domain/services/AiOnlineSupervisorAlertService.js';
import type { AuditService } from '../src/domain/services/AuditService.js';
import type { RiskScoringService } from '../src/domain/services/RiskScoringService.js';
import type { KeyLock } from '../src/domain/contracts/KeyLock.js';
import type { SqlExecutor } from '../src/infra/db/postgres.js';

type CandidateRow = {
  conversation_id: string;
  glpi_ticket_id: number | null;
  status: string;
  queue_id: number | null;
  entity_id: number | null;
  technician_id: number | null;
  last_message_at: Date;
  last_message_direction: string;
  last_message_text: string;
  updated_at: Date;
  inactivity_status: string | null;
  inactivity_skip_reason: string | null;
  stalled_minutes: number;
  message_count: number;
};

class FakeRedis {
  public readonly values = new Map<string, string>();

  public async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  public async set(key: string, value: string): Promise<string> {
    this.values.set(key, value);
    return 'OK';
  }

  public async incr(key: string): Promise<number> {
    const next = Number(this.values.get(key) ?? '0') + 1;
    this.values.set(key, String(next));
    return next;
  }

  public async expire(): Promise<number> {
    return 1;
  }
}

class FakeExecutor implements SqlExecutor {
  public readonly inserted: unknown[][] = [];

  public constructor(private readonly candidates: CandidateRow[]) {}

  public async query(text: string, params: unknown[] = []): Promise<any> {
    if (text.includes('open_unassigned')) {
      return { rows: [{ queue_id: 10, open_unassigned: 12 }], rowCount: 1 };
    }

    if (text.includes('stalled_minutes') && text.includes('glpi_plugin_integaglpi_conversations')) {
      const limit = Number(params[0] ?? this.candidates.length);
      return { rows: this.candidates.slice(0, limit), rowCount: Math.min(this.candidates.length, limit) };
    }

    if (text.includes('COUNT(*)::int AS count') && text.includes('glpi_plugin_integaglpi_ai_online_alerts')) {
      return { rows: [{ count: 0 }], rowCount: 1 };
    }

    if (text.includes('INSERT INTO public.glpi_plugin_integaglpi_ai_online_alerts')) {
      this.inserted.push(params);
      return { rows: [{ alert_id: params[0] }], rowCount: 1 };
    }

    throw new Error(`unexpected query: ${text.slice(0, 80)}`);
  }
}

const lock: KeyLock = {
  withLock: async (_key, work) => work(),
};

const lowRiskScoring = {
  score: () => ({
    riskScore: 10,
    confidenceScore: 50,
    reopenRisk: 'low',
    dissatisfactionRisk: 'low',
    escalationRisk: 'low',
    reasons: [],
    recommendedActions: [],
    signals: {},
  }),
} as unknown as RiskScoringService;

function auditSink(events: unknown[]): AuditService {
  return {
    recordAuditEventSafe: async (event: unknown) => {
      events.push(event);
    },
  } as unknown as AuditService;
}

function candidate(overrides: Partial<CandidateRow> = {}): CandidateRow {
  return {
    conversation_id: `conv-${Math.random().toString(36).slice(2)}`,
    glpi_ticket_id: 123,
    status: 'open',
    queue_id: 10,
    entity_id: 2,
    technician_id: 55,
    last_message_at: new Date('2026-05-27T10:00:00Z'),
    last_message_direction: 'inbound',
    last_message_text: 'cliente aguarda retorno',
    updated_at: new Date('2026-05-27T10:00:00Z'),
    inactivity_status: null,
    inactivity_skip_reason: null,
    stalled_minutes: 300,
    message_count: 4,
    ...overrides,
  };
}

describe('AiOnlineSupervisorAlertService', () => {
  it('creates deterministic supervisory alerts without customer-facing actions', async () => {
    const executor = new FakeExecutor([candidate({ conversation_id: 'conv-waiting' })]);
    const audits: unknown[] = [];
    const service = new AiOnlineSupervisorAlertService(
      executor,
      new FakeRedis(),
      lock,
      lowRiskScoring,
      undefined,
      auditSink(audits),
    );

    const result = await service.runOnce(new Date('2026-05-27T16:00:00Z'));

    expect(result).toEqual({ processed: 1, created: 1, suppressed: 0, errors: 0 });
    expect(executor.inserted).toHaveLength(1);
    expect(String(executor.inserted[0][6])).toBe('long_waiting_client');
    expect(String(executor.inserted[0][9])).toContain('Possível ponto de atenção');
    expect(String(executor.inserted[0][10])).toContain('Sugestão para revisão humana');
    expect(JSON.stringify(audits)).toContain('AI_ONLINE_ALERT_CREATED');
    expect(JSON.stringify(executor.inserted)).not.toMatch(/sendOutbound|MetaClient|Ticket::update|KnowbaseItem::add/i);
  });

  it('sanitizes evidence signals and keeps coaching language non punitive', async () => {
    const executor = new FakeExecutor([
      candidate({
        conversation_id: 'conv-sanitize',
        inactivity_status: 'risk',
        inactivity_skip_reason: 'contato joao@example.com telefone +55 11 99999-9999 token=abc123',
      }),
    ]);
    const service = new AiOnlineSupervisorAlertService(
      executor,
      new FakeRedis(),
      lock,
      lowRiskScoring,
    );

    const result = await service.runOnce(new Date('2026-05-27T16:00:00Z'));

    expect(result.created).toBeGreaterThan(0);
    const serialized = JSON.stringify(executor.inserted);
    expect(serialized).toContain('[email]');
    expect(serialized).toContain('[telefone]');
    expect(serialized).toContain('[redacted]');
    expect(serialized).not.toContain('joao@example.com');
    expect(serialized).not.toContain('99999-9999');
    expect(serialized).not.toMatch(/erro do técnico|falha do técnico|ranking|punição|negligência/i);
  });

  it('suppresses duplicate alerts by cooldown', async () => {
    const executor = new FakeExecutor([candidate({ conversation_id: 'conv-cooldown' })]);
    const redis = new FakeRedis();
    const service = new AiOnlineSupervisorAlertService(
      executor,
      redis,
      lock,
      lowRiskScoring,
    );

    const first = await service.runOnce(new Date('2026-05-27T16:00:00Z'));
    const second = await service.runOnce(new Date('2026-05-27T16:05:00Z'));

    expect(first.created).toBe(1);
    expect(second.created).toBe(0);
    expect(second.suppressed).toBe(1);
  });

  it('creates a deterministic supervisor alert for strong escalation language without waiting for AI', async () => {
    const executor = new FakeExecutor([candidate({
      conversation_id: 'conv-supervisor-now',
      last_message_text: 'Quero falar com supervisor, estou insatisfeito e vou reclamar no procon.',
      stalled_minutes: 2,
    })]);
    const service = new AiOnlineSupervisorAlertService(
      executor,
      new FakeRedis(),
      lock,
      lowRiskScoring,
      undefined,
    );

    const result = await service.runOnce(new Date('2026-05-27T16:00:00Z'));

    expect(result.created).toBeGreaterThan(0);
    const serialized = JSON.stringify(executor.inserted);
    expect(serialized).toContain('supervisor_requested');
    expect(serialized).toContain('possible_frustration');
    expect(serialized).toContain('Sugestão para revisão humana');
  });

  it('respects global rate limit and max conversations per run', async () => {
    const rows = Array.from({ length: 100 }, (_value, index) => candidate({
      conversation_id: `conv-${index}`,
      technician_id: null,
      stalled_minutes: 45,
    }));
    const executor = new FakeExecutor(rows);
    const service = new AiOnlineSupervisorAlertService(
      executor,
      new FakeRedis(),
      lock,
      lowRiskScoring,
      undefined,
      undefined,
      { maxAlertsGlobalPerHour: 3 },
    );

    const result = await service.runOnce(new Date('2026-05-27T16:00:00Z'));

    expect(result.processed).toBe(50);
    expect(result.created).toBe(3);
    expect(result.suppressed).toBeGreaterThan(0);
  });
});
