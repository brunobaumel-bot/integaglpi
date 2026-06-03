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
