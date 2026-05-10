<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi\External\Repository;

use PDO;
use RuntimeException;

final class RoutingOptionRepository
{
    public function __construct(private readonly PDO $pdo)
    {
    }

    /**
     * @return list<array<string, mixed>>
     */
    public function findAll(): array
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
                ro.sort_order,
                ro.confirmation_message,
                ro.created_at,
                ro.updated_at,
                q.name AS queue_name
            FROM glpi_plugin_integaglpi_routing_options ro
            LEFT JOIN glpi_plugin_integaglpi_queues q ON q.id = ro.queue_id
            ORDER BY ro.sort_order ASC, ro.label ASC
            SQL
        );

        $rows = $statement->fetchAll(PDO::FETCH_ASSOC);

        return is_array($rows)
            ? array_map(fn (array $row): array => $this->normalizeRow($row), $rows)
            : [];
    }

    /**
     * @return list<array<string, mixed>>
     */
    public function findActive(): array
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
                ro.sort_order,
                ro.confirmation_message,
                ro.created_at,
                ro.updated_at,
                q.name AS queue_name
            FROM glpi_plugin_integaglpi_routing_options ro
            LEFT JOIN glpi_plugin_integaglpi_queues q ON q.id = ro.queue_id
            WHERE ro.is_active = TRUE
            ORDER BY ro.sort_order ASC, ro.label ASC
            SQL
        );

        $rows = $statement->fetchAll(PDO::FETCH_ASSOC);

        return is_array($rows)
            ? array_map(fn (array $row): array => $this->normalizeRow($row), $rows)
            : [];
    }

    /**
     * @return array<string, mixed>|null
     */
    public function findById(int $id): ?array
    {
        $statement = $this->pdo->prepare(
            <<<SQL
            SELECT
                ro.id,
                ro.option_key,
                ro.label,
                ro.queue_id,
                ro.glpi_group_id,
                ro.glpi_user_id,
                ro.is_active,
                ro.sort_order,
                ro.confirmation_message,
                ro.created_at,
                ro.updated_at,
                q.name AS queue_name
            FROM glpi_plugin_integaglpi_routing_options ro
            LEFT JOIN glpi_plugin_integaglpi_queues q ON q.id = ro.queue_id
            WHERE ro.id = :id
            LIMIT 1
            SQL
        );
        $statement->execute([':id' => $id]);
        $row = $statement->fetch(PDO::FETCH_ASSOC);

        return is_array($row) ? $this->normalizeRow($row) : null;
    }

    /**
     * @param array<string, mixed> $payload
     */
    public function save(array $payload, ?int $id = null): int
    {
        if ($id !== null && $id > 0) {
            if ($this->findById($id) === null) {
                throw new RuntimeException(__('Routing option not found for update.', 'glpiintegaglpi'));
            }

            $statement = $this->pdo->prepare(
                <<<SQL
                UPDATE glpi_plugin_integaglpi_routing_options
                SET
                    option_key           = :option_key,
                    label                = :label,
                    queue_id             = :queue_id,
                    glpi_group_id        = :glpi_group_id,
                    glpi_user_id         = :glpi_user_id,
                    is_active            = :is_active,
                    sort_order           = :sort_order,
                    confirmation_message = :confirmation_message,
                    updated_at           = NOW()
                WHERE id = :id
                SQL
            );
            $ok = $statement->execute([
                ':option_key'           => $payload['option_key'],
                ':label'                => $payload['label'],
                ':queue_id'             => $payload['queue_id'],
                ':glpi_group_id'        => $payload['glpi_group_id'],
                ':glpi_user_id'         => $payload['glpi_user_id'],
                ':is_active'            => $payload['is_active'] ? 'true' : 'false',
                ':sort_order'           => $payload['sort_order'],
                ':confirmation_message' => $payload['confirmation_message'],
                ':id'                   => $id,
            ]);

            if ($ok === false || $statement->rowCount() <= 0) {
                throw new RuntimeException(__('Routing option update failed.', 'glpiintegaglpi'));
            }

            return $id;
        }

        $statement = $this->pdo->prepare(
            <<<SQL
            INSERT INTO glpi_plugin_integaglpi_routing_options (
                option_key,
                label,
                queue_id,
                glpi_group_id,
                glpi_user_id,
                is_active,
                sort_order,
                confirmation_message
            )
            VALUES (
                :option_key,
                :label,
                :queue_id,
                :glpi_group_id,
                :glpi_user_id,
                :is_active,
                :sort_order,
                :confirmation_message
            )
            RETURNING id
            SQL
        );
        $ok = $statement->execute([
            ':option_key'           => $payload['option_key'],
            ':label'                => $payload['label'],
            ':queue_id'             => $payload['queue_id'],
            ':glpi_group_id'        => $payload['glpi_group_id'],
            ':glpi_user_id'         => $payload['glpi_user_id'],
            ':is_active'            => $payload['is_active'] ? 'true' : 'false',
            ':sort_order'           => $payload['sort_order'],
            ':confirmation_message' => $payload['confirmation_message'],
        ]);

        if ($ok === false) {
            throw new RuntimeException(__('Routing option creation failed.', 'glpiintegaglpi'));
        }

        $newId = (int) $statement->fetchColumn();
        if ($newId <= 0) {
            throw new RuntimeException(__('Routing option creation failed: no generated id.', 'glpiintegaglpi'));
        }

        return $newId;
    }

    public function delete(int $id): void
    {
        $statement = $this->pdo->prepare(
            'UPDATE glpi_plugin_integaglpi_routing_options SET is_active = FALSE, updated_at = NOW() WHERE id = :id'
        );
        $statement->execute([':id' => $id]);
    }

    public function queueExists(int $queueId): bool
    {
        $statement = $this->pdo->prepare(
            'SELECT 1 FROM glpi_plugin_integaglpi_queues WHERE id = :id LIMIT 1'
        );
        $statement->execute([':id' => $queueId]);

        return $statement->fetchColumn() !== false;
    }

    /**
     * @param array<string, mixed> $row
     * @return array<string, mixed>
     */
    private function normalizeRow(array $row): array
    {
        $row['is_active']     = in_array($row['is_active'] ?? false, [true, 1, '1', 't', 'true'], true);
        $row['sort_order']    = (int) ($row['sort_order'] ?? 0);
        $row['queue_id']      = isset($row['queue_id'])      && $row['queue_id']      !== null ? (int) $row['queue_id']      : null;
        $row['glpi_group_id'] = isset($row['glpi_group_id']) && $row['glpi_group_id'] !== null ? (int) $row['glpi_group_id'] : null;
        $row['glpi_user_id']  = isset($row['glpi_user_id'])  && $row['glpi_user_id']  !== null ? (int) $row['glpi_user_id']  : null;

        return $row;
    }
}
