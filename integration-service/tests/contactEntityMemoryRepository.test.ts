import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';

import type { SqlExecutor } from '../src/infra/db/postgres';
import { PostgresContactEntityMemoryRepository } from '../src/repositories/postgres/PostgresContactEntityMemoryRepository';

class RecordingExecutor implements SqlExecutor {
  public readonly queries: Array<{ text: string; params?: unknown[] }> = [];

  public constructor(private readonly rows: QueryResultRow[] = []) {}

  public async query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<QueryResult<R>> {
    this.queries.push({ text, params });

    return {
      command: 'SELECT',
      rowCount: this.rows.length,
      oid: 0,
      fields: [],
      rows: this.rows as R[],
    };
  }
}

const memoryRow = {
  id: '10',
  phone_e164: '+554199166562',
  contact_id: null,
  glpi_entity_id: 123,
  glpi_entity_name: 'Cliente',
  source_ticket_id: 456,
  source_conversation_id: 'conversation-1',
  source: 'manual',
  is_active: true,
  created_at: '2026-05-13T12:00:00.000Z',
  updated_at: '2026-05-13T12:00:00.000Z',
};

describe('PostgresContactEntityMemoryRepository', () => {
  it('busca somente memoria ativa por telefone', async () => {
    const executor = new RecordingExecutor([memoryRow]);
    const repository = new PostgresContactEntityMemoryRepository(executor);

    const result = await repository.findActiveByPhone('+554199166562');

    expect(result?.phoneE164).toBe('+554199166562');
    expect(result?.isActive).toBe(true);
    expect(executor.queries).toHaveLength(1);
    expect(executor.queries[0].text).toContain('WHERE phone_e164 = $1');
    expect(executor.queries[0].text).toContain('AND is_active = TRUE');
  });

  it('preserva historico ao desativar memoria ativa anterior antes de inserir nova ativa', async () => {
    const executor = new RecordingExecutor([memoryRow]);
    const repository = new PostgresContactEntityMemoryRepository(executor);

    const result = await repository.rememberEntityForPhone({
      phoneE164: '+554199166562',
      contactId: null,
      glpiEntityId: 123,
      glpiEntityName: 'Cliente',
      sourceTicketId: 456,
      sourceConversationId: 'conversation-1',
      source: 'manual',
    });

    expect(result.isActive).toBe(true);
    expect(executor.queries).toHaveLength(1);
    const sql = executor.queries[0].text;
    expect(sql).toContain('WITH deactivated AS');
    expect(sql).toContain('SET is_active = FALSE');
    expect(sql).toContain('INSERT INTO');
    expect(sql).not.toContain('ON CONFLICT (phone_e164)');
  });
});
