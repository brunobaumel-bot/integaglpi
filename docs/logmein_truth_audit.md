# LogMeIn Truth Audit Read-only

Phase: `integaglpi_v7_m5_enterprise_controlado_001`
Updated: 2026-06-03

## Verdict

Status real: PARCIAL.

LogMeIn existe no repositório como integração read-only e conciliação de evidências, mas não deve ser tratado como dependência operacional obrigatória do IntegraGLPI. A integração permanece condicionada a feature flags, RBAC, Bearer interno, auditoria sanitizada e execução manual em TESTE/HOMOLOGAÇÃO.

Não foi feita chamada externa ao LogMeIn nesta auditoria.
Não foi executado sync.
Não foi aplicado banco.
Não foi iniciada sessão remota.

## Evidence Inventory

### Integration-service

| Área | Arquivos | Status |
| --- | --- | --- |
| Host/group cache read-only | `integration-service/src/domain/services/LogmeinReadonlyContextService.ts`, `integration-service/src/repositories/postgres/PostgresLogmeinReadonlyRepository.ts`, `integration-service/src/controllers/createLogmeinReadonlyController.ts` | IMPLEMENTADO |
| Redis lock de sync | `integration-service/src/cache/LogmeinRedisSyncLock.ts` | IMPLEMENTADO |
| Reconciliation ledger | `integration-service/src/domain/services/LogmeinReconciliationService.ts`, `integration-service/src/repositories/postgres/PostgresLogmeinReconciliationRepository.ts`, `integration-service/src/controllers/createLogmeinReconciliationController.ts` | PARCIAL |
| Wiring condicional | `integration-service/src/buildDependencies.ts`, `integration-service/src/app.ts` | IMPLEMENTADO |
| Testes estáticos | `integration-service/tests/logmeinReadonlyStatic.test.ts`, `integration-service/tests/logmeinHardeningStatic.test.ts`, `integration-service/tests/logmeinReconciliationStatic.test.ts` | IMPLEMENTADO |

### Plugin GLPI

| Área | Arquivos | Status |
| --- | --- | --- |
| Governança/mapeamento local | `integaglpi/src/Service/LogmeinGovernanceService.php` | IMPLEMENTADO |
| UI read-only | `integaglpi/front/logmein.mapping.php`, `integaglpi/front/logmein.reports.php`, `integaglpi/templates/logmein_mapping.php`, `integaglpi/templates/logmein_reports.php` | IMPLEMENTADO |
| UI de conciliação | `integaglpi/front/logmein.reconciliation.php`, `integaglpi/templates/logmein_reconciliation.php` | PARCIAL |
| Permissões/auditoria | `integaglpi/src/Service/SecurityPermissionService.php`, `integaglpi/src/Service/SecurityAuditService.php` | IMPLEMENTADO |
| Teste plugin | `integaglpi/tests/LogmeinReconciliationApiBaseStaticTest.php` | IMPLEMENTADO |

### Migrations

| Migration | Conteúdo | Status |
| --- | --- | --- |
| `integration-service/schema-migrations/042_logmein_readonly_governance.sql` | Cache/mapeamento/auditoria LogMeIn read-only | IMPLEMENTADO NO REPO |
| `integration-service/schema-migrations/043_logmein_remote_access_ledger.sql` | Ledger de sessões remotas e fila de regularização | IMPLEMENTADO NO REPO |

Esta auditoria não aplicou nenhuma migration.

## Endpoints and Flags

### Internal endpoints

| Endpoint | Tipo | Status | Observação |
| --- | --- | --- | --- |
| `GET /internal/glpi/logmein/health` | Interno/read-only | IMPLEMENTADO | Health sanitizado. |
| `POST /internal/glpi/logmein/sync` | Interno/sync read-only | IMPLEMENTADO | Só cache local; exige flag e Bearer. |
| `POST /internal/glpi/logmein/reconciliation/sync` | Interno/sync read-only de relatório | PARCIAL | Busca relatório remoto se flag ativa; não inicia sessão. |
| `GET /internal/glpi/logmein/reconciliation/queue` | Interno/read-only | IMPLEMENTADO | Lista fila local. |
| `POST /internal/glpi/logmein/reconciliation/queue/:id/resolve` | Interno/mutação local auditada | PARCIAL | Resolve item local; não muta LogMeIn. |

### External paths allowed by code

| Path | Uso permitido | Status |
| --- | --- | --- |
| `/public-api/v2/hostswithgroups` | Inventário host/grupo read-only | IMPLEMENTADO |
| `/public-api/v1/reports/remote-access-with-groups` | Relatório passivo de sessões remotas | PARCIAL |
| `/public-api/v1/reports/remote-access` | Fallback passivo de relatório | PARCIAL |

### Explicitly forbidden

- `/hosts/{id}/connection`
- `/connection`
- `/start-session`
- `/remote-access/start`
- `PUT`, `DELETE`, `PATCH`
- RMM, scripts, deploy, execução remota

## Feature Flags

| Flag | Default seguro | Função |
| --- | --- | --- |
| `LOGMEIN_INTEGRATION_ENABLED` | `false` | Habilita o contexto read-only de host/grupo. |
| `LOGMEIN_RECONCILIATION_ENABLED` | `false` | Habilita conciliação de relatório remoto. |
| `LOGMEIN_API_BASE_URL` | não configurar em produção sem gate | Origem da API LogMeIn. |
| `LOGMEIN_COMPANY_ID` | secret externo ao repo | Credencial de leitura. |
| `LOGMEIN_PSK` | secret externo ao repo | Credencial de leitura. |
| `LOGMEIN_TIMEOUT_MS` / `LOGMEIN_HTTP_TIMEOUT_MS` | limitado por código | Timeout HTTP. |
| `LOGMEIN_SYNC_LOCK_TTL_MS` | limitado por código | Lock de sync do cache. |
| `LOGMEIN_RECONCILIATION_LOCK_TTL_MS` | limitado por código | Lock de conciliação. |
| `LOGMEIN_RECONCILIATION_LOOKBACK_DAYS` / `HOURS` | limitado por código | Janela de relatório. |
| `LOGMEIN_RECONCILIATION_CHUNK_MINUTES` / `OVERLAP_MINUTES` | limitado por código | Fatiamento do relatório. |
| `LOGMEIN_RECONCILIATION_MAX_RETRIES` | limitado por código | Tentativas controladas. |
| `LOGMEIN_RECONCILIATION_CIRCUIT_COOLDOWN_SECONDS` | limitado por código | Cooldown de falhas. |

## Status Classification

| Item | Classificação | Evidência | Decisão |
| --- | --- | --- | --- |
| Inventário hosts/grupos | IMPLEMENTADO | Serviço, repo, controller, migration 042 e testes estáticos existem. | Pode continuar read-only. |
| Contexto visual em ticket | IMPLEMENTADO | `LogmeinGovernanceService` e templates locais existem. | Não é dependência para WhatsApp/ticket. |
| Conciliação de sessões remotas | PARCIAL | Serviço, controller, repo, migration 043 e UI existem; histórico indicou HTTP 500 do provider. | Manter behind flag e gate manual. |
| Sync automático | BLOCK | Escopo de Macro 5 proíbe automação perigosa. | Não habilitar. |
| Sessão remota/controle remoto | BLOCK | Forbidden endpoints cobertos por testes e código. | Não implementar. |
| Dependência operacional do atendimento | BLOCK | LogMeIn pode ficar indisponível sem quebrar WhatsApp/GLPI. | Nunca tornar obrigatório. |

## Operational Decision

1. LogMeIn permanece opcional e read-only.
2. Produção deve manter `LOGMEIN_INTEGRATION_ENABLED=false` e `LOGMEIN_RECONCILIATION_ENABLED=false` até homologação formal.
3. Qualquer sync deve ser manual, em TESTE/HOMOLOGAÇÃO, com janela humana e logs revisados.
4. Falha de LogMeIn não pode bloquear criação, resposta, solução, claim ou Central WhatsApp.
5. Nenhum botão de UI pode iniciar acesso remoto.
6. Credenciais não entram em docs, logs, payloads ou banco.
