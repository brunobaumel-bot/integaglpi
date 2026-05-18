<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi\External\Repository;

use PDO;
use PDOStatement;

final class ContractHoursRepository
{
    public function __construct(private readonly PDO $pdo)
    {
    }

    /**
     * @param array<string, mixed> $filters
     * @param list<int> $entityIds
     */
    public function countContracts(array $filters, array $entityIds): int
    {
        [$whereSql, $params] = $this->buildContractWhere($filters, $entityIds);

        $statement = $this->pdo->prepare(
            <<<SQL
            SELECT COUNT(*)
            FROM glpi_plugin_integaglpi_entity_contracts c
            WHERE {$whereSql}
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
    public function findContracts(array $filters, array $entityIds, int $limit, int $offset): array
    {
        [$whereSql, $params] = $this->buildContractWhere($filters, $entityIds);

        $statement = $this->pdo->prepare(
            <<<SQL
            SELECT
                c.id,
                c.glpi_entity_id,
                c.glpi_entity_name,
                c.glpi_contract_id,
                c.contract_name,
                c.allocated_hours,
                c.period_start,
                c.period_end,
                c.warning_threshold_percent,
                c.critical_threshold_percent,
                c.exhausted_threshold_percent,
                c.is_active,
                c.notes,
                c.created_by,
                c.updated_by,
                c.created_at,
                c.updated_at
            FROM glpi_plugin_integaglpi_entity_contracts c
            WHERE {$whereSql}
            ORDER BY c.is_active DESC, c.period_end DESC, c.glpi_entity_name ASC NULLS LAST, c.id DESC
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
     * @return array<string, mixed>|null
     */
    public function findContractById(int $id): ?array
    {
        $statement = $this->pdo->prepare(
            <<<SQL
            SELECT *
            FROM glpi_plugin_integaglpi_entity_contracts
            WHERE id = :id
            LIMIT 1
            SQL
        );
        $statement->bindValue(':id', $id, PDO::PARAM_INT);
        $statement->execute();
        $row = $statement->fetch(PDO::FETCH_ASSOC);

        return is_array($row) ? $row : null;
    }

    /**
     * @param array<string, mixed> $payload
     */
    public function saveContract(array $payload, ?int $id = null): int
    {
        if ($id !== null && $id > 0) {
            $statement = $this->pdo->prepare(
                <<<SQL
                UPDATE glpi_plugin_integaglpi_entity_contracts
                SET
                    glpi_entity_id = :glpi_entity_id,
                    glpi_entity_name = :glpi_entity_name,
                    glpi_contract_id = :glpi_contract_id,
                    contract_name = :contract_name,
                    allocated_hours = :allocated_hours,
                    period_start = :period_start,
                    period_end = :period_end,
                    warning_threshold_percent = :warning_threshold_percent,
                    critical_threshold_percent = :critical_threshold_percent,
                    exhausted_threshold_percent = :exhausted_threshold_percent,
                    is_active = :is_active,
                    notes = :notes,
                    updated_by = :updated_by,
                    updated_at = NOW()
                WHERE id = :id
                SQL
            );
            $this->bindContractPayload($statement, $payload);
            $statement->bindValue(':id', $id, PDO::PARAM_INT);
            $statement->execute();

            return $id;
        }

        $statement = $this->pdo->prepare(
            <<<SQL
            INSERT INTO glpi_plugin_integaglpi_entity_contracts (
                glpi_entity_id,
                glpi_entity_name,
                glpi_contract_id,
                contract_name,
                allocated_hours,
                period_start,
                period_end,
                warning_threshold_percent,
                critical_threshold_percent,
                exhausted_threshold_percent,
                is_active,
                notes,
                created_by,
                updated_by
            ) VALUES (
                :glpi_entity_id,
                :glpi_entity_name,
                :glpi_contract_id,
                :contract_name,
                :allocated_hours,
                :period_start,
                :period_end,
                :warning_threshold_percent,
                :critical_threshold_percent,
                :exhausted_threshold_percent,
                :is_active,
                :notes,
                :created_by,
                :updated_by
            )
            RETURNING id
            SQL
        );
        $this->bindContractPayload($statement, $payload);
        $statement->bindValue(':created_by', (int) ($payload['created_by'] ?? 0), PDO::PARAM_INT);
        $statement->execute();

        return (int) $statement->fetchColumn();
    }

    public function setContractActive(int $id, bool $isActive, int $userId): void
    {
        $statement = $this->pdo->prepare(
            <<<SQL
            UPDATE glpi_plugin_integaglpi_entity_contracts
            SET is_active = :is_active,
                updated_by = :updated_by,
                updated_at = NOW()
            WHERE id = :id
            SQL
        );
        $statement->bindValue(':is_active', $isActive, PDO::PARAM_BOOL);
        $statement->bindValue(':updated_by', $userId, PDO::PARAM_INT);
        $statement->bindValue(':id', $id, PDO::PARAM_INT);
        $statement->execute();
    }

    public function sumManualAdjustments(int $contractId): float
    {
        $statement = $this->pdo->prepare(
            <<<SQL
            SELECT COALESCE(SUM(adjusted_hours), 0)
            FROM glpi_plugin_integaglpi_hour_adjustments
            WHERE contract_id = :contract_id
            SQL
        );
        $statement->bindValue(':contract_id', $contractId, PDO::PARAM_INT);
        $statement->execute();

        return (float) $statement->fetchColumn();
    }

    /**
     * @param list<int> $contractIds
     * @return array<int, float>
     */
    public function sumManualAdjustmentsByContractIds(array $contractIds): array
    {
        $contractIds = array_values(array_filter(array_map('intval', $contractIds), static fn (int $id): bool => $id > 0));
        if ($contractIds === []) {
            return [];
        }

        $params = [];
        $placeholders = [];
        foreach ($contractIds as $index => $contractId) {
            $name = ':contract_' . $index;
            $placeholders[] = $name;
            $params[$name] = $contractId;
        }

        $statement = $this->pdo->prepare(
            'SELECT contract_id, COALESCE(SUM(adjusted_hours), 0) AS hours FROM glpi_plugin_integaglpi_hour_adjustments WHERE contract_id IN ('
            . implode(', ', $placeholders)
            . ') GROUP BY contract_id'
        );
        foreach ($params as $name => $value) {
            $statement->bindValue($name, $value, PDO::PARAM_INT);
        }
        $statement->execute();

        $result = [];
        foreach ($statement->fetchAll(PDO::FETCH_ASSOC) ?: [] as $row) {
            $result[(int) ($row['contract_id'] ?? 0)] = (float) ($row['hours'] ?? 0);
        }

        return $result;
    }

    /**
     * @param array<string, mixed> $payload
     */
    public function insertAdjustment(array $payload): int
    {
        $statement = $this->pdo->prepare(
            <<<SQL
            INSERT INTO glpi_plugin_integaglpi_hour_adjustments (
                contract_id,
                glpi_entity_id,
                glpi_ticket_id,
                adjusted_hours,
                adjustment_type,
                source,
                previous_value,
                reviewed_by,
                review_notes
            ) VALUES (
                :contract_id,
                :glpi_entity_id,
                :glpi_ticket_id,
                :adjusted_hours,
                :adjustment_type,
                :source,
                :previous_value,
                :reviewed_by,
                :review_notes
            )
            RETURNING id
            SQL
        );
        $statement->bindValue(':contract_id', (int) ($payload['contract_id'] ?? 0), PDO::PARAM_INT);
        $statement->bindValue(':glpi_entity_id', (int) ($payload['glpi_entity_id'] ?? 0), PDO::PARAM_INT);
        $this->bindNullableInt($statement, ':glpi_ticket_id', $payload['glpi_ticket_id'] ?? null);
        $statement->bindValue(':adjusted_hours', (string) ($payload['adjusted_hours'] ?? '0'), PDO::PARAM_STR);
        $statement->bindValue(':adjustment_type', (string) ($payload['adjustment_type'] ?? 'correction'), PDO::PARAM_STR);
        $statement->bindValue(':source', (string) ($payload['source'] ?? 'manual_adjustment'), PDO::PARAM_STR);
        $statement->bindValue(':previous_value', (string) ($payload['previous_value'] ?? '0'), PDO::PARAM_STR);
        $statement->bindValue(':reviewed_by', (int) ($payload['reviewed_by'] ?? 0), PDO::PARAM_INT);
        $statement->bindValue(':review_notes', (string) ($payload['review_notes'] ?? ''), PDO::PARAM_STR);
        $statement->execute();

        return (int) $statement->fetchColumn();
    }

    /**
     * @param array<string, mixed> $filters
     * @param list<int> $entityIds
     */
    public function countAdjustments(array $filters, array $entityIds): int
    {
        [$whereSql, $params] = $this->buildAdjustmentWhere($filters, $entityIds);

        $statement = $this->pdo->prepare(
            <<<SQL
            SELECT COUNT(*)
            FROM glpi_plugin_integaglpi_hour_adjustments a
            INNER JOIN glpi_plugin_integaglpi_entity_contracts c ON c.id = a.contract_id
            WHERE {$whereSql}
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
    public function findAdjustments(array $filters, array $entityIds, int $limit, int $offset): array
    {
        [$whereSql, $params] = $this->buildAdjustmentWhere($filters, $entityIds);

        $statement = $this->pdo->prepare(
            <<<SQL
            SELECT
                a.id,
                a.contract_id,
                a.glpi_entity_id,
                a.glpi_ticket_id,
                a.adjusted_hours,
                a.adjustment_type,
                a.source,
                a.previous_value,
                a.reviewed_by,
                a.review_notes,
                a.created_at,
                c.contract_name,
                c.glpi_entity_name
            FROM glpi_plugin_integaglpi_hour_adjustments a
            INNER JOIN glpi_plugin_integaglpi_entity_contracts c ON c.id = a.contract_id
            WHERE {$whereSql}
            ORDER BY a.created_at DESC, a.id DESC
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
     * @return array{0: string, 1: array<string, array{value: mixed, type: int}>}
     */
    private function buildContractWhere(array $filters, array $entityIds): array
    {
        $where = [
            'c.period_start <= :date_to',
            'c.period_end >= :date_from',
        ];
        $params = [
            ':date_from' => ['value' => (string) $filters['date_from'], 'type' => PDO::PARAM_STR],
            ':date_to' => ['value' => (string) $filters['date_to'], 'type' => PDO::PARAM_STR],
        ];

        $this->appendEntityWhere($where, $params, 'c.glpi_entity_id', $entityIds, (int) ($filters['entity_id'] ?? 0));

        $status = (string) ($filters['status'] ?? 'active');
        if ($status === 'active') {
            $where[] = 'c.is_active = TRUE';
        } elseif ($status === 'inactive') {
            $where[] = 'c.is_active = FALSE';
        }

        return [implode(' AND ', $where), $params];
    }

    /**
     * @param array<string, mixed> $filters
     * @param list<int> $entityIds
     * @return array{0: string, 1: array<string, array{value: mixed, type: int}>}
     */
    private function buildAdjustmentWhere(array $filters, array $entityIds): array
    {
        $where = [
            'a.created_at >= :date_from_ts',
            'a.created_at <= :date_to_ts',
        ];
        $params = [
            ':date_from_ts' => ['value' => (string) $filters['date_from_sql'], 'type' => PDO::PARAM_STR],
            ':date_to_ts' => ['value' => (string) $filters['date_to_sql'], 'type' => PDO::PARAM_STR],
        ];

        $this->appendEntityWhere($where, $params, 'a.glpi_entity_id', $entityIds, (int) ($filters['entity_id'] ?? 0));

        return [implode(' AND ', $where), $params];
    }

    /**
     * @param list<string> $where
     * @param array<string, array{value: mixed, type: int}> $params
     * @param list<int> $entityIds
     */
    private function appendEntityWhere(array &$where, array &$params, string $column, array $entityIds, int $entityFilter): void
    {
        $entityIds = array_values(array_filter(array_map('intval', $entityIds), static fn (int $id): bool => $id > 0));
        if ($entityIds === []) {
            $where[] = 'FALSE';
            return;
        }

        $placeholders = [];
        foreach ($entityIds as $index => $entityId) {
            $name = ':entity_' . $index;
            $placeholders[] = $name;
            $params[$name] = ['value' => $entityId, 'type' => PDO::PARAM_INT];
        }
        $where[] = $column . ' IN (' . implode(', ', $placeholders) . ')';

        if ($entityFilter > 0 && !in_array($entityFilter, $entityIds, true)) {
            $where[] = 'FALSE';
        } elseif ($entityFilter > 0) {
            $where[] = $column . ' = :entity_filter';
            $params[':entity_filter'] = ['value' => $entityFilter, 'type' => PDO::PARAM_INT];
        }
    }

    /**
     * @param array<string, mixed> $payload
     */
    private function bindContractPayload(PDOStatement $statement, array $payload): void
    {
        $statement->bindValue(':glpi_entity_id', (int) ($payload['glpi_entity_id'] ?? 0), PDO::PARAM_INT);
        $statement->bindValue(':glpi_entity_name', (string) ($payload['glpi_entity_name'] ?? ''), PDO::PARAM_STR);
        $this->bindNullableInt($statement, ':glpi_contract_id', $payload['glpi_contract_id'] ?? null);
        $statement->bindValue(':contract_name', (string) ($payload['contract_name'] ?? ''), PDO::PARAM_STR);
        $statement->bindValue(':allocated_hours', (string) ($payload['allocated_hours'] ?? '0'), PDO::PARAM_STR);
        $statement->bindValue(':period_start', (string) ($payload['period_start'] ?? ''), PDO::PARAM_STR);
        $statement->bindValue(':period_end', (string) ($payload['period_end'] ?? ''), PDO::PARAM_STR);
        $statement->bindValue(':warning_threshold_percent', (int) ($payload['warning_threshold_percent'] ?? 70), PDO::PARAM_INT);
        $statement->bindValue(':critical_threshold_percent', (int) ($payload['critical_threshold_percent'] ?? 90), PDO::PARAM_INT);
        $statement->bindValue(':exhausted_threshold_percent', (int) ($payload['exhausted_threshold_percent'] ?? 100), PDO::PARAM_INT);
        $statement->bindValue(':is_active', (bool) ($payload['is_active'] ?? true), PDO::PARAM_BOOL);
        $statement->bindValue(':notes', (string) ($payload['notes'] ?? ''), PDO::PARAM_STR);
        $statement->bindValue(':updated_by', (int) ($payload['updated_by'] ?? 0), PDO::PARAM_INT);
    }

    private function bindNullableInt(PDOStatement $statement, string $name, mixed $value): void
    {
        $intValue = (int) $value;
        if ($intValue > 0) {
            $statement->bindValue($name, $intValue, PDO::PARAM_INT);
            return;
        }

        $statement->bindValue($name, null, PDO::PARAM_NULL);
    }

    /**
     * @param array<string, array{value: mixed, type: int}> $params
     */
    private function bindParams(PDOStatement $statement, array $params): void
    {
        foreach ($params as $name => $param) {
            $statement->bindValue($name, $param['value'], $param['type']);
        }
    }
}
