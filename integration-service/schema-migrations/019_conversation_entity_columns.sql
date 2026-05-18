-- Entidade GLPI efetiva da conversa.
-- Idempotente: versiona colunas já aplicadas manualmente em TESTE.

ALTER TABLE public.glpi_plugin_integaglpi_conversations
  ADD COLUMN IF NOT EXISTS glpi_entity_id BIGINT NULL;

ALTER TABLE public.glpi_plugin_integaglpi_conversations
  ADD COLUMN IF NOT EXISTS glpi_entity_name TEXT NULL;

CREATE INDEX IF NOT EXISTS glpi_intega_conversations_entity_idx
  ON public.glpi_plugin_integaglpi_conversations (glpi_entity_id)
  WHERE glpi_entity_id IS NOT NULL;
