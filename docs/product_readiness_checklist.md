# Product Readiness Checklist - IntegraGLPI V8

Phase: `integaglpi_v8_final_governance_lgpd_readiness_and_release_gate_001`
Updated: 2026-06-04

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

## Final V8 Installation And Environment Checklist

| Area | Minimum requirement | Evidence expected |
| --- | --- | --- |
| GLPI plugin | Installed in the GLPI plugin directory, no GLPI core patch. | Plugin page loads and menu appears by profile rights. |
| PHP runtime | Compatible with the deployed GLPI version. | PHP lint or operational smoke evidence. |
| Node integration-service | Built package from approved commit. | Health/readiness endpoint passing. |
| PostgreSQL integration DB | Required migrations reviewed and applied manually when authorized. | DBA evidence; no Codex production migration. |
| Redis | Available for locks/queues where configured. | Health or service status evidence. |
| Meta WhatsApp | Webhook and outbound mode aligned with environment. | TESTE/HOMOLOGACAO smoke; no real send outside gate. |
| SmartHelp/Ollama | Optional assistive feature, manual click only. | UI smoke; no auto-send and no ticket mutation. |
| Cloud research | OFF by default and gated by PII Guard, consent and strong permission. | Feature flag review and audit evidence. |
| LogMeIn | Optional read-only cache/reconciliation. | Flags OFF unless smoke read-only is approved. |

## Homologation Package

- Approved commit hash and changed-files manifest.
- Cursor review result.
- Node test evidence: TypeScript and Vitest.
- PHP lint/PHPUnit evidence or environmental ressalva.
- Feature flags matrix reviewed.
- LGPD retention owner status checked.
- Final V8 smoke plan ready.
- Rollback owner and rollback package available.

## Production Package

- Homologation acceptance.
- Backup evidence for plugin, integration-service package, GLPI DB, PostgreSQL and configuration outside the repo.
- Go/no-go signed by operations, security and DPO/owner when applicable.
- Manual deployment window and named operator.
- Manual rollback plan with owner available during the window.
- Post-deploy baseline capture plan.

## L1/L2 Support Split

| Level | Responsibilities | Escalate when |
| --- | --- | --- |
| L1 | Capture sanitized evidence, check health page, confirm user/profile, verify known feature flag status. | Any PII/secret exposure, provider outage, RBAC failure, or customer-impacting WhatsApp failure. |
| L2 | Inspect sanitized logs, Node health, GLPI plugin errors, PostgreSQL/Redis status, Meta provider errors. | Requires DBA, DPO, infrastructure change, production rollback, or code fix. |

## Final Go/No-Go

V8 is NO-GO if any item below is true:

- smoke final V8 was not executed in HOMOLOGACAO;
- any owner remains `OWNER_A_DEFINIR` for a required LGPD decision;
- cloud can run without operator consent, PII Guard and strong permission;
- IA can send WhatsApp or mutate ticket automatically;
- KB can autopublish;
- LogMeIn is required for WhatsApp/ticket operation;
- logs/UI expose PII, token, secret, PSK or raw payload;
- backup or rollback is not validated.
