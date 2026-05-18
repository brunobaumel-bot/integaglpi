<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi\External\Repository;

use PDO;
use PDOStatement;

final class SupervisorBackofficeRepository
{
    public function __construct(private readonly PDO $pdo)
    {
    }

    /**
     * @param array<string, mixed> $filters
     * @param list<int> $entityIds
     * @return array<string, int>
     */
    public function getKpis(array $filters, array $entityIds): array
    {
        [$whereSql, $params] = $this->buildBaseWhere($filters, $entityIds);

        $statement = $this->pdo->prepare(
            <<<SQL
            WITH base AS (
                {$this->baseSelectSql($whereSql)}
            )
            SELECT
                COUNT(DISTINCT glpi_ticket_id) FILTER (WHERE glpi_ticket_id IS NOT NULL) AS total_tickets,
                COUNT(DISTINCT glpi_ticket_id) FILTER (WHERE glpi_ticket_id IS NOT NULL AND conversation_status = 'open') AS open_tickets,
                COUNT(DISTINCT glpi_ticket_id) FILTER (WHERE final_ticket_status = 5) AS solved_tickets,
                COUNT(DISTINCT glpi_ticket_id) FILTER (WHERE final_ticket_status = 6 OR conversation_status = 'closed' OR inactivity_status = 'autoclose_done') AS closed_tickets,
                COUNT(DISTINCT glpi_ticket_id) FILTER (WHERE csat_dissatisfied = TRUE) AS dissatisfied_tickets,
                COUNT(DISTINCT glpi_ticket_id) FILTER (WHERE supervisor_review_required = TRUE) AS supervisor_review_tickets,
                COUNT(DISTINCT glpi_ticket_id) FILTER (WHERE inactivity_status = 'autoclose_done') AS inactivity_autoclose_tickets,
                COUNT(DISTINCT glpi_ticket_id) FILTER (WHERE inactivity_status = 'failed') AS inactivity_attention_tickets,
                COUNT(DISTINCT glpi_ticket_id) FILTER (
                    WHERE csat_dissatisfied = TRUE
                       OR supervisor_review_required = TRUE
                       OR inactivity_status IN ('failed', 'reminder_3_sent')
                       OR has_critical_event = TRUE
                ) AS operational_risk_tickets
            FROM base
            SQL
        );
        $this->bindParams($statement, $params);
        $statement->execute();
        $row = $statement->fetch(PDO::FETCH_ASSOC) ?: [];

        return [
            'total_tickets' => (int) ($row['total_tickets'] ?? 0),
            'open_tickets' => (int) ($row['open_tickets'] ?? 0),
            'solved_tickets' => (int) ($row['solved_tickets'] ?? 0),
            'closed_tickets' => (int) ($row['closed_tickets'] ?? 0),
            'dissatisfied_tickets' => (int) ($row['dissatisfied_tickets'] ?? 0),
            'supervisor_review_tickets' => (int) ($row['supervisor_review_tickets'] ?? 0),
            'inactivity_autoclose_tickets' => (int) ($row['inactivity_autoclose_tickets'] ?? 0),
            'inactivity_attention_tickets' => (int) ($row['inactivity_attention_tickets'] ?? 0),
            'operational_risk_tickets' => (int) ($row['operational_risk_tickets'] ?? 0),
        ];
    }

    /**
     * @param array<string, mixed> $filters
     * @param list<int> $entityIds
     */
    public function countReviewTickets(array $filters, array $entityIds): int
    {
        [$whereSql, $params] = $this->buildBaseWhere($filters, $entityIds);
        $riskSql = $this->buildRiskWhere((string) ($filters['quality'] ?? ''));

        $statement = $this->pdo->prepare(
            <<<SQL
            WITH base AS (
                {$this->baseSelectSql($whereSql)}
            )
            SELECT COUNT(*)
            FROM base
            WHERE {$riskSql}
            SQL
        );
        $this->bindParams($statement, $params);
        $statement->execute();

        return (int) $statement->fetchColumn();
    }

    /**
     * @param array<string, mixed> $filters
     * @param list<int> $entityIds
     * @return list<array<string, mixed>>
     */
    public function findReviewTickets(array $filters, array $entityIds, int $limit, int $offset): array
    {
        [$whereSql, $params] = $this->buildBaseWhere($filters, $entityIds);
        $riskSql = $this->buildRiskWhere((string) ($filters['quality'] ?? ''));

        $statement = $this->pdo->prepare(
            <<<SQL
            WITH base AS (
                {$this->baseSelectSql($whereSql)}
            )
            SELECT
                conversation_id,
                glpi_ticket_id,
                phone_e164,
                requester_name,
                email_address,
                company_name_raw,
                conversation_status,
                queue_id,
                queue_name,
                assigned_user_id,
                entity_id,
                entity_name,
                last_message_at,
                created_at,
                final_ticket_status,
                csat_dissatisfied,
                supervisor_review_required,
                inactivity_status,
                inactivity_skip_reason,
                has_critical_event,
                latest_error_message
            FROM base
            WHERE {$riskSql}
            ORDER BY
                CASE
                    WHEN csat_dissatisfied = TRUE THEN 1
                    WHEN supervisor_review_required = TRUE THEN 2
                    WHEN inactivity_status = 'failed' THEN 3
                    WHEN has_critical_event = TRUE THEN 4
                    ELSE 5
                END ASC,
                last_message_at DESC NULLS LAST,
                created_at DESC
            LIMIT :limit OFFSET :offset
            SQL
        );
        $this->bindParams($statement, $params);
        $statement->bindValue(':limit', $limit, PDO::PARAM_INT);
        $statement->bindValue(':offset', $offset, PDO::PARAM_INT);
        $statement->execute();
        $rows = $statement->fetchAll(PDO::FETCH_ASSOC);

        return is_array($rows) ? $rows : [];
    }

    /**
     * @param array<string, mixed> $filters
     * @param list<int> $entityIds
     * @return list<array<string, mixed>>
     */
    public function findTechnicianPerformance(array $filters, array $entityIds, int $limit): array
    {
        [$whereSql, $params] = $this->buildBaseWhere($filters, $entityIds);

        $statement = $this->pdo->prepare(
            <<<SQL
            WITH base AS (
                {$this->baseSelectSql($whereSql)}
            )
            SELECT
                assigned_user_id,
                COUNT(DISTINCT glpi_ticket_id) FILTER (WHERE glpi_ticket_id IS NOT NULL) AS total_tickets,
                COUNT(DISTINCT glpi_ticket_id) FILTER (WHERE final_ticket_status IN (5, 6) OR conversation_status = 'closed') AS resolved_or_closed_tickets,
                COUNT(DISTINCT glpi_ticket_id) FILTER (WHERE csat_dissatisfied = TRUE) AS dissatisfied_tickets,
                COUNT(DISTINCT glpi_ticket_id) FILTER (WHERE supervisor_review_required = TRUE) AS supervisor_review_tickets
            FROM base
            WHERE assigned_user_id IS NOT NULL AND assigned_user_id > 0
            GROUP BY assigned_user_id
            ORDER BY total_tickets DESC, assigned_user_id ASC
            LIMIT :limit
            SQL
        );
        $this->bindParams($statement, $params);
        $statement->bindValue(':limit', $limit, PDO::PARAM_INT);
        $statement->execute();
        $rows = $statement->fetchAll(PDO::FETCH_ASSOC);

        return is_array($rows) ? $rows : [];
    }

    /**
     * @return list<array{id: int, name: string}>
     */
    public function findQueues(): array
    {
        $statement = $this->pdo->prepare(
            <<<SQL
            SELECT id, name
            FROM glpi_plugin_integaglpi_queues
            WHERE is_active = TRUE
            ORDER BY name ASC
            LIMIT 200
            SQL
        );
        $statement->execute();
        $rows = $statement->fetchAll(PDO::FETCH_ASSOC);
        if (!is_array($rows)) {
            return [];
        }

        return array_map(
            static fn (array $row): array => [
                'id' => (int) ($row['id'] ?? 0),
                'name' => (string) ($row['name'] ?? ''),
            ],
            $rows
        );
    }

    /**
     * @param list<int> $ticketIds
     * @return array<int, array<string, mixed>>
     */
    public function findLatestAiQualityByTicketIds(array $ticketIds): array
    {
        $ticketIds = array_values(array_unique(array_filter(array_map('intval', $ticketIds), static fn (int $id): bool => $id > 0)));
        if ($ticketIds === [] || !$this->hasAiQualityAnalysesTable()) {
            return [];
        }

        $placeholders = [];
        $params = [];
        foreach ($ticketIds as $index => $ticketId) {
            $name = ':ticket_' . $index;
            $placeholders[] = $name;
            $params[$name] = ['value' => $ticketId, 'type' => PDO::PARAM_INT];
        }

        $sql = <<<SQL
            SELECT DISTINCT ON (glpi_ticket_id)
                id,
                conversation_id,
                glpi_ticket_id,
                status,
                classification_resolution,
                sentiment,
                summary,
                recommendation,
                supervisor_feedback,
                created_at,
                updated_at
            FROM glpi_plugin_integaglpi_ai_quality_analyses
            WHERE glpi_ticket_id IN (
                PLACEHOLDER_TICKET_IDS
            )
            ORDER BY glpi_ticket_id, created_at DESC, id DESC
            SQL
        ;
        $statement = $this->pdo->prepare(str_replace('PLACEHOLDER_TICKET_IDS', implode(', ', $placeholders), $sql));
        $this->bindParams($statement, $params);
        $statement->execute();
        $rows = $statement->fetchAll(PDO::FETCH_ASSOC);

        $byTicket = [];
        if (!is_array($rows)) {
            return $byTicket;
        }

        foreach ($rows as $row) {
            $byTicket[(int) ($row['glpi_ticket_id'] ?? 0)] = $row;
        }

        return $byTicket;
    }

    /**
     * @param array<string, mixed> $filters
     * @param list<int> $entityIds
     * @return array{0: string, 1: array<string, array{value: mixed, type: int}>}
     */
    private function buildBaseWhere(array $filters, array $entityIds): array
    {
        $where = [
            'c.created_at >= :date_from',
            'c.created_at <= :date_to',
            'c.glpi_ticket_id IS NOT NULL',
        ];
        $params = [
            ':date_from' => ['value' => (string) $filters['date_from_sql'], 'type' => PDO::PARAM_STR],
            ':date_to' => ['value' => (string) $filters['date_to_sql'], 'type' => PDO::PARAM_STR],
        ];

        $entityIds = array_values(array_filter(array_map('intval', $entityIds), static fn (int $id): bool => $id > 0));
        if ($entityIds === []) {
            $where[] = 'FALSE';
        } else {
            $placeholders = [];
            foreach ($entityIds as $index => $entityId) {
                $name = ':entity_' . $index;
                $placeholders[] = $name;
                $params[$name] = ['value' => $entityId, 'type' => PDO::PARAM_INT];
            }
            $where[] = 'COALESCE(cem.glpi_entity_id, esa.glpi_entity_id) IN (' . implode(', ', $placeholders) . ')';
        }

        $entityFilter = (int) ($filters['entity_id'] ?? 0);
        if ($entityFilter > 0 && !in_array($entityFilter, $entityIds, true)) {
            $where[] = 'FALSE';
        } elseif ($entityFilter > 0) {
            $where[] = 'COALESCE(cem.glpi_entity_id, esa.glpi_entity_id) = :entity_filter';
            $params[':entity_filter'] = ['value' => $entityFilter, 'type' => PDO::PARAM_INT];
        }

        $queueId = (int) ($filters['queue_id'] ?? 0);
        if ($queueId > 0) {
            $where[] = 'COALESCE(rt.queue_id, c.queue_id) = :queue_id';
            $params[':queue_id'] = ['value' => $queueId, 'type' => PDO::PARAM_INT];
        }

        $agentId = (int) ($filters['agent_id'] ?? 0);
        if ($agentId > 0) {
            $where[] = 'rt.assigned_user_id = :agent_id';
            $params[':agent_id'] = ['value' => $agentId, 'type' => PDO::PARAM_INT];
        }

        $status = trim((string) ($filters['status'] ?? ''));
        if ($status !== '') {
            $where[] = 'c.status = :conversation_status';
            $params[':conversation_status'] = ['value' => $status, 'type' => PDO::PARAM_STR];
        }

        return [implode(' AND ', $where), $params];
    }

    private function baseSelectSql(string $whereSql): string
    {
        return <<<SQL
            SELECT
                c.id AS conversation_id,
                c.phone_e164,
                c.glpi_ticket_id,
                c.status AS conversation_status,
                c.last_message_at,
                c.created_at,
                COALESCE(rt.queue_id, c.queue_id) AS queue_id,
                rt.assigned_user_id,
                q.name AS queue_name,
                cp.requester_name,
                cp.email_address,
                cp.company_name_raw,
                COALESCE(cem.glpi_entity_id, esa.glpi_entity_id) AS entity_id,
                COALESCE(cem.glpi_entity_name, esa.glpi_entity_name) AS entity_name,
                sa.final_ticket_status,
                COALESCE(sa.csat_dissatisfied, FALSE) AS csat_dissatisfied,
                COALESCE(sa.supervisor_review_required, FALSE) AS supervisor_review_required,
                it.status AS inactivity_status,
                it.skip_reason AS inactivity_skip_reason,
                COALESCE(ae.has_critical_event, FALSE) AS has_critical_event,
                ae.latest_error_message
            FROM glpi_plugin_integaglpi_conversations c
            LEFT JOIN glpi_plugin_integaglpi_conversation_runtime rt
                ON rt.conversation_id = c.id
            LEFT JOIN glpi_plugin_integaglpi_queues q
                ON q.id = COALESCE(rt.queue_id, c.queue_id)
            LEFT JOIN glpi_plugin_integaglpi_contact_profile cp
                ON cp.phone_e164 = c.phone_e164
                AND cp.is_active = TRUE
            LEFT JOIN glpi_plugin_integaglpi_contact_entity_memory cem
                ON cem.phone_e164 = c.phone_e164
                AND cem.is_active = TRUE
            LEFT JOIN glpi_plugin_integaglpi_entity_selection_attempts esa
                ON esa.conversation_id = c.id
                AND esa.status = 'succeeded'
            LEFT JOIN (
                SELECT
                    ticket_id,
                    MAX(final_ticket_status) FILTER (WHERE final_ticket_status IS NOT NULL) AS final_ticket_status,
                    BOOL_OR(csat_rating = 'dissatisfied') AS csat_dissatisfied,
                    BOOL_OR(supervisor_review_required = TRUE) AS supervisor_review_required
                FROM glpi_plugin_integaglpi_solution_actions
                WHERE created_at >= :date_from AND created_at <= :date_to
                GROUP BY ticket_id
            ) sa ON sa.ticket_id = c.glpi_ticket_id
            LEFT JOIN glpi_plugin_integaglpi_inactivity_tracking it
                ON it.conversation_id = c.id
            LEFT JOIN (
                SELECT
                    ticket_id,
                    TRUE AS has_critical_event,
                    MAX(error_message) AS latest_error_message
                FROM glpi_plugin_integaglpi_audit_events
                WHERE created_at >= :date_from
                  AND created_at <= :date_to
                  AND severity IN ('error', 'critical')
                  AND ticket_id IS NOT NULL
                GROUP BY ticket_id
            ) ae ON ae.ticket_id = c.glpi_ticket_id
            WHERE {$whereSql}
            SQL;
    }

    private function buildRiskWhere(string $quality): string
    {
        return match ($quality) {
            'csat_dissatisfied' => 'csat_dissatisfied = TRUE',
            'supervisor_review' => 'supervisor_review_required = TRUE',
            'inactivity_failed' => "inactivity_status = 'failed'",
            'inactivity_autoclose' => "inactivity_status = 'autoclose_done'",
            'critical_error' => 'has_critical_event = TRUE',
            default => "(csat_dissatisfied = TRUE OR supervisor_review_required = TRUE OR inactivity_status IN ('failed', 'autoclose_done', 'reminder_3_sent') OR has_critical_event = TRUE)",
        };
    }

    /**
     * @param array<string, array{value: mixed, type: int}> $params
     */
    private function bindParams(PDOStatement $statement, array $params): void
    {
        foreach ($params as $name => $definition) {
            $statement->bindValue($name, $definition['value'], $definition['type']);
        }
    }

    private function hasAiQualityAnalysesTable(): bool
    {
        $statement = $this->pdo->prepare("SELECT to_regclass('public.glpi_plugin_integaglpi_ai_quality_analyses') IS NOT NULL");
        $statement->execute();

        return (bool) $statement->fetchColumn();
    }
}
