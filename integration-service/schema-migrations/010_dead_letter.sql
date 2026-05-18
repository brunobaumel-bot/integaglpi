CREATE TABLE IF NOT EXISTS public.glpi_plugin_integaglpi_dead_letter (
  id BIGSERIAL PRIMARY KEY,
  correlation_id TEXT NULL,
  conversation_id TEXT NULL,
  message_id TEXT NULL,
  ticket_id BIGINT NULL,
  operation_type TEXT NOT NULL DEFAULT 'unknown',
  failure_type TEXT NOT NULL DEFAULT 'unknown',
  failure_reason TEXT NULL,
  retry_count INTEGER NOT NULL DEFAULT 0,
  payload_json JSONB NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_attempt_at TIMESTAMPTZ NULL
);

ALTER TABLE public.glpi_plugin_integaglpi_dead_letter
  ADD COLUMN IF NOT EXISTS correlation_id TEXT NULL,
  ADD COLUMN IF NOT EXISTS conversation_id TEXT NULL,
  ADD COLUMN IF NOT EXISTS message_id TEXT NULL,
  ADD COLUMN IF NOT EXISTS ticket_id BIGINT NULL,
  ADD COLUMN IF NOT EXISTS operation_type TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS failure_type TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS failure_reason TEXT NULL,
  ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payload_json JSONB NULL,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ NULL;

DROP INDEX IF EXISTS public.glpi_intega_dead_letter_kind_idx;

CREATE INDEX IF NOT EXISTS glpi_intega_dead_letter_created_idx
  ON public.glpi_plugin_integaglpi_dead_letter (created_at DESC);

CREATE INDEX IF NOT EXISTS glpi_intega_dead_letter_correlation_idx
  ON public.glpi_plugin_integaglpi_dead_letter (correlation_id);

CREATE INDEX IF NOT EXISTS glpi_intega_dead_letter_conversation_idx
  ON public.glpi_plugin_integaglpi_dead_letter (conversation_id);

CREATE INDEX IF NOT EXISTS glpi_intega_dead_letter_message_idx
  ON public.glpi_plugin_integaglpi_dead_letter (message_id);

CREATE INDEX IF NOT EXISTS glpi_intega_dead_letter_ticket_idx
  ON public.glpi_plugin_integaglpi_dead_letter (ticket_id);

CREATE INDEX IF NOT EXISTS glpi_intega_dead_letter_operation_created_idx
  ON public.glpi_plugin_integaglpi_dead_letter (operation_type, created_at DESC);

CREATE INDEX IF NOT EXISTS glpi_intega_dead_letter_status_created_idx
  ON public.glpi_plugin_integaglpi_dead_letter (status, created_at DESC);
