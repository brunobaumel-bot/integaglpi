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

  it('keeps entity selection attempts aligned with selected GLPI entity columns', async () => {
    const initDb = compactSql(await readProjectFile('init-db.sql'));
    const migration = compactSql(await readProjectFile('schema-migrations/006_entity_selection_attempts.sql'));
    const idempotencyMigration = compactSql(
      await readProjectFile('schema-migrations/020_entity_selection_attempts_idempotency_key.sql'),
    );
    const finishedAtMigration = compactSql(
      await readProjectFile('schema-migrations/023_entity_selection_attempt_finished_at.sql'),
    );

    for (const sql of [initDb, migration]) {
      expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.glpi_plugin_integaglpi_entity_selection_attempts');
      expect(sql).toContain('glpi_entity_id BIGINT NOT NULL');
      expect(sql).toContain('glpi_entity_name TEXT NULL');
      expect(sql).toContain('ADD COLUMN IF NOT EXISTS glpi_entity_id BIGINT');
      expect(sql).toContain('ADD COLUMN IF NOT EXISTS glpi_entity_name TEXT NULL');
    }
    for (const sql of [initDb, idempotencyMigration]) {
      expect(sql).toContain('ADD COLUMN IF NOT EXISTS idempotency_key TEXT NULL');
      expect(sql).toContain('CREATE INDEX IF NOT EXISTS glpi_intega_entity_sel_idempotency_idx');
    }
    for (const sql of [initDb, finishedAtMigration]) {
      expect(sql).toContain('ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ NULL');
      expect(sql).toContain('CREATE INDEX IF NOT EXISTS glpi_intega_entity_sel_finished_idx');
    }
    expect(idempotencyMigration).not.toContain('DROP ');
    expect(idempotencyMigration).not.toContain('TRUNCATE ');
    expect(idempotencyMigration).not.toContain('DELETE ');
    expect(finishedAtMigration).not.toContain('DROP ');
    expect(finishedAtMigration).not.toContain('TRUNCATE ');
    expect(finishedAtMigration).not.toContain('DELETE ');
  });

  it('versions conversation entity columns for profile-complete entity selection', async () => {
    const initDb = compactSql(await readProjectFile('init-db.sql'));
    const migration = compactSql(await readProjectFile('schema-migrations/019_conversation_entity_columns.sql'));

    for (const sql of [initDb, migration]) {
      expect(sql).toContain('ADD COLUMN IF NOT EXISTS glpi_entity_id BIGINT');
      expect(sql).toContain('ADD COLUMN IF NOT EXISTS glpi_entity_name TEXT NULL');
      expect(sql).toContain('CREATE INDEX IF NOT EXISTS glpi_intega_conversations_entity_idx');
    }
    expect(migration).not.toContain('DROP ');
    expect(migration).not.toContain('TRUNCATE ');
    expect(migration).not.toContain('DELETE ');
  });

  it('keeps dead_letter aligned with the operational schema and indexes', async () => {
    const initDb = compactSql(await readProjectFile('init-db.sql'));
    const migration = compactSql(await readProjectFile('schema-migrations/010_dead_letter.sql'));

    for (const sql of [initDb, migration]) {
      expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.glpi_plugin_integaglpi_dead_letter');
      expect(sql).toContain('ADD COLUMN IF NOT EXISTS operation_type TEXT NOT NULL');
      expect(sql).toContain('ADD COLUMN IF NOT EXISTS failure_type TEXT NOT NULL');
      expect(sql).toContain('ADD COLUMN IF NOT EXISTS payload_json JSONB NULL');
      expect(sql).toContain('CREATE INDEX IF NOT EXISTS glpi_intega_dead_letter_operation_created_idx');
      expect(sql).toContain('ON public.glpi_plugin_integaglpi_dead_letter (operation_type, created_at DESC)');
      expect(sql).toContain('CREATE INDEX IF NOT EXISTS glpi_intega_dead_letter_status_created_idx');
      expect(sql).not.toContain('source_kind');
      expect(sql).not.toContain('source_payload');
    }
  });

  it('keeps contact_profile aligned with the phone-based operational schema', async () => {
    const initDb = compactSql(await readProjectFile('init-db.sql'));
    const migration = compactSql(await readProjectFile('schema-migrations/008_contact_profile.sql'));

    for (const sql of [initDb, migration]) {
      expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.glpi_plugin_integaglpi_contact_profile');
      expect(sql).toContain('phone_e164 TEXT');
      expect(sql).toContain('requester_name TEXT NULL');
      expect(sql).toContain('company_name_raw TEXT NULL');
      expect(sql).toContain('last_equipment_tag TEXT NULL');
      expect(sql).toContain('last_problem_summary TEXT NULL');
      expect(sql).toContain('profile_status TEXT NOT NULL DEFAULT');
      expect(sql).toContain('equipment_tag_unknown BOOLEAN NOT NULL DEFAULT FALSE');
      expect(sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS glpi_intega_contact_profile_phone_active_uq');
      expect(sql).toContain('WHERE is_active = TRUE');
      expect(sql).not.toContain('profile_json');
    }

    expect(migration).not.toContain('contact_id');
  });

  it('keeps runtime configs available for plugin-to-Node settings sync', async () => {
    const initDb = compactSql(await readProjectFile('init-db.sql'));
    const migration = compactSql(await readProjectFile('schema-migrations/011_runtime_configs.sql'));

    for (const sql of [initDb, migration]) {
      expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.glpi_plugin_integaglpi_configs');
      expect(sql).toContain('context TEXT NOT NULL');
      expect(sql).toContain('ADD COLUMN IF NOT EXISTS contact_profile_collection_enabled TEXT NULL');
      expect(sql).toContain('ADD COLUMN IF NOT EXISTS profile_initial_prompt TEXT NULL');
      expect(sql).toContain('ADD COLUMN IF NOT EXISTS profile_ask_name TEXT NULL');
      expect(sql).toContain('ADD COLUMN IF NOT EXISTS ticket_title_enrichment_enabled TEXT NULL');
      expect(sql).toContain('ADD COLUMN IF NOT EXISTS entity_resolution_mode TEXT NULL');
      expect(sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS glpi_intega_configs_context_uq');
    }
  });

  it('keeps conversation_profile_snapshot idempotent for existing tables missing snapshot fields', async () => {
    const initDb = compactSql(await readProjectFile('init-db.sql'));
    const migration = compactSql(await readProjectFile('schema-migrations/009_conversation_profile_snapshot.sql'));

    for (const sql of [initDb, migration]) {
      expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.glpi_plugin_integaglpi_conversation_profile_snapshot');
      expect(sql).toContain('phone_e164 TEXT NOT NULL');
      expect(sql).toContain('ADD COLUMN IF NOT EXISTS phone_e164 TEXT');
      expect(sql).toContain("ADD COLUMN IF NOT EXISTS snapshot_json JSONB NOT NULL DEFAULT '{}'::jsonb");
      expect(sql).toContain('ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()');
    }
  });

  it('keeps profile collection substate persisted in conversations', async () => {
    const initDb = compactSql(await readProjectFile('init-db.sql'));
    const migration = compactSql(await readProjectFile('schema-migrations/012_profile_collection_state.sql'));

    for (const sql of [initDb, migration]) {
      expect(sql).toContain("profile_collection_state JSONB NOT NULL DEFAULT '{}'::jsonb");
    }
  });

  it('keeps customer experience contact and CSAT columns aligned in init-db and migrations', async () => {
    const initDb = compactSql(await readProjectFile('init-db.sql'));
    const phaseMigration = compactSql(await readProjectFile('schema-migrations/013_customer_experience_glpi_user_csat.sql'));
    const alignmentMigration = compactSql(await readProjectFile('schema-migrations/014_customer_experience_schema_alignment.sql'));

    for (const sql of [initDb, phaseMigration, alignmentMigration]) {
      expect(sql).toContain('ADD COLUMN IF NOT EXISTS email_address TEXT NULL');
      expect(sql).toContain("ADD COLUMN IF NOT EXISTS email_status TEXT NOT NULL DEFAULT 'not_provided'");
      expect(sql).toContain('ADD COLUMN IF NOT EXISTS glpi_user_id BIGINT NULL');
      expect(sql).toContain('ADD COLUMN IF NOT EXISTS glpi_user_link_status TEXT NULL');
      expect(sql).toContain('ADD COLUMN IF NOT EXISTS glpi_user_link_source TEXT NULL');
      expect(sql).toContain('ADD COLUMN IF NOT EXISTS glpi_user_linked_at TIMESTAMPTZ NULL');
      expect(sql).toContain('ADD COLUMN IF NOT EXISTS glpi_user_created_by_integaglpi BOOLEAN NOT NULL DEFAULT FALSE');
      expect(sql).toContain('CREATE INDEX IF NOT EXISTS glpi_intega_contact_profile_email_idx');
      expect(sql).toContain('ON public.glpi_plugin_integaglpi_contact_profile (email_address)');
      expect(sql).toContain('ADD COLUMN IF NOT EXISTS csat_rating TEXT NULL');
      expect(sql).toContain('ADD COLUMN IF NOT EXISTS supervisor_review_required BOOLEAN NOT NULL DEFAULT FALSE');
      expect(sql).toContain('CREATE INDEX IF NOT EXISTS glpi_intega_solution_actions_csat_idx');
    }

    expect(initDb).toContain('email_address TEXT NULL');
    expect(initDb).toContain('csat_rating TEXT NULL');
  });

  it('keeps inactivity tracking schema additive and idempotent', async () => {
    const initDb = compactSql(await readProjectFile('init-db.sql'));
    const migration = compactSql(await readProjectFile('schema-migrations/015_inactivity_tracking.sql'));

    for (const sql of [initDb, migration]) {
      expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.glpi_plugin_integaglpi_inactivity_tracking');
      expect(sql).toContain('conversation_id TEXT PRIMARY KEY');
      expect(sql).toContain("status TEXT NOT NULL DEFAULT 'pending'");
      expect(sql).toContain('reminder_1_sent_at TIMESTAMPTZ NULL');
      expect(sql).toContain('reminder_2_sent_at TIMESTAMPTZ NULL');
      expect(sql).toContain('reminder_3_sent_at TIMESTAMPTZ NULL');
      expect(sql).toContain('autoclose_attempted_at TIMESTAMPTZ NULL');
      expect(sql).toContain('autoclose_completed_at TIMESTAMPTZ NULL');
      expect(sql).toContain('manual_hold_until TIMESTAMPTZ NULL');
      expect(sql).toContain('manual_hold_reason TEXT NULL');
      expect(sql).toContain('CREATE INDEX IF NOT EXISTS glpi_intega_inactivity_status_updated_idx');
      expect(sql).toContain('CREATE INDEX IF NOT EXISTS glpi_intega_inactivity_outbound_idx');
      expect(sql).not.toContain('DROP TABLE');
      expect(sql).not.toContain('TRUNCATE');
      expect(sql).not.toContain('DELETE FROM');
    }
  });

  it('keeps AI quality analyses schema additive, read-only scoped and free of raw payload storage', async () => {
    const initDb = compactSql(await readProjectFile('init-db.sql'));
    const migration = compactSql(await readProjectFile('schema-migrations/017_ai_quality_analyses.sql'));

    for (const sql of [initDb, migration]) {
      expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.glpi_plugin_integaglpi_ai_quality_analyses');
      expect(sql).toContain('analysis_version TEXT NOT NULL');
      expect(sql).toContain('provider TEXT NOT NULL');
      expect(sql).toContain("status TEXT NOT NULL DEFAULT 'pending'");
      expect(sql).toContain('flags JSONB NOT NULL DEFAULT');
      expect(sql).toContain('supervisor_feedback TEXT NULL');
      expect(sql).toContain('CREATE INDEX IF NOT EXISTS glpi_intega_ai_quality_ticket_created_idx');
      expect(sql).not.toContain('DROP TABLE');
      expect(sql).not.toContain('TRUNCATE');
      expect(sql).not.toContain('DELETE FROM');
    }

    expect(migration).not.toContain('payload_json');
    expect(migration).not.toContain('prompt');
    expect(migration).not.toContain('base64');
  });

  it('keeps message delivery status schema additive and free of raw payload storage', async () => {
    const initDb = compactSql(await readProjectFile('init-db.sql'));
    const migration = compactSql(await readProjectFile('schema-migrations/018_message_delivery_status.sql'));

    for (const sql of [initDb, migration]) {
      expect(sql).toContain('meta_message_id TEXT');
      expect(sql).toContain("delivery_status TEXT NOT NULL DEFAULT 'pending'");
      expect(sql).toContain('delivery_status_updated_at TIMESTAMPTZ');
      expect(sql).toContain('meta_error_code TEXT');
      expect(sql).toContain('meta_error_message_sanitized TEXT');
      expect(sql).toContain('CREATE TABLE IF NOT EXISTS glpi_plugin_integaglpi_message_delivery_status');
      expect(sql).toContain("status TEXT NOT NULL CHECK (status IN ('pending', 'sent', 'delivered', 'read', 'failed'))");
      expect(sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS glpi_plugin_integaglpi_msg_delivery_status_uq');
      expect(sql).not.toContain('DROP TABLE');
      expect(sql).not.toContain('TRUNCATE');
      expect(sql).not.toContain('base64');
    }

    expect(migration).not.toContain('payload_json');
    expect(migration).not.toContain('raw_payload');
  });

  it('keeps configurable message flow schema additive and safe for production package', async () => {
    const initDb = compactSql(await readProjectFile('init-db.sql'));
    const migration = compactSql(await readProjectFile('schema-migrations/021_configurable_message_flows.sql'));

    for (const sql of [initDb, migration]) {
      expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.glpi_plugin_integaglpi_message_catalog');
      expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.glpi_plugin_integaglpi_message_catalog_audit');
      expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.glpi_plugin_integaglpi_business_hours');
      expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.glpi_plugin_integaglpi_message_automation_events');
      expect(sql).toContain('outside_business_hours_message');
      expect(sql).toContain('inactivity_reminder_1');
      expect(sql).toContain("send_type TEXT NOT NULL DEFAULT 'text'");
      expect(sql).toContain("status TEXT NOT NULL CHECK (status IN ('planned', 'sent', 'failed', 'not_sent_by_rule'))");
      expect(sql).not.toContain('DROP TABLE');
      expect(sql).not.toContain('TRUNCATE');
      expect(sql).not.toContain('DELETE FROM');
      expect(sql).not.toContain('access_token');
      expect(sql).not.toContain('base64');
    }
  });

  it('keeps inactivity diagnostics schema additive and visible without raw payload storage', async () => {
    const initDb = compactSql(await readProjectFile('init-db.sql'));
    const migration = compactSql(await readProjectFile('schema-migrations/022_inactivity_job_diagnostics.sql'));

    for (const sql of [initDb, migration]) {
      expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.glpi_plugin_integaglpi_inactivity_job_events');
      expect(sql).toContain("status TEXT NOT NULL CHECK (status IN ('checked', 'eligible', 'skipped', 'planned', 'sent', 'failed'))");
      expect(sql).toContain('meta_error_code TEXT');
      expect(sql).toContain('meta_error_message_sanitized TEXT');
      expect(sql).toContain('checked_count INTEGER');
      expect(sql).toContain('eligible_count INTEGER');
      expect(sql).not.toContain('DROP TABLE');
      expect(sql).not.toContain('TRUNCATE');
      expect(sql).not.toContain('DELETE FROM');
      expect(sql).not.toContain('base64');
    }
    expect(migration).not.toContain('raw_payload');
  });

  it('keeps inactivity SLA and service catalog migration additive and indexed', async () => {
    const migration = compactSql(await readProjectFile('schema-migrations/026_inactivity_sla_service_catalog.sql'));

    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.glpi_plugin_integaglpi_service_catalog');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.glpi_plugin_integaglpi_conversation_sla_logs');
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS glpi_service_catalog_id BIGINT NULL');
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS sla_response_deadline TIMESTAMPTZ NULL');
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS inactivity_skip_reason TEXT NULL');
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS inactivity_reminder_1_minutes INTEGER NULL');
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS inactivity_reminder_2_minutes INTEGER NULL');
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS inactivity_reminder_3_minutes INTEGER NULL');
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS inactivity_autoclose_minutes INTEGER NULL');
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS reason_code TEXT NULL');
    expect(migration).toContain('CREATE INDEX IF NOT EXISTS glpi_integaglpi_service_catalog_queue_entity_idx');
    expect(migration).not.toContain('DROP TABLE');
    expect(migration).not.toContain('TRUNCATE');
    expect(migration).not.toContain('DELETE FROM');
  });

  it('keeps knowledge base foundation isolated, additive and free of vector/RAG storage', async () => {
    const migration = compactSql(await readProjectFile('schema-migrations/028_knowledge_base_foundation.sql'));

    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.glpi_plugin_integaglpi_kb_articles');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.glpi_plugin_integaglpi_kb_article_versions');
    expect(migration).toContain("status TEXT NOT NULL DEFAULT 'draft'");
    expect(migration).toContain('tags JSONB NOT NULL DEFAULT');
    expect(migration).toContain('is_sensitive BOOLEAN NOT NULL DEFAULT FALSE');
    expect(migration).toContain('CREATE UNIQUE INDEX IF NOT EXISTS glpi_integaglpi_kb_versions_article_version_uq');
    expect(migration).toContain('CREATE INDEX IF NOT EXISTS glpi_integaglpi_kb_articles_tags_gin_idx');
    expect(migration).toContain("article_type IN ( 'procedimento_tecnico', 'solucao_comum', 'resposta_padrao', 'diagnostico_conhecido', 'faq_interno', 'alerta_operacional' )");
    expect(migration).toContain("status IN ('draft', 'active', 'archived')");
    expect(migration).not.toContain('DROP TABLE');
    expect(migration).not.toContain('TRUNCATE');
    expect(migration).not.toContain('DELETE FROM');
    expect(migration).not.toContain('embedding');
    expect(migration).not.toContain('vector');
    expect(migration).not.toContain('rag');
    expect(migration).not.toContain('glpi_plugin_integaglpi_conversations');
    expect(migration).not.toContain('glpi_plugin_integaglpi_messages');
    expect(migration).not.toContain('glpi_plugin_integaglpi_ai_quality_analyses');
  });

  it('keeps historical mining schema isolated, additive and offline scoped', async () => {
    const migration = compactSql(await readProjectFile('schema-migrations/029_ai_historical_mining_offline.sql'));

    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.glpi_plugin_integaglpi_hist_mining_runs');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.glpi_plugin_integaglpi_hist_patterns');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.glpi_plugin_integaglpi_hist_insights');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.glpi_plugin_integaglpi_hist_evidence');
    expect(migration).toContain('ticket_id_hash TEXT NOT NULL');
    expect(migration).toContain('anonymized_excerpt TEXT NOT NULL');
    expect(migration).toContain('summary_sanitized TEXT NOT NULL');
    expect(migration).toContain('recommendation_sanitized TEXT NOT NULL');
    expect(migration).toContain('CREATE INDEX IF NOT EXISTS glpi_integaglpi_hist_patterns_type_idx');
    expect(migration).not.toContain('DROP TABLE');
    expect(migration).not.toContain('TRUNCATE');
    expect(migration).not.toContain('DELETE FROM');
    expect(migration).not.toContain('glpi_tickets');
    expect(migration).not.toContain('glpi_itilfollowups');
    expect(migration).not.toContain('glpi_itilsolutions');
    expect(migration).not.toContain('embedding');
    expect(migration).not.toContain('vector');
    expect(migration).not.toContain('rag');
  });
});
