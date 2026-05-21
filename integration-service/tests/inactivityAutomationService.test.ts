import { describe, expect, it, vi } from 'vitest';

import {
  decideInactivityAction,
  InactivityAutomationService,
  parseReminderMinutes,
  type InactivityConfig,
} from '../src/domain/services/InactivityAutomationService.js';
import type {
  InactivityTrackingRecord,
  InactivityTrackingRepository,
  ProfileCollectionReminderCandidate,
} from '../src/repositories/contracts/InactivityTrackingRepository.js';

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
    lastClientActivityAt: minutesAgo(200),
    lastOutboundActivityAt: minutesAgo(124),
    manualHoldUntil: null,
    manualHoldReason: null,
    skipReason: null,
    updatedAt: minutesAgo(124),
    ...overrides,
  };
}

const config: InactivityConfig = {
  enabled: true,
  reminderMinutes: [15, 20, 25],
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
  public profileReminderCandidates: ProfileCollectionReminderCandidate[] = [];
  public profileRemindersMarked: Array<{ conversationId: string; step: string; sentAt: Date }> = [];
  public profileReminderMarkResult = true;

  public async trackOutboundActivity(): Promise<void> {}

  public async findDueCandidates(): Promise<InactivityTrackingRecord[]> {
    return [...this.records.values()];
  }

  public async findProfileCollectionReminderCandidates(): Promise<ProfileCollectionReminderCandidate[]> {
    return this.profileReminderCandidates;
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

  public async markProfileCollectionReminderSent(
    conversationId: string,
    step: string,
    sentAt: Date,
  ): Promise<boolean> {
    this.profileRemindersMarked.push({ conversationId, step, sentAt });
    return this.profileReminderMarkResult;
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
  configProvider: (() => Promise<{ enabled?: boolean | null; reminderMinutes?: [number, number, number] | null; autocloseMinutes?: number | null }>) | null = null,
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
    sendProfileCollectionReminder: vi.fn(),
  };
  const glpiClient = {
    getTicketStatus: vi.fn().mockResolvedValue('open'),
    getTicket: vi.fn().mockResolvedValue({ id: record.ticketId ?? 123, status: 2, entitiesId: 1 }),
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
    configProvider,
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
    expect(decideInactivityAction(makeRecord({ lastOutboundActivityAt: minutesAgo(124) }), config, baseNow).action)
      .toBe('SEND_REMINDER_1');
    expect(decideInactivityAction(makeRecord({
      lastOutboundActivityAt: minutesAgo(126),
      reminder1SentAt: minutesAgo(3),
      status: 'reminder_1_sent',
    }), config, baseNow).action).toBe('SEND_REMINDER_2');
    expect(decideInactivityAction(makeRecord({
      lastOutboundActivityAt: minutesAgo(131),
      reminder1SentAt: minutesAgo(8),
      reminder2SentAt: minutesAgo(5),
      status: 'reminder_2_sent',
    }), config, baseNow).action).toBe('SEND_REMINDER_3');
    expect(decideInactivityAction(makeRecord({
      lastOutboundActivityAt: minutesAgo(151),
      reminder1SentAt: minutesAgo(28),
      reminder2SentAt: minutesAgo(25),
      reminder3SentAt: minutesAgo(20),
      status: 'reminder_3_sent',
    }), config, baseNow).action).toBe('AUTO_CLOSE');
  });

  it('does not send reminders while technician activity is recent', () => {
    expect(decideInactivityAction(makeRecord({ lastOutboundActivityAt: minutesAgo(10) }), config, baseNow))
      .toMatchObject({
        action: 'NOOP',
        reason: 'technician_activity_recent',
      });
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
    expect(parseReminderMinutes('10,3,abc')).toEqual([15, 20, 25]);
    expect(parseReminderMinutes('3,5,10')).toEqual([3, 5, 10]);
  });
});

describe('InactivityAutomationService', () => {
  it('records a diagnostic cycle when the feature flag is disabled', async () => {
    const messageConfigurationService = {
      recordInactivityJobEvent: vi.fn().mockResolvedValue(undefined),
    };
    const { service, outbound } = createService(
      makeRecord({ lastOutboundActivityAt: minutesAgo(124) }),
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
    const { service, repository, outbound } = createService(makeRecord({ lastOutboundActivityAt: minutesAgo(124) }));

    await service.runOnce();

    expect(outbound.send).toHaveBeenCalledTimes(1);
    expect(outbound.send).toHaveBeenCalledWith(expect.objectContaining({
      idempotency_key: 'inactivity:reminder_1:conv-1:123',
    }), expect.any(Object));
    expect(repository.reminders).toEqual([{ conversationId: 'conv-1', reminderNumber: 1 }]);
  });

  it('does not send a reminder before the first configured timer', async () => {
    const messageConfigurationService = {
      recordInactivityJobEvent: vi.fn().mockResolvedValue(undefined),
    };
    const { service, repository, outbound } = createService(
      makeRecord({ lastOutboundActivityAt: minutesAgo(10) }),
      config,
      messageConfigurationService,
    );

    await service.runOnce();

    expect(outbound.send).not.toHaveBeenCalled();
    expect(repository.reminders).toEqual([]);
    expect(messageConfigurationService.recordInactivityJobEvent).toHaveBeenCalledWith(expect.objectContaining({
      status: 'skipped',
      reason: 'technician_activity_recent',
    }));
  });

  it('uses runtime timers persisted in settings to send an eligible reminder', async () => {
    const { service, repository, outbound } = createService(
      makeRecord({ lastOutboundActivityAt: minutesAgo(2) }),
      config,
      null,
      async () => ({ enabled: true, reminderMinutes: [1, 2, 3], autocloseMinutes: 5 }),
    );

    await service.runOnce();

    expect(outbound.send).toHaveBeenCalledTimes(1);
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
        lastOutboundActivityAt: minutesAgo(124),
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
        lastOutboundActivityAt: minutesAgo(124),
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
    const { service, repository, outbound } = createService(
      makeRecord({ lastOutboundActivityAt: minutesAgo(124) }),
      { ...config, reminderMinutes: [3, 200, 300], autocloseMinutes: 400 },
    );

    await service.runOnce();
    await service.runOnce();

    expect(outbound.send).toHaveBeenCalledTimes(1);
    expect(repository.reminders).toHaveLength(1);
  });

  it('cancels later actions when client replied', async () => {
    const { service, repository, outbound } = createService(makeRecord({
      lastOutboundActivityAt: minutesAgo(151),
      lastClientActivityAt: minutesAgo(1),
      reminder1SentAt: minutesAgo(28),
      reminder2SentAt: minutesAgo(25),
      reminder3SentAt: minutesAgo(20),
    }));

    await service.runOnce();

    expect(outbound.send).not.toHaveBeenCalled();
    expect(repository.skipped).toEqual([{ conversationId: 'conv-1', status: 'skipped_by_response', reason: 'recent_inbound' }]);
  });

  it('does not act while manual hold is active', async () => {
    const { service, repository, outbound } = createService(makeRecord({
      manualHoldUntil: new Date(baseNow.getTime() + 60_000),
      lastOutboundActivityAt: minutesAgo(151),
    }));

    await service.runOnce();

    expect(outbound.send).not.toHaveBeenCalled();
    expect(repository.skipped).toEqual([{ conversationId: 'conv-1', status: 'skipped_by_hold', reason: 'not_eligible_status' }]);
  });

  it('solves ticket once after all reminders and final timeout', async () => {
    const { service, repository, glpiClient, outbound } = createService(makeRecord({
      lastOutboundActivityAt: minutesAgo(151),
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

  it('does not autoclose GLPI tickets in pending status', async () => {
    const messageConfigurationService = {
      recordInactivityJobEvent: vi.fn().mockResolvedValue(undefined),
    };
    const { service, repository, glpiClient, outbound } = createService(
      makeRecord({
        lastOutboundActivityAt: minutesAgo(151),
        reminder1SentAt: minutesAgo(28),
        reminder2SentAt: minutesAgo(25),
        reminder3SentAt: minutesAgo(20),
        status: 'reminder_3_sent',
      }),
      config,
      messageConfigurationService,
    );
    glpiClient.getTicket.mockResolvedValue({ id: 123, status: 4, entitiesId: 1 });

    await service.runOnce();

    expect(outbound.send).not.toHaveBeenCalled();
    expect(glpiClient.solveTicketByInactivity).not.toHaveBeenCalled();
    expect(repository.autocloseCompleted).toEqual([]);
    expect(repository.skipped).toEqual([{
      conversationId: 'conv-1',
      status: 'skipped_by_hold',
      reason: 'glpi_ticket_pending',
    }]);
  });

  it('does not retry autoclose after GLPI solve failure', async () => {
    const { service, repository, glpiClient, outbound } = createService(makeRecord({
      lastOutboundActivityAt: minutesAgo(151),
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
      lastOutboundActivityAt: minutesAgo(151),
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
    const { service, repository, outbound, glpiClient } = createService(makeRecord({ lastOutboundActivityAt: minutesAgo(124) }));
    glpiClient.getTicketStatus.mockResolvedValue('closed');
    glpiClient.getTicket.mockResolvedValue({ id: 123, status: 5, entitiesId: 1 });

    await service.runOnce();

    expect(outbound.send).not.toHaveBeenCalled();
    expect(repository.skipped).toEqual([{
      conversationId: 'conv-1',
      status: 'skipped_by_closed_ticket',
      reason: 'not_eligible_status',
    }]);
  });

  it('sends one profile collection reminder after five minutes without creating a ticket', async () => {
    const repository = new FakeRepository();
    repository.profileReminderCandidates = [{
      conversationId: 'profile-conv-1',
      phoneE164: '+5511888887777',
      profileCollectionState: { step: 'asking_email', requester_name: 'Cliente' },
      lastMessageAt: minutesAgo(6),
      updatedAt: minutesAgo(6),
    }];
    const outbound = {
      send: vi.fn(),
      sendProfileCollectionReminder: vi.fn().mockResolvedValue({
        httpStatus: 201,
        body: {
          status: 'sent',
          message_id: 'wamid.profile.reminder',
          conversation_id: 'profile-conv-1',
          postgres_message_row_id: 'row-profile-1',
          idempotent: false,
        },
      }),
    };
    const glpiClient = {
      getTicketStatus: vi.fn(),
      solveTicketByInactivity: vi.fn(),
    };
    const messageConfigurationService = {
      resolveSendPlan: vi.fn().mockResolvedValue({
        eventKey: 'profile_collection_reminder',
        sendType: 'text',
        text: 'Ainda precisamos confirmar algumas informações para continuar seu atendimento.',
        active: true,
        shouldSend: true,
        reason: null,
        templateName: null,
        language: 'pt_BR',
        buttons: [],
        listOptions: [],
      }),
      recordAutomationEvent: vi.fn().mockResolvedValue(undefined),
      recordInactivityJobEvent: vi.fn().mockResolvedValue(undefined),
    };
    const auditService = { recordAuditEventFireAndForget: vi.fn() };
    const service = new InactivityAutomationService(
      repository,
      outbound as never,
      glpiClient as never,
      auditService as never,
      config,
      () => baseNow,
      messageConfigurationService as never,
    );

    await service.runOnce();

    expect(outbound.send).not.toHaveBeenCalled();
    expect(glpiClient.getTicketStatus).not.toHaveBeenCalled();
    expect(glpiClient.solveTicketByInactivity).not.toHaveBeenCalled();
    expect(repository.profileRemindersMarked).toHaveLength(1);
    expect(repository.profileRemindersMarked[0]).toMatchObject({
      conversationId: 'profile-conv-1',
      step: 'asking_email',
    });
    expect(outbound.sendProfileCollectionReminder).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'profile-conv-1',
      phoneE164: '+5511888887777',
      messageType: 'text',
      idempotencyKey: 'profile_collection_reminder:profile-conv-1:asking_email:2026-05-15T14:54:00.000Z',
    }), expect.objectContaining({ correlationId: expect.any(String) }));
    expect(messageConfigurationService.recordInactivityJobEvent).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'profile-conv-1',
      eventKey: 'profile_collection_reminder',
      status: 'sent',
      deliveryStatus: 'sent',
    }));
    expect(auditService.recordAuditEventFireAndForget).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'PROFILE_COLLECTION_REMINDER_SENT',
      ticketId: null,
      conversationId: 'profile-conv-1',
    }));
  });

  it('marks profile reminder cycle once and skips free text outside 24h without a template', async () => {
    const repository = new FakeRepository();
    repository.profileReminderCandidates = [{
      conversationId: 'profile-conv-2',
      phoneE164: '+5511777766666',
      profileCollectionState: { step: 'asking_reason' },
      lastMessageAt: minutesAgo(25 * 60),
      updatedAt: minutesAgo(25 * 60),
    }];
    const outbound = {
      send: vi.fn(),
      sendProfileCollectionReminder: vi.fn(),
    };
    const messageConfigurationService = {
      resolveSendPlan: vi.fn().mockResolvedValue({
        eventKey: 'profile_collection_reminder',
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
    const service = new InactivityAutomationService(
      repository,
      outbound,
      { getTicketStatus: vi.fn(), solveTicketByInactivity: vi.fn() } as never,
      null,
      config,
      () => baseNow,
      messageConfigurationService as never,
    );

    await service.runOnce();

    expect(repository.profileRemindersMarked).toHaveLength(1);
    expect(outbound.sendProfileCollectionReminder).not.toHaveBeenCalled();
    expect(messageConfigurationService.resolveSendPlan).toHaveBeenCalledWith('profile_collection_reminder', {
      windowOpen: false,
      allowTemplateSend: true,
    });
    expect(messageConfigurationService.recordInactivityJobEvent).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'profile-conv-2',
      eventKey: 'profile_collection_reminder',
      status: 'skipped',
      reason: 'skipped_missing_template_outside_24h',
    }));
  });
});
