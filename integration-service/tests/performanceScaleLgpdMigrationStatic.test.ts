import { readFile, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const integrationRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const migrationPath = resolve(integrationRoot, 'schema-migrations/045_performance_scale_lgpd_indexes.sql');

function compact(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}

function stripComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, ' ');
}

async function readMigration(): Promise<string> {
  return readFile(migrationPath, 'utf8');
}

async function listTypeScriptFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listTypeScriptFiles(path));
    } else if (entry.isFile() && path.endsWith('.ts')) {
      files.push(path);
    }
  }

  return files;
}

describe('045 performance/scale/LGPD readiness migration', () => {
  it('is additive, idempotent and gated by table existence', async () => {
    const raw = await readMigration();
    const sql = compact(raw);
    const statements = compact(stripComments(raw));

    expect(sql).toContain('to_regclass');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_messages_conv_created');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_inactivity_status_updated');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_kb_article_helpfulness_ticket');
    expect(sql).toContain('glpi_intega_inactivity_status_updated_idx');
    expect(sql).toContain('pg_indexes');

    expect(statements).not.toMatch(/\bDROP\b/i);
    expect(statements).not.toMatch(/\bTRUNCATE\b/i);
    expect(statements).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(statements).not.toMatch(/\bUPDATE\s+/i);
    expect(statements).not.toMatch(/\bINSERT\s+INTO\b/i);
  });

  it('indexes only integration PostgreSQL tables, never GLPI MariaDB/core tables', async () => {
    const sql = await readMigration();

    expect(sql).toContain('public.glpi_plugin_integaglpi_messages');
    expect(sql).toContain('public.glpi_plugin_integaglpi_inactivity_tracking');
    expect(sql).toContain('public.glpi_plugin_integaglpi_kb_article_helpfulness');
    expect(sql).not.toMatch(/\bglpi_(tickets|users|knowbaseitems|itilfollowups|entities)\b/i);
  });

  it('does not introduce direct MariaDB access in Node source', async () => {
    const forbidden =
      /from ['"](mysql2?|mariadb|mysqli)['"]|require\(['"](mysql2?|mariadb|mysqli)['"]\)|new PDO\b|PDO::|createConnection\([^)]*3306/i;
    const offenders = [];

    for (const path of await listTypeScriptFiles(resolve(integrationRoot, 'src'))) {
      const source = await readFile(path, 'utf8');
      if (forbidden.test(source)) {
        offenders.push(path.replace(integrationRoot, ''));
      }
    }

    expect(offenders).toEqual([]);
  });
});
