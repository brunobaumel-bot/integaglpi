# Queries Operacionais - Baseline 8.x

## Schema PostgreSQL

Listar tabelas do runtime:

```sql
SELECT table_schema, table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name LIKE 'glpi_plugin_integaglpi_%'
ORDER BY table_name;
```

Confirmar `media_info`:

```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'glpi_plugin_integaglpi_messages'
  AND column_name = 'media_info';
```

Confirmar indice opcional de status de midia:

```sql
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'glpi_plugin_integaglpi_messages'
  AND indexname = 'idx_glpi_plugin_integaglpi_messages_media_status';
```

Confirmar colunas de `solution_actions`:

```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'glpi_plugin_integaglpi_solution_actions'
ORDER BY ordinal_position;
```

Confirmar indices de `solution_actions`:

```sql
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'glpi_plugin_integaglpi_solution_actions'
ORDER BY indexname;
```

Confirmar tabela `solution_actions`:

```sql
SELECT to_regclass('public.glpi_plugin_integaglpi_solution_actions');
```

## Midias

Resumo por tipo/status:

```sql
SELECT
  message_type,
  media_info->>'status' AS media_status,
  count(*)
FROM public.glpi_plugin_integaglpi_messages
WHERE message_type != 'text'
GROUP BY 1, 2
ORDER BY 1, 2;
```

Ultimas midias:

```sql
SELECT
  id,
  message_id,
  message_type,
  glpi_sync_status,
  media_info,
  created_at
FROM public.glpi_plugin_integaglpi_messages
WHERE message_type IN ('document', 'image', 'audio')
ORDER BY created_at DESC
LIMIT 10;
```

## Solution actions

Acoes com erro ou presas:

```sql
SELECT
  ticket_id,
  action,
  status,
  error_code,
  error_message,
  created_at,
  updated_at
FROM public.glpi_plugin_integaglpi_solution_actions
WHERE status IN ('processing', 'error')
ORDER BY updated_at DESC;
```

Ultimas acoes:

```sql
SELECT
  ticket_id,
  conversation_id,
  phone_e164,
  action,
  status,
  previous_ticket_status,
  final_ticket_status,
  error_code,
  created_at,
  updated_at
FROM public.glpi_plugin_integaglpi_solution_actions
ORDER BY updated_at DESC
LIMIT 20;
```

Consulta usada pelo anti-loop PHP de reabertura:

```sql
SELECT status
FROM glpi_plugin_integaglpi_solution_actions
WHERE ticket_id = :ticket_id
  AND action = 'reopen'
  AND status = 'success'
  AND updated_at > NOW() - INTERVAL '30 seconds'
ORDER BY updated_at DESC
LIMIT 1;
```

## Conversas

Ultimas conversas:

```sql
SELECT
  id,
  phone_e164,
  status,
  glpi_ticket_id,
  updated_at
FROM public.glpi_plugin_integaglpi_conversations
ORDER BY updated_at DESC
LIMIT 10;
```

Runtime por ticket:

```sql
SELECT
  conversation_id,
  ticket_id,
  queue_id,
  assigned_user_id,
  status,
  claimed_at,
  closed_at,
  updated_at
FROM public.glpi_plugin_integaglpi_conversation_runtime
WHERE ticket_id = :ticket_id;
```

## GLPI/MariaDB

Ultimos documentos e vinculos:

```sql
SELECT
  d.id,
  d.filename,
  d.mime,
  d.date_creation,
  di.id AS document_item_id,
  di.itemtype,
  di.items_id
FROM glpi_documents d
LEFT JOIN glpi_documents_items di
  ON di.documents_id = d.id
ORDER BY d.id DESC
LIMIT 20;
```

Direito canonico do plugin:

```sql
SELECT profiles_id, name, rights
FROM glpi_profilerights
WHERE name IN ('plugin_integaglpi', 'PluginIntegaglpi', 'PluginWhatsapp')
ORDER BY profiles_id, name;
```
