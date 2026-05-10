<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi\External;

use PDO;

final class ExternalSchemaManager
{
    private static bool $schemaEnsured = false;

    public static function ensureSchema(PDO $pdo): void
    {
        if (self::$schemaEnsured) {
            return;
        }

        foreach (self::getQueries() as $query) {
            $pdo->exec($query);
        }

        self::$schemaEnsured = true;
    }

    /**
     * @return list<string>
     */
    private static function getQueries(): array
    {
        return [
            <<<SQL
            CREATE TABLE IF NOT EXISTS glpi_plugin_integaglpi_queues (
                id BIGSERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT NULL,
                is_active BOOLEAN NOT NULL DEFAULT TRUE,
                default_group_id BIGINT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            SQL,
            <<<SQL
            CREATE INDEX IF NOT EXISTS glpi_intega_queues_active_idx
            ON glpi_plugin_integaglpi_queues (is_active, name)
            SQL,
            <<<SQL
            CREATE TABLE IF NOT EXISTS glpi_plugin_integaglpi_queue_users (
                id BIGSERIAL PRIMARY KEY,
                queue_id BIGINT NOT NULL REFERENCES glpi_plugin_integaglpi_queues (id) ON DELETE CASCADE,
                users_id BIGINT NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                UNIQUE (queue_id, users_id)
            )
            SQL,
            <<<SQL
            CREATE TABLE IF NOT EXISTS glpi_plugin_integaglpi_queue_groups (
                id BIGSERIAL PRIMARY KEY,
                queue_id BIGINT NOT NULL REFERENCES glpi_plugin_integaglpi_queues (id) ON DELETE CASCADE,
                groups_id BIGINT NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                UNIQUE (queue_id, groups_id)
            )
            SQL,
            <<<SQL
            CREATE TABLE IF NOT EXISTS glpi_plugin_integaglpi_conversation_runtime (
                conversation_id TEXT PRIMARY KEY REFERENCES glpi_plugin_integaglpi_conversations (id) ON DELETE CASCADE,
                ticket_id BIGINT NOT NULL,
                queue_id BIGINT NULL REFERENCES glpi_plugin_integaglpi_queues (id) ON DELETE SET NULL,
                assigned_user_id BIGINT NULL,
                assigned_group_id BIGINT NULL,
                status TEXT NOT NULL DEFAULT 'open',
                claimed_at TIMESTAMPTZ NULL,
                transferred_at TIMESTAMPTZ NULL,
                closed_at TIMESTAMPTZ NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                UNIQUE (ticket_id)
            )
            SQL,
            <<<SQL
            CREATE INDEX IF NOT EXISTS glpi_intega_runtime_ticket_idx
            ON glpi_plugin_integaglpi_conversation_runtime (ticket_id)
            SQL,
            <<<SQL
            CREATE INDEX IF NOT EXISTS glpi_intega_runtime_queue_status_idx
            ON glpi_plugin_integaglpi_conversation_runtime (queue_id, status)
            SQL,
            <<<SQL
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
            )
            SQL,
            <<<SQL
            CREATE INDEX IF NOT EXISTS glpi_intega_routing_options_active_sort_idx
            ON glpi_plugin_integaglpi_routing_options (is_active, sort_order, label)
            SQL,
            <<<SQL
            CREATE TABLE IF NOT EXISTS glpi_plugin_integaglpi_notifications (
                id BIGSERIAL PRIMARY KEY,
                ticket_id BIGINT NOT NULL,
                conversation_id TEXT NOT NULL,
                event_type TEXT NOT NULL,
                event_item_id TEXT NULL,
                idempotency_key TEXT NOT NULL UNIQUE,
                sent_at TIMESTAMPTZ NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                error_message TEXT NULL
            )
            SQL,
            <<<SQL
            CREATE INDEX IF NOT EXISTS glpi_intega_notifications_ticket_idx
            ON glpi_plugin_integaglpi_notifications (ticket_id, event_type)
            SQL,
            // Phase 7.4C: cursor index for incremental message polling
            // (Central messages endpoint orders by conversation_id + created_at + id).
            // The messages table is owned by the Node integration-service; this index
            // is added defensively from the PHP side because the polling SQL lives in
            // the plugin. The DO block guards against the rare case where the table
            // does not yet exist (fresh deploy with Node started after PHP). Nowdoc
            // is used so PostgreSQL's `$$` block delimiters survive PHP unparsed.
            <<<'SQL'
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1
                    FROM pg_catalog.pg_class c
                    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
                    WHERE c.relname = 'glpi_plugin_integaglpi_messages'
                      AND n.nspname = current_schema()
                      AND c.relkind = 'r'
                ) THEN
                    CREATE INDEX IF NOT EXISTS idx_messages_conversation_cursor
                    ON glpi_plugin_integaglpi_messages (conversation_id, created_at, id);
                END IF;
            END
            $$
            SQL,
        ];
    }
}
