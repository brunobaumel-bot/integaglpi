# Smoke Tests IntegraGLPI — Roadmap V5 Final

**Versão:** 2.0  
**Atualizado em:** 2026-05-28  
**Uso:** Executar manualmente em TESTE/HOMOLOGACAO.  
**Regra:** Nunca chamar IA automaticamente, nunca enviar WhatsApp, nunca alterar produção.

---

## Preflight Obrigatório (antes de qualquer smoke)

```bash
git status --short        # deve retornar vazio
git diff --check          # deve retornar vazio
cd integration-service && npx tsc --noEmit   # zero erros
cd integration-service && npx vitest run     # 100% PASS
find integaglpi -name "*.php" -exec php -l {} \;  # zero erros
```

Abortar se qualquer comando acima falhar.

---

## F0 — Gold Readiness (Smokes Estáticos)

| ID | Smoke | Resultado esperado |
|----|-------|--------------------|
| T01 | `git status` limpo + `git diff --check` | CLEAN |
| T02 | `npx tsc --noEmit` | CLEAN |
| T03 | `npx vitest run` 100% PASS | ≥695 testes PASS |
| T04 | `php -l` todos `.php` | CLEAN |
| T05 | `composer test` (PHPUnit isolado) | PASS ou RESSALVA_AMBIENTAL se vendor ausente |
| T11 | Webhook Guard: wrong `phone_number_id` → HTTP 200, sem FSM | PASS (análise de código) |
| T12 | `/health` sem secret; `/internal/*` exige Bearer | PASS |

---

## F1 — Ops Console, Entidade e Identidade

| ID | Smoke | Resultado esperado |
|----|-------|--------------------|
| S-F1-01 | Seletor `glpi_entity_id` no Central: dropdown controlado, sem `glpi_entity_name` no payload | PASS |
| S-F1-02 | Botão "Aplicar entidade memorizada" aparece quando `memoryEntityId > 0` | PASS |
| S-F1-03 | Clicar "Aplicar entidade memorizada" posta `action=confirm_entity` com `glpi_entity_id` inteiro | PASS |
| S-F1-04 | Source label (memória / seleção manual) aparece na card da conversa | PASS |
| S-F1-05 | Contato novo (sem memória): fluxo normal via seletor | PASS |
| S-F1-06 | `central.action.php` rejeita `glpi_entity_name` no payload | PASS |

---

## F2 — WhatsApp Profissional

| ID | Smoke | Resultado esperado |
|----|-------|--------------------|
| S-F2-01 | Mensagem de texto livre dentro de 24h → enviada normalmente | PASS |
| S-F2-02 | Mensagem de texto livre fora de 24h → bloqueada; retorna erro `OUTSIDE_24H_WINDOW` | PASS |
| S-F2-03 | Envio via template fora de 24h → permitido com template configurado | PASS |
| S-F2-04 | Chamado reaberto/vinculado mantém `conversation_id` e histórico | PASS |
| S-F2-05 | `OUTBOUND_SEND_MODE=mock` em TESTE: nenhuma mensagem real enviada | PASS |
| S-F2-06 | Idempotency key duplicada → HTTP 200 sem envio duplo | PASS |

---

## F3 — Monitoramento, SLA e Qualidade

| ID | Smoke | Resultado esperado |
|----|-------|--------------------|
| S-F3-01 | `quality.dashboard.php`: carrega com `ok: true`, KPIs numéricos, `masked_phone` (nunca `phone_e164` raw) | PASS |
| S-F3-02 | `observability.php`: cards de audit, delivery, dead_letter sem token visível | PASS |
| S-F3-03 | `supervisor.php`: `ai_supervisor_enabled` presente, entity scope correto | PASS |
| S-F3-04 | `audit.php`: events paginados, `payload_json` sanitizado | PASS |
| S-F3-05 | `/internal/glpi/quality-dashboard` → HTTP 401 sem Bearer | PASS |
| S-F3-06 | `/internal/glpi/observability` → HTTP 401 sem Bearer | PASS |
| S-F3-07 | Inatividade: reminder 1/2/3 disparados no job conforme config; autoclose após reminders | PASS |
| S-F3-08 | Logs Node sem PII em claro nos eventos de qualidade | PASS |

---

## F4 — IA, KB, Console e Feedback Humano

| ID | Smoke | Resultado esperado |
|----|-------|--------------------|
| S-F4-01 | `ai.config.php`: `dry_run=true`, `provider=disabled` ou `ollama`, sem token visível | PASS |
| S-F4-02 | `ai.quality.php`: análise com `dry_run=true` → resposta contém `dryRun: true`, Ollama não chamado | PASS |
| S-F4-03 | `copilot.draft.php`: rascunho exibido ao técnico, NÃO enviado automaticamente | PASS |
| S-F4-04 | `kb.php`: artigo criado com status `draft`; publicar exige CSRF + `requireKnowledgeBaseUpdate()` | PASS |
| S-F4-05 | `kb.candidates.php`: candidato aprovado → sem INSERT em `glpi_knowbaseitems` | PASS |
| S-F4-06 | `coaching.php`: aviso anti-punitivo visível; sem ranking de técnicos | PASS |
| S-F4-07 | `risk.feedback.php`: apenas `useful/not_useful/incorrect` aceitos; notas ≤500 chars | PASS |
| S-F4-08 | `ai.pilot.php` / diagnostics: `cloudEnabled: false`, `dpoApproved: false`, `directorApproved: false` | PASS |
| S-F4-09 | Logs de análise de qualidade: sem phone/e-mail real, sem token; `[REDACTED]` onde aplicável | PASS |
| S-F4-10 | `external_research_cloud_enabled=false` no diagnóstico Node | PASS |
| S-F4-11 | Ollama ausente + `SMOKE_TEST_SKIP_OLLAMA=true`: dry-run path funciona sem erro | PASS |
| S-F4-12 | `online.monitor.php`: alertas internos read-only; sem WA enviado; sem mutation de ticket | PASS |

---

## F5 — Integrações Futuras (Smokes Estáticos — Backlog V6)

Os itens abaixo são verificações de ausência (confirmam que integrações não foram criadas prematuramente).

| ID | Smoke | Resultado esperado |
|----|-------|--------------------|
| S-F5-01 | `grep -r "logmein\|zabbix\|/erp/" integration-service/src/ integaglpi/` → sem resultados | PASS (ausência confirmada) |
| S-F5-02 | `AiSecretVaultService::ALLOWED_PROVIDERS` não contém `logmein`, `zabbix`, `erp` | PASS (análise de código) |
| S-F5-03 | `/internal/glpi/logmein*`, `/zabbix*`, `/erp*` → HTTP 404 | PASS |
| S-F5-04 | `external_research_cloud_enabled=false` (carryover de F4) | PASS |

**Nota:** Smokes de implementação F5 (adapter, UI, vault estendido, migration) pertencem ao ciclo V6.

---

## V7 M1 — Nova Porta de Entrada WhatsApp

| ID | Smoke | Resultado esperado |
|----|-------|--------------------|
| S-V7-M1-01 | Novo contato escolhe fila e informa empresa, nome, etiqueta de 4 dígitos e resumo | Perfil salvo; ticket só abre depois de entidade resolvida |
| S-V7-M1-02 | Novo contato responde `não sei` na etiqueta | Perfil salvo com `equipment_tag_unknown=true`; fluxo segue para resumo |
| S-V7-M1-03 | Contato com memória de entidade ativa completa o resumo | Ticket abre na entidade memorizada; sem seleção manual |
| S-V7-M1-04 | Contato sem memória completa o resumo | Conversa fica `awaiting_entity_selection`; nenhum ticket com entidade nula/0 |
| S-V7-M1-05 | Título do ticket | Usa formato curto `[WA][Fila] Empresa - etiqueta/sem etiqueta - nome - resumo` |
| S-V7-M1-06 | Corpo do ticket | Contém empresa, nome, etiqueta, resumo, telefone e origem da entidade |
| S-V7-M1-07 | Mídia/áudio durante coleta | Recusado com fallback textual; webhook não bloqueia; sem download de mídia |
| S-V7-M1-08 | IA/cloud/LogMeIn | Nenhum serviço de IA/cloud/LogMeIn é chamado nesse fluxo |

---

## V7 M2 — Copiloto e Conhecimento Operacional

| ID | Smoke | Resultado esperado |
|----|-------|--------------------|
| S-V7-M2-01 | Abrir aba WhatsApp do chamado | Painel Ajuda Inteligente aparece abaixo da resposta manual; Copiloto não envia WhatsApp automaticamente |
| S-V7-M2-02 | Clicar em Ajuda Inteligente | Botão mostra "Analisando localmente...", preenche o resumo técnico sem PII quando houver conteúdo, exibe KB/checklist ou erro claro de schema/config; sem cloud automática |
| S-V7-M2-03 | Ajuda Inteligente local-first | Busca KB GLPI local primeiro; sem cloud automática; pesquisa externa só com clique/consentimento |
| S-V7-M2-04 | Resumo técnico | Campo "Resumo técnico sem dados pessoais" preenchido com texto sanitizado |
| S-V7-M2-05 | Sugestões KB | Cada sugestão mostra fonte, categoria, trecho, motivo e confiança operacional |
| S-V7-M2-06 | Checklist/perguntas | Passos de diagnóstico e perguntas faltantes aparecem para revisão do técnico |
| S-V7-M2-07 | Feedback "Ajudou" em artigo GLPI | Registra `glpi_knowbaseitem_id`; não grava métrica nominal punitiva |
| S-V7-M2-08 | Feedback "Não ajudou" em candidato | Registra `kb_candidate_id`; ranking futuro só usa agregados |
| S-V7-M2-09 | Schema 044 | Status mostra compatibilidade da migration 044 por check seguro sem DB mutation |
| S-V7-M2-10 | Pesquisa externa sem clique | Nenhuma chamada cloud ocorre no carregamento ou na consulta local |
| S-V7-M2-11 | Pesquisa externa com clique | Exige confirmação humana e PII Guard; contexto enviado é sanitizado |
| S-V7-M2-12 | PII detectada na pesquisa externa | Bloqueia envio para cloud e registra audit sanitizado |
| S-V7-M2-13 | Provider cloud indisponível | Mostra mensagem útil; não falha o atendimento |

## V7 M2 Fix2 — Runtime Ajuda Inteligente + Sugerir Resposta

| ID | Smoke | Resultado esperado |
|----|-------|--------------------|
| S-V7-M2-FIX2-01 | Clicar em "Ajuda Inteligente" com Node ativo | Botão muda para "Analisando localmente...", badge vira "analisando" (azul), resultado aparece em ≤10s; botão reabilita |
| S-V7-M2-FIX2-02 | Clicar em "Ajuda Inteligente" com Node lento/inativo | Botão muda para "Analisando..." ao clicar; após 25s badge vira "erro" (vermelho) com mensagem "não respondeu no prazo"; **botão volta habilitado** (não fica travado) |
| S-V7-M2-FIX2-03 | Clicar em "Ajuda Inteligente" com Node inativo — segundo clique | Após erro do primeiro clique, segundo clique dispara nova tentativa visível |
| S-V7-M2-FIX2-04 | "Sugerir resposta" com Node inativo — mensagem HTTP 500 | Status mostra "Copiloto indisponível (erro interno — HTTP 500). Verifique se o serviço de IA Node está ativo e configurado." — NOT "Não foi possível usar o Copiloto agora." |
| S-V7-M2-FIX2-05 | "Sugerir resposta" com timeout (HTTP 504) | Status mostra "O Copiloto não respondeu a tempo. Tente novamente em breve." |
| S-V7-M2-FIX2-06 | "Sugerir resposta" com permissão negada (HTTP 403) | Status mostra "Sem permissão para usar o Copiloto ou sessão expirada. Recarregue a página." |
| S-V7-M2-FIX2-07 | "Sugerir resposta" com Node ativo | Job é criado, polling inicia, rascunho aparece na textarea para revisão manual; **não enviado automaticamente** |
| S-V7-M2-FIX2-08 | Pesquisa externa ("Pedir ajuda nuvem") | Exige confirmação (`window.confirm`); se timeout/rede falhar, mensagem "tempo esgotado" aparece no panel (não silenciosa) |
| S-V7-M2-FIX2-09 | Verificar console do browser | Zero uncaught promise rejections durante fluxo normal e durante erro de rede |
| S-V7-M2-FIX2-10 | Verificar php error_log após clicar Ajuda Inteligente com erro | Log contém `[integaglpi][smart_help][unexpected]` se houver Throwable — nunca contém Bearer/senha |

**Nota de verificação:** Para reproduzir FIX2-02/03, parar o serviço Node (`docker stop integration-service`) e clicar o botão. O botão deve voltar a ser clicável após 25 segundos com mensagem de erro visível.

## V7 M4 — Performance, Escala e LGPD

| ID | Smoke | Resultado esperado |
|----|-------|--------------------|
| S-V7-M4-01 | Revisar migration 045 | Arquivo é idempotente, só cria índices e não contém comandos destrutivos |
| S-V7-M4-02 | Homologar migration manualmente | DBA executa manualmente em TESTE; produção permanece intocada |
| S-V7-M4-03 | Central com volume | Lista/conversa continuam carregando; mensagens por conversa usam índice `conversation_id, created_at DESC` |
| S-V7-M4-04 | Inatividade | Índice status/updated_at existente é reconhecido; não há duplicidade desnecessária |
| S-V7-M4-05 | Feedback KB | Votos por ticket consultáveis sem ranking nominal punitivo |
| S-V7-M4-06 | LGPD retenção | Owner humano valida prazos antes de qualquer expurgo; nenhuma deleção automática ocorre |
| S-V7-M2-13 | Gerar Base por chamados resolvidos | Tela usa linguagem operacional, sem exigir leitura de etapas P2/P3/P4 |
| S-V7-M2-14 | Rascunhos KB | Rascunhos permanecem para revisão humana; sem publicação automática |
| S-V7-M2-15 | Guards preservados | CSRF/RBAC continuam ativos; IA não altera ticket/status/prioridade |

---

## V7 Final — Enterprise Controlado

| ID | Smoke | Resultado esperado |
|----|-------|--------------------|
| S-V7-M5-01 | Revisar `docs/logmein_truth_audit.md` | LogMeIn classificado como PARCIAL/read-only opcional; nenhuma dependência operacional nova |
| S-V7-M5-02 | Grep de endpoints proibidos LogMeIn | Nenhum endpoint de UI/Node inicia `/hosts/{id}/connection`, `remote-access/start`, script, deploy ou RMM |
| S-V7-M5-03 | Flags LogMeIn em ambiente | `LOGMEIN_INTEGRATION_ENABLED=false` e `LOGMEIN_RECONCILIATION_ENABLED=false` em produção até gate formal |
| S-V7-M5-04 | Matriz de feature flags | `docs/feature_flags_matrix.md` lista defaults seguros e gates humanos |
| S-V7-M5-05 | Runbook de release | `docs/release_runbook.md` exige Cursor review, commit manual, deploy manual, rollback e smoke |
| S-V7-M5-06 | Readiness final | `docs/v7_final_readiness.md` lista riscos restantes e critérios de homologação/produção |
| S-V7-M5-07 | Problem management assistivo | Sugestões de recorrência são read-only/agregadas; nenhum problem record é criado automaticamente |
| S-V7-M5-08 | Coaching não punitivo | Métricas não exibem ranking nominal punitivo de técnico |
| S-V7-M5-09 | Cloud/IA | Cloud continua OFF sem DPO + direção + admin + incidentAck; IA não envia WhatsApp e não altera ticket |
| S-V7-M5-10 | Release abort conditions | Qualquer `.env`, produção, migration aplicada, envio real indevido, token exposto ou automação proibida aborta |

---

## V8 — Central Enterprise 3.0 + Observabilidade Segura (Pacote 1)

Escopo entregue neste pacote: **Observabilidade Segura** — flags críticas + migrations 044/045
na Saúde Técnica (read-only). A reorganização da Central por jornadas fica para o pacote seguinte.

| ID | Smoke | Resultado esperado |
|----|-------|--------------------|
| S-V8-OBS-01 | Abrir Saúde Técnica (`front/technical.health.php`) com perfil de diagnóstico | Página carrega; novo bloco "Flags Críticas e Ambiente" e "Migrations Críticas" aparecem |
| S-V8-OBS-02 | Inspecionar bloco de flags | Mostra ENVIRONMENT, AI_SUPERVISOR_ENABLED, INTEGRATION_SERVICE_HOST (host apenas), META_WEBHOOK_CONFIGURED; flags Node não expostas aparecem como "não exposto pelo diagnóstico" |
| S-V8-OBS-03 | Conferir ausência de segredos | Nenhum token, PSK, senha, auth key ou URL completa com credenciais é exibido; URLs aparecem só como scheme+host(+porta) |
| S-V8-OBS-04 | Bloco Migrations | 044 e 045 mostram "compatível" ou "pendente" via verificação de arquivo; nenhuma query/escrita no banco |
| S-V8-OBS-05 | Perfil sem permissão de diagnóstico | `front/technical.health.php` retorna erro de direito (RBAC preservado) |
| S-V8-OBS-06 | Nenhuma flag é alterada | A tela é 100% read-only; não há botão que grave flag, `.env` ou produção |
| S-V8-OBS-07 | Ambiente PRODUÇÃO | Flag ENVIRONMENT marca badge de atenção quando detectado `producao` pela URL base |

Observação: a Ajuda Inteligente (runtime V7-M2) NÃO foi tocada neste pacote.

---

## Worker IA Observadora Online (TESTE/HOMOLOGACAO)

```bash
docker compose -f docker-compose.dev.yml up -d integaglpi-ai-online-alert-worker
```

- Confirmar logs: `[integration-service][ai_online_alerts][loop_started]` e `[loop_tick]`
- `AI_ONLINE_ALERT_WORKER_INTERVAL_SECONDS=60` aplicado
- Na Central IA: salvar modelo/timeout → abrir Config efetiva → confirmar `node_runtime_cache.strategy=no_cache_db_read_per_request`
- Runtime Node mostra `origem=db`, modelo e timeout salvos sem rebuild
- Fallbacks: `AI_SUPERVISOR_MODEL` / `AI_SUPERVISOR_TIMEOUT_SECONDS` quando vars específicas ausentes
- Gerar mensagem com termo forte ("supervisor", "procon") → validar alerta interno no Monitor Online em ≤2 min
- Confirmar: alerta interno apenas — sem WA, sem mutation de ticket, sem escrita KB

---

## Condições de Abortar (qualquer smoke)

- Qualquer WhatsApp / template enviado automaticamente
- Qualquer ticket/status/prioridade alterado pela IA
- Qualquer escrita automática em `glpi_knowbaseitems`
- Logs exibindo PII, segredo ou prompt bruto
- `/health` expondo valor real de token/secret
- `AI_PILOT_CLOUD_ENABLED=true` sem gate DPO + direção + admin + incidentAck
- `OUTBOUND_SEND_MODE=real` em ambiente de TESTE
- Workspace com `git status --short` não vazio antes do smoke

---

## Referência Rápida — Feature Flags Críticas

| Flag | Default seguro | Risco se invertido |
|------|----------------|--------------------|
| `OUTBOUND_SEND_MODE` | `mock` | CRÍTICO — envia WA real |
| `AI_SUPERVISOR_ENABLED` | `false` | MÉDIO — ativa IA sem dry-run |
| `AI_SUPERVISOR_DRY_RUN` | `true` | ALTO — chama Ollama real |
| `AI_PILOT_CLOUD_ENABLED` | `false` | CRÍTICO — chama cloud externo |
| `AI_PILOT_HARD_BUDGET_BLOCK` | `true` | CRÍTICO se false |
| `AI_PILOT_DPO_APPROVED` | `false` | CRÍTICO se true sem gate |
| `EXTERNAL_RESEARCH_CLOUD_ENABLED` | `false` | CRÍTICO — chama cloud externo |
