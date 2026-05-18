import { describe, expect, it } from 'vitest';

import { PostgresMessageRepository } from '../src/repositories/postgres/PostgresMessageRepository.js';
import type { SqlExecutor } from '../src/infra/db/postgres.js';

class FakeExecutor implements SqlExecutor {
  public queries: Array<{ text: string; params?: unknown[] }> = [];

  public constructor(private readonly currentDeliveryStatus: string | null) {}

  public async query<R>(text: string, params?: unknown[]): Promise<any> {
    this.queries.push({ text, params });

    if (text.includes('SELECT id, delivery_status')) {
      return {
        rows: [{ id: 'msg-1', delivery_status: this.currentDeliveryStatus } as R],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      };
    }

    if (text.includes('INSERT INTO')) {
      return {
        rows: [{ id: 'event-1' } as R],
        rowCount: 1,
        command: 'INSERT',
        oid: 0,
        fields: [],
      };
    }

    return {
      rows: [],
      rowCount: 1,
      command: 'UPDATE',
      oid: 0,
      fields: [],
    };
  }
}

describe('PostgresMessageRepository delivery status ordering', () => {
  it('does not downgrade read to delivered when Meta events arrive out of order', async () => {
    const executor = new FakeExecutor('read');
    const repository = new PostgresMessageRepository(executor);

    const result = await repository.recordDeliveryStatus({
      metaMessageId: 'wamid.1',
      status: 'delivered',
      receivedAt: new Date('2026-05-17T12:00:00.000Z'),
    });

    const updateQuery = executor.queries.find((query) => query.text.includes('UPDATE'));
    expect(result.currentStatus).toBe('read');
    expect(updateQuery?.params?.[2]).toBe('read');
  });

  it('records failed without overwriting a delivered/read status', async () => {
    const executor = new FakeExecutor('delivered');
    const repository = new PostgresMessageRepository(executor);

    const result = await repository.recordDeliveryStatus({
      metaMessageId: 'wamid.2',
      status: 'failed',
      errorCode: '131047',
      errorMessageSanitized: 'Template required',
      receivedAt: new Date('2026-05-17T12:00:00.000Z'),
    });

    const updateQuery = executor.queries.find((query) => query.text.includes('UPDATE'));
    expect(result.currentStatus).toBe('delivered');
    expect(updateQuery?.params?.[2]).toBe('delivered');
    expect(updateQuery?.params?.[4]).toBe('131047');
    expect(updateQuery?.params?.[5]).toBe('Template required');
  });
});
