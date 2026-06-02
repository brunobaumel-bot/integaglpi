-- Phase: integaglpi_ai_kb_ecosystem_reengineered_002
-- Additive, idempotent schema for the reengineered AI/KB ecosystem.
-- DO NOT execute automatically — apply manually after human review.
--
-- Covers the persistence gaps identified after the KB Candidate Quality slice:
--   1. First-class, queryable columns on kb_candidates for the new structured
--      fields (currently embedded only in content_markdown).
--   2. kb_article_helpfulness — closed feedback loop ("ajudou / não ajudou").
--   3. cloud_compliance_audit — aggregated, sanitized record of cloud research
--      usage (no raw prompt, no PII, no secrets).
--
-- All statements are additive and idempotent. No DROP / TRUNCATE / DELETE.

-- ── 1. kb_candidates: first-class structured columns ─────────────────────────
-- These mirror data already produced by the generator (and embedded in
-- content_markdown) so they can be filtered / reported on without parsing.

ALTER TABLE IF EXISTS public.glpi_plugin_integaglpi_kb_candidates
  ADD COLUMN IF NOT EXISTS confidence_reason TEXT NULL;

ALTER TABLE IF EXISTS public.glpi_plugin_integaglpi_kb_candidates
  ADD COLUMN IF NOT EXISTS difficulty_level VARCHAR(20) NULL;

ALTER TABLE IF EXISTS public.glpi_plugin_integaglpi_kb_candidates
  ADD COLUMN IF NOT EXISTS target_audience VARCHAR(60) NULL;

-- duplicate_of references another candidate this one likely duplicates (nullable,
-- soft reference — no FK constraint to avoid coupling/ordering issues on import).
ALTER TABLE IF EXISTS public.glpi_plugin_integaglpi_kb_candidates
  ADD COLUMN IF NOT EXISTS duplicate_of BIGINT NULL;

-- cluster_id groups candidates produced from the same problem-signature cluster.
ALTER TABLE IF EXISTS public.glpi_plugin_integaglpi_kb_candidates
  ADD COLUMN IF NOT EXISTS cluster_id BIGINT NULL;

CREATE INDEX IF NOT EXISTS glpi_intega_kb_candidates_cluster_idx
  ON public.glpi_plugin_integaglpi_kb_candidates (cluster_id);

CREATE INDEX IF NOT EXISTS glpi_intega_kb_candidates_duplicate_of_idx
  ON public.glpi_plugin_integaglpi_kb_candidates (duplicate_of);

-- ── 2. kb_article_helpfulness: closed feedback loop ──────────────────────────
-- One row per "ajudou / não ajudou" vote on a KB article or candidate suggestion.
-- Technician id is stored for de-duplication of votes only; reporting is always
-- aggregated and never used to rank/score individuals (no punitive metrics).

CREATE TABLE IF NOT EXISTS public.glpi_plugin_integaglpi_kb_article_helpfulness (
  id                    BIGSERIAL    PRIMARY KEY,
  kb_candidate_id       BIGINT       NULL,        -- internal candidate, if applicable
  glpi_knowbaseitem_id  BIGINT       NULL,        -- native GLPI KB article, if applicable
  glpi_ticket_id        BIGINT       NULL,        -- context ticket
  technician_id         BIGINT       NULL,        -- for vote de-dup only, never ranked
  helpful               BOOLEAN      NOT NULL,
  feedback_text         TEXT         NULL,        -- optional, sanitized note
  source                VARCHAR(40)  NOT NULL DEFAULT 'smart_help',
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  -- A technician may vote once per (article/candidate, ticket); re-votes update.
  CONSTRAINT glpi_intega_kb_helpfulness_uq
    UNIQUE (kb_candidate_id, glpi_knowbaseitem_id, glpi_ticket_id, technician_id)
);

CREATE INDEX IF NOT EXISTS glpi_intega_kb_helpfulness_candidate_idx
  ON public.glpi_plugin_integaglpi_kb_article_helpfulness (kb_candidate_id);

CREATE INDEX IF NOT EXISTS glpi_intega_kb_helpfulness_knowbaseitem_idx
  ON public.glpi_plugin_integaglpi_kb_article_helpfulness (glpi_knowbaseitem_id);

CREATE INDEX IF NOT EXISTS glpi_intega_kb_helpfulness_helpful_idx
  ON public.glpi_plugin_integaglpi_kb_article_helpfulness (helpful);

COMMENT ON TABLE public.glpi_plugin_integaglpi_kb_article_helpfulness IS
  'Closed feedback loop for KB articles/candidates (ajudou/não ajudou). '
  'Aggregated reporting only — never used to rank or evaluate technicians.';

-- ── 3. cloud_compliance_audit: aggregated, sanitized cloud usage ─────────────
-- Records that a cloud research call happened and whether the PII Guard passed.
-- Stores ONLY sanitized summaries — never the raw prompt, never PII, never the
-- model response verbatim beyond a bounded sanitized summary.

CREATE TABLE IF NOT EXISTS public.glpi_plugin_integaglpi_cloud_compliance_audit (
  id                        BIGSERIAL    PRIMARY KEY,
  glpi_ticket_id            BIGINT       NULL,
  glpi_profile_id           BIGINT       NULL,    -- profile, not nominal technician
  category                  VARCHAR(120) NULL,
  provider                  VARCHAR(60)  NULL,
  status                    VARCHAR(40)  NOT NULL DEFAULT 'requested',
  pii_guard_passed          BOOLEAN      NOT NULL DEFAULT FALSE,
  pii_detected_kinds_json   JSONB        NOT NULL DEFAULT '[]'::jsonb,
  request_context_chars     INTEGER      NOT NULL DEFAULT 0,   -- size only, not content
  request_summary_sanitized TEXT         NULL,                  -- bounded, sanitized
  response_summary          TEXT         NULL,                  -- bounded, sanitized
  input_hash                TEXT         NULL,                  -- sha256 of sanitized input
  requested_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  responded_at              TIMESTAMPTZ  NULL,
  created_at                TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS glpi_intega_cloud_audit_requested_at_idx
  ON public.glpi_plugin_integaglpi_cloud_compliance_audit (requested_at DESC);

CREATE INDEX IF NOT EXISTS glpi_intega_cloud_audit_category_idx
  ON public.glpi_plugin_integaglpi_cloud_compliance_audit (category);

CREATE INDEX IF NOT EXISTS glpi_intega_cloud_audit_status_idx
  ON public.glpi_plugin_integaglpi_cloud_compliance_audit (status);

COMMENT ON TABLE public.glpi_plugin_integaglpi_cloud_compliance_audit IS
  'Aggregated, sanitized audit of cloud research usage for supervisor/DPO. '
  'Never stores raw prompt, PII, secrets or verbatim model output.';
