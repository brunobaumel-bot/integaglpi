# V10 Shadow Replay Lab G6 — Sample Envelope Sanitizer Contract

Phase: `integaglpi_v10_shadow_replay_lab_g6_sample_envelope_sanitizer_contract_001`

Status: `IMPLEMENTED_PENDING_CURSOR_REVIEW`

## Scope

G6 creates a contract-only TypeScript boundary for sanitized Shadow Replay sample
envelopes. It does not create a runtime, worker, database adapter, replay
pipeline, exporter, live tee or ingestion path.

Allowed inputs in this phase are synthetic only. The envelope can be used by a
future phase only after separate review and explicit runtime authorization.

## Files

- `integration-service/src/shadowReplay/ShadowReplaySampleEnvelope.ts`
- `integration-service/src/shadowReplay/ShadowReplaySampleSanitizer.ts`
- `integration-service/src/shadowReplay/ShadowReplaySampleValidation.ts`
- `integration-service/tests/v10ShadowReplaySampleEnvelopeSanitizer.test.ts`

## Contract

The sanitized envelope contains only:

- synthetic `run_id`;
- synthetic `sample_id`;
- synthetic `source_kind`;
- `source_ref_hash`;
- `sanitized_problem_summary`;
- `sanitized_technical_summary`;
- synthetic classification metadata;
- sanitized metadata;
- redaction report without original values;
- timestamps;
- `g6_sample_envelope_v1` schema version.

The contract blocks or redacts:

- phone numbers;
- e-mail addresses;
- CPF/CNPJ-like values;
- token/API-key/secret-like values;
- URLs containing sensitive query parameters;
- ticket/protocol-like references;
- person-name markers;
- private keys;
- long base64-like blobs;
- HTML/script fragments.

Forbidden raw keys such as `raw_payload`, `payload_json`, `transcript`,
`message_text`, `body_text` and `messages` are rejected before envelope creation.

## Validation

`validateShadowReplaySampleEnvelope` is pure and returns structured issue codes
and paths only. It never echoes sensitive values.

Validation blocks:

- non-synthetic ids;
- non-hash source references;
- unsupported source kinds;
- empty sanitized summaries;
- residual sensitive-data patterns;
- forbidden raw-data keys in sanitized metadata;
- schema version mismatch.

## Safety

- PostgreSQL touched: `false`
- Redis touched: `false`
- GLPI/plugin touched: `false`
- Operational Node runtime changed: `false`
- Migration/schema changed: `false`
- HML deploy done: `false`
- Production touched: `false`
- Real tickets/conversations read: `false`
- Meta/WhatsApp/e-mail/LogMeIn/GLPI/cloud/IA called: `false`
- Shadow Replay runtime allowed: `false`
- Production release allowed: `false`

## Tests

Target tests cover:

- synthetic e-mail redaction;
- synthetic phone redaction;
- synthetic CPF/CNPJ redaction;
- synthetic token redaction;
- URL-secret redaction;
- ticket/protocol reference redaction;
- raw payload/transcript/messages rejection;
- no original values in the redaction report;
- clean envelope validation;
- contaminated envelope validation failure;
- side-effect import scan for the new G6 files.

Regression tests required before review:

- `npx tsc --noEmit`
- `npx tsc -p tsconfig.shadow-replay.json --noEmit`
- `npx vitest run tests/v10ShadowReplaySampleEnvelopeSanitizer.test.ts --reporter=dot`
- `npx vitest run tests/v10ShadowReplayStoreSchema.test.ts --reporter=dot`
- `npx vitest run tests/v10ShadowReplayOutboundNullIsolation.test.ts --reporter=dot`

## Next Gate

Required Cursor review:

`integaglpi_v10_shadow_replay_lab_g6_sample_envelope_sanitizer_contract_cursor_review_001`

Runtime worker, ingestion, exporter, replay, live tee, DB persistence or
production promotion still require later explicit phases.
