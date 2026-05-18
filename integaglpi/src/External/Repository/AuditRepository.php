<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi\External\Repository;

use PDO;
use PDOStatement;

final class AuditRepository
{
    private const HEALTH_WINDOW_SQL = "created_at >= NOW() - INTERVAL '24 hours'";

    public function __construct(private readonly PDO $pdo)
    {
    }

    /**
     * @param array<string, mixed> $filters
     * @return list<array<string, mixed>>
     */
    public function findAuditEvents(array $filters, int $limit, int $offset): array
    {
        [$whereSql, $params] = $this->buildAuditWhere($filters);

        $statement = $this->pdo->prepare(
            <<<SQL
            SELECT
                id,
                created_at,
                correlation_id,
                ticket_id,
                conversation_id,
                message_id,
                direction,
                event_type,
                status,
                severity,
                source,
                error_message
            FROM glpi_plugin_integaglpi_audit_events
            WHERE {$whereSql}
            ORDER BY created_at DESC
            LIMIT :limit OFFSET :offset
            SQL
        );
        $this->bindParams($statement, $params);
        $statement->bindValue(':limit', $limit, PDO::PARAM_INT);
        $statement->bindValue(':offset', $offset, PDO::PARAM_INT);
        $statement->execute();

        $rows = $statement->fetchAll();

        return is_array($rows) ? $rows : [];
    }

    /**
     * @return array<string, mixed>|null
     */
    public function findAuditEventDetail(int $id): ?array
    {
        $statement = $this->pdo->prepare(
            <<<SQL
            SELECT *
            FROM glpi_plugin_integaglpi_audit_events
            WHERE id = :id
            LIMIT 1
            SQL
        );
        $statement->execute([':id' => $id]);
        $row = $statement->fetch();

        return is_array($row) ? $row : null;
    }

    public function hasDeadLetterTable(): bool
    {
        $statement = $this->pdo->prepare("SELECT to_regclass('public.glpi_plugin_integaglpi_dead_letter') IS NOT NULL");
        $statement->execute();

        return (bool) $statement->fetchColumn();
    }

    /**
     * @param array<string, mixed> $filters
     * @return list<array<string, mixed>>
     */
    public function findDeadLetters(array $filters, int $limit, int $offset): array
    {
        [$whereSql, $params] = $this->buildDeadLetterWhere($filters);

        $statement = $this->pdo->prepare(
            <<<SQL
            SELECT
                id,
                created_at,
                correlation_id,
                ticket_id,
                conversation_id,
                message_id,
                operation_type,
                failure_type,
                failure_reason,
                retry_count,
                status,
                last_attempt_at
            FROM glpi_plugin_integaglpi_dead_letter
            WHERE {$whereSql}
            ORDER BY created_at DESC
            LIMIT :limit OFFSET :offset
            SQL
        );
        $this->bindParams($statement, $params);
        $statement->bindValue(':limit', $limit, PDO::PARAM_INT);
        $statement->bindValue(':offset', $offset, PDO::PARAM_INT);
        $statement->execute();

        $rows = $statement->fetchAll();

        return is_array($rows) ? $rows : [];
    }

    /**
     * @return array<string, mixed>|null
     */
    public function findDeadLetterDetail(int $id): ?array
    {
        $statement = $this->pdo->prepare(
            <<<SQL
            SELECT *
            FROM glpi_plugin_integaglpi_dead_letter
            WHERE id = :id
            LIMIT 1
            SQL
        );
        $statement->execute([':id' => $id]);
        $row = $statement->fetch();

        return is_array($row) ? $row : null;
    }

    /**
     * @return array<string, int>
     */
    public function getHealthCounts24h(): array
    {
        $statement = $this->pdo->prepare(
            self::withHealthWindow(
                <<<SQL
            SELECT
                COUNT(*) FILTER (WHERE severity IN ('error', 'critical')) AS error_critical_count,
                COUNT(*) FILTER (WHERE severity = 'critical') AS critical_count,
                COUNT(*) FILTER (WHERE event_type IN ('META_API_FAILED', 'MESSAGE_FAILED')) AS meta_failure_count,
                COUNT(*) FILTER (WHERE event_type = 'GLPI_SYNC_FAILED') AS glpi_failure_count,
                COUNT(*) FILTER (
                    WHERE event_type IN ('WEBHOOK_DUPLICATED', 'MESSAGE_DUPLICATED', 'IDEMPOTENCY_CONFLICT')
                ) AS duplicated_webhook_count
            FROM glpi_plugin_integaglpi_audit_events
            WHERE %s
            SQL
            )
        );
        $statement->execute();
        $row = $statement->fetch();

        return [
            'error_critical_count' => (int) ($row['error_critical_count'] ?? 0),
            'critical_count' => (int) ($row['critical_count'] ?? 0),
            'meta_failure_count' => (int) ($row['meta_failure_count'] ?? 0),
            'glpi_failure_count' => (int) ($row['glpi_failure_count'] ?? 0),
            'duplicated_webhook_count' => (int) ($row['duplicated_webhook_count'] ?? 0),
        ];
    }

    /**
     * Heartbeat uses real audit events emitted by the integration-service and is limited to the 24h health window.
     *
     * @return array<string, mixed>|null
     */
    public function findLatestSuccessfulHeartbeat24h(): ?array
    {
        $statement = $this->pdo->prepare(
            self::withHealthWindow(
                <<<SQL
            SELECT created_at, event_type, status
            FROM glpi_plugin_integaglpi_audit_events
            WHERE %s
              AND event_type IN ('WEBHOOK_RECEIVED', 'MESSAGE_RECEIVED', 'MESSAGE_SENT')
              AND status IN ('success', 'ignored')
            ORDER BY created_at DESC
            LIMIT 1
            SQL
            )
        );
        $statement->execute();
        $row = $statement->fetch();

        return is_array($row) ? $row : null;
    }

    public function countOpenDeadLetters(): ?int
    {
        if (!$this->hasDeadLetterTable()) {
            return null;
        }

        $statement = $this->pdo->prepare(
            <<<SQL
            SELECT COUNT(*) AS total
            FROM glpi_plugin_integaglpi_dead_letter
            WHERE status = 'open'
            SQL
        );
        $statement->execute();

        return (int) $statement->fetchColumn();
    }

    /**
     * @param array<string, mixed> $filters
     * @return array{0: string, 1: array<string, array{value: mixed, type: int}>}
     */
    private function buildAuditWhere(array $filters): array
    {
        $where = [
            'created_at >= :date_from',
            'created_at <= :date_to',
        ];
        $params = [
            ':date_from' => ['value' => (string) $filters['date_from_sql'], 'type' => PDO::PARAM_STR],
            ':date_to'   => ['value' => (string) $filters['date_to_sql'], 'type' => PDO::PARAM_STR],
        ];

        foreach (['correlation_id', 'conversation_id', 'message_id', 'event_type', 'severity', 'status', 'source'] as $field) {
            $value = trim((string) ($filters[$field] ?? ''));
            if ($value === '') {
                continue;
            }
            $where[] = "{$field} = :{$field}";
            $params[":{$field}"] = ['value' => $value, 'type' => PDO::PARAM_STR];
        }

        $ticketId = (int) ($filters['ticket_id'] ?? 0);
        if ($ticketId > 0) {
            $where[] = 'ticket_id = :ticket_id';
            $params[':ticket_id'] = ['value' => $ticketId, 'type' => PDO::PARAM_INT];
        }

        if (!empty($filters['only_errors'])) {
            $where[] = "(severity IN ('error', 'critical') OR status = 'failed' OR error_message IS NOT NULL)";
        }

        return [implode(' AND ', $where), $params];
    }

    /**
     * @param array<string, mixed> $filters
     * @return array{0: string, 1: array<string, array{value: mixed, type: int}>}
     */
    private function buildDeadLetterWhere(array $filters): array
    {
        $where = [
            'created_at >= :dl_date_from',
            'created_at <= :dl_date_to',
        ];
        $params = [
            ':dl_date_from' => ['value' => (string) $filters['date_from_sql'], 'type' => PDO::PARAM_STR],
            ':dl_date_to'   => ['value' => (string) $filters['date_to_sql'], 'type' => PDO::PARAM_STR],
        ];

        foreach (['correlation_id', 'conversation_id', 'message_id', 'status'] as $field) {
            $value = trim((string) ($filters[$field] ?? ''));
            if ($value === '') {
                continue;
            }
            $where[] = "{$field} = :dl_{$field}";
            $params[":dl_{$field}"] = ['value' => $value, 'type' => PDO::PARAM_STR];
        }

        $ticketId = (int) ($filters['ticket_id'] ?? 0);
        if ($ticketId > 0) {
            $where[] = 'ticket_id = :dl_ticket_id';
            $params[':dl_ticket_id'] = ['value' => $ticketId, 'type' => PDO::PARAM_INT];
        }

        return [implode(' AND ', $where), $params];
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

    private static function withHealthWindow(string $sql): string
    {
        return sprintf($sql, self::HEALTH_WINDOW_SQL);
    }
}
