import { describe, expect, it } from 'vitest';

import type { SqlExecutor } from '../src/infra/db/postgres.js';
import { PostgresContactAgendaImportRepository } from '../src/repositories/postgres/PostgresContactAgendaImportRepository.js';

class FakeExecutor implements SqlExecutor {
  public queries: Array<{ text: string; params: unknown[] }> = [];
  public queuedRows: unknown[][] = [];

  public async query<R>(text: string, params: unknown[] = []) {
    this.queries.push({ text, params });
    const rows = this.queuedRows.shift() ?? (text.includes('RETURNING id') ? [{ id: 123 }] : []);

    return {
      command: 'SELECT',
      rowCount: rows.length,
      oid: 0,
      fields: [],
      rows: rows as R[],
    };
  }
}

const existingProfileRow = {
  id: 77,
  phone_e164: '+5599999999999',
  requester_name: 'Ana',
  email_address: null,
  email_status: 'not_provided',
  glpi_user_id: null,
  glpi_user_link_status: 'not_found',
  glpi_user_link_source: 'manual_required',
  glpi_user_linked_at: null,
  glpi_user_created_by_integaglpi: false,
  company_name_raw: 'Cliente',
  last_equipment_tag: null,
  equipment_tag_unknown: false,
  last_problem_summary: null,
  profile_status: 'incomplete',
  profile_source: 'whatsapp',
  confirmation_count: 0,
  last_confirmed_at: null,
  last_conversation_id: null,
  is_active: true,
  created_at: new Date('2026-05-21T12:00:00.000Z'),
  updated_at: new Date('2026-05-21T12:00:00.000Z'),
};

describe('PostgresContactAgendaImportRepository', () => {
  it('casts nullable CSV confirm parameters in contact_profile insert SQL', async () => {
    const executor = new FakeExecutor();
    executor.queuedRows = [[]];
    const repository = new PostgresContactAgendaImportRepository(executor);

    await repository.applyProfile({
      phoneE164: '+5599999999999',
      email: null,
      contactName: 'Ana',
      companyName: 'Cliente',
      equipmentTag: null,
      equipmentTagUnknown: false,
    });

    const insertQuery = executor.queries.find((query) => query.text.includes('INSERT INTO') && query.text.includes('contact_profile'));

    expect(insertQuery?.text).toContain('$3::text');
    expect(insertQuery?.text).toContain('CASE WHEN $3::text IS NULL');
    expect(insertQuery?.text).toContain('$6::boolean');
    expect(insertQuery?.text).toContain('requester_name');
    expect(insertQuery?.text).toContain('company_name_raw');
    expect(insertQuery?.text).toContain('last_equipment_tag');
    expect(insertQuery?.text).not.toContain('contact_name');
    expect(insertQuery?.text).not.toContain('company_name,');
  });

  it('casts nullable CSV confirm parameters in contact_profile update SQL', async () => {
    const executor = new FakeExecutor();
    executor.queuedRows = [[existingProfileRow], []];
    const repository = new PostgresContactAgendaImportRepository(executor);

    await repository.applyProfile({
      phoneE164: '+5599999999999',
      email: null,
      contactName: null,
      companyName: null,
      equipmentTag: null,
      equipmentTagUnknown: false,
    });

    const updateQuery = executor.queries.find((query) => query.text.includes('UPDATE') && query.text.includes('contact_profile'));

    expect(updateQuery?.text).toContain('COALESCE($3::text, email_address)');
    expect(updateQuery?.text).toContain('CASE WHEN $3::text IS NULL');
    expect(updateQuery?.text).toContain('$5::text IS NULL');
    expect(updateQuery?.text).toContain('$6::boolean');
    expect(updateQuery?.text).toContain('WHERE id = $1::bigint');
  });

  it('casts batch status and applied item parameters used during confirm', async () => {
    const executor = new FakeExecutor();
    const repository = new PostgresContactAgendaImportRepository(executor);

    await repository.updateBatchStatus('batch-1', 'failed', null);
    await repository.markItemApplied(10, {
      actionApplied: 'skipped',
      targetContactProfileId: null,
      previousStateJson: null,
    });

    expect(executor.queries[0].text).toContain('error_message_sanitized = $3::text');
    expect(executor.queries[0].text).toContain('WHERE batch_id = $1::text');
    expect(executor.queries[1].text).toContain('target_contact_profile_id = $3::bigint');
    expect(executor.queries[1].text).toContain('previous_state_json = $4::jsonb');
  });
});
