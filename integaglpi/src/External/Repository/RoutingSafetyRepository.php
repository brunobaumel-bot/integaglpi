<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi\External\Repository;

use PDO;

final class RoutingSafetyRepository
{
    public function __construct(private readonly PDO $pdo)
    {
    }

    /**
     * @return array<string, mixed>
     */
    public function getRoutingConfig(): array
    {
        $statement = $this->pdo->query(
            <<<SQL
            SELECT
                c.fallback_queue_id,
                c.fallback_glpi_group_id,
                c.fallback_enabled,
                c.max_invalid_queue_attempts,
                q.name AS fallback_queue_name,
                q.is_active AS fallback_queue_active
            FROM glpi_plugin_integaglpi_configs c
            LEFT JOIN glpi_plugin_integaglpi_queues q ON q.id = c.fallback_queue_id
            WHERE c.context = 'routing'
            LIMIT 1
            SQL
        );
        $row = $statement->fetch(PDO::FETCH_ASSOC);

        return is_array($row) ? $this->normalizeConfigRow($row) : [
            'fallback_queue_id' => null,
            'fallback_glpi_group_id' => null,
            'fallback_enabled' => false,
            'max_invalid_queue_attempts' => 3,
            'fallback_queue_name' => null,
            'fallback_queue_active' => null,
        ];
    }

    /**
     * @param array<string, mixed> $payload
     */
    public function saveRoutingConfig(array $payload): void
    {
        $statement = $this->pdo->prepare(
            <<<SQL
            INSERT INTO glpi_plugin_integaglpi_configs (
                context,
                fallback_queue_id,
                fallback_glpi_group_id,
                fallback_enabled,
                max_invalid_queue_attempts
            )
            VALUES (
                'routing',
                :fallback_queue_id,
                :fallback_glpi_group_id,
                :fallback_enabled,
                :max_invalid_queue_attempts
            )
            ON CONFLICT (context) DO UPDATE
            SET
                fallback_queue_id = EXCLUDED.fallback_queue_id,
                fallback_glpi_group_id = EXCLUDED.fallback_glpi_group_id,
                fallback_enabled = EXCLUDED.fallback_enabled,
                max_invalid_queue_attempts = EXCLUDED.max_invalid_queue_attempts,
                updated_at = NOW()
            SQL
        );
        $statement->execute([
            ':fallback_queue_id' => $payload['fallback_queue_id'],
            ':fallback_glpi_group_id' => $payload['fallback_glpi_group_id'],
            ':fallback_enabled' => !empty($payload['fallback_enabled']) ? 'true' : 'false',
            ':max_invalid_queue_attempts' => $payload['max_invalid_queue_attempts'],
        ]);
    }

    public function activeQueueExists(int $queueId): bool
    {
        $statement = $this->pdo->prepare(
            'SELECT 1 FROM glpi_plugin_integaglpi_queues WHERE id = :queue_id AND is_active = TRUE LIMIT 1'
        );
        $statement->execute([':queue_id' => $queueId]);

        return $statement->fetchColumn() !== false;
    }

    /**
     * @return list<array<string, mixed>>
     */
    public function findRoutingOptionsForValidation(): array
    {
        $statement = $this->pdo->query(
            <<<SQL
            SELECT
                ro.id,
                ro.option_key,
                ro.label,
                ro.queue_id,
                ro.glpi_group_id,
                ro.glpi_user_id,
                ro.is_active,
                q.name AS queue_name,
                q.is_active AS queue_is_active
            FROM glpi_plugin_integaglpi_routing_options ro
            LEFT JOIN glpi_plugin_integaglpi_queues q ON q.id = ro.queue_id
            ORDER BY ro.is_active DESC, ro.sort_order ASC, ro.label ASC
            LIMIT 200
            SQL
        );
        $rows = $statement->fetchAll(PDO::FETCH_ASSOC);

        return is_array($rows) ? array_map(fn (array $row): array => $this->normalizeOptionRow($row), $rows) : [];
    }

    /**
     * @return list<array<string, mixed>>
     */
    public function findAbandonedAwaitingQueue(int $hours = 24, int $limit = 50): array
    {
        $statement = $this->pdo->prepare(
            <<<SQL
            SELECT
                id,
                phone_e164,
                status,
                glpi_ticket_id,
                invalid_queue_attempts,
                last_message_at,
                updated_at
            FROM glpi_plugin_integaglpi_conversations
            WHERE status = 'awaiting_queue_selection'
              AND glpi_ticket_id IS NULL
              AND updated_at < NOW() - (:hours * INTERVAL '1 hour')
            ORDER BY updated_at ASC
            LIMIT :limit
            SQL
        );
        $statement->bindValue(':hours', $hours, PDO::PARAM_INT);
        $statement->bindValue(':limit', $limit, PDO::PARAM_INT);
        $statement->execute();
        $rows = $statement->fetchAll(PDO::FETCH_ASSOC);

        return is_array($rows) ? $rows : [];
    }

    /**
     * @return list<array<string, mixed>>
     */
    public function findRecentRoutingEvents(int $days = 7, int $limit = 50): array
    {
        $eventTypes = [
            'QUEUE_CONFIG_INVALID',
            'QUEUE_SELECTION_INVALID',
            'QUEUE_INVALID_ATTEMPT_RECORDED',
            'QUEUE_INVALID_ATTEMPT_LIMIT_REACHED',
            'QUEUE_FALLBACK_USED',
            'QUEUE_FALLBACK_FAILED',
            'QUEUE_SELECTION_DUPLICATED',
            'ROUTING_GROUP_MISSING',
            'TICKET_CREATED_WITHOUT_QUEUE',
        ];
        $placeholders = implode(', ', array_fill(0, count($eventTypes), '?'));
        $statement = $this->pdo->prepare(
            <<<SQL
            SELECT
                created_at,
                correlation_id,
                ticket_id,
                conversation_id,
                message_id,
                event_type,
                status,
                severity,
                source
            FROM glpi_plugin_integaglpi_audit_events
            WHERE created_at >= NOW() - (? * INTERVAL '1 day')
              AND event_type IN ($placeholders)
            ORDER BY created_at DESC
            LIMIT ?
            SQL
        );
        $params = array_merge([$days], $eventTypes, [$limit]);
        $statement->execute($params);
        $rows = $statement->fetchAll(PDO::FETCH_ASSOC);

        return is_array($rows) ? $rows : [];
    }

    /**
     * @param array<string, mixed> $row
     * @return array<string, mixed>
     */
    private function normalizeConfigRow(array $row): array
    {
        $row['fallback_queue_id'] = $row['fallback_queue_id'] !== null ? (int) $row['fallback_queue_id'] : null;
        $row['fallback_glpi_group_id'] = $row['fallback_glpi_group_id'] !== null
            ? (int) $row['fallback_glpi_group_id']
            : null;
        $row['fallback_enabled'] = $this->toBool($row['fallback_enabled'] ?? false);
        $row['fallback_queue_active'] = $row['fallback_queue_active'] === null
            ? null
            : $this->toBool($row['fallback_queue_active']);
        $row['max_invalid_queue_attempts'] = max(1, (int) ($row['max_invalid_queue_attempts'] ?? 3));

        return $row;
    }

    /**
     * @param array<string, mixed> $row
     * @return array<string, mixed>
     */
    private function normalizeOptionRow(array $row): array
    {
        foreach (['id', 'queue_id', 'glpi_group_id', 'glpi_user_id'] as $field) {
            $row[$field] = $row[$field] !== null ? (int) $row[$field] : null;
        }
        $row['is_active'] = $this->toBool($row['is_active'] ?? false);
        $row['queue_is_active'] = $row['queue_is_active'] === null ? null : $this->toBool($row['queue_is_active']);

        return $row;
    }

    private function toBool(mixed $value): bool
    {
        return in_array($value, [true, 1, '1', 't', 'true'], true);
    }
}
