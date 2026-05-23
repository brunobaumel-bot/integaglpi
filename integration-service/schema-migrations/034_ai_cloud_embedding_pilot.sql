CREATE TABLE IF NOT EXISTS public.glpi_plugin_integaglpi_ai_pilot_usage (
  id BIGSERIAL PRIMARY KEY,
  request_id TEXT UNIQUE NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  operation_type TEXT NOT NULL,
  status TEXT NOT NULL,
  estimated_cost NUMERIC(12, 6) NOT NULL DEFAULT 0,
  actual_cost NUMERIC(12, 6) NULL,
  input_hash TEXT NOT NULL,
  anonymized_payload_hash TEXT NOT NULL,
  blocked_reason TEXT NULL,
  latency_ms INTEGER NULL,
  requested_by_glpi_user_id BIGINT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT glpi_integaglpi_ai_pilot_usage_provider_chk CHECK (provider IN ('disabled', 'local', 'cloud')),
  CONSTRAINT glpi_integaglpi_ai_pilot_usage_operation_chk CHECK (
    operation_type IN ('synthetic_test', 'cloud_llm', 'embedding_index', 'embedding_search')
  ),
  CONSTRAINT glpi_integaglpi_ai_pilot_usage_status_chk CHECK (
    status IN ('disabled', 'blocked', 'completed', 'failed', 'fallback_local')
  )
);

CREATE TABLE IF NOT EXISTS public.glpi_plugin_integaglpi_ai_pilot_embeddings (
  id BIGSERIAL PRIMARY KEY,
  source_type TEXT NOT NULL,
  source_id_hash TEXT NOT NULL,
  source_version TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  embedding_model TEXT NOT NULL,
  embedding_provider TEXT NOT NULL,
  sanitized_payload_hash TEXT NOT NULL,
  vector_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT glpi_integaglpi_ai_pilot_embeddings_source_chk CHECK (
    source_type IN ('native_kb', 'kb_candidate', 'historical_insight', 'synthetic')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS glpi_integaglpi_ai_pilot_embeddings_source_uq
  ON public.glpi_plugin_integaglpi_ai_pilot_embeddings (source_type, source_id_hash, source_version, content_hash);

CREATE INDEX IF NOT EXISTS glpi_integaglpi_ai_pilot_usage_created_idx
  ON public.glpi_plugin_integaglpi_ai_pilot_usage (created_at DESC);

CREATE INDEX IF NOT EXISTS glpi_integaglpi_ai_pilot_usage_provider_idx
  ON public.glpi_plugin_integaglpi_ai_pilot_usage (provider, created_at DESC);

CREATE INDEX IF NOT EXISTS glpi_integaglpi_ai_pilot_usage_status_idx
  ON public.glpi_plugin_integaglpi_ai_pilot_usage (status, created_at DESC);

CREATE INDEX IF NOT EXISTS glpi_integaglpi_ai_pilot_embeddings_source_idx
  ON public.glpi_plugin_integaglpi_ai_pilot_embeddings (source_type, created_at DESC);
