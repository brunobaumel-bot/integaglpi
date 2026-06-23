# V10 Shadow Replay Lab — G9 Dry-Run Runner

PHASE: `integaglpi_v10_shadow_replay_lab_g9_dry_run_runner_001`
Status: `IMPLEMENTED_PENDING_CURSOR_REVIEW`
Data: 2026-06-23

---

## Escopo

Runner manual de dry-run que:

- Aceita somente envelope sanitizado G6 válido.
- Executa o DryRun Engine G8 em memória.
- Persiste resultado nos 4 Shadow Store tables (G3).
- Nunca chama GLPI, Meta, Redis, IA ou tabelas operacionais.
- Nunca cria worker, cron ou runtime.
- Registrado apenas como módulo de biblioteca (`src/shadowReplay/`), não em `app.ts`.

---

## Arquivos produzidos

| Arquivo | Tipo |
|---|---|
| `integration-service/src/shadowReplay/ShadowReplayDryRunRunner.ts` | novo — runner manual (puro, store injetável) |
| `integration-service/src/shadowReplay/ShadowReplayPostgresStore.ts` | novo — implementação PostgreSQL do ShadowReplayStoreContract |
| `integration-service/scripts/v10ShadowReplayDryRunRunnerSmoke.mjs` | novo — smoke SQL emitter (BEGIN + ROLLBACK, sem pg) |
| `integration-service/tests/v10ShadowReplayDryRunRunner.test.ts` | novo — 21 testes (runner + source isolation + smoke) |
| `docs/v10_shadow_replay_lab_g9_dry_run_runner.md` | este doc |
| `docs/v10_status_ledger.md` | atualizado |

---

## Runner — `ShadowReplayDryRunRunner.ts`

Função pura: `runShadowReplayDryRunManual(input, store)`:

1. Valida envelope com G6 (`validateShadowReplaySampleEnvelope`).
2. Executa G8 DryRun Engine (`runShadowReplayDryRun`).
3. Persiste sequencialmente via store injetado:
   - `store.createRun(...)` → `shadow_replay_runs`
   - `store.markRunStarted(...)`
   - `store.recordAuditEvent(...)` → `shadow_replay_audit_events` (start)
   - `store.recordSample(...)` → `shadow_replay_samples`
   - `store.recordResult(...)` → `shadow_replay_results`
   - `store.recordAuditEvent(...)` → `shadow_replay_audit_events` (finish)
   - `store.markRunFinished(...)`
4. Retorna `ShadowReplayDryRunRunnerOutput` com todas as garantias literais.

**Garantias literais (hardcoded no tipo):**
```typescript
would_persist: false;
external_actions_allowed: false;
ai_called: false;
runtime_worker_created: false;
```

**Proteção PII**: Quando `!envelopeValid`, `sampleInputMetadata.sanitized_problem_summary` usa `'[invalid_envelope_rejected]'` — nunca expõe conteúdo contaminado.

**Sem imports**: sem `pg`, sem `redis`, sem `http/https`, sem `process.env`, sem adaptadores operacionais.

---

## Postgres Store — `ShadowReplayPostgresStore.ts`

Implementa `ShadowReplayStoreContract`. Aceita `Pool` injetado (nunca lê env vars próprio).

**Proteção de tabelas:**
```typescript
const ALLOWED_TABLES = new Set([
  'shadow_replay_runs', 'shadow_replay_samples',
  'shadow_replay_results', 'shadow_replay_audit_events',
]);
function guardTable(name: string): void {
  if (!ALLOWED_TABLES.has(name)) throw new Error(`...forbidden.`);
}
```

Todas as queries usam `$1...$N` (parameterizadas, sem interpolação). JSONB armazenado via `JSON.stringify(...)`.

---

## Smoke Script — `v10ShadowReplayDryRunRunnerSmoke.mjs`

**SQL emitter**: gera `BEGIN + 1 INSERT runs + 1 UPDATE started + 2 INSERT audit_events + 1 INSERT samples + 1 INSERT results + 1 UPDATE finished + SELECT counts + ROLLBACK`.

- Importa SOMENTE de `dist-shadow-replay/` (G6 + G8 compilados — sem pg, sem redis, sem network, sem `process.env`).
- Sem `COMMIT` em lugar algum.
- Dados 100% sintéticos (sem ticket/telefone/email real).
- IDs: `shadow-run-g9-smoke-<ts>`, `shadow-sample-g9-smoke-<ts>`, etc.
- **Para executar em HML:** `node scripts/v10ShadowReplayDryRunRunnerSmoke.mjs | psql <connection_string>`

---

## Testes — 21/21 pass

| Grupo | Cobertura |
|---|---|
| Runner unit (11 tests) | aceita envelope válido; persiste 4 tabelas + 2 eventos; dry_run=true/hml_only=true/outbound_null_enforced=true; decision_status=simulated; audit start/finish; hash determinístico; rejeita PII residual; blocked→decision_status=blocked/error_code; sem PII em serialização; idempotente |
| Source isolation (4 tests) | runner sem pg/redis/http/adapters; store só importa pg; store só referencia shadow_replay_*; ALLOWED_TABLES guard presente |
| Smoke (6 tests) | smoke sem pg/redis/network/process.env; SQL: BEGIN/ROLLBACK/sem-COMMIT; 4 tabelas shadow_replay_*; markers g9_dry_run_start/finish; 2 UPDATEs de status; SELECT count UNION ALL |

---

## Safety

- `production_touched: false`
- `shadow_replay_runtime_allowed: false` (continua bloqueado)
- `worker_created: false`
- `app_runtime_registered: false` (nenhum import ou registro em `app.ts`)
- `postgres_operational_tables_touched: false`
- `redis_touched: false`
- `glpi_called: false`
- `meta_called: false`
- `ai_called: false`
- `real_ticket_read: false`
- `pii_exposed: false`
- `credentials_exposed: false`

---

## Próximos passos

- Cursor review (CLOSE/FIX/BLOCK)
- Smoke HML real: `node scripts/v10ShadowReplayDryRunRunnerSmoke.mjs | psql <hml_pg_conn>` com transação BEGIN/ROLLBACK
- Após smoke HML PASS: `g9_hml_smoke_passed=true`
- Runtime Shadow Replay (`shadow_replay_runtime_allowed`) continua bloqueado até G10+ com GO humano explícito
