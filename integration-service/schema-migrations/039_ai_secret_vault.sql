CREATE TABLE IF NOT EXISTS public.glpi_plugin_integaglpi_ai_secret_vault (
  id BIGSERIAL PRIMARY KEY,
  provider TEXT NOT NULL,
  encrypted_secret TEXT NOT NULL,
  secret_fingerprint TEXT NOT NULL,
  label TEXT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by BIGINT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by BIGINT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_tested_at TIMESTAMPTZ NULL,
  last_test_status TEXT NULL,
  CONSTRAINT glpi_intega_ai_secret_provider_ck CHECK (provider IN ('openai', 'anthropic', 'gemini', 'deepseek', 'xai')),
  CONSTRAINT glpi_intega_ai_secret_test_status_ck CHECK (
    last_test_status IS NULL
    OR last_test_status IN ('not_tested', 'success', 'failed', 'blocked')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS glpi_intega_ai_secret_active_provider_uq
  ON public.glpi_plugin_integaglpi_ai_secret_vault (provider)
  WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS glpi_intega_ai_secret_provider_updated_idx
  ON public.glpi_plugin_integaglpi_ai_secret_vault (provider, updated_at DESC);
