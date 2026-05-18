CREATE TABLE IF NOT EXISTS public.glpi_plugin_integaglpi_configs (
  id BIGSERIAL PRIMARY KEY,
  context TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.glpi_plugin_integaglpi_configs
  ADD COLUMN IF NOT EXISTS menu_message TEXT NULL,
  ADD COLUMN IF NOT EXISTS invalid_option_message TEXT NULL,
  ADD COLUMN IF NOT EXISTS invalid_media_message TEXT NULL,
  ADD COLUMN IF NOT EXISTS error_fallback_message TEXT NULL,
  ADD COLUMN IF NOT EXISTS ticket_created_message TEXT NULL,
  ADD COLUMN IF NOT EXISTS conversation_closed_message TEXT NULL,
  ADD COLUMN IF NOT EXISTS after_hours_message TEXT NULL,
  ADD COLUMN IF NOT EXISTS contact_profile_collection_enabled TEXT NULL,
  ADD COLUMN IF NOT EXISTS contact_profile_prompt_mode TEXT NULL,
  ADD COLUMN IF NOT EXISTS contact_profile_require_company TEXT NULL,
  ADD COLUMN IF NOT EXISTS contact_profile_require_name TEXT NULL,
  ADD COLUMN IF NOT EXISTS contact_profile_require_equipment TEXT NULL,
  ADD COLUMN IF NOT EXISTS contact_profile_require_summary TEXT NULL,
  ADD COLUMN IF NOT EXISTS contact_profile_confirmation_enabled TEXT NULL,
  ADD COLUMN IF NOT EXISTS contact_profile_use_buttons TEXT NULL,
  ADD COLUMN IF NOT EXISTS ticket_title_enrichment_enabled TEXT NULL,
  ADD COLUMN IF NOT EXISTS contact_profile_prompt_name TEXT NULL,
  ADD COLUMN IF NOT EXISTS contact_profile_prompt_company TEXT NULL,
  ADD COLUMN IF NOT EXISTS contact_profile_prompt_equipment TEXT NULL,
  ADD COLUMN IF NOT EXISTS contact_profile_prompt_summary TEXT NULL,
  ADD COLUMN IF NOT EXISTS contact_profile_confirm_message TEXT NULL,
  ADD COLUMN IF NOT EXISTS profile_initial_prompt TEXT NULL,
  ADD COLUMN IF NOT EXISTS profile_ask_company TEXT NULL,
  ADD COLUMN IF NOT EXISTS profile_ask_name TEXT NULL,
  ADD COLUMN IF NOT EXISTS profile_ask_equipment TEXT NULL,
  ADD COLUMN IF NOT EXISTS profile_ask_summary TEXT NULL,
  ADD COLUMN IF NOT EXISTS profile_confirmation_message TEXT NULL,
  ADD COLUMN IF NOT EXISTS profile_success_message TEXT NULL,
  ADD COLUMN IF NOT EXISTS profile_change_message TEXT NULL,
  ADD COLUMN IF NOT EXISTS profile_partial_continue_message TEXT NULL,
  ADD COLUMN IF NOT EXISTS entity_resolution_mode TEXT NULL,
  ADD COLUMN IF NOT EXISTS default_glpi_entity_id BIGINT NULL,
  ADD COLUMN IF NOT EXISTS triage_entity_id BIGINT NULL,
  ADD COLUMN IF NOT EXISTS entity_selection_timeout_hours INTEGER NULL;

CREATE UNIQUE INDEX IF NOT EXISTS glpi_intega_configs_context_uq
  ON public.glpi_plugin_integaglpi_configs (context);
