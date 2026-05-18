-- Idempotência persistente na confirmação de entidade (defer_until_known).
-- Executado no startup do integration-service; manter idempotente (IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS public.glpi_plugin_integaglpi_entity_selection_attempts (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  conversation_id TEXT NOT NULL,
  glpi_entity_id BIGINT NOT NULL,
  glpi_entity_name TEXT NULL,
  status TEXT NOT NULL,
  glpi_ticket_id BIGINT NULL,
  error_message TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT glpi_intega_entity_sel_conv_fk FOREIGN KEY (conversation_id)
    REFERENCES public.glpi_plugin_integaglpi_conversations (id) ON DELETE CASCADE,
  CONSTRAINT glpi_intega_entity_sel_status_chk CHECK (
    status IN ('processing', 'succeeded', 'failed_before_ticket', 'failed_after_ticket', 'cancelled')
  )
);

ALTER TABLE public.glpi_plugin_integaglpi_entity_selection_attempts
  ADD COLUMN IF NOT EXISTS id TEXT DEFAULT gen_random_uuid()::text;

ALTER TABLE public.glpi_plugin_integaglpi_entity_selection_attempts
  ADD COLUMN IF NOT EXISTS conversation_id TEXT NULL;

ALTER TABLE public.glpi_plugin_integaglpi_entity_selection_attempts
  ADD COLUMN IF NOT EXISTS glpi_entity_id BIGINT NULL;

ALTER TABLE public.glpi_plugin_integaglpi_entity_selection_attempts
  ADD COLUMN IF NOT EXISTS glpi_entity_name TEXT NULL;

ALTER TABLE public.glpi_plugin_integaglpi_entity_selection_attempts
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'processing';

ALTER TABLE public.glpi_plugin_integaglpi_entity_selection_attempts
  ADD COLUMN IF NOT EXISTS glpi_ticket_id BIGINT NULL;

ALTER TABLE public.glpi_plugin_integaglpi_entity_selection_attempts
  ADD COLUMN IF NOT EXISTS error_message TEXT NULL;

ALTER TABLE public.glpi_plugin_integaglpi_entity_selection_attempts
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE public.glpi_plugin_integaglpi_entity_selection_attempts
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE UNIQUE INDEX IF NOT EXISTS glpi_intega_entity_sel_conv_uq
  ON public.glpi_plugin_integaglpi_entity_selection_attempts (conversation_id);

CREATE INDEX IF NOT EXISTS glpi_intega_entity_sel_status_idx
  ON public.glpi_plugin_integaglpi_entity_selection_attempts (status, updated_at DESC);
