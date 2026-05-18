-- Alinha tentativas de seleção de entidade com a chave idempotente usada pelo Node.
-- Aditivo e idempotente: não remove dados nem altera tentativas existentes.

ALTER TABLE public.glpi_plugin_integaglpi_entity_selection_attempts
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT NULL;

CREATE INDEX IF NOT EXISTS glpi_intega_entity_sel_idempotency_idx
  ON public.glpi_plugin_integaglpi_entity_selection_attempts (idempotency_key)
  WHERE idempotency_key IS NOT NULL;
