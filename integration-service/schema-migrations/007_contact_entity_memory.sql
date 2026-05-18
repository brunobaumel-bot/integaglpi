CREATE TABLE IF NOT EXISTS public.glpi_plugin_integaglpi_contact_entity_memory (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  phone_e164 TEXT NOT NULL,
  contact_id TEXT NULL,
  glpi_entity_id BIGINT NOT NULL,
  glpi_entity_name TEXT NULL,
  source_ticket_id BIGINT NULL,
  source_conversation_id TEXT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT glpi_intega_contact_entity_mem_contact_fk FOREIGN KEY (contact_id)
    REFERENCES public.glpi_plugin_integaglpi_contacts (id) ON DELETE SET NULL,
  CONSTRAINT glpi_intega_contact_entity_mem_conv_fk FOREIGN KEY (source_conversation_id)
    REFERENCES public.glpi_plugin_integaglpi_conversations (id) ON DELETE SET NULL
);

ALTER TABLE public.glpi_plugin_integaglpi_contact_entity_memory
  ADD COLUMN IF NOT EXISTS id TEXT DEFAULT gen_random_uuid()::text,
  ADD COLUMN IF NOT EXISTS phone_e164 TEXT,
  ADD COLUMN IF NOT EXISTS contact_id TEXT NULL,
  ADD COLUMN IF NOT EXISTS glpi_entity_name TEXT NULL,
  ADD COLUMN IF NOT EXISTS source_ticket_id BIGINT NULL,
  ADD COLUMN IF NOT EXISTS source_conversation_id TEXT NULL,
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

DROP INDEX IF EXISTS public.glpi_intega_contact_entity_mem_phone_uq;

CREATE UNIQUE INDEX IF NOT EXISTS glpi_intega_contact_entity_mem_phone_active_uq
  ON public.glpi_plugin_integaglpi_contact_entity_memory (phone_e164)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS glpi_intega_contact_entity_mem_active_idx
  ON public.glpi_plugin_integaglpi_contact_entity_memory (phone_e164, is_active);

CREATE INDEX IF NOT EXISTS glpi_intega_contact_entity_mem_updated_idx
  ON public.glpi_plugin_integaglpi_contact_entity_memory (updated_at DESC);
