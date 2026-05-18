ALTER TABLE public.glpi_plugin_integaglpi_conversations
  ADD COLUMN IF NOT EXISTS profile_collection_state JSONB NOT NULL DEFAULT '{}'::jsonb;
