-- Phase: integaglpi_v7_m4_performance_escala_lgpd_001
-- Fix phase: integaglpi_v7_m4_fix_migration_045_runner_compat_001
-- Conservative, idempotent performance-readiness indexes.
-- Runner compatibility: this file intentionally uses only simple
-- CREATE INDEX IF NOT EXISTS statements. Do not add PL/pgSQL DO blocks here;
-- the current migration runner splits SQL by semicolon.
--
-- Do not execute manually in production. Apply only after Cursor review and a
-- human-approved maintenance window.
--
-- Manual homologation command:
--   psql "$DATABASE_URL" -f schema-migrations/045_performance_scale_lgpd_indexes.sql
--
-- Rollback note:
--   These indexes are additive only. If rollback is required, a DBA may remove
--   only the indexes named below after validating query plans and operational
--   impact. This migration intentionally performs no data removal.

CREATE INDEX IF NOT EXISTS idx_messages_conv_created
  ON public.glpi_plugin_integaglpi_messages (conversation_id, created_at DESC);

-- Migration 015 already creates glpi_intega_inactivity_status_updated_idx with
-- this same shape. This duplicate-compatible name is kept for the Macro 4
-- contract and remains idempotent for environments that do not have the older
-- index yet.
CREATE INDEX IF NOT EXISTS idx_inactivity_status_updated
  ON public.glpi_plugin_integaglpi_inactivity_tracking (status, updated_at DESC);

-- The real column in migration 044 is glpi_ticket_id, not ticket_id.
CREATE INDEX IF NOT EXISTS idx_kb_article_helpfulness_ticket
  ON public.glpi_plugin_integaglpi_kb_article_helpfulness (glpi_ticket_id);
