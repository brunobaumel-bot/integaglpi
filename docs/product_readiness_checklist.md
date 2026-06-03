# Product Readiness Checklist - IntegraGLPI V8

Phase: `integaglpi_v8_governance_lgpd_product_readiness_001`
Updated: 2026-06-03

## Purpose

Close V8 as a controlled operational product package. This checklist does not deploy, promote, apply migrations, change `.env`, or alter production.

## Environment Separation

| Environment | Allowed use | Forbidden sharing |
| --- | --- | --- |
| TESTE | Synthetic smoke, local validation, provider mocks | Production tokens, real customer tickets, production database snapshots without approval |
| HOMOLOGAÇÃO | Controlled business validation with approved data | Direct production credentials, uncontrolled Meta sends, automatic promotion |
| PRODUÇÃO | Manual operation only after gate approval | Test credentials, debug flags, mock assumptions, automatic deploy |

Never share bearer tokens, Meta secrets, LogMeIn PSK, database passwords, raw payloads, or customer PII between environments.

## Dependency Matrix

| Dependency | Required for core WhatsApp/GLPI? | Safe default | Gate |
| --- | --- | --- | --- |
| GLPI plugin | Yes | Installed, RBAC/CSRF active | Super-Admin + Cursor review |
| integration-service Node | Yes | Health/readiness passing | Node owner |
| PostgreSQL integration DB | Yes | Migrations reviewed manually | DBA |
| Redis | Yes for locks/rate controls where configured | Running with controlled TTL | Infra |
| Meta WhatsApp Cloud API | Yes for real outbound/inbound | Mock or controlled real mode by environment | Operations + Meta owner |
| SmartHelp/Ollama local | No for ticket creation | Manual click only | Support lead |
| Cloud/external research | No | OFF | DPO + direction + admin + PII Guard |
| LogMeIn | No | OFF/read-only optional | Infra + security |

## Pre-Deploy Checklist

- [ ] Workspace clean and reviewed.
- [ ] Cursor review is `CLOSE` or accepted `CLOSE_COM_RESSALVAS`.
- [ ] `cd integration-service && npx tsc --noEmit` passed.
- [ ] `cd integration-service && npx vitest run` passed.
- [ ] PHP lint passed for changed plugin files.
- [ ] `.env` and Docker/compose were not changed unless a separate approved phase exists.
- [ ] Migrations are additive, manually reviewed, and not applied automatically.
- [ ] Backup is completed and validated.
- [ ] Rollback owner is available.
- [ ] Feature flags reviewed against `docs/feature_flags_matrix.md`.
- [ ] LGPD owner/DPO decision recorded or explicitly blocked as `OWNER_A_DEFINIR`.

## Manual Health Validation

Run only in the target environment and capture sanitized evidence:

- integration-service health/readiness endpoint responds.
- GLPI plugin loads without PHP fatal errors.
- Central WhatsApp opens for authorized profile.
- Ticket WhatsApp tab opens with CSRF token and RBAC active.
- Technical Health shows only sanitized flags and migration status.
- No UI shows secrets, raw tokens, full phone numbers, PSK, or provider payloads.

## Go/No-Go Decision

| Decision | Required condition |
| --- | --- |
| GO HOMOLOGAÇÃO | Tests pass, smoke plan ready, feature flags safe, no production touch. |
| GO PRODUÇÃO | Homologação accepted, backup/rollback ready, manual window approved, DPO/security gates clear. |
| NO-GO | Any secret exposure, failed CSRF/RBAC, cloud without consent, IA mutation, KB autopublish, LogMeIn action endpoint, or unapproved migration. |

## Post-Deploy Checklist

- [ ] Run final V8 smoke from `docs/smoke_tests.md`.
- [ ] Confirm WhatsApp inbound/outbound only in approved mode.
- [ ] Confirm Central Enterprise and ticket tab RBAC.
- [ ] Confirm SmartHelp does not auto-send or auto-mutate.
- [ ] Confirm cloud remains blocked unless all gates are explicit.
- [ ] Confirm LogMeIn remains optional/read-only.
- [ ] Register result and keep rollback window open until acceptance.

## Support Runbook Summary

1. Classify incident: WhatsApp, GLPI, Node, DB, Redis, SmartHelp, cloud, LogMeIn, RBAC.
2. Check health/readiness and sanitized logs.
3. Disable risky feature flags manually if approved.
4. Prefer rollback of package over data mutation.
5. Escalate any PII/secret exposure to DPO/security immediately.

## Production Package

Production package must include:

- commit hash;
- changed files list;
- Cursor review;
- test logs;
- smoke plan;
- backup evidence;
- rollback plan;
- feature flags review;
- LGPD owner status.
