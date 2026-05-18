import { describe, expect, it } from 'vitest';

import { PostgresContactProfileRepository } from '../src/repositories/postgres/PostgresContactProfileRepository.js';
import type { SqlExecutor } from '../src/infra/db/postgres.js';

class FakeExecutor implements SqlExecutor {
  public queries: Array<{ text: string; params: unknown[] }> = [];
  public rows: unknown[] = [];

  public async query<R>(text: string, params: unknown[] = []) {
    this.queries.push({ text, params });
    return {
      command: 'SELECT',
      rowCount: this.rows.length,
      oid: 0,
      fields: [],
      rows: this.rows as R[],
    };
  }
}

describe('PostgresContactProfileRepository', () => {
  it('finds the active profile by phone_e164 without using legacy contact_id/profile_json columns', async () => {
    const executor = new FakeExecutor();
    executor.rows = [{
      phone_e164: '+5511999999999',
      requester_name: 'Maria',
      email_address: 'maria@example.com',
      email_status: 'valid',
      glpi_user_id: 44,
      glpi_user_link_status: 'linked',
      glpi_user_link_source: 'email_unique_match',
      glpi_user_linked_at: new Date('2026-05-13T11:59:00.000Z'),
      glpi_user_created_by_integaglpi: false,
      company_name_raw: 'Empresa',
      last_equipment_tag: 'ABC123',
      equipment_tag_unknown: false,
      last_problem_summary: 'Internet lenta',
      profile_status: 'complete',
      profile_source: 'whatsapp',
      confirmation_count: 1,
      last_confirmed_at: new Date('2026-05-13T12:00:00.000Z'),
      last_conversation_id: 'conversation-1',
      updated_at: new Date('2026-05-13T12:01:00.000Z'),
    }];
    const repository = new PostgresContactProfileRepository(executor);

    const profile = await repository.findByPhoneE164('+5511999999999');

    expect(profile?.phoneE164).toBe('+5511999999999');
    expect(profile?.profile).toMatchObject({
      phone_e164: '+5511999999999',
      requester_name: 'Maria',
      email_address: 'maria@example.com',
      email_status: 'valid',
      glpi_user_id: 44,
      glpi_user_link_status: 'linked',
      glpi_user_link_source: 'email_unique_match',
      company_name_raw: 'Empresa',
      last_equipment_tag: 'ABC123',
      last_problem_summary: 'Internet lenta',
      profile_status: 'complete',
      last_conversation_id: 'conversation-1',
    });
    expect(executor.queries[0].text).toContain('WHERE phone_e164 = $1');
    expect(executor.queries[0].text).toContain('AND is_active = TRUE');
    expect(executor.queries[0].text).not.toContain('contact_id');
    expect(executor.queries[0].text).not.toContain('profile_json');
  });

  it('upserts the active phone profile using separated operational fields', async () => {
    const executor = new FakeExecutor();
    const repository = new PostgresContactProfileRepository(executor);

    await repository.upsertProfile('+5511999999999', {
      requester_name: 'Maria',
      email_address: 'maria@example.com',
      email_status: 'valid',
      glpi_user_id: 44,
      glpi_user_link_status: 'linked',
      glpi_user_link_source: 'email_unique_match',
      company_name_raw: 'Empresa',
      last_equipment_tag: null,
      equipment_tag_unknown: true,
      last_problem_summary: 'Internet lenta',
      profile_status: 'complete',
      profile_source: 'whatsapp',
      confirmation_count: 1,
      last_confirmed_at: '2026-05-13T12:00:00.000Z',
      last_conversation_id: 'conversation-1',
    });

    expect(executor.queries[0].text).toContain('phone_e164');
    expect(executor.queries[0].text).toContain('requester_name');
    expect(executor.queries[0].text).toContain('email_address');
    expect(executor.queries[0].text).toContain('email_status');
    expect(executor.queries[0].text).toContain('glpi_user_id');
    expect(executor.queries[0].text).toContain('glpi_user_link_status');
    expect(executor.queries[0].text).toContain('glpi_user_link_source');
    expect(executor.queries[0].text).toContain('company_name_raw');
    expect(executor.queries[0].text).toContain('last_equipment_tag');
    expect(executor.queries[0].text).toContain('last_problem_summary');
    expect(executor.queries[0].text).toContain('last_conversation_id');
    expect(executor.queries[0].text).toContain('ON CONFLICT (phone_e164) WHERE is_active = TRUE DO UPDATE');
    expect(executor.queries[0].text).not.toContain('contact_id');
    expect(executor.queries[0].text).not.toContain('profile_json');
  });

  it('upserts a conversation snapshot with the required phone_e164 column', async () => {
    const executor = new FakeExecutor();
    const repository = new PostgresContactProfileRepository(executor);

    await repository.upsertSnapshot('conversation-1', '+5511999999999', {
      phone_e164: '+5511999999999',
      requester_name: 'Maria',
    });

    expect(executor.queries[0].text).toContain('(conversation_id, phone_e164, snapshot_json)');
    expect(executor.queries[0].text).toContain('phone_e164 = EXCLUDED.phone_e164');
    expect(executor.queries[0].params).toEqual([
      'conversation-1',
      '+5511999999999',
      JSON.stringify({
        phone_e164: '+5511999999999',
        requester_name: 'Maria',
      }),
    ]);
  });
});
