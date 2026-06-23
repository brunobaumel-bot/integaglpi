# V10 Shadow Replay Lab - G3 Shadow Store Schema Contract

Phase: `integaglpi_v10_shadow_replay_lab_g3_shadow_store_schema_contract_001`

Status: `IMPLEMENTED_PENDING_CURSOR_REVIEW`

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

The file is versioned only. It was not applied to any database.

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

- Migration applied: `false`
- PostgreSQL connected: `false`
- Redis connected: `false`
- Plugin changed: `false`
- Operational Node runtime changed: `false`
- Production touched: `false`
- Shadow Replay runtime allowed: `false`
- Production release allowed: `false`

## 8. Next Gate

Required Cursor review:

`integaglpi_v10_shadow_replay_lab_g3_shadow_store_schema_contract_cursor_review_001`

Only after review can a manual commit be considered. Any database application, runtime worker, ingestion or replay requires a later explicit phase.
