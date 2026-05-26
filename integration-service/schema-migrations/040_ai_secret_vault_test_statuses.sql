DO $$
BEGIN
  IF to_regclass('public.glpi_plugin_integaglpi_ai_secret_vault') IS NOT NULL THEN
    -- CHECK constraint maintenance only: no table drop and no secret/plaintext data exposure.
    -- This normalizes a legacy provider id from early smoke tests before re-adding the allowlist.
    IF EXISTS (
      SELECT 1
        FROM pg_constraint
       WHERE conname = 'glpi_intega_ai_secret_provider_ck'
         AND conrelid = 'public.glpi_plugin_integaglpi_ai_secret_vault'::regclass
    ) THEN
      ALTER TABLE public.glpi_plugin_integaglpi_ai_secret_vault
        DROP CONSTRAINT glpi_intega_ai_secret_provider_ck;
    END IF;

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

    -- CHECK constraint maintenance only: allow typed synthetic-test results without changing stored secrets.
    IF EXISTS (
      SELECT 1
        FROM pg_constraint
       WHERE conname = 'glpi_intega_ai_secret_test_status_ck'
         AND conrelid = 'public.glpi_plugin_integaglpi_ai_secret_vault'::regclass
    ) THEN
      ALTER TABLE public.glpi_plugin_integaglpi_ai_secret_vault
        DROP CONSTRAINT glpi_intega_ai_secret_test_status_ck;
    END IF;

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
  END IF;
END $$;
