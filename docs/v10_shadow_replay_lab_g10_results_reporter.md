# V10 Shadow Replay Lab — G10 Results Reporter

PHASE: `integaglpi_v10_shadow_replay_lab_g10_results_reporter_001`
Status: `IMPLEMENTED_PENDING_CURSOR_REVIEW`
Data: 2026-06-23
Base: `ddc75cc` (G9 dry-run runner)

---

## Escopo

Reporter manual **read-only** que:

- Lê somente tabelas `shadow_replay_*` (runs, samples, results, audit_events).
- Agrega métricas técnicas de execução dry-run já gravadas pelo G9.
- Exporta JSON (padrão) ou Markdown local.
- Nunca escreve em banco, nunca chama GLPI/Meta/Redis/IA.
- Nunca registra worker, cron ou runtime em `app.ts`.

---

## Arquivos produzidos

| Arquivo | Tipo |
|---|---|
| `integration-service/src/shadowReplay/ShadowReplayStoreReadContract.ts` | contrato read-only |
| `integration-service/src/shadowReplay/ShadowReplayResultsReporterTypes.ts` | tipos do relatório |
| `integration-service/src/shadowReplay/ShadowReplayResultsReporter.ts` | agregação, sanitização, serialização |
| `integration-service/src/shadowReplay/ShadowReplayPostgresReader.ts` | adapter PostgreSQL SELECT-only |
| `integration-service/scripts/v10ShadowReplayResultsReporter.mjs` | CLI manual |
| `integration-service/tests/v10ShadowReplayResultsReporter.test.ts` | testes unitários/contratuais |
| `docs/v10_shadow_replay_lab_g10_results_reporter.md` | este doc |
| `docs/v10_status_ledger.md` | atualizado |

---

## Filtros seguros

| Filtro | Descrição |
|---|---|
| `run_id` | Run específico |
| `status` | Status do run (`planned`, `running`, `completed`, `failed`, `aborted`) |
| `from` / `to` | Intervalo ISO em `created_at` |
| `synthetic_only` | Apenas registros sintéticos (`metadata.synthetic`, `safety_flags.synthetic` ou prefixo `shadow-`) |
| `limit` | Limite por tabela (default 500, max 5000 no CLI) |

---

## Relatório (`g10_results_reporter_v1`)

Campos principais:

- `totals`: runs, samples, results, audit_events
- `runs_by_status`, `results_by_decision_status`
- `blocked_failed_pass`: blocked / failed / pass (`simulated`)
- `durations_ms`: min/max/avg quando `started_at`/`finished_at` existem
- `top_blocking_reasons`: agregação de `error_code` / `dry_run_status`
- `safety_flags_observed`: flags `true` observadas nos runs
- `runs[]`: resumo por run (sem payload bruto)
- Literais: `read_only: true`, `runtime_worker_created: false`, `external_actions_allowed: false`

---

## Sanitização / PII

- `assertShadowReplayStoreDataSanitized()` rejeita chaves proibidas (`raw_payload`, `transcript`, `messages`, `phone`, `token`, etc.).
- `maskShadowReplayResultsReportForOutput()` redige valores PII-like no JSON final.
- CLI valida saída antes de imprimir (sem connection string, sem Bearer, sem PII).

---

## CLI manual

**Pré-requisito:** compilar subset Shadow Replay:

```bash
cd integration-service
npx tsc -p tsconfig.shadow-replay.json
```

**Execução (HML — operador define URL explicitamente; script NÃO carrega `.env`):**

```bash
SHADOW_REPLAY_REPORT_DATABASE_URL='postgres://user:pass@host:5432/db' \
  node scripts/v10ShadowReplayResultsReporter.mjs

SHADOW_REPLAY_REPORT_DATABASE_URL='postgres://...' \
  node scripts/v10ShadowReplayResultsReporter.mjs --format=markdown --synthetic-only
```

Opções: `--run-id`, `--status`, `--from`, `--to`, `--synthetic-only`, `--limit`.

---

## Testes

```bash
cd integration-service
npx tsc --noEmit
npx tsc -p tsconfig.shadow-replay.json --noEmit
npx vitest run tests/v10ShadowReplay*.test.ts --reporter=dot
```

---

## Gates / bloqueios preservados

- `shadow_replay_runtime_allowed=false`
- `production_release_allowed=false`
- Sem migration/schema
- Sem deploy automático
- G9 HML smoke permanece válido; G10 é camada de leitura sobre dados já gravados
