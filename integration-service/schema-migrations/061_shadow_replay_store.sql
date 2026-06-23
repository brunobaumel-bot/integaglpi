-- V10 Shadow Replay Lab G3 - Shadow Store contract schema.
-- Additive, isolated and not applied by this phase.
-- Stores only synthetic references, hashes and sanitized metadata.

CREATE TABLE IF NOT EXISTS public.shadow_replay_runs (
  id BIGSERIAL PRIMARY KEY,
  run_id TEXT NOT NULL,
  run_hash TEXT NOT NULL,
  source_window_hash TEXT NULL,
  status TEXT NOT NULL DEFAULT 'planned',
  dry_run BOOLEAN NOT NULL DEFAULT TRUE,
  hml_only BOOLEAN NOT NULL DEFAULT TRUE,
  outbound_null_enforced BOOLEAN NOT NULL DEFAULT TRUE,
  contract_version TEXT NOT NULL DEFAULT 'g3_shadow_store_v1',
  created_by_ref_hash TEXT NULL,
  started_at TIMESTAMPTZ NULL,
  finished_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sanitized_metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  safety_flags_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT ux_shadow_replay_runs_run_id UNIQUE (run_id),
  CONSTRAINT chk_shadow_replay_runs_status
    CHECK (status IN ('planned', 'running', 'completed', 'failed', 'aborted')),
  CONSTRAINT chk_shadow_replay_runs_run_id
    CHECK (run_id ~ '^[a-z0-9][a-z0-9:_-]{7,127}$'),
  CONSTRAINT chk_shadow_replay_runs_hash
    CHECK (run_hash ~ '^[a-f0-9]{32,128}$'),
  CONSTRAINT chk_shadow_replay_runs_source_window_hash
    CHECK (source_window_hash IS NULL OR source_window_hash ~ '^[a-f0-9]{32,128}$'),
  CONSTRAINT chk_shadow_replay_runs_created_by_ref_hash
    CHECK (created_by_ref_hash IS NULL OR created_by_ref_hash ~ '^[a-f0-9]{32,128}$'),
  CONSTRAINT chk_shadow_replay_runs_metadata_object
    CHECK (jsonb_typeof(sanitized_metadata_json) = 'object'),
  CONSTRAINT chk_shadow_replay_runs_safety_flags_object
    CHECK (jsonb_typeof(safety_flags_json) = 'object')
);

CREATE TABLE IF NOT EXISTS public.shadow_replay_samples (
  id BIGSERIAL PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES public.shadow_replay_runs (run_id),
  sample_id TEXT NOT NULL,
  sample_hash TEXT NOT NULL,
  source_ref_hash TEXT NOT NULL,
  tenant_ref_hash TEXT NULL,
  category_key TEXT NULL,
  sequence_no INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sanitized_input_metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  redaction_summary_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  safety_flags_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT ux_shadow_replay_samples_sample_id UNIQUE (sample_id),
  CONSTRAINT chk_shadow_replay_samples_sample_id
    CHECK (sample_id ~ '^[a-z0-9][a-z0-9:_-]{7,127}$'),
  CONSTRAINT chk_shadow_replay_samples_hash
    CHECK (sample_hash ~ '^[a-f0-9]{32,128}$'),
  CONSTRAINT chk_shadow_replay_samples_source_ref_hash
    CHECK (source_ref_hash ~ '^[a-f0-9]{32,128}$'),
  CONSTRAINT chk_shadow_replay_samples_tenant_ref_hash
    CHECK (tenant_ref_hash IS NULL OR tenant_ref_hash ~ '^[a-f0-9]{32,128}$'),
  CONSTRAINT chk_shadow_replay_samples_sequence_no
    CHECK (sequence_no >= 0),
  CONSTRAINT chk_shadow_replay_samples_input_metadata_object
    CHECK (jsonb_typeof(sanitized_input_metadata_json) = 'object'),
  CONSTRAINT chk_shadow_replay_samples_redaction_summary_object
    CHECK (jsonb_typeof(redaction_summary_json) = 'object'),
  CONSTRAINT chk_shadow_replay_samples_safety_flags_object
    CHECK (jsonb_typeof(safety_flags_json) = 'object')
);

CREATE TABLE IF NOT EXISTS public.shadow_replay_results (
  id BIGSERIAL PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES public.shadow_replay_runs (run_id),
  sample_id TEXT NOT NULL REFERENCES public.shadow_replay_samples (sample_id),
  result_id TEXT NOT NULL,
  result_hash TEXT NOT NULL,
  engine_profile TEXT NOT NULL,
  decision_status TEXT NOT NULL DEFAULT 'not_run',
  confidence_score NUMERIC(5,4) NULL,
  latency_ms INTEGER NULL,
  output_summary_hash TEXT NULL,
  evidence_hash TEXT NULL,
  error_code TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sanitized_output_metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  safety_flags_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT ux_shadow_replay_results_result_id UNIQUE (result_id),
  CONSTRAINT chk_shadow_replay_results_result_id
    CHECK (result_id ~ '^[a-z0-9][a-z0-9:_-]{7,127}$'),
  CONSTRAINT chk_shadow_replay_results_hash
    CHECK (result_hash ~ '^[a-f0-9]{32,128}$'),
  CONSTRAINT chk_shadow_replay_results_decision_status
    CHECK (decision_status IN ('not_run', 'simulated', 'blocked', 'failed')),
  CONSTRAINT chk_shadow_replay_results_confidence
    CHECK (confidence_score IS NULL OR (confidence_score >= 0 AND confidence_score <= 1)),
  CONSTRAINT chk_shadow_replay_results_latency
    CHECK (latency_ms IS NULL OR latency_ms >= 0),
  CONSTRAINT chk_shadow_replay_results_output_summary_hash
    CHECK (output_summary_hash IS NULL OR output_summary_hash ~ '^[a-f0-9]{32,128}$'),
  CONSTRAINT chk_shadow_replay_results_evidence_hash
    CHECK (evidence_hash IS NULL OR evidence_hash ~ '^[a-f0-9]{32,128}$'),
  CONSTRAINT chk_shadow_replay_results_output_metadata_object
    CHECK (jsonb_typeof(sanitized_output_metadata_json) = 'object'),
  CONSTRAINT chk_shadow_replay_results_safety_flags_object
    CHECK (jsonb_typeof(safety_flags_json) = 'object')
);

CREATE TABLE IF NOT EXISTS public.shadow_replay_audit_events (
  id BIGSERIAL PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES public.shadow_replay_runs (run_id),
  sample_id TEXT NULL REFERENCES public.shadow_replay_samples (sample_id),
  event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_hash TEXT NOT NULL,
  actor_ref_hash TEXT NULL,
  severity TEXT NOT NULL DEFAULT 'info',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sanitized_event_metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT ux_shadow_replay_audit_events_event_id UNIQUE (event_id),
  CONSTRAINT chk_shadow_replay_audit_events_event_id
    CHECK (event_id ~ '^[a-z0-9][a-z0-9:_-]{7,127}$'),
  CONSTRAINT chk_shadow_replay_audit_events_type_not_empty
    CHECK (length(btrim(event_type)) > 0),
  CONSTRAINT chk_shadow_replay_audit_events_hash
    CHECK (event_hash ~ '^[a-f0-9]{32,128}$'),
  CONSTRAINT chk_shadow_replay_audit_events_actor_ref_hash
    CHECK (actor_ref_hash IS NULL OR actor_ref_hash ~ '^[a-f0-9]{32,128}$'),
  CONSTRAINT chk_shadow_replay_audit_events_severity
    CHECK (severity IN ('debug', 'info', 'warning', 'error')),
  CONSTRAINT chk_shadow_replay_audit_events_metadata_object
    CHECK (jsonb_typeof(sanitized_event_metadata_json) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_shadow_replay_runs_status_created_at
  ON public.shadow_replay_runs (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_shadow_replay_runs_run_hash
  ON public.shadow_replay_runs (run_hash);

CREATE INDEX IF NOT EXISTS idx_shadow_replay_samples_run_id_sequence
  ON public.shadow_replay_samples (run_id, sequence_no);

CREATE INDEX IF NOT EXISTS idx_shadow_replay_samples_source_ref_hash
  ON public.shadow_replay_samples (source_ref_hash);

CREATE INDEX IF NOT EXISTS idx_shadow_replay_results_run_status
  ON public.shadow_replay_results (run_id, decision_status);

CREATE INDEX IF NOT EXISTS idx_shadow_replay_results_result_hash
  ON public.shadow_replay_results (result_hash);

CREATE INDEX IF NOT EXISTS idx_shadow_replay_audit_events_run_created_at
  ON public.shadow_replay_audit_events (run_id, created_at DESC);

COMMENT ON TABLE public.shadow_replay_runs IS
  'G3 Shadow Store contract table for isolated replay runs. Hash-only references and sanitized metadata.';

COMMENT ON TABLE public.shadow_replay_samples IS
  'G3 Shadow Store contract table for sanitized replay samples. No raw source body is stored.';

COMMENT ON TABLE public.shadow_replay_results IS
  'G3 Shadow Store contract table for simulated replay outcomes. No external action output is stored.';

COMMENT ON TABLE public.shadow_replay_audit_events IS
  'G3 Shadow Store contract table for replay audit metadata. Hash-only actor references.';
