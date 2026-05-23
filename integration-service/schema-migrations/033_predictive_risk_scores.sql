CREATE TABLE IF NOT EXISTS public.glpi_plugin_integaglpi_risk_scores (
  id BIGSERIAL PRIMARY KEY,
  score_id TEXT UNIQUE NOT NULL,
  conversation_id TEXT NULL,
  glpi_ticket_id BIGINT NULL,
  model_version TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  reopen_risk TEXT NOT NULL,
  dissatisfaction_risk TEXT NOT NULL,
  abandonment_risk TEXT NOT NULL,
  risk_score INTEGER NOT NULL,
  confidence_score INTEGER NOT NULL,
  reasons_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  suggested_human_action TEXT NOT NULL,
  signals_used_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  data_quality_warnings_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT glpi_integaglpi_risk_scores_reopen_chk CHECK (reopen_risk IN ('low', 'medium', 'high', 'unknown')),
  CONSTRAINT glpi_integaglpi_risk_scores_dissatisfaction_chk CHECK (dissatisfaction_risk IN ('low', 'medium', 'high', 'unknown')),
  CONSTRAINT glpi_integaglpi_risk_scores_abandonment_chk CHECK (abandonment_risk IN ('low', 'medium', 'high', 'unknown')),
  CONSTRAINT glpi_integaglpi_risk_scores_score_chk CHECK (risk_score >= 0 AND risk_score <= 100),
  CONSTRAINT glpi_integaglpi_risk_scores_confidence_chk CHECK (confidence_score >= 0 AND confidence_score <= 100)
);

CREATE TABLE IF NOT EXISTS public.glpi_plugin_integaglpi_risk_score_feedback (
  id BIGSERIAL PRIMARY KEY,
  score_id TEXT NOT NULL,
  glpi_user_id BIGINT NULL,
  feedback_rating TEXT NOT NULL,
  feedback_notes_sanitized TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT glpi_integaglpi_risk_score_feedback_rating_chk CHECK (feedback_rating IN ('useful', 'incorrect', 'unsure'))
);

CREATE INDEX IF NOT EXISTS glpi_integaglpi_risk_scores_ticket_created_idx
  ON public.glpi_plugin_integaglpi_risk_scores (glpi_ticket_id, created_at DESC);

CREATE INDEX IF NOT EXISTS glpi_integaglpi_risk_scores_conversation_created_idx
  ON public.glpi_plugin_integaglpi_risk_scores (conversation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS glpi_integaglpi_risk_scores_score_idx
  ON public.glpi_plugin_integaglpi_risk_scores (risk_score DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS glpi_integaglpi_risk_scores_reopen_idx
  ON public.glpi_plugin_integaglpi_risk_scores (reopen_risk, created_at DESC);

CREATE INDEX IF NOT EXISTS glpi_integaglpi_risk_scores_dissatisfaction_idx
  ON public.glpi_plugin_integaglpi_risk_scores (dissatisfaction_risk, created_at DESC);

CREATE INDEX IF NOT EXISTS glpi_integaglpi_risk_scores_abandonment_idx
  ON public.glpi_plugin_integaglpi_risk_scores (abandonment_risk, created_at DESC);

CREATE INDEX IF NOT EXISTS glpi_integaglpi_risk_score_feedback_score_idx
  ON public.glpi_plugin_integaglpi_risk_score_feedback (score_id, created_at DESC);
