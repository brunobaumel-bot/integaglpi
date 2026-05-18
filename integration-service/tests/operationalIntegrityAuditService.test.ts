import { describe, expect, it, vi } from 'vitest';
import type { QueryResult, QueryResultRow } from 'pg';

import { AuditService } from '../src/domain/services/AuditService.js';
import { OperationalIntegrityAuditService } from '../src/domain/services/OperationalIntegrityAuditService.js';
import type { SqlExecutor } from '../src/infra/db/postgres.js';

function queryResult<R extends QueryResultRow>(rows: R[]): QueryResult<R> {
  return {
    rows,
    rowCount: rows.length,
    command: 'SELECT',
    oid: 0,
    fields: [],
  };
}

describe('OperationalIntegrityAuditService', () => {
  it('detecta pelo menos duas inconsistencias e registra eventos sem corrigir dados', async () => {
    const executor: SqlExecutor = {
      query: vi.fn()
        .mockResolvedValueOnce(queryResult([{ id: 'msg-row-1', message_id: 'wamid.orphan' }]))
        .mockResolvedValueOnce(queryResult([{ id: 'msg-row-2', message_id: 'wamid.media', conversation_id: 'conv-1' }]))
        .mockResolvedValueOnce(queryResult([{ id: 'conv-2', status: 'bad_state', glpi_ticket_id: null }]))
        .mockResolvedValueOnce(queryResult([{
          id: 'conv-stale',
          updated_at: new Date('2026-05-14T10:00:00.000Z'),
          inbound_messages_count: '2',
          last_inbound_at: new Date('2026-05-14T10:10:00.000Z'),
        }])),
    };
    const auditService = {
      recordAuditEventFireAndForget: vi.fn(),
    } as unknown as AuditService;
    const service = new OperationalIntegrityAuditService(executor, auditService);

    const result = await service.auditOperationalIntegrity({
      correlationId: 'WA-20260510153022-a8f3c2',
      limit: 10,
    });

    expect(result).toEqual({
      orphanMessages: 1,
      mediaWithoutInfo: 1,
      invalidConversationStates: 1,
      staleAwaitingQueueSelection: 1,
    });
    expect(auditService.recordAuditEventFireAndForget).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'ORPHAN_MESSAGE', messageId: 'wamid.orphan' }),
    );
    expect(auditService.recordAuditEventFireAndForget).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'INVALID_STATE', conversationId: 'conv-2' }),
    );
    expect(auditService.recordAuditEventFireAndForget).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'AWAITING_QUEUE_SELECTION_STALE',
        conversationId: 'conv-stale',
        status: 'pending',
        payload: expect.objectContaining({
          conversation_status: 'awaiting_queue_selection',
          inbound_messages_count: 2,
          remediation: 'manual_queue_selection_required',
        }),
      }),
    );
    expect(executor.query).toHaveBeenCalledTimes(4);
    for (const call of vi.mocked(executor.query).mock.calls) {
      expect(call[0].trim().toUpperCase()).toMatch(/^SELECT\b/);
    }
  });
});
