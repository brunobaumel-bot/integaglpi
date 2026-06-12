# Feature Flags Matrix - IntegraGLPI V7

Phase: `integaglpi_v8_final_governance_lgpd_readiness_and_release_gate_001`
Updated: 2026-06-04

## Rule

Feature flags são controles operacionais. Alterar flag em TESTE, HOMOLOGAÇÃO ou PRODUÇÃO exige gate humano, registro da decisão e smoke direcionado. Este documento não autoriza alteração de `.env`.

## Critical Flags

| Flag | Default seguro | Domínio | Risco se ativada sem gate | Gate mínimo |
| --- | --- | --- | --- | --- |
| `OUTBOUND_SEND_MODE` | `mock` | WhatsApp outbound | Envio real ao cliente | Dono operacional + smoke Meta em TESTE + Cursor review |
| `LOGMEIN_INTEGRATION_ENABLED` | `false` | LogMeIn cache read-only | Chamada externa e cache local desatualizado/incompleto | Infra + Segurança + smoke read-only |
| `LOGMEIN_RECONCILIATION_ENABLED` | `false` | LogMeIn relatório remoto | Chamada externa de relatório e fila local | Infra + Segurança + revisão de HTTP/provider |
| `AI_SUPERVISOR_ENABLED` | `false` | IA supervisora local | Análises automáticas internas | Supervisor + dry-run validado |
| `AI_SUPERVISOR_DRY_RUN` | `true` | IA supervisora local | Provider local real executando análise | Supervisor + teste Ollama/local |
| `AI_SUPERVISOR_PROVIDER` | `disabled` | IA supervisora local | Provider inesperado | Admin + configuração central |
| `AI_ONLINE_ALERT_WORKER_LOOP` | `false` | Worker IA interno | Loop periódico sem acompanhamento | Supervisor + janela TESTE |
| `AI_ONLINE_ALERT_WORKER_INTERVAL_SECONDS` | `60` | Worker IA interno | Carga excessiva se muito baixo | Supervisor + infra |
| `AI_PILOT_CLOUD_ENABLED` | `false` | Cloud pilot | Exposição externa de contexto | DPO + direção + admin + incidentAck |
| `AI_PILOT_EMBEDDINGS_ENABLED` | `false` | Cloud/embeddings | Envio externo de dados | DPO + direção + admin |
| `AI_PILOT_PROVIDER` | `disabled` | Cloud pilot | Provider externo ativo | DPO + direção + admin |
| `AI_PILOT_HARD_BUDGET_BLOCK` | `true` | Cloud pilot | Custo sem bloqueio | Direção + admin |
| `AI_PILOT_DPO_APPROVED` | `false` | Cloud pilot | Uso sem base LGPD | DPO |
| `AI_PILOT_DIRECTOR_APPROVED` | `false` | Cloud pilot | Uso sem autorização executiva | Direção |
| `AI_PILOT_ADMIN_OPT_IN` | `false` | Cloud pilot | Uso sem opt-in técnico | Admin |
| `AI_PILOT_INCIDENT_ACK` | `false` | Cloud pilot | Falta de ciência de incidente/custo | Admin + Segurança |
| `AI_PILOT_TEST_ENVIRONMENT_ONLY` | `true` | Cloud pilot | Cloud em produção sem gate | DPO + direção + Cursor |
| `EXTERNAL_RESEARCH_CLOUD_ENABLED` | `false` | Pesquisa externa | Chamada cloud com PII se guard falhar | DPO + allowlist + PII Guard |
| `GLPI_KB_SEARCH_URL` | vazio | KB local via PHP | Node tenta buscar KB sem endpoint preparado | Admin + Bearer + smoke local |
| `GLPI_KB_SEARCH_TIMEOUT_MS` | limitado | KB local via PHP | Timeout ruim no painel | Admin + smoke |

## LogMeIn Flags

| Flag | Default seguro | Observação |
| --- | --- | --- |
| `LOGMEIN_API_BASE_URL` | vazio/canônico interno por código | Nunca colocar URL com path de ação. Código força paths allowlisted. |
| `LOGMEIN_COMPANY_ID` | secret externo | Não logar, não documentar valor. |
| `LOGMEIN_PSK` | secret externo | Não logar, não documentar valor. |
| `LOGMEIN_TIMEOUT_MS` / `LOGMEIN_HTTP_TIMEOUT_MS` | limitado por código | Evita bloqueio longo do serviço. |
| `LOGMEIN_SYNC_LOCK_TTL_MS` | limitado por código | Evita sync concorrente. |
| `LOGMEIN_RECONCILIATION_LOCK_TTL_MS` | limitado por código | Evita conciliação concorrente. |
| `LOGMEIN_RECONCILIATION_LOOKBACK_DAYS` / `HOURS` | limitado por código | Janela deve ser pequena em TESTE. |
| `LOGMEIN_RECONCILIATION_CHUNK_MINUTES` / `OVERLAP_MINUTES` | limitado por código | Controla volume do relatório. |
| `LOGMEIN_RECONCILIATION_MAX_RETRIES` | limitado por código | Proibido retry loop infinito. |
| `LOGMEIN_RECONCILIATION_CIRCUIT_COOLDOWN_SECONDS` | limitado por código | Protege provider após HTTP 5xx. |

## Operational Gates

| Ambiente | Regra |
| --- | --- |
| TESTE | Pode habilitar flag controlada somente com smoke documentado e sem cliente real quando aplicável. |
| HOMOLOGAÇÃO | Pode habilitar flag após Cursor review e aprovação humana da área dona. |
| PRODUÇÃO | Alteração exige release window, rollback, smoke pós-deploy e aprovação explícita. |

## Forbidden Shortcuts

- Nunca habilitar cloud sem DPO + direção + admin + incidentAck.
- Nunca trocar `OUTBOUND_SEND_MODE` para `real` em TESTE.
- Nunca habilitar LogMeIn como requisito para criar ou responder ticket.
- Nunca usar feature flag para contornar CSRF/RBAC/Bearer/entity scope.
- Nunca registrar segredo ou token no valor auditado.

## V8 — Exibição read-only na Saúde Técnica

A tela **Saúde Técnica** (`front/technical.health.php`) exibe, somente leitura, as flags críticas e
o ambiente. Regras de exibição:

- Valores autoritativos: `ENVIRONMENT` (URL base do GLPI), `AI_SUPERVISOR_ENABLED` (config do plugin),
  `INTEGRATION_SERVICE_HOST` (host apenas), `META_WEBHOOK_CONFIGURED` (booleano do diagnóstico Node).
- Flags Node ainda não expostas pelo endpoint de diagnóstico — `OUTBOUND_SEND_MODE`,
  `EXTERNAL_RESEARCH_CLOUD_ENABLED`, `LOGMEIN_INTEGRATION_ENABLED`, `GLPI_KB_SEARCH_URL` — aparecem
  como **"não exposto pelo diagnóstico"**; nunca são adivinhadas/fabricadas.
- URLs são reduzidas a `scheme://host(:porta)`; nenhuma URL completa, token, PSK ou senha é exibida.
- A tela **não altera** flag, `.env`, Docker ou produção. Alteração de flag permanece manual e com gate.
- Migrations 044/045: status por verificação de arquivo (sem acesso ao banco), apenas informativo.

## V8 Final — Produto Operacional Controlado

| Flag | Ambiente | Default seguro | Owner da decisão | Risco se ativada | Gate necessário |
| --- | --- | --- | --- | --- | --- |
| `OUTBOUND_SEND_MODE` | Todos | `mock` fora de produção controlada | Dono operacional WhatsApp | Envio real indevido | Smoke Meta + janela + aprovação humana |
| `AI_SUPERVISOR_ENABLED` | Todos | `false` | Supervisão | Análise automática inesperada | Dry-run local + Cursor review |
| `AI_SUPERVISOR_DRY_RUN` | Todos | `true` | Supervisão | Sugestão interpretada como ação | Evidência de read-only |
| `AI_PILOT_CLOUD_ENABLED` | Todos | `false` | DPO + direção + admin | Contexto externo sem base legal | DPO, direção, admin, incidentAck |
| `AI_PILOT_EMBEDDINGS_ENABLED` | Todos | `false` | DPO + direção | Envio externo de dados | PII Guard + smoke sintético |
| `EXTERNAL_RESEARCH_CLOUD_ENABLED` | Todos | `false` | DPO/LGPD | Cloud com PII se guard falhar | Consentimento humano + PII Guard + audit |
| `GLPI_KB_SEARCH_URL` | TESTE/HOMOLOGAÇÃO | vazio até endpoint validado | Admin plugin | Busca local quebrada ou lenta | Bearer interno + smoke local |
| `LOGMEIN_INTEGRATION_ENABLED` | Todos | `false` | Infra + segurança | Dependência externa indevida | Smoke read-only sem cliente real |
| `LOGMEIN_RECONCILIATION_ENABLED` | Todos | `false` | Infra + segurança | Chamada de relatório/provider instável | Circuit breaker + smoke manual |
| `META_WEBHOOK_CONFIGURED` | Diagnóstico | informativo | Meta owner | Diagnóstico incompleto | Read-only; não altera configuração |

Defaults seguros significam: cloud OFF, LogMeIn OFF, IA assistiva sem mutação, KB sem autopublicação, produção com gate humano.

## V8 — SmartHelp cloud-safe rewrite (`SMARTHELP_CLOUD_RESIDUAL_MODE`)

| Flag | Default seguro | Domínio | Efeito |
| --- | --- | --- | --- |
| `SMARTHELP_CLOUD_RESIDUAL_MODE` | `0` (OFF) | Ajuda externa/nuvem | OFF: política estrita `block-on-detected` (qualquer PII detectada bloqueia — comportamento atual preservado). ON: `block-on-residual` somente sobre o texto reescrito cloud-safe (placeholders não bloqueiam; PII residual real bloqueia). |

Regras:
- A nuvem usa SOMENTE o resumo técnico editável, reescrito em contexto genérico (`rewriteCloudSafe`); nunca `ticket.content`/histórico bruto.
- Reescrita determinística (sanitização dupla + cap de 600 chars); IA local opcional, nunca filtro único.
- Provider recebe apenas o texto cloud-safe; auditoria grava hash + tipos + status, sem texto bruto.
- Habilitar a flag exige gate humano + smoke em homologação; nunca alterar `.env` por automação.

## Final V8 Feature Flag Matrix

| Domain | Flag / control | TESTE default | HOMOLOGACAO default | PRODUCAO default | Owner | Human gate |
| --- | --- | --- | --- | --- | --- | --- |
| WhatsApp | `OUTBOUND_SEND_MODE` | `mock` | controlled | production-approved only | Operations WhatsApp | Required before real send |
| WhatsApp | Meta webhook configuration | test phone only | homologation phone only | production phone only | Meta owner | Required per environment |
| SmartHelp | Guided workflow buttons | enabled manually | enabled manually | enabled manually if smoke passed | Support lead | Required for production enablement |
| IA local | Ollama/local provider | optional/manual | optional/manual | optional/manual | AI owner | Required if provider changes |
| Cloud | `EXTERNAL_RESEARCH_CLOUD_ENABLED` | `false` | `false` until DPO smoke | `false` until signed GO | DPO + direction + admin | Required |
| Cloud | PII Guard / sanitized preview | required | required | required | Security/DPO | Cannot be disabled |
| KB | Feedback and candidates | local/reviewed | local/reviewed | local/reviewed | KB owner | Required for publish |
| KB | Autopublish | forbidden | forbidden | forbidden | KB owner | Not allowed in V8 |
| LogMeIn | `LOGMEIN_INTEGRATION_ENABLED` | `false` | `false` unless read-only smoke | `false` unless explicit GO | Infra/security | Required |
| LogMeIn | `LOGMEIN_RECONCILIATION_ENABLED` | `false` | `false` unless provider stable | `false` unless explicit GO | Infra/security | Required |
| Observability | Technical Health | read-only | read-only | read-only | Operations | No mutation allowed |
| Production | Production promotion | blocked | blocked | manual only | Release owner | Signed go/no-go |

Safe default rule: if owner or gate evidence is missing, keep the flag OFF or read-only.

## V9 — KB Quality Pipeline (`integaglpi_v9_kb_quality_001`)

PHASE: `integaglpi_v9_kb_quality_001` — Updated: 2026-06-09

| Flag | Default seguro | Domínio | Efeito | Gate mínimo |
| --- | --- | --- | --- | --- |
| `FEEDBACK_RANKING_ENABLED` | `false` | KB ranking | `false`: ranking puro (lexical + field weights) — caminho legado byte-idêntico. `true`: KbRagCopilotService busca bias agregado via FeedbackService.getRankingBiasMap (threshold 3 votos) e aplica multiplicador não-punitivo (0.80–1.20) por helpfulness Laplace-smoothed no rankHits(). Tipada em env.ts (wiring runtime: integaglpi_v9_kb_ui_rendering_and_ranking_wiring_001). | Smoke local + Cursor review + `npm run test:kb-regression` verde |
| `RERANKER_ENABLED` | `false` | KB cross-encoder | `false`: reranker NÃO é instanciado (nunca no caminho crítico) e o campo `reranker` fica AUSENTE do payload. `true`: KbRerankerService instanciado em buildDependencies (Ollama local via AI_SUPERVISOR_BASE_URL) e aplicado APÓS o gate de confiança (KB_INSUFFICIENT inalterado); timeout 1500ms/inferência; falha/timeout → ordem original. Observabilidade (R2): payload expõe `reranker {applied, model, maxInferenceMs, note}` e `kbsScoreBreakdown[].rerankerScore` real do cross-encoder (nunca inventado). Tipada em env.ts. | Ollama instalado + smoke latência + Cursor review |

Regras:
- Ambas as flags OFF = comportamento pré-V9 preservado (nenhuma regressão).
- `FEEDBACK_RANKING_ENABLED=true` jamais elimina um artigo — apenas ajusta score (multiplier ≥ 0.8).
- `RERANKER_ENABLED=true` jamais acessa cloud, MariaDB ou expõe PII.
- Nenhuma das flags muta ticket, envia WhatsApp ou publica KB automaticamente.
- Identidade de técnicos individuais NUNCA inclusa nos mapas de bias — apenas scores agregados.
- Alterar qualquer flag exige gate humano + smoke em TESTE antes de HOMOLOGAÇÃO.

## V8 — Triagem Nativa GLPI (fase 3: Forms integrados)

PHASE: `integaglpi_v8_forms_native_triage_integration_001` — Updated: 2026-06-06

| Flag | Default seguro | Valores válidos | Domínio | Efeito | Gate mínimo |
| --- | --- | --- | --- | --- | --- |
| `NATIVE_GLPI_TRIAGE_ENABLED` | `false` | `true` / `false` | Triagem WhatsApp | `false`: catálogo paralelo (legado). `true`: triagem nativa GLPI ativa conforme `NATIVE_GLPI_TRIAGE_SOURCES`. | Smoke em TESTE + Cursor review + aprovação operacional |
| `NATIVE_GLPI_TRIAGE_SOURCES` | `itilcategory` | `itilcategory` / `form` / `both` | Triagem WhatsApp | `itilcategory`: apenas ITILCategory via GLPI REST API (comportamento pré-fase 3). `form`: apenas Forms nativos via endpoint PHP `form.catalog.php`. `both`: mescla categorias + forms, ordenados A-Z, máximo 10 opções. | Smoke em TESTE com cada fonte + verificação do cache Redis |

Regras:
- `NATIVE_GLPI_TRIAGE_SOURCES` só é lida quando `NATIVE_GLPI_TRIAGE_ENABLED=true`. Com flag off, o catálogo paralelo (legado) é usado e esta var é ignorada.
- Trocar `NATIVE_GLPI_TRIAGE_SOURCES` em runtime requer reinicialização do serviço Node; o cache Redis (TTL 15 min) pode servir dados da configuração anterior até expirar — flush manual se necessário.
- A fonte `form` chama o endpoint PHP `integaglpi/front/form.catalog.php` com header interno `X-Integaglpi-Key: {integration_auth_key}` (não usa `Authorization: Bearer` — o GLPI 11 / LiteSpeed intercepta esse header antes do script PHP executar); se o endpoint estiver indisponível, a triagem retorna lista vazia e o FSM exibe `error_fallback_message`.
- A fonte `itilcategory` chama diretamente a GLPI REST API (`GET /ITILCategory`); Node nunca acessa MariaDB do GLPI.
- Cache Redis dois níveis: TTL primário 900 s; TTL stale 3600 s (fallback se GLPI indisponível).
- Catálogo paralelo (legado) **não é alterado** e permanece como fallback quando flag off.
- Nenhuma mutation de ticket, KB ou WhatsApp é disparada automaticamente por esta flag.

## V8 Final — Copilot e comportamentos operacionais

| Flag / controle | Default produção | Efeito | Gate |
| --- | --- | --- | --- |
| Copilot/IA local (`AI_SUPERVISOR_ENABLED`) | `false` por padrão | Pode gerar rascunho assistivo somente após aprovação manual; se modelo retornar JSON inválido (`invalid_provider_response`) UI exibe mensagem amigável e bloqueia o rascunho por segurança. Sem WhatsApp, sem mutação de ticket. | `GO_WITH_RESSALVA_ONLY_IF_DISABLED_OR_FALLBACK`; habilitação manual exige modelo Ollama instalado e smoke aprovado |
| Copilot desabilitado (`provider=disabled`) | Aceito em produção | UI exibe "Copiloto indisponível no momento" sem parecer falha crítica. Técnico redige manualmente. | Documentar a decisão antes do GO |
| Meta 24h window (`WINDOW_24H_CLOSED_TEMPLATE_REQUIRED`) | Comportamento Meta — não flag interna | Mensagens de texto livre fora da janela de 24h após último inbound são bloqueadas pelo sistema. Templates e mensagens interativas aprovadas podem ser enviados. **Não é bug** — é a regra da plataforma Meta. | Técnico deve usar template aprovado para retomar conversa |
| `OUTBOUND_SEND_MODE` | `real` (produção) | Envio real via Meta. Em HML só para número de teste autorizado. | Operação WhatsApp |

### Política final de IA em produção

```yaml
production_ai_policy:
  AI_SUPERVISOR_ENABLED: false_by_default
  COPILOT_PROVIDER: disabled_or_local_fallback_unless_manually_approved
  EXTERNAL_RESEARCH_CLOUD_ENABLED: false
  AI_AUTO_WHATSAPP: false
  AI_TICKET_MUTATION: false
  KB_AUTOPUBLISH: false
  production_default: false
  release_status: GO_WITH_RESSALVA_ONLY_IF_DISABLED_OR_FALLBACK
  manual_enable_gate: required
```

## V9 — KB Enrichment & Search Optimization (`integaglpi_v9_kb_enrichment_and_search_optimization_001`)

PHASE: `integaglpi_v9_kb_enrichment_and_search_optimization_001` — Updated: 2026-06-10

| Flag | Default seguro | Domínio | Efeito | Gate mínimo |
| --- | --- | --- | --- | --- |
| `KB_ENRICHMENT_ENABLED` | `false` | Enriquecimento de KB (draft) | `false`: draft determinístico sem Ollama (needs_review). `true`: IA local complementa campos (ready_for_human_review). NUNCA publica; original sempre preservado. | Cursor review + revisão humana obrigatória |
| `CUSTOM_RESPONSE_ENABLED` | `false` | Resposta customizada ao técnico | `false`: customResponse=null. `true`: orientação contextual COMPLEMENTAR ao KB original; gate de confiança < 0.60 nunca chama Ollama. | Cursor review + smoke HML |
| `KB_GAP_ANALYSIS_ENABLED` | `false` | Análise de lacunas de KB | `false`: lista vazia. `true`: agrega rag_audit (KB_INSUFFICIENT) por plan_summary, threshold >= 3 ocorrências; gera draft_gap_candidate com revisão humana. | Cursor review |
| `KB_SEARCH_INCLUDE_NEEDS_REVIEW_HML_ONLY` | `false` | Busca operacional KB (Postgres) | `false`: apenas approved+candidate. `true`: em HML/test/homologation inclui needs_review na preview; **produção nunca inclui** mesmo se flag ligada. | Cursor review + smoke real HML (`scripts/kbOperationalSearchSmokeReal.ts`) |
| `CLOUD_POST_PROCESSING_ENABLED` | `false` | Pós-processamento cloud | `false`: resposta cloud sanitizada exibida como veio. `true`: polimento via Ollama local com circuit breaker de 8s (timeout → resposta original, nunca 500). | Cursor review + consentimento cloud já existente |

### V9 — UI rendering + ranking wiring (integaglpi_v9_kb_ui_rendering_and_ranking_wiring_001)

Atualizado: 2026-06-11. Sem flag nova nesta fase além da tipagem de `FEEDBACK_RANKING_ENABLED`/`RERANKER_ENABLED` (acima, seção KB Quality):

- UI: `ticket_ai_panel.js` renderiza `customResponse` ("Sugestão IA contextualizada" + badge "Revise antes de aplicar" + kb_sources sempre visíveis), `problemProfiles` (seção por problema), `kbCoverage` (badges KB_FOUND/KB_INSUFFICIENT) e `ragPerProblem`. `kb_smart_help_widget.php` renderiza `customResponse` no fluxo KB RAG.
- `CUSTOM_RESPONSE_ENABLED=false` → backend envia `customResponse=null` → bloco ausente; demais seções são aditivas e read-only (comportamento legado preservado).
- Nada é enviado ao cliente; KB original/KBs usadas permanecem sempre visíveis; comandos são texto consultivo.

Regras (ABSOLUTAS): nenhuma flag publica KB; original nunca é substituído/apagado;
persistência de draft enriquecido BLOQUEADA até migration aditiva autorizada
(BLOCK_SCHEMA_REQUIRED — ver KbEnrichmentService::persistDraft()).

> **R2 — Flags V9 tipadas (2026-06-10, `integaglpi_v9_closure_ressalvas_cleanup_001`):**
> `CENTRAL_HUB_ENABLED`, `ALARM_CORRELATION_ENABLED`, `CONTROLLED_AUTOMATION_ENABLED`
> e `INVENTORY_RECONCILIATION_ENABLED` agora são declaradas no schema tipado de
> `integration-service/src/config/env.ts` (zod, default `false`). Os serviços leem
> `env.<FLAG>` — não mais `process.env` cru. Defaults e gates abaixo permanecem válidos.

## V9 — Central Hub Operacional (`integaglpi_v9_central_hub_001`)

PHASE: `integaglpi_v9_central_hub_001` — Updated: 2026-06-09

| Flag | Default seguro | Domínio | Efeito | Gate mínimo |
| --- | --- | --- | --- | --- |
| `CENTRAL_HUB_ENABLED` | `false` | Hub Operacional UI | `false`: página acessível via URL direta mas exibe badge "feature desabilitada"; snap-shot Node ainda é calculado (cards read-only). `true`: página visível normalmente no menu Supervisão. | Smoke local em TESTE (curl GET /internal/glpi/central-hub) + Cursor review |

Regras (ABSOLUTAS — F3 contract):
- `CENTRAL_HUB_ENABLED=false` é o default em todos os ambientes; nunca alterar sem gate humano.
- Hub read-only: nenhum INSERT / UPDATE / DELETE / ALTER executado em nenhum card.
- Nenhum ticket é criado pelo Hub; `create_ticket: false` é invariante literal no código.
- Nenhum WhatsApp é enviado; `whatsAppSent: false` propagado de F2B.
- Nenhum acesso ao MariaDB (GLPI) via Node; apenas PostgreSQL e Redis do integration-service.
- Sem schema change; sem tabela nova; sem migration.
- PII Guard ativo: nenhum telefone, IP, MAC, token, credencial ou prompt bruto no payload.
- Timeout por card: 3000ms — falha de card nunca derruba o Hub inteiro.
- Cache Redis do snapshot: TTL 60s; falha de cache é silenciosa (fallback para chamada direta).
- Sem Fase 4 de correlação avançada; sem incidente mestre; sem deduplicação cross-card.
- Sem bibliotecas JS/CSS externas novas; apenas Tabler Icons (já presente no GLPI).
- Produção: alteração exige gate humano + smoke em HOMOLOGAÇÃO + aprovação Cursor.

---

## V9 F4 — Alarm Correlation (integaglpi_v9_alarm_correlation_001)

| Flag | Default seguro | Domínio | Comportamento | Gate mínimo |
| --- | --- | --- | --- | --- |
| `ALARM_CORRELATION_ENABLED` | `false` | Correlação de alarmes | `false`: endpoint /correlation retorna feature_flag_enabled=false; service continua calculando agregados (read-only). `true`: habilitado para uso. | Smoke local em TESTE + Cursor review |

Regras (ABSOLUTAS — F4 contract):
- `ALARM_CORRELATION_ENABLED=false` é o default; nunca alterar sem gate humano.
- Correlação read-only: nenhum INSERT / UPDATE / DELETE executado.
- Nenhum ticket criado; `create_ticket: false` invariante literal.
- `real_execution_forbidden: true` em toda resposta.
- Sem LLM na rota crítica; severidade e reason são determinísticos.
- Agrupamento apenas por alarm_type + janela temporal; sem correlação cross-entidade avançada.
- Nenhum PII exposto: alarm_type é string enum-like; hostnames sanitizados pelo ingest.
- Limite de window: 1..10080 minutos; limite de grupos: 1..100.
- Produção: alteração exige gate humano + smoke em HOMOLOGAÇÃO + aprovação Cursor.

---

## V9 F5 — Controlled Automation (integaglpi_v9_controlled_automation_001)

| Flag | Default seguro | Domínio | Comportamento | Gate mínimo |
| --- | --- | --- | --- | --- |
| `CONTROLLED_AUTOMATION_ENABLED` | `false` | Automação controlada (advisory) | `false`: todos os requests retornam status=feature_disabled sem processamento. `true`: advisory e preview habilitados; execução real permanece bloqueada em código. | Smoke local em TESTE + Cursor review |

Regras (ABSOLUTAS — F5 contract — hardcoded, não configuráveis):
- `CONTROLLED_AUTOMATION_ENABLED=false` é o default; nunca alterar sem gate humano.
- `real_execution_forbidden: true` — SEMPRE, independente de flag ou configuração.
- `human_review_checkbox_required: true` — camada PHP deve exigir checkbox antes de qualquer ação.
- `create_ticket: false` — invariante literal; nunca muda.
- `whatsAppSent: false` — invariante literal; nunca muda.
- `stateModified: false` — invariante literal; nunca muda.
- `no_llm_executor: true` — nenhum LLM executa ação; advisory é determinístico.
- Ações bloqueadas em código (não em config): restart_logmein_agent, create_maintenance_ticket, send_whatsapp_alert.
- Audit event registrado em toda advisory request (fire-and-forget, não bloqueia resposta).
- Nenhum PII exposto nas respostas; metadata de signals é sanitizado.
- Produção: alteração exige gate humano + smoke em HOMOLOGAÇÃO + aprovação Cursor.

---

## V9 F6 — Inventory Reconciliation (integaglpi_v9_inventory_reconciliation_001)

PHASE: `integaglpi_v9_inventory_reconciliation_001` — Updated: 2026-06-09

| Flag | Default seguro | Domínio | Comportamento | Gate mínimo |
| --- | --- | --- | --- | --- |
| `INVENTORY_RECONCILIATION_ENABLED` | `false` | Conciliação de inventário LogMeIn ↔ GLPI | `false`: endpoints de relatório acessíveis, feature_flag_enabled=false no payload. `true`: habilitado para uso do painel. | Smoke local em TESTE + Cursor review |

Regras (ABSOLUTAS — F6 contract):
- `INVENTORY_RECONCILIATION_ENABLED=false` é o default; nunca alterar sem gate humano.
- **Read-only absoluto**: nenhum INSERT / UPDATE / DELETE / ALTER executado pelos endpoints de conciliação.
- `real_mutation_forbidden: true` — invariante literal em todos os responses.
- `create_ticket: false` — invariante literal; nunca muda.
- `whatsAppSent: false` — invariante literal; nunca muda.
- `stateModified: false` — invariante literal em preview; nenhum estado é modificado.
- `preview_only: true` — endpoint de preview é somente para visualização; não executa correção.
- **Sem LLM como fonte de verdade**: scoring de matching é 100% determinístico (constantes fixas).
- **Sem acesso ao MariaDB GLPI via Node**: matching usa apenas PostgreSQL (`logmein_asset_cache`, `logmein_group_maps`).
- Scoring fixo (não configurável em runtime): equipment_tag_exact=0.90, hostname+entity=0.70, hostname_only=0.40, group+entity=0.30, no_match=0.00.
- Ambiguidade: múltiplos candidatos para mesma entidade com diff < 0.20 → status=ambiguous.
- Nenhum PII exposto: sem MAC, IP, username, token, credencial, prompt bruto.
- Aprovação humana obrigatória antes de qualquer correção manual de mapeamento.
- Produção: alteração exige gate humano + smoke em HOMOLOGAÇÃO + aprovação Cursor.

---

## V9 F7 — Vector Search Gate (integaglpi_v9_vector_search_gate_001)

PHASE: `integaglpi_v9_vector_search_gate_001` — Updated: 2026-06-09
Decision: **KEEP_CURRENT_SEARCH** (documentação de decisão arquitetural — não é feature flag operacional)

| Controle | Status | Regra absoluta |
| --- | --- | --- |
| pgvector | **BLOQUEADO** | Não instalar, não migrar, não habilitar. |
| qdrant / qualquer vector DB | **BLOQUEADO** | Não instalar, não integrar. |
| Cloud embeddings (OpenAI, Cohere, etc.) | **BLOQUEADO** | Sem DPO + direção + admin + incidentAck = BLOQUEADO. |
| FTS + Search Planner + KB Ranking + KB Reranker | **ATUAL ATIVO** | Stack atual — preservado e suficiente para baseline atual. |

Baseline atual (docs/eval_reports/baseline.json — NÃO AUTO-MODIFICAR):
- `product_detection_rate: 0.86`
- `tier_coverage_rate: 1.0`
- `total_queries: 50`

Restrições absolutas (KEEP_CURRENT_SEARCH — hardcoded):
- `no_pgvector_install: true` — proibido `CREATE EXTENSION vector` sem gate completo aprovado.
- `no_qdrant: true` — proibido container Qdrant/Weaviate ou qualquer vector DB dedicado.
- `no_cloud_embeddings: true` — sem DPO + direção + admin + incidentAck = BLOQUEADO.
- `baseline_no_auto_modify: true` — `baseline.json` NUNCA é auto-modificado.
- `documentation_decision_only: true` — este gate é documentação de decisão, não feature flag operacional.

Regras de decisão (KEEP_CURRENT_SEARCH):
- Baseline atual (product_detection=0.86, tier_coverage=1.0) **não justifica** custo e risco de pgvector/cloud embeddings.
- O ganho projetado de pgvector (estimativa 0.02–0.05 pontos) está dentro da margem de ruído para o volume atual.
- Busca vetorial exigiria DPO + migration + novo infra — gate alto sem ROI claro neste volume.
- A decisão é revisável somente via smoke HML aprovado + commit manual revisado do baseline.json.
- `baseline.json` NUNCA é auto-modificado por automação — atualização exige commit manual revisado após smoke HML.
- ADR completo: `docs/architecture/adr_004_vector_search_decision.md`
- Relatório de avaliação: `docs/eval_reports/vector_search_gate_2026-06-09.md`
