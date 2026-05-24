CREATE TABLE IF NOT EXISTS public.glpi_plugin_integaglpi_external_source_catalog (
  id BIGSERIAL PRIMARY KEY,
  source_key TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  url_pattern TEXT NOT NULL,
  source_type TEXT NOT NULL,
  official_flag BOOLEAN NOT NULL DEFAULT false,
  priority INTEGER NOT NULL DEFAULT 100,
  confidence_boost INTEGER NOT NULL DEFAULT 0,
  enabled BOOLEAN NOT NULL DEFAULT true,
  requires_verification BOOLEAN NOT NULL DEFAULT true,
  language TEXT NOT NULL DEFAULT 'pt-BR',
  last_checked_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT glpi_integaglpi_ext_source_type_chk CHECK (
    source_type IN ('official_docs', 'vendor_docs', 'low_confidence', 'internal_manual')
  )
);

CREATE TABLE IF NOT EXISTS public.glpi_plugin_integaglpi_external_research_requests (
  id BIGSERIAL PRIMARY KEY,
  request_id TEXT UNIQUE NOT NULL,
  requested_by_glpi_user_id BIGINT NULL,
  sanitized_prompt_hash TEXT NOT NULL,
  anonymized_payload_hash TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'disabled',
  cloud_used BOOLEAN NOT NULL DEFAULT false,
  estimated_cost NUMERIC(12, 6) NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  blocked_reason TEXT NULL,
  confidence_score INTEGER NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT glpi_integaglpi_ext_request_status_chk CHECK (
    status IN ('previewed', 'blocked_pii', 'blocked_source', 'blocked_budget', 'completed', 'candidate_created', 'incident_reported')
  )
);

CREATE TABLE IF NOT EXISTS public.glpi_plugin_integaglpi_external_research_results (
  id BIGSERIAL PRIMARY KEY,
  request_id TEXT NOT NULL,
  source_catalog_id BIGINT NOT NULL,
  source_url TEXT NOT NULL,
  source_title TEXT NOT NULL,
  source_type TEXT NOT NULL,
  official_flag BOOLEAN NOT NULL DEFAULT false,
  confidence_score INTEGER NOT NULL,
  excerpt_sanitized TEXT NOT NULL,
  source_conflicts_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  last_verified_date DATE NOT NULL,
  next_review_due DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT glpi_integaglpi_ext_result_confidence_chk CHECK (confidence_score >= 0 AND confidence_score <= 100)
);

CREATE TABLE IF NOT EXISTS public.glpi_plugin_integaglpi_external_research_candidates (
  id BIGSERIAL PRIMARY KEY,
  candidate_id TEXT UNIQUE NOT NULL,
  request_id TEXT NOT NULL,
  status TEXT NOT NULL,
  title TEXT NOT NULL,
  problem_signature TEXT NOT NULL,
  sanitized_symptoms TEXT NOT NULL,
  likely_category TEXT NULL,
  proposed_solution TEXT NOT NULL,
  step_by_step_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  validation_steps_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  risks_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  prerequisites_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  external_sources_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  source_conflicts_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  confidence_score INTEGER NOT NULL,
  source_confidence_level TEXT NOT NULL,
  low_confidence_reason TEXT NULL,
  last_verified_date DATE NOT NULL,
  next_review_due DATE NOT NULL,
  humanized_customer_explanation TEXT NOT NULL,
  suggested_kb_article_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  content_markdown TEXT NOT NULL,
  source_catalog_ids_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  anonymized_payload_hash TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  human_review_required BOOLEAN NOT NULL DEFAULT true,
  auto_publish BOOLEAN NOT NULL DEFAULT false,
  created_by_glpi_user_id BIGINT NULL,
  reviewed_by_glpi_user_id BIGINT NULL,
  reviewed_at TIMESTAMPTZ NULL,
  review_notes_sanitized TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT glpi_integaglpi_ext_candidate_status_chk CHECK (
    status IN ('suggested', 'suggested_low_confidence', 'draft', 'in_review', 'approved_for_manual_publish', 'rejected', 'archived')
  ),
  CONSTRAINT glpi_integaglpi_ext_candidate_confidence_chk CHECK (confidence_score >= 0 AND confidence_score <= 100),
  CONSTRAINT glpi_integaglpi_ext_candidate_manual_chk CHECK (auto_publish = false AND human_review_required = true)
);

CREATE TABLE IF NOT EXISTS public.glpi_plugin_integaglpi_external_research_reviews (
  id BIGSERIAL PRIMARY KEY,
  request_id TEXT NOT NULL,
  candidate_id TEXT NULL,
  reviewer_id BIGINT NULL,
  action TEXT NOT NULL,
  notes_sanitized TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT glpi_integaglpi_ext_review_action_chk CHECK (
    action IN ('reviewed', 'approved_for_manual_publish', 'rejected', 'markdown_copied', 'incident_reported')
  )
);

CREATE INDEX IF NOT EXISTS glpi_integaglpi_ext_source_enabled_idx
  ON public.glpi_plugin_integaglpi_external_source_catalog (enabled, priority, id);

CREATE INDEX IF NOT EXISTS glpi_integaglpi_ext_request_created_idx
  ON public.glpi_plugin_integaglpi_external_research_requests (created_at DESC);

CREATE INDEX IF NOT EXISTS glpi_integaglpi_ext_result_request_idx
  ON public.glpi_plugin_integaglpi_external_research_results (request_id, confidence_score DESC);

CREATE INDEX IF NOT EXISTS glpi_integaglpi_ext_candidate_status_idx
  ON public.glpi_plugin_integaglpi_external_research_candidates (status, created_at DESC);

CREATE INDEX IF NOT EXISTS glpi_integaglpi_ext_candidate_confidence_idx
  ON public.glpi_plugin_integaglpi_external_research_candidates (confidence_score DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS glpi_integaglpi_ext_review_request_idx
  ON public.glpi_plugin_integaglpi_external_research_reviews (request_id, created_at DESC);

INSERT INTO public.glpi_plugin_integaglpi_external_source_catalog (
  source_key,
  name,
  url_pattern,
  source_type,
  official_flag,
  priority,
  confidence_boost,
  enabled,
  requires_verification,
  language
) VALUES
  ('microsoft_learn', 'Microsoft Learn', '*.microsoft.com', 'official_docs', true, 10, 20, true, true, 'pt-BR'),
  ('glpi_docs', 'GLPI Docs', '*.glpi-project.org', 'official_docs', true, 10, 20, true, true, 'en'),
  ('meta_whatsapp_docs', 'Meta WhatsApp Cloud API Docs', '*.facebook.com', 'official_docs', true, 20, 15, true, true, 'en'),
  ('docker_docs', 'Docker Docs', '*.docker.com', 'official_docs', true, 20, 15, true, true, 'en'),
  ('postgresql_docs', 'PostgreSQL Docs', '*.postgresql.org', 'official_docs', true, 20, 15, true, true, 'en'),
  ('redis_docs', 'Redis Docs', '*.redis.io', 'official_docs', true, 30, 12, true, true, 'en'),
  ('nodejs_docs', 'Node.js Docs', '*.nodejs.org', 'official_docs', true, 30, 12, true, true, 'en'),
  ('ubuntu_docs', 'Ubuntu Docs', '*.ubuntu.com', 'official_docs', true, 30, 12, true, true, 'en')
ON CONFLICT (source_key) DO UPDATE SET
  name = EXCLUDED.name,
  url_pattern = EXCLUDED.url_pattern,
  source_type = EXCLUDED.source_type,
  official_flag = EXCLUDED.official_flag,
  priority = EXCLUDED.priority,
  confidence_boost = EXCLUDED.confidence_boost,
  enabled = EXCLUDED.enabled,
  requires_verification = EXCLUDED.requires_verification,
  language = EXCLUDED.language,
  updated_at = NOW();
