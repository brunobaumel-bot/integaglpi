ALTER TABLE public.glpi_plugin_integaglpi_contact_profile
  ADD COLUMN IF NOT EXISTS email_address TEXT NULL,
  ADD COLUMN IF NOT EXISTS email_status TEXT NOT NULL DEFAULT 'not_provided',
  ADD COLUMN IF NOT EXISTS glpi_user_id BIGINT NULL,
  ADD COLUMN IF NOT EXISTS glpi_user_link_status TEXT NULL,
  ADD COLUMN IF NOT EXISTS glpi_user_link_source TEXT NULL,
  ADD COLUMN IF NOT EXISTS glpi_user_linked_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS glpi_user_created_by_integaglpi BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS glpi_intega_contact_profile_email_idx
  ON public.glpi_plugin_integaglpi_contact_profile (email_address)
  WHERE email_address IS NOT NULL;

ALTER TABLE public.glpi_plugin_integaglpi_solution_actions
  ADD COLUMN IF NOT EXISTS csat_rating TEXT NULL,
  ADD COLUMN IF NOT EXISTS supervisor_review_required BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS glpi_intega_solution_actions_csat_idx
  ON public.glpi_plugin_integaglpi_solution_actions (ticket_id, csat_rating)
  WHERE csat_rating IS NOT NULL;
