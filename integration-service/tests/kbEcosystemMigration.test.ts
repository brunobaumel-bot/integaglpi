import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

async function readMigration(): Promise<string> {
  return await readFile(
    new URL('../schema-migrations/044_ai_kb_ecosystem_reengineered.sql', import.meta.url),
    'utf8',
  );
}

function compact(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}

/** Strip `-- ...` line comments so destructive-SQL checks only see real statements. */
function stripComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, ' ');
}

describe('044 AI/KB ecosystem additive migration', () => {
  it('only contains additive, idempotent statements (no destructive SQL)', async () => {
    const raw = await readMigration();
    const sql = compact(raw);
    // Destructive checks ignore comments (which legitimately name these words).
    const statements = compact(stripComments(raw));

    // Must be idempotent.
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS/);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS/);
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS/);

    // Must never be destructive (in actual statements, not comments).
    expect(statements).not.toMatch(/\bDROP\b/i);
    expect(statements).not.toMatch(/\bTRUNCATE\b/i);
    expect(statements).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(statements).not.toMatch(/\bALTER\s+TABLE[^;]*\bDROP\b/i);
  });

  it('adds the new kb_candidates structured columns', async () => {
    const sql = await readMigration();
    for (const col of ['confidence_reason', 'difficulty_level', 'target_audience', 'duplicate_of', 'cluster_id']) {
      expect(sql).toContain(`ADD COLUMN IF NOT EXISTS ${col}`);
    }
    expect(sql).toContain('glpi_plugin_integaglpi_kb_candidates');
  });

  it('creates the kb_article_helpfulness feedback table with non-punitive intent', async () => {
    const sql = await readMigration();
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.glpi_plugin_integaglpi_kb_article_helpfulness');
    expect(sql).toContain('helpful');
    expect(sql).toContain('kb_candidate_id');
    expect(sql).toContain('glpi_knowbaseitem_id');
    // Explicit non-punitive comment must be present.
    expect(sql).toMatch(/never used to rank or evaluate technicians/i);
  });

  it('creates the cloud_compliance_audit table that never stores raw prompt/PII', async () => {
    const sql = await readMigration();
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.glpi_plugin_integaglpi_cloud_compliance_audit');
    expect(sql).toContain('pii_guard_passed');
    expect(sql).toContain('request_summary_sanitized');
    expect(sql).toContain('request_context_chars');
    // Must store profile, not nominal technician, for cloud usage.
    expect(sql).toContain('glpi_profile_id');
    expect(sql).toMatch(/Never stores raw prompt, PII, secrets/i);
  });

  it('uses TIMESTAMPTZ created_at/updated_at audit columns on new tables', async () => {
    const sql = await readMigration();
    expect((sql.match(/created_at\s+TIMESTAMPTZ/gi) ?? []).length).toBeGreaterThanOrEqual(2);
    expect((sql.match(/updated_at\s+TIMESTAMPTZ/gi) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});
