CREATE TABLE IF NOT EXISTS public.glpi_plugin_integaglpi_coaching_recommendations (
  id BIGSERIAL PRIMARY KEY,
  recommendation_id TEXT UNIQUE NOT NULL,
  recommendation_key TEXT UNIQUE NOT NULL,
  scope_type TEXT NOT NULL,
  scope_hash TEXT NOT NULL,
  recommendation_type TEXT NOT NULL,
  title TEXT NOT NULL,
  summary_sanitized TEXT NOT NULL,
  explanation_sanitized TEXT NOT NULL,
  suggested_actions_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  kb_articles_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  onboarding_plan_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  confidence_score INTEGER NOT NULL,
  input_hash TEXT NOT NULL,
  recommendation_version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_by BIGINT NULL,
  dismissed_by BIGINT NULL,
  dismissed_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT glpi_integaglpi_coaching_scope_chk CHECK (
    scope_type IN ('team', 'queue', 'category', 'technician_private', 'entity')
  ),
  CONSTRAINT glpi_integaglpi_coaching_type_chk CHECK (
    recommendation_type IN (
      'onboarding_plan',
      'training_path',
      'kb_study_suggestion',
      'communication_skill',
      'coaching_session_tip',
      'kb_review_recommendation',
      'process_improvement',
      'data_quality_warning'
    )
  ),
  CONSTRAINT glpi_integaglpi_coaching_status_chk CHECK (status IN ('active', 'dismissed', 'archived')),
  CONSTRAINT glpi_integaglpi_coaching_confidence_chk CHECK (confidence_score >= 0 AND confidence_score <= 100)
);

CREATE TABLE IF NOT EXISTS public.glpi_plugin_integaglpi_coaching_feedback (
  id BIGSERIAL PRIMARY KEY,
  recommendation_id TEXT NOT NULL,
  glpi_user_id BIGINT NULL,
  rating TEXT NOT NULL,
  notes_sanitized TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT glpi_integaglpi_coaching_feedback_rating_chk CHECK (
    rating IN ('useful', 'not_useful', 'not_applicable')
  )
);

CREATE INDEX IF NOT EXISTS glpi_integaglpi_coaching_status_idx
  ON public.glpi_plugin_integaglpi_coaching_recommendations (status, created_at DESC);

CREATE INDEX IF NOT EXISTS glpi_integaglpi_coaching_scope_idx
  ON public.glpi_plugin_integaglpi_coaching_recommendations (scope_type, scope_hash, created_at DESC);

CREATE INDEX IF NOT EXISTS glpi_integaglpi_coaching_type_idx
  ON public.glpi_plugin_integaglpi_coaching_recommendations (recommendation_type, created_at DESC);

CREATE INDEX IF NOT EXISTS glpi_integaglpi_coaching_created_idx
  ON public.glpi_plugin_integaglpi_coaching_recommendations (created_at DESC);

CREATE INDEX IF NOT EXISTS glpi_integaglpi_coaching_feedback_rec_idx
  ON public.glpi_plugin_integaglpi_coaching_feedback (recommendation_id, created_at DESC);
