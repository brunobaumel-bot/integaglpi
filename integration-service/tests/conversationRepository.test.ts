import { describe, expect, it } from 'vitest';

import type { SqlExecutor } from '../src/infra/db/postgres.js';
import { PostgresConversationRepository } from '../src/repositories/postgres/PostgresConversationRepository.js';

type QueryResult<T> = { rowCount: number; rows: T[] };

class FakeSqlExecutor implements SqlExecutor {
  public queries: Array<{ text: string; params: unknown[] }> = [];

  public async query<T>(text: string, params?: unknown[]): Promise<QueryResult<T>> {
    this.queries.push({ text, params: params ?? [] });
    return { rowCount: 1, rows: [] };
  }
}

function compactSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}

describe('PostgresConversationRepository', () => {
  it('reopenConversation reopens the conversation row and clears closed runtime state', async () => {
    const executor = new FakeSqlExecutor();
    const repository = new PostgresConversationRepository(executor);

    await repository.reopenConversation('conv-1');

    expect(executor.queries).toHaveLength(2);
    expect(compactSql(executor.queries[0]?.text ?? '')).toContain(
      "UPDATE glpi_plugin_integaglpi_conversations SET status = 'open', updated_at = NOW() WHERE id = $1",
    );
    expect(executor.queries[0]?.params).toEqual(['conv-1']);
    expect(compactSql(executor.queries[1]?.text ?? '')).toContain(
      "UPDATE glpi_plugin_integaglpi_conversation_runtime SET status = 'open', closed_at = NULL, updated_at = NOW() WHERE conversation_id = $1",
    );
    expect(executor.queries[1]?.params).toEqual(['conv-1']);
  });
});
