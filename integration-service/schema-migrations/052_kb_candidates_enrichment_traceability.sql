-- 052_kb_candidates_enrichment_traceability.sql
--
-- PHASE: integaglpi_v9_kb_enrichment_and_search_optimization_001 (persistência F5)
-- AUTORIZAÇÃO: operador autorizou explicitamente em 2026-06-10 a migration aditiva
-- e a aplicação real do enriquecimento nos KBs existentes (com backup/rollback).
--
-- Destrava o BLOCK_SCHEMA_REQUIRED do KbEnrichmentService:
--   1. Colunas de rastreabilidade do enriquecimento (aditivas, NULLable).
--   2. structured_draft_json: draft estruturado completo (23 campos) + backup do
--      conteúdo ORIGINAL quando o enriquecimento é aplicado (rollback possível).
--   3. CHECK de status estendido (superset — inclui valores legados observados
--      em runtime como 'candidate' e os novos status de enriquecimento/lacuna).
--
-- Tabela própria da integração — nunca core GLPI. Sem DELETE/TRUNCATE/DROP TABLE.

ALTER TABLE IF EXISTS public.glpi_plugin_integaglpi_kb_candidates
  ADD COLUMN IF NOT EXISTS source_kb_id BIGINT NULL;

ALTER TABLE IF EXISTS public.glpi_plugin_integaglpi_kb_candidates
  ADD COLUMN IF NOT EXISTS original_hash TEXT NULL;

ALTER TABLE IF EXISTS public.glpi_plugin_integaglpi_kb_candidates
  ADD COLUMN IF NOT EXISTS enriched_hash TEXT NULL;

ALTER TABLE IF EXISTS public.glpi_plugin_integaglpi_kb_candidates
  ADD COLUMN IF NOT EXISTS enrichment_version INTEGER NULL;

ALTER TABLE IF EXISTS public.glpi_plugin_integaglpi_kb_candidates
  ADD COLUMN IF NOT EXISTS structured_draft_json JSONB NULL;

ALTER TABLE IF EXISTS public.glpi_plugin_integaglpi_kb_candidates
  ADD COLUMN IF NOT EXISTS enriched_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN public.glpi_plugin_integaglpi_kb_candidates.source_kb_id IS
  'ID do candidato original que originou este draft enriquecido (rastreabilidade F5).';
COMMENT ON COLUMN public.glpi_plugin_integaglpi_kb_candidates.structured_draft_json IS
  'Draft estruturado (23 campos) e/ou backup do conteúdo original pré-enriquecimento (rollback).';

-- Status CHECK estendido. DROP do constraint é necessário (CHECKs não suportam
-- ALTER); recriado como superset com NOT VALID: vale para linhas NOVAS e nunca
-- falha por dados legados existentes (ex.: status 'candidate' já observado em
-- runtime fora do CHECK original) — boot do container permanece seguro.
ALTER TABLE IF EXISTS public.glpi_plugin_integaglpi_kb_candidates
  DROP CONSTRAINT IF EXISTS glpi_integaglpi_kb_candidates_status_chk;

ALTER TABLE IF EXISTS public.glpi_plugin_integaglpi_kb_candidates
  ADD CONSTRAINT glpi_integaglpi_kb_candidates_status_chk CHECK (
    status IN (
      'suggested', 'in_review', 'approved', 'rejected',
      'low_confidence', 'possible_duplicate',
      'candidate',
      'draft_enriched', 'needs_review', 'ready_for_human_review',
      'enriched_applied', 'draft_gap_candidate'
    )
  ) NOT VALID;

CREATE INDEX IF NOT EXISTS glpi_intega_kb_candidates_source_kb_idx
  ON public.glpi_plugin_integaglpi_kb_candidates (source_kb_id)
  WHERE source_kb_id IS NOT NULL;
