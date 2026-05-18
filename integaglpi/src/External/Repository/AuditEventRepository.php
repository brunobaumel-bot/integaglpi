<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi\External\Repository;

use PDO;

final class AuditEventRepository
{
    public function __construct(private readonly PDO $pdo)
    {
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    public function findRecent(int $limit = 100, array $filters = []): array
    {
        $limit = max(1, min($limit, 200));
        $where = [];
        $params = [];

        foreach (['event_type', 'severity', 'status', 'source', 'conversation_id'] as $field) {
            $value = trim((string) ($filters[$field] ?? ''));
            if ($value === '') {
                continue;
            }
            $where[] = "{$field} = :{$field}";
            $params[":{$field}"] = $value;
        }

        $ticketId = (int) ($filters['ticket_id'] ?? 0);
        if ($ticketId > 0) {
            $where[] = 'ticket_id = :ticket_id';
            $params[':ticket_id'] = $ticketId;
        }

        if (!empty($filters['only_errors'])) {
            $where[] = "severity IN ('error', 'critical')";
        }

        $whereSql = $where === [] ? 'TRUE' : implode(' AND ', $where);
        $statement = $this->pdo->prepare(
            'SELECT id, correlation_id, ticket_id, conversation_id, message_id, direction, '
            . 'event_type, status, severity, source, error_message, created_at '
            . 'FROM glpi_plugin_integaglpi_audit_events '
            . "WHERE {$whereSql} "
            . 'ORDER BY created_at DESC '
            . 'LIMIT :limit'
        );
        foreach ($params as $name => $value) {
            $statement->bindValue($name, $value);
        }
        $statement->bindValue(':limit', $limit, PDO::PARAM_INT);
        $statement->execute();

        return $statement->fetchAll(PDO::FETCH_ASSOC) ?: [];
    }

    /**
     * @return array<string, mixed>
     */
    public function getOperationalSummary(): array
    {
        $sinceExpression = "NOW() - INTERVAL '24 hours'";

        return [
            'last_event_at' => $this->fetchScalar(
                'SELECT MAX(created_at) FROM glpi_plugin_integaglpi_audit_events'
            ),
            'events_24h' => (int) $this->fetchScalar(
                "SELECT COUNT(*) FROM glpi_plugin_integaglpi_audit_events WHERE created_at >= {$sinceExpression}"
            ),
            'critical_24h' => (int) $this->fetchScalar(
                "SELECT COUNT(*) FROM glpi_plugin_integaglpi_audit_events "
                . "WHERE created_at >= {$sinceExpression} AND severity IN ('critical', 'error')"
            ),
            'meta_failures_24h' => (int) $this->fetchScalar(
                "SELECT COUNT(*) FROM glpi_plugin_integaglpi_audit_events "
                . "WHERE created_at >= {$sinceExpression} AND event_type = 'META_API_FAILED'"
            ),
            'glpi_failures_24h' => (int) $this->fetchScalar(
                "SELECT COUNT(*) FROM glpi_plugin_integaglpi_audit_events "
                . "WHERE created_at >= {$sinceExpression} AND event_type = 'GLPI_SYNC_FAILED'"
            ),
            'duplicated_webhooks_24h' => (int) $this->fetchScalar(
                "SELECT COUNT(*) FROM glpi_plugin_integaglpi_audit_events "
                . "WHERE created_at >= {$sinceExpression} AND event_type = 'WEBHOOK_DUPLICATED'"
            ),
            'open_dead_letter' => $this->countOpenDeadLetters(),
        ];
    }

    private function fetchScalar(string $sql): mixed
    {
        $statement = $this->pdo->query($sql);
        if ($statement === false) {
            return null;
        }

        return $statement->fetchColumn();
    }

    private function countOpenDeadLetters(): ?int
    {
        $exists = $this->fetchScalar("SELECT to_regclass('public.glpi_plugin_integaglpi_dead_letter')");
        if ($exists === false || $exists === null || $exists === '') {
            return null;
        }

        return (int) $this->fetchScalar(
            "SELECT COUNT(*) FROM public.glpi_plugin_integaglpi_dead_letter WHERE status = 'open'"
        );
    }
}
