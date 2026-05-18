-- Adiciona timestamp de conclusão das tentativas de seleção de entidade.
-- Aditivo e idempotente: não remove dados nem altera tentativas existentes.

ALTER TABLE public.glpi_plugin_integaglpi_entity_selection_attempts
  ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS glpi_intega_entity_sel_finished_idx
  ON public.glpi_plugin_integaglpi_entity_selection_attempts (finished_at DESC)
  WHERE finished_at IS NOT NULL;
