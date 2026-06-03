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
