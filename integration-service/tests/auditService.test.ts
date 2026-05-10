import { describe, expect, it, vi } from 'vitest';

import { AuditService } from '../src/domain/services/AuditService.js';
import { logger } from '../src/infra/logger/logger.js';
import type { AuditEventInput, AuditEventRepository } from '../src/repositories/contracts/AuditEventRepository.js';

class FakeAuditEventRepository implements AuditEventRepository {
  public events: AuditEventInput[] = [];

  public async create(input: AuditEventInput): Promise<void> {
    this.events.push(input);
  }
}

describe('AuditService', () => {
  it('grava evento via repository com payload sanitizado', async () => {
    const repository = new FakeAuditEventRepository();
    const service = new AuditService(repository);

    await service.recordAuditEvent({
      correlationId: 'WA-20260510153022-a8f3c2',
      ticketId: 10,
      eventType: 'MESSAGE_SENT',
      status: 'success',
      severity: 'info',
      source: 'test',
      payload: { access_token: 'secret', keep: 'ok' },
    });

    expect(repository.events).toHaveLength(1);
    expect(repository.events[0]).toMatchObject({
      correlationId: 'WA-20260510153022-a8f3c2',
      ticketId: 10,
      payload: { access_token: '[REDACTED]', keep: 'ok' },
    });
  });

  it('falha no repository nao propaga para o fluxo principal e gera AUDIT_WRITE_FAILED', async () => {
    const repository: AuditEventRepository = {
      create: vi.fn().mockRejectedValue(new Error('db down')),
    };
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    const service = new AuditService(repository);

    await expect(service.recordAuditEventSafe({
      correlationId: 'WA-20260510153022-a8f3c2',
      eventType: 'MESSAGE_SENT',
      status: 'success',
      severity: 'info',
      source: 'test',
    })).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'AUDIT_WRITE_FAILED',
        status: 'failed',
        severity: 'error',
        correlation_id: 'WA-20260510153022-a8f3c2',
      }),
      '[integration-service][audit][AUDIT_WRITE_FAILED]',
    );

    errorSpy.mockRestore();
  });
});
