<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi\External\Repository;

use PDO;

final class ConversationRepository
{
    public function __construct(private readonly PDO $pdo)
    {
    }

    /**
     * @return array<string, mixed>|null
     */
    public function findByTicketId(int $ticketId): ?array
    {
        $statement = $this->pdo->prepare(
            <<<SQL
            SELECT
                c.id AS conversation_id,
                c.contact_id,
                c.phone_e164,
                c.glpi_ticket_id,
                c.status AS conversation_status,
                c.last_message_at,
                c.created_at AS conversation_created_at,
                c.updated_at AS conversation_updated_at,
                ct.name AS contact_name,
                rt.queue_id,
                rt.assigned_user_id,
                rt.assigned_group_id,
                rt.status AS runtime_status,
                rt.claimed_at,
                rt.transferred_at,
                rt.closed_at,
                rt.created_at AS runtime_created_at,
                rt.updated_at AS runtime_updated_at,
                q.name AS queue_name,
                q.default_group_id AS queue_default_group_id
            FROM glpi_plugin_integaglpi_conversations c
            LEFT JOIN glpi_plugin_integaglpi_contacts ct
                ON ct.id = c.contact_id
            LEFT JOIN glpi_plugin_integaglpi_conversation_runtime rt
                ON rt.conversation_id = c.id
            LEFT JOIN glpi_plugin_integaglpi_queues q
                ON q.id = rt.queue_id
            WHERE c.glpi_ticket_id = :ticket_id
            ORDER BY c.last_message_at DESC
            LIMIT 1
            SQL
        );
        $statement->execute([
            ':ticket_id' => $ticketId,
        ]);

        $row = $statement->fetch();

        return is_array($row) ? $row : null;
    }

    /**
     * @return array<string, mixed>|null
     */
    public function findBoundToTicket(int $ticketId, string $conversationId): ?array
    {
        $statement = $this->pdo->prepare(
            <<<SQL
            SELECT
                c.id AS conversation_id,
                c.contact_id,
                c.phone_e164,
                c.glpi_ticket_id,
                c.status AS conversation_status,
                c.last_message_at,
                ct.name AS contact_name,
                rt.queue_id,
                rt.assigned_user_id,
                rt.assigned_group_id,
                rt.status AS runtime_status,
                rt.claimed_at,
                rt.transferred_at,
                rt.closed_at,
                q.name AS queue_name,
                q.default_group_id AS queue_default_group_id
            FROM glpi_plugin_integaglpi_conversations c
            LEFT JOIN glpi_plugin_integaglpi_contacts ct
                ON ct.id = c.contact_id
            LEFT JOIN glpi_plugin_integaglpi_conversation_runtime rt
                ON rt.conversation_id = c.id
            LEFT JOIN glpi_plugin_integaglpi_queues q
                ON q.id = rt.queue_id
            WHERE c.glpi_ticket_id = :ticket_id
              AND c.id = :conversation_id
            LIMIT 1
            SQL
        );
        $statement->execute([
            ':ticket_id'       => $ticketId,
            ':conversation_id' => $conversationId,
        ]);

        $row = $statement->fetch();

        return is_array($row) ? $row : null;
    }

    /**
     * @param array<string, mixed> $conversation
     * @return array<string, mixed>
     */
    public function ensureRuntime(array $conversation): array
    {
        if (!empty($conversation['runtime_status'])) {
            return $conversation;
        }

        $insert = $this->pdo->prepare(
            <<<SQL
            INSERT INTO glpi_plugin_integaglpi_conversation_runtime (
                conversation_id,
                ticket_id,
                status
            )
            VALUES (
                :conversation_id,
                :ticket_id,
                :status
            )
            ON CONFLICT (conversation_id) DO NOTHING
            SQL
        );
        $insert->execute([
            ':conversation_id' => (string) $conversation['conversation_id'],
            ':ticket_id'       => (int) $conversation['glpi_ticket_id'],
            ':status'          => (string) ($conversation['conversation_status'] ?? 'open'),
        ]);

        return $this->findBoundToTicket(
            (int) $conversation['glpi_ticket_id'],
            (string) $conversation['conversation_id']
        ) ?? $conversation;
    }

    /**
     * @param array{status?: string, queue_id?: int|null, search?: string} $filters
     * @return list<array<string, mixed>>
     */
    public function findForAttendanceCenter(array $filters, int $limit, int $offset): array
    {
        [$whereSql, $params] = $this->buildAttendanceCenterWhere($filters);

        $statement = $this->pdo->prepare(
            <<<SQL
            SELECT
                c.id AS conversation_id,
                c.phone_e164,
                c.glpi_ticket_id,
                c.status AS conversation_status,
                c.last_message_at,
                c.updated_at AS conversation_updated_at,
                ct.name AS contact_name,
                COALESCE(rt.queue_id, c.queue_id) AS queue_id,
                rt.assigned_user_id,
                rt.assigned_group_id,
                rt.status AS runtime_status,
                rt.updated_at AS runtime_updated_at,
                q.name AS queue_name,
                c.last_message_at AS activity_at
            FROM glpi_plugin_integaglpi_conversations c
            LEFT JOIN glpi_plugin_integaglpi_contacts ct
                ON ct.id = c.contact_id
            LEFT JOIN glpi_plugin_integaglpi_conversation_runtime rt
                ON rt.conversation_id = c.id
            LEFT JOIN glpi_plugin_integaglpi_queues q
                ON q.id = COALESCE(rt.queue_id, c.queue_id)
            WHERE {$whereSql}
            ORDER BY c.last_message_at DESC NULLS LAST, c.updated_at DESC
            LIMIT :limit OFFSET :offset
            SQL
        );

        $this->bindAttendanceCenterParams($statement, $params);
        $statement->bindValue(':limit', $limit, PDO::PARAM_INT);
        $statement->bindValue(':offset', $offset, PDO::PARAM_INT);
        $statement->execute();

        $rows = $statement->fetchAll();

        return is_array($rows) ? $rows : [];
    }

    /**
     * @param array{status?: string, queue_id?: int|null, search?: string} $filters
     */
    public function countForAttendanceCenter(array $filters): int
    {
        [$whereSql, $params] = $this->buildAttendanceCenterWhere($filters);

        $statement = $this->pdo->prepare(
            <<<SQL
            SELECT COUNT(*)
            FROM glpi_plugin_integaglpi_conversations c
            LEFT JOIN glpi_plugin_integaglpi_conversation_runtime rt
                ON rt.conversation_id = c.id
            WHERE {$whereSql}
            SQL
        );

        $this->bindAttendanceCenterParams($statement, $params);
        $statement->execute();

        return (int) $statement->fetchColumn();
    }

    /**
     * @return list<array<string, mixed>>
     */
    public function findAttendanceQueues(): array
    {
        $statement = $this->pdo->prepare(
            <<<SQL
            SELECT
                id,
                name,
                is_active
            FROM glpi_plugin_integaglpi_queues
            ORDER BY name ASC
            SQL
        );
        $statement->execute();
        $rows = $statement->fetchAll();

        return is_array($rows) ? $rows : [];
    }

    public function claim(int $ticketId, string $conversationId, int $userId, ?int $groupId): void
    {
        $this->runInTransaction(function () use ($ticketId, $conversationId, $userId, $groupId): void {
            $statement = $this->pdo->prepare(
                <<<SQL
                UPDATE glpi_plugin_integaglpi_conversation_runtime
                SET
                    assigned_user_id = :assigned_user_id,
                    assigned_group_id = :assigned_group_id,
                    status = 'open',
                    claimed_at = NOW(),
                    updated_at = NOW()
                WHERE ticket_id = :ticket_id
                  AND conversation_id = :conversation_id
                SQL
            );
            $statement->execute([
                ':assigned_user_id'  => $userId,
                ':assigned_group_id' => $groupId,
                ':ticket_id'         => $ticketId,
                ':conversation_id'   => $conversationId,
            ]);

            $this->touchConversationStatus($ticketId, $conversationId, 'open');
        });
    }

    /**
     * Atomically claims an open conversation for the Attendance Center.
     *
     * @return array{status: string, row?: array<string, mixed>, assigned_user_id?: int}
     */
    public function claimForAttendanceCenter(int $ticketId, string $conversationId, int $userId): array
    {
        return $this->runInTransaction(function () use ($ticketId, $conversationId, $userId): array {
            $insert = $this->pdo->prepare(
                <<<SQL
                INSERT INTO glpi_plugin_integaglpi_conversation_runtime (
                    conversation_id,
                    ticket_id,
                    queue_id,
                    status
                )
                SELECT
                    c.id,
                    c.glpi_ticket_id,
                    c.queue_id,
                    'open'
                FROM glpi_plugin_integaglpi_conversations c
                WHERE c.id = :conversation_id
                  AND c.glpi_ticket_id = :ticket_id
                  AND c.status != 'closed'
                ON CONFLICT (conversation_id) DO NOTHING
                SQL
            );
            $insert->execute([
                ':conversation_id' => $conversationId,
                ':ticket_id'       => $ticketId,
            ]);

            $claim = $this->pdo->prepare(
                <<<SQL
                UPDATE glpi_plugin_integaglpi_conversation_runtime rt
                SET
                    assigned_user_id = :assigned_user_id,
                    status = 'open',
                    claimed_at = COALESCE(rt.claimed_at, NOW()),
                    updated_at = NOW()
                WHERE rt.ticket_id = :ticket_id
                  AND rt.conversation_id = :conversation_id
                  AND (rt.status IS NULL OR rt.status != 'closed')
                  AND (
                      rt.assigned_user_id IS NULL
                      OR rt.assigned_user_id = 0
                      OR rt.assigned_user_id = :assigned_user_id
                  )
                  AND EXISTS (
                      SELECT 1
                      FROM glpi_plugin_integaglpi_conversations c
                      WHERE c.id = rt.conversation_id
                        AND c.glpi_ticket_id = rt.ticket_id
                        AND c.status != 'closed'
                  )
                RETURNING
                    rt.conversation_id,
                    rt.ticket_id,
                    rt.queue_id,
                    rt.assigned_user_id,
                    rt.assigned_group_id,
                    rt.status,
                    rt.claimed_at,
                    rt.updated_at
                SQL
            );
            $claim->execute([
                ':assigned_user_id' => $userId,
                ':ticket_id'        => $ticketId,
                ':conversation_id'  => $conversationId,
            ]);

            $row = $claim->fetch();
            if (is_array($row)) {
                $this->touchConversationStatus($ticketId, $conversationId, 'open');

                return [
                    'status' => 'claimed',
                    'row'    => $row,
                ];
            }

            $current = $this->findBoundToTicket($ticketId, $conversationId);
            if ($current === null) {
                return ['status' => 'not_found'];
            }

            $conversationStatus = strtolower((string) ($current['conversation_status'] ?? ''));
            $runtimeStatus = strtolower((string) ($current['runtime_status'] ?? ''));
            if ($conversationStatus === 'closed' || $runtimeStatus === 'closed') {
                return [
                    'status' => 'closed',
                    'row'    => $current,
                ];
            }

            $assignedUserId = (int) ($current['assigned_user_id'] ?? 0);
            if ($assignedUserId === $userId) {
                return [
                    'status' => 'claimed',
                    'row'    => $current,
                ];
            }

            return [
                'status'           => 'already_claimed',
                'row'              => $current,
                'assigned_user_id' => $assignedUserId,
            ];
        });
    }

    /**
     * Atomically transfers an open conversation from the current owner to another technician.
     *
     * @return array{status: string, row?: array<string, mixed>, assigned_user_id?: int}
     */
    public function transferAssignedUser(
        int $ticketId,
        string $conversationId,
        int $currentUserId,
        int $newUserId
    ): array {
        return $this->runInTransaction(function () use ($ticketId, $conversationId, $currentUserId, $newUserId): array {
            $transfer = $this->pdo->prepare(
                <<<SQL
                UPDATE glpi_plugin_integaglpi_conversation_runtime rt
                SET
                    assigned_user_id = :new_user_id,
                    updated_at = NOW()
                WHERE rt.ticket_id = :ticket_id
                  AND rt.conversation_id = :conversation_id
                  AND (rt.status IS NULL OR rt.status != 'closed')
                  AND rt.assigned_user_id = :current_user_id
                  AND EXISTS (
                      SELECT 1
                      FROM glpi_plugin_integaglpi_conversations c
                      WHERE c.id = rt.conversation_id
                        AND c.glpi_ticket_id = rt.ticket_id
                        AND c.status != 'closed'
                  )
                RETURNING
                    rt.conversation_id,
                    rt.ticket_id,
                    rt.queue_id,
                    rt.assigned_user_id,
                    rt.assigned_group_id,
                    rt.status,
                    rt.claimed_at,
                    rt.updated_at
                SQL
            );
            $transfer->execute([
                ':new_user_id'      => $newUserId,
                ':ticket_id'        => $ticketId,
                ':conversation_id'  => $conversationId,
                ':current_user_id'  => $currentUserId,
            ]);

            $row = $transfer->fetch();
            if (is_array($row)) {
                return [
                    'status' => 'transferred',
                    'row'    => $row,
                ];
            }

            $current = $this->findBoundToTicket($ticketId, $conversationId);
            if ($current === null) {
                return ['status' => 'not_found'];
            }

            $conversationStatus = strtolower((string) ($current['conversation_status'] ?? ''));
            $runtimeStatus = strtolower((string) ($current['runtime_status'] ?? ''));
            if ($conversationStatus === 'closed' || $runtimeStatus === 'closed') {
                return [
                    'status' => 'closed',
                    'row'    => $current,
                ];
            }

            return [
                'status'           => 'not_owner',
                'row'              => $current,
                'assigned_user_id' => (int) ($current['assigned_user_id'] ?? 0),
            ];
        });
    }

    public function close(int $ticketId, string $conversationId): void
    {
        $this->runInTransaction(function () use ($ticketId, $conversationId): void {
            $statement = $this->pdo->prepare(
                <<<SQL
                UPDATE glpi_plugin_integaglpi_conversation_runtime
                SET
                    status = 'closed',
                    closed_at = NOW(),
                    updated_at = NOW()
                WHERE ticket_id = :ticket_id
                  AND conversation_id = :conversation_id
                SQL
            );
            $statement->execute([
                ':ticket_id'       => $ticketId,
                ':conversation_id' => $conversationId,
            ]);

            $this->touchConversationStatus($ticketId, $conversationId, 'closed');
        });
    }

    public function reopen(int $ticketId, string $conversationId): void
    {
        $this->runInTransaction(function () use ($ticketId, $conversationId): void {
            $statement = $this->pdo->prepare(
                <<<SQL
                UPDATE glpi_plugin_integaglpi_conversation_runtime
                SET
                    status = 'open',
                    closed_at = NULL,
                    updated_at = NOW()
                WHERE ticket_id = :ticket_id
                  AND conversation_id = :conversation_id
                SQL
            );
            $statement->execute([
                ':ticket_id'       => $ticketId,
                ':conversation_id' => $conversationId,
            ]);

            $this->touchConversationStatus($ticketId, $conversationId, 'open');
        });
    }

    public function transfer(int $ticketId, string $conversationId, int $queueId, ?int $groupId): void
    {
        $this->runInTransaction(function () use ($ticketId, $conversationId, $queueId, $groupId): void {
            $statement = $this->pdo->prepare(
                <<<SQL
                UPDATE glpi_plugin_integaglpi_conversation_runtime
                SET
                    queue_id = :queue_id,
                    assigned_user_id = NULL,
                    assigned_group_id = :assigned_group_id,
                    status = 'open',
                    transferred_at = NOW(),
                    updated_at = NOW()
                WHERE ticket_id = :ticket_id
                  AND conversation_id = :conversation_id
                SQL
            );
            $statement->execute([
                ':queue_id'           => $queueId,
                ':assigned_group_id'  => $groupId,
                ':ticket_id'          => $ticketId,
                ':conversation_id'    => $conversationId,
            ]);

            $this->touchConversationStatus($ticketId, $conversationId, 'open');
        });
    }

    /**
     * Fecha a conversation vinculada a um ticket GLPI, se ainda não estiver fechada.
     * Retorna o conversation_id atualizado, ou null se nada foi alterado.
     */
    public function closeByGlpiTicketId(int $ticketId): ?string
    {
        $statement = $this->pdo->prepare(
            <<<SQL
            UPDATE glpi_plugin_integaglpi_conversations
            SET
                status     = 'closed',
                updated_at = NOW()
            WHERE glpi_ticket_id = :ticket_id
              AND status        != 'closed'
            RETURNING id
            SQL
        );
        $statement->execute([':ticket_id' => $ticketId]);
        $row = $statement->fetch(\PDO::FETCH_ASSOC);

        return is_array($row) && isset($row['id']) ? (string) $row['id'] : null;
    }

    /**
     * @param array{status?: string, queue_id?: int|null, search?: string} $filters
     * @return array{0: string, 1: array<string, array{value: mixed, type: int}>}
     */
    private function buildAttendanceCenterWhere(array $filters): array
    {
        $where = [
            "c.status != 'closed'",
            "(rt.status IS NULL OR rt.status != 'closed')",
        ];
        $params = [];

        $status = trim((string) ($filters['status'] ?? ''));
        if ($status !== '') {
            $where[] = 'COALESCE(rt.status, c.status) = :status';
            $params[':status'] = [
                'value' => $status,
                'type'  => PDO::PARAM_STR,
            ];
        }

        $queueId = $filters['queue_id'] ?? null;
        if (is_int($queueId) && $queueId > 0) {
            $where[] = 'COALESCE(rt.queue_id, c.queue_id) = :queue_id';
            $params[':queue_id'] = [
                'value' => $queueId,
                'type'  => PDO::PARAM_INT,
            ];
        }

        $search = trim((string) ($filters['search'] ?? ''));
        if ($search !== '') {
            $searchConditions = ['c.phone_e164 ILIKE :search_like'];
            $params[':search_like'] = [
                'value' => '%' . $search . '%',
                'type'  => PDO::PARAM_STR,
            ];

            if (ctype_digit($search)) {
                $searchConditions[] = 'c.glpi_ticket_id = :search_ticket_id';
                $params[':search_ticket_id'] = [
                    'value' => (int) $search,
                    'type'  => PDO::PARAM_INT,
                ];
            }

            $where[] = '(' . implode(' OR ', $searchConditions) . ')';
        }

        return [implode(' AND ', $where), $params];
    }

    /**
     * @param array<string, array{value: mixed, type: int}> $params
     */
    private function bindAttendanceCenterParams(\PDOStatement $statement, array $params): void
    {
        foreach ($params as $name => $definition) {
            $statement->bindValue($name, $definition['value'], $definition['type']);
        }
    }

    private function touchConversationStatus(int $ticketId, string $conversationId, string $status): void
    {
        $statement = $this->pdo->prepare(
            <<<SQL
            UPDATE glpi_plugin_integaglpi_conversations
            SET
                status = :status,
                updated_at = NOW()
            WHERE glpi_ticket_id = :ticket_id
              AND id = :conversation_id
            SQL
        );
        $statement->execute([
            ':status'          => $status,
            ':ticket_id'       => $ticketId,
            ':conversation_id' => $conversationId,
        ]);
    }

    private function runInTransaction(callable $callback): mixed
    {
        $startedTransaction = !$this->pdo->inTransaction();

        if ($startedTransaction) {
            $this->pdo->beginTransaction();
        }

        try {
            $result = $callback();

            if ($startedTransaction) {
                $this->pdo->commit();
            }

            return $result;
        } catch (\Throwable $exception) {
            if ($startedTransaction && $this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }

            throw $exception;
        }
    }
}
