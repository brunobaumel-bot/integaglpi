-- 040_ai_secret_vault_test_statuses.sql
-- Manutencao idempotente de CHECK constraints do Secret Vault.
-- Compativel com aplicador simples que divide SQL por ponto-e-virgula.
-- Nao remove tabelas, nao apaga dados e nao expoe segredos.

ALTER TABLE public.glpi_plugin_integaglpi_ai_secret_vault
  DROP CONSTRAINT IF EXISTS glpi_intega_ai_secret_provider_ck;

UPDATE public.glpi_plugin_integaglpi_ai_secret_vault AS legacy
   SET is_active = FALSE,
       updated_at = NOW()
 WHERE legacy.provider = 'google'
   AND legacy.is_active = TRUE
   AND EXISTS (
     SELECT 1
       FROM public.glpi_plugin_integaglpi_ai_secret_vault AS current
      WHERE current.provider = 'gemini'
        AND current.is_active = TRUE
   );

UPDATE public.glpi_plugin_integaglpi_ai_secret_vault
   SET provider = 'gemini',
       updated_at = NOW()
 WHERE provider = 'google';

ALTER TABLE public.glpi_plugin_integaglpi_ai_secret_vault
  ADD CONSTRAINT glpi_intega_ai_secret_provider_ck CHECK (
    provider IN ('openai', 'anthropic', 'gemini', 'deepseek', 'xai')
  );

ALTER TABLE public.glpi_plugin_integaglpi_ai_secret_vault
  DROP CONSTRAINT IF EXISTS glpi_intega_ai_secret_test_status_ck;

ALTER TABLE public.glpi_plugin_integaglpi_ai_secret_vault
  ADD CONSTRAINT glpi_intega_ai_secret_test_status_ck CHECK (
    last_test_status IS NULL
    OR last_test_status IN (
      'not_tested',
      'success',
      'failed',
      'blocked',
      'timeout',
      'invalid_response',
      'unauthorized'
    )
  );
