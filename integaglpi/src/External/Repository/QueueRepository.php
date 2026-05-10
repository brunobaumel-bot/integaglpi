<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi\External\Repository;

use PDO;
use RuntimeException;

final class QueueRepository
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
                q.id,
                q.name,
                q.description,
                q.is_active,
                q.default_group_id,
                q.created_at,
                q.updated_at,
                COALESCE(qu.users_count, 0) AS users_count,
                COALESCE(qg.groups_count, 0) AS groups_count
            FROM glpi_plugin_integaglpi_queues q
            LEFT JOIN (
                SELECT queue_id, COUNT(*) AS users_count
                FROM glpi_plugin_integaglpi_queue_users
                GROUP BY queue_id
            ) qu ON qu.queue_id = q.id
            LEFT JOIN (
                SELECT queue_id, COUNT(*) AS groups_count
                FROM glpi_plugin_integaglpi_queue_groups
                GROUP BY queue_id
            ) qg ON qg.queue_id = q.id
            ORDER BY q.name ASC
            SQL
        );

        $rows = $statement->fetchAll();

        if (!is_array($rows)) {
            return [];
        }

        return array_map(
            fn (array $row): array => $this->normalizeQueueRow($row),
            $rows
        );
    }

    /**
     * @return list<array<string, mixed>>
     */
    public function findActive(): array
    {
        $statement = $this->pdo->query(
            <<<SQL
            SELECT
                q.id,
                q.name,
                q.description,
                q.is_active,
                q.default_group_id,
                q.created_at,
                q.updated_at,
                COALESCE(qu.users_count, 0) AS users_count,
                COALESCE(qg.groups_count, 0) AS groups_count
            FROM glpi_plugin_integaglpi_queues q
            LEFT JOIN (
                SELECT queue_id, COUNT(*) AS users_count
                FROM glpi_plugin_integaglpi_queue_users
                GROUP BY queue_id
            ) qu ON qu.queue_id = q.id
            LEFT JOIN (
                SELECT queue_id, COUNT(*) AS groups_count
                FROM glpi_plugin_integaglpi_queue_groups
                GROUP BY queue_id
            ) qg ON qg.queue_id = q.id
            WHERE q.is_active = TRUE
            ORDER BY q.name ASC
            SQL
        );

        $rows = $statement->fetchAll();

        if (!is_array($rows)) {
            return [];
        }

        return array_map(
            fn (array $row): array => $this->normalizeQueueRow($row),
            $rows
        );
    }

    /**
     * @return array<string, mixed>|null
     */
    public function findById(int $queueId): ?array
    {
        $statement = $this->pdo->prepare(
            <<<SQL
            SELECT
                q.id,
                q.name,
                q.description,
                q.is_active,
                q.default_group_id,
                q.created_at,
                q.updated_at,
                COALESCE(qu.users_count, 0) AS users_count,
                COALESCE(qg.groups_count, 0) AS groups_count
            FROM glpi_plugin_integaglpi_queues q
            LEFT JOIN (
                SELECT queue_id, COUNT(*) AS users_count
                FROM glpi_plugin_integaglpi_queue_users
                GROUP BY queue_id
            ) qu ON qu.queue_id = q.id
            LEFT JOIN (
                SELECT queue_id, COUNT(*) AS groups_count
                FROM glpi_plugin_integaglpi_queue_groups
                GROUP BY queue_id
            ) qg ON qg.queue_id = q.id
            WHERE q.id = :queue_id
            LIMIT 1
            SQL
        );
        $statement->execute([
            ':queue_id' => $queueId,
        ]);

        $row = $statement->fetch();

        return is_array($row) ? $this->normalizeQueueRow($row) : null;
    }

    public function save(array $payload, ?int $queueId = null): int
    {
        if ($queueId !== null && $queueId > 0) {
            if ($this->findById($queueId) === null) {
                throw new RuntimeException(__('Queue update failed: queue not found.', 'glpiintegaglpi'));
            }

            $statement = $this->pdo->prepare(
                <<<SQL
                UPDATE glpi_plugin_integaglpi_queues
                SET
                    name = :name,
                    description = :description,
                    is_active = :is_active,
                    default_group_id = :default_group_id,
                    updated_at = NOW()
                WHERE id = :queue_id
                SQL
            );
            $ok = $statement->execute([
                ':name'             => $payload['name'],
                ':description'      => $payload['description'],
                ':is_active'        => $payload['is_active'],
                ':default_group_id' => $payload['default_group_id'],
                ':queue_id'         => $queueId,
            ]);

            if ($ok === false || (int) $statement->rowCount() <= 0) {
                throw new RuntimeException(__('Queue update failed: no row was updated.', 'glpiintegaglpi'));
            }

            return $queueId;
        }

        $statement = $this->pdo->prepare(
            <<<SQL
            INSERT INTO glpi_plugin_integaglpi_queues (
                name,
                description,
                is_active,
                default_group_id
            )
            VALUES (
                :name,
                :description,
                :is_active,
                :default_group_id
            )
            RETURNING id
            SQL
        );
        $ok = $statement->execute([
            ':name'             => $payload['name'],
            ':description'      => $payload['description'],
            ':is_active'        => $payload['is_active'],
            ':default_group_id' => $payload['default_group_id'],
        ]);

        if ($ok === false) {
            error_log('[integaglpi][queue][insert] success=false');
            throw new RuntimeException(__('Queue creation failed: insert did not execute.', 'glpiintegaglpi'));
        }

        $newQueueId = (int) $statement->fetchColumn();
        if ($newQueueId <= 0) {
            error_log('[integaglpi][queue][insert] success=true id=0');
            throw new RuntimeException(__('Queue creation failed: no generated identifier.', 'glpiintegaglpi'));
        }

        error_log('[integaglpi][queue][insert] success=true id=' . $newQueueId);
        return $newQueueId;
    }

    public function delete(int $queueId): void
    {
        $statement = $this->pdo->prepare('DELETE FROM glpi_plugin_integaglpi_queues WHERE id = :queue_id');
        $statement->execute([
            ':queue_id' => $queueId,
        ]);
    }

    public function assignUser(int $queueId, int $userId): void
    {
        $statement = $this->pdo->prepare(
            <<<SQL
            INSERT INTO glpi_plugin_integaglpi_queue_users (
                queue_id,
                users_id
            )
            VALUES (
                :queue_id,
                :users_id
            )
            ON CONFLICT (queue_id, users_id) DO NOTHING
            SQL
        );
        $statement->execute([
            ':queue_id' => $queueId,
            ':users_id' => $userId,
        ]);
    }

    public function removeUser(int $queueId, int $userId): void
    {
        $statement = $this->pdo->prepare(
            'DELETE FROM glpi_plugin_integaglpi_queue_users WHERE queue_id = :queue_id AND users_id = :users_id'
        );
        $statement->execute([
            ':queue_id' => $queueId,
            ':users_id' => $userId,
        ]);
    }

    public function assignGroup(int $queueId, int $groupId): void
    {
        $statement = $this->pdo->prepare(
            <<<SQL
            INSERT INTO glpi_plugin_integaglpi_queue_groups (
                queue_id,
                groups_id
            )
            VALUES (
                :queue_id,
                :groups_id
            )
            ON CONFLICT (queue_id, groups_id) DO NOTHING
            SQL
        );
        $statement->execute([
            ':queue_id'  => $queueId,
            ':groups_id' => $groupId,
        ]);
    }

    public function removeGroup(int $queueId, int $groupId): void
    {
        $statement = $this->pdo->prepare(
            'DELETE FROM glpi_plugin_integaglpi_queue_groups WHERE queue_id = :queue_id AND groups_id = :groups_id'
        );
        $statement->execute([
            ':queue_id'  => $queueId,
            ':groups_id' => $groupId,
        ]);
    }

    /**
     * @return list<array<string, mixed>>
     */
    public function findUsers(int $queueId): array
    {
        $statement = $this->pdo->prepare(
            <<<SQL
            SELECT
                id,
                queue_id,
                users_id,
                created_at
            FROM glpi_plugin_integaglpi_queue_users
            WHERE queue_id = :queue_id
            ORDER BY users_id ASC
            SQL
        );
        $statement->execute([
            ':queue_id' => $queueId,
        ]);

        $rows = $statement->fetchAll();

        return is_array($rows) ? $rows : [];
    }

    /**
     * @return list<array<string, mixed>>
     */
    public function findGroups(int $queueId): array
    {
        $statement = $this->pdo->prepare(
            <<<SQL
            SELECT
                id,
                queue_id,
                groups_id,
                created_at
            FROM glpi_plugin_integaglpi_queue_groups
            WHERE queue_id = :queue_id
            ORDER BY groups_id ASC
            SQL
        );
        $statement->execute([
            ':queue_id' => $queueId,
        ]);

        $rows = $statement->fetchAll();

        return is_array($rows) ? $rows : [];
    }

    /**
     * @param array<string, mixed> $row
     * @return array<string, mixed>
     */
    private function normalizeQueueRow(array $row): array
    {
        $row['is_active'] = in_array($row['is_active'] ?? false, [true, 1, '1', 't', 'true'], true);

        return $row;
    }
}
