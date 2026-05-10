# Bootstrap do PostgreSQL

Fase 8.9E: o bootstrap do PostgreSQL usa um desenho hibrido:

- `integration-service/init-db.sql`: baseline consolidado para ambientes novos.
- `integration-service/schema-migrations/*.sql`: patches incrementais idempotentes para ambientes existentes.

Nao executar SQL manual como procedimento normal de deploy. O SQL manual usado
na homologacao para `media_info` e `solution_actions` foi formalizado nas
migrations `003_messages_media_info.sql` e `004_solution_actions.sql`.

## Quando roda

O bootstrap roda em [main.ts](D:/Integracao%20GLPI%20Whats/integration-service/src/main.ts:1), logo depois do teste de conexao com o banco e antes do servidor HTTP subir.

## Como funciona

- `ensureDatabaseSchema()` le [init-db.sql](D:/Integracao%20GLPI%20Whats/integration-service/init-db.sql:1).
- Em seguida le `schema-migrations/*.sql` em ordem lexicografica.
- O processo usa `pg_advisory_xact_lock` para evitar corrida entre startups concorrentes.
- As instrucoes SQL usam `CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` e `CREATE INDEX IF NOT EXISTS`, entao o processo e seguro para multiplas execucoes.
- A ausencia da pasta `schema-migrations` no runtime agora deve falhar de forma explicita. Isso evita subir container antigo sem patches criticos.

`CREATE TABLE IF NOT EXISTS` cria tabelas em ambientes novos, mas nao altera
tabelas existentes. Por isso ambientes existentes precisam das migrations com
`ALTER TABLE ... IF NOT EXISTS`.

## Tabelas criadas

- `glpi_plugin_integaglpi_webhook_events`
- `glpi_plugin_integaglpi_contacts`
- `glpi_plugin_integaglpi_conversations`
- `glpi_plugin_integaglpi_messages`
- `glpi_plugin_integaglpi_queues`
- `glpi_plugin_integaglpi_queue_users`
- `glpi_plugin_integaglpi_queue_groups`
- `glpi_plugin_integaglpi_conversation_runtime`
- `glpi_plugin_integaglpi_routing_options`
- `glpi_plugin_integaglpi_configs`
- `glpi_plugin_integaglpi_notifications`
- `glpi_plugin_integaglpi_solution_actions`

## Migrations incrementais

Arquivos em `integration-service/schema-migrations/*.sql` sao aplicados no
startup por `ensureDatabaseSchema()`.

Patches criticos da baseline 8.x:

- `003_messages_media_info.sql`: garante `media_info JSONB` em `glpi_plugin_integaglpi_messages`.
- `004_solution_actions.sql`: cria `glpi_plugin_integaglpi_solution_actions` e indices de idempotencia/auditoria.

## Validacao no container

Depois de rebuild/recreate:

```powershell
docker exec -it glpi-integaglpi-integration sh -lc 'ls -la /app/schema-migrations && ls -la /app/init-db.sql'
docker exec -it glpi-integaglpi-integration sh -lc 'grep -Rni "solution_actions\|media_info" /app/schema-migrations /app/init-db.sql /app/dist 2>/dev/null | head -100'
```

## Como adicionar nova migration

1. Criar arquivo numerado em `integration-service/schema-migrations`, por exemplo `005_nome.sql`.
2. Tornar o SQL idempotente com `IF NOT EXISTS` ou `ADD COLUMN IF NOT EXISTS`.
3. Refletir a estrutura final no `init-db.sql` quando for schema necessario para ambiente novo.
4. Adicionar teste estatico cobrindo a estrutura critica.
5. Rebuildar a imagem para copiar a migration para `/app/schema-migrations`.
