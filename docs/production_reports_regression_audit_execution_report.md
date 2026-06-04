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
