-- Migration 050: Add 'candidate' status to KB candidates CHECK constraint
--
-- Context: Enriched JSON importer (integaglpi.kb_bundle.v1.1) uses status='candidate'
-- to flag articles that have been pre-processed but require human review before any
-- promotion to 'suggested', 'in_review', or 'approved'.
--
-- Safety:
--   - Additive only: does not remove any existing valid values
--   - 'candidate' status does NOT grant publish rights; human gate still required
--   - No data mutation: existing rows are unaffected
--
-- PHASE: integaglpi_kb_candidates_enriched_import_001
--
-- HOTFIX 2026-06-10 (integaglpi_v9_kb_enrichment_and_search_optimization_001):
-- Esta migration reexecuta a CADA boot (DROP+ADD idempotente). A versão original
-- recriava o CHECK validando dados existentes e quebrou o boot quando a fase de
-- enriquecimento introduziu novos status (crash loop 23514). A lista abaixo foi
-- alinhada ao superset da 052 e o constraint usa NOT VALID — nunca falha por
-- linha legada; a validação de linhas novas permanece.

BEGIN;

-- Drop old constraint and recreate with the superset (aligned with migration 052)
ALTER TABLE glpi_plugin_integaglpi_kb_candidates
    DROP CONSTRAINT IF EXISTS glpi_integaglpi_kb_candidates_status_chk;

ALTER TABLE glpi_plugin_integaglpi_kb_candidates
    ADD CONSTRAINT glpi_integaglpi_kb_candidates_status_chk
    CHECK (status = ANY (ARRAY[
        'candidate'::text,
        'suggested'::text,
        'in_review'::text,
        'approved'::text,
        'rejected'::text,
        'low_confidence'::text,
        'possible_duplicate'::text,
        'draft_enriched'::text,
        'needs_review'::text,
        'ready_for_human_review'::text,
        'enriched_applied'::text,
        'draft_gap_candidate'::text
    ])) NOT VALID;

COMMIT;
