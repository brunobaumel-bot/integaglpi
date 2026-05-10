-- Fase 8.6B1: auditoria/idempotencia forte para aprovar/reabrir solucao via WhatsApp.
CREATE TABLE IF NOT EXISTS public.glpi_plugin_integaglpi_solution_actions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  action_key TEXT NOT NULL,
  whatsapp_message_id TEXT NOT NULL,
  ticket_id BIGINT NOT NULL,
  conversation_id TEXT NOT NULL,
  phone_e164 TEXT NOT NULL,
  action TEXT NOT NULL,
  status TEXT NOT NULL,
  previous_ticket_status INTEGER NULL,
  final_ticket_status INTEGER NULL,
  error_code TEXT NULL,
  error_message TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT glpi_intega_solution_actions_action_chk CHECK (action IN ('approve', 'reopen')),
  CONSTRAINT glpi_intega_solution_actions_status_chk CHECK (status IN ('processing', 'success', 'error', 'ignored'))
);

CREATE UNIQUE INDEX IF NOT EXISTS glpi_intega_solution_actions_msg_uq
ON glpi_plugin_integaglpi_solution_actions (whatsapp_message_id);

CREATE INDEX IF NOT EXISTS glpi_intega_solution_actions_ticket_idx
ON glpi_plugin_integaglpi_solution_actions (ticket_id);

CREATE INDEX IF NOT EXISTS glpi_intega_solution_actions_conversation_idx
ON glpi_plugin_integaglpi_solution_actions (conversation_id);

CREATE INDEX IF NOT EXISTS glpi_intega_solution_actions_key_idx
ON glpi_plugin_integaglpi_solution_actions (action_key);
