import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SettingsRepository } from '../src/domain/repositories/SettingsRepository.js';
import { clearScheduleCacheForTests, ScheduleService } from '../src/domain/services/ScheduleService.js';

class FakeSettingsRepository implements SettingsRepository {
  public findBusinessHoursSettings = vi.fn<() => Promise<Map<string, unknown>>>();
  public findMessageSettings = vi.fn<() => Promise<Map<string, string>>>();

  public constructor(settings: Map<string, unknown>) {
    this.findBusinessHoursSettings.mockResolvedValue(settings);
    this.findMessageSettings.mockResolvedValue(new Map());
  }
}

describe('ScheduleService', () => {
  beforeEach(() => {
    clearScheduleCacheForTests();
  });

  it('keeps the service open when business hours are disabled', async () => {
    const repository = new FakeSettingsRepository(new Map<string, unknown>([
      ['hours_enabled', '0'],
    ]));
    const service = new ScheduleService(repository, () => new Date('2026-04-26T03:00:00.000Z'));

    await expect(service.isOpen()).resolves.toBe(true);
  });

  it('returns true during configured business hours in the configured timezone', async () => {
    const repository = new FakeSettingsRepository(new Map<string, unknown>([
      ['hours_enabled', '1'],
      ['business_days', '[1,2,3,4,5]'],
      ['start_time', '08:00'],
      ['end_time', '18:00'],
      ['timezone', 'America/Sao_Paulo'],
    ]));
    const service = new ScheduleService(repository, () => new Date('2026-04-27T13:00:00.000Z'));

    await expect(service.isOpen()).resolves.toBe(true);
  });

  it('returns false outside configured business days', async () => {
    const repository = new FakeSettingsRepository(new Map<string, unknown>([
      ['hours_enabled', '1'],
      ['business_days', '[1,2,3,4,5]'],
      ['start_time', '08:00'],
      ['end_time', '18:00'],
      ['timezone', 'America/Sao_Paulo'],
    ]));
    const service = new ScheduleService(repository, () => new Date('2026-04-26T13:00:00.000Z'));

    await expect(service.isOpen()).resolves.toBe(false);
  });

  it('returns false outside configured business hours', async () => {
    const repository = new FakeSettingsRepository(new Map<string, unknown>([
      ['hours_enabled', '1'],
      ['business_days', '[1,2,3,4,5]'],
      ['start_time', '08:00'],
      ['end_time', '18:00'],
      ['timezone', 'America/Sao_Paulo'],
    ]));
    const service = new ScheduleService(repository, () => new Date('2026-04-27T22:00:00.000Z'));

    await expect(service.isOpen()).resolves.toBe(false);
  });

  it('falls back safely when timezone is invalid', async () => {
    const repository = new FakeSettingsRepository(new Map<string, unknown>([
      ['hours_enabled', '1'],
      ['business_days', '[1,2,3,4,5]'],
      ['start_time', '08:00'],
      ['end_time', '18:00'],
      ['timezone', 'Invalid/Timezone'],
    ]));
    const service = new ScheduleService(repository, () => new Date('2026-04-27T13:00:00.000Z'));

    await expect(service.isOpen()).resolves.toBe(true);
  });

  it('rate limits after-hours messages by phone', () => {
    const repository = new FakeSettingsRepository(new Map());
    const service = new ScheduleService(repository);

    expect(service.shouldSendAfterHoursMessage('+5511999999999')).toBe(true);
    expect(service.shouldSendAfterHoursMessage('+5511999999999')).toBe(false);
    expect(service.shouldSendAfterHoursMessage('+5511888888888')).toBe(true);
  });
});
