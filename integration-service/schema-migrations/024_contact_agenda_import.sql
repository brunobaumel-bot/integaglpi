CREATE TABLE IF NOT EXISTS public.glpi_plugin_integaglpi_contact_import_batches (
  batch_id TEXT PRIMARY KEY,
  filename TEXT NOT NULL,
  uploaded_by BIGINT NULL,
  status TEXT NOT NULL DEFAULT 'previewed',
  total_rows INTEGER NOT NULL DEFAULT 0,
  valid_rows INTEGER NOT NULL DEFAULT 0,
  invalid_rows INTEGER NOT NULL DEFAULT 0,
  duplicate_rows INTEGER NOT NULL DEFAULT 0,
  conflict_rows INTEGER NOT NULL DEFAULT 0,
  error_message_sanitized TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_at TIMESTAMPTZ NULL,
  completed_at TIMESTAMPTZ NULL,
  rolled_back_at TIMESTAMPTZ NULL
);

ALTER TABLE public.glpi_plugin_integaglpi_contact_import_batches
  ADD COLUMN IF NOT EXISTS batch_id TEXT,
  ADD COLUMN IF NOT EXISTS filename TEXT,
  ADD COLUMN IF NOT EXISTS uploaded_by BIGINT NULL,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'previewed',
  ADD COLUMN IF NOT EXISTS total_rows INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS valid_rows INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS invalid_rows INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS duplicate_rows INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS conflict_rows INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS error_message_sanitized TEXT NULL,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS rolled_back_at TIMESTAMPTZ NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'glpi_intega_contact_import_batches_status_ck'
  ) THEN
    ALTER TABLE public.glpi_plugin_integaglpi_contact_import_batches
      ADD CONSTRAINT glpi_intega_contact_import_batches_status_ck
      CHECK (status IN ('previewed', 'confirmed', 'processing', 'completed', 'failed', 'rolled_back'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS glpi_intega_contact_import_batches_status_idx
  ON public.glpi_plugin_integaglpi_contact_import_batches (status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.glpi_plugin_integaglpi_contact_import_items (
  item_id BIGSERIAL PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES public.glpi_plugin_integaglpi_contact_import_batches (batch_id),
  row_number INTEGER NOT NULL,
  phone_e164 TEXT NULL,
  email TEXT NULL,
  contact_name TEXT NULL,
  company_name TEXT NULL,
  equipment_tag TEXT NULL,
  equipment_tag_unknown BOOLEAN NOT NULL DEFAULT FALSE,
  validation_status TEXT NOT NULL DEFAULT 'invalid',
  validation_errors JSONB NOT NULL DEFAULT '[]'::jsonb,
  dedup_status TEXT NOT NULL DEFAULT 'new',
  action_planned TEXT NOT NULL DEFAULT 'none',
  action_applied TEXT NOT NULL DEFAULT 'none',
  target_contact_profile_id BIGINT NULL,
  previous_state_json JSONB NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  applied_at TIMESTAMPTZ NULL
);

ALTER TABLE public.glpi_plugin_integaglpi_contact_import_items
  ADD COLUMN IF NOT EXISTS item_id BIGSERIAL,
  ADD COLUMN IF NOT EXISTS batch_id TEXT,
  ADD COLUMN IF NOT EXISTS row_number INTEGER,
  ADD COLUMN IF NOT EXISTS phone_e164 TEXT NULL,
  ADD COLUMN IF NOT EXISTS email TEXT NULL,
  ADD COLUMN IF NOT EXISTS contact_name TEXT NULL,
  ADD COLUMN IF NOT EXISTS company_name TEXT NULL,
  ADD COLUMN IF NOT EXISTS equipment_tag TEXT NULL,
  ADD COLUMN IF NOT EXISTS equipment_tag_unknown BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS validation_status TEXT NOT NULL DEFAULT 'invalid',
  ADD COLUMN IF NOT EXISTS validation_errors JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS dedup_status TEXT NOT NULL DEFAULT 'new',
  ADD COLUMN IF NOT EXISTS action_planned TEXT NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS action_applied TEXT NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS target_contact_profile_id BIGINT NULL,
  ADD COLUMN IF NOT EXISTS previous_state_json JSONB NULL,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS applied_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS glpi_intega_contact_import_items_batch_idx
  ON public.glpi_plugin_integaglpi_contact_import_items (batch_id, row_number);

CREATE INDEX IF NOT EXISTS glpi_intega_contact_import_items_phone_idx
  ON public.glpi_plugin_integaglpi_contact_import_items (phone_e164)
  WHERE phone_e164 IS NOT NULL;

CREATE INDEX IF NOT EXISTS glpi_intega_contact_import_items_email_idx
  ON public.glpi_plugin_integaglpi_contact_import_items (email)
  WHERE email IS NOT NULL;

CREATE INDEX IF NOT EXISTS glpi_intega_contact_import_items_status_idx
  ON public.glpi_plugin_integaglpi_contact_import_items (validation_status, dedup_status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.glpi_plugin_integaglpi_contact_import_rollbacks (
  rollback_id BIGSERIAL PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES public.glpi_plugin_integaglpi_contact_import_batches (batch_id),
  item_id BIGINT NULL,
  reason TEXT NOT NULL,
  previous_state_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  rollback_state TEXT NOT NULL DEFAULT 'pending',
  requested_by BIGINT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ NULL
);

ALTER TABLE public.glpi_plugin_integaglpi_contact_import_rollbacks
  ADD COLUMN IF NOT EXISTS rollback_id BIGSERIAL,
  ADD COLUMN IF NOT EXISTS batch_id TEXT,
  ADD COLUMN IF NOT EXISTS item_id BIGINT NULL,
  ADD COLUMN IF NOT EXISTS reason TEXT,
  ADD COLUMN IF NOT EXISTS previous_state_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS rollback_state TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS requested_by BIGINT NULL,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS glpi_intega_contact_import_rollbacks_batch_idx
  ON public.glpi_plugin_integaglpi_contact_import_rollbacks (batch_id, created_at DESC);
