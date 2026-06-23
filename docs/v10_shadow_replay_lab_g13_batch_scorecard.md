# V10 Shadow Replay Lab — G13 Batch Scorecard

PHASE: `integaglpi_v10_shadow_replay_lab_g13_batch_scorecard_001`
Status: `IMPLEMENTED_PENDING_CURSOR_REVIEW`
Data: 2026-06-23
Base: `f1ed0a1f6a71615941a6bbb30aa72597876c3c02` (G11 manual batch runner)

---

## Escopo

Scorecard manual/read-only para avaliar a saída JSON do batch runner G11 e do
reporter G10 contra um manifesto local de expectativas sintéticas.

O scorecard:

- lê somente arquivos JSON locais;
- não acessa banco;
- não carrega `.env`;
- não chama GLPI, Meta, WhatsApp, Redis ou IA;
- não cria runtime, worker ou cron;
- não altera schema/migration;
- produz saída JSON ou Markdown;
- emite verdict determinístico: `PASS`, `PASS_WITH_RESSALVAS` ou `FAIL`.

---

## Arquivos produzidos

| Arquivo | Tipo |
|---|---|
| `integration-service/src/shadowReplay/ShadowReplayBatchScorecard.ts` | scorecard read-only |
| `integration-service/scripts/v10ShadowReplayBatchScorecard.mjs` | CLI manual |
| `integration-service/tests/v10ShadowReplayBatchScorecard.test.ts` | testes unitários/contratuais |
| `docs/v10_shadow_replay_lab_g13_batch_scorecard.md` | este documento |
| `docs/v10_status_ledger.md` | ledger atualizado |

---

## Manifesto esperado

Exemplo:

```json
{
  "expected_processed": 2,
  "expected_simulated": 2,
  "expected_rejected": 1,
  "expected_rejection_codes": ["raw_key_forbidden"],
  "required_safety_flags": ["dry_run", "g9_runner", "hml_only", "outbound_null_enforced"],
  "max_failed": 0,
  "max_unexpected_blocked": 0,
  "pii_must_be_absent": true,
  "credentials_must_be_absent": true
}
```

---

## CLI manual

Pré-requisito:

```bash
cd integration-service
npx tsc -p tsconfig.shadow-replay.json
```

Execução:

```bash
node scripts/v10ShadowReplayBatchScorecard.mjs \
  --report batch-report.json \
  --expect expected-manifest.json \
  --format json

node scripts/v10ShadowReplayBatchScorecard.mjs \
  --report batch-report.json \
  --expect expected-manifest.json \
  --format markdown
```

O script não usa banco, não exige connection string e não carrega `.env`.

---

## Regras de FAIL

O scorecard retorna `FAIL` quando detectar:

- PII no relatório;
- credencial ou connection string no relatório;
- external action liberada;
- runtime/worker criado;
- GLPI/Meta/Redis/IA acionado;
- escrita em tabela operacional;
- `processed` abaixo do esperado;
- `simulated` divergente;
- `rejected` divergente;
- códigos de rejeição divergentes;
- `failed` acima de `max_failed`;
- `unexpected_blocked` acima de `max_unexpected_blocked`;
- safety flag obrigatória ausente.

---

## PASS_WITH_RESSALVAS

Ressalvas não bloqueantes cobertas:

- `generated_at_epoch_cosmetic`: timestamp epoch herdado de default G10 quando
  o caller não passa `generatedAt`;
- campo opcional de detalhamento ausente sem impacto no verdict de segurança.

---

## Testes

```bash
cd integration-service
npx tsc --noEmit
npx tsc -p tsconfig.shadow-replay.json --noEmit
npx vitest run tests/v10ShadowReplay*.test.ts --reporter=dot
```

Cobertura específica G13:

- PASS com formato sintético da evidência G12;
- FAIL por PII;
- FAIL por credencial;
- FAIL por external action;
- FAIL por runtime/worker;
- FAIL por tabela operacional;
- FAIL por divergência de contadores;
- PASS_WITH_RESSALVAS por warning cosmético;
- saída JSON determinística;
- saída Markdown sem PII;
- isolamento sem DB/runtime/external adapters.

---

## Gates preservados

- `shadow_replay_runtime_allowed=false`
- `production_release_allowed=false`
- sem worker/cron/runtime
- sem `app.ts`
- sem banco
- sem migration/schema
- sem deploy
- sem produção
