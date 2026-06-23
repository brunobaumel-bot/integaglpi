# V10 Shadow Replay Lab G7 — Sanitized Envelope Store HML Smoke

Phase: `integaglpi_v10_shadow_replay_lab_g7_sanitized_envelope_store_smoke_001`

Status: `HML_PASS_PENDING_CURSOR_REVIEW`

## Scope

G7 validates that a G6 sanitized sample envelope can be mapped into the G3
shadow store tables using a manual HML `psql` transaction that always ends in
`ROLLBACK`. No Node database adapter, worker, deploy or operational runtime
is involved.

## Files

- `integration-service/scripts/v10ShadowReplaySanitizedEnvelopeStoreSmoke.mjs`
- `integration-service/tests/v10ShadowReplaySanitizedEnvelopeStoreSmoke.test.ts`

## Flow

1. Build isolated shadow replay artifacts: `npx tsc -p tsconfig.shadow-replay.json`.
2. Run the G7 script locally to emit SQL only (stdout).
3. Preflight on HML Postgres: four `shadow_replay_*` tables must be empty.
4. Execute emitted SQL inside `glpi-integaglpi-postgres` with `ON_ERROR_STOP=1`.
5. Confirm in-transaction counts are `1` for each shadow table scoped to the run id.
6. Confirm post-rollback counts remain `0` on all four shadow tables.
7. Confirm no operational tables were read or written.

## Envelope contract

- Uses `createShadowReplaySampleEnvelope` and `validateShadowReplaySampleEnvelope` from compiled G6 modules.
- Synthetic redaction inputs only: ticket `9999000001` and protocol `999900` (never emitted in SQL output).
- Run metadata JSONB shape: `{"synthetic": true, "phase": "g7", "sanitized": true}`.

## Safety

- PostgreSQL touched: `true` (HML shadow tables only, transactional rollback)
- Redis touched: `false`
- GLPI/plugin touched: `false`
- Operational Node runtime changed: `false`
- Migration/schema changed: `false`
- HML deploy done: `false`
- Production touched: `false`
- Real tickets/conversations read: `false`
- Meta/WhatsApp/e-mail/LogMeIn/GLPI/cloud/IA called: `false`

## HML execution record

- Container: `glpi-integaglpi-postgres`
- Production containers: not touched
- Transaction mode: explicit `BEGIN` followed by explicit `ROLLBACK`
- `COMMIT` usage: `false`

### Results (2026-06-23)

- Preflight shadow table counts: `0` on all four tables.
- Synthetic run id: `shadow-envelope-smoke-20260623130644`.
- In-transaction validation counts: `1` row each in
  `shadow_replay_runs`, `shadow_replay_samples`, `shadow_replay_results`,
  `shadow_replay_audit_events`.
- Post-rollback shadow table counts: `0` on all four tables.
- Operational probe (`public.conversations` count): unchanged (`0` before and after).
- `COMMIT` used: `false`.
- Run metadata JSONB: `{"synthetic": true, "phase": "g7", "sanitized": true}`.
- Local validations: `tsc --noEmit` ok, `tsc -p tsconfig.shadow-replay.json --noEmit` ok,
  vitest G7/G6/store schema/G2 null isolation `53/53` passed.

## Next gate

`integaglpi_v10_shadow_replay_lab_g7_sanitized_envelope_store_smoke_cursor_review_001`