-- Fase 8.0D: auditoria operacional best-effort.
CREATE TABLE IF NOT EXISTS public.glpi_plugin_integaglpi_audit_events (
  id BIGSERIAL PRIMARY KEY,
  correlation_id TEXT NULL,
  ticket_id BIGINT NULL,
  conversation_id TEXT NULL,
  message_id TEXT NULL,
  direction TEXT NULL,
  event_type TEXT NOT NULL,
  status TEXT NOT NULL,
  severity TEXT NOT NULL,
  source TEXT NOT NULL,
  payload_json JSONB NULL,
  error_message TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS glpi_intega_audit_created_at_idx
ON public.glpi_plugin_integaglpi_audit_events (created_at);

CREATE INDEX IF NOT EXISTS glpi_intega_audit_correlation_idx
ON public.glpi_plugin_integaglpi_audit_events (correlation_id);

CREATE INDEX IF NOT EXISTS glpi_intega_audit_ticket_idx
ON public.glpi_plugin_integaglpi_audit_events (ticket_id);

CREATE INDEX IF NOT EXISTS glpi_intega_audit_conversation_idx
ON public.glpi_plugin_integaglpi_audit_events (conversation_id);

CREATE INDEX IF NOT EXISTS glpi_intega_audit_message_idx
ON public.glpi_plugin_integaglpi_audit_events (message_id);

CREATE INDEX IF NOT EXISTS glpi_intega_audit_event_created_idx
ON public.glpi_plugin_integaglpi_audit_events (event_type, created_at);

CREATE INDEX IF NOT EXISTS glpi_intega_audit_severity_created_idx
ON public.glpi_plugin_integaglpi_audit_events (severity, created_at);

-- Retencao sugerida: 90 dias. Executar manualmente, por cron externo, ou por comando administrativo futuro.
-- Nao executar automaticamente no startup.
-- DELETE FROM public.glpi_plugin_integaglpi_audit_events
-- WHERE created_at < NOW() - INTERVAL '90 days';
