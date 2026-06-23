# V10 Shadow Replay Lab - G3 Shadow Store Schema Contract

Phase: `integaglpi_v10_shadow_replay_lab_g3_shadow_store_schema_contract_001`

Status: `HML_MIGRATION_APPLIED_PENDING_CURSOR_REVIEW`

## 1. Scope

G3 creates only the contractual base for a future Shadow Store:

- additive SQL migration file, not applied;
- TypeScript types and storage boundary interface;
- static safety tests;
- documentation/ledger update.

No runtime replay, ingestion, worker, live tee, database connection, external call or production action exists in this phase.

## 2. Inputs

- G2 runtime commit: `e933fdaf59417d137ced2705bd6435ba25806852`
- G2 docs/hash commit: `c20f75fc94353bc956ac24c8cba9a960759fc0b6`
- G2 HML smoke: `HML_PASS_WITH_RESSALVAS`
- G2 authoritative build subset hash:
  `04727b9a9919b9b1a1496a286323d4db68cb4d3fbb5ec17f9fc36dc0e3f99054`

## 3. Migration Contract

File: `integration-service/schema-migrations/061_shadow_replay_store.sql`

The file was versioned in G3 and applied only to the HML PostgreSQL container in
the controlled G4 migration smoke. It was not applied to production.

Tables:

- `shadow_replay_runs`
- `shadow_replay_samples`
- `shadow_replay_results`
- `shadow_replay_audit_events`

Properties:

- isolated `shadow_replay_*` names;
- additive `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`;
- no alteration of existing tables;
- no triggers on operational tables;
- no foreign keys to operational records;
- hash-only synthetic references;
- sanitized JSONB metadata only;
- status/hash/run indexes for future bounded queries.

## 4. Data Boundaries

The schema intentionally excludes:

- direct personal identifiers;
- real record numbers;
- raw source bodies;
- raw provider payloads;
- provider tokens or credentials;
- external action outputs.

Future ingestion must pass a separate gate before any row is inserted.

## 5. TypeScript Contract

Files:

- `integration-service/src/shadowReplay/ShadowReplayStoreTypes.ts`
- `integration-service/src/shadowReplay/ShadowReplayStoreContract.ts`

The TypeScript contract defines:

- `ShadowReplayRun`
- `ShadowReplaySample`
- `ShadowReplayResult`
- `ShadowReplayAuditEvent`
- `ShadowReplayStoreContract`

The contract has no database client, no cache client, no operational adapter import and no write implementation.

## 6. Tests

File: `integration-service/tests/v10ShadowReplayStoreSchema.test.ts`

Static assertions cover:

- isolated table names;
- no operational table mutation;
- no direct personal-data columns;
- no raw body/provider payload storage;
- idempotent indexes;
- no database/cache/adapter imports in the contract;
- literal dry-run/HML/outbound-null guarantees.

## 7. Safety State

- Migration applied in HML: `true`
- Migration applied in production: `false`
- PostgreSQL HML connected: `true`
- Redis connected: `false`
- Plugin changed: `false`
- Operational Node runtime changed: `false`
- Production touched: `false`
- Shadow Replay runtime allowed: `false`
- Production release allowed: `false`

## 8. G4 HML Migration Smoke

Phase:
`integaglpi_v10_shadow_replay_lab_g4_shadow_store_hml_migration_smoke_001`.

Execution summary:

- HML target container: `glpi-integaglpi-postgres`.
- Production containers: not touched.
- Migration file: `integration-service/schema-migrations/061_shadow_replay_store.sql`.
- Migration SHA-256:
  `8f70a3941cbec857ea8d78f2a50b31d36074ac6247a8a57086ce53697b43e624`.
- Pre-apply schema backup on HML host:
  `/tmp/integaglpi_g4_pre_schema_20260623T010255Z.sql`.
- Apply mode: `psql -v ON_ERROR_STOP=1 -1`, transactional.
- Apply result: `ok`.

Created HML tables:

- `shadow_replay_runs`
- `shadow_replay_samples`
- `shadow_replay_results`
- `shadow_replay_audit_events`

Created HML indexes/constraints:

- `shadow_replay_runs_pkey`
- `ux_shadow_replay_runs_run_id`
- `idx_shadow_replay_runs_run_hash`
- `idx_shadow_replay_runs_status_created_at`
- `shadow_replay_samples_pkey`
- `ux_shadow_replay_samples_sample_id`
- `idx_shadow_replay_samples_run_id_sequence`
- `idx_shadow_replay_samples_source_ref_hash`
- `shadow_replay_results_pkey`
- `ux_shadow_replay_results_result_id`
- `idx_shadow_replay_results_run_status`
- `idx_shadow_replay_results_result_hash`
- `shadow_replay_audit_events_pkey`
- `ux_shadow_replay_audit_events_event_id`
- `idx_shadow_replay_audit_events_run_created_at`

Post-apply checks:

- All four `shadow_replay_*` tables are empty (`0` rows).
- Forbidden-column scan returned no matches for phone, email, CPF/CNPJ, ticket,
  raw payload, payload JSON, message text, transcript or requester/customer/user
  name columns.
- No ingestion, exporter, replay worker, live tee, backfill, Redis/FSM mutation or
  operational runtime wiring was created.

## 9. Next Gate

Required Cursor review:

`integaglpi_v10_shadow_replay_lab_g4_shadow_store_hml_migration_smoke_cursor_review_001`

Runtime worker, ingestion, exporter, replay, live tee or any production
promotion still require a later explicit phase.
