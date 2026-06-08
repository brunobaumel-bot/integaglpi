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

BEGIN;

-- Drop old constraint and recreate with 'candidate' added
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
        'possible_duplicate'::text
    ]));

COMMIT;
