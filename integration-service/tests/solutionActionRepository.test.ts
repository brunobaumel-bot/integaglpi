import { describe, expect, it } from 'vitest';

import { PostgresSolutionActionRepository } from '../src/repositories/postgres/PostgresSolutionActionRepository.js';
import type { SqlExecutor } from '../src/infra/db/postgres.js';

type QueryResult<T> = { rowCount: number; rows: T[] };

class FakeSqlExecutor implements SqlExecutor {
  public queries: Array<{ text: string; params: unknown[] }> = [];
  private readonly results: Array<QueryResult<never>> = [];

  public enqueue<T>(result: QueryResult<T>): void {
    this.results.push(result as QueryResult<never>);
  }

  public async query<T>(text: string, params?: unknown[]): Promise<QueryResult<T>> {
    this.queries.push({ text, params: params ?? [] });
    const result = this.results.shift() ?? { rowCount: 0, rows: [] };
    return result as QueryResult<T>;
  }
}

function solutionActionRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: 'action-1',
    action_key: 'solution:approve:1234:conv-1',
    whatsapp_message_id: 'wamid.solution',
    ticket_id: 1234,
    conversation_id: 'conv-1',
    phone_e164: '+5511999999999',
    action: 'approve',
    status: 'processing',
    previous_ticket_status: 5,
    final_ticket_status: null,
    error_code: null,
    error_message: null,
    csat_rating: null,
    supervisor_review_required: false,
    created_at: new Date('2026-01-01T00:00:00Z'),
    updated_at: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('PostgresSolutionActionRepository', () => {
  it('reserves a solution action atomically with processing status', async () => {
    const executor = new FakeSqlExecutor();
    executor.enqueue({ rowCount: 1, rows: [solutionActionRow()] });
    const repository = new PostgresSolutionActionRepository(executor);

    const result = await repository.reserveAction({
      actionKey: 'solution:approve:1234:conv-1',
      whatsappMessageId: 'wamid.solution',
      ticketId: 1234,
      conversationId: 'conv-1',
      phoneE164: '+5511999999999',
      action: 'approve',
      previousTicketStatus: 5,
    });

    expect(result.reserved).toBe(true);
    expect(result.action.status).toBe('processing');
    expect(executor.queries[0]?.text).toContain('ON CONFLICT (whatsapp_message_id) DO NOTHING');
  });

  it('returns the existing action when whatsapp_message_id was already reserved', async () => {
    const executor = new FakeSqlExecutor();
    executor.enqueue({ rowCount: 0, rows: [] });
    executor.enqueue({ rowCount: 1, rows: [solutionActionRow({ status: 'success' })] });
    const repository = new PostgresSolutionActionRepository(executor);

    const result = await repository.reserveAction({
      actionKey: 'solution:approve:1234:conv-1',
      whatsappMessageId: 'wamid.solution',
      ticketId: 1234,
      conversationId: 'conv-1',
      phoneE164: '+5511999999999',
      action: 'approve',
      previousTicketStatus: 5,
    });

    expect(result.reserved).toBe(false);
    expect(result.action.status).toBe('success');
    expect(executor.queries[1]?.text).toContain('WHERE whatsapp_message_id = $1');
  });

  it('marks actions as success and stores the final ticket status', async () => {
    const executor = new FakeSqlExecutor();
    const repository = new PostgresSolutionActionRepository(executor);

    await repository.markSuccess('action-1', 6);

    expect(executor.queries[0]?.text).toContain("SET status = 'success'");
    expect(executor.queries[0]?.params).toEqual(['action-1', 6]);
  });

  it('marks actions as error with a safe truncated message', async () => {
    const executor = new FakeSqlExecutor();
    const repository = new PostgresSolutionActionRepository(executor);

    await repository.markError('action-1', 'GLPI_TICKET_UPDATE_FAILED', 'x'.repeat(1200));

    expect(executor.queries[0]?.text).toContain('SET status = $2');
    expect(executor.queries[0]?.params[1]).toBe('error');
    expect(executor.queries[0]?.params[2]).toBe('GLPI_TICKET_UPDATE_FAILED');
    expect(String(executor.queries[0]?.params[3])).toHaveLength(1000);
  });

  it('finds only successful approval actions that still need CSAT', async () => {
    const executor = new FakeSqlExecutor();
    executor.enqueue({ rowCount: 1, rows: [solutionActionRow({ status: 'success' })] });
    const repository = new PostgresSolutionActionRepository(executor);

    const action = await repository.findPendingCsatAction(1234, 'conv-1');

    expect(action?.id).toBe('action-1');
    expect(executor.queries[0]?.text).toContain('approve.csat_rating IS NULL');
    expect(executor.queries[0]?.text).toContain('NOT EXISTS');
    expect(executor.queries[0]?.text).toContain('csat.csat_rating IS NOT NULL');
    expect(executor.queries[0]?.params).toEqual([1234, 'conv-1']);
  });

  it('detects a successful reopen after a previous approval cycle', async () => {
    const executor = new FakeSqlExecutor();
    executor.enqueue({ rowCount: 1, rows: [{}] });
    const repository = new PostgresSolutionActionRepository(executor);

    const hasReopen = await repository.hasSuccessfulReopenAfter(
      1234,
      'conv-1',
      new Date('2026-06-05T12:00:00Z'),
    );

    expect(hasReopen).toBe(true);
    expect(executor.queries[0]?.text).toContain("action = 'reopen'");
    expect(executor.queries[0]?.text).toContain("status = 'success'");
    expect(executor.queries[0]?.text).toContain('created_at > $3');
    expect(executor.queries[0]?.params).toEqual([1234, 'conv-1', new Date('2026-06-05T12:00:00Z')]);
  });
});
