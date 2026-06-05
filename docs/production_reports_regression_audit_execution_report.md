# Relatório de Execução — Smoke E2E Pós-Fix em Homologação

Phase: `integaglpi_v8_post_fix_e2e_synthetic_smoke_001`
Executado em: 2026-06-04 (UTC-3) via SSH na homologação (host `GLPIv5`).
Fix sob avaliação: commit `601461c` ("fix(integaglpi): address homologation regression failures").
Número de teste autorizado: `41988334449` (E.164 no banco: `+5541988334449`). Mensagens enviadas pelo operador.

> Relatório de auditoria. Não corrige código, não toca produção, não faz deploy/commit.
> Nenhum segredo/token/telefone de cliente real foi impresso.

---

## 1. Veredito

**VERDICT: PARTIAL (backend pós-fix VERDE; restam apenas testes de camada de UI).**

Com os eventos reais enviados pelo número autorizado, os três alvos do fix foram **exercitados com
eventos novos pós-cutoff e passaram**:

- **T01 PASS** — entidade preservada em nova conversa.
- **T13 PASS** — mídia anexada com `Document_Item` vinculado (cadeia completa).
- **T10 PASS (caminho skip)** — inatividade respeitou atividade recente; sem autoclose/WhatsApp indevido.

Além disso T02, T18, T20 e o fluxo FSM/append passaram. **Nenhum FAIL.** Permanecem `INCONCLUSIVE`
apenas os testes que exigem sessão de **UI GLPI por navegador** (não disponível nesta execução).

---

## 2. Ambiente e cutoff

| Item | Resultado |
|---|---|
| Host | `GLPIv5` (homologação); `prod-*` ignorados |
| Containers HML | `glpi-integaglpi-{integration,postgres,redis}` UP, restarts=0 |
| `/health` | ok:true; postgres ok; redis ready; webhook_guard ativo |
| cutoff_utc | `2026-06-04T14:13:48Z` |
| Evento novo pós-cutoff | conversa `0a7c415c…` criada `2026-06-04 15:12:31Z` |
| OUTBOUND_SEND_MODE | `real` (todo outbound foi só para `+5541988334449`) |
| Deploy do fix | confirmado no `dist` (marcadores T01/T10/T13) |

---

## 3. Foco pós-fix (T01/T10/T13) — RUNTIME

### T01 — Entidade preservada — **PASS**
- Nova conversa `0a7c415c-fdf9-45ee-bc73-c0233abc4ebb` (pós-cutoff) →
  `glpi_ticket_id=2112319360`, `glpi_entity_id=28`, `glpi_entity_name="Ética > Klarind"`.
- Cross-check GLPI API: ticket `2112319360` existe, `entities_id=28`, `status=2`.
- Evidência: SELECT conversations + GLPI API GET /Ticket/2112319360.

### T10 — Inatividade não fecha indevidamente — **PASS (skip path)**
- `inactivity_tracking` da conversa: `status=skipped_by_response`, `skip_reason=recent_inbound`,
  `autoclose_attempted_at=NULL`, sem WhatsApp de cobrança.
- O caminho de falha GLPI (`glpi_permission_denied` sem WhatsApp) não foi disparado porque o GLPI
  não falhou; permanece confirmado por deploy/código + testes unitários.

### T13 — Mídia/anexo com Document_Item — **PASS**
- Imagem inbound `image/jpeg` (228 KB): `media_status=synced`, `glpi_document_id=3894`,
  vinculada ao ticket `2112319360`.
- Logs: `DOWNLOAD_OK → GLPI_DOCUMENT_UPLOAD_OK → POST /Document_Item → "Item adicionado com sucesso ID 16962" → GLPI_DOCUMENT_ITEM_LINK_OK`.
- GLPI API Document/3894/Document_Item: 1 vínculo ao ticket `2112319360`.
- `post_cutoff_uploaded_unlinked/error = 0`.

---

## 4. Matriz T01–T23

| Teste | Status | Evidência |
|---|---|---|
| T01 Entidade | **PASS** | nova conversa pós-cutoff, entity_id=28 + nome; ticket GLPI entities_id=28 |
| T02 Protocolo→GLPI | **PASS** | ticket 2112319360 criado e acessível via GLPI API |
| T03 Travados | INCONCLUSIVE | requer UI Central (Redis 0 locks/dead=0 read-only ok) |
| T04 Categoria/tempo | INCONCLUSIVE | requer UI |
| T05 Salvar/403 | INCONCLUSIVE | requer UI; nenhum 403 indevido nos logs do fluxo |
| T06 Técnico exibido | INCONCLUSIVE | requer UI/atribuição |
| T07 Transferência | INCONCLUSIVE | requer UI + técnicos de teste |
| T08 Notificação | INCONCLUSIVE | requer UI |
| T09 Telefone mascarado | INCONCLUSIVE | requer UI Central |
| T10 Inatividade | **PASS** | skipped_by_response/recent_inbound; sem WhatsApp/autoclose indevido |
| T11 Reabertura | INCONCLUSIVE | requer UI |
| T12 Histórico | **PASS (parcial)** | inbound anexado como follow-up GLPI (4204/4205/4206) |
| T13 Mídia | **PASS** | Document 3894 + Document_Item 16962 vinculados ao ticket |
| T14 Foto na abertura | INCONCLUSIVE | imagem enviada no meio do fluxo (não na abertura); pipeline ok |
| T15 Abas | **PASS (parcial)** | mensagens persistidas + follow-up GLPI consistentes |
| T16 Automação invasiva | **PASS** | sem outbound automático indevido; envios só ao número de teste |
| T17 Nome remetente | INCONCLUSIVE | nome do contato consistente; sem cenário de troca |
| T18 Bot health | **PASS** | /health ok; worker ativo; FSM roteando |
| T19 Abertura manual | INCONCLUSIVE | não executado (entidade 28 é cliente real) |
| T20 Locks/dead-letter | **PASS** | 0 locks; dead_letter=0; DBSIZE baixo |
| T21 Sessão/CSRF | INCONCLUSIVE | requer UI |
| T22 SmartHelp guiado | INCONCLUSIVE | requer UI; endpoint interno exige bearer (401 sem token) |
| T23 Menus/drilldowns | INCONCLUSIVE | requer UI por perfil |

Resumo: **PASS=9** (T01,T02,T10,T13,T16,T18,T20 + T12/T15 parciais), **INCONCLUSIVE=12**, **FAIL=0**, NOT_APPLICABLE=0 (T14/T19 INCONCLUSIVE por condição de teste).

---

## 5. Segurança da execução

- Produção não tocada; `prod-*` apenas listados.
- Outbound exclusivamente para `+5541988334449` (3 mensagens) — nenhum cliente real acionado.
- Nenhum SQL destrutivo (apenas SELECT/INFO/SCAN); GLPI via API REST oficial.
- Nenhuma alteração de runtime/código/`.env`/migration/deploy/commit.
- Webhook Meta com assinatura; endpoints internos com bearer (401 sem token).
- Sem segredos no relatório (tokens aparecem truncados já na origem dos logs).

## 6. Achados de melhoria (análise sênior)
1. **Log hygiene**: corpos de `POST /Document_Item` e `/ITILFollowup` logam telefone e nome do contato
   em claro nos logs do integration-service. Avaliar mascaramento parcial (LGPD), como já feito no PUT de Ticket.
2. `OUTBOUND_SEND_MODE=real` em HML — preferir `mock` salvo janela E2E.
3. Container `glpi-integaglpi-ai` inexistente — habilitar para validar T22/IA local.
4. `LOGMEIN_INTEGRATION_ENABLED=true` em HML — diverge do default seguro (OFF).
5. Redis sem `maxmemory`/eviction.
6. O número "de teste" pertence à entidade de **cliente real** "Ética > Klarind" — recomenda-se número/entidade sintéticos dedicados.

## 7. Para fechar (PARTIAL → GO_READY)
- Executar T03–T09/T11/T17/T19/T21/T22/T23 via sessão de **UI GLPI HML** (perfis técnico/supervisor/admin).
- Opcional: forçar cenário T10 com GLPI negando fechamento (ticket de teste em entidade dedicada) para
  exercitar o ramo `glpi_permission_denied` sem WhatsApp em runtime.
- Enviar uma mídia **não suportada** para exercitar `error_type=unsupported_media_type` em runtime.

---

## 8. Execução complementar UI autenticada — 2026-06-04

Phase: `integaglpi_v8_ui_ai_full_homologation_smoke_001`.

Resultado: **NO_GO para GO final**, com autenticação HML funcional, páginas principais acessíveis e bloqueios de
segurança preservados, porém com dois impedimentos para fechamento completo:

- não existe conversa/ticket `AUDIT-*` disponível no banco HML para executar mutações reais sem tocar dados não sintéticos;
- logs recentes do `glpi-integaglpi-integration` ainda contêm telefone autorizado em claro e prefixos truncados de tokens
  em logs HTTP, então o requisito "logs sem PII/segredos" não está fechado.

Evidências resumidas:

| Item | Resultado |
|---|---|
| Credencial HML | `glpi_hml_ui.env` presente, `600`, `azureuser:azureuser`, chaves esperadas presentes |
| Autenticação GLPI | PASS; login redirecionou para `/front/central.php` |
| Central WhatsApp | PASS; `/plugins/integaglpi/front/central.php` HTTP 200 autenticado |
| Refresh Central | PASS; `central.refresh.php` HTTP 200 JSON `ok=true` |
| Lista técnicos | PASS; `central.technicians.php` HTTP 200 JSON `ok=true` |
| Mensagens sem contexto | PASS guard; `central.messages.php` HTTP 400 `invalid_request` |
| CSRF mutável | PASS guard; `central.action.php` com token inválido retornou 403 antes de mutação |
| SmartHelp token | PASS; `smart.help.php?csrf_token=1` HTTP 200 JSON `ok=true` |
| SmartHelp sem ticket | PASS guard; POST `summarize_ticket` com `ticket_id=0` retornou 403/contexto negado |
| Monitoramento Operacional | PASS; `technical.health.php` HTTP 200 com Auditoria/Eventos/SLA/Inatividade |
| Central Supervisor | PASS; `supervisor.command.php` HTTP 200 com SLA/Inatividade/drilldowns |
| Segurança | PASS; `security.center.php` HTTP 200 autenticado |
| Auditoria | PASS; `audit.php` HTTP 200 autenticado |
| T09 máscara visual | PASS visual; número autorizado não aparece no texto renderizado |
| T09 ressalva técnica | HTML contém telefone em `data-phone`, embora mascarado visualmente |
| Redis locks | PASS; scan `*lock*` retornou 0 |
| Dead letter | PASS; `glpi_plugin_integaglpi_dead_letter` retornou 0 |
| Migrations 044/045 | PASS estrutural; tabela KB feedback existe e índices 045 estão presentes |

Matriz UI pendente:

| Teste | Status | Evidência |
|---|---|---|
| T03 Central/travados | PASS parcial | Central e refresh autenticados OK; Redis locks 0 |
| T04 Categoria/tempo | INCONCLUSIVE | requer conversa/ticket `AUDIT-*` selecionável |
| T05 Salvar/403 | PASS parcial | CSRF inválido bloqueado com 403; mutação real não executada sem `AUDIT-*` |
| T06 Técnico exibido | PASS parcial | Central contém rótulo de técnico/responsável; validação em ticket `AUDIT-*` não executada |
| T07 Transferência | INCONCLUSIVE | endpoint de técnicos OK; transferência real não executada sem `AUDIT-*` |
| T08 Notificação atribuição | INCONCLUSIVE | requer claim/transfer sintético |
| T09 Telefone mascarado | PASS_COM_RESSALVA | mascarado visualmente; raw phone em atributo técnico HTML |
| T11 Reabertura | INCONCLUSIVE | requer ticket/conversa `AUDIT-*` fechado |
| T12 Histórico ao responder | PASS guard/parcial | endpoint mensagens rejeita contexto inválido; resposta real não enviada |
| T15 Abas Conversas vs Chamados | PASS parcial | Central exibe jornadas/abas; validação funcional em `AUDIT-*` não executada |
| T19 Abertura manual | INCONCLUSIVE | não executada sem dado sintético dedicado |
| T21 Sessão/CSRF | PASS | login OK; POST mutável com CSRF inválido bloqueado |
| T22 SmartHelp guiado/IA | PASS guard/parcial | token OK e contexto inválido bloqueado; execução com ticket real não feita |
| T23 Menus/drilldowns | PASS parcial | rotas Monitoramento/Supervisor/Segurança/Auditoria autenticadas OK |

Decisão desta rodada: manter **NO_GO** para promoção final até corrigir higiene de logs e disponibilizar massa
`AUDIT-*` dedicada para executar mutações de UI sem usar ticket/conversa não sintética.

---

## 9. Correção log hygiene + nova checagem HML — 2026-06-04

Phase: `integaglpi_v8_hml_log_hygiene_and_ui_audit_fix_001`.

Resultado: **PARTIAL**.

O pacote local corrige a higiene de logs do `integration-service` e remove telefone completo do DOM da Central.
O Node foi rebuildado/recriado apenas em HOMOLOGAÇÃO (`glpi-integaglpi-integration`) e os logs novos não exibiram
o número autorizado nem Bearer em claro. A parte PHP da Central foi sincronizada para `/home/azureuser/projeto`,
mas a cópia para o plugin publicado em `/home/glpi.eticainformatica.com.br/public_html/plugins/integaglpi` ficou
bloqueada porque `sudo` exige senha interativa.

Evidências:

| Item | Resultado |
|---|---|
| Ambiente | `GLPIv5`, containers HML `integration/postgres/redis`; `prod-*` não usados |
| Node HML | Rebuild/recreate somente `glpi-integaglpi-integration`; `/health` `ok=true`, postgres `true`, redis `ready` |
| Logs novos HML | `raw_test_phone_occurrences=0`, `raw_test_e164_occurrences=0`, `authorization_value_occurrences=0` |
| Token/app-token | Linha `app-token` presente apenas com valor redigido; sem prefixo real impresso |
| UI phone local | `templates/central.php` usa `data-phone` mascarado e JS usa `maskedPhone` |
| PII guard local | `AttendanceCenterService` não libera telefone bruto por simples ownership; exige `RIGHT_VIEW_UNMASKED_PII` |
| UI phone HML live | Ainda contém telefone autorizado em atributo HTML porque plugin publicado não pôde ser atualizado sem sudo |
| Massa AUDIT-* | Não criada nesta rodada; mutações UI ficaram bloqueadas pelo gate de publicação PHP |

Validações locais:

- `cd integration-service && npx tsc --noEmit`: PASS.
- `cd integration-service && npx vitest run tests/logHygieneSanitizer.test.ts tests/sanitizeUrlForLog.test.ts`: 16 PASS.
- `cd integration-service && npx vitest run`: 109 arquivos / 909 testes PASS.
- `php -l` em `templates/central.php`, `AttendanceCenterService.php`, `CentralEntitySelectionStaticTest.php`: PASS.
- `git diff --check`: PASS, com aviso esperado de CRLF no Windows.

Arquivos alterados nesta fase:

- `integration-service/src/infra/logger/logger.ts`
- `integration-service/src/adapters/glpi/logGlpiHttpPreflight.ts`
- `integration-service/tests/logHygieneSanitizer.test.ts`
- `integaglpi/src/Service/AttendanceCenterService.php`
- `integaglpi/templates/central.php`
- `integaglpi/tests/CentralEntitySelectionStaticTest.php`
- `docs/production_reports_regression_audit_execution_report.md`

Decisão: **não fechar GO_READY** até aplicar a parte PHP no plugin HML publicado e repetir T03–T23 com massa `AUDIT-*`.

---

## 10. Rerun após publicação PHP HML — 2026-06-04

Phase: `integaglpi_v8_hml_log_hygiene_and_ui_audit_fix_001_rerun`.

Resultado: **PARTIAL**.

O GLPI HML autenticou normalmente e a Central viva passou a não expor o telefone autorizado no HTML/DOM,
incluindo `data-phone`. Os logs novos do `integration-service` continuam redigidos. Ainda não há massa `AUDIT-*`
no PostgreSQL HML para executar mutações reais de UI sem tocar dados não sintéticos, e o endpoint JSON
`central.refresh.php` ainda retornou o telefone bruto no payload XHR, embora o DOM renderizado use máscara.

Evidências:

| Item | Resultado |
|---|---|
| Ambiente | `GLPIv5`; HML `integration/postgres/redis` UP; `prod-*` ignorados |
| `/health` | `ok=true`, postgres `true`, redis `ready` |
| GLPI UI | Login HML PASS; Central HTTP 200 sem redirect para login |
| Central DOM | `raw_e164_in_html=false`, `raw_plain_in_html=false`, `raw_e164_visible=false`, `raw_plain_visible=false` |
| Central markers | JS live contém `element.setAttribute('data-phone', maskedPhone);` e não contém `data-phone`, `phone` bruto |
| Central refresh | HTTP 200 JSON `ok=true`, 1 row; **ressalva**: payload XHR ainda contém telefone bruto |
| Logs novos | `raw_test_phone_occurrences=0`, `raw_test_e164_occurrences=0`, `authorization_value_occurrences=0`, `app_token_prefix_occurrences=0` |
| Redis/dead letter | locks `0`, dead_letter `0` |
| Massa AUDIT-* | inexistente no PostgreSQL HML |
| IA local | `glpi-integaglpi-ai` ausente |
| AI pilot | `/internal/glpi/ai-pilot/status` HTTP 200, cloud disabled, provider disabled, budget blocked |

Matriz UI/IA:

| Teste | Status | Evidência |
|---|---|---|
| T03 Central | **PASS parcial** | Central HTTP 200, refresh `ok=true`, locks Redis 0 |
| T04 Categoria/tempo | INCONCLUSIVE | requer conversa/ticket `AUDIT-*` selecionável |
| T05 Salvar/403 | **PASS parcial** | POST `central.action.php` com CSRF inválido retornou 403 |
| T06 Técnico exibido | **PASS parcial** | Central contém rótulos de técnico/responsável; sem validação em `AUDIT-*` |
| T07 Transferência | INCONCLUSIVE | técnicos endpoint `ok=true` com 50 usuários; transferência real não executada sem `AUDIT-*` |
| T08 Notificação atribuição | INCONCLUSIVE | requer claim/transfer sintético |
| T09 Telefone mascarado | **PASS DOM / RESSALVA XHR** | HTML/DOM sem telefone bruto; refresh JSON ainda traz telefone bruto |
| T11 Reabertura | INCONCLUSIVE | requer ticket/conversa `AUDIT-*` fechado |
| T12 Histórico ao responder | **PASS guard/parcial** | `central.messages.php` sem contexto retorna 400 `invalid_request`; resposta real não enviada |
| T15 Abas Conversas vs Chamados | **PASS parcial** | Central renderiza jornadas/abas |
| T19 Abertura manual | INCONCLUSIVE | requer massa sintética dedicada |
| T21 Sessão/CSRF | **PASS** | login OK e CSRF inválido bloqueado |
| T22 SmartHelp/IA | **PARTIAL** | SmartHelp token OK e contexto inválido bloqueado; IA local container ausente/provider disabled |
| T23 Menus/drilldowns | **PASS parcial** | Technical Health, Supervisor, Security e Audit HTTP 200; supervisor com SLA/Inatividade/drilldowns |

Decisão: **não promover para GO_READY**. O blocker de logs novos foi fechado, mas ainda restam:

1. remover telefone bruto do payload JSON `central.refresh.php` para técnico comum;
2. criar massa `AUDIT-*` dedicada para concluir mutações reais de UI;
3. habilitar/validar IA local ou aceitar formalmente T22 como partial com provider disabled.

---

## 11. Correção preparada para PII no refresh da Central — 2026-06-04

Phase: `integaglpi_v8_central_refresh_pii_audit_mass_ai_smoke_fix_001`.

Resultado: **PARTIAL / publish bloqueado por permissão HML**.

O endpoint publicado `central.refresh.php` foi autenticado em HML com credencial segura e confirmou o vazamento
residual no JSON (`raw_e164_test=true`, `raw_plain_test=true`). A correção local altera o contrato do
`AttendanceCenterService::applyPiiGuard()` para mascarar `phone_e164` e `email_address` em todos os payloads da
Central, inclusive quando o perfil possui direito de PII. O campo `pii_unmasked_available` passa a indicar apenas
que o perfil teria direito para uma futura visualização explícita, sem entregar PII crua no refresh.

Evidências:

| Item | Resultado |
|---|---|
| HML auth | PASS; login em `/front/central.php` sem imprimir usuário/senha/cookie |
| Refresh publicado | HTTP 200; ainda contém telefone cru antes do publish do patch |
| Patch local | `phone_e164`, `email_address`, snapshot e profile_context sempre mascarados na Central |
| Identificadores de ação | Preservados por `conversation_id`/`ticket_id`; nenhuma ação passa a depender de telefone |
| Sync para projeto remoto | `AttendanceCenterService.php` e teste copiados para `/home/azureuser/projeto` |
| Publicação plugin HML | Bloqueada: `/home/glpi.eticainformatica.com.br/public_html/plugins/integaglpi` sem leitura/escrita para `azureuser`; `sudo -n` exige senha |
| Redis | locks `0` |
| Logs novos | Sem ocorrência do telefone autorizado, E.164 autorizado ou valor de Authorization em logs novos |

Validações:

- `php -l integaglpi/src/Service/AttendanceCenterService.php`: PASS local.
- `php -l integaglpi/tests/CentralEntitySelectionStaticTest.php`: PASS local.
- `php8.3 -l /home/azureuser/projeto/integaglpi/src/Service/AttendanceCenterService.php`: PASS remoto.
- `php8.3 -l /home/azureuser/projeto/integaglpi/tests/CentralEntitySelectionStaticTest.php`: PASS remoto.
- `cd integration-service && npx tsc --noEmit`: PASS.
- `cd integration-service && npx vitest run tests/logHygieneSanitizer.test.ts tests/sanitizeUrlForLog.test.ts`: 16 PASS.
- `cd integration-service && npx vitest run`: 109 arquivos / 909 testes PASS.
- `git diff --check`: PASS, com aviso esperado de CRLF no Windows.

Decisão: **não fechar GO_READY** até publicar o patch PHP no plugin HML, limpar cache GLPI e repetir o check
autenticado de `central.refresh.php` confirmando `raw_e164_test=false` e `raw_plain_test=false`.

---

## 12. Publicação HML e revalidação do refresh da Central — 2026-06-04

Phase: `integaglpi_v8_central_refresh_pii_audit_mass_ai_smoke_fix_001`.

Resultado: **PARTIAL**.

Após liberação de `sudo` sem senha para `azureuser`, o patch PHP foi publicado no plugin HML com backup,
lint e limpeza de cache GLPI. A validação autenticada do `central.refresh.php` passou: o JSON não contém o telefone
autorizado em formato E.164, compacto ou sem máscara, incluindo campos derivados como `contact_profile_snapshot`
e `profile_snapshot_json`.

Evidências:

| Item | Resultado |
|---|---|
| Backup HML | `/home/azureuser/backups/integaglpi_central_refresh_pii_snapshot_20260604_133911` |
| Arquivo publicado | `plugins/integaglpi/src/Service/AttendanceCenterService.php` |
| Lint publicado | `php8.3 -l`: PASS |
| Cache GLPI | `/home/glpi.eticainformatica.com.br/public_html/files/_cache` limpo |
| Refresh autenticado | HTTP 200, `rows=1`, `masked_phone=true`, `conversation_id=true`, `ticket_id=true` |
| PII no refresh | `raw_e164=false`, `raw_plain=false`, `raw_compact=false`, `contaminated_field_count=0` |
| Massa sintética | Ticket `AUDIT-UI-*` criado via API GLPI HML; conversa `AUDIT-CONV-*` vinculada no PostgreSQL |
| Busca Central | `search=2112319361` retorna 1 row e encontra a conversa sintética sem telefone cru |
| Logs novos | Sem telefone autorizado, E.164 autorizado, compact phone, bearer ou Authorization em logs novos |
| Redis/dead letter | locks `0`, dead_letter `0` |

Matriz UI/IA após publicação:

| Teste | Status | Evidência |
|---|---|---|
| T03 Central | PASS | Central HTTP 200; refresh por ticket retorna conversa `AUDIT-*` sem PII |
| T04 Categoria/tempo | PARTIAL | Massa `AUDIT-*` tem entidade/fila; validação visual detalhada não executada |
| T05 Salvar/403 | PASS | POST com CSRF inválido em `central.action.php` retornou 403 |
| T06 Técnico exibido | PARTIAL | Endpoint Central e runtime OK; claim não executado por falta de direito do usuário de teste |
| T07 Transferência | PARTIAL | `central.technicians.php` HTTP 200 com 50 técnicos; transferência real não executada por RBAC/gate |
| T08 Notificação atribuição | INCONCLUSIVE | Claim/transfer real não executado; evita envio WhatsApp fora do necessário |
| T09 Telefone mascarado | PASS | HTML anterior sem PII; JSON atual sem telefone cru e sem campos contaminados |
| T11 Reabertura | INCONCLUSIVE | Requer fechar/reabrir ticket sintético; não executado nesta rodada |
| T12 Histórico ao responder | INCONCLUSIVE | Resposta real não enviada para evitar outbound desnecessário |
| T15 Abas Conversas vs Chamados | PARTIAL | Central e refresh OK; inspeção visual completa não executada |
| T19 Abertura manual | PARTIAL | Ticket sintético criado via GLPI API e conversa vinculada; abertura manual UI não executada |
| T21 Sessão/CSRF | PASS | Login HML OK; CSRF inválido bloqueado |
| T22 SmartHelp/IA | PARTIAL | `smart.help.php?csrf_token=1` HTTP 200; `summarize_ticket` no ticket sintético retornou OK; AI runtime segue provider disabled/hard budget block conforme health |
| T23 Menus/drilldowns | PASS parcial | Technical Health, Supervisor, Audit e Security HTTP 200 |

Validações:

- `php -l integaglpi/src/Service/AttendanceCenterService.php`: PASS.
- `php -l integaglpi/tests/CentralEntitySelectionStaticTest.php`: PASS.
- `php -l integaglpi/front/central.refresh.php`: PASS.
- `php -l integaglpi/templates/central.php`: PASS.
- `php8.3 -l` no arquivo publicado: PASS.
- `cd integration-service && npx tsc --noEmit`: PASS.
- `cd integration-service && npx vitest run tests/logHygieneSanitizer.test.ts tests/sanitizeUrlForLog.test.ts`: 16 PASS.
- `cd integration-service && npx vitest run`: 109 arquivos / 909 testes PASS.
- `git diff --check`: PASS, com aviso esperado de CRLF no Windows.

Decisão: **não promover para GO_READY ainda**. O blocker de PII no refresh foi fechado. Restam apenas ressalvas de
smoke operacional dependentes de perfil com permissões suficientes para claim/transfer/reopen/reply e da decisão
formal sobre T22 com provider IA desabilitado.

---

## 13. SmartHelp neutralização PII residual — 2026-06-04

Phase: `integaglpi_v8_smarthelp_neutral_summary_cloud_preview_fix_001`.

Resultado: **PARTIAL**.

Correção local implementada para neutralizar sujeito identificado, empresa real, placeholders de nome, ticket id e
patrimônio/etiqueta antes do resumo técnico, busca/sugestão local e preview cloud-safe do SmartHelp. Os exemplos de
regressão com `representante da empresa`, `cliente da empresa` e `[nome: [nome]]` foram cobertos por testes. O
PII Guard continua ativo e o preview limpo não fica bloqueado por `name`.

Evidências locais:

| Item | Resultado |
|---|---|
| Resumo técnico Node | `neutralizeSmartHelpPiiText(scrubSummaryFabrications(...))` aplicado no controller |
| Preview cloud-safe | `rewriteCloudSafe()` neutraliza depois da sanitização dupla e roda PII Guard residual no texto final |
| SmartHelp PHP | `sanitizeContext()` aplica neutralização determinística antes de retornar contexto visível |
| Termos técnicos | `sync do AD` e `Active Directory` preservados |
| Produção | Não tocada |

Validações:

- `php -l integaglpi/front/smart.help.php`: PASS.
- `php -l integaglpi/src/Service/SmartHelpService.php`: PASS.
- `php -l integaglpi/templates/ticket_tab.php`: PASS.
- `cd integration-service && npx tsc --noEmit`: PASS.
- `cd integration-service && npx vitest run tests/aiControllerEndpoints.test.ts tests/externalResearchDynamic.test.ts tests/phpSmartHelpStatic.test.ts`: 66 PASS.
- `cd integration-service && npx vitest run`: 109 arquivos / 908 testes PASS.
- `git diff --check`: PASS, com aviso esperado de CRLF no Windows.

HML smoke: **BLOCKED por conectividade**. Em 2026-06-04, `ssh -p 43422 azureuser@10.8.0.1` e
`Test-NetConnection 10.8.0.1:43422` expiraram antes de autenticação. Nenhum rsync/rebuild/restart foi executado.

Decisão: **não fechar GO_READY** até restabelecer VPN/SSH, publicar somente em HML, limpar cache GLPI e repetir:
Resumo do chamado, Busca local, Pedir ajuda externa/preview e PII residual com o caso de regressão.

---

## 14. Smoke final UI mutável com fixture AUDIT dedicada — 2026-06-04

Phase: `integaglpi_v8_final_ui_mutation_audit_fixture_smoke_001`.

Resultado: **NO_GO**.

Ambiente:

| Item | Resultado |
|---|---|
| Host | `GLPIv5` HML |
| Produção | Containers `prod-*` ignorados |
| Node | `/health` OK |
| PostgreSQL | `pg_isready` OK |
| Redis | `PONG`; locks `0` |
| dead_letter | `0` |
| Chrome headless | Google Chrome `149.0.7827.53` |

Fixture:

| Objeto | Resultado |
|---|---|
| Entidade AUDIT | Criada, id `237` |
| Grupo/fila AUDIT | Criado, id `9` |
| Categoria AUDIT | Criada, id `454` |
| Técnico A | Criado, id `809` |
| Técnico B | Criado, id `810` |
| Ticket AUDIT | Criado, id `2112319362` |
| Ticket manual AUDIT | Criado, id `2112319363` |
| Conversa AUDIT vinculada | Não criada por caminho seguro de runtime nesta rodada |
| Telefone autorizado | Somente `41988334449` / `+5541988334449` |

Resultados T04-T23:

| Teste | Status | Evidência |
|---|---|---|
| T04 Categoria/tempo | PARTIAL | Categoria `454` persistida; update de `actiontime` via GLPI API retornou 403 |
| T05 Salvar/403 | PARTIAL | Bloqueios 403 observados; fluxo UI válido completo não fechado por permissões da fixture |
| T06 Técnico exibido | PARTIAL | Ticket_User A criado (`103411`, user `809`); validação visual Central não concluída |
| T07 Transferência | FAIL | PUT Ticket_User A→B retornou 403; responsável permaneceu `809` |
| T08 Notificação atribuição | PASS_CONTRACT_NO_OUTBOUND | Sem outbound WhatsApp executado; sem claim/transfer válido para notificar |
| T11 Reabertura | FAIL | Reabertura plugin em conversa AUDIT real retornou sem atualizar runtime; update status via API retornou 403 |
| T12 Histórico ao responder | PASS | Follow-up AUDIT criado no ticket `2112319362`, id `4209` |
| T15 Abas Conversas vs Chamados | PARTIAL | Abas plugin carregam via GLPI AJAX; validação completa depende de conversa runtime segura |
| T19 Abertura manual | PASS | Ticket manual `AUDIT-MANUAL-*` criado, id `2112319363` |
| T21 Sessão/CSRF | PARTIAL | Login OK; 403 observado em ações não autorizadas; cenário sessão expirada não executado |
| T22 SmartHelp/IA | PARTIAL | HTML da aba contém SmartHelp; Chrome headless não localizou painel após carregamento dinâmico |
| T23 Menus/drilldowns | PARTIAL | Central, Technical Health, Events e Supervisor HTTP 200; SLA indica 404 no conteúdo |

Rollback readiness:

| Item | Resultado |
|---|---|
| Backup SQL atual | Existe: `.runtime/audit/backups/hml_integration_20260604_180956.sql` |
| Tar plugin | Existe e lista `integaglpi/`, `hook.php`, CSS e `composer.json` |
| `pg_restore --list` | Falhou em dump antigo: versão `1.15` não suportada pelo cliente local |
| Restore real | Não executado; requer janela/ambiente isolado |

Segurança:

- Sem produção, sem `prod-*`, sem SQL destrutivo, sem commit e sem deploy.
- Não houve envio WhatsApp por IA, mutação automática de ticket por IA ou KB autopublish.
- Scan de logs recentes encontrou ocorrências do telefone autorizado sem redaction; `logs_without_pii=false`.

Decisão: **NO_GO** até tratar os bloqueios de permissão/fluxo em T07/T11, concluir T22 visual e corrigir log redaction.

---

## 15. Pós-fix NO_GO blockers — HML — 2026-06-04

Phase: `integaglpi_v8_final_no_go_blockers_fix_001`.

Resultado: **PARTIAL**.

Ambiente:

| Item | Resultado |
|---|---|
| Host | `GLPIv5` HML |
| Produção | Containers `prod-*` listados, mas ignorados |
| Node HML | `/health` OK após rebuild/recreate do `glpi-integaglpi-integration` |
| PostgreSQL HML | OK; fixture `AUDIT-RUNTIME-20260604162545` localizada |
| Redis HML | Locks `0` |
| dead_letter | `0` em status ativo |

Correções publicadas em HML:

| Arquivo | Resultado |
|---|---|
| `integaglpi/templates/ticket_tab.php` | SmartHelp read-only renderizado na aba `Contexto WhatsApp`; `php8.3 -l` PASS |
| `integaglpi/src/Service/SmartHelpService.php` | Gate read-only aceita sessão GLPI autenticada; endpoint ainda valida CSRF e `Ticket::can(..., READ)`; `php8.3 -l` PASS |
| `integaglpi/js/integaglpi.js` | Fallback global para SmartHelp em abas dinâmicas e remoção de alerts debug; publicado em HML |

Resultados revalidados:

| Teste | Status | Evidência |
|---|---|---|
| T07 Transferência | BLOCKED_PROFILE | `central.action.php` POST `transfer` retornou 403 `Acesso negado`; runtime permaneceu `809\|open` |
| T11 Reabertura | BLOCKED_PROFILE | `ticket.whatsapp.action.php` POST `reopen` em `AUDIT-CONV-*` retornou 403; status permaneceu `closed\|closed` |
| T22 SmartHelp/IA | PASS_ENDPOINT_AND_RENDER | Aba autenticada contém painel SmartHelp; `summarize_ticket`, `local_search`, `prepare_external_context` e `smart_external` retornaram 200/ok sem PII |
| T23 Menus/drilldowns | PASS | `technical.health.php`, `audit.php`, `audit.php?view=events`, `supervisor.command.php`, `quality.dashboard.php?sla=risk` e `quality.dashboard.php?inactivity=autoclose_done` retornaram 200 sem 404 |
| Logs sem PII | PASS_RECENT | Logs do `glpi-integaglpi-integration` desde a publicação: `PII_HITS=0`, `SECRET_HITS=0` |
| Schema 044/045 | PASS | `glpi_plugin_integaglpi_kb_article_helpfulness` possui colunas esperadas; índices de messages/inactivity/helpfulness presentes |

Validações locais:

| Comando | Resultado |
|---|---|
| `php -l integaglpi/templates/ticket_tab.php` | PASS |
| `php -l integaglpi/src/Service/SmartHelpService.php` | PASS |
| `php -l integaglpi/js/integaglpi.js` | PASS |
| `cd integration-service && npx tsc --noEmit` | PASS |
| `cd integration-service && npx vitest run tests/phpSmartHelpStatic.test.ts tests/logHygieneSanitizer.test.ts` | 33 PASS |
| `git diff --check` | PASS, apenas aviso CRLF esperado no Windows |

Decisão: **PARTIAL**. T22, T23, Redis, dead-letter, schema e logs recentes estão corrigidos. T07/T11 continuam bloqueados pela permissão do usuário de smoke HML antes da mutação; os endpoints preservaram segurança e não alteraram runtime indevidamente. Para fechar GO, executar T07/T11 com perfil HML que possua `plugin_integaglpi` UPDATE/RBAC operacional ou ajustar explicitamente o perfil de teste.
