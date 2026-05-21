ALTER TABLE public.glpi_plugin_integaglpi_conversations
  ADD COLUMN IF NOT EXISTS link_origin TEXT NOT NULL DEFAULT 'whatsapp_inbound';

ALTER TABLE public.glpi_plugin_integaglpi_conversations
  ADD COLUMN IF NOT EXISTS linked_by_glpi_user_id BIGINT NULL;

ALTER TABLE public.glpi_plugin_integaglpi_conversations
  ADD COLUMN IF NOT EXISTS linked_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS glpi_intega_conv_manual_link_idx
  ON public.glpi_plugin_integaglpi_conversations (glpi_ticket_id, link_origin, linked_at DESC)
  WHERE glpi_ticket_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS glpi_intega_conv_phone_ticket_open_idx
  ON public.glpi_plugin_integaglpi_conversations (phone_e164, glpi_ticket_id, status)
  WHERE glpi_ticket_id IS NOT NULL;
