# LGPD Retention Policy - IntegraGLPI V8

Phase: `integaglpi_v8_governance_lgpd_product_readiness_001`
Updated: 2026-06-03

## Status

This document is a governance proposal. It does not delete data, schedule purge jobs, create migrations, or authorize automatic retention enforcement.

Production changes require human approval, backup validation, Cursor review, and a separate implementation phase.

## Owners

| Role | Owner |
| --- | --- |
| DPO/LGPD owner | OWNER_A_DEFINIR |
| Security owner | OWNER_A_DEFINIR |
| Operations owner | OWNER_A_DEFINIR |
| DBA owner | OWNER_A_DEFINIR |

`OWNER_A_DEFINIR` is a mandatory go/no-go gate before any purge, minimization, or production retention job is implemented.

## Data Categories And Proposed Retention

| Category | Examples | Proposed retention | Notes |
| --- | --- | --- | --- |
| WhatsApp messages | inbound/outbound text, delivery metadata | Same as the GLPI ticket legal/operational retention, proposed baseline 5 years | Final term must follow customer contract and legal policy. |
| Attachments metadata | file path, MIME, size, hash, GLPI document reference | Same as the linked GLPI ticket | Binary storage follows GLPI storage policy; PostgreSQL must not store binaries. |
| Raw webhook/provider payloads | Meta webhook diagnostic snapshots, raw error evidence | Proposed short retention 90 days, or minimization after incident closure | Future purge requires DPO + DBA approval and backup. |
| Operational logs | application logs, structured events | Proposed 180 days | Logs must not contain token, secret, full phone, raw prompt, or raw payload. |
| Audit events | security, RBAC, ticket actions, SmartHelp, cloud audit | Proposed 5 years | Prefer sanitized payload and hashes over raw content. |
| Cloud compliance audit | provider, consent, PII guard result, safe metadata | Proposed 5 years | No raw prompt or PII. Cloud remains off by default. |
| KB feedback | helpful/not helpful, aggregate scores, article target | Proposed 3 years for aggregate analytics | Technician id may be used only for deduplication, not punitive ranking. |
| AI local summaries | sanitized technical summary, checklist, suggested questions | Same as ticket context if persisted; otherwise session/UI only | IA must not send WhatsApp or mutate ticket automatically. |
| KB candidates | sanitized evidence, recurrence, candidate article drafts | Proposed 3 years or until review closure | Human review and manual publish only. |
| LogMeIn cache/read-only evidence | host/group cache, reconciliation records | Proposed 180 days for cache, 1 year for audit/reconciliation | LogMeIn remains optional and read-only; never operational dependency. |
| Aggregated metrics | SLA, queue, quality, non-punitive coaching | Proposed 5 years if no PII | Keep aggregated; avoid nominal punitive ranking. |

## Future Purge Criteria

Any future purge/minimization phase must include:

1. Named DPO/LGPD owner and DBA owner.
2. Exact table and column inventory.
3. Backup completed and validated before execution.
4. Dry-run report with affected row counts.
5. Human approval for TESTE/HOMOLOGAÇÃO.
6. Separate approval for PRODUÇÃO.
7. Cursor review of the real diff.
8. Rollback/restore procedure.
9. Post-execution audit evidence.

## Forbidden Without New Phase

- Automatic purge jobs.
- Runtime retention enforcement.
- Production data deletion.
- Destructive migrations.
- Raw prompt or raw provider payload storage.
- Cloud calls without consent, PII Guard, permission, and audit.

## Go/No-Go Gate

Production promotion remains blocked if:

- any owner is still `OWNER_A_DEFINIR`;
- backups are not validated;
- smoke final V8 is incomplete;
- feature flags are not reviewed;
- logs or UI expose PII/secrets;
- any document or package suggests automatic production deploy.
