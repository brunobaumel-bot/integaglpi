import { describe, expect, it } from 'vitest';

import { PostgresSettingsRepository } from '../src/repositories/postgres/PostgresSettingsRepository.js';

type QueryCall = { text: string; params?: unknown[] };

class FakeExecutor {
  public calls: QueryCall[] = [];

  public async query(text: string, params?: unknown[]) {
    this.calls.push({ text, params });

    if (text.includes('information_schema.columns')) {
      return {
        rows: [
          { column_name: 'context' },
          { column_name: 'contact_profile_collection_enabled' },
          { column_name: 'profile_initial_prompt' },
          { column_name: 'profile_ask_name' },
          { column_name: 'ticket_title_enrichment_enabled' },
          { column_name: 'entity_resolution_mode' },
        ],
      };
    }

    if (text.includes("WHERE context = 'contact_profile'")) {
      return {
        rows: [{
          contact_profile_collection_enabled: '1',
          profile_initial_prompt: 'Prompt inicial',
          profile_ask_name: 'Nome?',
          ticket_title_enrichment_enabled: 'on',
        }],
      };
    }

    if (text.includes("WHERE context = 'entity_resolution'")) {
      return {
        rows: [{ entity_resolution_mode: 'defer_until_known' }],
      };
    }

    return { rows: [] };
  }
}

describe('PostgresSettingsRepository', () => {
  it('reads synced contact-profile settings from the external configs table', async () => {
    const executor = new FakeExecutor();
    const repository = new PostgresSettingsRepository(executor);

    const settings = await repository.findContactProfileSettings();

    expect(settings.get('contact_profile_collection_enabled')).toBe('1');
    expect(settings.get('profile_initial_prompt')).toBe('Prompt inicial');
    expect(settings.get('profile_ask_name')).toBe('Nome?');
    expect(settings.get('ticket_title_enrichment_enabled')).toBe('on');
    expect(executor.calls[1]?.text).toContain('FROM glpi_plugin_integaglpi_configs');
    expect(executor.calls[1]?.text).toContain("WHERE context = 'contact_profile'");
  });

  it('reads entity resolution mode from the same runtime settings table', async () => {
    const executor = new FakeExecutor();
    const repository = new PostgresSettingsRepository(executor);

    const settings = await repository.findEntityResolutionSettings();

    expect(settings.get('entity_resolution_mode')).toBe('defer_until_known');
    expect(executor.calls[1]?.text).toContain("WHERE context = 'entity_resolution'");
  });
});
