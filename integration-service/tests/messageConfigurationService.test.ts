import { describe, expect, it, vi } from 'vitest';

import { MessageConfigurationService } from '../src/domain/services/MessageConfigurationService.js';
import type { MessageFlowRepository } from '../src/repositories/contracts/MessageFlowRepository.js';

function repository(overrides: Partial<MessageFlowRepository>): MessageFlowRepository {
  return {
    findMessageByEventKey: vi.fn().mockResolvedValue(null),
    findBusinessHoursConfig: vi.fn().mockResolvedValue(null),
    findLastAutomationEvent: vi.fn().mockResolvedValue(null),
    recordAutomationEvent: vi.fn().mockResolvedValue(undefined),
    recordInactivityJobEvent: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('MessageConfigurationService', () => {
  it('falls back to safe defaults when the catalog row is missing', async () => {
    const service = new MessageConfigurationService(repository({}));

    const plan = await service.resolveSendPlan('inactivity_reminder_1', { windowOpen: true });

    expect(plan.shouldSend).toBe(true);
    expect(plan.text).toContain('aguardando seu retorno');
    expect(plan.sendType).toBe('text');
  });

  it('uses custom catalog text without logging or requiring a Meta template inside 24h', async () => {
    const service = new MessageConfigurationService(repository({
      findMessageByEventKey: vi.fn().mockResolvedValue({
        eventKey: 'outside_business_hours_message',
        description: 'Fora do horário',
        groupName: 'Horário Comercial',
        defaultText: 'Default',
        customText: 'Customizado',
        isActive: true,
        sendType: 'text',
        language: 'pt_BR',
        fallbackText: null,
        templateName: null,
        buttons: [],
        listOptions: [],
        expectsResponse: false,
        updatedAt: null,
        updatedBy: null,
      }),
    }));

    const plan = await service.resolveSendPlan('outside_business_hours_message', { windowOpen: true });

    expect(plan).toEqual(expect.objectContaining({
      shouldSend: true,
      text: 'Customizado',
      reason: null,
    }));
  });

  it('blocks free text outside the WhatsApp 24h window when no template send is allowed', async () => {
    const service = new MessageConfigurationService(repository({
      findMessageByEventKey: vi.fn().mockResolvedValue({
        eventKey: 'inactivity_reminder_1',
        description: 'Reminder',
        groupName: 'Avisos',
        defaultText: 'Reminder',
        customText: null,
        isActive: true,
        sendType: 'text',
        language: 'pt_BR',
        fallbackText: null,
        templateName: null,
        buttons: [],
        listOptions: [],
        expectsResponse: true,
        updatedAt: null,
        updatedBy: null,
      }),
    }));

    const plan = await service.resolveSendPlan('inactivity_reminder_1', { windowOpen: false });

    expect(plan.shouldSend).toBe(false);
    expect(plan.reason).toBe('skipped_missing_template_outside_24h');
  });

  it('allows active local templates outside the WhatsApp 24h window', async () => {
    const service = new MessageConfigurationService(repository({
      findMessageByEventKey: vi.fn().mockResolvedValue({
        eventKey: 'inactivity_reminder_1',
        description: 'Reminder',
        groupName: 'Avisos',
        defaultText: 'Reminder',
        customText: null,
        isActive: true,
        sendType: 'template',
        language: 'pt_BR',
        fallbackText: null,
        templateName: 'integaglpi_inactivity_reminder',
        buttons: [],
        listOptions: [],
        expectsResponse: true,
        updatedAt: null,
        updatedBy: null,
      }),
    }));

    const plan = await service.resolveSendPlan('inactivity_reminder_1', {
      windowOpen: false,
      allowTemplateSend: true,
    });

    expect(plan.shouldSend).toBe(true);
    expect(plan.sendType).toBe('template');
    expect(plan.templateName).toBe('integaglpi_inactivity_reminder');
  });

  it('provides safe defaults for reopen reason flow events', async () => {
    const service = new MessageConfigurationService(repository({}));

    await expect(service.getMessage('reopen_reason_prompt')).resolves.toMatchObject({
      defaultText: 'Qual o motivo da reabertura?',
      expectsResponse: true,
    });
    await expect(service.getMessage('reopen_reason_problem_persists')).resolves.toMatchObject({
      defaultText: 'O problema permanece',
    });
    await expect(service.getMessage('solution_reopened_confirmation')).resolves.toMatchObject({
      defaultText: 'Seu chamado #{ticket_id} foi reaberto com sucesso.',
    });
  });

  it('provides a configurable profile collection reminder default', async () => {
    const service = new MessageConfigurationService(repository({}));

    await expect(service.getMessage('profile_collection_reminder')).resolves.toMatchObject({
      groupName: 'Coleta de Perfil',
      expectsResponse: true,
      defaultText: expect.stringContaining('perguntas pendentes'),
    });
  });

  it('records automation events through the repository', async () => {
    const recordAutomationEvent = vi.fn().mockResolvedValue(undefined);
    const service = new MessageConfigurationService(repository({ recordAutomationEvent }));

    await service.recordAutomationEvent({
      conversationId: 'conversation-1',
      phoneE164: '+5511999999999',
      eventKey: 'outside_business_hours_message',
      status: 'sent',
      messageId: 'wamid.test',
    });

    expect(recordAutomationEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventKey: 'outside_business_hours_message',
      status: 'sent',
    }));
  });

  it('records inactivity diagnostics through the repository', async () => {
    const recordInactivityJobEvent = vi.fn().mockResolvedValue(undefined);
    const service = new MessageConfigurationService(repository({ recordInactivityJobEvent }));

    await service.recordInactivityJobEvent({
      conversationId: 'conversation-1',
      phoneE164: '+5511999999999',
      eventKey: 'inactivity_reminder_1',
      status: 'skipped',
      reason: 'skipped_missing_template_outside_24h',
    });

    expect(recordInactivityJobEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventKey: 'inactivity_reminder_1',
      status: 'skipped',
      reason: 'skipped_missing_template_outside_24h',
    }));
  });
});
