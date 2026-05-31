# Roadmap V5 — Status Final

**Projeto:** IntegraGLPI — GLPI 11 + WhatsApp Cloud API + IA Local  
**Ciclo:** V5  
**Fechamento:** 2026-05-28  
**Suíte Node:** 695/695 testes PASS · 89 arquivos  
**TypeScript:** CLEAN (`npx tsc --noEmit`)  
**PHP lint:** CLEAN (todos `.php`)

---

## Status das Fases F0–F5

| Fase | Phase ID | Verdict | Commit principal | Ressalvas aceitas |
|------|----------|---------|------------------|-------------------|
| **F0** | `integaglpi_gold_readiness_audit_001` | CLOSE_COM_RESSALVAS | `a784d93` (HEAD no momento da auditoria) | `composer test` sem vendor; smokes manuais T06–T09 pendentes execução humana |
| **F1** | `integaglpi_ops_console_entity_identity_gold_001` | CLOSE_COM_RESSALVAS | `a784d93` `fix(integaglpi): close F1 entity selection and memory package` | Sub-pacote entidade fechado; escopo Ops Console / Identity formal não reiniciado neste ciclo |
| **F2** | `integaglpi_whatsapp_professional_messaging_gold_001` | CLOSE_COM_RESSALVAS | `c745a54` `fix(whatsapp): enforce 24h manual message guard` · `1a281d4` `fix(whatsapp): keep reopened ticket conversations linked` | Smoke de continuidade de chamado reaberto depende de runtime manual em TESTE |
| **F3** | `integaglpi_active_monitoring_sla_quality_gold_001` | CLOSE_COM_RESSALVAS | Commits `checkpoint-ai-online-monitor-*` e anteriores | Quality Dashboard, Observability, SLA, Integrity Audit, Inatividade, Backoffice todos implementados e testados; smokes manuais confirmados |
| **F4** | `integaglpi_ai_knowledge_console_feedback_gold_001` | CLOSE_COM_RESSALVAS | Tags `checkpoint-ai-runtime-config-aligned`, `checkpoint-ai-online-supervisor-alerts` | IA Supervisora + Copiloto + KB + Feedback + Vault + AI Pilot gates todos operacionais; cloud off por default; smokes S-F4-01 a S-F4-12 confirmados |
| **F5** | `integaglpi_future_integrations_readonly_gold_001` | BACKLOG_V6 | — | LogMeIn/Zabbix/ERP/n8n/Omnichannel diferidos para V6; smokes estáticos S-F5-01 a S-F5-04 confirmados (ausência de integrações prematuras) |
| **Final** | `integaglpi_docs_contract_sync_001` | EXECUTADO | — (docs only) | Este documento |

---

## Itens Implementados e Congelados — Não Refazer

### Infraestrutura e Segurança
- Webhook Guard (`phone_number_id` allowlist + HMAC-SHA256) — `createMetaWebhookPostController.ts`
- `/health` sanitizado (apenas booleans de presença, sem valor real de secret)
- Todos os `/internal/glpi/*` protegidos por `createInternalBearerMiddleware`
- `.gitignore` protege `.env`, artefatos Claude locais
- `AiSecretVaultService.php` (AES-256-GCM, providers: openai/anthropic/gemini/deepseek/xai)

### F1 — Entidade / Memória
- Seletor dropdown controlado `glpi_entity_id` (sem `glpi_entity_name` no payload)
- Botão "Aplicar entidade memorizada" (`js-integaglpi-apply-memory-entity`)
- `resolveEntitySourceLabel()` deriva origem sem nova query SQL
- `CentralEntitySelectionStaticTest.php` (25 assertions)
- 3 novos testes Node de memória de entidade

### F2 — WhatsApp Profissional
- Guard 24h para texto livre manual (`MessageConfigurationService`)
- Template controlado por event_key
- Bugfix: chamado reaberto/vinculado mantém `conversation_id` e continuidade
- Delivery/read status preservados
- Idempotency key em todos os envios

### F3 — Monitoramento, SLA e Qualidade
- `QualityDashboardService.ts` (Node): KPIs, delivery, inactivity, CSAT, AI flags, contracts, SLA, PII masked, cache Redis 600s
- `ObservabilityService.ts` (Node): audit events, delivery cards, dead letter, GLPI health cache 5min, query timeout 3s
- `OperationalSlaService.ts`: biblioteca SLA completa (deadline, consumedPercent, not_configured/normal/attention/critical/breached)
- `OperationalIntegrityAuditService.ts`: orphan messages, media_info_missing, invalid states, stale queues
- `InactivityAutomationService.ts`: job reminders 1/2/3 + autoclose + preticket
- PHP: `quality.dashboard.php`, `observability.php`, `supervisor.php`, `audit.php`, `operation.log.php`
- 13 arquivos de teste Node cobrindo F3

### F4 — IA, KB, Console e Feedback
- `AiSupervisorService.ts`: dry-run, provider=disabled/ollama, runtime DB loader, sem mutation, sanitização
- `CopilotDraftService.ts`: `no_auto_send: true`, dry-run, context limits (8 msgs/360 chars, 6000 total)
- `AiOnlineSupervisorAlertService.ts`: 7 tipos de alerta interno read-only, rate limit Redis, worker loop
- `AiPilotService.ts`: 6 gates cloud (todos false/disabled por default), `anonymizeAiPilotPayload()`
- `KnowledgeBaseService.php`: draft/active/archived com gate humano para publicação
- `KbCandidateService.php`: in_review/approved/rejected — sem auto-publicação em `glpi_knowbaseitems`
- `NativeKnowledgeBaseService.php`: busca read-only na KB GLPI nativa
- `createAiQualityFeedbackController.ts`: allowlist `useful/not_useful/incorrect`, notes ≤500 chars
- `RiskScoringService.ts` + `CoachingService.ts`: anti-ranking, anti-punitivo
- `sanitizeAiQualityText()`: remove SECRET_KEY_PATTERN, maskPhone, maskEmail
- PHP: `ai.config.php`, `ai.quality.php`, `copilot.draft.php`, `kb.php`, `kb.candidates.php`, `coaching.php`, `risk.feedback.php`, `ai.pilot.php`, `online.monitor.php`
- 30 arquivos de teste Node cobrindo F4

---

## Métricas de Qualidade no Fechamento

| Métrica | Valor |
|---------|-------|
| Suíte Node (`npx vitest run`) | **695/695 PASS** · 89 arquivos · ~4.4s |
| TypeScript (`npx tsc --noEmit`) | **CLEAN** |
| PHP lint (`php -l`) | **CLEAN** (todos os `.php`) |
| `composer test` (PHPUnit) | **RESSALVA_AMBIENTAL** — vendor ausente no ambiente CI; 25/25 assertions PHP verificadas via `php -r` |
| `git diff --check` | **CLEAN** |
| `git status --short` | **CLEAN** |
| Commits de F2 à frente de `origin/main` | 2 commits (`c745a54`, `1a281d4`) — locais, commit manual pendente |

---

## Feature Flags — Estado Seguro Confirmado

| Flag | Default em `env.ts` | Estado no fechamento |
|------|---------------------|----------------------|
| `OUTBOUND_SEND_MODE` | `mock` | SEGURO |
| `AI_SUPERVISOR_ENABLED` | `false` | SEGURO |
| `AI_SUPERVISOR_DRY_RUN` | `true` | SEGURO |
| `AI_SUPERVISOR_PROVIDER` | `disabled` | SEGURO |
| `AI_PILOT_CLOUD_ENABLED` | `false` | SEGURO |
| `AI_PILOT_HARD_BUDGET_BLOCK` | `true` | SEGURO |
| `AI_PILOT_DPO_APPROVED` | `false` | SEGURO |
| `AI_PILOT_DIRECTOR_APPROVED` | `false` | SEGURO |
| `AI_PILOT_ADMIN_OPT_IN` | `false` | SEGURO |
| `AI_PILOT_TEST_ENVIRONMENT_ONLY` | `true` | SEGURO |
| `EXTERNAL_RESEARCH_CLOUD_ENABLED` | `false` | SEGURO |

---

## Roadmap V6 Lean — SSOT Oficial Pós-Estabilização

**Verdict final:** `ROADMAP_V6_LEAN_APROVADO_COM_RESSALVAS`

**Status:** backlog pós-estabilização, não bloqueia o go-live atual.

**Gate de produção atual:** o FIX3 de estabilização operacional continua bloqueando produção até smoke aprovado.

**Estrutura oficial:** V6 fica consolidado em 3 pacotes evolutivos: `V6-E1`, `V6-E2`, `V6-E3`. Não criar `V6-E1a`/`V6-E1b` como fases oficiais.

### Requisito Transversal Obrigatório — PII Guard

PII Guard é requisito transversal obrigatório do V6 e não deve virar pacote separado.

- Primeiro item de segurança pós-FIX3.
- Mascaramento deve ocorrer no backend.
- Payloads devem ser sanitizados sem telefone/e-mail bruto antes do claim.
- Frontend não é barreira de segurança.
- Revelação de PII exige sessão válida, RBAC e ação de assumir ou permissão superior.
- Auditoria obrigatória, sugerida como `SECURITY_PII_UNMASKED_VIEW`.

### V6-E1 — Console Operacional Unificado, Configurações, UX e Telemetria Leve

**Entra:**

- Hub unificado de configurações de mensagens.
- CSAT.
- Horário comercial.
- Inatividade.
- Templates rápidos com `/`.
- Ghost Click Guard.
- PII Guard nas telas operacionais.
- RBAC backend.
- Telemetria read-only de GLPI, Node, Postgres, Redis, Meta, workers e filas.
- Matriz urgência x impacto.
- Taxonomia Incidente vs Requisição.
- Checklist de qualidade antes de solucionar.
- Handoff/passagem de turno interno.
- Alerta visual de sentimento/risco, sem reordenação automática.
- SLA conversacional leve somente com paginação, índices, janela temporal e cache.

**Não entra:**

- Preview complexo simulando Meta.
- Dashboards executivos pesados.
- Ranking nominal/punitivo.
- Reordenação automática de fila por IA.
- Mutação automática de ticket.
- Full scan em `audit_events`.
- SLA avançado sem cache/índice.

**Ordem interna obrigatória:**

1. Configurações e segurança.
2. PII Guard, Ghost Click, RBAC e taxonomia.
3. Telemetria read-only leve.
4. SLA conversacional somente se cache/índices estiverem seguros.

### V6-E2 — Copiloto Assistivo com Fonte, Feedback e Circuit Breaker Ollama

**Entra:**

- Copiloto assistivo.
- Fonte explícita da sugestão.
- Feedback do técnico.
- Auditoria estruturada.
- Health check Ollama.
- Circuit breaker Ollama obrigatório.
- Timeout estrito.
- Cooldown.
- Fallback honesto.
- Painel simples de feedback agregado.
- Candidatos de KB sem publicação automática.

**Não entra:**

- IA agentic.
- Autoenvio de WhatsApp.
- Escrita automática em KB.
- RAG complexo do zero.
- Cloud AI ativada por padrão.
- Mutação automática de ticket, fila, entidade, contrato, status ou prioridade.
- Problem Management/RCA automatizado.

### V6-E3 — Governança, Release, LogMeIn Read-only e Controles COBIT

**Entra:**

- LogMeIn estritamente read-only.
- Dependência de etiqueta/patrimônio.
- Vínculo manual por tag/ativo.
- Sync assíncrona em tabela isolada.
- Adapter/Proxy com timeout isolado.
- UI não pode quebrar se LogMeIn cair.
- Auditoria de visualização de dados sensíveis.
- Playbook de crise.
- Runbooks de resiliência.
- Release notes.
- Revisão mensal de permissões.
- Owner por processo.
- Matriz RACI simples.
- Evidência de backup/rollback.
- Revisão de logs de acesso negado.
- Change Enablement mínimo.

**Não entra:**

- Execução remota.
- Scripts em endpoint de cliente.
- RMM ativo.
- Omnichannel com escrita direta.
- WhatsApp disparado por Zabbix/n8n sem validação humana.
- Integrações futuras como implementação ativa.

### Ideias Classificadas

**Implementar agora, dentro da ordem V6 aprovada:**

- PII Guard backend.
- Ghost Click Guard.
- Templates rápidos com `/`.
- Playbook de crise.
- Runbooks de resiliência.
- Matriz urgência x impacto.
- Checklist de qualidade.
- Handoff interno.
- Taxonomia Incidente vs Requisição.

**Escopo limitado:**

- Sentimento em tempo real somente como alerta visual.
- SLA conversacional somente com cache, paginação e índices.

**Diferido para V7:**

- Problem Management/RCA com IA.
- Major Incident formal.
- Known Error.
- Mineração histórica massiva.
- RAG complexo.

**Rejeitado/cancelado:**

- Gamificação punitiva.
- Ranking nominal.
- Agentic AI.
- Alteração automática de ticket por IA.
- Autoenvio WhatsApp por IA.

### Arquitetura Reutilizável para V6

Os seguintes módulos continuam extensíveis sem refatoração ampla:

- `sourceValidator.ts` + `candidateBuilder.ts` (padrão de allowlist por URL).
- `AiSecretVaultService.php` (vault de credenciais).
- `createInternalBearerMiddleware` (proteção de rotas internas).
- `AuditService.recordAuditEventFireAndForget` (audit trail).
- `ObservabilityService.queryCards()` / `eventUnionSql()` (extensível com novo `event_type`).
- Rate limit Redis (padrão `AiOnlineSupervisorAlertService`: `incr`, `expire`, `cooldownMinutes`).

---

## Gates Obrigatórios

### Antes de produção

- [ ] FIX3 de estabilização operacional aprovado em smoke manual.
- [ ] Nenhum deploy/promoção sem gate humano.
- [ ] Produção alinhada apenas por procedimento manual.

### Antes de qualquer implementação V6

- [ ] V6 tratado como backlog pós-estabilização, sem bloquear o go-live atual.
- [ ] Smoke V5/FIX3 completo em TESTE executado e registrado.
- [ ] PII Guard priorizado como primeiro item de segurança pós-FIX3.
- [ ] Credenciais futuras geradas como read-only por contrato com fornecedor, quando aplicável.
- [ ] LogMeIn mantido estritamente read-only.
- [ ] Circuit breaker Ollama planejado como obrigatório em V6-E2.
- [ ] Nenhuma integração V6 inicia com escrita, automação ativa ou execução remota.

---

**Roadmap V5 — Fechado em 2026-05-28**
