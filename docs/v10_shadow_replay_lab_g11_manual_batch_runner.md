# V10 Shadow Replay Lab — G11 Manual Batch Runner

PHASE: `integaglpi_v10_shadow_replay_lab_g11_manual_batch_runner_001`
Status: `IMPLEMENTED_PENDING_CURSOR_REVIEW`
Data: 2026-06-23
Base: `39b0ed80095430b2aadfdff87e3e8c4c68fa4df6` (G10 results reporter)

---

## Escopo

Batch runner manual para processar um arquivo JSONL local contendo uma amostra
G6 sanitizada por linha.

O runner:

- valida JSONL linha a linha;
- bloqueia `raw_payload`, `messages`, `transcript` e `source_ref` cru;
- valida envelopes G6;
- executa cada envelope via runner G9;
- persiste somente em tabelas `shadow_replay_*` quando não estiver em `--dry-run`;
- suporta `--rollback` com transação PostgreSQL;
- reaproveita o reporter G10 para resumo JSON/Markdown;
- não registra runtime, worker, cron ou `app.ts`.

---

## Arquivos produzidos

| Arquivo | Tipo |
|---|---|
| `integration-service/src/shadowReplay/ShadowReplayManualBatchRunner.ts` | batch runner manual/testável |
| `integration-service/scripts/v10ShadowReplayManualBatchRunner.mjs` | CLI manual HML/dev |
| `integration-service/tests/v10ShadowReplayManualBatchRunner.test.ts` | testes unitários/contratuais |
| `docs/v10_shadow_replay_lab_g11_manual_batch_runner.md` | este documento |
| `docs/v10_status_ledger.md` | ledger atualizado |

Também foi ajustado o resumo de redaction gravado pelo G9 para usar chaves
compatíveis com o PII guard do reporter G10, sem perder contagens.

---

## CLI manual

Pré-requisito:

```bash
cd integration-service
npx tsc -p tsconfig.shadow-replay.json
```

Execução:

```bash
SHADOW_REPLAY_BATCH_DATABASE_URL='postgres://user:pass@host:5432/db' \
  node scripts/v10ShadowReplayManualBatchRunner.mjs \
  --input samples.jsonl \
  --synthetic-only \
  --rollback \
  --report json
```

Opções:

- `--input <file.jsonl>`: obrigatório.
- `--dry-run`: usa Shadow Store em memória; não grava no banco.
- `--rollback`: executa `BEGIN` e finaliza com `ROLLBACK`.
- `--synthetic-only`: exige IDs sintéticos `shadow-*`.
- `--fail-fast`: interrompe após primeira linha rejeitada ou envelope bloqueado.
- `--report json|markdown`: formato final.

O script exige `SHADOW_REPLAY_BATCH_DATABASE_URL`, não carrega `.env` e nunca
imprime a connection string.

---

## Formato JSONL

Cada linha deve ser um `ShadowReplaySampleEnvelope` G6 já sanitizado. Exemplo
abreviado:

```json
{"schema_version":"g6_sample_envelope_v1","run_id":"shadow-run-g11-demo-001","sample_id":"shadow-sample-g11-demo-001","source_kind":"synthetic_case","source_ref_hash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","sanitized_problem_summary":"Caso sintetico sem PII.","sanitized_technical_summary":"Resumo tecnico sintetico.","classification_metadata":{"category":"vpn"},"sanitized_metadata":{"synthetic":true},"redaction_report":{"redacted":{"email":0,"phone":0,"cpf_cnpj":0,"token":0,"url_secret":0,"ticket_protocol":0,"person_name":0,"private_key":0,"base64":0,"html":0},"truncated_fields":[],"forbidden_keys":[],"residual_pii_detected":false},"observed_at":"2026-06-23T00:00:00.000Z","created_at":"2026-06-23T00:00:00.000Z"}
```

Entradas com payload bruto, transcript, mensagens brutas ou referência de origem
não hash são rejeitadas antes de chamar o G9.

---

## Persistência

Somente estas tabelas podem receber escrita:

- `shadow_replay_runs`
- `shadow_replay_samples`
- `shadow_replay_results`
- `shadow_replay_audit_events`

O runner não escreve em tabelas operacionais e não acessa GLPI, Meta, WhatsApp,
Redis, IA ou tickets reais.

---

## Relatório

O resultado final inclui:

- sumário G11 (`processed`, `simulated`, `blocked`, `rejected`);
- linhas rejeitadas com código e motivo seguro;
- relatório G10 mascarado (`g10_results_reporter_v1`).

JSON e Markdown usam dados sanitizados e passam por guarda de saída contra PII e
credenciais.

---

## Testes

```bash
cd integration-service
npx tsc --noEmit
npx tsc -p tsconfig.shadow-replay.json --noEmit
npx vitest run tests/v10ShadowReplay*.test.ts --reporter=dot
```

Cobertura específica G11:

- JSONL válido com múltiplas linhas;
- linha JSON inválida;
- `raw_payload` bloqueado;
- `source_ref` cru bloqueado;
- PII residual bloqueada via G6/G9;
- `--synthetic-only`;
- `--fail-fast`;
- `--dry-run`;
- intenção de `--rollback`;
- saída JSON/Markdown com reporter G10;
- isolamento sem GLPI/Meta/Redis/IA/runtime.

---

## Gates preservados

- `shadow_replay_runtime_allowed=false`
- `production_release_allowed=false`
- sem worker/cron/runtime
- sem `app.ts`
- sem migration/schema
- sem deploy
- sem produção
