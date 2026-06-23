import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  SHADOW_REPLAY_STORE_CONTRACT_VERSION,
  SHADOW_REPLAY_STORE_SCHEMA_MIGRATION,
} from '../src/shadowReplay/ShadowReplayStoreContract.js';
import type {
  ShadowReplayAuditEvent,
  ShadowReplayResult,
  ShadowReplayRun,
  ShadowReplaySample,
  ShadowReplayStoreContract,
} from '../src/shadowReplay/ShadowReplayStoreContract.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const MIGRATION = join(
  ROOT,
  'integration-service',
  'schema-migrations',
  SHADOW_REPLAY_STORE_SCHEMA_MIGRATION,
);
const STORE_FILES = [
  join(ROOT, 'integration-service', 'src', 'shadowReplay', 'ShadowReplayStoreTypes.ts'),
  join(ROOT, 'integration-service', 'src', 'shadowReplay', 'ShadowReplayStoreContract.ts'),
];

function sql(): string {
  return readFileSync(MIGRATION, 'utf8');
}

function storeSource(): string {
  return STORE_FILES.map((path) => readFileSync(path, 'utf8')).join('\n');
}

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2)
    ? ((<T>() => T extends B ? 1 : 2) extends (<T>() => T extends A ? 1 : 2) ? true : false)
    : false;
type Assert<T extends true> = T;

type _RunDryRunLiteral = Assert<Equal<ShadowReplayRun['dry_run'], true>>;
type _RunHmlOnlyLiteral = Assert<Equal<ShadowReplayRun['hml_only'], true>>;
type _RunOutboundNullLiteral = Assert<Equal<ShadowReplayRun['outbound_null_enforced'], true>>;
type _SampleHashPresent = Assert<Equal<ShadowReplaySample['source_ref_hash'], string>>;
type _ResultStatusClosedSet = Assert<
  Equal<ShadowReplayResult['decision_status'], 'not_run' | 'simulated' | 'blocked' | 'failed'>
>;
type _AuditSeverityClosedSet = Assert<
  Equal<ShadowReplayAuditEvent['severity'], 'debug' | 'info' | 'warning' | 'error'>
>;
type _ContractCreateRunReturn = Assert<
  Equal<ReturnType<ShadowReplayStoreContract['createRun']>, Promise<ShadowReplayRun>>
>;
type _ContractSampleListReadonly = Assert<
  Equal<ReturnType<ShadowReplayStoreContract['listSamplesByRun']>, Promise<readonly ShadowReplaySample[]>>
>;

type _ProofMarkers = [
  _RunDryRunLiteral,
  _RunHmlOnlyLiteral,
  _RunOutboundNullLiteral,
  _SampleHashPresent,
  _ResultStatusClosedSet,
  _AuditSeverityClosedSet,
  _ContractCreateRunReturn,
  _ContractSampleListReadonly,
];
type _ProofCount = Assert<Equal<_ProofMarkers['length'], 8>>;

describe('G3 Shadow Store migration contract', () => {
  const migrationSql = sql();

  it('creates only isolated shadow_replay tables', () => {
    for (const table of [
      'shadow_replay_runs',
      'shadow_replay_samples',
      'shadow_replay_results',
      'shadow_replay_audit_events',
    ]) {
      expect(migrationSql).toContain(`CREATE TABLE IF NOT EXISTS public.${table}`);
    }
    expect(migrationSql).not.toMatch(/CREATE\s+TABLE\s+(?!IF\s+NOT\s+EXISTS\s+public\.shadow_replay_)/i);
  });

  it('does not mutate existing operational tables', () => {
    expect(migrationSql).not.toMatch(/\bALTER\b/i);
    expect(migrationSql).not.toMatch(/\bINSERT\b/i);
    expect(migrationSql).not.toMatch(/\bUPDATE\b/i);
    expect(migrationSql).not.toMatch(/\bDELETE\b/i);
    expect(migrationSql).not.toMatch(/\bTRUNCATE\b/i);
    expect(migrationSql).not.toMatch(/\bDROP\b/i);
  });

  it('does not reference operational records or providers', () => {
    expect(migrationSql).not.toMatch(/glpi_|conversations?|messages?|whatsapp|meta_api|logmein|redis/i);
  });

  it('does not define obvious direct personal-data columns', () => {
    expect(migrationSql).not.toMatch(/\b(phone|email|cpf|cnpj|customer_name|requester_name|user_name)\b/i);
    expect(migrationSql).not.toMatch(/\bticket(_id|_number)?\b/i);
  });

  it('stores sanitized metadata and hash references only', () => {
    expect(migrationSql).toMatch(/sanitized_[a-z_]+_metadata_json JSONB/);
    expect(migrationSql).toMatch(/_hash TEXT/);
    expect(migrationSql).not.toMatch(/raw_payload|payload_json|body_text|message_text|transcript/i);
  });

  it('has idempotent indexes for run/status/hash lookups', () => {
    expect(migrationSql).toContain('CREATE INDEX IF NOT EXISTS idx_shadow_replay_runs_status_created_at');
    expect(migrationSql).toContain('CREATE INDEX IF NOT EXISTS idx_shadow_replay_results_run_status');
    expect(migrationSql).toContain('CREATE INDEX IF NOT EXISTS idx_shadow_replay_samples_source_ref_hash');
  });
});

describe('G3 Shadow Store TypeScript contract', () => {
  const src = storeSource();

  it('declares the schema contract version without runtime wiring', () => {
    expect(SHADOW_REPLAY_STORE_CONTRACT_VERSION).toBe('g3_shadow_store_v1');
    expect(SHADOW_REPLAY_STORE_SCHEMA_MIGRATION).toBe('061_shadow_replay_store.sql');
  });

  it('does not import database, cache or operational adapters', () => {
    expect(src).not.toMatch(/from ['"]pg['"]/);
    expect(src).not.toMatch(/from ['"]ioredis['"]/);
    expect(src).not.toMatch(/from ['"]redis['"]/);
    expect(src).not.toContain('adapters/');
    expect(src).not.toContain('buildDependencies');
    expect(src).not.toContain('OutboundMessageService');
    expect(src).not.toContain('MetaClient');
    expect(src).not.toContain('GlpiClient');
  });

  it('does not contain executable network or process side effects', () => {
    expect(src).not.toMatch(/\bfetch\s*\(/);
    expect(src).not.toMatch(/\bimport\s*\(/);
    expect(src).not.toMatch(/\bprocess\.env\b/);
    expect(src).not.toMatch(/\bnew\s+Client\b/);
  });

  it('keeps runtime guarantees literal-false/true by type', () => {
    const run: ShadowReplayRun = {
      run_id: 'shadow:run:001',
      run_hash: 'a'.repeat(64),
      source_window_hash: null,
      status: 'planned',
      dry_run: true,
      hml_only: true,
      outbound_null_enforced: true,
      contract_version: 'g3_shadow_store_v1',
      created_by_ref_hash: null,
      started_at: null,
      finished_at: null,
      created_at: '2026-06-22T00:00:00.000Z',
      sanitized_metadata: {},
      safety_flags: {},
    };
    expect(run.dry_run).toBe(true);
    expect(run.hml_only).toBe(true);
    expect(run.outbound_null_enforced).toBe(true);
  });
});
