CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS glpi_plugin_integaglpi_contacts (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  phone_e164 TEXT NOT NULL,
  glpi_contact_id BIGINT,
  glpi_user_id BIGINT,
  name TEXT,
  source TEXT NOT NULL,
  cache_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS glpi_intega_contacts_phone_e164_uq
ON glpi_plugin_integaglpi_contacts (phone_e164);

CREATE TABLE IF NOT EXISTS glpi_plugin_integaglpi_conversations (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  phone_e164 TEXT NOT NULL,
  contact_id TEXT NOT NULL,
  glpi_ticket_id BIGINT,
  status TEXT NOT NULL,
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS glpi_intega_conv_contact_id_idx
ON glpi_plugin_integaglpi_conversations (contact_id);

CREATE INDEX IF NOT EXISTS glpi_intega_conv_glpi_ticket_id_idx
ON glpi_plugin_integaglpi_conversations (glpi_ticket_id);

CREATE INDEX IF NOT EXISTS glpi_intega_conv_phone_status_idx
ON glpi_plugin_integaglpi_conversations (phone_e164, status, last_message_at DESC);

CREATE TABLE IF NOT EXISTS glpi_plugin_integaglpi_messages (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  conversation_id TEXT,
  message_id TEXT NOT NULL,
  direction TEXT NOT NULL,
  sender_phone TEXT NOT NULL,
  recipient_phone TEXT NOT NULL,
  message_type TEXT NOT NULL,
  message_text TEXT,
  raw_payload JSONB NOT NULL,
  media_info JSONB,
  processing_status TEXT NOT NULL,
  glpi_sync_status TEXT NOT NULL,
  idempotency_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS glpi_intega_messages_message_id_uq
ON glpi_plugin_integaglpi_messages (message_id);

CREATE INDEX IF NOT EXISTS glpi_intega_messages_conversation_id_idx
ON glpi_plugin_integaglpi_messages (conversation_id);

CREATE UNIQUE INDEX IF NOT EXISTS glpi_intega_messages_idempotency_idx
ON glpi_plugin_integaglpi_messages (idempotency_key)
WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_glpi_plugin_integaglpi_messages_media_status
ON public.glpi_plugin_integaglpi_messages ((media_info->>'status'));

CREATE TABLE IF NOT EXISTS glpi_plugin_integaglpi_queues (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  default_group_id BIGINT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS glpi_intega_queues_active_idx
ON glpi_plugin_integaglpi_queues (is_active, name);

CREATE TABLE IF NOT EXISTS glpi_plugin_integaglpi_routing_options (
  id BIGSERIAL PRIMARY KEY,
  option_key TEXT NOT NULL,
  label TEXT NOT NULL,
  queue_id BIGINT NULL REFERENCES glpi_plugin_integaglpi_queues (id) ON DELETE SET NULL,
  glpi_group_id BIGINT NULL,
  glpi_user_id BIGINT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INT NOT NULL DEFAULT 0,
  confirmation_message TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT glpi_intega_routing_options_key_uq UNIQUE (option_key)
);

CREATE INDEX IF NOT EXISTS glpi_intega_routing_options_active_sort_idx
ON glpi_plugin_integaglpi_routing_options (is_active, sort_order, label);

ALTER TABLE glpi_plugin_integaglpi_conversations
ADD COLUMN IF NOT EXISTS queue_id BIGINT NULL REFERENCES glpi_plugin_integaglpi_queues (id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS glpi_plugin_integaglpi_webhook_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  signature_valid BOOLEAN NOT NULL DEFAULT false,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processing_status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS glpi_intega_webhook_processing_status_idx
ON glpi_plugin_integaglpi_webhook_events (processing_status);

CREATE INDEX IF NOT EXISTS glpi_intega_webhook_received_at_idx
ON glpi_plugin_integaglpi_webhook_events (received_at);

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
