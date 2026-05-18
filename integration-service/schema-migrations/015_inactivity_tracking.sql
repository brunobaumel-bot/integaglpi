CREATE TABLE IF NOT EXISTS public.glpi_plugin_integaglpi_inactivity_tracking (
  conversation_id TEXT PRIMARY KEY,
  ticket_id BIGINT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  reminder_1_sent_at TIMESTAMPTZ NULL,
  reminder_2_sent_at TIMESTAMPTZ NULL,
  reminder_3_sent_at TIMESTAMPTZ NULL,
  autoclose_attempted_at TIMESTAMPTZ NULL,
  autoclose_completed_at TIMESTAMPTZ NULL,
  last_client_activity_at TIMESTAMPTZ NULL,
  last_outbound_activity_at TIMESTAMPTZ NULL,
  manual_hold_until TIMESTAMPTZ NULL,
  manual_hold_reason TEXT NULL,
  skip_reason TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT glpi_intega_inactivity_conv_fk FOREIGN KEY (conversation_id)
    REFERENCES public.glpi_plugin_integaglpi_conversations (id) ON DELETE CASCADE,
  CONSTRAINT glpi_intega_inactivity_status_chk CHECK (
    status IN (
      'pending',
      'reminder_1_sent',
      'reminder_2_sent',
      'reminder_3_sent',
      'autoclose_done',
      'skipped_by_response',
      'skipped_by_hold',
      'skipped_by_closed_ticket',
      'skipped_by_feature_flag',
      'failed'
    )
  )
);

ALTER TABLE public.glpi_plugin_integaglpi_inactivity_tracking
  ADD COLUMN IF NOT EXISTS ticket_id BIGINT NULL,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS reminder_1_sent_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS reminder_2_sent_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS reminder_3_sent_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS autoclose_attempted_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS autoclose_completed_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS last_client_activity_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS last_outbound_activity_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS manual_hold_until TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS manual_hold_reason TEXT NULL,
  ADD COLUMN IF NOT EXISTS skip_reason TEXT NULL,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS glpi_intega_inactivity_status_updated_idx
  ON public.glpi_plugin_integaglpi_inactivity_tracking (status, updated_at DESC);

CREATE INDEX IF NOT EXISTS glpi_intega_inactivity_ticket_idx
  ON public.glpi_plugin_integaglpi_inactivity_tracking (ticket_id)
  WHERE ticket_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS glpi_intega_inactivity_outbound_idx
  ON public.glpi_plugin_integaglpi_inactivity_tracking (last_outbound_activity_at)
  WHERE status IN ('pending', 'reminder_1_sent', 'reminder_2_sent', 'reminder_3_sent', 'failed');
