# Shadow Replay Lab — Curated Sample Pack v1

PHASE: `integaglpi_v10_shadow_replay_lab_g15_curated_sample_pack_001`
Generator: `scripts/v10ShadowReplayGenerateSamplePack.mjs`
Validator: `scripts/v10ShadowReplayValidateSamplePack.mjs`

---

## Contents

| File | Description |
|---|---|
| `samples.sanitized.jsonl` | 10 synthetic G6 envelopes (8 valid, 2 invalid) |
| `expected-manifest.json` | Expected validation manifest |
| `README.md` | This document |

---

## Samples

| Line | ID | Category | Valid |
|---|---|---|---|
| 1 | shadow-run-g15-curated-vpn-001 | vpn | yes |
| 2 | shadow-run-g15-curated-remote-001 | remote_access | yes |
| 3 | shadow-run-g15-curated-login-001 | password_login | yes |
| 4 | shadow-run-g15-curated-printer-001 | printer | yes |
| 5 | shadow-run-g15-curated-network-001 | network_no_internet | yes |
| 6 | shadow-run-g15-curated-slow-001 | slow_performance | yes |
| 7 | shadow-run-g15-curated-email-001 | email_issue | yes |
| 8 | shadow-run-g15-curated-syserr-001 | system_error | yes |
| 9 | shadow-run-g15-invalid-rawpayload-001 | — | no (raw_key_forbidden) |
| 10 | shadow-run-g15-invalid-sourceref-001 | — | no (source_ref_not_hash) |

---

## Validate

```bash
cd integration-service
npx tsc -p tsconfig.shadow-replay.json
node scripts/v10ShadowReplayValidateSamplePack.mjs \
  --input shadow-replay-samples/curated-v1/samples.sanitized.jsonl \
  --expect shadow-replay-samples/curated-v1/expected-manifest.json \
  --format json
```

Exit code 0 = PASS. Exit code 1 = FAIL or error.

---

## Regenerate

```bash
cd integration-service
npx tsc -p tsconfig.shadow-replay.json
node scripts/v10ShadowReplayGenerateSamplePack.mjs
```

---

## Safety

- All samples are **synthetic** — no real tickets, users, phones, CPF/CNPJ or e-mails.
- No DB access, no Redis, no GLPI, no Meta/WhatsApp, no AI calls.
- PII guard: `pii_detected=false` in all valid samples.
- `read_only: true`, `db_accessed: false`, `external_actions_allowed: false` are structural literal types.
