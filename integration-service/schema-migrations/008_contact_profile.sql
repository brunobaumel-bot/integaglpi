CREATE TABLE IF NOT EXISTS public.glpi_plugin_integaglpi_contact_profile (
  id BIGSERIAL PRIMARY KEY,
  phone_e164 TEXT NOT NULL,
  requester_name TEXT NULL,
  company_name_raw TEXT NULL,
  last_equipment_tag TEXT NULL,
  last_problem_summary TEXT NULL,
  profile_status TEXT NOT NULL DEFAULT 'incomplete',
  last_confirmed_at TIMESTAMPTZ NULL,
  last_conversation_id TEXT NULL,
  equipment_tag_unknown BOOLEAN NOT NULL DEFAULT FALSE,
  profile_source TEXT NOT NULL DEFAULT 'whatsapp',
  confirmation_count INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.glpi_plugin_integaglpi_contact_profile
  ADD COLUMN IF NOT EXISTS id BIGSERIAL,
  ADD COLUMN IF NOT EXISTS phone_e164 TEXT,
  ADD COLUMN IF NOT EXISTS requester_name TEXT NULL,
  ADD COLUMN IF NOT EXISTS company_name_raw TEXT NULL,
  ADD COLUMN IF NOT EXISTS last_equipment_tag TEXT NULL,
  ADD COLUMN IF NOT EXISTS last_problem_summary TEXT NULL,
  ADD COLUMN IF NOT EXISTS profile_status TEXT NOT NULL DEFAULT 'incomplete',
  ADD COLUMN IF NOT EXISTS last_confirmed_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS last_conversation_id TEXT NULL,
  ADD COLUMN IF NOT EXISTS equipment_tag_unknown BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS profile_source TEXT NOT NULL DEFAULT 'whatsapp',
  ADD COLUMN IF NOT EXISTS confirmation_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

DROP INDEX IF EXISTS public.glpi_intega_contact_profile_phone_uq;

CREATE UNIQUE INDEX IF NOT EXISTS glpi_intega_contact_profile_phone_active_uq
  ON public.glpi_plugin_integaglpi_contact_profile (phone_e164)
  WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS glpi_intega_contact_profile_phone_updated_idx
  ON public.glpi_plugin_integaglpi_contact_profile (phone_e164, updated_at DESC);

CREATE INDEX IF NOT EXISTS glpi_intega_contact_profile_updated_idx
  ON public.glpi_plugin_integaglpi_contact_profile (updated_at DESC);
