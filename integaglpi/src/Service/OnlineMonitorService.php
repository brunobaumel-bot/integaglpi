<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi\Service;

use GlpiPlugin\Integaglpi\External\ExternalDatabase;
use PDO;
use Throwable;

final class OnlineMonitorService
{
    private const DEFAULT_LIMIT = 50;
    private const MAX_LIMIT = 100;
    private const KPI_SAMPLE_LIMIT = 1000;

    private PluginConfigService $pluginConfigService;

    public function __construct(PluginConfigService $pluginConfigService)
    {
        $this->pluginConfigService = $pluginConfigService;
    }

    /**
     * @param array<string, mixed> $query
     * @return array<string, mixed>
     */
    public function getPageData(array $query, int $userId, bool $supervisor): array
    {
        $filters = $this->normalizeFilters($query, $userId, $supervisor);
        if (!$this->pluginConfigService->isConfigured()) {
            return [
                'configured' => false,
                'filters' => $filters,
                'kpis' => $this->emptyKpis(),
                'rows' => [],
                'options' => $this->emptyOptions(),
                'page' => 1,
                'limit' => self::DEFAULT_LIMIT,
                'has_next' => false,
                'has_previous' => false,
                'last_updated_at' => date('H:i:s'),
                'error' => __('PostgreSQL externo ainda não está configurado.', 'glpiintegaglpi'),
                'supervisor' => $supervisor,
            ];
        }

        try {
            $pdo = ExternalDatabase::getConnection($this->pluginConfigService->getConnectionConfig());
            $rowsResult = $this->loadRows($pdo, $filters, $userId, $supervisor);

            return [
                'configured' => true,
                'filters' => $filters,
                'kpis' => $this->loadKpis($pdo, $filters, $userId, $supervisor),
                'rows' => $rowsResult['rows'],
                'options' => $this->loadFilterOptions($pdo, $userId, $supervisor),
                'page' => (int) $filters['page'],
                'limit' => (int) $filters['limit'],
                'has_next' => (bool) $rowsResult['has_next'],
                'has_previous' => (int) $filters['page'] > 1,
                'last_updated_at' => date('H:i:s'),
                'error' => '',
                'supervisor' => $supervisor,
            ];
        } catch (Throwable $exception) {
            error_log('[integaglpi][online_monitor] ' . $this->sanitizeLog($exception->getMessage()));

            return [
                'configured' => true,
                'filters' => $filters,
                'kpis' => $this->emptyKpis(),
                'rows' => [],
                'options' => $this->emptyOptions(),
                'page' => (int) $filters['page'],
                'limit' => (int) $filters['limit'],
                'has_next' => false,
                'has_previous' => (int) $filters['page'] > 1,
                'last_updated_at' => date('H:i:s'),
                'error' => __('Não foi possível carregar o Monitor Online agora. Verifique logs operacionais.', 'glpiintegaglpi'),
                'supervisor' => $supervisor,
            ];
        }
    }

    /**
     * @param array<string, mixed> $query
     * @return array<string, mixed>
     */
    private function normalizeFilters(array $query, int $userId, bool $supervisor): array
    {
        $limit = (int) ($query['limit'] ?? self::DEFAULT_LIMIT);
        $view = $this->safeToken((string) ($query['view'] ?? ''));
        if ($view === '') {
            $view = $supervisor ? 'all' : 'mine';
        }
        $ticketStatus = max(0, (int) ($query['ticket_status'] ?? 0));
        $ticketLink = $this->safeToken((string) ($query['ticket_link'] ?? ''));
        $ticketStatusQuick = $this->safeToken((string) ($query['ticket_status_quick'] ?? ''));
        if (!in_array($ticketStatusQuick, ['active', 'new', 'processing', 'pending', 'solved', 'closed', 'without_ticket', 'all'], true)) {
            $ticketStatusQuick = ($ticketStatus > 0 || $ticketLink !== '') ? 'all' : 'active';
        }

        return [
            'view' => $view,
            'page' => max(1, (int) ($query['page'] ?? 1)),
            'limit' => max(1, min(self::MAX_LIMIT, $limit > 0 ? $limit : self::DEFAULT_LIMIT)),
            'queue_id' => max(0, (int) ($query['queue_id'] ?? 0)),
            'technician_id' => max(0, (int) ($query['technician_id'] ?? 0)),
            'entity_id' => max(0, (int) ($query['entity_id'] ?? 0)),
            'conversation_status' => $this->safeToken((string) ($query['conversation_status'] ?? '')),
            'ticket_status' => $ticketStatus,
            'ticket_status_quick' => $ticketStatusQuick,
            'waiting' => $this->safeToken((string) ($query['waiting'] ?? '')),
            'ticket_link' => $ticketLink,
            'search' => $this->safeSearch((string) ($query['search'] ?? '')),
            'order_by' => in_array((string) ($query['order_by'] ?? ''), ['updated_at', 'stalled_time'], true)
                ? (string) $query['order_by']
                : 'stalled_time',
            'current_user_id' => max(0, $userId),
            'supervisor' => $supervisor,
        ];
    }

    /**
     * @return array{rows: list<array<string, mixed>>, has_next: bool}
     */
    private function loadRows(PDO $pdo, array $filters, int $userId, bool $supervisor): array
    {
        [$whereSql, $params] = $this->buildWhere($filters, $userId, $supervisor, false);
        $limit = (int) $filters['limit'];
        $offset = ((int) $filters['page'] - 1) * $limit;
        $queryLimit = $limit + 1;
        $orderSql = (string) $filters['order_by'] === 'updated_at'
            ? 'c.updated_at DESC NULLS LAST, c.last_message_at DESC NULLS LAST'
            : 'COALESCE(lm.created_at, c.last_message_at, c.updated_at, c.created_at) ASC NULLS FIRST';

        $statement = $pdo->prepare(
            <<<SQL
            SELECT
                c.id AS conversation_id,
                c.phone_e164,
                c.glpi_ticket_id,
                c.glpi_entity_id,
                c.glpi_entity_name,
                c.status AS conversation_status,
                c.last_message_at,
                c.updated_at AS conversation_updated_at,
                COALESCE(rt.queue_id, c.queue_id) AS queue_id,
                rt.assigned_user_id,
                rt.status AS runtime_status,
                q.name AS queue_name,
                COALESCE(cp.requester_name, ct.name) AS requester_name,
                cp.company_name_raw AS company_name,
                COALESCE(cem.glpi_entity_id, c.glpi_entity_id) AS memory_entity_id,
                COALESCE(cem.glpi_entity_name, c.glpi_entity_name) AS memory_entity_name,
                esa.status AS entity_attempt_status,
                esa.error_message AS entity_attempt_error_message,
                it.status AS inactivity_status,
                it.skip_reason AS inactivity_skip_reason,
                lm.direction AS last_message_direction,
                lm.message_type AS last_message_type,
                lm.message_text AS last_message_text,
                lm.created_at AS last_message_created_at,
                COALESCE(lds.status, lom.delivery_status, lm.delivery_status) AS last_delivery_status,
                COALESCE(lds.error_code, lom.meta_error_code) AS last_delivery_error_code,
                COALESCE(lds.error_message_sanitized, lom.meta_error_message_sanitized) AS last_delivery_error_message_sanitized,
                li.created_at AS last_inbound_at,
                EXTRACT(EPOCH FROM (NOW() - COALESCE(lm.created_at, c.last_message_at, c.updated_at, c.created_at)))::int AS stalled_seconds
            FROM glpi_plugin_integaglpi_conversations c
            LEFT JOIN glpi_plugin_integaglpi_contacts ct
                ON ct.id = c.contact_id
            LEFT JOIN glpi_plugin_integaglpi_conversation_runtime rt
                ON rt.conversation_id = c.id
            LEFT JOIN glpi_plugin_integaglpi_queues q
                ON q.id = COALESCE(rt.queue_id, c.queue_id)
            LEFT JOIN glpi_plugin_integaglpi_queue_users qu
                ON qu.queue_id = COALESCE(rt.queue_id, c.queue_id)
            LEFT JOIN glpi_plugin_integaglpi_contact_profile cp
                ON cp.phone_e164 = c.phone_e164
                AND cp.is_active = TRUE
            LEFT JOIN glpi_plugin_integaglpi_contact_entity_memory cem
                ON cem.phone_e164 = c.phone_e164
                AND cem.is_active = TRUE
            LEFT JOIN LATERAL (
                SELECT status, error_message
                FROM glpi_plugin_integaglpi_entity_selection_attempts a
                WHERE a.conversation_id = c.id
                ORDER BY a.updated_at DESC
                LIMIT 1
            ) esa ON TRUE
            LEFT JOIN glpi_plugin_integaglpi_inactivity_tracking it
                ON it.conversation_id = c.id
            LEFT JOIN LATERAL (
                SELECT direction, message_type, message_text, delivery_status, created_at, meta_message_id
                FROM glpi_plugin_integaglpi_messages m
                WHERE m.conversation_id = c.id
                ORDER BY m.created_at DESC, m.id DESC
                LIMIT 1
            ) lm ON TRUE
            LEFT JOIN LATERAL (
                SELECT created_at
                FROM glpi_plugin_integaglpi_messages m
                WHERE m.conversation_id = c.id
                  AND m.direction = 'inbound'
                ORDER BY m.created_at DESC, m.id DESC
                LIMIT 1
            ) li ON TRUE
            LEFT JOIN LATERAL (
                SELECT delivery_status, meta_message_id, meta_error_code, meta_error_message_sanitized
                FROM glpi_plugin_integaglpi_messages m
                WHERE m.conversation_id = c.id
                  AND m.direction = 'outbound'
                ORDER BY m.created_at DESC, m.id DESC
                LIMIT 1
            ) lom ON TRUE
            LEFT JOIN LATERAL (
                SELECT status, error_code, error_message_sanitized
                FROM glpi_plugin_integaglpi_message_delivery_status ds
                WHERE ds.meta_message_id = lom.meta_message_id
                ORDER BY ds.received_at DESC
                LIMIT 1
            ) lds ON TRUE
            WHERE {$whereSql}
            ORDER BY {$orderSql}
            LIMIT :limit OFFSET :offset
            SQL
        );
        $this->bindParams($statement, $params);
        $statement->bindValue(':limit', $queryLimit, PDO::PARAM_INT);
        $statement->bindValue(':offset', $offset, PDO::PARAM_INT);
        $statement->execute();

        $rawRows = $statement->fetchAll(PDO::FETCH_ASSOC);
        $rows = is_array($rawRows) ? $rawRows : [];
        $hasNext = count($rows) > $limit;
        $rows = array_slice($rows, 0, $limit);

        return [
            'rows' => $this->decorateRows($rows, (int) $filters['ticket_status'], (string) $filters['ticket_status_quick']),
            'has_next' => $hasNext,
        ];
    }

    /**
     * @return array<string, int>
     */
    private function loadKpis(PDO $pdo, array $filters, int $userId, bool $supervisor): array
    {
        [$whereSql, $params] = $this->buildWhere($filters, $userId, $supervisor, true);
        $statement = $pdo->prepare(
            <<<SQL
            WITH recent AS (
                SELECT
                    c.id,
                    c.status,
                    c.glpi_ticket_id,
                    lm.direction AS last_direction,
                    lm.created_at AS last_message_created_at,
                    COALESCE(lm.delivery_status, lom.delivery_status) AS delivery_status,
                    esa.status AS entity_status,
                    it.status AS inactivity_status
                FROM glpi_plugin_integaglpi_conversations c
                LEFT JOIN glpi_plugin_integaglpi_conversation_runtime rt
                    ON rt.conversation_id = c.id
                LEFT JOIN glpi_plugin_integaglpi_queue_users qu
                    ON qu.queue_id = COALESCE(rt.queue_id, c.queue_id)
                LEFT JOIN glpi_plugin_integaglpi_inactivity_tracking it
                    ON it.conversation_id = c.id
                LEFT JOIN LATERAL (
                    SELECT direction, delivery_status, created_at
                    FROM glpi_plugin_integaglpi_messages m
                    WHERE m.conversation_id = c.id
                    ORDER BY m.created_at DESC, m.id DESC
                    LIMIT 1
                ) lm ON TRUE
                LEFT JOIN LATERAL (
                    SELECT delivery_status
                    FROM glpi_plugin_integaglpi_messages m
                    WHERE m.conversation_id = c.id
                      AND m.direction = 'outbound'
                    ORDER BY m.created_at DESC, m.id DESC
                    LIMIT 1
                ) lom ON TRUE
                LEFT JOIN LATERAL (
                    SELECT status
                    FROM glpi_plugin_integaglpi_entity_selection_attempts a
                    WHERE a.conversation_id = c.id
                    ORDER BY a.updated_at DESC
                    LIMIT 1
                ) esa ON TRUE
                WHERE {$whereSql}
                ORDER BY c.last_message_at DESC NULLS LAST, c.updated_at DESC NULLS LAST
                LIMIT :sample_limit
            )
            SELECT
                COUNT(*) FILTER (WHERE status NOT IN ('closed', 'cancelled'))::int AS open_conversations,
                COUNT(*) FILTER (WHERE last_direction = 'inbound' AND status NOT IN ('closed', 'cancelled'))::int AS waiting_technician,
                COUNT(*) FILTER (WHERE last_direction = 'outbound' AND status NOT IN ('closed', 'cancelled'))::int AS waiting_customer,
                COUNT(*) FILTER (
                    WHERE (
                        delivery_status = 'failed'
                        OR inactivity_status = 'failed'
                        OR entity_status LIKE 'failed%'
                    )
                    AND (last_message_created_at IS NULL OR last_message_created_at >= NOW() - INTERVAL '24 hours')
                )::int AS failures_24h,
                COUNT(*) FILTER (WHERE glpi_ticket_id IS NULL OR glpi_ticket_id = 0 OR status = 'awaiting_entity_selection' OR entity_status = 'processing')::int AS pre_ticket_or_entity
            FROM recent
            SQL
        );
        $this->bindParams($statement, $params);
        $statement->bindValue(':sample_limit', self::KPI_SAMPLE_LIMIT, PDO::PARAM_INT);
        $statement->execute();
        $row = $statement->fetch(PDO::FETCH_ASSOC);
        if (!is_array($row)) {
            return $this->emptyKpis();
        }

        return [
            'open_conversations' => (int) ($row['open_conversations'] ?? 0),
            'waiting_technician' => (int) ($row['waiting_technician'] ?? 0),
            'waiting_customer' => (int) ($row['waiting_customer'] ?? 0),
            'failures_24h' => (int) ($row['failures_24h'] ?? 0),
            'pre_ticket_or_entity' => (int) ($row['pre_ticket_or_entity'] ?? 0),
        ];
    }

    /**
     * @return array{0: string, 1: array<string, array{value: mixed, type: int}>}
     */
    private function buildWhere(array $filters, int $userId, bool $supervisor, bool $kpiMode): array
    {
        $where = ['1 = 1'];
        $params = [];

        $allowedEntityIds = $this->activeEntityIds();
        if ($allowedEntityIds !== []) {
            $placeholders = [];
            foreach ($allowedEntityIds as $index => $entityId) {
                $placeholder = ':allowed_entity_' . $index;
                $placeholders[] = $placeholder;
                $params[$placeholder] = ['value' => $entityId, 'type' => PDO::PARAM_INT];
            }
            $where[] = '(c.glpi_entity_id IS NULL OR c.glpi_entity_id = 0 OR c.glpi_entity_id IN (' . implode(', ', $placeholders) . '))';
        }

        if (!$supervisor) {
            $where[] = '(rt.assigned_user_id = :current_user_id OR qu.users_id = :current_user_id)';
            $params[':current_user_id'] = ['value' => max(0, $userId), 'type' => PDO::PARAM_INT];
        }

        $view = (string) ($filters['view'] ?? '');
        if ($view === 'mine') {
            $where[] = 'rt.assigned_user_id = :mine_user_id';
            $params[':mine_user_id'] = ['value' => max(0, $userId), 'type' => PDO::PARAM_INT];
        } elseif ($view === 'pending_technician') {
            $where[] = "lm.direction = 'inbound'";
        } elseif ($view === 'pending_customer') {
            $where[] = "lm.direction = 'outbound'";
        } elseif ($view === 'pre_ticket') {
            $where[] = '(c.glpi_ticket_id IS NULL OR c.glpi_ticket_id = 0)';
        } elseif ($view === 'awaiting_entity') {
            $where[] = "(c.status = 'awaiting_entity_selection' OR esa.status = 'processing')";
        } elseif ($view === 'failures') {
            $where[] = "(COALESCE(lm.delivery_status, lom.delivery_status) = 'failed' OR it.status = 'failed' OR esa.status LIKE 'failed%')";
        } elseif ($view === 'tickets_open') {
            $where[] = "c.glpi_ticket_id IS NOT NULL AND c.glpi_ticket_id > 0 AND c.status NOT IN ('closed', 'cancelled')";
        } elseif ($view === 'tickets_solved_recent') {
            $where[] = "EXISTS (
                SELECT 1
                FROM glpi_plugin_integaglpi_solution_actions sa
                WHERE sa.conversation_id = c.id
                  AND sa.final_ticket_status = 5
                  AND sa.created_at >= NOW() - INTERVAL '7 days'
            )";
        }

        if (!$kpiMode) {
            $queueId = (int) ($filters['queue_id'] ?? 0);
            if ($queueId > 0) {
                $where[] = 'COALESCE(rt.queue_id, c.queue_id) = :queue_id';
                $params[':queue_id'] = ['value' => $queueId, 'type' => PDO::PARAM_INT];
            }

            $technicianId = (int) ($filters['technician_id'] ?? 0);
            if ($technicianId > 0) {
                $where[] = 'rt.assigned_user_id = :technician_id';
                $params[':technician_id'] = ['value' => $technicianId, 'type' => PDO::PARAM_INT];
            }

            $entityId = (int) ($filters['entity_id'] ?? 0);
            if ($entityId > 0) {
                $where[] = 'c.glpi_entity_id = :entity_id';
                $params[':entity_id'] = ['value' => $entityId, 'type' => PDO::PARAM_INT];
            }

            $conversationStatus = (string) ($filters['conversation_status'] ?? '');
            if ($conversationStatus !== '') {
                $where[] = 'c.status = :conversation_status';
                $params[':conversation_status'] = ['value' => $conversationStatus, 'type' => PDO::PARAM_STR];
            }

            $waiting = (string) ($filters['waiting'] ?? '');
            if ($waiting === 'technician') {
                $where[] = "lm.direction = 'inbound'";
            } elseif ($waiting === 'customer') {
                $where[] = "lm.direction = 'outbound'";
            }

            $ticketStatusQuick = (string) ($filters['ticket_status_quick'] ?? 'active');
            $ticketLink = (string) ($filters['ticket_link'] ?? '');
            if ($ticketStatusQuick === 'without_ticket') {
                $where[] = '(c.glpi_ticket_id IS NULL OR c.glpi_ticket_id = 0)';
            } elseif ($ticketStatusQuick === 'all') {
                if ($ticketLink === 'with_ticket') {
                    $where[] = 'c.glpi_ticket_id IS NOT NULL AND c.glpi_ticket_id > 0';
                } elseif ($ticketLink === 'without_ticket') {
                    $where[] = '(c.glpi_ticket_id IS NULL OR c.glpi_ticket_id = 0)';
                }
            }

            $search = (string) ($filters['search'] ?? '');
            if ($search !== '') {
                $where[] = '(c.phone_e164 ILIKE :search_like OR CAST(c.glpi_ticket_id AS TEXT) = :search_exact)';
                $params[':search_like'] = ['value' => '%' . $search . '%', 'type' => PDO::PARAM_STR];
                $params[':search_exact'] = ['value' => $search, 'type' => PDO::PARAM_STR];
            }
        }

        return [implode(' AND ', $where), $params];
    }

    /**
     * @param list<array<string, mixed>> $rows
     * @return list<array<string, mixed>>
     */
    private function decorateRows(array $rows, int $ticketStatusFilter, string $ticketStatusQuick): array
    {
        $ticketIds = [];
        $userIds = [];
        $entityIds = [];
        foreach ($rows as $row) {
            $ticketId = (int) ($row['glpi_ticket_id'] ?? 0);
            if ($ticketId > 0) {
                $ticketIds[] = $ticketId;
            }
            $userId = (int) ($row['assigned_user_id'] ?? 0);
            if ($userId > 0) {
                $userIds[] = $userId;
            }
            $entityId = (int) ($row['memory_entity_id'] ?? $row['glpi_entity_id'] ?? 0);
            if ($entityId > 0) {
                $entityIds[] = $entityId;
            }
        }

        $tickets = $this->loadTicketDetails(array_values(array_unique($ticketIds)));
        $users = $this->loadUserNames(array_values(array_unique($userIds)));
        $entities = $this->loadEntityNames(array_values(array_unique($entityIds)));
        $decorated = [];
        foreach ($rows as $row) {
            $ticketId = (int) ($row['glpi_ticket_id'] ?? 0);
            $ticket = $tickets[$ticketId] ?? [];
            $ticketStatus = (int) ($ticket['status'] ?? 0);
            if (!$this->matchesQuickTicketStatus($ticketId, $ticketStatus, $ticketStatusQuick)) {
                continue;
            }
            if ($ticketStatusFilter > 0 && $ticketStatus !== $ticketStatusFilter) {
                continue;
            }
            $entityId = (int) ($row['memory_entity_id'] ?? $row['glpi_entity_id'] ?? 0);
            $lastDirection = strtolower((string) ($row['last_message_direction'] ?? ''));
            $waitingState = $lastDirection === 'inbound'
                ? 'waiting_technician'
                : ($lastDirection === 'outbound' ? 'waiting_customer' : 'system_unknown');
            $lastInboundAt = (string) ($row['last_inbound_at'] ?? '');
            $windowStatus = $this->whatsappWindowStatus($lastInboundAt);
            $failure = (string) ($row['last_delivery_status'] ?? '') === 'failed'
                || (string) ($row['inactivity_status'] ?? '') === 'failed'
                || strpos((string) ($row['entity_attempt_status'] ?? ''), 'failed') === 0;

            $decorated[] = [
                'conversation_id' => (string) ($row['conversation_id'] ?? ''),
                'conversation_short' => $this->shortId((string) ($row['conversation_id'] ?? '')),
                'ticket_id' => $ticketId,
                'phone_masked' => $this->maskPhone((string) ($row['phone_e164'] ?? '')),
                'requester_name' => $this->safeDisplayText((string) ($row['requester_name'] ?? ''), 80),
                'company_name' => $this->safeDisplayText((string) ($row['company_name'] ?? ''), 80),
                'entity_name' => $this->safeDisplayText((string) ($row['memory_entity_name'] ?? $entities[$entityId] ?? ''), 90),
                'queue_name' => $this->safeDisplayText((string) ($row['queue_name'] ?? ''), 80),
                'technician_name' => $this->safeDisplayText((string) ($users[(int) ($row['assigned_user_id'] ?? 0)] ?? ''), 80),
                'conversation_status' => $this->safeDisplayText((string) ($row['conversation_status'] ?? ''), 40),
                'runtime_status' => $this->safeDisplayText((string) ($row['runtime_status'] ?? ''), 40),
                'ticket_status' => $ticketStatus,
                'ticket_status_label' => $this->ticketStatusLabel($ticketStatus),
                'ticket_priority' => (int) ($ticket['priority'] ?? 0),
                'last_message' => $this->sanitizeMessagePreview((string) ($row['last_message_text'] ?? ''), (string) ($row['last_message_type'] ?? '')),
                'last_direction' => $lastDirection !== '' ? $lastDirection : 'system',
                'last_message_at' => (string) ($row['last_message_created_at'] ?? $row['last_message_at'] ?? ''),
                'stalled_seconds' => max(0, (int) ($row['stalled_seconds'] ?? 0)),
                'stalled_label' => $this->durationLabel(max(0, (int) ($row['stalled_seconds'] ?? 0))),
                'waiting_state' => $waitingState,
                'whatsapp_window' => $windowStatus,
                'last_delivery_status' => $this->safeDisplayText((string) ($row['last_delivery_status'] ?? ''), 40),
                'inactivity_status' => $this->safeDisplayText((string) ($row['inactivity_status'] ?? ''), 60),
                'failure' => $failure,
                'failure_reason' => $failure ? $this->failureReason($row) : '',
            ];
        }

        return $decorated;
    }

    private function matchesQuickTicketStatus(int $ticketId, int $ticketStatus, string $quickFilter): bool
    {
        if ($quickFilter === 'all') {
            return true;
        }
        if ($quickFilter === 'without_ticket') {
            return $ticketId <= 0;
        }
        if ($ticketId <= 0) {
            return $quickFilter === 'active';
        }
        if ($quickFilter === 'active') {
            return !in_array($ticketStatus, [5, 6], true);
        }
        if ($quickFilter === 'new') {
            return $ticketStatus === 1;
        }
        if ($quickFilter === 'processing') {
            return in_array($ticketStatus, [2, 3], true);
        }
        if ($quickFilter === 'pending') {
            return $ticketStatus === 4;
        }
        if ($quickFilter === 'solved') {
            return $ticketStatus === 5;
        }
        if ($quickFilter === 'closed') {
            return $ticketStatus === 6;
        }

        return true;
    }

    /**
     * @return array<string, list<array<string, mixed>>>
     */
    private function loadFilterOptions(PDO $pdo, int $userId, bool $supervisor): array
    {
        $queues = [];
        foreach ($pdo->query("SELECT id, name FROM glpi_plugin_integaglpi_queues WHERE is_active = TRUE ORDER BY name ASC LIMIT 100") ?: [] as $row) {
            $queues[] = ['id' => (int) ($row['id'] ?? 0), 'name' => $this->safeDisplayText((string) ($row['name'] ?? ''), 80)];
        }

        $technicianIds = [];
        $techStmt = $pdo->query(
            "SELECT DISTINCT assigned_user_id
               FROM glpi_plugin_integaglpi_conversation_runtime
              WHERE assigned_user_id IS NOT NULL AND assigned_user_id > 0
              ORDER BY assigned_user_id ASC
              LIMIT 100"
        );
        if ($techStmt !== false) {
            while (($row = $techStmt->fetch(PDO::FETCH_ASSOC)) !== false) {
                $technicianIds[] = (int) ($row['assigned_user_id'] ?? 0);
            }
        }
        $userNames = $this->loadUserNames($technicianIds);
        $technicians = [];
        foreach ($technicianIds as $technicianId) {
            $technicians[] = ['id' => $technicianId, 'name' => $userNames[$technicianId] ?? ('#' . $technicianId)];
        }

        $entities = [];
        $entityStmt = $pdo->query(
            "SELECT glpi_entity_id, MAX(glpi_entity_name) AS glpi_entity_name
               FROM glpi_plugin_integaglpi_conversations
              WHERE glpi_entity_id IS NOT NULL AND glpi_entity_id > 0
              GROUP BY glpi_entity_id
              ORDER BY MAX(glpi_entity_name) ASC NULLS LAST
              LIMIT 100"
        );
        if ($entityStmt !== false) {
            while (($row = $entityStmt->fetch(PDO::FETCH_ASSOC)) !== false) {
                $id = (int) ($row['glpi_entity_id'] ?? 0);
                $entities[] = ['id' => $id, 'name' => $this->safeDisplayText((string) ($row['glpi_entity_name'] ?? ('#' . $id)), 90)];
            }
        }

        return [
            'queues' => $queues,
            'technicians' => $technicians,
            'entities' => $entities,
            'conversation_statuses' => [
                ['id' => 'open', 'name' => 'open'],
                ['id' => 'awaiting_queue_selection', 'name' => 'awaiting_queue_selection'],
                ['id' => 'awaiting_entity_selection', 'name' => 'awaiting_entity_selection'],
                ['id' => 'collecting_contact_profile', 'name' => 'collecting_contact_profile'],
                ['id' => 'pending_glpi', 'name' => 'pending_glpi'],
                ['id' => 'closed', 'name' => 'closed'],
            ],
            'ticket_statuses' => [
                ['id' => 1, 'name' => 'new'],
                ['id' => 2, 'name' => 'processing'],
                ['id' => 3, 'name' => 'planned'],
                ['id' => 4, 'name' => 'pending'],
                ['id' => 5, 'name' => 'solved'],
                ['id' => 6, 'name' => 'closed'],
            ],
        ];
    }

    /**
     * @param list<int> $ticketIds
     * @return array<int, array<string, mixed>>
     */
    private function loadTicketDetails(array $ticketIds): array
    {
        global $DB;
        $ticketIds = array_values(array_filter(array_unique(array_map('intval', $ticketIds)), 'intval'));
        if ($ticketIds === [] || !isset($DB) || !is_object($DB) || !$DB->tableExists('glpi_tickets')) {
            return [];
        }

        $rows = [];
        foreach ($DB->request([
            'SELECT' => ['id', 'status', 'priority', 'entities_id'],
            'FROM' => 'glpi_tickets',
            'WHERE' => ['id' => $ticketIds],
        ]) as $row) {
            $id = (int) ($row['id'] ?? 0);
            if ($id > 0) {
                $rows[$id] = [
                    'status' => (int) ($row['status'] ?? 0),
                    'priority' => (int) ($row['priority'] ?? 0),
                    'entities_id' => (int) ($row['entities_id'] ?? 0),
                ];
            }
        }

        return $rows;
    }

    /**
     * @param list<int> $userIds
     * @return array<int, string>
     */
    private function loadUserNames(array $userIds): array
    {
        global $DB;
        $userIds = array_values(array_filter(array_unique(array_map('intval', $userIds)), 'intval'));
        if ($userIds === [] || !isset($DB) || !is_object($DB) || !$DB->tableExists('glpi_users')) {
            return [];
        }

        $rows = [];
        foreach ($DB->request([
            'SELECT' => ['id', 'name', 'realname', 'firstname'],
            'FROM' => 'glpi_users',
            'WHERE' => ['id' => $userIds],
        ]) as $row) {
            $id = (int) ($row['id'] ?? 0);
            $name = trim((string) ($row['firstname'] ?? '') . ' ' . (string) ($row['realname'] ?? ''));
            if ($name === '') {
                $name = (string) ($row['name'] ?? '');
            }
            if ($id > 0) {
                $rows[$id] = $this->safeDisplayText($name, 80);
            }
        }

        return $rows;
    }

    /**
     * @param list<int> $entityIds
     * @return array<int, string>
     */
    private function loadEntityNames(array $entityIds): array
    {
        global $DB;
        $entityIds = array_values(array_filter(array_unique(array_map('intval', $entityIds)), 'intval'));
        if ($entityIds === [] || !isset($DB) || !is_object($DB) || !$DB->tableExists('glpi_entities')) {
            return [];
        }

        $rows = [];
        foreach ($DB->request([
            'SELECT' => ['id', 'name', 'completename'],
            'FROM' => 'glpi_entities',
            'WHERE' => ['id' => $entityIds],
        ]) as $row) {
            $id = (int) ($row['id'] ?? 0);
            $name = (string) ($row['completename'] ?? $row['name'] ?? '');
            if ($id > 0) {
                $rows[$id] = $this->safeDisplayText($name, 90);
            }
        }

        return $rows;
    }

    /**
     * @param array<string, array{value: mixed, type: int}> $params
     */
    private function bindParams(\PDOStatement $statement, array $params): void
    {
        foreach ($params as $key => $definition) {
            $statement->bindValue($key, $definition['value'], $definition['type']);
        }
    }

    /**
     * @return list<int>
     */
    private function activeEntityIds(): array
    {
        if (!class_exists('\Session') || !method_exists('\Session', 'getActiveEntities')) {
            return [];
        }

        $entities = \Session::getActiveEntities();
        if (!is_array($entities)) {
            return [];
        }

        return array_values(array_filter(array_map('intval', $entities), static function (int $id): bool {
            return $id > 0;
        }));
    }

    /**
     * @return array<string, int>
     */
    private function emptyKpis(): array
    {
        return [
            'open_conversations' => 0,
            'waiting_technician' => 0,
            'waiting_customer' => 0,
            'failures_24h' => 0,
            'pre_ticket_or_entity' => 0,
        ];
    }

    /**
     * @return array<string, list<array<string, mixed>>>
     */
    private function emptyOptions(): array
    {
        return [
            'queues' => [],
            'technicians' => [],
            'entities' => [],
            'conversation_statuses' => [],
            'ticket_statuses' => [],
        ];
    }

    private function safeToken(string $value): string
    {
        $value = strtolower(trim($value));

        return preg_match('/^[a-z0-9_-]{1,80}$/', $value) === 1 ? $value : '';
    }

    private function safeSearch(string $value): string
    {
        $value = trim($value);
        $value = preg_replace('/[^0-9A-Za-z@._:+-]+/', '', $value) ?? '';

        return substr($value, 0, 40);
    }

    private function safeDisplayText(string $value, int $limit): string
    {
        $value = html_entity_decode(strip_tags($value), ENT_QUOTES | ENT_HTML5, 'UTF-8');
        $value = preg_replace('/[[:cntrl:]]+/', ' ', $value) ?? '';
        $value = preg_replace('/[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}/i', '[email]', $value) ?? '';
        $value = preg_replace('/\b(?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?\d{4,5}[\s.\-]?\d{4}\b/', '[telefone]', $value) ?? '';
        $value = trim((string) preg_replace('/\s+/', ' ', $value));

        return function_exists('mb_substr') ? mb_substr($value, 0, $limit, 'UTF-8') : substr($value, 0, $limit);
    }

    private function sanitizeMessagePreview(string $message, string $messageType): string
    {
        $message = $this->safeDisplayText($message, 150);
        if ($message !== '') {
            return $message;
        }

        $type = $this->safeDisplayText($messageType, 40);
        return $type !== '' ? '[' . $type . ']' : '[mensagem]';
    }

    private function maskPhone(string $phone): string
    {
        $digits = preg_replace('/\D+/', '', $phone) ?? '';
        if (strlen($digits) <= 4) {
            return '****';
        }

        return substr($digits, 0, 2) . str_repeat('*', max(4, strlen($digits) - 6)) . substr($digits, -4);
    }

    private function shortId(string $id): string
    {
        $id = preg_replace('/[^A-Za-z0-9_-]+/', '', $id) ?? '';
        if (strlen($id) <= 12) {
            return $id;
        }

        return substr($id, 0, 8) . '...' . substr($id, -4);
    }

    private function whatsappWindowStatus(string $lastInboundAt): string
    {
        $timestamp = strtotime($lastInboundAt);
        if ($timestamp === false || $timestamp <= 0) {
            return 'not_verified';
        }

        return (time() - $timestamp) < 86400 ? 'open' : 'closed';
    }

    private function durationLabel(int $seconds): string
    {
        if ($seconds < 60) {
            return $seconds . 's';
        }
        if ($seconds < 3600) {
            return (int) floor($seconds / 60) . 'min';
        }
        if ($seconds < 86400) {
            return (int) floor($seconds / 3600) . 'h';
        }

        return (int) floor($seconds / 86400) . 'd';
    }

    private function ticketStatusLabel(int $status): string
    {
        $labels = [
            1 => 'new',
            2 => 'processing',
            3 => 'planned',
            4 => 'pending',
            5 => 'solved',
            6 => 'closed',
        ];

        return $labels[$status] ?? ($status > 0 ? ('#' . $status) : 'not_verified');
    }

    /**
     * @param array<string, mixed> $row
     */
    private function failureReason(array $row): string
    {
        if ((string) ($row['last_delivery_status'] ?? '') === 'failed') {
            return $this->safeDisplayText((string) ($row['last_delivery_error_message_sanitized'] ?? 'delivery_failed'), 100);
        }
        if ((string) ($row['inactivity_status'] ?? '') === 'failed') {
            return $this->safeDisplayText((string) ($row['inactivity_skip_reason'] ?? 'inactivity_failed'), 100);
        }

        return $this->safeDisplayText((string) ($row['entity_attempt_error_message'] ?? 'entity_selection_failed'), 100);
    }

    private function sanitizeLog(string $message): string
    {
        $message = preg_replace('/(password|senha|token|secret|bearer|api[_-]?key)\s*[:=]\s*\S+/i', '$1=[redacted]', $message) ?? '';
        $message = preg_replace('/[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}/i', '[email]', $message) ?? '';
        $message = preg_replace('/\b(?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?\d{4,5}[\s.\-]?\d{4}\b/', '[telefone]', $message) ?? '';

        return substr($message, 0, 220);
    }
}
