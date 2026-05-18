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
  glpi_entity_id BIGINT,
  glpi_entity_name TEXT,
  profile_collection_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL,
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS glpi_intega_conv_contact_id_idx
ON glpi_plugin_integaglpi_conversations (contact_id);

CREATE INDEX IF NOT EXISTS glpi_intega_conv_glpi_ticket_id_idx
ON glpi_plugin_integaglpi_conversations (glpi_ticket_id);

CREATE INDEX IF NOT EXISTS glpi_intega_conversations_entity_idx
ON glpi_plugin_integaglpi_conversations (glpi_entity_id)
WHERE glpi_entity_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS glpi_intega_conv_phone_status_idx
ON glpi_plugin_integaglpi_conversations (phone_e164, status, last_message_at DESC);

ALTER TABLE public.glpi_plugin_integaglpi_conversations
  ADD COLUMN IF NOT EXISTS glpi_entity_id BIGINT NULL;

ALTER TABLE public.glpi_plugin_integaglpi_conversations
  ADD COLUMN IF NOT EXISTS glpi_entity_name TEXT NULL;

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
  meta_message_id TEXT,
  delivery_status TEXT NOT NULL DEFAULT 'pending',
  delivery_status_updated_at TIMESTAMPTZ,
  meta_error_code TEXT,
  meta_error_message_sanitized TEXT,
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

CREATE INDEX IF NOT EXISTS glpi_plugin_integaglpi_messages_meta_message_id_idx
ON glpi_plugin_integaglpi_messages (meta_message_id)
WHERE meta_message_id IS NOT NULL;

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
ON glpi_plugin_integaglpi_message_delivery_status (meta_message_id, status);

CREATE INDEX IF NOT EXISTS glpi_plugin_integaglpi_msg_delivery_local_idx
ON glpi_plugin_integaglpi_message_delivery_status (local_message_id, received_at DESC);

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

CREATE TABLE IF NOT EXISTS public.glpi_plugin_integaglpi_configs (
  id BIGSERIAL PRIMARY KEY,
  context TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.glpi_plugin_integaglpi_configs
  ADD COLUMN IF NOT EXISTS menu_message TEXT NULL,
  ADD COLUMN IF NOT EXISTS invalid_option_message TEXT NULL,
  ADD COLUMN IF NOT EXISTS invalid_media_message TEXT NULL,
  ADD COLUMN IF NOT EXISTS error_fallback_message TEXT NULL,
  ADD COLUMN IF NOT EXISTS ticket_created_message TEXT NULL,
  ADD COLUMN IF NOT EXISTS conversation_closed_message TEXT NULL,
  ADD COLUMN IF NOT EXISTS after_hours_message TEXT NULL,
  ADD COLUMN IF NOT EXISTS contact_profile_collection_enabled TEXT NULL,
  ADD COLUMN IF NOT EXISTS contact_profile_prompt_mode TEXT NULL,
  ADD COLUMN IF NOT EXISTS contact_profile_require_company TEXT NULL,
  ADD COLUMN IF NOT EXISTS contact_profile_require_name TEXT NULL,
  ADD COLUMN IF NOT EXISTS contact_profile_require_equipment TEXT NULL,
  ADD COLUMN IF NOT EXISTS contact_profile_require_summary TEXT NULL,
  ADD COLUMN IF NOT EXISTS contact_profile_confirmation_enabled TEXT NULL,
  ADD COLUMN IF NOT EXISTS contact_profile_use_buttons TEXT NULL,
  ADD COLUMN IF NOT EXISTS ticket_title_enrichment_enabled TEXT NULL,
  ADD COLUMN IF NOT EXISTS contact_profile_prompt_name TEXT NULL,
  ADD COLUMN IF NOT EXISTS contact_profile_prompt_company TEXT NULL,
  ADD COLUMN IF NOT EXISTS contact_profile_prompt_equipment TEXT NULL,
  ADD COLUMN IF NOT EXISTS contact_profile_prompt_summary TEXT NULL,
  ADD COLUMN IF NOT EXISTS contact_profile_confirm_message TEXT NULL,
  ADD COLUMN IF NOT EXISTS profile_initial_prompt TEXT NULL,
  ADD COLUMN IF NOT EXISTS profile_ask_company TEXT NULL,
  ADD COLUMN IF NOT EXISTS profile_ask_name TEXT NULL,
  ADD COLUMN IF NOT EXISTS profile_ask_equipment TEXT NULL,
  ADD COLUMN IF NOT EXISTS profile_ask_summary TEXT NULL,
  ADD COLUMN IF NOT EXISTS profile_confirmation_message TEXT NULL,
  ADD COLUMN IF NOT EXISTS profile_success_message TEXT NULL,
  ADD COLUMN IF NOT EXISTS profile_change_message TEXT NULL,
  ADD COLUMN IF NOT EXISTS profile_partial_continue_message TEXT NULL,
  ADD COLUMN IF NOT EXISTS entity_resolution_mode TEXT NULL,
  ADD COLUMN IF NOT EXISTS default_glpi_entity_id BIGINT NULL,
  ADD COLUMN IF NOT EXISTS triage_entity_id BIGINT NULL,
  ADD COLUMN IF NOT EXISTS entity_selection_timeout_hours INTEGER NULL;

CREATE UNIQUE INDEX IF NOT EXISTS glpi_intega_configs_context_uq
  ON public.glpi_plugin_integaglpi_configs (context);

ALTER TABLE glpi_plugin_integaglpi_conversations
ADD COLUMN IF NOT EXISTS queue_id BIGINT NULL REFERENCES glpi_plugin_integaglpi_queues (id) ON DELETE SET NULL;

ALTER TABLE glpi_plugin_integaglpi_conversations
ADD COLUMN IF NOT EXISTS profile_collection_state JSONB NOT NULL DEFAULT '{}'::jsonb;

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
  csat_rating TEXT NULL,
  supervisor_review_required BOOLEAN NOT NULL DEFAULT FALSE,
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

ALTER TABLE public.glpi_plugin_integaglpi_solution_actions
  ADD COLUMN IF NOT EXISTS csat_rating TEXT NULL,
  ADD COLUMN IF NOT EXISTS supervisor_review_required BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS glpi_intega_solution_actions_csat_idx
  ON public.glpi_plugin_integaglpi_solution_actions (ticket_id, csat_rating)
  WHERE csat_rating IS NOT NULL;

-- Baseline espelhando schema-migrations/006 a 010 (idempotente no startup).
CREATE TABLE IF NOT EXISTS public.glpi_plugin_integaglpi_entity_selection_attempts (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  conversation_id TEXT NOT NULL,
  glpi_entity_id BIGINT NOT NULL,
  glpi_entity_name TEXT NULL,
  idempotency_key TEXT NULL,
  status TEXT NOT NULL,
  glpi_ticket_id BIGINT NULL,
  error_message TEXT NULL,
  finished_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT glpi_intega_entity_sel_conv_fk FOREIGN KEY (conversation_id)
    REFERENCES public.glpi_plugin_integaglpi_conversations (id) ON DELETE CASCADE,
  CONSTRAINT glpi_intega_entity_sel_status_chk CHECK (
    status IN ('processing', 'succeeded', 'failed_before_ticket', 'failed_after_ticket', 'cancelled')
  )
);

ALTER TABLE public.glpi_plugin_integaglpi_entity_selection_attempts
  ADD COLUMN IF NOT EXISTS id TEXT DEFAULT gen_random_uuid()::text;

ALTER TABLE public.glpi_plugin_integaglpi_entity_selection_attempts
  ADD COLUMN IF NOT EXISTS conversation_id TEXT NULL;

ALTER TABLE public.glpi_plugin_integaglpi_entity_selection_attempts
  ADD COLUMN IF NOT EXISTS glpi_entity_id BIGINT NULL;

ALTER TABLE public.glpi_plugin_integaglpi_entity_selection_attempts
  ADD COLUMN IF NOT EXISTS glpi_entity_name TEXT NULL;

ALTER TABLE public.glpi_plugin_integaglpi_entity_selection_attempts
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT NULL;

ALTER TABLE public.glpi_plugin_integaglpi_entity_selection_attempts
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'processing';

ALTER TABLE public.glpi_plugin_integaglpi_entity_selection_attempts
  ADD COLUMN IF NOT EXISTS glpi_ticket_id BIGINT NULL;

ALTER TABLE public.glpi_plugin_integaglpi_entity_selection_attempts
  ADD COLUMN IF NOT EXISTS error_message TEXT NULL;

ALTER TABLE public.glpi_plugin_integaglpi_entity_selection_attempts
  ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ NULL;

ALTER TABLE public.glpi_plugin_integaglpi_entity_selection_attempts
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE public.glpi_plugin_integaglpi_entity_selection_attempts
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE UNIQUE INDEX IF NOT EXISTS glpi_intega_entity_sel_conv_uq
  ON public.glpi_plugin_integaglpi_entity_selection_attempts (conversation_id);

CREATE INDEX IF NOT EXISTS glpi_intega_entity_sel_status_idx
  ON public.glpi_plugin_integaglpi_entity_selection_attempts (status, updated_at DESC);

CREATE INDEX IF NOT EXISTS glpi_intega_entity_sel_idempotency_idx
  ON public.glpi_plugin_integaglpi_entity_selection_attempts (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS glpi_intega_entity_sel_finished_idx
  ON public.glpi_plugin_integaglpi_entity_selection_attempts (finished_at DESC)
  WHERE finished_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.glpi_plugin_integaglpi_contact_entity_memory (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  phone_e164 TEXT NOT NULL,
  contact_id TEXT NULL,
  glpi_entity_id BIGINT NOT NULL,
  glpi_entity_name TEXT NULL,
  source_ticket_id BIGINT NULL,
  source_conversation_id TEXT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT glpi_intega_contact_entity_mem_contact_fk FOREIGN KEY (contact_id)
    REFERENCES public.glpi_plugin_integaglpi_contacts (id) ON DELETE SET NULL,
  CONSTRAINT glpi_intega_contact_entity_mem_conv_fk FOREIGN KEY (source_conversation_id)
    REFERENCES public.glpi_plugin_integaglpi_conversations (id) ON DELETE SET NULL
);

DROP INDEX IF EXISTS public.glpi_intega_contact_entity_mem_phone_uq;

CREATE UNIQUE INDEX IF NOT EXISTS glpi_intega_contact_entity_mem_phone_active_uq
  ON public.glpi_plugin_integaglpi_contact_entity_memory (phone_e164)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS glpi_intega_contact_entity_mem_active_idx
  ON public.glpi_plugin_integaglpi_contact_entity_memory (phone_e164, is_active);

CREATE INDEX IF NOT EXISTS glpi_intega_contact_entity_mem_updated_idx
  ON public.glpi_plugin_integaglpi_contact_entity_memory (updated_at DESC);

CREATE TABLE IF NOT EXISTS public.glpi_plugin_integaglpi_contact_profile (
  id BIGSERIAL PRIMARY KEY,
  phone_e164 TEXT NOT NULL,
  requester_name TEXT NULL,
  email_address TEXT NULL,
  email_status TEXT NOT NULL DEFAULT 'not_provided',
  glpi_user_id BIGINT NULL,
  glpi_user_link_status TEXT NULL,
  glpi_user_link_source TEXT NULL,
  glpi_user_linked_at TIMESTAMPTZ NULL,
  glpi_user_created_by_integaglpi BOOLEAN NOT NULL DEFAULT FALSE,
  company_name_raw TEXT NULL,
  last_equipment_tag TEXT NULL,
  last_problem_summary TEXT NULL,
  profile_status TEXT NOT NULL DEFAULT 'incomplete',
  last_confirmed_at TIMESTAMPTZ NULL,
  last_conversation_id TEXT NULL,
  equipment_tag_unknown BOOLEAN NOT NULL DEFAULT FALSE,
  profile_source TEXT NOT NULL DEFAULT 'whatsapp',
  confirmation_count INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.glpi_plugin_integaglpi_contact_profile
  ADD COLUMN IF NOT EXISTS id BIGSERIAL,
  ADD COLUMN IF NOT EXISTS phone_e164 TEXT,
  ADD COLUMN IF NOT EXISTS requester_name TEXT NULL,
  ADD COLUMN IF NOT EXISTS email_address TEXT NULL,
  ADD COLUMN IF NOT EXISTS email_status TEXT NOT NULL DEFAULT 'not_provided',
  ADD COLUMN IF NOT EXISTS glpi_user_id BIGINT NULL,
  ADD COLUMN IF NOT EXISTS glpi_user_link_status TEXT NULL,
  ADD COLUMN IF NOT EXISTS glpi_user_link_source TEXT NULL,
  ADD COLUMN IF NOT EXISTS glpi_user_linked_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS glpi_user_created_by_integaglpi BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS company_name_raw TEXT NULL,
  ADD COLUMN IF NOT EXISTS last_equipment_tag TEXT NULL,
  ADD COLUMN IF NOT EXISTS last_problem_summary TEXT NULL,
  ADD COLUMN IF NOT EXISTS profile_status TEXT NOT NULL DEFAULT 'incomplete',
  ADD COLUMN IF NOT EXISTS last_confirmed_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS last_conversation_id TEXT NULL,
  ADD COLUMN IF NOT EXISTS equipment_tag_unknown BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS profile_source TEXT NOT NULL DEFAULT 'whatsapp',
  ADD COLUMN IF NOT EXISTS confirmation_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

DROP INDEX IF EXISTS public.glpi_intega_contact_profile_phone_uq;

CREATE UNIQUE INDEX IF NOT EXISTS glpi_intega_contact_profile_phone_active_uq
  ON public.glpi_plugin_integaglpi_contact_profile (phone_e164)
  WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS glpi_intega_contact_profile_phone_updated_idx
  ON public.glpi_plugin_integaglpi_contact_profile (phone_e164, updated_at DESC);

CREATE INDEX IF NOT EXISTS glpi_intega_contact_profile_updated_idx
  ON public.glpi_plugin_integaglpi_contact_profile (updated_at DESC);

CREATE INDEX IF NOT EXISTS glpi_intega_contact_profile_email_idx
  ON public.glpi_plugin_integaglpi_contact_profile (email_address)
  WHERE email_address IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.glpi_plugin_integaglpi_conversation_profile_snapshot (
  conversation_id TEXT NOT NULL,
  phone_e164 TEXT NOT NULL,
  snapshot_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT glpi_intega_conv_profile_snap_pk PRIMARY KEY (conversation_id),
  CONSTRAINT glpi_intega_conv_profile_snap_conv_fk FOREIGN KEY (conversation_id)
    REFERENCES public.glpi_plugin_integaglpi_conversations (id) ON DELETE CASCADE
);

ALTER TABLE public.glpi_plugin_integaglpi_conversation_profile_snapshot
  ADD COLUMN IF NOT EXISTS phone_e164 TEXT,
  ADD COLUMN IF NOT EXISTS snapshot_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS glpi_intega_conv_profile_snap_updated_idx
  ON public.glpi_plugin_integaglpi_conversation_profile_snapshot (updated_at DESC);

CREATE TABLE IF NOT EXISTS public.glpi_plugin_integaglpi_dead_letter (
  id BIGSERIAL PRIMARY KEY,
  correlation_id TEXT NULL,
  conversation_id TEXT NULL,
  message_id TEXT NULL,
  ticket_id BIGINT NULL,
  operation_type TEXT NOT NULL DEFAULT 'unknown',
  failure_type TEXT NOT NULL DEFAULT 'unknown',
  failure_reason TEXT NULL,
  retry_count INTEGER NOT NULL DEFAULT 0,
  payload_json JSONB NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_attempt_at TIMESTAMPTZ NULL
);

ALTER TABLE public.glpi_plugin_integaglpi_dead_letter
  ADD COLUMN IF NOT EXISTS correlation_id TEXT NULL,
  ADD COLUMN IF NOT EXISTS conversation_id TEXT NULL,
  ADD COLUMN IF NOT EXISTS message_id TEXT NULL,
  ADD COLUMN IF NOT EXISTS ticket_id BIGINT NULL,
  ADD COLUMN IF NOT EXISTS operation_type TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS failure_type TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS failure_reason TEXT NULL,
  ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payload_json JSONB NULL,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ NULL;

DROP INDEX IF EXISTS public.glpi_intega_dead_letter_kind_idx;

CREATE INDEX IF NOT EXISTS glpi_intega_dead_letter_created_idx
  ON public.glpi_plugin_integaglpi_dead_letter (created_at DESC);

CREATE INDEX IF NOT EXISTS glpi_intega_dead_letter_correlation_idx
  ON public.glpi_plugin_integaglpi_dead_letter (correlation_id);

CREATE INDEX IF NOT EXISTS glpi_intega_dead_letter_conversation_idx
  ON public.glpi_plugin_integaglpi_dead_letter (conversation_id);

CREATE INDEX IF NOT EXISTS glpi_intega_dead_letter_message_idx
  ON public.glpi_plugin_integaglpi_dead_letter (message_id);

CREATE INDEX IF NOT EXISTS glpi_intega_dead_letter_ticket_idx
  ON public.glpi_plugin_integaglpi_dead_letter (ticket_id);

CREATE INDEX IF NOT EXISTS glpi_intega_dead_letter_operation_created_idx
  ON public.glpi_plugin_integaglpi_dead_letter (operation_type, created_at DESC);

CREATE INDEX IF NOT EXISTS glpi_intega_dead_letter_status_created_idx
  ON public.glpi_plugin_integaglpi_dead_letter (status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.glpi_plugin_integaglpi_inactivity_tracking (
  conversation_id TEXT PRIMARY KEY,
  ticket_id BIGINT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  reminder_1_sent_at TIMESTAMPTZ NULL,
  reminder_2_sent_at TIMESTAMPTZ NULL,
  reminder_3_sent_at TIMESTAMPTZ NULL,
  autoclose_attempted_at TIMESTAMPTZ NULL,
  autoclose_completed_at TIMESTAMPTZ NULL,
  last_client_activity_at TIMESTAMPTZ NULL,
  last_outbound_activity_at TIMESTAMPTZ NULL,
  manual_hold_until TIMESTAMPTZ NULL,
  manual_hold_reason TEXT NULL,
  skip_reason TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT glpi_intega_inactivity_conv_fk FOREIGN KEY (conversation_id)
    REFERENCES public.glpi_plugin_integaglpi_conversations (id) ON DELETE CASCADE,
  CONSTRAINT glpi_intega_inactivity_status_chk CHECK (
    status IN (
      'pending',
      'reminder_1_sent',
      'reminder_2_sent',
      'reminder_3_sent',
      'autoclose_done',
      'skipped_by_response',
      'skipped_by_hold',
      'skipped_by_closed_ticket',
      'skipped_by_feature_flag',
      'failed'
    )
  )
);

ALTER TABLE public.glpi_plugin_integaglpi_inactivity_tracking
  ADD COLUMN IF NOT EXISTS ticket_id BIGINT NULL,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS reminder_1_sent_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS reminder_2_sent_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS reminder_3_sent_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS autoclose_attempted_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS autoclose_completed_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS last_client_activity_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS last_outbound_activity_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS manual_hold_until TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS manual_hold_reason TEXT NULL,
  ADD COLUMN IF NOT EXISTS skip_reason TEXT NULL,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS glpi_intega_inactivity_status_updated_idx
  ON public.glpi_plugin_integaglpi_inactivity_tracking (status, updated_at DESC);

CREATE INDEX IF NOT EXISTS glpi_intega_inactivity_ticket_idx
  ON public.glpi_plugin_integaglpi_inactivity_tracking (ticket_id)
  WHERE ticket_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS glpi_intega_inactivity_outbound_idx
  ON public.glpi_plugin_integaglpi_inactivity_tracking (last_outbound_activity_at)
  WHERE status IN ('pending', 'reminder_1_sent', 'reminder_2_sent', 'reminder_3_sent', 'failed');

CREATE TABLE IF NOT EXISTS public.glpi_plugin_integaglpi_entity_contracts (
  id BIGSERIAL PRIMARY KEY,
  glpi_entity_id BIGINT NOT NULL,
  glpi_entity_name TEXT NULL,
  glpi_contract_id BIGINT NULL,
  contract_name TEXT NULL,
  allocated_hours NUMERIC(10,2) NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  warning_threshold_percent INTEGER NOT NULL DEFAULT 70,
  critical_threshold_percent INTEGER NOT NULL DEFAULT 90,
  exhausted_threshold_percent INTEGER NOT NULL DEFAULT 100,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  notes TEXT NULL,
  created_by BIGINT NULL,
  updated_by BIGINT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT glpi_intega_entity_contracts_entity_chk CHECK (glpi_entity_id > 0),
  CONSTRAINT glpi_intega_entity_contracts_glpi_contract_chk CHECK (glpi_contract_id IS NULL OR glpi_contract_id > 0),
  CONSTRAINT glpi_intega_entity_contracts_hours_chk CHECK (allocated_hours >= 0),
  CONSTRAINT glpi_intega_entity_contracts_period_chk CHECK (period_end >= period_start),
  CONSTRAINT glpi_intega_entity_contracts_thresholds_chk CHECK (
    warning_threshold_percent >= 1
    AND critical_threshold_percent >= warning_threshold_percent
    AND exhausted_threshold_percent >= critical_threshold_percent
  )
);

ALTER TABLE public.glpi_plugin_integaglpi_entity_contracts
  ADD COLUMN IF NOT EXISTS glpi_entity_id BIGINT,
  ADD COLUMN IF NOT EXISTS glpi_entity_name TEXT NULL,
  ADD COLUMN IF NOT EXISTS glpi_contract_id BIGINT NULL,
  ADD COLUMN IF NOT EXISTS contract_name TEXT NULL,
  ADD COLUMN IF NOT EXISTS allocated_hours NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS period_start DATE NOT NULL DEFAULT CURRENT_DATE,
  ADD COLUMN IF NOT EXISTS period_end DATE NOT NULL DEFAULT CURRENT_DATE,
  ADD COLUMN IF NOT EXISTS warning_threshold_percent INTEGER NOT NULL DEFAULT 70,
  ADD COLUMN IF NOT EXISTS critical_threshold_percent INTEGER NOT NULL DEFAULT 90,
  ADD COLUMN IF NOT EXISTS exhausted_threshold_percent INTEGER NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS notes TEXT NULL,
  ADD COLUMN IF NOT EXISTS created_by BIGINT NULL,
  ADD COLUMN IF NOT EXISTS updated_by BIGINT NULL,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS glpi_intega_entity_contracts_entity_active_idx
  ON public.glpi_plugin_integaglpi_entity_contracts (glpi_entity_id, is_active, period_start, period_end);

CREATE INDEX IF NOT EXISTS glpi_intega_entity_contracts_period_idx
  ON public.glpi_plugin_integaglpi_entity_contracts (period_start, period_end);

CREATE INDEX IF NOT EXISTS glpi_intega_entity_contracts_glpi_contract_idx
  ON public.glpi_plugin_integaglpi_entity_contracts (glpi_contract_id)
  WHERE glpi_contract_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.glpi_plugin_integaglpi_hour_adjustments (
  id BIGSERIAL PRIMARY KEY,
  contract_id BIGINT NOT NULL,
  glpi_entity_id BIGINT NOT NULL,
  glpi_ticket_id BIGINT NULL,
  adjusted_hours NUMERIC(10,2) NOT NULL,
  adjustment_type TEXT NOT NULL,
  source TEXT NOT NULL,
  previous_value NUMERIC(10,2) NULL,
  reviewed_by BIGINT NOT NULL,
  review_notes TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT glpi_intega_hour_adjust_contract_fk FOREIGN KEY (contract_id)
    REFERENCES public.glpi_plugin_integaglpi_entity_contracts (id),
  CONSTRAINT glpi_intega_hour_adjust_entity_chk CHECK (glpi_entity_id > 0),
  CONSTRAINT glpi_intega_hour_adjust_reviewer_chk CHECK (reviewed_by > 0),
  CONSTRAINT glpi_intega_hour_adjust_notes_chk CHECK (length(btrim(review_notes)) > 0),
  CONSTRAINT glpi_intega_hour_adjust_type_chk CHECK (adjustment_type IN ('add', 'remove', 'correction')),
  CONSTRAINT glpi_intega_hour_adjust_source_chk CHECK (source IN ('manual_adjustment', 'glpi_task_actiontime', 'supervisor_review'))
);

ALTER TABLE public.glpi_plugin_integaglpi_hour_adjustments
  ADD COLUMN IF NOT EXISTS contract_id BIGINT,
  ADD COLUMN IF NOT EXISTS glpi_entity_id BIGINT,
  ADD COLUMN IF NOT EXISTS glpi_ticket_id BIGINT NULL,
  ADD COLUMN IF NOT EXISTS adjusted_hours NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS adjustment_type TEXT NOT NULL DEFAULT 'correction',
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual_adjustment',
  ADD COLUMN IF NOT EXISTS previous_value NUMERIC(10,2) NULL,
  ADD COLUMN IF NOT EXISTS reviewed_by BIGINT,
  ADD COLUMN IF NOT EXISTS review_notes TEXT NOT NULL DEFAULT 'Ajuste operacional',
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS glpi_intega_hour_adjust_contract_created_idx
  ON public.glpi_plugin_integaglpi_hour_adjustments (contract_id, created_at DESC);

CREATE INDEX IF NOT EXISTS glpi_intega_hour_adjust_entity_created_idx
  ON public.glpi_plugin_integaglpi_hour_adjustments (glpi_entity_id, created_at DESC);

CREATE INDEX IF NOT EXISTS glpi_intega_hour_adjust_ticket_idx
  ON public.glpi_plugin_integaglpi_hour_adjustments (glpi_ticket_id)
  WHERE glpi_ticket_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.glpi_plugin_integaglpi_ai_quality_analyses (
  id BIGSERIAL PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  glpi_ticket_id BIGINT NOT NULL,
  analysis_version TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  classification_resolution TEXT NULL,
  sentiment TEXT NULL,
  flags JSONB NOT NULL DEFAULT '[]'::jsonb,
  summary TEXT NULL,
  recommendation TEXT NULL,
  result_json JSONB NULL,
  supervisor_feedback TEXT NULL,
  feedback_notes TEXT NULL,
  created_by BIGINT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT glpi_intega_ai_quality_status_ck
    CHECK (status IN ('pending', 'completed', 'failed', 'skipped')),
  CONSTRAINT glpi_intega_ai_quality_resolution_ck
    CHECK (
      classification_resolution IS NULL
      OR classification_resolution IN ('resolved', 'probably_resolved', 'uncertain', 'probably_not_resolved')
    ),
  CONSTRAINT glpi_intega_ai_quality_sentiment_ck
    CHECK (
      sentiment IS NULL
      OR sentiment IN ('satisfied', 'neutral', 'dissatisfied', 'high_risk')
    ),
  CONSTRAINT glpi_intega_ai_quality_feedback_ck
    CHECK (
      supervisor_feedback IS NULL
      OR supervisor_feedback IN ('useful', 'not_useful', 'incorrect')
    )
);

CREATE INDEX IF NOT EXISTS glpi_intega_ai_quality_conversation_created_idx
  ON public.glpi_plugin_integaglpi_ai_quality_analyses (conversation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS glpi_intega_ai_quality_ticket_created_idx
  ON public.glpi_plugin_integaglpi_ai_quality_analyses (glpi_ticket_id, created_at DESC);

CREATE INDEX IF NOT EXISTS glpi_intega_ai_quality_status_created_idx
  ON public.glpi_plugin_integaglpi_ai_quality_analyses (status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.glpi_plugin_integaglpi_message_catalog (
  event_key TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  group_name TEXT NOT NULL,
  default_text TEXT NOT NULL,
  custom_text TEXT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  send_type TEXT NOT NULL DEFAULT 'text' CHECK (send_type IN ('text', 'interactive_buttons', 'interactive_list', 'template', 'internal_only')),
  language TEXT NOT NULL DEFAULT 'pt_BR',
  fallback_text TEXT NULL,
  template_name TEXT NULL,
  buttons_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  list_options_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  expects_response BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by BIGINT NULL
);

CREATE TABLE IF NOT EXISTS public.glpi_plugin_integaglpi_message_catalog_audit (
  id BIGSERIAL PRIMARY KEY,
  event_key TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('create', 'update', 'disable', 'enable')),
  old_value JSONB NULL,
  new_value JSONB NULL,
  changed_by BIGINT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.glpi_plugin_integaglpi_business_hours (
  id BIGSERIAL PRIMARY KEY,
  business_hours_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  timezone TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
  weekday_start_time TEXT NOT NULL DEFAULT '08:00',
  weekday_end_time TEXT NOT NULL DEFAULT '18:00',
  saturday_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  saturday_start_time TEXT NULL,
  saturday_end_time TEXT NULL,
  sunday_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  sunday_start_time TEXT NULL,
  sunday_end_time TEXT NULL,
  holiday_behavior TEXT NOT NULL DEFAULT 'normal' CHECK (holiday_behavior IN ('closed', 'normal', 'custom')),
  outside_hours_event_key TEXT NOT NULL DEFAULT 'outside_business_hours_message',
  cooldown_minutes INTEGER NOT NULL DEFAULT 60,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by BIGINT NULL
);

CREATE TABLE IF NOT EXISTS public.glpi_plugin_integaglpi_message_automation_events (
  id BIGSERIAL PRIMARY KEY,
  conversation_id TEXT NULL,
  phone_e164 TEXT NULL,
  event_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('planned', 'sent', 'failed', 'not_sent_by_rule')),
  message_id TEXT NULL,
  reason TEXT NULL,
  error_code TEXT NULL,
  error_message_sanitized TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.glpi_plugin_integaglpi_inactivity_job_events (
  id BIGSERIAL PRIMARY KEY,
  conversation_id TEXT NULL,
  ticket_id BIGINT NULL,
  phone_e164 TEXT NULL,
  event_key TEXT NULL,
  status TEXT NOT NULL CHECK (status IN ('checked', 'eligible', 'skipped', 'planned', 'sent', 'failed')),
  reason TEXT NULL,
  message_id TEXT NULL,
  delivery_status TEXT NULL,
  meta_error_code TEXT NULL,
  meta_error_message_sanitized TEXT NULL,
  checked_count INTEGER NULL,
  eligible_count INTEGER NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS glpi_intega_msg_catalog_group_idx
  ON public.glpi_plugin_integaglpi_message_catalog (group_name, event_key);

CREATE INDEX IF NOT EXISTS glpi_intega_msg_catalog_audit_event_idx
  ON public.glpi_plugin_integaglpi_message_catalog_audit (event_key, changed_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS glpi_intega_business_hours_singleton_uq
  ON public.glpi_plugin_integaglpi_business_hours ((TRUE));

CREATE INDEX IF NOT EXISTS glpi_intega_msg_auto_cooldown_idx
  ON public.glpi_plugin_integaglpi_message_automation_events (conversation_id, event_key, status, created_at DESC);

CREATE INDEX IF NOT EXISTS glpi_intega_msg_auto_phone_idx
  ON public.glpi_plugin_integaglpi_message_automation_events (phone_e164, event_key, status, created_at DESC)
  WHERE phone_e164 IS NOT NULL;

CREATE INDEX IF NOT EXISTS glpi_intega_inactivity_job_conv_idx
  ON public.glpi_plugin_integaglpi_inactivity_job_events (conversation_id, created_at DESC)
  WHERE conversation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS glpi_intega_inactivity_job_status_idx
  ON public.glpi_plugin_integaglpi_inactivity_job_events (status, created_at DESC);

CREATE INDEX IF NOT EXISTS glpi_intega_inactivity_job_event_idx
  ON public.glpi_plugin_integaglpi_inactivity_job_events (event_key, created_at DESC)
  WHERE event_key IS NOT NULL;

INSERT INTO public.glpi_plugin_integaglpi_business_hours (
  business_hours_enabled,
  timezone,
  weekday_start_time,
  weekday_end_time,
  saturday_enabled,
  sunday_enabled,
  holiday_behavior,
  outside_hours_event_key,
  cooldown_minutes
)
SELECT FALSE, 'America/Sao_Paulo', '08:00', '18:00', FALSE, FALSE, 'normal', 'outside_business_hours_message', 60
WHERE NOT EXISTS (SELECT 1 FROM public.glpi_plugin_integaglpi_business_hours);

INSERT INTO public.glpi_plugin_integaglpi_message_catalog (
  event_key,
  description,
  group_name,
  default_text,
  send_type,
  expects_response
)
VALUES
  ('welcome_message', 'Mensagem inicial do atendimento', 'Boas-vindas e Fila', 'Olá! Como podemos ajudar?', 'text', TRUE),
  ('queue_selection_prompt', 'Solicita escolha de fila', 'Boas-vindas e Fila', 'Escolha uma das opções de atendimento.', 'interactive_buttons', TRUE),
  ('invalid_queue_selection', 'Opção de fila inválida', 'Boas-vindas e Fila', 'Por favor, responda com uma opção válida do menu.', 'text', TRUE),
  ('profile_name_prompt', 'Solicita nome', 'Coleta de Perfil', 'Por favor, informe seu nome.', 'text', TRUE),
  ('profile_company_prompt', 'Solicita empresa', 'Coleta de Perfil', 'Por favor, informe a empresa.', 'text', TRUE),
  ('profile_email_prompt', 'Solicita e-mail', 'Coleta de Perfil', 'Se tiver, informe seu e-mail para cadastro.', 'text', TRUE),
  ('profile_equipment_prompt', 'Solicita equipamento', 'Coleta de Perfil', 'Informe o equipamento ou sistema afetado.', 'text', TRUE),
  ('profile_reason_prompt', 'Solicita motivo', 'Coleta de Perfil', 'Descreva resumidamente o problema.', 'text', TRUE),
  ('profile_confirmation_prompt', 'Confirma dados coletados', 'Coleta de Perfil', 'Confirma as informações para abrir o chamado?', 'interactive_buttons', TRUE),
  ('profile_confirmed_message', 'Perfil confirmado', 'Coleta de Perfil', 'Dados registrados. Vamos abrir seu chamado.', 'text', FALSE),
  ('awaiting_entity_message', 'Aguardando seleção de entidade', 'Ticket e Solução', 'Recebemos as suas informações, em breve um técnico seguirá com o atendimento.', 'text', FALSE),
  ('ticket_created_message', 'Chamado criado', 'Ticket e Solução', 'Seu chamado #{ticket_id} foi aberto.', 'text', FALSE),
  ('ticket_updated_message', 'Chamado atualizado', 'Ticket e Solução', 'Atualizamos seu chamado com a nova mensagem.', 'text', FALSE),
  ('technician_transfer_message', 'Transferência de técnico', 'Ticket e Solução', 'Seu atendimento foi encaminhado para outro técnico.', 'text', FALSE),
  ('technician_assumed_message', 'Técnico assumiu atendimento', 'Ticket e Solução', 'Um técnico assumiu seu atendimento e seguirá por aqui.', 'text', FALSE),
  ('inactivity_reminder_1', 'Primeiro lembrete de inatividade', 'Avisos e Inatividade', 'Olá! Estamos aguardando seu retorno para continuar o atendimento. Podemos ajudar em algo mais?', 'text', TRUE),
  ('inactivity_reminder_2', 'Segundo lembrete de inatividade', 'Avisos e Inatividade', 'Ainda estamos por aqui. Para seguirmos com o chamado, responda esta mensagem quando puder.', 'text', TRUE),
  ('inactivity_reminder_3', 'Terceiro lembrete de inatividade', 'Avisos e Inatividade', 'Como ainda não tivemos retorno, este atendimento poderá ser encerrado automaticamente se não houver resposta.', 'text', TRUE),
  ('inactivity_autoclose_warning', 'Aviso antes do encerramento', 'Avisos e Inatividade', 'Este atendimento poderá ser encerrado automaticamente se não houver resposta.', 'text', FALSE),
  ('inactivity_autoclose_message', 'Mensagem final de inatividade', 'Avisos e Inatividade', 'Como não tivemos retorno, estamos encerrando este atendimento por falta de resposta. Se precisar, basta nos chamar novamente.', 'text', FALSE),
  ('solution_submitted_message', 'Solução enviada', 'Ticket e Solução', 'Seu chamado foi solucionado. Como você avalia este atendimento?', 'interactive_buttons', TRUE),
  ('solution_approve_reopen_prompt', 'Aprovação ou reabertura', 'Ticket e Solução', 'A solução atendeu sua necessidade?', 'interactive_buttons', TRUE),
  ('solution_approved_message', 'Solução aprovada', 'Ticket e Solução', 'Obrigado pela confirmação.', 'text', FALSE),
  ('solution_reopen_message', 'Solução reaberta', 'Ticket e Solução', 'Vamos reabrir o atendimento para continuidade.', 'text', FALSE),
  ('csat_prompt', 'Pesquisa de satisfação', 'CSAT', 'Como você avalia este atendimento?', 'interactive_buttons', TRUE),
  ('csat_thanks_message', 'Agradecimento CSAT', 'CSAT', 'Obrigado pela avaliação.', 'text', FALSE),
  ('media_received_message', 'Mídia recebida', 'Mídia', 'Recebemos o arquivo enviado e vamos analisá-lo.', 'text', FALSE),
  ('media_processing_failed_message', 'Falha ao processar mídia', 'Mídia', 'Não conseguimos processar o arquivo agora. Um técnico vai verificar.', 'text', FALSE),
  ('outside_24h_template_required_message', 'Janela 24h fechada', 'Avisos e Inatividade', 'A janela de 24h está fechada. Use um template aprovado para iniciar contato.', 'internal_only', FALSE),
  ('outside_business_hours_message', 'Mensagem fora do horário', 'Horário Comercial', 'Olá! Nosso horário de atendimento é de segunda a sexta, das 08h às 18h. Recebemos sua mensagem e retornaremos em breve.', 'text', FALSE),
  ('outside_business_hours_template_missing', 'Template ausente fora da janela', 'Horário Comercial', 'Mensagem fora do horário não enviada: janela 24h fechada e template local ausente.', 'internal_only', FALSE),
  ('outside_business_hours_cooldown_skipped', 'Cooldown fora do horário', 'Horário Comercial', 'Mensagem fora do horário suprimida por cooldown.', 'internal_only', FALSE),
  ('outside_business_hours_sent', 'Fora do horário enviado', 'Horário Comercial', 'Mensagem fora do horário enviada.', 'internal_only', FALSE),
  ('outside_business_hours_failed', 'Falha fora do horário', 'Horário Comercial', 'Falha ao enviar mensagem fora do horário.', 'internal_only', FALSE)
ON CONFLICT (event_key) DO NOTHING;
