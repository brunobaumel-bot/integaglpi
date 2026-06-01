# V6/V7 Governance, Release, and LogMeIn Read-only Closure

Phases:
- V6-E3: `integaglpi_v6_e3_governanca_logmein_release_001`
- V6-E4 (hardening): `integaglpi_logmein_operational_hardening_release_001`
- V7 (reconciliation): `integaglpi_v7_logmein_remote_access_evidence_reconciliation_001`

Status: V6 closed. V7 reconciliation implementation ready for Cursor review. Production remains blocked.

## Read-Only Allowlist Policy (effective from V7)

The term "GET-only" is superseded by "read-only allowlist".

**Allowed external calls to LogMeIn Central API:**

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/public-api/v2/hostswithgroups` | Host/group cache sync (V6) |
| POST | `/public-api/v1/reports/remote-access-with-groups` | Passive session report (V7 allowlisted) |
| POST | `/public-api/v1/reports/remote-access` | Fallback passive report (V7 allowlisted) |

**Permanently forbidden:**

- Any `PUT`, `DELETE`, `PATCH` against LogMeIn
- `/hosts/{id}/connection` — remote session initiation
- `/start-session`, `/deploy`, `/execute`, `/run-script`
- Any RMM automation endpoint
- Any endpoint that mutates LogMeIn state

**V7 reconciliation safety:**
- `sessionId` is unique; re-syncing the same window inserts nothing.
- `userIp` is never stored — SHA-256 of the IP is computed internally for snapshot hash only, not persisted.
- Technician identity stored only as SHA-256 hash — never plaintext in DB, log, or UI.
- No automatic GLPI ticket created from reconciliation.
- No automatic WhatsApp notification.
- No billing automation.
- No ranking or nominal technician report.
- GLPI task creation requires explicit human confirmation per session.
- `LOGMEIN_RECONCILIATION_ENABLED=false` by default in all environments.

Itens de governanca cobertos: Release checklist, release notes, Matriz RACI,
Owners por processo, Revisão mensal de permissões, Change Enablement,
backup/rollback evidenciado e runbooks de crise.

## Release Notes

- V6-E1: operational console guards, configuration RBAC, PII guard, and ghost-click protections.
- V6-E2: assistive Copilot with explicit source, feedback, short timeout, circuit breaker, sanitized context, and no auto-send.
- V6-E3: governance closure, release readiness, crisis runbooks, permission review cadence, and LogMeIn read-only design gates.
- V6-E4 (hardening): Redis cross-process sync lock, duration tracking, health summary endpoint (`/internal/glpi/logmein/health`), visual alert banners in UI, retention policy, and updated release checklist.

## Release Checklist

| Gate | Owner | Evidence | Status |
| --- | --- | --- | --- |
| `git status --short` clean before deploy | Release owner | terminal output | PENDING_MANUAL |
| Cursor review `CLOSE` or `CLOSE_COM_RESSALVAS` | Cursor reviewer | review report | PENDING |
| TypeScript clean | Backend owner | `npx tsc --noEmit` | PENDING |
| Focused Vitest clean (logmeinReadonlyStatic + logmeinHardeningStatic) | Backend owner | vitest output | PENDING |
| PHP lint clean | Plugin owner | `php -l` changed PHP files | PENDING |
| Feature flags reviewed (`LOGMEIN_INTEGRATION_ENABLED=false` in prod) | Security owner | config screenshot/export | PENDING |
| Redis lock smoke: concurrent sync returns `sync_in_progress` | Backend owner | manual test log | PENDING_MANUAL |
| Health endpoint smoke: `GET /internal/glpi/logmein/health` returns metrics | Backend owner | curl output | PENDING_MANUAL |
| Visual alerts smoke: mapping UI shows health card | Plugin owner | screenshot | PENDING_MANUAL |
| Backup verified | Infra owner | backup job id or snapshot id | PENDING_MANUAL |
| Rollback path reviewed | Release owner | rollback checklist below | PENDING_MANUAL |
| Test smoke approved | Operator | smoke checklist T01-T17 | PENDING_MANUAL |
| Production promotion approved | Human gate | change ticket approval | BLOCKED_BY_DEFAULT |

## RACI

| Process | Responsible | Accountable | Consulted | Informed |
| --- | --- | --- | --- | --- |
| WhatsApp inbound/outbound | Backend owner | Operations lead | GLPI owner | Support team |
| GLPI plugin UI/RBAC | Plugin owner | Security owner | Operations lead | Support team |
| AI/Copilot local | AI owner | Security owner | DPO/Direction | Support team |
| LogMeIn read-only context | Integration owner | Security owner | Infra owner | Support team |
| Release and rollback | Release owner | Operations lead | Security owner | Direction |
| Permission review | Security owner | Operations lead | Supervisors | Direction |

## Process Owners

- Release owner: owns deploy window, rollback gate, final checklist.
- Security owner: owns RBAC, PII guard, permission review, LogMeIn read-only enforcement.
- Plugin owner: owns GLPI UI, CSRF, menu, ticket context.
- Backend owner: owns integration-service, worker safety, provider timeouts.
- Infra owner: owns backups, Redis/Postgres availability, container restarts.

## Monthly Permission Review

1. Export or screenshot Central de Segurança effective matrix.
2. Confirm no `manage_security_center` for Technician, Supervision, or Direction.
3. Confirm Direction remains read-only and aggregated.
4. Confirm only authorized admins can save matrix changes.
5. Review users with GLPI profile update/config update rights.
6. Record result as `PERMISSION_REVIEW_COMPLETED` using the audit mechanism or change record.

## Change Enablement Minimum

- Every V6 promotion must have a change ticket with scope, commit hash, owner, planned time, rollback trigger, and smoke plan.
- Production deploy is manual only.
- Rollback is manual only.
- Feature flags remain conservative and OFF by default for external integrations.
- No emergency fix may bypass CSRF, RBAC, PII guard, or audit requirements.

## Operational Hardening (V6-E4)

### Sync Concurrency Lock

- Redis `SET NX PX` lock (key: `glpi_plugin_whatsapp:lock:logmein_sync`, TTL: 5 min default).
- Static in-process flag retained as secondary guard (same-process safety).
- If Redis is unavailable the lock fails-open: static flag governs; no sync is blocked unnecessarily.
- `LOGMEIN_SYNC_LOCK_TTL_MS` env var overrides the default (range 30 000–1 800 000 ms).
- Concurrent attempt emits audit event `LOGMEIN_SYNC_CONCURRENCY_BLOCKED`.

### Sync Performance

- Hosts upserted in batches of 100 rows (`HOST_UPSERT_BATCH_SIZE`).
- HTTP timeout governed by `LOGMEIN_TIMEOUT_MS` (default 5 s, max 30 s).
- Sync duration tracked in `payload_json.duration_ms` of the audit row.
- Cache is NOT cleared on sync failure; previous data remains available.

### Health Endpoint

- `GET /internal/glpi/logmein/health` (bearer-gated, same key as `/sync`).
- Returns `LogmeinHealthSummary` with: sync status, duration, groups/hosts, tag coverage, cache age, consecutive failures, alert flags.
- HTTP 503 on `critical` status; 200 otherwise. Never exposes secrets or PII.

### Visual Alerts (UI only)

Displayed in `Mapeamento LogMeIn read-only` card header. No WhatsApp, e-mail, or ticket is created automatically.

| Alert | Condition | Severity |
| --- | --- | --- |
| `sync_failing` | ≥ 2 consecutive `failed` sync events | DANGER |
| `cache_stale` | Cache age > 24 h | WARNING; > 48 h → DANGER |
| `low_tag_coverage` | Valid-tag coverage < 85% | WARNING |
| `groups_without_entity` | Any group with no active GLPI mapping | WARNING |

### Health Thresholds

| Metric | Warning | Critical |
| --- | --- | --- |
| Tag coverage (valid/total) | < 85% | — |
| Cache age | > 24 h | > 48 h |
| Consecutive sync failures | ≥ 2 | ≥ 4 |

### Scheduled Sync (optional)

- Scheduled sync is disabled by default (`LOGMEIN_INTEGRATION_ENABLED=false`).
- To enable in HOMOLOGAÇÃO: set `LOGMEIN_INTEGRATION_ENABLED=true` and call `/internal/glpi/logmein/sync` from a cron or scheduler.
- Lock ensures a running sync blocks any scheduled duplicate.
- Production: manual sync only via operator action; gate `LOGMEIN_INTEGRATION_ENABLED` must remain OFF until human review.

## Retenção de Dados LogMeIn

| Tabela | Dado | Política documentada |
| --- | --- | --- |
| `glpi_plugin_integaglpi_logmein_sync_audit` | Eventos de sync (status, payload) | 90 dias — arquivar ou soft-delete via job externo; DELETE físico nunca automático |
| `glpi_plugin_integaglpi_logmein_asset_cache` | Cache de hosts/grupos | Invalidade lógica: `cache_updated_at` antigo sinaliza stale; purga manual autorizada pelo Infra owner após consenso |
| `glpi_plugin_integaglpi_logmein_group_maps` | Mapeamentos grupo→entidade | Retenção indefinida (dados de mapeamento operacional); desativação via `is_active=FALSE` |
| Logs PHP (`error_log`) | Erros sanitizados | Rotação conforme política do servidor (sugere-se 30 dias) |
| Logs Node.js (pino) | Erros de sync | Rotação conforme política do servidor |

**Princípios:**
- Nenhum DELETE automático sem gate humano.
- Dados PII (e-mail, telefone) já são mascarados em escrita; não há PII em tabelas LogMeIn.
- Credenciais LogMeIn nunca persistidas em banco, log ou UI.
- `LOGMEIN_COMPANY_ID` e `LOGMEIN_PSK` residem apenas no `.env` do servidor e são lidos em runtime.

## Rollback por Feature Flag

1. Setar `LOGMEIN_INTEGRATION_ENABLED=false` no `.env` do servidor de HOMOLOGAÇÃO/Produção.
2. Reiniciar `integration-service` (`docker compose restart integration-service` ou equivalente manual).
3. Verificar: `/health` retorna `ok`, `/internal/glpi/logmein/sync` retorna `{"status":"disabled"}`.
4. Verificar no GLPI: tab LogMeIn no ticket exibe "Contexto de ativo temporariamente indisponível." (comportamento esperado).
5. Mappping e relatórios podem permanecer acessíveis no PHP (lêem apenas o cache local); ou desabilitar via RBAC removendo `RIGHT_MANAGE_LOGMEIN_MAPPING` do perfil.
6. Registrar: operator, timestamp, commit hash do rollback, resultado.

## Backup And Rollback Evidence

Before promotion:

1. Verify PostgreSQL backup or snapshot exists and is restorable.
2. Verify GLPI/MariaDB backup exists and is restorable.
3. Record current commit hash and plugin version.
4. Confirm `.env` and Docker were not changed by this phase.
5. Rollback plan:
   - disable V6 feature flags;
   - restore previous commit manually;
   - restart services manually if needed;
   - validate health, inbound, outbound, Central, and ticket tab;
   - document operator, timestamp, and result.

## Crisis Runbooks

Aliases required by the operational checklist: Meta API fora, Redis fora,
Postgres lento/fora, GLPI indisponível, Ollama fora, worker Node travado,
LogMeIn indisponível, rollback emergencial.

### Meta API Down

- Owner: Backend owner.
- Action: keep webhook guard active, switch outbound to manual fallback if approved, do not resend blindly.
- Validate: Meta status, audit events, failed outbound queue.
- Rollback: disable affected sends by flag/manual gate.

### Redis Down

- Owner: Infra owner.
- Action: keep webhook safe; locks may degrade only where code has approved fallback.
- Validate: Redis connectivity, lock error logs.
- Rollback: restart Redis, scale down risky workers if sequential processing cannot be guaranteed.

### Postgres Slow Or Down

- Owner: Infra owner.
- Action: stop promotions, preserve webhook safety, avoid manual writes.
- Validate: pool saturation, slow queries, connection errors.
- Rollback: restore DB service or snapshot; do not run ad-hoc destructive SQL.

### GLPI Unavailable

- Owner: GLPI owner.
- Action: block ticket mutations, keep WhatsApp responses manual only if approved.
- Validate: GLPI health, API auth, ticket read/write.
- Rollback: restore GLPI service; verify ticket sync.

### Ollama Down

- Owner: AI owner.
- Action: Copilot falls back with honest unavailable message; no ticket mutation.
- Validate: circuit breaker state, timeout logs.
- Rollback: keep provider disabled/dry-run until stable.

### Node Worker Stuck

- Owner: Backend owner.
- Action: stop promotion, inspect logs, restart manually only after confirming no duplicate execution risk.
- Validate: health endpoint, worker lag, audit events.
- Rollback: revert commit and restart service manually.

### LogMeIn Unavailable

- Owner: Integration owner.
- Action: show "Contexto de ativo temporariamente indisponível."; do not block ticket/chat.
- Validate: feature flag, read-only cache age, sanitized logs.
- Rollback: disable `LOGMEIN_INTEGRATION_ENABLED`; keep cache hidden.

### Emergency Rollback

- Owner: Release owner.
- Trigger: security regression, WhatsApp auto-send risk, ticket mutation regression, RBAC/CSRF break, production smoke failure.
- Steps: stop deploy, disable flags, revert commit manually, restart services manually, run health and core smoke, notify stakeholders.

## LogMeIn Read-only Governance

Allowed data:

- LogMeIn group;
- host/computer name;
- equipment tag;
- online/offline status;
- last seen timestamp;
- stable external id when not sensitive.

Forbidden data:

- credentials, passwords, tokens;
- remote session logs;
- process lists;
- command output;
- endpoint scripts;
- URLs with sensitive query strings;
- data from unrelated customers.

Rules:

- Only GET/read-only external calls are allowed.
- No UI button may start remote access.
- No RMM, remote execution, wake-on-LAN, deploy, or script endpoint.
- Plugin UI must read local cache/fallback, not block rendering on live API.
- Entity/asset links are suggestions until a technician confirms; confirmação técnica is mandatory before definitive linkage.
- Entity memory cannot be written automatically from LogMeIn context.
