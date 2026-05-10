import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SettingsRepository } from '../src/domain/repositories/SettingsRepository.js';
import { clearSettingsCacheForTests, SettingsService } from '../src/domain/services/SettingsService.js';
import { logger } from '../src/infra/logger/logger.js';

class FakeSettingsRepository implements SettingsRepository {
  public findBusinessHoursSettings = vi.fn<() => Promise<Map<string, unknown>>>();
  public findMessageSettings = vi.fn<() => Promise<Map<string, string>>>();

  public constructor(settings: Map<string, string>) {
    this.findBusinessHoursSettings.mockResolvedValue(new Map());
    this.findMessageSettings.mockResolvedValue(settings);
  }
}

describe('SettingsService', () => {
  beforeEach(() => {
    clearSettingsCacheForTests();
    vi.restoreAllMocks();
  });

  it('uses the cache on hit without reloading the repository', async () => {
    const debugSpy = vi.spyOn(logger, 'debug').mockImplementation(() => undefined);
    const repository = new FakeSettingsRepository(new Map<string, string>([
      ['menu_message', '  Menu configurado  '],
    ]));
    const service = new SettingsService(repository);

    await expect(service.getMessage('menu_message')).resolves.toBe('Menu configurado');
    await expect(service.getMessage('menu_message')).resolves.toBe('Menu configurado');

    expect(repository.findMessageSettings).toHaveBeenCalledTimes(1);
    expect(debugSpy).toHaveBeenCalledWith(
      expect.objectContaining({ ttl_remaining_ms: expect.any(Number) }),
      '[config][CACHE_HIT]',
    );
  });

  it('falls back when the key is missing', async () => {
    const repository = new FakeSettingsRepository(new Map<string, string>());
    const service = new SettingsService(repository);

    await expect(service.getMessage('after_hours_message')).resolves.toBe(
      'Estamos fora do horário. Retornamos amanhã.',
    );
  });

  it('falls back when the configured value is empty after trim', async () => {
    const repository = new FakeSettingsRepository(new Map<string, string>([
      ['invalid_option_message', '   '],
    ]));
    const service = new SettingsService(repository);

    await expect(service.getMessage('invalid_option_message')).resolves.toBe(
      'Não entendi sua opção. Por favor, escolha uma das opções abaixo:',
    );
  });

  it('formats ticket placeholders for global messages', async () => {
    const repository = new FakeSettingsRepository(new Map<string, string>([
      ['ticket_created_message', 'Chamado {ticket_id} criado'],
    ]));
    const service = new SettingsService(repository);

    await expect(service.formatMessage('ticket_created_message', { ticketId: 123 })).resolves.toBe(
      'Chamado 123 criado',
    );
  });
});
