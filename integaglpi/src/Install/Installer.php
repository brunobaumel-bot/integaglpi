<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi\Install;

use Migration;
use Throwable;

final class Installer
{
    /**
     * Per-request guard so the runtime self-heal performs at most one
     * fieldExists() check (and at most one ALTER) per PHP process.
     */
    private static bool $schemaEnsuredThisRequest = false;

    public static function install(): void
    {
        global $DB;

        $migration = new Migration(PLUGIN_INTEGAGLPI_VERSION);
        $table = PLUGIN_INTEGAGLPI_CONFIG_TABLE;

        // GLPI 11 blocks direct `$DB->query()` usage in plugins. Use Migration queues instead.
        if (!$DB->tableExists($table)) {
            $migration->displayMessage("Creating {$table}");
            $migration->addPostQuery(
                <<<SQL
                CREATE TABLE IF NOT EXISTS {$table} (
                    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
                    db_host VARCHAR(255) NOT NULL DEFAULT '',
                    db_port INT UNSIGNED NOT NULL DEFAULT 5432,
                    db_name VARCHAR(255) NOT NULL DEFAULT '',
                    db_user VARCHAR(255) NOT NULL DEFAULT '',
                    db_password TEXT DEFAULT NULL,
                    db_sslmode VARCHAR(32) NOT NULL DEFAULT 'prefer',
                    integration_auth_key TEXT DEFAULT NULL,
                    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    PRIMARY KEY (id)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
                SQL
            );
        } elseif (!$DB->fieldExists($table, 'integration_auth_key')) {
            // Phase 7.4C: idempotent column addition on existing installs.
            // Replaces the previous hardcoded constant in IntegrationServiceClient.
            $migration->displayMessage("Adding integration_auth_key column to {$table}");
            $migration->addPostQuery(
                <<<SQL
                ALTER TABLE {$table}
                ADD COLUMN integration_auth_key TEXT DEFAULT NULL
                SQL
            );
        }

        $migration->executeMigration();
        self::$schemaEnsuredThisRequest = true;
    }

    /**
     * Runtime self-heal for the integration_auth_key column.
     *
     * Why this exists: GLPI only invokes plugin_integaglpi_install() when the
     * operator clicks "Install/Upgrade" in the plugins admin UI. Since the
     * plugin version did not change with Phase 7.4C, existing deployments never
     * see that button — install() never runs again — and the column added by
     * the migration is silently missing. Without it, IntegrationServiceClient
     * cannot resolve the auth key from config and saveConnectionConfig() fails
     * with an SQL error.
     *
     * This method is invoked from plugin_init_integaglpi() on every request,
     * but a static flag short-circuits all calls after the first per process.
     * It is idempotent (no-op when the column already exists), preserves all
     * existing data (NULL default), tolerates concurrent ALTERs (ignores the
     * "Duplicate column" error, code 1060), and never throws — schema problems
     * are logged but the request continues normally.
     */
    public static function ensureSchemaUpToDate(): void
    {
        global $DB;

        if (self::$schemaEnsuredThisRequest) {
            return;
        }
        self::$schemaEnsuredThisRequest = true;

        if (!isset($DB) || !is_object($DB) || !defined('PLUGIN_INTEGAGLPI_CONFIG_TABLE')) {
            return;
        }

        $table = PLUGIN_INTEGAGLPI_CONFIG_TABLE;

        try {
            // Fresh installs have no table yet — install() will create it with
            // the column already present when the operator activates the plugin.
            if (!$DB->tableExists($table)) {
                return;
            }

            if ($DB->fieldExists($table, 'integration_auth_key')) {
                return;
            }

            // Idempotent ADD COLUMN. doQuery() is the GLPI 11 replacement for
            // the deprecated query(); the legacy query() block is what plugins
            // are forbidden from using, not doQuery().
            $sql = "ALTER TABLE `{$table}` "
                . "ADD COLUMN `integration_auth_key` TEXT DEFAULT NULL";
            $result = @$DB->doQuery($sql);

            if ($result) {
                error_log(sprintf(
                    '[integaglpi][installer][ensureSchema] integration_auth_key column added to %s',
                    $table
                ));
                return;
            }

            // Race tolerated: two concurrent requests may both pass fieldExists()
            // and both attempt the ALTER. MySQL serializes DDL; the loser gets
            // error 1060 ("Duplicate column name"), which means the column is
            // now present — exactly the desired end state.
            $errorMessage = (string) $DB->error();
            if (
                str_contains($errorMessage, '1060')
                || stripos($errorMessage, 'Duplicate column') !== false
            ) {
                return;
            }

            error_log(sprintf(
                '[integaglpi][installer][ensureSchema] ALTER failed on %s: %s',
                $table,
                $errorMessage
            ));
        } catch (Throwable $exception) {
            // Never break a request because of a schema self-heal failure.
            error_log('[integaglpi][installer][ensureSchema] ' . $exception->getMessage());
        }
    }

    public static function uninstall(): void
    {
        $migration = new Migration(PLUGIN_INTEGAGLPI_VERSION);
        $migration->displayMessage('Dropping plugin configuration table');
        $migration->dropTable(PLUGIN_INTEGAGLPI_CONFIG_TABLE);
    }
}
