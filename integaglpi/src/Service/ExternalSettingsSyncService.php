<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi\Service;

use GlpiPlugin\Integaglpi\External\ExternalDatabase;
use PDO;
use Throwable;

final class ExternalSettingsSyncService
{
    private const TABLE = 'glpi_plugin_integaglpi_configs';

    /**
     * @param array<string, mixed> $values
     */
    public function syncContactProfileSettings(array $values): ?string
    {
        return $this->syncSafely(static function (PDO $pdo) use ($values): void {
            self::ensureSchema($pdo);
            self::upsertContext($pdo, 'contact_profile', self::normalizeContactProfileValues($values));
            self::syncEntityResolutionSettings($pdo, $values);
        });
    }

    /**
     * @param array<string, mixed> $values
     */
    public function syncMessageSettings(array $values): ?string
    {
        return $this->syncSafely(static function (PDO $pdo) use ($values): void {
            self::ensureSchema($pdo);
            self::upsertContext($pdo, 'message', self::filterKnownMessageValues($values));
        });
    }

    /**
     * @param callable(PDO): void $callback
     */
    private function syncSafely(callable $callback): ?string
    {
        try {
            $configService = new PluginConfigService();
            if (!$configService->isConfigured()) {
                return __('PostgreSQL externo não configurado; as configurações foram salvas apenas no GLPI.', 'glpiintegaglpi');
            }

            $pdo = ExternalDatabase::getConnection($configService->getConnectionConfig());
            $callback($pdo);
            return null;
        } catch (Throwable $exception) {
            error_log('[integaglpi][config][external_settings_sync] ' . $exception->getMessage());
            return __('Configuração salva no GLPI, mas ainda não foi sincronizada com o PostgreSQL externo. Revise a conexão e salve novamente.', 'glpiintegaglpi');
        }
    }

    public static function ensureSchema(PDO $pdo): void
    {
        $pdo->exec(<<<SQL
            CREATE TABLE IF NOT EXISTS glpi_plugin_integaglpi_configs (
                id BIGSERIAL PRIMARY KEY,
                context TEXT NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            SQL);

        foreach (self::columnDefinitions() as $column => $definition) {
            $pdo->exec(sprintf(
                'ALTER TABLE %s ADD COLUMN IF NOT EXISTS %s %s',
                self::TABLE,
                $column,
                $definition
            ));
        }

        $pdo->exec(sprintf(
            'CREATE UNIQUE INDEX IF NOT EXISTS glpi_intega_configs_context_uq ON %s (context)',
            self::TABLE
        ));
    }

    /**
     * @return array<string, string>
     */
    private static function columnDefinitions(): array
    {
        return [
            'menu_message' => 'TEXT NULL',
            'invalid_option_message' => 'TEXT NULL',
            'invalid_media_message' => 'TEXT NULL',
            'error_fallback_message' => 'TEXT NULL',
            'ticket_created_message' => 'TEXT NULL',
            'conversation_closed_message' => 'TEXT NULL',
            'after_hours_message' => 'TEXT NULL',
            'contact_profile_collection_enabled' => 'TEXT NULL',
            'contact_profile_prompt_mode' => 'TEXT NULL',
            'contact_profile_require_company' => 'TEXT NULL',
            'contact_profile_require_name' => 'TEXT NULL',
            'contact_profile_require_equipment' => 'TEXT NULL',
            'contact_profile_require_summary' => 'TEXT NULL',
            'contact_profile_confirmation_enabled' => 'TEXT NULL',
            'contact_profile_use_buttons' => 'TEXT NULL',
            'ticket_title_enrichment_enabled' => 'TEXT NULL',
            'contact_profile_initial_prompt' => 'TEXT NULL',
            'contact_profile_require_email' => 'TEXT NULL',
            'contact_profile_prompt_email' => 'TEXT NULL',
            'contact_profile_prompt_name' => 'TEXT NULL',
            'contact_profile_prompt_company' => 'TEXT NULL',
            'contact_profile_prompt_equipment' => 'TEXT NULL',
            'contact_profile_prompt_summary' => 'TEXT NULL',
            'contact_profile_confirm_message' => 'TEXT NULL',
            'profile_initial_prompt' => 'TEXT NULL',
            'profile_ask_company' => 'TEXT NULL',
            'profile_ask_name' => 'TEXT NULL',
            'profile_ask_email' => 'TEXT NULL',
            'profile_ask_equipment' => 'TEXT NULL',
            'profile_ask_summary' => 'TEXT NULL',
            'profile_confirmation_message' => 'TEXT NULL',
            'profile_success_message' => 'TEXT NULL',
            'profile_change_message' => 'TEXT NULL',
            'profile_partial_continue_message' => 'TEXT NULL',
            'entity_resolution_mode' => 'TEXT NULL',
            'default_glpi_entity_id' => 'BIGINT NULL',
            'triage_entity_id' => 'BIGINT NULL',
            'entity_selection_timeout_hours' => 'INTEGER NULL',
        ];
    }

    /**
     * @param array<string, mixed> $values
     * @return array<string, mixed>
     */
    private static function filterKnownMessageValues(array $values): array
    {
        $keys = [
            'menu_message',
            'invalid_option_message',
            'invalid_media_message',
            'error_fallback_message',
            'ticket_created_message',
            'conversation_closed_message',
            'after_hours_message',
        ];

        return array_intersect_key($values, array_flip($keys));
    }

    /**
     * @param array<string, mixed> $values
     * @return array<string, mixed>
     */
    private static function normalizeContactProfileValues(array $values): array
    {
        unset($values['context']);
        unset($values['entity_resolution_mode']);

        $initialPrompt = trim((string) ($values['contact_profile_initial_prompt'] ?? ''));
        $namePrompt = (string) ($values['contact_profile_prompt_name'] ?? '');
        $companyPrompt = (string) ($values['contact_profile_prompt_company'] ?? '');
        $emailPrompt = (string) ($values['contact_profile_prompt_email'] ?? '');
        $equipmentPrompt = (string) ($values['contact_profile_prompt_equipment'] ?? '');
        $summaryPrompt = (string) ($values['contact_profile_prompt_summary'] ?? '');
        $confirmationMessage = (string) ($values['contact_profile_confirm_message'] ?? '');

        return [
            ...$values,
            // profile_initial_prompt: use configured value; fall back to hardcoded default only when empty.
            'profile_initial_prompt' => $initialPrompt !== '' ? $initialPrompt : self::defaultInitialPrompt(),
            'profile_ask_name' => $namePrompt,
            'profile_ask_email' => $emailPrompt,
            'profile_ask_company' => $companyPrompt,
            'profile_ask_equipment' => $equipmentPrompt,
            'profile_ask_summary' => $summaryPrompt,
            'profile_confirmation_message' => $confirmationMessage,
            'profile_success_message' => 'Dados registrados. Vamos abrir seu chamado.',
            'profile_change_message' => 'Certo, envie os dados corrigidos para atualizar o atendimento.',
            'profile_partial_continue_message' => 'Vamos continuar com as informações disponíveis.',
        ];
    }

    private static function defaultInitialPrompt(): string
    {
        return implode("\n", [
            'Perfeito! Vou agilizar seu atendimento.',
            '',
            'Envie em uma unica mensagem:',
            'Empresa ou unidade, seu nome, etiqueta/patrimonio se souber, e um resumo curto do problema.',
            '',
            'Se nao souber a etiqueta, pode escrever "nao sei".',
        ]);
    }

    /**
     * @param array<string, mixed> $values
     */
    private static function upsertContext(PDO $pdo, string $context, array $values): void
    {
        $columns = array_keys($values);
        $assignments = [];
        $placeholders = [':context'];
        $params = [':context' => $context];

        foreach ($columns as $column) {
            $placeholder = ':' . $column;
            $placeholders[] = $placeholder;
            $assignments[] = sprintf('%s = EXCLUDED.%s', $column, $column);
            $params[$placeholder] = $values[$column];
        }

        $sql = sprintf(
            'INSERT INTO %s (context, %s) VALUES (%s) ON CONFLICT (context) DO UPDATE SET %s, updated_at = NOW()',
            self::TABLE,
            implode(', ', $columns),
            implode(', ', $placeholders),
            implode(', ', $assignments)
        );

        $statement = $pdo->prepare($sql);
        $statement->execute($params);
    }

    /**
     * @param array<string, mixed> $values
     */
    private static function syncEntityResolutionSettings(PDO $pdo, array $values): void
    {
        self::upsertContext($pdo, 'entity_resolution', [
            'entity_resolution_mode' => self::normalizeEntityResolutionMode(
                (string) ($values['entity_resolution_mode'] ?? '')
            ),
        ]);
    }

    private static function normalizeEntityResolutionMode(string $value): string
    {
        return 'defer_until_known';
    }
}
