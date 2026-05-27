-- 041_ai_online_supervisor_alerts.sql
-- Alertas supervisórios read-only da IA Observadora Online.
-- Aditiva, idempotente e sem SQL destrutivo.

CREATE TABLE IF NOT EXISTS public.glpi_plugin_integaglpi_ai_online_alerts (
  id BIGSERIAL PRIMARY KEY,
  alert_id TEXT NOT NULL UNIQUE,
  conversation_id TEXT NOT NULL,
  glpi_ticket_id BIGINT NULL,
  queue_id BIGINT NULL,
  technician_id BIGINT NULL,
  entity_id BIGINT NULL,
  alert_type TEXT NOT NULL,
  severity TEXT NOT NULL,
  confidence_score INTEGER NOT NULL,
  evidence_summary_sanitized TEXT NOT NULL,
  recommended_human_action TEXT NOT NULL,
  source_signals_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'open',
  dismissed_until TIMESTAMPTZ NULL,
  reviewed_by BIGINT NULL,
  reviewed_at TIMESTAMPTZ NULL,
  feedback_value TEXT NULL,
  feedback_notes_sanitized TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.glpi_plugin_integaglpi_ai_online_alerts
  DROP CONSTRAINT IF EXISTS glpi_intega_ai_online_alert_status_ck;

ALTER TABLE public.glpi_plugin_integaglpi_ai_online_alerts
  ADD CONSTRAINT glpi_intega_ai_online_alert_status_ck CHECK (
    status IN ('open', 'reviewed', 'dismissed', 'false_positive', 'resolved')
  );

ALTER TABLE public.glpi_plugin_integaglpi_ai_online_alerts
  DROP CONSTRAINT IF EXISTS glpi_intega_ai_online_alert_severity_ck;

ALTER TABLE public.glpi_plugin_integaglpi_ai_online_alerts
  ADD CONSTRAINT glpi_intega_ai_online_alert_severity_ck CHECK (
    severity IN ('low', 'medium', 'high')
  );

ALTER TABLE public.glpi_plugin_integaglpi_ai_online_alerts
  DROP CONSTRAINT IF EXISTS glpi_intega_ai_online_alert_confidence_ck;

ALTER TABLE public.glpi_plugin_integaglpi_ai_online_alerts
  ADD CONSTRAINT glpi_intega_ai_online_alert_confidence_ck CHECK (
    confidence_score BETWEEN 0 AND 100
  );

CREATE INDEX IF NOT EXISTS glpi_intega_ai_online_alert_conversation_status_idx
  ON public.glpi_plugin_integaglpi_ai_online_alerts (conversation_id, status);

CREATE INDEX IF NOT EXISTS glpi_intega_ai_online_alert_status_created_idx
  ON public.glpi_plugin_integaglpi_ai_online_alerts (status, created_at DESC);

CREATE INDEX IF NOT EXISTS glpi_intega_ai_online_alert_severity_status_idx
  ON public.glpi_plugin_integaglpi_ai_online_alerts (severity, status);

CREATE INDEX IF NOT EXISTS glpi_intega_ai_online_alert_queue_status_idx
  ON public.glpi_plugin_integaglpi_ai_online_alerts (queue_id, status);

CREATE INDEX IF NOT EXISTS glpi_intega_ai_online_alert_technician_status_idx
  ON public.glpi_plugin_integaglpi_ai_online_alerts (technician_id, status);
