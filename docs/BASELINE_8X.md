# Baseline 8.x - IntegaGLPI

Data da baseline: 2026-04-26

Status: nao apto formalmente para 9.0A ate concluir as validacoes operacionais no ambiente Docker/GLPI real.

Esta baseline congela o ciclo 8.x antes da Fase 9.0A (IA Local/Ollama). Ela nao
introduz funcionalidade nova; apenas documenta o estado validado, comandos de
checagem e bloqueadores.

## Arquitetura final 8.x

- Plugin GLPI/PHP: UI, Central, hooks, configuracao, notificacoes e chamadas leves ao integration-service.
- integration-service/Node.js: webhook Meta, FSM inbound, botoes interativos, envio WhatsApp, integracao REST com GLPI e processamento de midia.
- PostgreSQL externo: conversations, messages, runtime, routing options, configs, notifications e solution actions.
- GLPI/MariaDB: tickets, documentos, grupos, tecnicos, perfis e historico nativo.

## Funcionalidades congeladas

- 8.0C: midia em conversa `open` baixa por stream, valida MIME/tamanho, anexa no GLPI e registra `media_info`.
- 8.5: botoes interativos de fila quando ha 1 a 3 opcoes; fallback textual preservado.
- 8.6A: botoes `Aprovar` e `Reabrir` para solucao de chamado.
- 8.6B1: tabela `glpi_plugin_integaglpi_solution_actions`, idempotencia forte, anti-stale e auditoria backend.
- 8.6B2: anti-loop PHP fail-open; `CLOSED` do approve nao e suprimido.
- 8.9E: hardening de bootstrap/migrations; `schema-migrations` entra na imagem do `integration-service` e migrations criticas falham explicitamente se ausentes.

## Tabelas reais

Prefixo oficial:

```text
glpi_plugin_integaglpi_
```

Tabelas obrigatorias no PostgreSQL externo:

- `public.glpi_plugin_integaglpi_contacts`
- `public.glpi_plugin_integaglpi_conversations`
- `public.glpi_plugin_integaglpi_messages`
- `public.glpi_plugin_integaglpi_webhook_events`
- `public.glpi_plugin_integaglpi_queues`
- `public.glpi_plugin_integaglpi_queue_users`
- `public.glpi_plugin_integaglpi_queue_groups`
- `public.glpi_plugin_integaglpi_conversation_runtime`
- `public.glpi_plugin_integaglpi_routing_options`
- `public.glpi_plugin_integaglpi_configs`
- `public.glpi_plugin_integaglpi_notifications`
- `public.glpi_plugin_integaglpi_solution_actions`

Campos/indices criticos:

- `glpi_plugin_integaglpi_messages.media_info JSONB`
- `glpi_plugin_integaglpi_solution_actions.whatsapp_message_id` com indice unico
- indices em `solution_actions.ticket_id`, `conversation_id` e `action_key`

## Validacao local executada

- `node node_modules/typescript/bin/tsc -p tsconfig.json`: OK.
- `node node_modules/vitest/vitest.mjs run`: OK, 15 arquivos e 104 testes.
- `php -l` em 52 arquivos PHP do plugin (excluindo `vendor`): OK.
- Auditoria de tabela no codigo Node: `PostgresMessageRepository` usa `DATABASE_TABLES.messages`, que resolve para `glpi_plugin_integaglpi_messages`.
- `init-db.sql` contem `glpi_plugin_integaglpi_messages.media_info JSONB`.
- `schema-migrations/004_solution_actions.sql` cria `glpi_plugin_integaglpi_solution_actions` e indices esperados.
- `integration-service/Dockerfile` copia `schema-migrations` para `/app/schema-migrations`.

## Validacoes nao executadas neste desktop

- Docker runtime: `docker` nao esta instalado/disponivel neste desktop.
  Em servidor, validar `/app/schema-migrations` dentro do container.
- Schema runtime real: conexao local ao PostgreSQL em `127.0.0.1:5432` recusou.
- E2E GLPI/WhatsApp real: requer ambiente GLPI + Meta + Postgres/Redis ativos.

## Observabilidade esperada

Logs criticos devem carregar pelo menos `conversation_id`, `ticket_id`,
`message_id`, `action`, `status` ou `error_code` quando aplicavel.

Eventos esperados:

- Midia: `DOWNLOAD_START`, `DOWNLOAD_OK`, `UPLOAD_OK`, `MIME_NOT_ALLOWED`, `MIME_NOT_ALLOWED_POST_DOWNLOAD`.
- Fila: `INTERACTIVE_MENU_SENT`, `INTERACTIVE_OPTION_SELECTED`, `OPTION_SELECTED`, `TICKET_CREATED`.
- Solution actions: `APPROVED`, `REOPENED`, `DUPLICATE`, `ACTION_EXPIRED`, `ERROR`.
- Anti-loop PHP: `notification_suppressed_node_reopen`, `notification_allowed_node_closed`, `notification_allowed_human_status_change`, `solution_actions_lookup_failed_fail_open`.

## Healthcheck

Endpoint Node:

```http
GET /health
```

Resposta esperada com Postgres saudavel:

```json
{
  "ok": true,
  "service": "integration-service",
  "uptime_seconds": 123,
  "postgres": {
    "ok": true,
    "latency_ms": 10
  },
  "meta_configured": true,
  "glpi_configured": true,
  "version": "..."
}
```

Com Postgres indisponivel, o endpoint retorna HTTP 503 com `ok = false`.

## Bloqueadores para 9.0A

Qualquer item abaixo bloqueia IA 9.0A:

- tabela inexistente `messages` sendo usada em runtime;
- `media_info` ausente no schema real;
- `solution_actions` ausente;
- duplicidade de notificacao no fechamento;
- upload de midia falhando;
- risco de OOM no download de midia;
- logs sem `ticket_id`/`conversation_id` em fluxos criticos;
- `.env` real versionado;
- `NODE_TLS_REJECT_UNAUTHORIZED=0` em producao sem justificativa;
- falha de abertura de ticket;
- falha em Approve/Reopen;
- rollback nao documentado.

## Veredito

Baseline 8.x NAO apta formalmente para iniciar 9.0A neste desktop, porque as
validacoes de schema runtime e Docker nao puderam ser executadas aqui.

Nao foram encontrados bloqueadores de codigo nos testes automatizados locais.

A baseline passa a ficar apta para iniciar 9.0A apos confirmar no servidor:

- schema real do PostgreSQL com as queries de `docs/QUERIES_OPERACIONAIS.md`;
- containers Docker rodando imagem atual;
- `/app/schema-migrations` existente dentro do container `integration-service`;
- checklist E2E de `docs/HOMOLOGACAO_8_9.md`.
