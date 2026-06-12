# Prompt Contract — Engineering Workflow

**Version:** 3.1
**Last Updated:** 2026-06-12
**Project:** IntegraGLPI — GLPI 11 + WhatsApp Cloud API + IA Local  
**Roadmap:** **V10** — `docs/roadmap_v10.md` (sucessor do V9 `DONE_COM_RESSALVAS`; SSOT congelado após commit A3 do M0)
**Status:** Official

---

## Roadmap V10 — Objetivo e SSOT

**Objetivo final declarado:** IA autônoma atendendo e resolvendo chamados, por escalada
controlada N1→N6 (ver `docs/roadmap_v10.md` § 0–2).

| Macro | Nível IA | Gate de entrada |
| --- | --- | --- |
| M0 | — | Fechamento V9 (pré-requisito absoluto) |
| M1 | N1 pleno | M0 `DONE_COM_RESSALVAS` + GO manual explícito do operador |
| M2 | N2 | M1 |
| M3 | — (fundação) | M1 (paralelo com M2) |
| M4 | N3 | M2 + M3 + D2 KBs approved |
| M5 | N4 Shadow | Gates N3→N4 |
| M6 | N5 (objetivo) | Gates N4→N5 **por categoria** |
| M7 | N6 (horizonte) | N5 estável 90d |

**Invariantes permanentes I1–I12:** `docs/roadmap_v10.md` § 0 — nunca violar em fase.

**Flags V10:** `docs/feature_flags_matrix.md` § V10 — default `false`; nascem em código
somente na fase que as implementa.

**Baseline KPIs V10:** `docs/baseline_v10_kpis.json` — congelado no M0-E3 com valores conhecidos e nulos auditáveis para KPIs ainda não medidos.

---

## Purpose
Este documento define o padrão oficial de prompts, handoffs, revisões e governança de segurança para todo o ciclo de engenharia assistida por IA do IntegraGLPI.

## Identidade do Projeto

| Pasta | Stack | Responsabilidade |
|---|---|---|
| `integaglpi/` | PHP 8.3 | Plugin GLPI — UI, Central, hooks, config, KB, coaching |
| `integration-service/` | TypeScript/Node.js | Webhooks Meta, FSM, IA local, outbound, jobs, quality |
| `infra/` | Docker + PostgreSQL | Bootstrap, schema, migrations |

## Roadmap V5 — Estado Final (2026-05-28) — histórico

| Fase | ID | Status | Ressalvas aceitas |
|------|----|--------|-------------------|
| F0 | `integaglpi_gold_readiness_audit_001` | CLOSE_COM_RESSALVAS | composer test sem vendor; smokes manuais T06–T09 pendentes execução humana |
| F1 | `integaglpi_ops_console_entity_identity_gold_001` | CLOSE_COM_RESSALVAS | Sub-pacote entidade fechado; smoke contato novo OK |
| F2 | `integaglpi_whatsapp_professional_messaging_gold_001` | CLOSE_COM_RESSALVAS | Guard 24h, template controlado, bugfix continuidade chamado reaberto; smoke OK |
| F3 | `integaglpi_active_monitoring_sla_quality_gold_001` | CLOSE_COM_RESSALVAS | Quality Dashboard, Observability, SLA, Inatividade, Integrity Audit; smoke OK |
| F4 | `integaglpi_ai_knowledge_console_feedback_gold_001` | CLOSE_COM_RESSALVAS | IA Supervisora, Copiloto, KB candidatos, Feedback Humano, Vault, AI Pilot gates; smoke OK |
| F5 | `integaglpi_future_integrations_readonly_gold_001` | BACKLOG_V6 | LogMeIn/Zabbix/ERP/n8n/Omnichannel diferidos; smokes estáticos S-F5-01/02/03 confirmados |
| Final | `integaglpi_docs_contract_sync_001` | EXECUTADO | Este documento |

## Roadmap V9 — Fechamento (2026-06-12)

Status: **`DONE_COM_RESSALVAS`** após M0 documental — ver checklist S1–S7 em `docs/roadmap_v9_hml_smoke_checklist.md` e evidência `docs/eval_reports/kb_operational_search_smoke_real_2026-06-12.yaml`.

## Roadmap V10 — Ativo (2026-06-12)

SSOT: **`docs/roadmap_v10.md`**. Nenhuma fase V10 (M1+) inicia antes de **GO manual explícito do operador** após M0 `DONE_COM_RESSALVAS`.

## Single Source of Truth
Este arquivo é a **fonte oficial e mais atualizada**.  
As instruções salvas no ChatGPT (globais e por projeto) são cópias cacheadas e devem ser sincronizadas sempre que este arquivo for alterado.

## Required Prompt Structure
Todo prompt deve seguir este formato:
ROLE:
TASK:
PHASE_ID:
TARGET_MATURITY_LEVEL:   # N1–N6 ou — (infra/M0)
MISSION:
CURRENT_STATE:
SCOPE:
ALLOWLIST:
FORBIDDEN:
SAFETY_FLAGS:
PROMOTION_GATE_VALIDATION:   # métricas que autorizam autonomia (V10)
INPUTS:
REQUIRED_ACTION:
OUTPUT_SCHEMA:
TESTS:
ACCEPTANCE_CRITERIA:
STOP_CONDITIONS:
RETURN_FORMAT:
text## Core Principles
- **Contrato > prosa**
- **Checklist > opinião**
- **Reutilize módulos existentes** > criar novos arquivos
- **Mudança mínima possível**
- Gates humanos obrigatórios em todas as etapas

## Safety Flags (Default — Nunca Alterar)

```
safe_to_execute_project=False
safe_to_promote=False
dispatch_prohibited=True
promotion_manual_only=True
human_gate_required=True
human_review_required=True
manual_handoff_only=True
manual_commit_only=True
manual_deploy_only=True
auto_apply_allowed=False
auto_commit_allowed=False
auto_deploy_allowed=False
production_untouched=True
no_db_mutation_real=True
no_ticket_mutation_real=True
no_whatsapp_send_real=True
no_env_changes=True
no_raw_prompt=True
pii_masking_required=True
no_autonomous_mutation=True
cloud_requires_gate=True
no_phase_duplication=True
```

## Workflow
1. ChatGPT gera prompt para IAs revisoras (Grok / Gemini / DeepSeek)
2. Revisoras analisam e retornam veredito estruturado
3. ChatGPT consolida e gera prompt para Codex / Claude
4. Codex / Claude implementam **somente** dentro da allowlist
5. Cursor audita o diff real e retorna `CLOSE` / `CLOSE_COM_RESSALVAS` / `FIX` / `BLOCK`
6. Commit, deploy e promoção são **sempre manuais**

## No Subphases Unless
Só é permitido criar subfases ou microfases quando houver:
- BLOCK do Cursor
- Falha de teste crítica
- Arquivo proibido alterado
- Workspace contaminado
- Quebra de safety flag
- Risco real de execução indevida
- Contrato da fase descumprido

## Read-Only for Implementers
Este arquivo é **read-only** para Codex, Claude e Cursor.  
Qualquer alteração deve ser realizada exclusivamente via fase documental aprovada.

## Forbidden by Default
É estritamente proibido:
- `git add .` ou `git add -A`
- Commit, push ou deploy automático
- Alteração de `.env`, banco de dados real ou `.runtime` (salvo fase explícita)
- Chamada automática de providers / APIs / LLMs
- Execução de subprocess sem allowlist explícita
- Aplicação de correções em sandbox fora de fase específica
- Criação de novos arquivos sem autorização explícita na allowlist
- Alteração de arquivos fora da allowlist

## Stop Conditions — IntegraGLPI (Abortar imediatamente se)

As condições abaixo disparam BLOCK imediato em qualquer fase:

| Condição | Risco |
|----------|-------|
| IA enviar mensagem WhatsApp ao cliente | Alto — envio não autorizado |
| IA alterar, fechar ou reabrir ticket GLPI | Alto — mutação não auditada |
| IA mudar entidade de conversa sem gate humano | Alto — dado de classificação corrompido |
| Cloud/LLM externo ativado sem gate DPO + direção + admin | Crítico |
| Texto livre enviado fora da janela de 24h Meta | Alto — violação de política |
| Integração externa com ação mutável (LogMeIn, Zabbix, ERP) | Crítico |
| Deploy automático em produção | Crítico |
| `git add .` ou `git add -A` | Alto — arquivos sensíveis podem ser commitados |
| Prompt bruto com PII em logs ou audit | Alto |
| Token / secret / senha exposto em UI, log ou payload | Crítico |
| Migration destrutiva (DROP/TRUNCATE/DELETE amplo) sem gate | Crítico |
| Workspace sujo sem autorização | Médio |
| Reabrir fase já fechada (F0–F5) | Médio — duplicação de trabalho |

## Produção — Gates Obrigatórios

Qualquer ação em produção exige todos os itens abaixo:

1. `git status --short` limpo
2. `npx tsc --noEmit` CLEAN
3. `npx vitest run` 100% PASS
4. `php -l` CLEAN em todos os arquivos alterados
5. Cursor review aprovado (`CLOSE` ou `CLOSE_COM_RESSALVAS`)
6. Commit manual assinado pelo operador
7. Deploy manual com janela de manutenção aprovada
8. Smoke pós-deploy confirmado manualmente
9. Rollback plan documentado e testado

## IA — Governança Operacional

| Módulo | Modo permitido | Modo proibido |
|--------|----------------|---------------|
| IA Supervisora | Sugestão read-only, dry-run, provider=ollama | Alterar ticket, enviar WA, cloud sem gate |
| Copiloto | Rascunho para técnico revisar, dry-run | Auto-envio, cloud sem gate |
| AI Online Alerts | Alertas internos read-only | Enviar WA, mutar ticket, cloud |
| AI Pilot (P4) | Gates: DPO + direção + admin + incidentAck | Cloud sem todos os gates |
| KB Candidatos | Revisão humana obrigatória antes de publicar | Auto-publicar em `glpi_knowbaseitems` |
| Feedback Humano | useful/not_useful/incorrect apenas | Alterar ticket, ranking punitivo |
| External Research | Preview sanitizado, allowlist de sources | Cloud sem gate, PII em prompt |

## Reviewer Contract (Grok / Gemini / DeepSeek)
- Analisam risco, escopo, segurança e alinhamento com a missão
- Retornam veredito estruturado (`VERDICT`, `BLOCKERS`, `RISKS`, `REQUIRED_ADJUSTMENTS`)
- **Não implementam código**

## Executor Contract (Codex / Claude)
- Implementam **exclusivamente** o que está definido na `SCOPE` e `ALLOWLIST`
- Priorizam reutilização de código existente
- Devem seguir o princípio de **mudança mínima**

## Auditor Contract (Cursor)
- Audita o diff real (`git diff --name-only` + `git status --short`)
- Retorna veredito com evidência (`arquivo + linha` quando possível)
- Verifica escopo real vs escopo aprovado, safety flags e testes

## F5 — Backlog V6 (Integrações Futuras Read-only)

Nenhum item abaixo deve ser implementado antes do ciclo V6 com escopo, credenciais e smoke em TESTE formalmente aprovados.

| Integração | Modo permitido no V6 | Proibido sempre |
|------------|----------------------|-----------------|
| **LogMeIn** | Inventário/equipamento read-only; vínculo visual com ticket | remote control, wake-on-LAN, `session/start`, `deploy` |
| **Zabbix** | `problem.get`, `host.get`; status de alertas relacionados a ticket | `acknowledge` automático, criação de incidente automática |
| **ERP** | Consulta de contrato/status comercial (token read-only por contrato) | write/update, faturamento, cobrança; exige PII assessment jurídico |
| **n8n** | Discovery/mapeamento de workflows futuros apenas | Webhook público novo, workflow ativo, execução automática |
| **Omnichannel** | Mapeamento de canais futuros (Telegram, e-mail, voz) | Novo canal sem gate de licenciamento Meta/provedor |

**Pré-requisitos obrigatórios para qualquer integração V6:**
- Credencial dedicada read-only por contrato com o fornecedor
- AiSecretVaultService estendido com o novo provider
- Smoke em TESTE com dados sintéticos (sem cliente real)
- PII assessment se dados de cliente/equipamento forem trafegados
- Bearer middleware em todas as rotas internas
- Rate limit via Redis (padrão `AiOnlineSupervisorAlertService`)
- Audit trail via `AuditService.recordAuditEventFireAndForget`

## Arquivos Congelados (Não Alterar sem Fase Explícita)

| Arquivo | Motivo |
|---------|--------|
| `integration-service/src/domain/services/InboundWebhookService.ts` | FSM principal — risco de regressão em produção |
| `integration-service/src/domain/services/OutboundMessageService.ts` | Envio WhatsApp — alteração pode disparar mensagens reais |
| `integration-service/src/adapters/glpi/GlpiClient.ts` | Client GLPI — alteração pode mutar tickets reais |
| `integration-service/src/config/env.ts` | Defaults críticos — AI Pilot cloud=false, OUTBOUND=mock |
| `infra/postgres/init/*.sql` | Schema base — não alterar; criar novas migrations |
| `integaglpi/inc/install.php` | Instalação GLPI — risco de reinstalação acidental |
| `.env` / `.env.*` | Segredos — nunca commitar |

## Maintenance
Qualquer evolução deste contrato deve ser feita através de fase documental aprovada (`integaglpi_docs_contract_sync_*`) e commit manual separado.

---

**End of Document — Roadmap V10 sync 2026-06-12 (V5/V9 histórico preservado acima)**
