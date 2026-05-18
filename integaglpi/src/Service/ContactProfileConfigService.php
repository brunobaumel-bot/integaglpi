<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi\Service;

use GlpiPlugin\Integaglpi\Support\Db;
use RuntimeException;

/**
 * Persists and retrieves "Recepção Inteligente" (smart contact-profile collection)
 * settings.  All data is stored as a single row in the shared GLPI MySQL config
 * table using the 'contact_profile' context value.
 *
 * Boolean fields are stored as TINYINT(1) (0 / 1) and default to disabled.
 * Prompt text fields fall back to safe Portuguese defaults when empty.
 *
 * Schema columns are added idempotently on first access via ensureSchema()
 * (guarded by a static per-request flag so the fieldExists() overhead runs at
 * most once per PHP process).
 */
final class ContactProfileConfigService
{
    private const CONTEXT = 'contact_profile';

    /**
     * Boolean feature toggles and safe defaults. Collection stays disabled by
     * default; field requirements are ready for use only when the feature is
     * explicitly enabled.
     *
     * @var array<string, bool>
     */
    private const BOOLEAN_DEFAULTS = [
        'contact_profile_collection_enabled' => false,
        'contact_profile_require_company' => true,
        'contact_profile_require_name' => true,
        'contact_profile_require_equipment' => false,
        'contact_profile_require_summary' => true,
        'contact_profile_confirmation_enabled' => true,
        'contact_profile_use_buttons' => true,
        'ticket_title_enrichment_enabled' => true,
    ];

    private const PROMPT_MODE_FIELD = 'contact_profile_prompt_mode';
    private const PROMPT_MODE_DEFAULT = 'hybrid';
    private const ENTITY_RESOLUTION_MODE_FIELD = 'entity_resolution_mode';
    private const ENTITY_RESOLUTION_MODE_DEFAULT = 'defer_until_known';

    /**
     * @var list<string>
     */
    private const PROMPT_MODE_ALLOWED = ['hybrid', 'single_message', 'step_by_step'];

    /**
     * @var list<string>
     */
    private const ENTITY_RESOLUTION_MODE_ALLOWED = ['defer_until_known'];

    /**
     * Text prompt fields with their safe Portuguese defaults.
     *
     * @var array<string, string>
     */
    private const PROMPT_DEFAULTS = [
        'contact_profile_prompt_name'      => 'Por favor, informe seu nome completo.',
        'contact_profile_prompt_company'   => 'Por favor, informe o nome da sua empresa.',
        'contact_profile_prompt_equipment' => 'Por favor, informe o equipamento ou sistema com problema.',
        'contact_profile_prompt_summary'   => 'Descreva brevemente o problema que está enfrentando.',
        'contact_profile_confirm_message'  => 'Obrigado! Dados registrados. Continuando com seu atendimento...',
    ];

    private static bool $schemaEnsured = false;

    // -------------------------------------------------------------------------
    // Public API
    // -------------------------------------------------------------------------

    /**
     * Returns the current configuration merged with safe defaults.
     *
     * @return array<string, mixed>
     */
    public function getConfig(): array
    {
        $this->ensureSchema();

        $row = Db::fetchOne([
            'FROM'  => PLUGIN_INTEGAGLPI_CONFIG_TABLE,
            'WHERE' => ['context' => self::CONTEXT],
        ]) ?? [];

        return $this->buildConfig($row);
    }

    /**
     * Validates and persists the Recepção Inteligente configuration.
     *
     * Boolean fields: checkbox convention — present + '1' → 1, absent → 0.
     * Prompt fields: empty input is replaced with the safe default.
     * Old configs (fields not in $input) are never overwritten with garbage;
     * the row is always a complete upsert of all known fields.
     *
     * @param array<string, mixed> $input  Raw $_POST (or equivalent) data.
     * @return string|null Warning when the external PostgreSQL sync could not be completed.
     * @throws RuntimeException On local GLPI database write failure.
     */
    public function saveConfig(array $input): ?string
    {
        $this->ensureSchema();

        $payload = ['context' => self::CONTEXT];

        // Checkbox fields: presence of key with value '1' → enabled; anything
        // else (absent, '0', empty string) → disabled.
        foreach (array_keys(self::BOOLEAN_DEFAULTS) as $field) {
            $payload[$field] = isset($input[$field]) && (string) $input[$field] === '1' ? 1 : 0;
        }

        $payload[self::PROMPT_MODE_FIELD] = $this->normalizePromptMode(
            (string) ($input[self::PROMPT_MODE_FIELD] ?? '')
        );
        $payload[self::ENTITY_RESOLUTION_MODE_FIELD] = $this->normalizeEntityResolutionMode(
            (string) ($input[self::ENTITY_RESOLUTION_MODE_FIELD] ?? '')
        );

        // Prompt text fields: sanitise and fall back to safe defaults.
        foreach (array_keys(self::PROMPT_DEFAULTS) as $field) {
            $value = trim((string) ($input[$field] ?? ''));
            $payload[$field] = $value !== '' ? $value : self::PROMPT_DEFAULTS[$field];
        }

        $current = Db::fetchOne([
            'FROM'  => PLUGIN_INTEGAGLPI_CONFIG_TABLE,
            'WHERE' => ['context' => self::CONTEXT],
        ]);
        $existingId = (int) ($current['id'] ?? 0);

        if ($existingId > 0) {
            if (!Db::update(PLUGIN_INTEGAGLPI_CONFIG_TABLE, $payload, ['id' => $existingId])) {
                throw new RuntimeException(
                    __('Failed to save Recepção Inteligente configuration.', 'glpiintegaglpi')
                );
            }

            return (new ExternalSettingsSyncService())->syncContactProfileSettings($payload);
        }

        if (!Db::insert(PLUGIN_INTEGAGLPI_CONFIG_TABLE, $payload)) {
            throw new RuntimeException(
                __('Failed to save Recepção Inteligente configuration.', 'glpiintegaglpi')
            );
        }

        return (new ExternalSettingsSyncService())->syncContactProfileSettings($payload);
    }

    // -------------------------------------------------------------------------
    // Private helpers
    // -------------------------------------------------------------------------

    /**
     * Merges a database row with type-safe defaults.
     *
     * @param array<string, mixed> $row
     * @return array<string, mixed>
     */
    private function buildConfig(array $row): array
    {
        $config = [];

        foreach (self::BOOLEAN_DEFAULTS as $field => $default) {
            // MySQL returns TINYINT as string '0'/'1'; cast to bool explicitly.
            $config[$field] = (bool) ($row[$field] ?? $default);
        }

        $config[self::PROMPT_MODE_FIELD] = $this->normalizePromptMode(
            (string) ($row[self::PROMPT_MODE_FIELD] ?? '')
        );
        $config[self::ENTITY_RESOLUTION_MODE_FIELD] = $this->normalizeEntityResolutionMode(
            (string) ($row[self::ENTITY_RESOLUTION_MODE_FIELD] ?? '')
        );

        foreach (self::PROMPT_DEFAULTS as $field => $default) {
            $value = trim((string) ($row[$field] ?? ''));
            $config[$field] = $value !== '' ? $value : $default;
        }

        return $config;
    }

    /**
     * Idempotently adds the contact-profile columns to the config table.
     *
     * Protected by a static flag so the DB round-trip runs at most once per
     * PHP process.  Never throws — schema failures are logged but do not break
     * the request.
     */
    private function ensureSchema(): void
    {
        global $DB;

        if (self::$schemaEnsured) {
            return;
        }
        self::$schemaEnsured = true;

        if (!isset($DB) || !is_object($DB) || !$DB->tableExists(PLUGIN_INTEGAGLPI_CONFIG_TABLE)) {
            return;
        }

        $table = PLUGIN_INTEGAGLPI_CONFIG_TABLE;

        $columns = [];

        foreach (array_keys(self::BOOLEAN_DEFAULTS) as $field) {
            $columns[$field] = "ALTER TABLE `{$table}` ADD COLUMN `{$field}` TINYINT(1) NOT NULL DEFAULT 0";
        }

        $columns[self::PROMPT_MODE_FIELD] =
            "ALTER TABLE `{$table}` ADD COLUMN `" . self::PROMPT_MODE_FIELD . "` VARCHAR(16) NOT NULL DEFAULT '" . self::PROMPT_MODE_DEFAULT . "'";
        $columns[self::ENTITY_RESOLUTION_MODE_FIELD] =
            "ALTER TABLE `{$table}` ADD COLUMN `" . self::ENTITY_RESOLUTION_MODE_FIELD . "` VARCHAR(32) NOT NULL DEFAULT '" . self::ENTITY_RESOLUTION_MODE_DEFAULT . "'";

        foreach (array_keys(self::PROMPT_DEFAULTS) as $field) {
            $columns[$field] = "ALTER TABLE `{$table}` ADD COLUMN `{$field}` TEXT DEFAULT NULL";
        }

        foreach ($columns as $column => $sql) {
            if ($DB->fieldExists($table, $column)) {
                continue;
            }

            $result = @$DB->doQuery($sql);
            if ($result) {
                error_log("[integaglpi][contact_profile][schema] added column {$column} to {$table}");
                continue;
            }

            $error = (string) $DB->error();
            // Error 1060 / "Duplicate column" means a concurrent request won the race — still OK.
            if (!str_contains($error, '1060') && stripos($error, 'Duplicate column') === false) {
                error_log("[integaglpi][contact_profile][schema] failed adding {$column}: {$error}");
            }
        }
    }

    private function normalizePromptMode(string $value): string
    {
        $normalized = trim(strtolower($value));
        if (!in_array($normalized, self::PROMPT_MODE_ALLOWED, true)) {
            return self::PROMPT_MODE_DEFAULT;
        }

        return $normalized;
    }

    private function normalizeEntityResolutionMode(string $value): string
    {
        $normalized = trim(strtolower($value));
        if ($normalized === 'use_triage_entity' || $normalized === 'use_default_entity') {
            return self::ENTITY_RESOLUTION_MODE_DEFAULT;
        }

        if (!in_array($normalized, self::ENTITY_RESOLUTION_MODE_ALLOWED, true)) {
            return self::ENTITY_RESOLUTION_MODE_DEFAULT;
        }

        return $normalized;
    }
}
