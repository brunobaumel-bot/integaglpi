-- Fase 8.0C: metadados de midia processada no schema real do integration-service.
ALTER TABLE public.glpi_plugin_integaglpi_messages
ADD COLUMN IF NOT EXISTS media_info JSONB;

CREATE INDEX IF NOT EXISTS idx_glpi_plugin_integaglpi_messages_media_status
ON public.glpi_plugin_integaglpi_messages ((media_info->>'status'));
