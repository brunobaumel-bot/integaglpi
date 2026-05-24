CREATE INDEX IF NOT EXISTS glpi_integaglpi_ai_quality_created_at_idx
  ON public.glpi_plugin_integaglpi_ai_quality_analyses (created_at DESC);

CREATE INDEX IF NOT EXISTS glpi_integaglpi_hist_mining_runs_created_at_idx
  ON public.glpi_plugin_integaglpi_hist_mining_runs (created_at DESC);

CREATE INDEX IF NOT EXISTS glpi_integaglpi_hist_patterns_created_at_idx
  ON public.glpi_plugin_integaglpi_hist_patterns (created_at DESC);

CREATE INDEX IF NOT EXISTS glpi_integaglpi_hist_insights_created_at_idx
  ON public.glpi_plugin_integaglpi_hist_insights (created_at DESC);

CREATE INDEX IF NOT EXISTS glpi_integaglpi_kb_candidates_created_at_idx
  ON public.glpi_plugin_integaglpi_kb_candidates (created_at DESC);

CREATE INDEX IF NOT EXISTS glpi_integaglpi_kb_candidate_reviews_created_at_idx
  ON public.glpi_plugin_integaglpi_kb_candidate_reviews (created_at DESC);

CREATE INDEX IF NOT EXISTS glpi_integaglpi_risk_scores_created_at_idx
  ON public.glpi_plugin_integaglpi_risk_scores (created_at DESC);

CREATE INDEX IF NOT EXISTS glpi_integaglpi_risk_score_feedback_created_at_idx
  ON public.glpi_plugin_integaglpi_risk_score_feedback (created_at DESC);

CREATE INDEX IF NOT EXISTS glpi_integaglpi_ai_pilot_usage_hardening_created_at_idx
  ON public.glpi_plugin_integaglpi_ai_pilot_usage (created_at DESC);

CREATE INDEX IF NOT EXISTS glpi_integaglpi_ai_pilot_embeddings_created_at_idx
  ON public.glpi_plugin_integaglpi_ai_pilot_embeddings (created_at DESC);

CREATE INDEX IF NOT EXISTS glpi_integaglpi_coaching_recommendations_created_at_idx
  ON public.glpi_plugin_integaglpi_coaching_recommendations (created_at DESC);

CREATE INDEX IF NOT EXISTS glpi_integaglpi_coaching_feedback_created_at_idx
  ON public.glpi_plugin_integaglpi_coaching_feedback (created_at DESC);

CREATE INDEX IF NOT EXISTS glpi_integaglpi_external_research_requests_created_at_idx
  ON public.glpi_plugin_integaglpi_external_research_requests (created_at DESC);

CREATE INDEX IF NOT EXISTS glpi_integaglpi_external_research_results_created_at_idx
  ON public.glpi_plugin_integaglpi_external_research_results (created_at DESC);

CREATE INDEX IF NOT EXISTS glpi_integaglpi_external_research_candidates_created_at_idx
  ON public.glpi_plugin_integaglpi_external_research_candidates (created_at DESC);

CREATE INDEX IF NOT EXISTS glpi_integaglpi_external_research_reviews_created_at_idx
  ON public.glpi_plugin_integaglpi_external_research_reviews (created_at DESC);

CREATE INDEX IF NOT EXISTS glpi_intega_audit_created_at_idx
  ON public.glpi_plugin_integaglpi_audit_events (created_at DESC);
