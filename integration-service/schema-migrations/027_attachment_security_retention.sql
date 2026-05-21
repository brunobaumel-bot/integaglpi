-- Fase Attachment Security / Retention: metadados operacionais de anexos.
-- Migration aditiva e idempotente. Sem DROP/TRUNCATE/DELETE fisico.

ALTER TABLE public.glpi_plugin_integaglpi_messages
  ADD COLUMN IF NOT EXISTS attachment_hash TEXT NULL;

ALTER TABLE public.glpi_plugin_integaglpi_messages
  ADD COLUMN IF NOT EXISTS attachment_status TEXT NOT NULL DEFAULT 'received';

ALTER TABLE public.glpi_plugin_integaglpi_messages
  ADD COLUMN IF NOT EXISTS attachment_blocked_reason TEXT NULL;

ALTER TABLE public.glpi_plugin_integaglpi_messages
  ADD COLUMN IF NOT EXISTS attachment_mime_detected TEXT NULL;

ALTER TABLE public.glpi_plugin_integaglpi_messages
  ADD COLUMN IF NOT EXISTS attachment_extension TEXT NULL;

ALTER TABLE public.glpi_plugin_integaglpi_messages
  ADD COLUMN IF NOT EXISTS attachment_size_bytes BIGINT NULL;

ALTER TABLE public.glpi_plugin_integaglpi_messages
  ADD COLUMN IF NOT EXISTS attachment_filename_sanitized TEXT NULL;

ALTER TABLE public.glpi_plugin_integaglpi_messages
  ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.glpi_plugin_integaglpi_messages
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL;

ALTER TABLE public.glpi_plugin_integaglpi_messages
  ADD COLUMN IF NOT EXISTS deleted_by_user_id BIGINT NULL;

CREATE INDEX IF NOT EXISTS glpi_intega_messages_attachment_hash_idx
ON public.glpi_plugin_integaglpi_messages (attachment_hash)
WHERE attachment_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS glpi_intega_messages_attachment_status_idx
ON public.glpi_plugin_integaglpi_messages (attachment_status);

CREATE INDEX IF NOT EXISTS glpi_intega_messages_is_deleted_idx
ON public.glpi_plugin_integaglpi_messages (is_deleted);

CREATE INDEX IF NOT EXISTS glpi_intega_messages_attachment_conversation_idx
ON public.glpi_plugin_integaglpi_messages (conversation_id, attachment_status)
WHERE attachment_status <> 'received';
