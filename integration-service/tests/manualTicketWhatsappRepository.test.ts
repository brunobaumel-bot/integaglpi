import { describe, expect, it } from 'vitest';

import type { SqlExecutor } from '../src/infra/db/postgres.js';
import { PostgresManualTicketWhatsappRepository } from '../src/repositories/postgres/PostgresManualTicketWhatsappRepository.js';

type QueryResult<T> = { rowCount: number; rows: T[] };

class FakeSqlExecutor implements SqlExecutor {
  public queries: Array<{ text: string; params: unknown[] }> = [];

  public async query<T>(text: string, params?: unknown[]): Promise<QueryResult<T>> {
    this.queries.push({ text, params: params ?? [] });
    return {
      rowCount: 1,
      rows: [{
        id: 'conv-old-ticket',
        phone_e164: '+5541999999999',
        contact_id: 'contact-1',
        glpi_ticket_id: 123,
        status: 'open',
        link_origin: 'manual_glpi_ticket_link',
        linked_by_glpi_user_id: 7,
        linked_at: new Date(),
        last_message_at: new Date(),
        created_at: new Date(),
        updated_at: new Date(),
      } as T],
    };
  }
}

function compactSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}

describe('PostgresManualTicketWhatsappRepository', () => {
  it('refreshes the reusable conversation timestamp when manually linking a ticket', async () => {
    const executor = new FakeSqlExecutor();
    const repository = new PostgresManualTicketWhatsappRepository(executor);

    await repository.linkConversation({
      conversationId: 'conv-old-ticket',
      ticketId: 123,
      glpiUserId: 7,
    });

    expect(executor.queries).toHaveLength(1);
    const sql = compactSql(executor.queries[0]?.text ?? '');
    expect(sql).toContain("glpi_ticket_id = $2, status = 'open', last_message_at = NOW()");
    expect(sql).toContain("link_origin = 'manual_glpi_ticket_link'");
    expect(sql).toContain('linked_by_glpi_user_id = $3');
    expect(executor.queries[0]?.params).toEqual(['conv-old-ticket', 123, 7]);
  });
});
