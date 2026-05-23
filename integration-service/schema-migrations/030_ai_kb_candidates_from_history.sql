CREATE TABLE IF NOT EXISTS public.glpi_plugin_integaglpi_kb_candidates (
  id BIGSERIAL PRIMARY KEY,
  candidate_key TEXT UNIQUE NOT NULL,
  input_hash TEXT NOT NULL,
  status TEXT NOT NULL,
  article_type TEXT NOT NULL,
  title TEXT NOT NULL,
  content_markdown TEXT NOT NULL,
  problem_pattern TEXT NULL,
  symptoms_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  probable_cause TEXT NULL,
  recommended_procedure_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  checklist_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  humanized_customer_response TEXT NULL,
  tags_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  category_suggestion TEXT NULL,
  related_native_kb_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  possible_duplicate BOOLEAN NOT NULL DEFAULT FALSE,
  duplicate_reason TEXT NULL,
  source_pattern_ids_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  source_insight_ids_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  evidence_hashes_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  evidence_summary_sanitized TEXT NULL,
  confidence_score INTEGER NOT NULL,
  limitations_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by_glpi_user_id BIGINT NULL,
  reviewed_by_glpi_user_id BIGINT NULL,
  reviewed_at TIMESTAMPTZ NULL,
  review_notes TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT glpi_integaglpi_kb_candidates_status_chk CHECK (
    status IN ('suggested', 'in_review', 'approved', 'rejected', 'low_confidence', 'possible_duplicate')
  ),
  CONSTRAINT glpi_integaglpi_kb_candidates_type_chk CHECK (
    article_type IN (
      'procedimento_tecnico',
      'solucao_comum',
      'resposta_padrao_humanizada',
      'checklist_diagnostico',
      'faq_interno',
      'alerta_operacional',
      'pergunta_inicial_recomendada'
    )
  ),
  CONSTRAINT glpi_integaglpi_kb_candidates_confidence_chk CHECK (confidence_score >= 0 AND confidence_score <= 100)
);

CREATE TABLE IF NOT EXISTS public.glpi_plugin_integaglpi_kb_candidate_reviews (
  id BIGSERIAL PRIMARY KEY,
  candidate_id BIGINT NOT NULL,
  action TEXT NOT NULL,
  reviewer_id BIGINT NULL,
  notes TEXT NULL,
  previous_status TEXT NULL,
  new_status TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT glpi_integaglpi_kb_candidate_reviews_action_chk CHECK (
    action IN ('mark_in_review', 'approve', 'reject', 'edit_note', 'copy_markdown')
  )
);

CREATE INDEX IF NOT EXISTS glpi_integaglpi_kb_candidates_status_idx
  ON public.glpi_plugin_integaglpi_kb_candidates (status, created_at DESC);

CREATE INDEX IF NOT EXISTS glpi_integaglpi_kb_candidates_type_idx
  ON public.glpi_plugin_integaglpi_kb_candidates (article_type, created_at DESC);

CREATE INDEX IF NOT EXISTS glpi_integaglpi_kb_candidates_confidence_idx
  ON public.glpi_plugin_integaglpi_kb_candidates (confidence_score DESC);

CREATE INDEX IF NOT EXISTS glpi_integaglpi_kb_candidates_duplicate_idx
  ON public.glpi_plugin_integaglpi_kb_candidates (possible_duplicate, created_at DESC);

CREATE INDEX IF NOT EXISTS glpi_integaglpi_kb_candidates_input_hash_idx
  ON public.glpi_plugin_integaglpi_kb_candidates (input_hash);

CREATE INDEX IF NOT EXISTS glpi_integaglpi_kb_candidate_reviews_candidate_idx
  ON public.glpi_plugin_integaglpi_kb_candidate_reviews (candidate_id, created_at DESC);
