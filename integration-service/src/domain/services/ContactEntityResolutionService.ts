import type { SettingsRepository } from '../repositories/SettingsRepository.js';

/**
 * Lê configuração de resolução de entidade (`context = entity_resolution` na tabela configs).
 */
export class ContactEntityResolutionService {
  public constructor(private readonly settingsRepository: SettingsRepository) {}

  public loadEntityResolutionSettings(): Promise<Map<string, unknown>> {
    return this.settingsRepository.findEntityResolutionSettings();
  }

  public async getMode(): Promise<'use_default_entity' | 'defer_until_known'> {
    await this.loadEntityResolutionSettings();
    return 'defer_until_known';
  }
}
