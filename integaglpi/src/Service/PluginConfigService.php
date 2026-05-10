<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi\Service;

use GlpiPlugin\Integaglpi\Support\Db;
use RuntimeException;

final class PluginConfigService
{
    private const CONTEXT_CONNECTION = 'connection';
    private const CONTEXT_MESSAGE = 'message';
    private const CONTEXT_INDEX = 'uniq_integaglpi_configs_context';
    private const MESSAGE_DEFAULTS = [
        'welcome_message' => 'Olá! Como podemos ajudar?',
        'menu_message' => 'Escolha uma das opções de atendimento.',
        'invalid_option_message' => 'Por favor, responda com uma opção válida do menu.',
        'invalid_media_message' => 'Por favor, envie uma resposta em texto para continuar.',
        'queue_selected_message' => 'Atendimento direcionado. Vamos continuar por aqui.',
        'after_hours_message' => 'Recebemos sua mensagem fora do horário de atendimento.',
        'conversation_closed_message' => 'Esta conversa foi encerrada. Envie uma nova mensagem para iniciar outro atendimento.',
        'error_fallback_message' => 'Não conseguimos processar sua resposta agora. Vamos encaminhar para atendimento.',
    ];

    private static bool $configSchemaEnsured = false;

    /**
     * @return array<string, mixed>
     */
    public function getConnectionConfig(): array
    {
        $this->ensureConfigSchema();

        $config = Db::fetchOne([
            'FROM' => PLUGIN_INTEGAGLPI_CONFIG_TABLE,
            'WHERE' => ['context' => self::CONTEXT_CONNECTION],
        ]);

        return $config ?? [
            'context' => self::CONTEXT_CONNECTION,
            'db_host' => '',
            'db_port' => 5432,
            'db_name' => '',
            'db_user' => '',
            'db_password' => '',
            'db_sslmode' => 'prefer',
            'integration_auth_key' => '',
        ];
    }

    public function getIntegrationAuthKey(): string
    {
        $config = $this->getConnectionConfig();

        return $this->normalizeString($config['integration_auth_key'] ?? null);
    }

    public function isConfigured(): bool
    {
        $config = $this->getConnectionConfig();

        return $this->normalizeString($config['db_host'] ?? null) !== ''
            && (int) ($config['db_port'] ?? 0) > 0
            && $this->normalizeString($config['db_name'] ?? null) !== ''
            && $this->normalizeString($config['db_user'] ?? null) !== '';
    }

    /**
     * @param array<string, mixed> $input
     */
    public function saveConnectionConfig(array $input): void
    {
        $this->ensureConfigSchema();

        $currentConfig = $this->getConnectionConfig();
        $passwordInput = $this->normalizeString($input['db_password'] ?? null);
        $authKeyInput = $this->normalizeString($input['integration_auth_key'] ?? null);
        $payload = [
            'context' => self::CONTEXT_CONNECTION,
            'db_host' => $this->requireNonEmptyString(
                $input['db_host'] ?? null,
                __('PostgreSQL host is required.', 'glpiintegaglpi')
            ),
            'db_port' => $this->requirePositiveInteger(
                $input['db_port'] ?? null,
                __('A valid PostgreSQL port is required.', 'glpiintegaglpi')
            ),
            'db_name' => $this->requireNonEmptyString(
                $input['db_name'] ?? null,
                __('PostgreSQL database name is required.', 'glpiintegaglpi')
            ),
            'db_user' => $this->requireNonEmptyString(
                $input['db_user'] ?? null,
                __('PostgreSQL user is required.', 'glpiintegaglpi')
            ),
            'db_password' => $passwordInput !== '' ? $passwordInput : (string) ($currentConfig['db_password'] ?? ''),
            'db_sslmode' => $this->normalizeSslMode($input['db_sslmode'] ?? null),
            'integration_auth_key' => $authKeyInput !== ''
                ? $authKeyInput
                : (string) ($currentConfig['integration_auth_key'] ?? ''),
        ];

        $existingId = (int) ($currentConfig['id'] ?? 0);

        if ($existingId > 0) {
            if (!Db::update(PLUGIN_INTEGAGLPI_CONFIG_TABLE, $payload, ['id' => $existingId])) {
                throw new RuntimeException(__('Failed to update the external PostgreSQL configuration. Check server logs for details.', 'glpiintegaglpi'));
            }
            return;
        }

        if (!Db::insert(PLUGIN_INTEGAGLPI_CONFIG_TABLE, $payload)) {
            throw new RuntimeException(__('Failed to save the external PostgreSQL configuration. Check server logs for details.', 'glpiintegaglpi'));
        }
    }

    /**
     * @return array<string, string>
     */
    public function getMessageConfig(): array
    {
        $this->ensureConfigSchema();

        $config = Db::fetchOne([
            'FROM' => PLUGIN_INTEGAGLPI_CONFIG_TABLE,
            'WHERE' => ['context' => self::CONTEXT_MESSAGE],
        ]);

        return $this->messageConfigFromRow($config ?? []);
    }

    /**
     * @param array<string, mixed> $input
     */
    public function saveMessageConfig(array $input): void
    {
        $this->ensureConfigSchema();

        $payload = ['context' => self::CONTEXT_MESSAGE];
        foreach (array_keys(self::MESSAGE_DEFAULTS) as $key) {
            $payload[$key] = $this->messageOrDefault($input[$key] ?? null, $key);
        }

        $current = Db::fetchOne([
            'FROM' => PLUGIN_INTEGAGLPI_CONFIG_TABLE,
            'WHERE' => ['context' => self::CONTEXT_MESSAGE],
        ]);
        $existingId = (int) ($current['id'] ?? 0);

        if ($existingId > 0) {
            if (!Db::update(PLUGIN_INTEGAGLPI_CONFIG_TABLE, $payload, ['id' => $existingId])) {
                throw new RuntimeException(__('Failed to update attendance messages.', 'glpiintegaglpi'));
            }
            return;
        }

        if (!Db::insert(PLUGIN_INTEGAGLPI_CONFIG_TABLE, $payload)) {
            throw new RuntimeException(__('Failed to save attendance messages.', 'glpiintegaglpi'));
        }
    }

    private function ensureConfigSchema(): void
    {
        global $DB;

        if (self::$configSchemaEnsured) {
            return;
        }
        self::$configSchemaEnsured = true;

        if (!isset($DB) || !is_object($DB) || !$DB->tableExists(PLUGIN_INTEGAGLPI_CONFIG_TABLE)) {
            return;
        }

        $table = PLUGIN_INTEGAGLPI_CONFIG_TABLE;
        $columns = [
            'context' => "ALTER TABLE `{$table}` ADD COLUMN `context` VARCHAR(64) NOT NULL DEFAULT 'connection' AFTER `id`",
        ];
        foreach (array_keys(self::MESSAGE_DEFAULTS) as $messageColumn) {
            $columns[$messageColumn] = "ALTER TABLE `{$table}` ADD COLUMN `{$messageColumn}` TEXT DEFAULT NULL";
        }

        foreach ($columns as $column => $sql) {
            if ($DB->fieldExists($table, $column)) {
                continue;
            }

            $result = @$DB->doQuery($sql);
            if (!$result) {
                $error = (string) $DB->error();
                if (!str_contains($error, '1060') && stripos($error, 'Duplicate column') === false) {
                    error_log("[integaglpi][config][schema] failed adding {$column}: {$error}");
                }
            }
        }

        if (!$DB->fieldExists($table, 'context')) {
            return;
        }

        @$DB->doQuery("UPDATE `{$table}` SET `context` = 'connection' WHERE `context` IS NULL OR `context` = ''");
        $this->ensureSingleContextRow(self::CONTEXT_CONNECTION);
        $this->ensureSingleContextRow(self::CONTEXT_MESSAGE);
        $this->ensureUniqueContextIndex();
    }

    /**
     * @param array<string, mixed> $row
     * @return array<string, string>
     */
    private function messageConfigFromRow(array $row): array
    {
        $messages = [];
        foreach (self::MESSAGE_DEFAULTS as $key => $default) {
            $messages[$key] = $this->normalizeString($row[$key] ?? null) ?: $default;
        }

        return $messages;
    }

    private function ensureSingleContextRow(string $context): void
    {
        $rows = Db::fetchAll([
            'FROM' => PLUGIN_INTEGAGLPI_CONFIG_TABLE,
            'WHERE' => ['context' => $context],
        ]);
        if (count($rows) <= 1) {
            return;
        }

        usort(
            $rows,
            static fn (array $left, array $right): int => (int) ($left['id'] ?? 0) <=> (int) ($right['id'] ?? 0)
        );

        array_shift($rows);
        foreach ($rows as $row) {
            $id = (int) ($row['id'] ?? 0);
            if ($id <= 0) {
                continue;
            }

            Db::update(
                PLUGIN_INTEGAGLPI_CONFIG_TABLE,
                ['context' => $context . '_duplicate_' . $id],
                ['id' => $id]
            );
        }
    }

    private function ensureUniqueContextIndex(): void
    {
        global $DB;

        $table = PLUGIN_INTEGAGLPI_CONFIG_TABLE;
        $result = @$DB->doQuery("SHOW INDEX FROM `{$table}` WHERE Key_name = '" . self::CONTEXT_INDEX . "'");
        if ($result && method_exists($DB, 'numrows') && $DB->numrows($result) > 0) {
            return;
        }

        $created = @$DB->doQuery(
            "ALTER TABLE `{$table}` ADD UNIQUE KEY `" . self::CONTEXT_INDEX . "` (`context`)"
        );
        if (!$created) {
            $error = (string) $DB->error();
            if (!str_contains($error, '1061') && stripos($error, 'Duplicate key name') === false) {
                error_log("[integaglpi][config][schema] failed adding unique context index: {$error}");
            }
        }
    }

    private function normalizeString(mixed $value): string
    {
        return trim((string) $value);
    }

    private function messageOrDefault(mixed $value, string $key): string
    {
        $message = $this->normalizeString($value);

        return $message !== '' ? $message : self::MESSAGE_DEFAULTS[$key];
    }

    private function requireNonEmptyString(mixed $value, string $message): string
    {
        $normalized = $this->normalizeString($value);

        if ($normalized === '') {
            throw new RuntimeException($message);
        }

        return $normalized;
    }

    private function requirePositiveInteger(mixed $value, string $message): int
    {
        $port = (int) $value;

        if ($port <= 0) {
            throw new RuntimeException($message);
        }

        return $port;
    }

    private function normalizeSslMode(mixed $value): string
    {
        $sslMode = $this->normalizeString($value);
        $allowed = ['disable', 'prefer', 'require'];

        if (!in_array($sslMode, $allowed, true)) {
            return 'prefer';
        }

        return $sslMode;
    }
}
