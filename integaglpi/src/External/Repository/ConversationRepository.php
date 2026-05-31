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
                c.glpi_entity_id,
                c.glpi_entity_name,
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
                q.default_group_id AS queue_default_group_id,
                to_jsonb(cps) AS profile_snapshot_json
            FROM glpi_plugin_integaglpi_conversations c
            LEFT JOIN glpi_plugin_integaglpi_contacts ct
                ON ct.id = c.contact_id
            LEFT JOIN glpi_plugin_integaglpi_conversation_runtime rt
                ON rt.conversation_id = c.id
            LEFT JOIN glpi_plugin_integaglpi_queues q
                ON q.id = rt.queue_id
            LEFT JOIN glpi_plugin_integaglpi_conversation_profile_snapshot cps
                ON cps.conversation_id = c.id
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
                q.default_group_id AS queue_default_group_id,
                to_jsonb(cps) AS profile_snapshot_json
            FROM glpi_plugin_integaglpi_conversations c
            LEFT JOIN glpi_plugin_integaglpi_contacts ct
                ON ct.id = c.contact_id
            LEFT JOIN glpi_plugin_integaglpi_conversation_runtime rt
                ON rt.conversation_id = c.id
            LEFT JOIN glpi_plugin_integaglpi_queues q
                ON q.id = rt.queue_id
            LEFT JOIN glpi_plugin_integaglpi_conversation_profile_snapshot cps
                ON cps.conversation_id = c.id
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
     * @return array<string, mixed>|null
     */
    public function findByConversationId(string $conversationId): ?array
    {
        $statement = $this->pdo->prepare(
            <<<SQL
            SELECT
                c.id AS conversation_id,
                c.contact_id,
                c.phone_e164,
                c.glpi_ticket_id,
                c.glpi_entity_id,
                c.glpi_entity_name,
                c.status AS conversation_status,
                c.queue_id,
                c.glpi_service_catalog_id,
                c.profile_collection_state,
                c.last_message_at,
                rt.assigned_user_id,
                rt.assigned_group_id,
                rt.status AS runtime_status,
                rt.queue_id AS runtime_queue_id
            FROM glpi_plugin_integaglpi_conversations c
            LEFT JOIN glpi_plugin_integaglpi_conversation_runtime rt
                ON rt.conversation_id = c.id
            WHERE c.id = :conversation_id
            LIMIT 1
            SQL
        );
        $statement->execute([
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
     * @param array<string, mixed> $filters
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
                c.glpi_entity_id,
                c.glpi_entity_name,
                c.status AS conversation_status,
                c.profile_collection_state,
                c.last_message_at,
                c.updated_at AS conversation_updated_at,
                c.glpi_service_catalog_id,
                c.sla_first_response_at,
                c.sla_response_deadline,
                c.sla_resolution_at,
                c.sla_solution_deadline,
                c.accumulated_paused_minutes,
                c.reopen_count,
                ct.name AS contact_name,
                COALESCE(rt.queue_id, c.queue_id) AS queue_id,
                rt.assigned_user_id,
                rt.assigned_group_id,
                rt.status AS runtime_status,
                rt.updated_at AS runtime_updated_at,
                q.name AS queue_name,
                sc.name AS service_catalog_name,
                sc.service_key AS service_catalog_key,
                sc.sla_response_minutes AS service_sla_response_minutes,
                sc.sla_solution_minutes AS service_sla_solution_minutes,
                c.last_message_at AS activity_at,
                lm.message_text AS last_message_preview,
                li.created_at AS last_inbound_at,
                to_jsonb(cps) AS profile_snapshot_json,
                cem.glpi_entity_id AS memory_entity_id,
                cem.glpi_entity_name AS memory_entity_name,
                esa.status AS entity_attempt_status,
                esa.glpi_ticket_id AS entity_attempt_ticket_id,
                esa.error_message AS entity_attempt_error_message,
                esa.finished_at AS entity_attempt_finished_at,
                CASE
                  WHEN esa.finished_at IS NOT NULL THEN EXTRACT(EPOCH FROM (esa.finished_at - esa.created_at))::int
                  ELSE NULL
                END AS entity_attempt_duration_seconds,
                esa.updated_at AS entity_attempt_updated_at,
                it.status AS inactivity_tracking_status,
                it.skip_reason AS inactivity_tracking_skip_reason,
                it.updated_at AS inactivity_tracking_updated_at,
                ije.event_key AS inactivity_event_key,
                ije.status AS inactivity_event_status,
                ije.reason AS inactivity_event_reason,
                ije.delivery_status AS inactivity_delivery_status,
                ije.meta_error_code AS inactivity_meta_error_code,
                ije.meta_error_message_sanitized AS inactivity_meta_error_message_sanitized,
                ije.created_at AS inactivity_last_checked_at,
                lom.delivery_status AS last_delivery_status,
                lom.meta_message_id AS last_meta_message_id,
                lom.meta_error_code AS last_delivery_error_code,
                lom.meta_error_message_sanitized AS last_delivery_error_message_sanitized,
                lom.created_at AS last_outbound_at,
                COALESCE(sa.csat_dissatisfied, FALSE) AS csat_dissatisfied,
                COALESCE(sa.supervisor_review_required, FALSE) AS supervisor_review_required,
                ai.status AS ai_quality_status,
                ai.sentiment AS ai_sentiment,
                ai.classification_resolution AS ai_resolution,
                COALESCE(ai.flags::text, '[]') AS ai_flags_json,
                COALESCE(ai.flags::text LIKE '%supervisor_review_required%', FALSE) AS ai_supervisor_review_required,
                ch.alert_status AS contract_alert_status,
                ch.consumed_percent AS contract_consumed_percent
            FROM glpi_plugin_integaglpi_conversations c
            LEFT JOIN glpi_plugin_integaglpi_contacts ct
                ON ct.id = c.contact_id
            LEFT JOIN glpi_plugin_integaglpi_conversation_runtime rt
                ON rt.conversation_id = c.id
            LEFT JOIN glpi_plugin_integaglpi_queues q
                ON q.id = COALESCE(rt.queue_id, c.queue_id)
            LEFT JOIN glpi_plugin_integaglpi_service_catalog sc
                ON sc.id = c.glpi_service_catalog_id
            LEFT JOIN LATERAL (
                SELECT
                    m.message_text
                FROM glpi_plugin_integaglpi_messages m
                WHERE m.conversation_id = c.id
                ORDER BY m.created_at DESC
                LIMIT 1
            ) lm ON TRUE
            LEFT JOIN LATERAL (
                SELECT
                    m.created_at
                FROM glpi_plugin_integaglpi_messages m
                WHERE m.conversation_id = c.id
                  AND m.direction = 'inbound'
                ORDER BY m.created_at DESC
                LIMIT 1
            ) li ON TRUE
            LEFT JOIN glpi_plugin_integaglpi_conversation_profile_snapshot cps
                ON cps.conversation_id = c.id
            LEFT JOIN glpi_plugin_integaglpi_contact_entity_memory cem
                ON cem.phone_e164 = c.phone_e164
                AND cem.is_active = TRUE
            LEFT JOIN LATERAL (
                SELECT
                    a.status,
                    a.glpi_ticket_id,
                    a.error_message,
                    a.created_at,
                    a.finished_at,
                    a.updated_at
                FROM glpi_plugin_integaglpi_entity_selection_attempts a
                WHERE a.conversation_id = c.id
                ORDER BY a.updated_at DESC
                LIMIT 1
            ) esa ON TRUE
            LEFT JOIN glpi_plugin_integaglpi_inactivity_tracking it
                ON it.conversation_id = c.id
            LEFT JOIN LATERAL (
                SELECT
                    e.event_key,
                    e.status,
                    e.reason,
                    e.delivery_status,
                    e.meta_error_code,
                    e.meta_error_message_sanitized,
                    e.created_at
                FROM glpi_plugin_integaglpi_inactivity_job_events e
                WHERE e.conversation_id = c.id
                   OR (
                       e.conversation_id IS NULL
                       AND e.status = 'checked'
                   )
                ORDER BY
                    CASE WHEN e.conversation_id = c.id THEN 0 ELSE 1 END,
                    e.created_at DESC
                LIMIT 1
            ) ije ON TRUE
            LEFT JOIN LATERAL (
                SELECT
                    m.delivery_status,
                    m.meta_message_id,
                    m.meta_error_code,
                    m.meta_error_message_sanitized,
                    m.created_at
                FROM glpi_plugin_integaglpi_messages m
                WHERE m.conversation_id = c.id
                  AND m.direction = 'outbound'
                ORDER BY m.created_at DESC, m.id DESC
                LIMIT 1
            ) lom ON TRUE
            LEFT JOIN LATERAL (
                SELECT
                    BOOL_OR(s.csat_rating = 'dissatisfied') AS csat_dissatisfied,
                    BOOL_OR(s.supervisor_review_required = TRUE) AS supervisor_review_required
                FROM glpi_plugin_integaglpi_solution_actions s
                WHERE s.ticket_id = c.glpi_ticket_id
            ) sa ON TRUE
            LEFT JOIN LATERAL (
                SELECT
                    a.status,
                    a.sentiment,
                    a.classification_resolution,
                    a.flags
                FROM glpi_plugin_integaglpi_ai_quality_analyses a
                WHERE a.conversation_id = c.id
                   OR (c.glpi_ticket_id IS NOT NULL AND a.glpi_ticket_id = c.glpi_ticket_id)
                ORDER BY a.created_at DESC
                LIMIT 1
            ) ai ON TRUE
            LEFT JOIN LATERAL (
                SELECT
                    CASE
                        WHEN ((COALESCE(SUM(adj.adjusted_hours), 0) / NULLIF(ec.allocated_hours, 0)) * 100) >= ec.exhausted_threshold_percent THEN 'exhausted'
                        WHEN ((COALESCE(SUM(adj.adjusted_hours), 0) / NULLIF(ec.allocated_hours, 0)) * 100) >= ec.critical_threshold_percent THEN 'critical'
                        WHEN ((COALESCE(SUM(adj.adjusted_hours), 0) / NULLIF(ec.allocated_hours, 0)) * 100) >= ec.warning_threshold_percent THEN 'warning'
                        ELSE 'ok'
                    END AS alert_status,
                    ROUND(((COALESCE(SUM(adj.adjusted_hours), 0) / NULLIF(ec.allocated_hours, 0)) * 100)::numeric, 2) AS consumed_percent
                FROM glpi_plugin_integaglpi_entity_contracts ec
                LEFT JOIN glpi_plugin_integaglpi_hour_adjustments adj
                    ON adj.contract_id = ec.id
                WHERE ec.glpi_entity_id = c.glpi_entity_id
                  AND ec.is_active = TRUE
                GROUP BY
                    ec.id,
                    ec.allocated_hours,
                    ec.exhausted_threshold_percent,
                    ec.critical_threshold_percent,
                    ec.warning_threshold_percent,
                    ec.period_end
                ORDER BY ec.period_end DESC, ec.id DESC
                LIMIT 1
            ) ch ON TRUE
            WHERE {$whereSql}
            ORDER BY
                CASE
                    WHEN lom.delivery_status = 'failed' THEN 0
                    WHEN esa.error_message LIKE 'ambiguous_reconciliation:%' THEN 1
                    WHEN esa.status = 'processing' THEN 2
                    WHEN c.glpi_ticket_id IS NULL OR c.glpi_ticket_id = 0 THEN 3
                    WHEN ije.status = 'failed' THEN 4
                    ELSE 10
                END ASC,
                c.last_message_at DESC NULLS LAST,
                c.updated_at DESC
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
     * @param array<string, mixed> $filters
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

    public function assignServiceCatalogForPreTicket(string $conversationId, int $serviceCatalogId): void
    {
        $statement = $this->pdo->prepare(
            <<<SQL
            UPDATE glpi_plugin_integaglpi_conversations
            SET
                glpi_service_catalog_id = :service_catalog_id,
                updated_at = NOW()
            WHERE id = :conversation_id
              AND (glpi_ticket_id IS NULL OR glpi_ticket_id = 0)
            SQL
        );
        $statement->execute([
            ':conversation_id' => $conversationId,
            ':service_catalog_id' => $serviceCatalogId,
        ]);
    }

    public function markFirstResponseIfMissing(string $conversationId): void
    {
        $statement = $this->pdo->prepare(
            <<<SQL
            UPDATE glpi_plugin_integaglpi_conversations
            SET
                sla_first_response_at = COALESCE(sla_first_response_at, NOW()),
                updated_at = NOW()
            WHERE id = :conversation_id
              AND sla_first_response_at IS NULL
            SQL
        );
        $statement->execute([':conversation_id' => $conversationId]);
    }

    /**
     * @return list<int>
     */
    public function findAttendanceTechnicianIds(): array
    {
        $statement = $this->pdo->prepare(
            <<<SQL
            SELECT DISTINCT assigned_user_id
            FROM glpi_plugin_integaglpi_conversation_runtime
            WHERE assigned_user_id IS NOT NULL
              AND assigned_user_id > 0
            ORDER BY assigned_user_id ASC
            LIMIT 100
            SQL
        );
        $statement->execute();

        return array_values(array_filter(
            array_map('intval', $statement->fetchAll(PDO::FETCH_COLUMN)),
            static fn (int $id): bool => $id > 0
        ));
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
     * @return array<string, mixed>|null
     */
    public function updateConversationEntity(
        string $conversationId,
        int $glpiEntityId,
        string $glpiEntityName,
        int $userId
    ): ?array {
        return $this->runInTransaction(function () use ($conversationId, $glpiEntityId, $glpiEntityName, $userId): ?array {
            $select = $this->pdo->prepare(
                <<<SQL
                SELECT
                    id,
                    contact_id,
                    phone_e164,
                    glpi_ticket_id,
                    glpi_entity_id,
                    glpi_entity_name
                FROM glpi_plugin_integaglpi_conversations
                WHERE id = :conversation_id
                FOR UPDATE
                SQL
            );
            $select->execute([':conversation_id' => $conversationId]);
            $previous = $select->fetch(PDO::FETCH_ASSOC);
            if (!is_array($previous)) {
                return null;
            }

            $update = $this->pdo->prepare(
                <<<SQL
                UPDATE glpi_plugin_integaglpi_conversations
                SET
                    glpi_entity_id = :glpi_entity_id,
                    glpi_entity_name = :glpi_entity_name,
                    updated_at = NOW()
                WHERE id = :conversation_id
                RETURNING
                    id AS conversation_id,
                    contact_id,
                    phone_e164,
                    glpi_ticket_id,
                    glpi_entity_id,
                    glpi_entity_name,
                    status AS conversation_status,
                    updated_at
                SQL
            );
            $update->execute([
                ':conversation_id' => $conversationId,
                ':glpi_entity_id' => $glpiEntityId,
                ':glpi_entity_name' => $glpiEntityName,
            ]);
            $updated = $update->fetch(PDO::FETCH_ASSOC);
            if (!is_array($updated)) {
                return null;
            }

            $phone = trim((string) ($updated['phone_e164'] ?? ''));
            if ($phone !== '') {
                $deactivate = $this->pdo->prepare(
                    <<<SQL
                    UPDATE glpi_plugin_integaglpi_contact_entity_memory
                    SET is_active = FALSE,
                        updated_at = NOW()
                    WHERE phone_e164 = :phone_e164
                      AND is_active = TRUE
                    SQL
                );
                $deactivate->execute([':phone_e164' => $phone]);

                $insertMemory = $this->pdo->prepare(
                    <<<SQL
                    INSERT INTO glpi_plugin_integaglpi_contact_entity_memory (
                        phone_e164,
                        contact_id,
                        glpi_entity_id,
                        glpi_entity_name,
                        source_ticket_id,
                        source_conversation_id,
                        source,
                        is_active,
                        created_at,
                        updated_at
                    ) VALUES (
                        :phone_e164,
                        :contact_id,
                        :glpi_entity_id,
                        :glpi_entity_name,
                        :source_ticket_id,
                        :source_conversation_id,
                        'plugin_entity_edit',
                        TRUE,
                        NOW(),
                        NOW()
                    )
                    SQL
                );
                $ticketId = (int) ($updated['glpi_ticket_id'] ?? 0);
                $insertMemory->bindValue(':phone_e164', $phone, PDO::PARAM_STR);
                $contactId = trim((string) ($updated['contact_id'] ?? ''));
                if ($contactId !== '') {
                    $insertMemory->bindValue(':contact_id', $contactId, PDO::PARAM_STR);
                } else {
                    $insertMemory->bindValue(':contact_id', null, PDO::PARAM_NULL);
                }
                $insertMemory->bindValue(':glpi_entity_id', $glpiEntityId, PDO::PARAM_INT);
                $insertMemory->bindValue(':glpi_entity_name', $glpiEntityName, PDO::PARAM_STR);
                if ($ticketId > 0) {
                    $insertMemory->bindValue(':source_ticket_id', $ticketId, PDO::PARAM_INT);
                } else {
                    $insertMemory->bindValue(':source_ticket_id', null, PDO::PARAM_NULL);
                }
                $insertMemory->bindValue(':source_conversation_id', $conversationId, PDO::PARAM_STR);
                $insertMemory->execute();
            }

            $this->insertConversationEntityAudit($previous, $updated, $userId);

            return $updated;
        });
    }

    /**
     * @param array<string, mixed> $filters
     * @return array{0: string, 1: array<string, array{value: mixed, type: int}>}
     */
    private function buildAttendanceCenterWhere(array $filters): array
    {
        $where = [
            "c.status NOT IN ('closed', 'cancelled')",
            "(rt.status IS NULL OR rt.status NOT IN ('closed', 'cancelled'))",
        ];
        $params = [];

        $allowedEntityIds = is_array($filters['allowed_entity_ids'] ?? null)
            ? array_values(array_filter(
                array_map('intval', $filters['allowed_entity_ids']),
                static fn (int $id): bool => $id > 0
            ))
            : [];
        if ($allowedEntityIds !== []) {
            $placeholders = [];
            foreach ($allowedEntityIds as $index => $entityId) {
                $placeholder = ':allowed_entity_' . $index;
                $placeholders[] = $placeholder;
                $params[$placeholder] = [
                    'value' => $entityId,
                    'type'  => PDO::PARAM_INT,
                ];
            }
            $where[] = '(c.glpi_entity_id IS NULL OR c.glpi_entity_id = 0 OR c.glpi_entity_id IN (' . implode(', ', $placeholders) . '))';
        }

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

        $technicianId = $filters['technician_id'] ?? null;
        if (is_int($technicianId) && $technicianId > 0) {
            $where[] = 'rt.assigned_user_id = :technician_id';
            $params[':technician_id'] = [
                'value' => $technicianId,
                'type'  => PDO::PARAM_INT,
            ];
        }

        // Phase: integaglpi_ops_console_claim_ui_messaging_stabilization_001.
        // mine_only restricts Central rows to the logged-in technician's
        // assignments. Skipped when an explicit technician_id filter is
        // already in place (avoid double restriction) or when current_user_id
        // could not be resolved (background contexts).
        // central_visibility_required_fix: pre-ticket conversations
        // (awaiting_entity_selection, collecting_contact_profile,
        // awaiting_queue_selection) have no assigned technician yet but require
        // operator/supervisor action — they must remain visible even when
        // mine_only is active.
        $mineOnly = (bool) ($filters['mine_only'] ?? false);
        $currentUserId = (int) ($filters['current_user_id'] ?? 0);
        $hasExplicitTechnicianFilter = is_int($technicianId) && $technicianId > 0;
        if ($mineOnly && !$hasExplicitTechnicianFilter && $currentUserId > 0) {
            $where[] = "(rt.assigned_user_id = :mine_only_user_id OR c.status IN ('awaiting_entity_selection', 'collecting_contact_profile', 'awaiting_queue_selection'))";
            $params[':mine_only_user_id'] = [
                'value' => $currentUserId,
                'type'  => PDO::PARAM_INT,
            ];
        }

        // central_visibility_required_fix: pre-ticket conversations awaiting entity
        // selection have glpi_entity_id = NULL/0 and must appear in the Central even
        // when an entity filter is active, so operators can assign the entity.
        $entityId = $filters['entity_id'] ?? null;
        if (is_int($entityId)) {
            if ($entityId === -1) {
                $where[] = '1 = 0';
            } elseif ($entityId > 0) {
                $where[] = "(c.glpi_entity_id = :entity_id OR (c.status IN ('awaiting_entity_selection', 'collecting_contact_profile', 'awaiting_queue_selection') AND (c.glpi_entity_id IS NULL OR c.glpi_entity_id = 0)))";
                $params[':entity_id'] = [
                    'value' => $entityId,
                    'type'  => PDO::PARAM_INT,
                ];
            }
        }

        $windowStatus = trim((string) ($filters['window_status'] ?? ''));
        if ($windowStatus === 'open') {
            $where[] = "EXISTS (
                SELECT 1
                FROM glpi_plugin_integaglpi_messages win
                WHERE win.conversation_id = c.id
                  AND win.direction = 'inbound'
                  AND win.created_at >= NOW() - INTERVAL '24 hours'
            )";
        } elseif ($windowStatus === 'closed') {
            $where[] = "NOT EXISTS (
                SELECT 1
                FROM glpi_plugin_integaglpi_messages win
                WHERE win.conversation_id = c.id
                  AND win.direction = 'inbound'
                  AND win.created_at >= NOW() - INTERVAL '24 hours'
            )";
        }

        $deliveryFilter = trim((string) ($filters['delivery'] ?? ''));
        if ($deliveryFilter !== '') {
            $where[] = "EXISTS (
                SELECT 1
                FROM glpi_plugin_integaglpi_messages delivery_filter
                WHERE delivery_filter.conversation_id = c.id
                  AND delivery_filter.direction = 'outbound'
                  AND delivery_filter.delivery_status = :delivery_filter
            )";
            $params[':delivery_filter'] = [
                'value' => $deliveryFilter,
                'type'  => PDO::PARAM_STR,
            ];
        }

        $inactivityFilter = trim((string) ($filters['inactivity'] ?? ''));
        if ($inactivityFilter === 'attention') {
            $where[] = "EXISTS (
                SELECT 1
                FROM glpi_plugin_integaglpi_inactivity_job_events ie
                WHERE ie.conversation_id = c.id
                  AND ie.status IN ('failed', 'skipped', 'planned')
            )";
        } elseif ($inactivityFilter === 'sent') {
            $where[] = "EXISTS (
                SELECT 1
                FROM glpi_plugin_integaglpi_inactivity_job_events ie
                WHERE ie.conversation_id = c.id
                  AND ie.status = 'sent'
            )";
        } elseif ($inactivityFilter === 'skipped') {
            $where[] = "EXISTS (
                SELECT 1
                FROM glpi_plugin_integaglpi_inactivity_job_events ie
                WHERE ie.conversation_id = c.id
                  AND ie.status = 'skipped'
            )";
        }

        $operationalState = trim((string) ($filters['operational_state'] ?? ''));
        if ($operationalState !== '') {
            $this->appendOperationalStateWhere($where, $operationalState);
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
     * @param list<string> $where
     */
    private function appendOperationalStateWhere(array &$where, string $operationalState): void
    {
        if ($operationalState === 'pre_ticket') {
            $where[] = '(c.glpi_ticket_id IS NULL OR c.glpi_ticket_id = 0)';
            return;
        }

        if ($operationalState === 'awaiting_entity') {
            $where[] = "c.status = 'awaiting_entity_selection'";
            return;
        }

        if ($operationalState === 'processing') {
            $where[] = "EXISTS (
                SELECT 1
                FROM glpi_plugin_integaglpi_entity_selection_attempts op_esa
                WHERE op_esa.conversation_id = c.id
                  AND op_esa.status = 'processing'
            )";
            return;
        }

        if ($operationalState === 'ambiguous_reconciliation') {
            $where[] = "EXISTS (
                SELECT 1
                FROM glpi_plugin_integaglpi_entity_selection_attempts op_esa
                WHERE op_esa.conversation_id = c.id
                  AND op_esa.error_message LIKE 'ambiguous_reconciliation:%'
            )";
            return;
        }

        if ($operationalState === 'delivery_failed') {
            $where[] = "EXISTS (
                SELECT 1
                FROM glpi_plugin_integaglpi_messages op_delivery
                WHERE op_delivery.conversation_id = c.id
                  AND op_delivery.direction = 'outbound'
                  AND op_delivery.delivery_status = 'failed'
            )";
            return;
        }

        if ($operationalState === 'inactivity_attention') {
            $where[] = "EXISTS (
                SELECT 1
                FROM glpi_plugin_integaglpi_inactivity_job_events op_ie
                WHERE op_ie.conversation_id = c.id
                  AND op_ie.status IN ('failed', 'skipped', 'planned')
            )";
            return;
        }

        if ($operationalState === 'risk') {
            $where[] = "(
                EXISTS (
                    SELECT 1
                    FROM glpi_plugin_integaglpi_messages risk_delivery
                    WHERE risk_delivery.conversation_id = c.id
                      AND risk_delivery.direction = 'outbound'
                      AND risk_delivery.delivery_status = 'failed'
                )
                OR EXISTS (
                    SELECT 1
                    FROM glpi_plugin_integaglpi_entity_selection_attempts risk_esa
                    WHERE risk_esa.conversation_id = c.id
                      AND (
                          risk_esa.status = 'processing'
                          OR risk_esa.error_message LIKE 'ambiguous_reconciliation:%'
                      )
                )
                OR EXISTS (
                    SELECT 1
                    FROM glpi_plugin_integaglpi_inactivity_job_events risk_ie
                    WHERE risk_ie.conversation_id = c.id
                      AND risk_ie.status IN ('failed', 'skipped')
                )
                OR NOT EXISTS (
                    SELECT 1
                    FROM glpi_plugin_integaglpi_messages risk_win
                    WHERE risk_win.conversation_id = c.id
                      AND risk_win.direction = 'inbound'
                      AND risk_win.created_at >= NOW() - INTERVAL '24 hours'
                )
            )";
        }
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

    /**
     * @param array<string, mixed> $previous
     * @param array<string, mixed> $updated
     */
    private function insertConversationEntityAudit(array $previous, array $updated, int $userId): void
    {
        try {
            $statement = $this->pdo->prepare(
                <<<SQL
                INSERT INTO glpi_plugin_integaglpi_audit_events (
                    correlation_id,
                    ticket_id,
                    conversation_id,
                    event_type,
                    status,
                    severity,
                    source,
                    payload_json,
                    created_at
                ) VALUES (
                    :correlation_id,
                    :ticket_id,
                    :conversation_id,
                    'CONVERSATION_ENTITY_UPDATED',
                    'succeeded',
                    'info',
                    'PluginAttendanceCenter',
                    :payload_json::jsonb,
                    NOW()
                )
                SQL
            );
            $ticketId = (int) ($updated['glpi_ticket_id'] ?? 0);
            $conversationId = (string) ($updated['conversation_id'] ?? $previous['id'] ?? '');
            $statement->bindValue(':correlation_id', 'entity_edit:' . $conversationId, PDO::PARAM_STR);
            if ($ticketId > 0) {
                $statement->bindValue(':ticket_id', $ticketId, PDO::PARAM_INT);
            } else {
                $statement->bindValue(':ticket_id', null, PDO::PARAM_NULL);
            }
            $statement->bindValue(':conversation_id', $conversationId, PDO::PARAM_STR);
            $statement->bindValue(':payload_json', json_encode([
                'actor_user_id' => $userId,
                'previous_glpi_entity_id' => (int) ($previous['glpi_entity_id'] ?? 0),
                'previous_glpi_entity_name' => (string) ($previous['glpi_entity_name'] ?? ''),
                'new_glpi_entity_id' => (int) ($updated['glpi_entity_id'] ?? 0),
                'new_glpi_entity_name' => (string) ($updated['glpi_entity_name'] ?? ''),
                'ticket_entity_changed' => false,
            ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), PDO::PARAM_STR);
            $statement->execute();
        } catch (\Throwable $exception) {
            error_log('[integaglpi][central][entity_audit] ' . $exception->getMessage());
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
