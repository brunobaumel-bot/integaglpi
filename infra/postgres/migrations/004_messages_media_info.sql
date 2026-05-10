-- Fase 8.0C: adiciona coluna media_info para persistir metadados de mídia processada.
-- Usa ADD COLUMN IF NOT EXISTS para ser idempotente em re-execuções.
--
-- Atenção: os scripts de init (infra/postgres/init/) usam prefixo glpi_plugin_whatsapp_*
-- enquanto o código Node.js usa glpi_plugin_integaglpi_*. Se o banco foi criado pelos
-- scripts de init sem renomeação posterior, substitua o nome da tabela abaixo.
ALTER TABLE glpi_plugin_integaglpi_messages
  ADD COLUMN IF NOT EXISTS media_info JSONB;
