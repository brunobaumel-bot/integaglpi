CREATE TABLE IF NOT EXISTS public.glpi_plugin_integaglpi_external_help_history (
  id BIGSERIAL PRIMARY KEY,
  ticket_id BIGINT NOT NULL,
  conversation_id TEXT NULL,
  context_hash TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'disabled',
  model TEXT NOT NULL DEFAULT '',
  source_type TEXT NOT NULL DEFAULT 'external_ai_no_sources',
  confidence_label TEXT NOT NULL DEFAULT 'baixa',
  status TEXT NOT NULL DEFAULT 'completed',
  diagnostic_hypothesis TEXT NOT NULL,
  customer_questions_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  technical_steps_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  commands_or_checks_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  cautions_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  references_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  sanitized_context_hash TEXT NOT NULL,
  pii_detected BOOLEAN NOT NULL DEFAULT FALSE,
  human_review_required BOOLEAN NOT NULL DEFAULT TRUE,
  created_by BIGINT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT glpi_integaglpi_external_help_history_human_review_chk CHECK (human_review_required = TRUE)
);

CREATE INDEX IF NOT EXISTS glpi_integaglpi_external_help_history_ticket_idx
  ON public.glpi_plugin_integaglpi_external_help_history (ticket_id, created_at DESC);

CREATE INDEX IF NOT EXISTS glpi_integaglpi_external_help_history_conversation_idx
  ON public.glpi_plugin_integaglpi_external_help_history (conversation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS glpi_integaglpi_external_help_history_context_idx
  ON public.glpi_plugin_integaglpi_external_help_history (context_hash, created_at DESC);

ALTER TABLE IF EXISTS public.glpi_plugin_integaglpi_kb_candidates
  ADD COLUMN IF NOT EXISTS source_external_history_id BIGINT NULL;

ALTER TABLE IF EXISTS public.glpi_plugin_integaglpi_kb_candidates
  ADD COLUMN IF NOT EXISTS glpi_ticket_id BIGINT NULL;

ALTER TABLE IF EXISTS public.glpi_plugin_integaglpi_kb_candidates
  ADD COLUMN IF NOT EXISTS glpi_category_id BIGINT NULL;

ALTER TABLE IF EXISTS public.glpi_plugin_integaglpi_kb_candidates
  ADD COLUMN IF NOT EXISTS glpi_category_name TEXT NULL;

CREATE INDEX IF NOT EXISTS glpi_integaglpi_kb_candidates_external_history_idx
  ON public.glpi_plugin_integaglpi_kb_candidates (source_external_history_id);

CREATE INDEX IF NOT EXISTS glpi_integaglpi_kb_candidates_ticket_category_idx
  ON public.glpi_plugin_integaglpi_kb_candidates (glpi_ticket_id, glpi_category_id);
