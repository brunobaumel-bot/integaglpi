-- Outbound idempotency (safe, additive). Run after init-db.sql.
ALTER TABLE glpi_plugin_integaglpi_messages ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS glpi_intega_messages_idempotency_idx
ON glpi_plugin_integaglpi_messages (idempotency_key)
WHERE idempotency_key IS NOT NULL;
