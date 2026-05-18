CREATE TABLE IF NOT EXISTS public.glpi_plugin_integaglpi_conversation_profile_snapshot (
  conversation_id TEXT NOT NULL,
  phone_e164 TEXT NOT NULL,
  snapshot_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT glpi_intega_conv_profile_snap_pk PRIMARY KEY (conversation_id),
  CONSTRAINT glpi_intega_conv_profile_snap_conv_fk FOREIGN KEY (conversation_id)
    REFERENCES public.glpi_plugin_integaglpi_conversations (id) ON DELETE CASCADE
);

ALTER TABLE public.glpi_plugin_integaglpi_conversation_profile_snapshot
  ADD COLUMN IF NOT EXISTS phone_e164 TEXT,
  ADD COLUMN IF NOT EXISTS snapshot_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS glpi_intega_conv_profile_snap_updated_idx
  ON public.glpi_plugin_integaglpi_conversation_profile_snapshot (updated_at DESC);
