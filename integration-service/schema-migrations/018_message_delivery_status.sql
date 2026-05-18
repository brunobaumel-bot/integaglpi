ALTER TABLE glpi_plugin_integaglpi_messages
  ADD COLUMN IF NOT EXISTS meta_message_id TEXT NULL,
  ADD COLUMN IF NOT EXISTS delivery_status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS delivery_status_updated_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS meta_error_code TEXT NULL,
  ADD COLUMN IF NOT EXISTS meta_error_message_sanitized TEXT NULL;

UPDATE glpi_plugin_integaglpi_messages
SET
  meta_message_id = message_id,
  delivery_status = CASE
    WHEN direction = 'outbound' THEN 'sent'
    ELSE delivery_status
  END,
  delivery_status_updated_at = CASE
    WHEN direction = 'outbound' THEN COALESCE(delivery_status_updated_at, created_at)
    ELSE delivery_status_updated_at
  END
WHERE direction = 'outbound'
  AND (meta_message_id IS NULL OR meta_message_id = '');

CREATE TABLE IF NOT EXISTS glpi_plugin_integaglpi_message_delivery_status (
  id BIGSERIAL PRIMARY KEY,
  local_message_id TEXT NULL,
  meta_message_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'sent', 'delivered', 'read', 'failed')),
  error_code TEXT NULL,
  error_message_sanitized TEXT NULL,
  correlation_id TEXT NULL,
  received_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS glpi_plugin_integaglpi_msg_delivery_status_uq
  ON glpi_plugin_integaglpi_message_delivery_status(meta_message_id, status);

CREATE INDEX IF NOT EXISTS glpi_plugin_integaglpi_messages_meta_message_id_idx
  ON glpi_plugin_integaglpi_messages(meta_message_id)
  WHERE meta_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS glpi_plugin_integaglpi_msg_delivery_local_idx
  ON glpi_plugin_integaglpi_message_delivery_status(local_message_id, received_at DESC);
