ALTER TABLE public.glpi_plugin_integaglpi_solution_actions
  ADD COLUMN IF NOT EXISTS csat_timeout_close_attempted_at TIMESTAMPTZ NULL;

ALTER TABLE public.glpi_plugin_integaglpi_solution_actions
  ADD COLUMN IF NOT EXISTS csat_timeout_closed_at TIMESTAMPTZ NULL;

ALTER TABLE public.glpi_plugin_integaglpi_solution_actions
  ADD COLUMN IF NOT EXISTS csat_timeout_skip_reason TEXT NULL;

CREATE INDEX IF NOT EXISTS glpi_intega_solution_actions_csat_timeout_idx
  ON public.glpi_plugin_integaglpi_solution_actions (created_at, ticket_id, conversation_id)
  WHERE action = 'approve'
    AND status = 'success'
    AND csat_rating IS NULL
    AND csat_timeout_closed_at IS NULL;
