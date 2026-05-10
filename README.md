# GLPI WhatsApp Integration Foundation

Fase 0 do sistema de atendimento integrado entre GLPI 11, WhatsApp Cloud API e IA local. Esta base prioriza seguranca, desacoplamento e preparacao para integracoes criticas sem implementar logica de negocio.

## Arquitetura

O projeto e dividido em cinco blocos:

- `integaglpi/`: plugin GLPI responsavel pela extensao oficial do GLPI, sem tocar no core (pasta instalada em `plugins/integaglpi`).
- `integration-service/`: servico HTTP que concentra webhooks, autenticacao REST do GLPI, cache, sessao e adapters de GLPI e Meta.
- `ai-service/`: servico isolado para futuras capacidades de IA local, desacoplado do fluxo principal.
- `infra/`: definicoes de containers, scripts de bootstrap e apoio operacional.
- `docs/`: documentacao de arquitetura e seguranca.

## Separacao de responsabilidades

O plugin GLPI fica limitado ao ecossistema do GLPI e a pontos oficiais de extensao. A integracao com WhatsApp, autenticacao REST do GLPI, webhooks e cache Redis vive no `integration-service`, evitando acoplamento com o plugin e permitindo escalar os servicos de forma independente.

## Fase 1 inbound

O fluxo inbound agora cobre:

- challenge `GET /webhook/meta`
- recepcao `POST /webhook/meta` com validacao obrigatoria de assinatura
- idempotencia forte por `message_id` unico
- resolucao de contato com Redis antes do GLPI
- criacao ou reaproveitamento de ticket/conversa
- persistencia local resiliente quando o GLPI falha

## Redis

Redis e obrigatorio em dois papeis:

- cache de contatos para resolver `telefone <-> ID GLPI`
- sessao de conversas para preservar contexto de atendimento

O `integration-service` usa Redis para cache de contatos e sessao. A autenticacao do GLPI foi simplificada para `GLPI_APP_TOKEN` e `GLPI_USER_TOKEN`, mais adequada para cenarios com proxy reverso e deploy simples.

Consulte tambem [docs/inbound-flow.md](D:/Integracao%20GLPI%20Whats/docs/inbound-flow.md:1) para a sequencia detalhada da Fase 1.
Consulte tambem [docs/database-bootstrap.md](D:/Integracao%20GLPI%20Whats/docs/database-bootstrap.md:1) para o bootstrap automatico do PostgreSQL.

## Como subir o ambiente

1. Copie `.env.example` para `.env` e ajuste os segredos.
2. Execute `docker compose -f docker-compose.dev.yml up --build`.
3. O `integration-service` sobe na porta `3001` e expoe `GET /health`, `GET /webhook/meta` e `POST /webhook/meta`.
4. O `integration-service` so inicia apos PostgreSQL e Redis ficarem saudaveis via healthcheck.

## Qualidade

Cada servico Node/TypeScript inclui:

- lint com ESLint
- formatacao com Prettier
- testes basicos com Vitest
- script de bootstrap para instalar dependencias

O plugin PHP inclui autoload PSR-4 via Composer e scripts de qualidade com PHP_CodeSniffer/PHP-CBF.
