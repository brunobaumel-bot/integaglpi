import { describe, expect, it, vi } from 'vitest';

import type { SettingsRepository } from '../src/domain/repositories/SettingsRepository.js';
import { ContactEntityResolutionService } from '../src/domain/services/ContactEntityResolutionService.js';

class FakeSettingsRepository implements SettingsRepository {
  public findBusinessHoursSettings = vi.fn<() => Promise<Map<string, unknown>>>().mockResolvedValue(new Map());
  public findContactProfileSettings = vi.fn<() => Promise<Map<string, unknown>>>().mockResolvedValue(new Map());
  public findMessageSettings = vi.fn<() => Promise<Map<string, string>>>().mockResolvedValue(new Map());

  public constructor(private readonly entitySettings: Map<string, unknown>) {}

  public async findEntityResolutionSettings(): Promise<Map<string, unknown>> {
    return this.entitySettings;
  }
}

describe('ContactEntityResolutionService', () => {
  it('uses defer_until_known when synced by the plugin', async () => {
    const service = new ContactEntityResolutionService(new FakeSettingsRepository(
      new Map([['entity_resolution_mode', 'defer_until_known']]),
    ));

    await expect(service.getMode()).resolves.toBe('defer_until_known');
  });

  it('normalizes legacy use_default_entity to manual entity selection', async () => {
    const service = new ContactEntityResolutionService(new FakeSettingsRepository(
      new Map([['entity_resolution_mode', 'use_default_entity']]),
    ));

    await expect(service.getMode()).resolves.toBe('defer_until_known');
  });

  it('normalizes invalid and legacy triage modes to manual entity selection', async () => {
    const legacy = new ContactEntityResolutionService(new FakeSettingsRepository(
      new Map([['entity_resolution_mode', 'use_triage_entity']]),
    ));
    const invalid = new ContactEntityResolutionService(new FakeSettingsRepository(
      new Map([['entity_resolution_mode', 'unexpected']]),
    ));

    await expect(legacy.getMode()).resolves.toBe('defer_until_known');
    await expect(invalid.getMode()).resolves.toBe('defer_until_known');
  });
});
