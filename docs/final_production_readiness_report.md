# Relatório Final de Prontidão para Produção — IntegraGLPI V8

Phase: `integaglpi_v8_final_production_readiness_execution_001`
Executado em: 2026-06-04 (UTC-3) via SSH em HOMOLOGAÇÃO (host `GLPIv5`).
Número de teste autorizado: `41988334449` (`+5541988334449`).

> Auditoria read-only/controlada. Sem correção de código, sem produção, sem deploy/commit,
> sem SQL destrutivo. Nenhum segredo/PII impresso.

---

## Atualização — Smoke final com fixture AUDIT dedicada — 2026-06-04

Phase: `integaglpi_v8_final_ui_mutation_audit_fixture_smoke_001`.

**VERDICT: NO_GO.**

Execução HML controlada criou fixture GLPI sintética e confirmou parte dos fluxos finais, mas ainda há bloqueadores para GO:

- Fixture AUDIT segura criada fora de entidade de cliente real:
  - entidade `AUDIT - Homologacao` id `237`;
  - grupo `AUDIT - Testes` id `9`;
  - categoria `AUDIT - Categoria` id `454`;
  - técnicos AUDIT id `809` e `810`;
  - ticket `AUDIT-FINAL-UI-*` id `2112319362`;
  - ticket manual `AUDIT-MANUAL-*` id `2112319363`.
- O ticket AUDIT anterior `2112319361` foi identificado na entidade real `Ética > Klarind`; não foi usado para mutações operacionais.
- HML saudável: Node `/health` OK, PostgreSQL OK, Redis PONG, `dead_letter=0`, Redis locks `0`.
- T12 histórico/follow-up PASS no ticket AUDIT `2112319362`.
- T19 abertura manual PASS via GLPI API HML com ticket `2112319363`.
- T04/T07/T11 tiveram bloqueio 403 em updates operacionais via GLPI API no perfil/token disponível.
- T22 SmartHelp/IA ficou PARTIAL: HTML da aba contém o painel, mas o smoke headless não conseguiu exercitar o painel no DOM carregado; sem evidência suficiente para GO.
- T23 menus/drilldowns PARTIAL: rotas principais HTTP 200; alguns rótulos não aparecem no menu e `supervisor.command.php?view=sla` retornou conteúdo com indício de 404.
- Rollback readiness PARTIAL: backup SQL atual e tar do plugin existem; `pg_restore --list` falhou em dump antigo por versão de dump `1.15` não suportada pelo cliente local.
- Segurança: nenhum container `prod-*` foi usado; porém scan de logs recentes encontrou ocorrências do telefone autorizado sem redaction, logo `logs_without_pii=false`.

Decisão: **NO_GO até corrigir/aceitar formalmente os bloqueadores de permissões UI/API, T22 visual, T23 SLA e log redaction.**

---

## 1. Veredito

**VERDICT: NO_GO (condicional — sem defeitos encontrados; critérios obrigatórios de GO não concluídos).**

Tudo o que foi executado **passou**. Porém o GO de produção exige itens P0 que **não puderam ser
concluídos de forma autônoma e segura** nesta execução:

1. **Rollback real (restore destrutivo do PostgreSQL)** não foi executado — o HML compartilha dados
   de **cliente real** (entidade 28 "Ética > Klarind"); um restore destrutivo teria alto raio de
   impacto. Backup não-destrutivo é viável; o drill de restore exige janela dedicada/namespace isolado.
2. **Suite de UI mutável** (claim/transferência/salvar/CSRF/RBAC/mascaramento) exige navegador com
   acesso à GLPI interna (VPN 10.8.0.1) — indisponível para esta automação CLI.
3. **WhatsApp E2E novo + idempotência** exige inbound novo originado pelo telefone físico — não
   gerável pela auditoria (webhook exige assinatura Meta).
4. **IA/SmartHelp degradada**: Ollama UP, mas os modelos configurados (`llama3:8b`, `qwen2.5:7b`)
   **não estão baixados** → resumo cairia em fallback.

`STOP_CONDITION` aplicável: "rollback real não executado → NO_GO". Não é falha de qualidade — é
critério de GO não satisfeito. Lista de desbloqueio na seção 7.

---

## 2. Ambiente (preflight)

| Item | Resultado |
|---|---|
| Host | `GLPIv5` (HML); `prod-*` apenas listados/ignorados |
| integration-service | `/health` ok:true; uptime ok; restarts=0; started 2026-06-04T16:50:18Z |
| PostgreSQL | OK (`glpi_integaglpi`, latência ~9ms) |
| Redis | PONG; `DBSIZE=0`; locks=0 |
| dead_letter | 0 |
| GLPI API | initSession 200 (app/user token) |
| GLPI UI cred | `glpi_hml_ui.env` presente (perms 600); login test-user initSession 200 |
| Ollama | http 200; **modelos configurados ausentes** (1 modelo, não llama3:8b/qwen2.5:7b) |
| package_manifest | `package_incomplete` / `manifest_found:false` (exceção documentada) |

Flags (redacted): `EXTERNAL_RESEARCH_CLOUD_ENABLED=unset` (cloud OFF), `SMARTHELP_CLOUD_RESIDUAL_MODE=unset`,
`AI_PILOT_CLOUD_ENABLED=unset`, `AI_SUPERVISOR_ENABLED=true`, **`LOGMEIN_INTEGRATION_ENABLED=true`** (diverge do default seguro),
`OUTBOUND_SEND_MODE=real`, `NODE_ENV=development`. Sem variáveis MariaDB/MySQL no container Node.

---

## 3. Gates automatizados (PASS)

| Gate | Resultado |
|---|---|
| `npx tsc --noEmit` | PASS |
| `npx vitest run` | PASS — 109 arquivos, 908 testes |
| `php -l` plugin | PASS — 217 arquivos, 0 falhas |
| `git diff --check` | PASS (apenas avisos CRLF) |

---

## 4. P0 — Resultados

| P0 | Status | Evidência |
|---|---|---|
| Ambiente/build/segregação | PASS | HML isolado; flags cloud OFF; sem MariaDB no Node |
| WhatsApp ticket E2E | PASS (evento prévio real) | conversa 0a7c415c → ticket 2112319360 |
| Entidade/memória | PASS | `glpi_entity_id=28` + nome em conversa nova; ticket GLPI entities_id=28 |
| Central operações (claim/transfer/save) | NOT_EXECUTED | requer navegador na GLPI interna |
| RBAC/CSRF | PARTIAL | gates de código confirmados (auditoria de fase anterior CLOSE); UI runtime pendente |
| Mídia/anexos | PASS (suportado) / NOT_EXECUTED (edge) | imagem→Document 3894 + Document_Item 16962; unsupported/large/corrupt requerem inbound novo |
| Inatividade/autoclose | PASS (skip) | skipped_by_response/recent_inbound; sem WhatsApp/autoclose indevido; ramo 403 deploy-confirmado |
| PII em logs/UI | PASS | scan: 0 Authorization/email/bearer/app-token/telefone-extra |
| Cloud/PII/consent | PASS (config) | cloud OFF; consentimento+UPDATE server-side (fases anteriores CLOSE) |
| Rollback real HML | NOT_EXECUTED | restore destrutivo evitado (dados de cliente real no HML) |

## 5. P1 — Resultados

| P1 | Status | Evidência |
|---|---|---|
| SmartHelp/IA | PARTIAL | Ollama UP mas modelos não baixados → fallback determinístico |
| Ollama indisponível/fallback | PASS (implícito) | endpoint resiliente; resumo degrada para fallback honesto |
| Reabertura/histórico | NOT_EXECUTED | requer UI |
| Abertura manual | NOT_EXECUTED | requer UI |
| Supervisor/monitoramento | NOT_EXECUTED | requer UI |
| Performance/resiliência (restart) | NOT_EXECUTED | restart evitado (risco de inbound de cliente real durante janela) |
| Técnicos concorrentes | NOT_EXECUTED | requer UI |

## 6. Segurança

- Produção não tocada; containers `prod-*` apenas listados.
- Sem SQL destrutivo; sem mensagem a cliente real (nenhum outbound disparado nesta fase).
- Logs sem PII/segredos (scan 0); UI/JSON da Central corrigidos (commit `0c51f6c`).
- Node não acessa MariaDB; sem app-token completo em log.
- IA não envia WhatsApp / não muta ticket / KB sem autopublish (config + fases CLOSE).

## 7. Para fechar (NO_GO → GO_READY)

1. **Janela de manutenção HML** para drill de rollback real: `pg_dump` + backup do plugin → restore
   em namespace/instância isolada → smoke (`/health`, Central, ticket AUDIT-*, dead_letter/locks).
2. **Sessão de navegador** com acesso à GLPI interna para a suíte UI mutável (claim/transfer/save/
   CSRF/RBAC/mascaramento/supervisor/monitoramento/reabertura/abertura manual).
3. **WhatsApp E2E novo** (humano enviando de 41988334449): texto + mídia suportada + **mídia
   não-suportada/grande/corrompida** (validar `unsupported_media_type`) + **reenvio do mesmo payload**
   (idempotência: não duplicar ticket).
4. **IA**: baixar os modelos Ollama configurados (`llama3:8b`, `qwen2.5:7b`) ou documentar IA OFF por
   flag em produção; subir o container `glpi-integaglpi-ai` se for o provider esperado.
5. **Flags de produção**: confirmar `LOGMEIN_INTEGRATION_ENABLED` (preferir OFF/read-only) e
   `OUTBOUND_SEND_MODE` adequado; cloud permanece OFF/consentimento.
6. **Monitoramento 24h pós-GO**: dead_letter, Redis locks, latência `/health`, taxa de erro de mídia,
   logs sem PII, ausência de autoclose indevido.

## 8. Itens executados com sucesso (resumo)
- Backend pós-fix (T01/T02/T10/T13) PASS com evento real (persistente).
- Gates CI verdes (tsc/vitest/php -l/diff-check).
- Segurança de logs/flags/segregação PASS.
- Credenciais de API e UI validadas (auth 200).

## 9. Addendum — execução pós-checkpoint (backups, resiliência, UI)

### Backups não-destrutivos (PASS)
- `pg_dump` lógico do PostgreSQL HML: 21 MB, 71 tabelas, sem erros (em `.runtime/audit/backups/`).
- Diretório do plugin não localizado nos caminhos padrão (GLPI containerizado/atrás de vhost) — backup do plugin pendente de path correto; dump lógico do banco garantido.

### Resiliência — restart controlado do integration-service (PASS)
- Health recuperou em 14s; `dead_letter` 0→0; Redis locks 0→0; conversas 220→220 (sem duplicação).
- Sem erros fatais; worker de inatividade re-armado (`JOB_STARTED`); migrations idempotentes no boot.

### UI autenticada via HTTP (host HML)
- **T03 Central — PASS**: `/plugins/integaglpi/front/central.php` HTTP 200, sem 403.
- **T09 telefone — PASS**: ticket view 2112319360 sem telefone bruto no HTML.
- **T23 menus/drilldowns — PASS**: technical.health, audit (+`?view=events`), supervisor.command
  (+`?sla=risk`/`?inactivity=autoclose_done`) → 200, sem 403, sem PII.
- **T05 CSRF — PASS**: POST com CSRF inválido e POST não-AJAX → 403 "Acesso negado" (GLPI core),
  sem mutação. Robustez de CSRF confirmada em runtime.
- **T22 positivo / T04 / T06 / T07 / T08 / T11 — NOT_EXECUTED via curl**: o GLPI core usa token CSRF
  de uso único ligado à sessão; o `curl` não replica o ciclo (token de preflight não aceito pelo
  check global → 403). Ações positivas mutáveis/IA exigem **navegador real na rede interna**
  (operador acompanhando). Não é bug do produto — é o ciclo de CSRF do core.

### Pendências para fechar UI (com navegador real interno)
- T22 SmartHelp positivo (resumo/busca local/ajuda externa/PII Guard) — observar IA em fallback (modelos Ollama ausentes).
- T04 salvar categoria/tempo; T06 técnico exibido; T07 transferência A→B; T08 notificação; T11 reabertura.
- Usar tickets/conversas `AUDIT-*` em entidade de teste dedicada (evitar mutação no ticket de cliente real Klarind).
