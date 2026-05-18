CREATE TABLE IF NOT EXISTS public.glpi_plugin_integaglpi_ai_quality_analyses (
  id BIGSERIAL PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  glpi_ticket_id BIGINT NOT NULL,
  analysis_version TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  classification_resolution TEXT NULL,
  sentiment TEXT NULL,
  flags JSONB NOT NULL DEFAULT '[]'::jsonb,
  summary TEXT NULL,
  recommendation TEXT NULL,
  result_json JSONB NULL,
  supervisor_feedback TEXT NULL,
  feedback_notes TEXT NULL,
  created_by BIGINT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT glpi_intega_ai_quality_status_ck
    CHECK (status IN ('pending', 'completed', 'failed', 'skipped')),
  CONSTRAINT glpi_intega_ai_quality_resolution_ck
    CHECK (
      classification_resolution IS NULL
      OR classification_resolution IN ('resolved', 'probably_resolved', 'uncertain', 'probably_not_resolved')
    ),
  CONSTRAINT glpi_intega_ai_quality_sentiment_ck
    CHECK (
      sentiment IS NULL
      OR sentiment IN ('satisfied', 'neutral', 'dissatisfied', 'high_risk')
    ),
  CONSTRAINT glpi_intega_ai_quality_feedback_ck
    CHECK (
      supervisor_feedback IS NULL
      OR supervisor_feedback IN ('useful', 'not_useful', 'incorrect')
    )
);

CREATE INDEX IF NOT EXISTS glpi_intega_ai_quality_conversation_created_idx
  ON public.glpi_plugin_integaglpi_ai_quality_analyses (conversation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS glpi_intega_ai_quality_ticket_created_idx
  ON public.glpi_plugin_integaglpi_ai_quality_analyses (glpi_ticket_id, created_at DESC);

CREATE INDEX IF NOT EXISTS glpi_intega_ai_quality_status_created_idx
  ON public.glpi_plugin_integaglpi_ai_quality_analyses (status, created_at DESC);
