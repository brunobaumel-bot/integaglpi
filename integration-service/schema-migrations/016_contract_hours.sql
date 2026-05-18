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
