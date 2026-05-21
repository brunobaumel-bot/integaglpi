CREATE TABLE IF NOT EXISTS public.glpi_plugin_integaglpi_service_catalog (
  id BIGSERIAL PRIMARY KEY,
  service_key TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NULL,
  routing_queue_id BIGINT NULL,
  glpi_entity_id BIGINT NULL,
  default_priority TEXT NULL,
  required_fields_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  sla_response_minutes INTEGER NULL,
  sla_solution_minutes INTEGER NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS glpi_integaglpi_service_catalog_key_uq
  ON public.glpi_plugin_integaglpi_service_catalog (service_key);

CREATE INDEX IF NOT EXISTS glpi_integaglpi_service_catalog_queue_entity_idx
  ON public.glpi_plugin_integaglpi_service_catalog (routing_queue_id, glpi_entity_id, is_active);

CREATE INDEX IF NOT EXISTS glpi_integaglpi_service_catalog_active_name_idx
  ON public.glpi_plugin_integaglpi_service_catalog (is_active, name);

CREATE TABLE IF NOT EXISTS public.glpi_plugin_integaglpi_conversation_sla_logs (
  id BIGSERIAL PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  metric_type TEXT NOT NULL,
  target_minutes INTEGER NULL,
  actual_minutes INTEGER NULL,
  breach_status TEXT NOT NULL,
  triggered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  payload_json JSONB NULL
);

CREATE INDEX IF NOT EXISTS glpi_integaglpi_sla_logs_conversation_idx
  ON public.glpi_plugin_integaglpi_conversation_sla_logs (conversation_id, triggered_at DESC);

CREATE INDEX IF NOT EXISTS glpi_integaglpi_sla_logs_metric_idx
  ON public.glpi_plugin_integaglpi_conversation_sla_logs (metric_type, breach_status, triggered_at DESC);

ALTER TABLE public.glpi_plugin_integaglpi_conversations
  ADD COLUMN IF NOT EXISTS glpi_service_catalog_id BIGINT NULL;

ALTER TABLE public.glpi_plugin_integaglpi_conversations
  ADD COLUMN IF NOT EXISTS sla_first_response_at TIMESTAMPTZ NULL;

ALTER TABLE public.glpi_plugin_integaglpi_conversations
  ADD COLUMN IF NOT EXISTS sla_response_deadline TIMESTAMPTZ NULL;

ALTER TABLE public.glpi_plugin_integaglpi_conversations
  ADD COLUMN IF NOT EXISTS sla_resolution_at TIMESTAMPTZ NULL;

ALTER TABLE public.glpi_plugin_integaglpi_conversations
  ADD COLUMN IF NOT EXISTS sla_solution_deadline TIMESTAMPTZ NULL;

ALTER TABLE public.glpi_plugin_integaglpi_conversations
  ADD COLUMN IF NOT EXISTS accumulated_paused_minutes INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.glpi_plugin_integaglpi_conversations
  ADD COLUMN IF NOT EXISTS reopen_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.glpi_plugin_integaglpi_conversations
  ADD COLUMN IF NOT EXISTS reminder_sent BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.glpi_plugin_integaglpi_conversations
  ADD COLUMN IF NOT EXISTS inactivity_skip_reason TEXT NULL;

CREATE INDEX IF NOT EXISTS glpi_integaglpi_conversations_sla_response_idx
  ON public.glpi_plugin_integaglpi_conversations (sla_response_deadline);

CREATE INDEX IF NOT EXISTS glpi_integaglpi_conversations_sla_solution_idx
  ON public.glpi_plugin_integaglpi_conversations (sla_solution_deadline);

CREATE INDEX IF NOT EXISTS glpi_integaglpi_conversations_service_catalog_idx
  ON public.glpi_plugin_integaglpi_conversations (glpi_service_catalog_id);

ALTER TABLE public.glpi_plugin_integaglpi_inactivity_job_events
  ADD COLUMN IF NOT EXISTS reason_code TEXT NULL;

ALTER TABLE public.glpi_plugin_integaglpi_inactivity_job_events
  ADD COLUMN IF NOT EXISTS reason_description TEXT NULL;

CREATE INDEX IF NOT EXISTS glpi_integaglpi_inactivity_job_reason_idx
  ON public.glpi_plugin_integaglpi_inactivity_job_events (conversation_id, status, reason_code, created_at DESC);

ALTER TABLE public.glpi_plugin_integaglpi_configs
  ADD COLUMN IF NOT EXISTS inactivity_enabled TEXT NULL;

ALTER TABLE public.glpi_plugin_integaglpi_configs
  ADD COLUMN IF NOT EXISTS inactivity_reminder_1_minutes INTEGER NULL;

ALTER TABLE public.glpi_plugin_integaglpi_configs
  ADD COLUMN IF NOT EXISTS inactivity_reminder_2_minutes INTEGER NULL;

ALTER TABLE public.glpi_plugin_integaglpi_configs
  ADD COLUMN IF NOT EXISTS inactivity_reminder_3_minutes INTEGER NULL;

ALTER TABLE public.glpi_plugin_integaglpi_configs
  ADD COLUMN IF NOT EXISTS inactivity_autoclose_minutes INTEGER NULL;
