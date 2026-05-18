import { describe, expect, it, vi } from 'vitest';

import { BusinessHoursService } from '../src/domain/services/BusinessHoursService.js';
import type { MessageFlowRepository } from '../src/repositories/contracts/MessageFlowRepository.js';

function repository(overrides: Partial<MessageFlowRepository>): MessageFlowRepository {
  return {
    findMessageByEventKey: vi.fn().mockResolvedValue(null),
    findBusinessHoursConfig: vi.fn().mockResolvedValue(null),
    findLastAutomationEvent: vi.fn().mockResolvedValue(null),
    recordAutomationEvent: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('BusinessHoursService', () => {
  it('fails open when business hours are disabled by default', async () => {
    const service = new BusinessHoursService(repository({}), () => new Date('2026-05-17T02:00:00-03:00'));

    await expect(service.evaluate()).resolves.toEqual(expect.objectContaining({
      enabled: false,
      isOpen: true,
      eventKey: 'outside_business_hours_message',
    }));
  });

  it('detects closed time outside the configured weekday window', async () => {
    const service = new BusinessHoursService(repository({
      findBusinessHoursConfig: vi.fn().mockResolvedValue({
        enabled: true,
        timezone: 'America/Sao_Paulo',
        weekdayStart: '08:00',
        weekdayEnd: '18:00',
        saturdayEnabled: false,
        saturdayStart: null,
        saturdayEnd: null,
        sundayEnabled: false,
        sundayStart: null,
        sundayEnd: null,
        holidayBehavior: 'normal',
        eventKey: 'outside_business_hours_message',
        cooldownMinutes: 60,
      }),
    }), () => new Date('2026-05-18T20:00:00-03:00'));

    await expect(service.evaluate()).resolves.toEqual(expect.objectContaining({
      enabled: true,
      isOpen: false,
      reason: 'outside_time_window',
    }));
  });

  it('applies cooldown by conversation or phone before sending another outside-hours message', async () => {
    const findLastAutomationEvent = vi.fn().mockResolvedValue(new Date('2026-05-18T22:30:00.000Z'));
    const service = new BusinessHoursService(repository({ findLastAutomationEvent }), () => new Date('2026-05-18T23:00:00.000Z'));

    await expect(service.shouldSendOutsideHoursMessage(
      'conversation-1',
      '+5511999999999',
      'outside_business_hours_message',
      60,
    )).resolves.toBe(false);
  });
});
