# Roadmap V7 Status

Atualizado em: 2026-06-03

## Macro 1 - Nova Porta de Entrada WhatsApp

Status: implementado com smoke pendente/contínuo em TESTE.

Cobertura atual:
- Coleta de perfil e resumo antes de criar ticket.
- Entidade obrigatória antes de abertura do ticket.
- Conversas em `awaiting_entity_selection` visíveis na Central.
- Normalização de telefone BR com/sem nono dígito.
- Sem chamada IA/cloud/LogMeIn nesse fluxo.

## Macro 2 - Copiloto e Conhecimento Operacional

Status: implementado para revisão Cursor.

Cobertura atual:
- Smart Help local-first com KB nativa GLPI via PHP, sem Node acessar MariaDB.
- Ajuda Inteligente no ticket em fluxo guiado manual: `Resumo do chamado` -> `Busca local` -> `Pedir ajuda externa (nuvem)`.
- Resumo técnico sanitizado no painel do chamado.
- Sugestões com fonte, categoria, trecho, motivo e confiança operacional.
- Feedback "Ajudou/Não ajudou" persistido para candidato ou artigo GLPI nativo.
- Migration 044 validada por check seguro de arquivo em homologação, sem DDL runtime.
- Pesquisa externa somente por clique humano, com PII Guard e audit sanitizado.
- Mineração histórica apresentada como geração de base por chamados resolvidos.

Ressalvas:
- Aplicação da migration 044 em banco real continua manual e fora desta fase.
- Publicação na KB continua manual.
- Cloud permanece bloqueada por padrão e exige consentimento humano explícito.
- A busca externa continua condicionada à busca local e ao preview sanitizado; não há chamada automática no load da aba.

## Macro 3 - Engenharia Limpa e Contratos

Status: contrato mínimo implementado para revisão Cursor.

Inventário de duplicações priorizado:
- Catálogo de mensagens: `PluginConfigService` salva defaults/sync PHP e `SettingsService` consome fallbacks no Node.
- Entidade/runtime: `TicketRuntimeService` resolve entidade no plugin e `EntitySelectionService`/`ContactEntityResolutionService` decidem abertura no Node.
- Inatividade/horário comercial: mensagens e tempos existem em configuração PHP e serviços Node de runtime.

Contrato reforçado:
- `MessageCatalogContract.ts` define as chaves de mensagem runtime consumidas pelo Node.
- `PostgresSettingsRepository` e `SettingsService` usam a mesma lista de contrato.
- Testes travam sync PHP -> PostgreSQL -> Node, ausência de acesso MariaDB pelo Node e preservação de CSRF/RBAC nos endpoints críticos.

Ressalvas:
- Macro 3 não consolida entidade/inatividade; apenas inventaria como próximos candidatos.
- Nenhuma mudança comportamental intencional em criação de ticket, WhatsApp, IA, LogMeIn ou Central.

## Macro 4 - Performance, Escala e LGPD

Status: implementado para revisão Cursor.

Inventário de gargalos prováveis:
- Mensagens por conversa: `PostgresMessageRepository.findByConversationId` e consultas laterais do `QualityDashboardService` usam `conversation_id` + `created_at`.
- Central/qualidade: `QualityDashboardService` agrega conversas, mensagens e inatividade por janelas de tempo e paginação.
- Inatividade: `PostgresInactivityTrackingRepository.findDueCandidates` usa status/atividade; índice equivalente já existia na migration 015.
- Feedback KB: `PostgresKbFeedbackRepository` grava e agrega `kb_article_helpfulness`; faltava índice por ticket de contexto.
- Cloud/audit: migrations 044 e 005 já tinham índices de data/status/categoria/evento para auditoria sanitizada.

Migration criada:
- `045_performance_scale_lgpd_indexes.sql` adiciona índices idempotentes e condicionais.
- Não foi aplicada em produção nem homologação pelo Codex.
- Comando manual de homologação está documentado no cabeçalho da migration.
- Rollback é manual por DBA, restrito aos índices nomeados, após análise humana.

Política LGPD proposta (sem deleção automática nesta fase):
- Mensagens e anexos/metadados: manter enquanto o ticket GLPI exigir histórico operacional e jurídico; prazo final exige owner humano/DPO.
- `raw_payload`: candidato a retenção curta ou minimização após diagnóstico; exige decisão DPO antes de expurgo.
- `cloud_compliance_audit`: manter registro sanitizado/agregado por período de auditoria; nunca armazenar prompt bruto/PII.
- `kb_article_helpfulness`: manter agregado não punitivo; técnico nominal apenas para deduplicação quando necessário.
- Métricas agregadas: podem ter retenção mais longa se não contiverem PII.

Observabilidade/cache:
- Observabilidade permanece read-only via serviços existentes (`ObservabilityService`, `QualityDashboardService`) e docs.
- Nenhum dashboard pesado, SSE/WebSocket, Redis novo ou cache novo foi criado.

## Macro 5 - Enterprise Controlado

Status: implementado para revisão Cursor.

Escopo fechado:
- LogMeIn Truth Audit read-only documentado em `docs/logmein_truth_audit.md`.
- Matriz de feature flags e gates humanos documentada em `docs/feature_flags_matrix.md`.
- Runbook de release/rollback V7 documentado em `docs/release_runbook.md`.
- Readiness final V7 documentado em `docs/v7_final_readiness.md`.
- Smoke final V7 adicionado em `docs/smoke_tests.md`.

Classificação LogMeIn:
- Status real: PARCIAL.
- Host/group cache read-only existe no repo com migration 042, serviços, UI e testes.
- Conciliação de sessão remota existe com migration 043, serviços, UI e testes, mas permanece opcional e behind flag.
- Nenhuma chamada externa LogMeIn foi feita nesta fase.
- LogMeIn não pode ser dependência operacional para WhatsApp, ticket, Central ou IA.
- Controle remoto, sessão remota, scripts, deploy e endpoints de ação continuam bloqueados.

Governança enterprise:
- Feature flags críticas seguem com defaults seguros.
- Produção exige gate humano, Cursor review, smoke e deploy manual.
- Problem management permanece assistivo/read-only, sem criação automática de problem record.
- Coaching técnico permanece agregado e não punitivo.
- Nenhuma automação de ticket, WhatsApp, KB ou cloud foi criada.

## V8 — Operacionalização do Produto (em andamento)

Pacote 1 — Central Enterprise 3.0 + Observabilidade Segura:
- **Entregue**: Observabilidade Segura na Saúde Técnica — bloco read-only de Flags Críticas
  (ENVIRONMENT, AI_SUPERVISOR_ENABLED, INTEGRATION_SERVICE_HOST, META_WEBHOOK_CONFIGURED) e
  Migrations Críticas 044/045 (verificação por arquivo, sem acesso ao banco). Segredos, tokens
  e URLs completas nunca são exibidos (URLs reduzidas a host). Nada é gravado pela tela e
  nenhuma flag/`.env` é alterada.
- **Diferido para o Pacote 2** (requer validação de runtime no GLPI): reorganização da Central por
  jornadas (Atendimento / Conhecimento / Configuração / Governança), redução de ruído visual e
  badges críticos. Motivo: `templates/central.php` (3477 linhas) é UI de atendimento ao vivo;
  reorganizar sem validação de rotas/RBAC em ambiente real violaria as STOP conditions
  ("não quebrar rotas atuais" / "técnico comum ganhar acesso indevido").
- Nenhuma alteração no runtime da Ajuda Inteligente, Copiloto, Ollama, migrations ou produção.

Pacote final — Governance, LGPD e Product Readiness:
- **Documentado**: política LGPD/retencao proposta em `docs/lgpd_retention_policy.md`, com owners `OWNER_A_DEFINIR` como gate obrigatório antes de qualquer expurgo futuro.
- **Documentado**: checklist de readiness em `docs/product_readiness_checklist.md`, cobrindo separação TESTE/HOMOLOGAÇÃO/PRODUÇÃO, dependências, pre-deploy, post-deploy, go/no-go e suporte.
- **Atualizado**: `docs/feature_flags_matrix.md`, `docs/release_runbook.md`, `docs/v7_final_readiness.md` e `docs/smoke_tests.md` com gates V8 finais.
- **Sem runtime**: nenhum PHP operacional, Node, migration, Docker, `.env`, WhatsApp, SmartHelp, LogMeIn ou banco foi alterado nesta fase documental.
