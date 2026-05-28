import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SettingsRepository } from '../src/domain/repositories/SettingsRepository.js';
import { clearSettingsCacheForTests, SettingsService } from '../src/domain/services/SettingsService.js';
import { logger } from '../src/infra/logger/logger.js';

class FakeSettingsRepository implements SettingsRepository {
  public findBusinessHoursSettings = vi.fn<() => Promise<Map<string, unknown>>>();
  public findContactProfileSettings = vi.fn<() => Promise<Map<string, unknown>>>();
  public findEntityResolutionSettings = vi.fn<() => Promise<Map<string, unknown>>>();
  public findMessageSettings = vi.fn<() => Promise<Map<string, string>>>();

  public constructor(
    settings: Map<string, string>,
    contactProfileSettings: Map<string, unknown> = new Map(),
  ) {
    this.findBusinessHoursSettings.mockResolvedValue(new Map());
    this.findContactProfileSettings.mockResolvedValue(contactProfileSettings);
    this.findEntityResolutionSettings.mockResolvedValue(new Map());
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

  it('returns contact profile defaults when settings are missing', async () => {
    const repository = new FakeSettingsRepository(new Map<string, string>());
    const service = new SettingsService(repository);

    const config = await service.getContactProfileConfig();

    // Boolean fields
    expect(config).toMatchObject({
      collectionEnabled: false,
      promptMode: 'hybrid',
      requireCompany: true,
      requireName: true,
      requireEmail: true,   // absent key defaults to true (ask email — backward compat)
      requireEquipment: false,
      requireSummary: true,
      confirmationEnabled: true,
      useButtons: true,
      titleEnrichmentEnabled: true,
    });

    // Prompt text fields
    expect(config.promptName).toBe('Por favor, informe seu nome.');
    expect(config.promptCompany).toBe('Por favor, informe a empresa.');
    expect(config.promptEquipment).toBe('Informe o equipamento (opcional).');
    expect(config.promptSummary).toBe('Descreva resumidamente o problema.');
    expect(config.confirmMessage).toBe('Confirma as informações para abrir o chamado?');
    expect(config.promptEmail).toBe('Por favor, informe seu e-mail (ou responda "não informar").');
    expect(config.initialPrompt).toContain('Perfeito! Vou agilizar seu atendimento.');
  });

  it('parses booleans from mixed scalar values', async () => {
    const repository = new FakeSettingsRepository(
      new Map<string, string>(),
      new Map<string, unknown>([
        ['contact_profile_collection_enabled', '1'],
        ['contact_profile_require_company', 'false'],
        ['contact_profile_require_name', 1],
        ['contact_profile_require_equipment', '0'],
        ['contact_profile_require_summary', 0],
        ['contact_profile_confirmation_enabled', true],
        ['contact_profile_use_buttons', 'true'],
        ['ticket_title_enrichment_enabled', '0'],
      ]),
    );
    const service = new SettingsService(repository);

    await expect(service.getContactProfileConfig()).resolves.toMatchObject({
      collectionEnabled: true,
      requireCompany: false,
      requireName: true,
      requireEquipment: false,
      requireSummary: false,
      confirmationEnabled: true,
      useButtons: true,
      titleEnrichmentEnabled: false,
    });
  });

  it('normalizes contact profile boolean settings from plugin string variants', async () => {
    const repository = new FakeSettingsRepository(
      new Map<string, string>(),
      new Map<string, unknown>([
        ['contact_profile_collection_enabled', 'on'],
        ['contact_profile_require_company', 'yes'],
        ['contact_profile_require_name', 'true'],
        ['contact_profile_require_equipment', 'off'],
        ['contact_profile_require_summary', 'no'],
        ['contact_profile_confirmation_enabled', '1'],
        ['contact_profile_use_buttons', 0],
        ['ticket_title_enrichment_enabled', 'yes'],
      ]),
    );
    const service = new SettingsService(repository);

    await expect(service.getContactProfileConfig()).resolves.toMatchObject({
      collectionEnabled: true,
      requireCompany: true,
      requireName: true,
      requireEquipment: false,
      requireSummary: false,
      confirmationEnabled: true,
      useButtons: false,
      titleEnrichmentEnabled: true,
    });
  });

  it('falls back to safe defaults for invalid contact profile boolean settings', async () => {
    const repository = new FakeSettingsRepository(
      new Map<string, string>(),
      new Map<string, unknown>([
        ['contact_profile_collection_enabled', 'enabled'],
        ['ticket_title_enrichment_enabled', 'maybe'],
      ]),
    );
    const service = new SettingsService(repository);

    await expect(service.getContactProfileConfig()).resolves.toMatchObject({
      collectionEnabled: false,
      titleEnrichmentEnabled: true,
    });
  });

  it('loads prompts and confirm message while falling back on empty strings', async () => {
    const repository = new FakeSettingsRepository(
      new Map<string, string>(),
      new Map<string, unknown>([
        ['contact_profile_prompt_mode', 'single_message'],
        ['contact_profile_prompt_name', ' Nome personalizado '],
        ['contact_profile_prompt_company', '   '],
        ['contact_profile_prompt_equipment', 'Equipamento?'],
        ['contact_profile_prompt_summary', 'Resumo?'],
        ['contact_profile_confirm_message', ' Confirma? '],
      ]),
    );
    const service = new SettingsService(repository);

    await expect(service.getContactProfileConfig()).resolves.toMatchObject({
      promptMode: 'single_message',
      promptName: 'Nome personalizado',
      promptCompany: 'Por favor, informe a empresa.',
      promptEquipment: 'Equipamento?',
      promptSummary: 'Resumo?',
      confirmMessage: 'Confirma?',
    });
  });

  it('canonical contact_profile_prompt_* keys take priority over legacy profile_ask_* aliases', async () => {
    // Dual-key priority fix: contact_profile_prompt_* (UI-saved key) MUST win over
    // profile_ask_* (legacy key written by the sync service for backward compatibility).
    const repository = new FakeSettingsRepository(
      new Map<string, string>(),
      new Map<string, unknown>([
        ['contact_profile_prompt_name', 'Nome canonical?'],
        ['profile_ask_name', 'Nome legado?'],
        ['contact_profile_prompt_company', 'Empresa canonical?'],
        ['profile_ask_company', 'Empresa legada?'],
        ['contact_profile_prompt_equipment', 'Equipamento canonical?'],
        ['profile_ask_equipment', 'Equipamento legado?'],
        ['contact_profile_prompt_summary', 'Resumo canonical?'],
        ['profile_ask_summary', 'Resumo legado?'],
        ['contact_profile_confirm_message', 'Confirma canonical?'],
        ['profile_confirmation_message', 'Confirma legado?'],
      ]),
    );
    const service = new SettingsService(repository);

    await expect(service.getContactProfileConfig()).resolves.toMatchObject({
      promptName: 'Nome canonical?',
      promptCompany: 'Empresa canonical?',
      promptEquipment: 'Equipamento canonical?',
      promptSummary: 'Resumo canonical?',
      confirmMessage: 'Confirma canonical?',
    });
  });

  it('falls back to legacy profile_ask_* aliases when canonical keys are absent', async () => {
    const repository = new FakeSettingsRepository(
      new Map<string, string>(),
      new Map<string, unknown>([
        ['profile_ask_name', 'Nome legado OK?'],
        ['profile_ask_company', 'Empresa legada OK?'],
      ]),
    );
    const service = new SettingsService(repository);

    await expect(service.getContactProfileConfig()).resolves.toMatchObject({
      promptName: 'Nome legado OK?',
      promptCompany: 'Empresa legada OK?',
    });
  });

  it('requests contact_profile_* keys and keeps global messages behavior intact', async () => {
    const repository = new FakeSettingsRepository(
      new Map<string, string>([['menu_message', 'Menu A']]),
      new Map<string, unknown>([
        ['contact_profile_collection_enabled', '0'],
        ['contact_profile_prompt_mode', 'hybrid'],
        ['contact_profile_require_company', '1'],
        ['contact_profile_require_name', '1'],
        ['contact_profile_require_equipment', '0'],
        ['contact_profile_require_summary', '1'],
        ['contact_profile_confirmation_enabled', '1'],
        ['contact_profile_use_buttons', '1'],
        ['ticket_title_enrichment_enabled', '1'],
        ['contact_profile_prompt_name', 'Nome?'],
        ['contact_profile_prompt_company', 'Empresa?'],
        ['contact_profile_prompt_equipment', 'Equipamento?'],
        ['contact_profile_prompt_summary', 'Resumo?'],
        ['contact_profile_confirm_message', 'Confirmar?'],
      ]),
    );
    const service = new SettingsService(repository);

    await expect(service.getMessage('menu_message')).resolves.toBe('Menu A');
    await expect(service.getContactProfileConfig()).resolves.toMatchObject({
      collectionEnabled: false,
      promptMode: 'hybrid',
      requireCompany: true,
      requireName: true,
      requireEmail: true,   // absent key defaults to true (ask email — backward compat)
      requireEquipment: false,
      requireSummary: true,
      confirmationEnabled: true,
      useButtons: true,
      titleEnrichmentEnabled: true,
      promptName: 'Nome?',
      promptCompany: 'Empresa?',
      promptEquipment: 'Equipamento?',
      promptSummary: 'Resumo?',
      confirmMessage: 'Confirmar?',
    });

    expect(repository.findMessageSettings).toHaveBeenCalledTimes(1);
    expect(repository.findContactProfileSettings).toHaveBeenCalledTimes(1);
  });
});
