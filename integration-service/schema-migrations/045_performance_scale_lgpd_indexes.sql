-- Phase: integaglpi_v7_m4_performance_escala_lgpd_001
-- Conservative, idempotent performance-readiness indexes.
-- Do not execute automatically in production; apply manually after Cursor review
-- and a human-approved maintenance window.
--
-- Manual homologation command:
--   psql "$DATABASE_URL" -f schema-migrations/045_performance_scale_lgpd_indexes.sql
--
-- Rollback note:
--   These indexes are additive only. If rollback is required, a DBA may remove
--   only the indexes named below after validating query plans and operational
--   impact. This migration intentionally performs no data removal.

DO $$
BEGIN
  IF to_regclass('public.glpi_plugin_integaglpi_messages') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM pg_indexes
       WHERE schemaname = 'public'
         AND tablename = 'glpi_plugin_integaglpi_messages'
         AND (
           indexname = 'idx_messages_conv_created'
           OR indexdef ILIKE '%(conversation_id, created_at DESC%'
         )
     ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_messages_conv_created ON public.glpi_plugin_integaglpi_messages (conversation_id, created_at DESC)';
  END IF;

  IF to_regclass('public.glpi_plugin_integaglpi_inactivity_tracking') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM pg_indexes
       WHERE schemaname = 'public'
         AND tablename = 'glpi_plugin_integaglpi_inactivity_tracking'
         AND (
           indexname IN ('glpi_intega_inactivity_status_updated_idx', 'idx_inactivity_status_updated')
           OR indexdef ILIKE '%(status, updated_at DESC%'
         )
     ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_inactivity_status_updated ON public.glpi_plugin_integaglpi_inactivity_tracking (status, updated_at DESC)';
  END IF;

  IF to_regclass('public.glpi_plugin_integaglpi_kb_article_helpfulness') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM pg_indexes
       WHERE schemaname = 'public'
         AND tablename = 'glpi_plugin_integaglpi_kb_article_helpfulness'
         AND (
           indexname = 'idx_kb_article_helpfulness_ticket'
           OR indexdef ILIKE '%(glpi_ticket_id%'
         )
     ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_kb_article_helpfulness_ticket ON public.glpi_plugin_integaglpi_kb_article_helpfulness (glpi_ticket_id)';
  END IF;
END $$;
