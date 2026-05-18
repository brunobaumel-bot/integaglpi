import { describe, expect, it, vi } from 'vitest';

import {
  decideInactivityAction,
  InactivityAutomationService,
  parseReminderMinutes,
  type InactivityConfig,
} from '../src/domain/services/InactivityAutomationService.js';
import type { InactivityTrackingRecord, InactivityTrackingRepository } from '../src/repositories/contracts/InactivityTrackingRepository.js';

const baseNow = new Date('2026-05-15T15:00:00.000Z');

function minutesAgo(minutes: number): Date {
  return new Date(baseNow.getTime() - minutes * 60_000);
}

function makeRecord(overrides: Partial<InactivityTrackingRecord> = {}): InactivityTrackingRecord {
  return {
    conversationId: 'conv-1',
    ticketId: 123,
    conversationStatus: 'open',
    phoneE164: '+5511999999999',
    status: 'pending',
    reminder1SentAt: null,
    reminder2SentAt: null,
    reminder3SentAt: null,
    autocloseAttemptedAt: null,
    autocloseCompletedAt: null,
    lastClientActivityAt: minutesAgo(40),
    lastOutboundActivityAt: minutesAgo(4),
    manualHoldUntil: null,
    manualHoldReason: null,
    skipReason: null,
    updatedAt: minutesAgo(4),
    ...overrides,
  };
}

const config: InactivityConfig = {
  enabled: true,
  reminderMinutes: [3, 5, 10],
  autocloseMinutes: 30,
  jobIntervalSeconds: 60,
};

class FakeRepository implements InactivityTrackingRepository {
  public records = new Map<string, InactivityTrackingRecord>();
  public reminders: Array<{ conversationId: string; reminderNumber: 1 | 2 | 3 }> = [];
  public skipped: Array<{ conversationId: string; status: string; reason: string }> = [];
  public failed: Array<{ conversationId: string; reason: string }> = [];
  public autocloseAttempted: string[] = [];
  public autocloseCompleted: string[] = [];

  public async trackOutboundActivity(): Promise<void> {}

  public async findDueCandidates(): Promise<InactivityTrackingRecord[]> {
    return [...this.records.values()];
  }

  public async findByConversationId(conversationId: string): Promise<InactivityTrackingRecord | null> {
    return this.records.get(conversationId) ?? null;
  }

  public async markReminderSent(conversationId: string, reminderNumber: 1 | 2 | 3, sentAt: Date): Promise<void> {
    this.reminders.push({ conversationId, reminderNumber });
    const record = this.records.get(conversationId);
    if (record) {
      this.records.set(conversationId, {
        ...record,
        status: `reminder_${reminderNumber}_sent` as InactivityTrackingRecord['status'],
        [`reminder${reminderNumber}SentAt`]: sentAt,
      });
    }
  }

  public async tryMarkAutocloseAttempted(conversationId: string): Promise<boolean> {
    const record = this.records.get(conversationId);
    if (!record || record.autocloseAttemptedAt || record.autocloseCompletedAt) {
      return false;
    }
    this.autocloseAttempted.push(conversationId);
    this.records.set(conversationId, {
      ...record,
      autocloseAttemptedAt: baseNow,
    });
    return true;
  }

  public async markAutocloseCompleted(conversationId: string): Promise<void> {
    this.autocloseCompleted.push(conversationId);
    const record = this.records.get(conversationId);
    if (record) {
      this.records.set(conversationId, {
        ...record,
        status: 'autoclose_done',
        autocloseCompletedAt: baseNow,
      });
    }
  }

  public async markSkipped(conversationId: string, status: InactivityTrackingRecord['status'], reason: string): Promise<void> {
    this.skipped.push({ conversationId, status, reason });
  }

  public async markFailed(conversationId: string, reason: string): Promise<void> {
    this.failed.push({ conversationId, reason });
    const record = this.records.get(conversationId);
    if (record) {
      this.records.set(conversationId, {
        ...record,
        status: 'failed',
        skipReason: reason,
      });
    }
  }

  public async setManualHold(): Promise<void> {}
}

function createService(
  record: InactivityTrackingRecord,
  serviceConfig: InactivityConfig = config,
  messageConfigurationService: unknown = null,
) {
  const repository = new FakeRepository();
  repository.records.set(record.conversationId, record);
  const outbound = {
    send: vi.fn().mockResolvedValue({
      httpStatus: 201,
      body: {
        status: 'sent',
        message_id: 'wamid.reminder',
        conversation_id: record.conversationId,
        postgres_message_row_id: 'row-1',
        idempotent: false,
      },
    }),
  };
  const glpiClient = {
    getTicketStatus: vi.fn().mockResolvedValue('open'),
    solveTicketByInactivity: vi.fn().mockResolvedValue(undefined),
  };
  const auditService = {
    recordAuditEventFireAndForget: vi.fn(),
  };
  const service = new InactivityAutomationService(
    repository,
    outbound,
    glpiClient,
    auditService,
    serviceConfig,
    () => baseNow,
    messageConfigurationService as never,
  );

  return { service, repository, outbound, glpiClient, auditService };
}

describe('decideInactivityAction', () => {
  it('does nothing when feature flag is disabled', () => {
    expect(decideInactivityAction(makeRecord(), { ...config, enabled: false }, baseNow)).toEqual({
      action: 'SKIP',
      reason: 'feature_flag_disabled',
    });
  });

  it('schedules reminders and autoclose only when due and safe', () => {
    expect(decideInactivityAction(makeRecord({ lastOutboundActivityAt: minutesAgo(4) }), config, baseNow).action)
      .toBe('SEND_REMINDER_1');
    expect(decideInactivityAction(makeRecord({
      lastOutboundActivityAt: minutesAgo(6),
      reminder1SentAt: minutesAgo(3),
      status: 'reminder_1_sent',
    }), config, baseNow).action).toBe('SEND_REMINDER_2');
    expect(decideInactivityAction(makeRecord({
      lastOutboundActivityAt: minutesAgo(11),
      reminder1SentAt: minutesAgo(8),
      reminder2SentAt: minutesAgo(5),
      status: 'reminder_2_sent',
    }), config, baseNow).action).toBe('SEND_REMINDER_3');
    expect(decideInactivityAction(makeRecord({
      lastOutboundActivityAt: minutesAgo(31),
      reminder1SentAt: minutesAgo(28),
      reminder2SentAt: minutesAgo(25),
      reminder3SentAt: minutesAgo(20),
      status: 'reminder_3_sent',
    }), config, baseNow).action).toBe('AUTO_CLOSE');
  });

  it('skips when client answered, ticket conversation is closed, or manual hold is active', () => {
    expect(decideInactivityAction(makeRecord({ lastClientActivityAt: minutesAgo(1) }), config, baseNow)).toMatchObject({
      action: 'SKIP',
      reason: 'client_responded',
    });
    expect(decideInactivityAction(makeRecord({ conversationStatus: 'closed' }), config, baseNow)).toMatchObject({
      action: 'SKIP',
      reason: 'conversation_not_open',
    });
    expect(decideInactivityAction(makeRecord({ manualHoldUntil: new Date(baseNow.getTime() + 60_000) }), config, baseNow))
      .toMatchObject({ action: 'SKIP', reason: 'manual_hold' });
  });

  it('uses safe defaults for invalid reminder config', () => {
    expect(parseReminderMinutes('10,3,abc')).toEqual([3, 5, 10]);
    expect(parseReminderMinutes('3,5,10')).toEqual([3, 5, 10]);
  });
});

describe('InactivityAutomationService', () => {
  it('records a diagnostic cycle when the feature flag is disabled', async () => {
    const messageConfigurationService = {
      recordInactivityJobEvent: vi.fn().mockResolvedValue(undefined),
    };
    const { service, outbound } = createService(
      makeRecord({ lastOutboundActivityAt: minutesAgo(4) }),
      { ...config, enabled: false },
      messageConfigurationService,
    );

    await service.runOnce();

    expect(outbound.send).not.toHaveBeenCalled();
    expect(messageConfigurationService.recordInactivityJobEvent).toHaveBeenCalledWith(expect.objectContaining({
      status: 'checked',
      reason: 'feature_flag_disabled',
      checkedCount: 0,
    }));
  });

  it('records a non-silent diagnostic cycle when there are no candidates', async () => {
    const messageConfigurationService = {
      recordInactivityJobEvent: vi.fn().mockResolvedValue(undefined),
    };
    const repository = new FakeRepository();
    const outbound = { send: vi.fn() };
    const glpiClient = {
      getTicketStatus: vi.fn(),
      solveTicketByInactivity: vi.fn(),
    };
    const service = new InactivityAutomationService(
      repository,
      outbound as never,
      glpiClient as never,
      null,
      config,
      () => baseNow,
      messageConfigurationService as never,
    );

    await service.runOnce();

    expect(outbound.send).not.toHaveBeenCalled();
    expect(messageConfigurationService.recordInactivityJobEvent).toHaveBeenCalledWith(expect.objectContaining({
      status: 'checked',
      reason: 'no_eligible_candidates',
      checkedCount: 0,
    }));
  });

  it('sends reminder once through outbound idempotency key', async () => {
    const { service, repository, outbound } = createService(makeRecord({ lastOutboundActivityAt: minutesAgo(4) }));

    await service.runOnce();

    expect(outbound.send).toHaveBeenCalledTimes(1);
    expect(outbound.send).toHaveBeenCalledWith(expect.objectContaining({
      idempotency_key: 'inactivity:reminder_1:conv-1:123',
    }), expect.any(Object));
    expect(repository.reminders).toEqual([{ conversationId: 'conv-1', reminderNumber: 1 }]);
  });

  it('does not send free text outside 24h without a template and records the skip reason', async () => {
    const messageConfigurationService = {
      resolveSendPlan: vi.fn().mockResolvedValue({
        eventKey: 'inactivity_reminder_1',
        sendType: 'text',
        text: 'Nao enviar fora da janela',
        active: true,
        shouldSend: false,
        reason: 'skipped_missing_template_outside_24h',
        templateName: null,
        language: 'pt_BR',
        buttons: [],
        listOptions: [],
      }),
      recordAutomationEvent: vi.fn().mockResolvedValue(undefined),
      recordInactivityJobEvent: vi.fn().mockResolvedValue(undefined),
    };
    const { service, repository, outbound } = createService(
      makeRecord({
        lastClientActivityAt: minutesAgo(25 * 60),
        lastOutboundActivityAt: minutesAgo(4),
      }),
      config,
      messageConfigurationService,
    );

    await service.runOnce();

    expect(outbound.send).not.toHaveBeenCalled();
    expect(repository.failed).toEqual([{
      conversationId: 'conv-1',
      reason: 'skipped_missing_template_outside_24h',
    }]);
    expect(messageConfigurationService.recordInactivityJobEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventKey: 'inactivity_reminder_1',
      status: 'skipped',
      reason: 'skipped_missing_template_outside_24h',
    }));
  });

  it('uses a configured template outside 24h when available', async () => {
    const messageConfigurationService = {
      resolveSendPlan: vi.fn().mockResolvedValue({
        eventKey: 'inactivity_reminder_1',
        sendType: 'template',
        text: 'Template preview',
        active: true,
        shouldSend: true,
        reason: null,
        templateName: 'integaglpi_inactivity_reminder',
        language: 'pt_BR',
        buttons: [],
        listOptions: [],
      }),
      recordAutomationEvent: vi.fn().mockResolvedValue(undefined),
      recordInactivityJobEvent: vi.fn().mockResolvedValue(undefined),
    };
    const { service, outbound } = createService(
      makeRecord({
        lastClientActivityAt: minutesAgo(25 * 60),
        lastOutboundActivityAt: minutesAgo(4),
      }),
      config,
      messageConfigurationService,
    );

    await service.runOnce();

    expect(outbound.send).toHaveBeenCalledWith(expect.objectContaining({
      message_type: 'template',
      template_name: 'integaglpi_inactivity_reminder',
      idempotency_key: 'inactivity:reminder_1:conv-1:123',
    }), expect.any(Object));
  });

  it('does not send duplicate reminder on second execution after sent marker', async () => {
    const { service, repository, outbound } = createService(makeRecord({ lastOutboundActivityAt: minutesAgo(4) }));

    await service.runOnce();
    await service.runOnce();

    expect(outbound.send).toHaveBeenCalledTimes(1);
    expect(repository.reminders).toHaveLength(1);
  });

  it('cancels later actions when client replied', async () => {
    const { service, repository, outbound } = createService(makeRecord({
      lastOutboundActivityAt: minutesAgo(31),
      lastClientActivityAt: minutesAgo(1),
      reminder1SentAt: minutesAgo(28),
      reminder2SentAt: minutesAgo(25),
      reminder3SentAt: minutesAgo(20),
    }));

    await service.runOnce();

    expect(outbound.send).not.toHaveBeenCalled();
    expect(repository.skipped).toEqual([{ conversationId: 'conv-1', status: 'skipped_by_response', reason: 'client_responded' }]);
  });

  it('does not act while manual hold is active', async () => {
    const { service, repository, outbound } = createService(makeRecord({
      manualHoldUntil: new Date(baseNow.getTime() + 60_000),
      lastOutboundActivityAt: minutesAgo(31),
    }));

    await service.runOnce();

    expect(outbound.send).not.toHaveBeenCalled();
    expect(repository.skipped).toEqual([{ conversationId: 'conv-1', status: 'skipped_by_hold', reason: 'manual_hold' }]);
  });

  it('solves ticket once after all reminders and final timeout', async () => {
    const { service, repository, glpiClient, outbound } = createService(makeRecord({
      lastOutboundActivityAt: minutesAgo(31),
      reminder1SentAt: minutesAgo(28),
      reminder2SentAt: minutesAgo(25),
      reminder3SentAt: minutesAgo(20),
      status: 'reminder_3_sent',
    }));

    await service.runOnce();

    expect(outbound.send).toHaveBeenCalledWith(expect.objectContaining({
      text: 'Este atendimento poderá ser encerrado automaticamente se não houver resposta.',
      idempotency_key: 'inactivity:autoclose_warning:conv-1:123',
    }), expect.any(Object));
    expect(outbound.send).toHaveBeenCalledWith(expect.objectContaining({
      text: 'Como não tivemos retorno, estamos encerrando este atendimento por falta de resposta. Se precisar, basta nos chamar novamente.',
      idempotency_key: 'inactivity:autoclose_notice:conv-1:123',
    }), expect.any(Object));
    expect(glpiClient.solveTicketByInactivity).toHaveBeenCalledWith(
      123,
      expect.stringContaining('Encerrado por falta de retorno do usuário'),
    );
    expect(repository.autocloseCompleted).toEqual(['conv-1']);
  });

  it('does not retry autoclose after GLPI solve failure', async () => {
    const { service, repository, glpiClient, outbound } = createService(makeRecord({
      lastOutboundActivityAt: minutesAgo(31),
      reminder1SentAt: minutesAgo(28),
      reminder2SentAt: minutesAgo(25),
      reminder3SentAt: minutesAgo(20),
      status: 'reminder_3_sent',
    }));
    glpiClient.solveTicketByInactivity.mockRejectedValue(new Error('GLPI refused status transition'));

    await service.runOnce();
    await service.runOnce();

    expect(outbound.send).toHaveBeenCalledTimes(2);
    expect(glpiClient.solveTicketByInactivity).toHaveBeenCalledTimes(1);
    expect(repository.failed).toEqual([{
      conversationId: 'conv-1',
      reason: 'GLPI refused status transition',
    }]);
  });

  it('does not send autoclose notice when an autoclose attempt already exists', async () => {
    const { service, repository, outbound, glpiClient } = createService(makeRecord({
      lastOutboundActivityAt: minutesAgo(31),
      reminder1SentAt: minutesAgo(28),
      reminder2SentAt: minutesAgo(25),
      reminder3SentAt: minutesAgo(20),
      autocloseAttemptedAt: minutesAgo(1),
      status: 'reminder_3_sent',
    }));

    await service.runOnce();

    expect(outbound.send).not.toHaveBeenCalled();
    expect(glpiClient.solveTicketByInactivity).not.toHaveBeenCalled();
    expect(repository.autocloseCompleted).toEqual([]);
  });

  it('skips closed or solved tickets before reminder/autoclose', async () => {
    const { service, repository, outbound, glpiClient } = createService(makeRecord({ lastOutboundActivityAt: minutesAgo(4) }));
    glpiClient.getTicketStatus.mockResolvedValue('closed');

    await service.runOnce();

    expect(outbound.send).not.toHaveBeenCalled();
    expect(repository.skipped).toEqual([{
      conversationId: 'conv-1',
      status: 'skipped_by_closed_ticket',
      reason: 'ticket_closed_or_solved',
    }]);
  });
});
