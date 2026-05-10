import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const originalEnv = { ...process.env };

async function readProjectFile(path: string): Promise<string> {
  const { readFile } = await import('node:fs/promises');
  return await readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

function compactSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}

beforeEach(() => {
  process.env = {
    ...originalEnv,
    NODE_ENV: 'test',
    GLPI_API_BASE_URL: 'https://glpi.example.local/apirest.php',
    GLPI_APP_TOKEN: 'app-token',
    GLPI_USER_TOKEN: 'user-token',
    META_APP_SECRET: 'secret',
    META_VERIFY_TOKEN: 'verify',
    META_ACCESS_TOKEN: 'meta-token',
    META_PHONE_NUMBER_ID: 'phone-id',
    REDIS_HOST: 'redis',
    REDIS_PORT: '6379',
    DB_HOST: 'postgres',
    DB_PORT: '5432',
    DB_NAME: 'db',
    DB_USER: 'user',
    DB_PASSWORD: 'password',
    DB_SSL: 'false',
  };
});

afterEach(() => {
  process.env = { ...originalEnv };
});

describe('database bootstrap hardening', () => {
  it('keeps media_info JSONB in the consolidated init-db baseline', async () => {
    const initDb = await readProjectFile('init-db.sql');

    expect(compactSql(initDb)).toContain('media_info JSONB');
  });

  it('keeps media_info migration idempotent and schema-qualified', async () => {
    const migration = await readProjectFile('schema-migrations/003_messages_media_info.sql');

    expect(compactSql(migration)).toContain(
      'ALTER TABLE public.glpi_plugin_integaglpi_messages ADD COLUMN IF NOT EXISTS media_info JSONB',
    );
    expect(compactSql(migration)).toContain(
      'CREATE INDEX IF NOT EXISTS idx_glpi_plugin_integaglpi_messages_media_status',
    );
  });

  it('keeps solution_actions migration with required table, constraints and indexes', async () => {
    const migration = await readProjectFile('schema-migrations/004_solution_actions.sql');
    const compact = compactSql(migration);

    expect(compact).toContain('CREATE TABLE IF NOT EXISTS public.glpi_plugin_integaglpi_solution_actions');
    expect(compact).toContain('CREATE UNIQUE INDEX IF NOT EXISTS glpi_intega_solution_actions_msg_uq');
    expect(compact).toContain('ON glpi_plugin_integaglpi_solution_actions (whatsapp_message_id)');
    expect(compact).toContain('ON glpi_plugin_integaglpi_solution_actions (ticket_id)');
    expect(compact).toContain('ON glpi_plugin_integaglpi_solution_actions (conversation_id)');
    expect(compact).toContain('ON glpi_plugin_integaglpi_solution_actions (action_key)');
    expect(compact).toContain("CHECK (action IN ('approve', 'reopen'))");
    expect(compact).toContain("CHECK (status IN ('processing', 'success', 'error', 'ignored'))");
  });

  it('keeps audit_events migration idempotent with required indexes and manual retention note', async () => {
    const migration = await readProjectFile('schema-migrations/005_audit_events.sql');
    const compact = compactSql(migration);

    expect(compact).toContain('CREATE TABLE IF NOT EXISTS public.glpi_plugin_integaglpi_audit_events');
    expect(compact).toContain('id BIGSERIAL PRIMARY KEY');
    expect(compact).toContain('payload_json JSONB NULL');
    expect(compact).toContain('CREATE INDEX IF NOT EXISTS glpi_intega_audit_created_at_idx');
    expect(compact).toContain('CREATE INDEX IF NOT EXISTS glpi_intega_audit_correlation_idx');
    expect(compact).toContain('CREATE INDEX IF NOT EXISTS glpi_intega_audit_ticket_idx');
    expect(compact).toContain('CREATE INDEX IF NOT EXISTS glpi_intega_audit_conversation_idx');
    expect(compact).toContain('CREATE INDEX IF NOT EXISTS glpi_intega_audit_message_idx');
    expect(compact).toContain('CREATE INDEX IF NOT EXISTS glpi_intega_audit_event_created_idx');
    expect(compact).toContain('CREATE INDEX IF NOT EXISTS glpi_intega_audit_severity_created_idx');
    expect(compact).toContain("INTERVAL '90 days'");
    expect(compact).toContain('Nao executar automaticamente no startup');
  });

  it('copies schema-migrations into the runtime Docker image', async () => {
    const dockerfile = await readProjectFile('Dockerfile');

    expect(dockerfile).toMatch(/COPY\s+schema-migrations\s+\.\/schema-migrations/);
    expect(dockerfile).not.toMatch(/COPY\s+\.env\b/);
  });

  it('sorts schema migrations lexicographically before execution', async () => {
    const { sortSchemaMigrationFiles } = await import('../src/infra/db/postgres.js');

    expect(sortSchemaMigrationFiles([
      '010_future.sql',
      '002_routing_queues.sql',
      'README.md',
      '004_solution_actions.sql',
      '005_audit_events.sql',
      '003_messages_media_info.sql',
    ])).toEqual([
      '002_routing_queues.sql',
      '003_messages_media_info.sql',
      '004_solution_actions.sql',
      '005_audit_events.sql',
      '010_future.sql',
    ]);
  });

  it('fails clearly when schema-migrations directory is missing', async () => {
    const { listSchemaMigrationFiles } = await import('../src/infra/db/postgres.js');
    const missingDir = join(tmpdir(), `integaglpi-missing-migrations-${Date.now()}`);

    await expect(listSchemaMigrationFiles(missingDir)).rejects.toThrow('Schema migrations directory not found');
  });

  it('fails clearly when critical migrations are missing', async () => {
    const { listSchemaMigrationFiles } = await import('../src/infra/db/postgres.js');
    const directory = await mkdtemp(join(tmpdir(), 'integaglpi-migrations-'));

    try {
      await expect(listSchemaMigrationFiles(directory)).rejects.toThrow('Critical schema migrations missing');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('keeps schema patches idempotent for repeated startup execution', async () => {
    const mediaMigration = compactSql(await readProjectFile('schema-migrations/003_messages_media_info.sql'));
    const solutionMigration = compactSql(await readProjectFile('schema-migrations/004_solution_actions.sql'));

    expect(mediaMigration).toContain('ADD COLUMN IF NOT EXISTS media_info JSONB');
    expect(solutionMigration).toContain('CREATE TABLE IF NOT EXISTS public.glpi_plugin_integaglpi_solution_actions');
    expect(solutionMigration).toContain('CREATE UNIQUE INDEX IF NOT EXISTS glpi_intega_solution_actions_msg_uq');
    expect(solutionMigration).toContain('CREATE INDEX IF NOT EXISTS glpi_intega_solution_actions_ticket_idx');
    expect(solutionMigration).toContain('CREATE INDEX IF NOT EXISTS glpi_intega_solution_actions_conversation_idx');
    expect(solutionMigration).toContain('CREATE INDEX IF NOT EXISTS glpi_intega_solution_actions_key_idx');

    const auditMigration = compactSql(await readProjectFile('schema-migrations/005_audit_events.sql'));
    expect(auditMigration).toContain('CREATE TABLE IF NOT EXISTS public.glpi_plugin_integaglpi_audit_events');
    expect(auditMigration).toContain('CREATE INDEX IF NOT EXISTS glpi_intega_audit_created_at_idx');
  });
});
