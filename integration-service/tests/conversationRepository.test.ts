import { describe, expect, it } from 'vitest';

import type { SqlExecutor } from '../src/infra/db/postgres.js';
import { PostgresConversationRepository } from '../src/repositories/postgres/PostgresConversationRepository.js';

type QueryResult<T> = { rowCount: number; rows: T[] };

class FakeSqlExecutor implements SqlExecutor {
  public queries: Array<{ text: string; params: unknown[] }> = [];
  public nextRows: unknown[] = [];

  public async query<T>(text: string, params?: unknown[]): Promise<QueryResult<T>> {
    this.queries.push({ text, params: params ?? [] });
    const rows = this.nextRows.length > 0 ? this.nextRows.splice(0) as T[] : [];
    return { rowCount: rows.length, rows };
  }
}

function compactSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}

describe('PostgresConversationRepository', () => {
  it('persists remembered entity metadata when creating a ticket-linked conversation', async () => {
    const executor = new FakeSqlExecutor();
    const now = new Date('2026-06-04T12:00:00.000Z');
    executor.nextRows = [{
      id: 'conv-entity',
      phone_e164: '+5511999996562',
      contact_id: 'contact-1',
      glpi_ticket_id: 2112319300,
      glpi_entity_id: '54',
      glpi_entity_name: 'Cliente Teste',
      queue_id: null,
      profile_collection_state: null,
      status: 'open',
      last_message_at: now,
      created_at: now,
      updated_at: now,
    }];
    const repository = new PostgresConversationRepository(executor);

    const conversation = await repository.create({
      phoneE164: '+5511999996562',
      contactId: 'contact-1',
      glpiTicketId: 2112319300,
      status: 'open',
      lastMessageAt: now,
      glpiEntityId: 54,
      glpiEntityName: ' Cliente Teste ',
    });

    expect(compactSql(executor.queries[0]?.text ?? '')).toContain('glpi_entity_id, glpi_entity_name');
    expect(executor.queries[0]?.params).toEqual([
      '+5511999996562',
      'contact-1',
      2112319300,
      'open',
      now,
      54,
      'Cliente Teste',
    ]);
    expect(conversation).toMatchObject({
      id: 'conv-entity',
      glpiTicketId: 2112319300,
      glpiEntityId: 54,
      glpiEntityName: 'Cliente Teste',
    });
  });

  it('prioritizes an open ticket-linked conversation over newer triage conversations for inbound reuse', async () => {
    const executor = new FakeSqlExecutor();
    const repository = new PostgresConversationRepository(executor);

    await repository.findReusableByPhoneE164('+5541999999999');

    expect(executor.queries).toHaveLength(1);
    const sql = compactSql(executor.queries[0]?.text ?? '');
    expect(sql).toContain("WHEN status = 'open' AND glpi_ticket_id IS NOT NULL AND glpi_ticket_id > 0 THEN 0");
    expect(sql.indexOf("WHEN status = 'open'")).toBeLessThan(sql.indexOf('last_message_at DESC'));
    expect(executor.queries[0]?.params).toEqual([
      '+5541999999999',
      ['open', 'awaiting_queue_selection', 'awaiting_entity_selection', 'collecting_contact_profile'],
    ]);
  });

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
