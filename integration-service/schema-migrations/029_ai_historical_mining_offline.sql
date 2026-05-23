CREATE TABLE IF NOT EXISTS public.glpi_plugin_integaglpi_hist_mining_runs (
  id BIGSERIAL PRIMARY KEY,
  run_id TEXT NOT NULL UNIQUE,
  input_hash TEXT NOT NULL,
  window_start TIMESTAMPTZ NULL,
  window_end TIMESTAMPTZ NULL,
  status TEXT NOT NULL DEFAULT 'completed',
  rows_seen INTEGER NOT NULL DEFAULT 0,
  rows_processed INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ NULL,
  error_sanitized TEXT NULL,
  CONSTRAINT glpi_integaglpi_hist_runs_status_chk CHECK (status IN ('planned', 'running', 'completed', 'failed', 'dry_run'))
);

CREATE TABLE IF NOT EXISTS public.glpi_plugin_integaglpi_hist_patterns (
  id BIGSERIAL PRIMARY KEY,
  run_id TEXT NOT NULL,
  pattern_type TEXT NOT NULL,
  category TEXT NULL,
  entity_label_sanitized TEXT NULL,
  frequency_abs INTEGER NOT NULL DEFAULT 0,
  severity TEXT NOT NULL DEFAULT 'low',
  description_sanitized TEXT NOT NULL,
  evidence_hashes_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT glpi_integaglpi_hist_patterns_severity_chk CHECK (severity IN ('low', 'medium', 'high'))
);

CREATE TABLE IF NOT EXISTS public.glpi_plugin_integaglpi_hist_insights (
  id BIGSERIAL PRIMARY KEY,
  run_id TEXT NOT NULL,
  insight_type TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'low',
  title TEXT NOT NULL,
  summary_sanitized TEXT NOT NULL,
  recommendation_sanitized TEXT NOT NULL,
  confidence_score INTEGER NOT NULL DEFAULT 0,
  filters_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT glpi_integaglpi_hist_insights_priority_chk CHECK (priority IN ('low', 'medium', 'high')),
  CONSTRAINT glpi_integaglpi_hist_insights_confidence_chk CHECK (confidence_score >= 0 AND confidence_score <= 100)
);

CREATE TABLE IF NOT EXISTS public.glpi_plugin_integaglpi_hist_evidence (
  id BIGSERIAL PRIMARY KEY,
  run_id TEXT NOT NULL,
  ticket_id_hash TEXT NOT NULL,
  pattern_id BIGINT NULL,
  insight_id BIGINT NULL,
  anonymized_excerpt TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS glpi_integaglpi_hist_runs_created_idx
  ON public.glpi_plugin_integaglpi_hist_mining_runs (created_at DESC);

CREATE INDEX IF NOT EXISTS glpi_integaglpi_hist_runs_window_idx
  ON public.glpi_plugin_integaglpi_hist_mining_runs (window_start, window_end);

CREATE INDEX IF NOT EXISTS glpi_integaglpi_hist_patterns_run_idx
  ON public.glpi_plugin_integaglpi_hist_patterns (run_id);

CREATE INDEX IF NOT EXISTS glpi_integaglpi_hist_patterns_type_idx
  ON public.glpi_plugin_integaglpi_hist_patterns (pattern_type, created_at DESC);

CREATE INDEX IF NOT EXISTS glpi_integaglpi_hist_insights_run_idx
  ON public.glpi_plugin_integaglpi_hist_insights (run_id);

CREATE INDEX IF NOT EXISTS glpi_integaglpi_hist_insights_type_priority_idx
  ON public.glpi_plugin_integaglpi_hist_insights (insight_type, priority, created_at DESC);

CREATE INDEX IF NOT EXISTS glpi_integaglpi_hist_evidence_run_idx
  ON public.glpi_plugin_integaglpi_hist_evidence (run_id);

CREATE INDEX IF NOT EXISTS glpi_integaglpi_hist_evidence_ticket_idx
  ON public.glpi_plugin_integaglpi_hist_evidence (ticket_id_hash);
