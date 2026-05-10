-- Queues and routing (aligns with integaglpi ExternalSchemaManager). Safe, additive.

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
