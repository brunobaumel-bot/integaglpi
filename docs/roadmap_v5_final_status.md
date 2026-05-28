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

## F5 — Backlog V6: Integrações Futuras Read-only

**Princípio:** Nenhuma integração externa pode criar, editar, deletar ou sincronizar dados automaticamente. Toda integração V6 começa com leitura, allowlist de endpoints, credencial read-only por contrato e audit trail.

### LogMeIn (Inventário de Equipamentos)
- **Modo permitido:** `inventory/list`, `asset/details`, vínculo visual com ticket/contato
- **Proibido:** `session/start`, `wol`, `deploy`, `remote/control`, qualquer ação remota
- **Pré-requisitos:** Credential vault estendido (`AiSecretVaultService`); smoke com dados sintéticos; PII assessment se dados de equipamento incluírem owner

### Zabbix (Alertas e Hosts)
- **Modo permitido:** `problem.get`, `host.get`, `alert.get` (read); correlação visual com ticket
- **Proibido:** `acknowledge`, `event.acknowledge`, criação automática de incidente/ticket
- **Pré-requisitos:** Ambiente Zabbix em TESTE com dados sintéticos; token API read-only por usuário dedicado

### ERP (Cliente / Contrato / Status Comercial)
- **Modo permitido:** Consulta de contrato ativo, status comercial, horas consumidas
- **Proibido:** write/update, faturamento, cobrança, qualquer mutação cadastral
- **Pré-requisitos obrigatórios:** PII assessment jurídico (dados de cliente são sensíveis); token read-only garantido por contrato com fornecedor ERP; masking de CPF/CNPJ/e-mail antes de qualquer log

### n8n / Automações Futuras
- **Modo neste ciclo:** Discovery e mapeamento conceitual apenas
- **Proibido:** webhook público novo, workflow ativo, execução automática, integração de dados reais
- **Pré-requisitos:** Definição de scope funcional; Bearer em qualquer endpoint de entrada; revisão de segurança de webhook

### Omnichannel (Telegram, E-mail, Voz)
- **Modo neste ciclo:** Mapeamento de canais futuros apenas
- **Proibido:** Novo canal ativo sem gate de licenciamento (Meta Business Manager, provedor de voz)
- **Pré-requisitos:** Análise de licenciamento; nova migration de roteamento; testes de isolamento de canal

### Arquitetura Reutilizável para V6
Os seguintes módulos são extensíveis sem refatoração:
- `sourceValidator.ts` + `candidateBuilder.ts` (padrão de allowlist por URL)
- `AiSecretVaultService.php` (vault de credenciais, extensível com novo `ALLOWED_PROVIDERS`)
- `createInternalBearerMiddleware` (proteção de rotas internas)
- `AuditService.recordAuditEventFireAndForget` (audit trail)
- `ObservabilityService.queryCards()` / `eventUnionSql()` (extensível com novo `event_type`)
- Rate limit Redis (padrão `AiOnlineSupervisorAlertService`: `incr`, `expire`, `cooldownMinutes`)

---

## Gates Obrigatórios para Início de V6

Antes de qualquer implementação V6:

- [ ] Smoke V5 completo em TESTE (S-F1-01 a S-F5-04) executado e registrado
- [ ] Commits F2 (`c745a54`, `1a281d4`) promovidos para `origin/main` via push manual
- [ ] Versão de produção alinhada com HEAD local
- [ ] PII assessment F5-ERP aprovado juridicamente
- [ ] Credenciais V6 (LogMeIn, Zabbix, ERP) geradas como read-only por contrato com fornecedor
- [ ] Novo fase-ID criado: `integaglpi_future_integrations_logmein_readonly_001` (ou equivalente)
- [ ] `CLAUDE.md` e este documento revisados para incluir novos arquivos congelados de V6

---

**Roadmap V5 — Fechado em 2026-05-28**
