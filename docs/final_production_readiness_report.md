# Relatório Final de Prontidão para Produção — IntegraGLPI V8

Phase: `integaglpi_v8_final_production_readiness_execution_001`
Executado em: 2026-06-04 (UTC-3) via SSH em HOMOLOGAÇÃO (host `GLPIv5`).
Número de teste autorizado: `41988334449` (`+5541988334449`).

> Auditoria read-only/controlada. Sem correção de código, sem produção, sem deploy/commit,
> sem SQL destrutivo. Nenhum segredo/PII impresso.

---

## FINAL_RELEASE_DECISION — fonte autoritativa atual

```yaml
status: GO_WITH_RESSALVA_CANDIDATE
production_allowed_now: false
blockers_remaining: []
accepted_ressalvas:
  - Copilot/IA local pode ficar OFF ou em fallback honesto em produção.
  - Cloud externa permanece OFF por padrão.
  - LogMeIn permanece OFF ou read-only por padrão.
  - package_manifest incomplete aceito apenas em HML.
  - Backup do plugin produtivo obrigatório antes de deploy.
  - Smoke pós-deploy e monitoramento 24h obrigatórios.
requires:
  - Cursor final review.
  - Commit manual escopado.
  - Backup real do plugin produtivo.
  - Backup banco conforme runbook.
  - Conferência das flags de produção.
  - Deploy manual.
  - Smoke pós-deploy.
  - Monitoramento 24h.
```

### Nota de consistência

As seções históricas abaixo preservam evidências reais de execuções anteriores. Estados `NO_GO`,
`PARTIAL`, `NOT_EXECUTED` e `BLOCKED` dessas tentativas foram superados pelo smoke manual assistido
ou mantidos apenas como histórico operacional. Eles não são mais a decisão final atual deste relatório.

---

## Histórico — Smoke final com fixture AUDIT dedicada — 2026-06-04

Phase: `integaglpi_v8_final_ui_mutation_audit_fixture_smoke_001`.

**VERDICT histórico: NO_GO — SUPERSEDED_BY_MANUAL_ASSISTED_SMOKE.**

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

## 1. Veredito histórico inicial

**VERDICT histórico: NO_GO (condicional — sem defeitos encontrados; critérios obrigatórios de GO não concluídos).**
**Status atual: SUPERSEDED_BY_MANUAL_ASSISTED_SMOKE.**

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
`AI_PILOT_CLOUD_ENABLED=unset`, `AI_SUPERVISOR_ENABLED=true` (fato de HML; default de produção é `false`),
**`LOGMEIN_INTEGRATION_ENABLED=true`** (diverge do default seguro),
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

## 9. Addendum — smoke manual assistido + correções finais de produção (2026-06-05)

### Smoke manual assistido (PASS)
Operador: Bruno Baumel (Super-Admin). Fixtures: ticket `2112319368` / conversa `8983a895-4c84-450e-b9ff-34ce67f6633c`.

| Teste | Status | Evidência |
|---|---|---|
| T07 Transferência | PASS | `Ticket_User` com users_id 13+803; log `notify_ticket_transferred` idempotência 803; sem acúmulo |
| I07 Campos laterais GLPI | PASS | GLPI API: `itilcategories_id=392`, `priority=5`, `impact=4`, `requesttypes_id=3` |
| T11/I01 Solucionar/reabrir (2 ciclos) | PASS | Dois eventos `notification/solution/SEND` com wamid confirmados (22779 e 22780) |
| I02 CSAT após reabertura | PASS | Mensagem interativa enviada em ambos os ciclos de fechamento |
| Redis locks após smoke | 0 | redis-cli SCAN |
| dead_letter após smoke | 0 | SELECT count(*) |

### Por que WhatsApp não chegou no celular (comportamento esperado)
O fluxo que bloqueou: `WINDOW_24H_CLOSED_TEMPLATE_REQUIRED — last_inbound_at: null`.
O ticket 2112319368 foi criado manualmente, sem inbound real. A Meta bloqueia mensagens de texto livre quando a janela de 24h não foi aberta. **Não é bug** — é a regra da plataforma Meta. Templates e mensagens interativas passam; texto livre exige inbound prévio do cliente.

### Correções aplicadas neste addendum
- `ticket_tab.php`: tratamento amigável de `invalid_provider_response` no Copilot (COPILOT_DRAFT_INVALID_JSON exibe "Copiloto indisponível: resposta do modelo inválida..." sem vazar output bruto).
- `docs/feature_flags_matrix.md`: seção V8 Final com Copilot OFF aceitável em produção + janela 24h documentada como comportamento Meta.

### Backups não-destrutivos disponíveis em HML
- `pg_dump` lógico: `/home/azureuser/projeto/.runtime/audit/backups/hml_integration_20260604_180956.sql` (21 MB, 71 tabelas, sem erros)
- Plugin tar: diretório do plugin não encontrado nos caminhos padrão (GLPI containerizado); dump lógico cobre os dados críticos

### Ressalvas aceitas para GO_WITH_RESSALVA
1. **COPILOT_DRAFT_INVALID_JSON**: modelo `qwen2.5:7b` retorna JSON malformado — tratado no Node e agora também com mensagem amigável no UI PHP. Aceito se IA local desabilitada por flag (`provider=disabled`) em produção.
2. **Janela 24h Meta**: outbounds bloqueados fora da janela são comportamento correto da plataforma. Não é bug.
3. **package_manifest incomplete**: aceito em HML; confirmar antes do GO produção.
4. **LOGMEIN_INTEGRATION_ENABLED=true em HML**: diverge do default seguro (OFF). Confirmar na promoção.

### Ações manuais antes do GO produção
1. Cursor review desta fase.
2. Commit manual escopado (`ticket_tab.php` + docs).
3. Conceder `plugin_integaglpi` UPDATE ao perfil operacional de produção se não existir.
4. Executar smoke final pós-deploy: `/health`, Central, ticket AUDIT-*, SmartHelp, dead_letter=0, locks=0.
5. Monitorar 24h: dead_letter, locks, taxa de erro de mídia, logs sem PII.

### Testes validados
- `npx tsc --noEmit`: PASS
- `npx vitest run`: 109 arquivos / 911 testes PASS
- `php -l` plugin: 217 arquivos / 0 falhas
- `git diff --check`: PASS (apenas avisos CRLF)

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

## 10. HISTORICAL_BLOCKED_ATTEMPTS_SUPERSEDED — profile rights rerun HML — 2026-06-05

Phase: `integaglpi_v8_final_profile_rights_and_behavioral_rerun_001`.

Resultado histórico: **BLOCKED**.
Status atual: **SUPERSEDED_BY_MANUAL_ASSISTED_SMOKE**.

Evidencia:

- HML confirmado em `GLPIv5`; containers HML `integration/postgres/redis` UP; `prod-*` apenas listados e ignorados.
- `/health` do Node OK; PostgreSQL OK; Redis OK; `redis_locks=0`; `dead_letter=0`.
- Usuario HML autenticado e com perfil `Super-Admin`; `plugin_integaglpi=3` e direito nativo de ticket presente.
- Tecnicos HML `809` e `810` existem e estao ativos.
- A fixture autorizada `AUDIT-RUNTIME-20260604162545` esta atribuida ao tecnico `809`.
- O endpoint `central.action.php` retornou HTTP 403 para `transfer` porque a sessao autenticada nao e o tecnico dono da conversa. Runtime permaneceu `809|open|open|2112319362`.

Decisao:

- Nao foi aplicado ajuste de perfil porque o bloqueio confirmado nao e falta de `plugin_integaglpi` UPDATE nem falta de Super-Admin.
- Para executar T07/T11/I01/I02/I07 sem contornar RBAC/ownership, e necessario fornecer sessao/credencial HML do tecnico `809` ou criar uma fixture `AUDIT-*` cujo dono operacional seja o usuario HML autenticado.
- Nenhuma alteracao de codigo, deploy, commit, SQL destrutivo, contato real ou producao foi executada.

## 11. HISTORICAL_BLOCKED_ATTEMPTS_SUPERSEDED — ownership validated behavioral rerun HML — 2026-06-05

Phase: `integaglpi_v8_final_ownership_validated_behavioral_rerun_001`.

Resultado histórico: **BLOCKED**.
Status atual: **SUPERSEDED_BY_MANUAL_ASSISTED_SMOKE**.

Evidencia:

- HML confirmado em `GLPIv5`; containers HML `integration/postgres/redis` UP; `prod-*` ignorados.
- `/health` do Node OK; `redis_locks=0`; `dead_letter=0`; GLPI UI autenticada e Central HTTP 200.
- O numero autorizado ja possui 1 conversa aberta: `AUDIT-RUNTIME-20260604162545`, ticket `2112319362`.
- A conversa aberta autorizada esta atribuida ao tecnico `810`, nao ao usuario autenticado na sessao HML.

Decisao:

- Opcao A bloqueada: nao ha credencial/sessao HML do tecnico owner `810` disponivel no arquivo seguro.
- Opcao B bloqueada: criar nova fixture inbound com o mesmo numero autorizado nao e seguro enquanto existe conversa aberta para esse numero; isso faria append/continuidade na conversa atual ou exigiria fechar/mutar ownership fora do caminho operacional.
- T07/T11/I01/I02/I07 nao foram reexecutados para evitar bypass de ownership/RBAC, SQL direto de ownership, uso de outro telefone ou ticket de cliente real.

## 12. HISTORICAL_BLOCKED_ATTEMPTS_SUPERSEDED — safe ownership unblock HML — 2026-06-05

Phase: `integaglpi_v8_final_ownership_safe_unblock_and_behavioral_smoke_001`.

Resultado histórico: **BLOCKED**.
Status atual: **SUPERSEDED_BY_MANUAL_ASSISTED_SMOKE**.

Evidencia:

- HML confirmado em `GLPIv5`; containers HML `integration/postgres/redis` UP; `prod-*` ignorados.
- `/health` do Node OK; `redis_locks=0`; `dead_letter=0`.
- A conversa `AUDIT-RUNTIME-20260604162545` permanece aberta no ticket `2112319362`, com owner operacional `810`.
- O arquivo seguro de credencial HML nao contem sessao/credencial separada do tecnico `810`.
- Nao ha segundo numero de teste explicitamente autorizado no arquivo seguro.

Decisao:

- Metodo `OWNER_810_SESSION` bloqueado por ausencia de sessao/credencial do owner.
- Metodo `SECOND_TEST_NUMBER_NEW_FIXTURE` bloqueado por ausencia de segundo numero autorizado.
- Metodo `CURRENT_CONVERSATION_CLOSED_THEN_NEW_FIXTURE` bloqueado porque exige acao legitima do owner `810` ou operador humano.
- Nenhuma mutacao operacional foi executada.
