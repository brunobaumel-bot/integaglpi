CREATE TABLE IF NOT EXISTS public.glpi_plugin_integaglpi_inactivity_job_events (
  id BIGSERIAL PRIMARY KEY,
  conversation_id TEXT NULL,
  ticket_id BIGINT NULL,
  phone_e164 TEXT NULL,
  event_key TEXT NULL,
  status TEXT NOT NULL CHECK (status IN ('checked', 'eligible', 'skipped', 'planned', 'sent', 'failed')),
  reason TEXT NULL,
  message_id TEXT NULL,
  delivery_status TEXT NULL,
  meta_error_code TEXT NULL,
  meta_error_message_sanitized TEXT NULL,
  checked_count INTEGER NULL,
  eligible_count INTEGER NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS glpi_intega_inactivity_job_conv_idx
  ON public.glpi_plugin_integaglpi_inactivity_job_events (conversation_id, created_at DESC)
  WHERE conversation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS glpi_intega_inactivity_job_status_idx
  ON public.glpi_plugin_integaglpi_inactivity_job_events (status, created_at DESC);

CREATE INDEX IF NOT EXISTS glpi_intega_inactivity_job_event_idx
  ON public.glpi_plugin_integaglpi_inactivity_job_events (event_key, created_at DESC)
  WHERE event_key IS NOT NULL;
