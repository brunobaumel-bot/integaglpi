# V6 Governance, Release, and LogMeIn Read-only Closure

Phase: `integaglpi_v6_e3_governanca_logmein_release_001`

Status: implementation package ready for Cursor review and manual smoke. Production remains blocked.

Itens de governanca cobertos: Release checklist, release notes, Matriz RACI,
Owners por processo, Revisão mensal de permissões, Change Enablement,
backup/rollback evidenciado e runbooks de crise.

## Release Notes

- V6-E1: operational console guards, configuration RBAC, PII guard, and ghost-click protections.
- V6-E2: assistive Copilot with explicit source, feedback, short timeout, circuit breaker, sanitized context, and no auto-send.
- V6-E3: governance closure, release readiness, crisis runbooks, permission review cadence, and LogMeIn read-only design gates.

## Release Checklist

| Gate | Owner | Evidence | Status |
| --- | --- | --- | --- |
| `git status --short` clean before deploy | Release owner | terminal output | PENDING_MANUAL |
| Cursor review `CLOSE` or `CLOSE_COM_RESSALVAS` | Cursor reviewer | review report | PENDING |
| TypeScript clean | Backend owner | `npx tsc --noEmit` | PENDING |
| Focused Vitest clean | Backend owner | V6-E3 tests | PENDING |
| PHP lint clean | Plugin owner | `php -l` changed PHP files | PENDING |
| Feature flags reviewed | Security owner | config screenshot/export | PENDING |
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
