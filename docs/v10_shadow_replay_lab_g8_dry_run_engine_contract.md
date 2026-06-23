# V10 Shadow Replay Lab G8 — Dry-run Replay Engine Contract

Phase: `integaglpi_v10_shadow_replay_lab_g8_dry_run_replay_engine_contract_001`

Status: `IMPLEMENTED_PENDING_CURSOR_REVIEW`

## Scope

G8 creates a pure, in-memory dry-run contract for a future Shadow Replay engine.
It accepts only a G6 sanitized sample envelope and validates that envelope before
simulating a replay result.

This phase does not create a worker, runtime, adapter, scheduler, database
client, replay pipeline, ingestion path, exporter, outbox or live tee.

## Files

- `integration-service/src/shadowReplay/ShadowReplayDryRunEngineTypes.ts`
- `integration-service/src/shadowReplay/ShadowReplayDryRunEngine.ts`
- `integration-service/tests/v10ShadowReplayDryRunEngineContract.test.ts`

## Contract

`runShadowReplayDryRun(input)` returns only an in-memory synthetic result:

- synthetic `run_id`;
- synthetic `sample_id`;
- `source_ref_hash`;
- deterministic `result_hash`;
- status and decision;
- operations checked;
- operations blocked;
- validation issues and violations by code/path only;
- sanitized summaries;
- sanitized/synthetic metadata;
- literal safety flags:
  - `would_persist=false`;
  - `external_actions_allowed=false`;
  - `ai_called=false`;
  - `runtime_worker_created=false`.

## Rejection Rules

The engine rejects the input before replay simulation when G6 validation fails,
including:

- residual PII;
- forbidden raw-data keys such as `raw_payload`, `transcript` or `messages`;
- non-hash `source_ref_hash`;
- unsupported envelope schema or synthetic id contract violations.

Validation issues are returned without echoing sensitive original values.

## Blocked Operations

The dry-run result always marks these surfaces as blocked or skipped:

- Shadow Store persistence;
- AI/local-cloud calls;
- Meta/WhatsApp/e-mail/LogMeIn/GLPI/cloud calls;
- external action execution;
- persistent runtime/worker creation.

No write is marked as executed.

## Safety

- PostgreSQL touched: `false`
- Redis touched: `false`
- Shadow Store write: `false`
- GLPI/plugin touched: `false`
- Operational Node runtime changed: `false`
- Migration/schema changed: `false`
- HML deploy done: `false`
- Production touched: `false`
- Real tickets/conversations read: `false`
- PII/raw payload accepted: `false`
- Meta/WhatsApp/e-mail/LogMeIn/GLPI/cloud/IA called: `false`
- Shadow Replay runtime allowed: `false`
- Production release allowed: `false`

## Tests

Target tests cover:

- clean G6 envelope accepted;
- contaminated envelope rejected;
- `raw_payload`, `transcript` and `messages` blocked;
- non-hash source reference rejected;
- no PII/original values in result;
- external actions not allowed;
- writes never marked as executed;
- simulated operations are blocked/skipped where required;
- deterministic `result_hash` for the same synthetic input.

Regression tests required before review:

- `npx tsc --noEmit`
- `npx tsc -p tsconfig.shadow-replay.json --noEmit`
- `npx vitest run tests/v10ShadowReplayDryRunEngineContract.test.ts --reporter=dot`
- `npx vitest run tests/v10ShadowReplaySampleEnvelopeSanitizer.test.ts --reporter=dot`
- `npx vitest run tests/v10ShadowReplaySanitizedEnvelopeStoreSmoke.test.ts --reporter=dot`
- `npx vitest run tests/v10ShadowReplayStoreSchema.test.ts --reporter=dot`
- `npx vitest run tests/v10ShadowReplayOutboundNullIsolation.test.ts --reporter=dot`

## Next Gate

Required Cursor review:

`integaglpi_v10_shadow_replay_lab_g8_dry_run_replay_engine_contract_cursor_review_001`

Runtime worker, database persistence, replay execution, ingestion, exporter,
live tee or production promotion still require later explicit phases.
