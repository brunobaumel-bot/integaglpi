# Checklist de Migration Producao

Migrations sao manuais e exigem aprovacao humana. Esta fase documental nao executa migration.

## Migrations Esperadas

Conferir no `package_manifest.json`:

- `001_messages_idempotency.sql`
- `002_routing_queues.sql`
- `003_messages_media_info.sql`
- `004_solution_actions.sql`
- `005_audit_events.sql`
- `006_entity_selection_attempts.sql`
- `007_contact_entity_memory.sql`
- `008_contact_profile.sql`
- `009_conversation_profile_snapshot.sql`
- `010_dead_letter.sql`
- `011_runtime_configs.sql`
- `012_profile_collection_state.sql`
- `013_customer_experience_glpi_user_csat.sql`
- `014_customer_experience_schema_alignment.sql`
- `015_inactivity_tracking.sql`
- `016_contract_hours.sql`
- `017_ai_quality_analyses.sql`
- `018_message_delivery_status.sql`
- `019_conversation_entity_columns.sql`
- `020_entity_selection_attempts_idempotency_key.sql`
- `021_configurable_message_flows.sql`
- `022_inactivity_job_diagnostics.sql`
- `023_entity_selection_attempt_finished_at.sql`

## Antes de Aplicar

- [ ] Backup PostgreSQL concluido.
- [ ] Migration revisada no dev local.
- [ ] Migration e aditiva.
- [ ] Sem comandos destrutivos.
- [ ] Janela de manutencao aberta.
- [ ] Aprovacao humana registrada.

## Comando Placeholder

Substituir host, usuario, banco e arquivo conforme ambiente autorizado. Nao inserir senha no comando ou no historico.

```bash
psql --host <postgres-host> --port <postgres-port> --username <postgres-user> --dbname <postgres-db> --file <migration-file.sql>
```

## Validacao Read-Only

Usar apenas consultas de leitura para confirmar tabelas/colunas:

```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name LIKE 'glpi_plugin_integaglpi_%'
ORDER BY table_name;
```

```sql
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN (
    'glpi_plugin_integaglpi_conversations',
    'glpi_plugin_integaglpi_messages',
    'glpi_plugin_integaglpi_entity_selection_attempts',
    'glpi_plugin_integaglpi_message_delivery_status',
    'glpi_plugin_integaglpi_inactivity_job_events'
  )
ORDER BY table_name, ordinal_position;
```

## Proibido

- Alterar producao sem backup.
- Executar migration sem aprovacao humana.
- Rodar comandos SQL destrutivos: `DROP`, `TRUNCATE` ou `DELETE`.
- Aplicar SQL improvisado fora de migration revisada.
- Fazer update manual em conversas/tickets para mascarar bug.
