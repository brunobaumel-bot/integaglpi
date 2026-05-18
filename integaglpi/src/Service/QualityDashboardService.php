<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi\Service;

use DateInterval;
use DateTimeImmutable;
use DateTimeZone;
use GlpiPlugin\Integaglpi\External\ExternalDatabase;
use GlpiPlugin\Integaglpi\Plugin;
use PDO;
use Throwable;

final class QualityDashboardService
{
    private const DEFAULT_LIMIT = 25;
    private const MAX_LIMIT = 50;
    private const MAX_RANGE_DAYS = 30;

    public function __construct(private readonly PluginConfigService $pluginConfigService)
    {
    }

    /**
     * @param array<string, mixed> $query
     * @return array<string, mixed>
     */
    public function getDashboardData(array $query): array
    {
        $filters = $this->normalizeFilters($query);
        $entityOptions = $this->loadEntityOptions();
        if (trim((string) ($filters['date_range_error'] ?? '')) !== '') {
            return $this->emptyData($filters, $entityOptions, (string) $filters['date_range_error']);
        }

        $allowedEntityIds = array_map(static fn (array $row): int => (int) $row['id'], $entityOptions);
        if ($allowedEntityIds === []) {
            return $this->emptyData($filters, $entityOptions, __('Nenhuma entidade GLPI ativa disponível para consulta.', 'glpiintegaglpi'));
        }

        $requestedEntityId = (int) ($filters['entity_id'] ?? 0);
        $scopedEntityIds = $requestedEntityId > 0 ? [$requestedEntityId] : $allowedEntityIds;
        if ($requestedEntityId > 0 && !in_array($requestedEntityId, $allowedEntityIds, true)) {
            return $this->emptyData($filters, $entityOptions, __('Entidade fora do escopo permitido da sessão GLPI.', 'glpiintegaglpi'));
        }

        if (!$this->pluginConfigService->isConfigured()) {
            return $this->emptyData($filters, $entityOptions, __('Integração não configurada.', 'glpiintegaglpi'));
        }

        try {
            $response = (new IntegrationServiceClient($this->pluginConfigService))->getQualityDashboard([
                'date_from' => $filters['date_from'],
                'date_to' => $filters['date_to'],
                'entity_ids' => implode(',', $scopedEntityIds),
                'queue_id' => (int) $filters['queue_id'] ?: null,
                'technician_id' => (int) $filters['technician_id'] ?: null,
                'status' => (string) $filters['status'] ?: null,
                'csat' => (string) $filters['csat'] ?: null,
                'sla' => (string) $filters['sla'] ?: null,
                'delivery_status' => (string) $filters['delivery_status'] ?: null,
                'inactivity' => (string) $filters['inactivity'] ?: null,
                'page' => (int) $filters['page'],
                'limit' => (int) $filters['limit'],
            ]);
        } catch (Throwable $exception) {
            error_log('[integaglpi][quality_dashboard][error] ' . $exception->getMessage());

            return $this->emptyData($filters, $entityOptions, __('Não foi possível carregar o Dashboard de Qualidade agora.', 'glpiintegaglpi'));
        }

        $body = $response['body'];
        if (!$response['success']) {
            return $this->emptyData(
                $filters,
                $entityOptions,
                (string) ($body['message'] ?? __('Falha ao carregar o Dashboard de Qualidade.', 'glpiintegaglpi'))
            );
        }

        $breakdowns = is_array($body['breakdowns'] ?? null) ? $body['breakdowns'] : [];
        $breakdowns = $this->mergeSupplementalBreakdowns($breakdowns, $filters, $scopedEntityIds);

        return [
            'filters' => $filters,
            'entity_options' => $entityOptions,
            'entity_scope_label' => sprintf(__('%d entidade(s) no escopo', 'glpiintegaglpi'), count($scopedEntityIds)),
            'kpis' => is_array($body['kpis'] ?? null) ? $body['kpis'] : [],
            'breakdowns' => $breakdowns,
            'rows' => $this->decorateRows(is_array($body['rows'] ?? null) ? $body['rows'] : []),
            'pagination' => is_array($body['pagination'] ?? null) ? $body['pagination'] : [],
            'cache_status' => (string) ($body['cache_status'] ?? ''),
            'error' => '',
            'date_range_error' => '',
        ];
    }

    /**
     * @param array<string, mixed> $query
     * @return array<string, mixed>
     */
    private function normalizeFilters(array $query): array
    {
        $timezone = new DateTimeZone(date_default_timezone_get() ?: 'America/Sao_Paulo');
        $today = new DateTimeImmutable('today', $timezone);
        $defaultFrom = $today->sub(new DateInterval('P6D'));
        $dateFrom = $this->parseDate((string) ($query['date_from'] ?? ''), $defaultFrom, $timezone);
        $dateTo = $this->parseDate((string) ($query['date_to'] ?? ''), $today, $timezone);
        $dateRangeError = '';

        if ($dateTo < $dateFrom) {
            $dateRangeError = __('A data final deve ser maior ou igual à data inicial.', 'glpiintegaglpi');
            $dateTo = $dateFrom;
        }

        $maxFrom = $dateTo->sub(new DateInterval('P' . self::MAX_RANGE_DAYS . 'D'));
        if ($dateFrom < $maxFrom) {
            $dateRangeError = __('O período máximo permitido é de 30 dias.', 'glpiintegaglpi');
            $dateFrom = $maxFrom;
        }

        $status = $this->allow((string) ($query['status'] ?? ''), ['', 'open', 'closed', 'awaiting_entity_selection', 'collecting_contact_profile', 'awaiting_queue_selection', 'media_error']);
        $csat = $this->allow((string) ($query['csat'] ?? ''), ['', 'very_satisfied', 'satisfied', 'neutral', 'dissatisfied', 'very_dissatisfied', 'sem_resposta']);
        $sla = $this->allow((string) ($query['sla'] ?? ''), ['', 'ok', 'risk', 'violated']);
        $delivery = $this->allow((string) ($query['delivery_status'] ?? ''), ['', 'pending', 'sent', 'delivered', 'read', 'failed']);
        $inactivity = $this->allow((string) ($query['inactivity'] ?? ''), ['', 'pending', 'reminder_1_sent', 'reminder_2_sent', 'reminder_3_sent', 'autoclose_done', 'failed']);

        return [
            'date_from' => $dateFrom->format('Y-m-d'),
            'date_to' => $dateTo->format('Y-m-d'),
            'date_range_error' => $dateRangeError,
            'entity_id' => max(0, (int) ($query['entity_id'] ?? 0)),
            'queue_id' => max(0, (int) ($query['queue_id'] ?? 0)),
            'technician_id' => max(0, (int) ($query['technician_id'] ?? 0)),
            'status' => $status,
            'csat' => $csat,
            'sla' => $sla,
            'delivery_status' => $delivery,
            'inactivity' => $inactivity,
            'page' => max(1, (int) ($query['page'] ?? 1)),
            'limit' => max(1, min((int) ($query['limit'] ?? self::DEFAULT_LIMIT), self::MAX_LIMIT)),
        ];
    }

    private function parseDate(string $value, DateTimeImmutable $fallback, DateTimeZone $timezone): DateTimeImmutable
    {
        $value = trim($value);
        if ($value === '') {
            return $fallback;
        }

        $parsed = DateTimeImmutable::createFromFormat('Y-m-d', $value, $timezone);

        return $parsed instanceof DateTimeImmutable ? $parsed : $fallback;
    }

    /**
     * @param list<string> $allowed
     */
    private function allow(string $value, array $allowed): string
    {
        $value = trim($value);

        return in_array($value, $allowed, true) ? $value : '';
    }

    /**
     * @return list<array{id: int, name: string}>
     */
    private function loadEntityOptions(): array
    {
        global $DB;

        $activeIds = [];
        try {
            if (class_exists('\Session') && method_exists('\Session', 'getActiveEntities')) {
                $ids = \Session::getActiveEntities();
                if (is_array($ids)) {
                    $activeIds = array_values(array_filter(array_map('intval', $ids), static fn (int $id): bool => $id > 0));
                }
            }
        } catch (Throwable) {
            $activeIds = [];
        }

        if ($activeIds === [] || !isset($DB) || !is_object($DB)) {
            return [];
        }

        $rows = [];
        foreach ($DB->request([
            'FROM' => 'glpi_entities',
            'WHERE' => ['id' => $activeIds],
            'ORDER' => 'completename ASC',
        ]) as $entity) {
            $id = (int) ($entity['id'] ?? 0);
            if ($id <= 0 || !$this->canUseEntity($id)) {
                continue;
            }
            $rows[] = [
                'id' => $id,
                'name' => (string) ($entity['completename'] ?? $entity['name'] ?? ('#' . $id)),
            ];
        }

        return $rows;
    }

    private function canUseEntity(int $entityId): bool
    {
        if ($entityId <= 0) {
            return false;
        }

        if (class_exists('\Session') && method_exists('\Session', 'haveAccessToEntity')) {
            return (bool) \Session::haveAccessToEntity($entityId);
        }

        $active = $_SESSION['glpiactiveentities'] ?? [];
        return is_array($active) && in_array($entityId, array_map('intval', $active), true);
    }

    /**
     * @param list<array<string, mixed>> $rows
     * @return list<array<string, mixed>>
     */
    private function decorateRows(array $rows): array
    {
        return array_map(static function (array $row): array {
            $assignedUserId = (int) ($row['assigned_user_id'] ?? 0);
            $row['assigned_user_name'] = $assignedUserId > 0 ? (string) getUserName($assignedUserId) : __('Sem técnico', 'glpiintegaglpi');
            $row['status_label'] = self::statusLabel((string) ($row['conversation_status'] ?? ''));
            $row['sla_label'] = self::slaLabel((string) ($row['sla_state'] ?? ''));
            unset($row['last_message_excerpt']);

            return $row;
        }, $rows);
    }

    /**
     * @param array<string, mixed> $breakdowns
     * @param array<string, mixed> $filters
     * @param list<int> $scopedEntityIds
     * @return array<string, mixed>
     */
    private function mergeSupplementalBreakdowns(array $breakdowns, array $filters, array $scopedEntityIds): array
    {
        try {
            $breakdowns['reopen_reasons'] = $this->loadReopenReasons($filters, $scopedEntityIds);
        } catch (Throwable $exception) {
            error_log('[integaglpi][quality_dashboard][reopen_reasons] ' . $this->sanitizeLogMessage($exception->getMessage()));
            $breakdowns['reopen_reasons'] = is_array($breakdowns['reopen_reasons'] ?? null) ? $breakdowns['reopen_reasons'] : [];
        }

        return $breakdowns;
    }

    /**
     * @param array<string, mixed> $filters
     * @param list<int> $scopedEntityIds
     * @return list<array{reason_key: string, reason_label: string, total: int}>
     */
    private function loadReopenReasons(array $filters, array $scopedEntityIds): array
    {
        if ($scopedEntityIds === [] || !$this->pluginConfigService->isConfigured()) {
            return [];
        }

        $entityPlaceholders = [];
        foreach ($scopedEntityIds as $index => $entityId) {
            $entityPlaceholders[] = ':entity_' . $index;
        }

        $sql = sprintf(
            "
            SELECT
                CASE split_part(sa.action_key, ':', 5)
                    WHEN 'problem_persists' THEN 'problem_persists'
                    WHEN 'missing_work' THEN 'missing_work'
                    WHEN 'not_understood' THEN 'not_understood'
                    WHEN 'other' THEN 'other'
                    ELSE 'sem_motivo'
                END AS reason_key,
                CASE split_part(sa.action_key, ':', 5)
                    WHEN 'problem_persists' THEN 'O problema permanece'
                    WHEN 'missing_work' THEN 'Ficou faltando algo'
                    WHEN 'not_understood' THEN 'Não entendi a solução'
                    WHEN 'other' THEN 'Outro motivo'
                    ELSE 'Sem motivo informado'
                END AS reason_label,
                COUNT(*)::int AS total
            FROM glpi_plugin_integaglpi_solution_actions sa
            JOIN glpi_plugin_integaglpi_conversations c
              ON c.id = sa.conversation_id
            LEFT JOIN glpi_plugin_integaglpi_conversation_runtime rt
              ON rt.conversation_id = c.id
            LEFT JOIN glpi_plugin_integaglpi_contact_entity_memory cem
              ON cem.phone_e164 = c.phone_e164
             AND cem.is_active = TRUE
            WHERE sa.action = 'reopen'
              AND sa.status = 'success'
              AND sa.created_at >= CAST(:date_from AS timestamptz)
              AND sa.created_at <= CAST(:date_to AS timestamptz)
              AND COALESCE(c.glpi_entity_id, cem.glpi_entity_id) IN (%s)
              AND (:queue_filter = 0 OR COALESCE(rt.queue_id, c.queue_id) = :queue_value)
              AND (:technician_filter = 0 OR rt.assigned_user_id = :technician_value)
              AND (:status_filter = '' OR c.status = :status_value)
            GROUP BY reason_key, reason_label
            ORDER BY total DESC, reason_label ASC
            LIMIT 20
            ",
            implode(', ', $entityPlaceholders)
        );

        $statement = ExternalDatabase::getConnection($this->pluginConfigService->getConnectionConfig())->prepare($sql);
        $statement->bindValue(':date_from', (string) ($filters['date_from'] ?? '') . ' 00:00:00');
        $statement->bindValue(':date_to', (string) ($filters['date_to'] ?? '') . ' 23:59:59');
        foreach ($scopedEntityIds as $index => $entityId) {
            $statement->bindValue(':entity_' . $index, $entityId, PDO::PARAM_INT);
        }
        $queueId = (int) ($filters['queue_id'] ?? 0);
        $technicianId = (int) ($filters['technician_id'] ?? 0);
        $status = (string) ($filters['status'] ?? '');
        $statement->bindValue(':queue_filter', $queueId, PDO::PARAM_INT);
        $statement->bindValue(':queue_value', $queueId, PDO::PARAM_INT);
        $statement->bindValue(':technician_filter', $technicianId, PDO::PARAM_INT);
        $statement->bindValue(':technician_value', $technicianId, PDO::PARAM_INT);
        $statement->bindValue(':status_filter', $status);
        $statement->bindValue(':status_value', $status);
        $statement->execute();

        return array_map(
            static fn (array $row): array => [
                'reason_key' => (string) ($row['reason_key'] ?? ''),
                'reason_label' => (string) ($row['reason_label'] ?? ''),
                'total' => (int) ($row['total'] ?? 0),
            ],
            $statement->fetchAll(PDO::FETCH_ASSOC) ?: []
        );
    }

    private function sanitizeLogMessage(string $message): string
    {
        $message = preg_replace('/(password|token|secret|authorization|bearer)\s*[:=]\s*[^,\s]+/i', '$1=[redacted]', $message) ?? '';

        return mb_substr($message, 0, 240);
    }

    private static function statusLabel(string $status): string
    {
        return match ($status) {
            'open' => __('Chamado aberto', 'glpiintegaglpi'),
            'closed' => __('Fechado', 'glpiintegaglpi'),
            'awaiting_entity_selection' => __('Aguardando entidade', 'glpiintegaglpi'),
            'collecting_contact_profile' => __('Coletando perfil', 'glpiintegaglpi'),
            'awaiting_queue_selection' => __('Aguardando fila', 'glpiintegaglpi'),
            'media_error' => __('Erro de mídia', 'glpiintegaglpi'),
            default => $status !== '' ? $status : __('Sem status', 'glpiintegaglpi'),
        };
    }

    private static function slaLabel(string $sla): string
    {
        return match ($sla) {
            'risk' => __('Em risco', 'glpiintegaglpi'),
            'violated' => __('Violado', 'glpiintegaglpi'),
            default => __('OK', 'glpiintegaglpi'),
        };
    }

    /**
     * @param array<string, mixed> $filters
     * @param list<array{id: int, name: string}> $entityOptions
     * @return array<string, mixed>
     */
    private function emptyData(array $filters, array $entityOptions, string $error): array
    {
        return [
            'filters' => $filters,
            'entity_options' => $entityOptions,
            'entity_scope_label' => '',
            'kpis' => [],
            'breakdowns' => [],
            'rows' => [],
            'pagination' => ['page' => 1, 'limit' => (int) ($filters['limit'] ?? self::DEFAULT_LIMIT), 'total' => 0, 'total_pages' => 1],
            'cache_status' => '',
            'error' => $error,
            'date_range_error' => (string) ($filters['date_range_error'] ?? ''),
        ];
    }

    public function getConsoleDrillDownUrl(array $filters): string
    {
        $query = [
            'entity_id' => (int) ($filters['entity_id'] ?? 0) ?: null,
            'queue_id' => (int) ($filters['queue_id'] ?? 0) ?: null,
            'technician_id' => (int) ($filters['technician_id'] ?? 0) ?: null,
            'status' => (string) ($filters['status'] ?? '') ?: null,
            'delivery' => (string) ($filters['delivery_status'] ?? '') ?: null,
            'inactivity' => (string) ($filters['inactivity'] ?? '') ?: null,
        ];

        return Plugin::getWebBasePath() . '/front/central.php?' . http_build_query(array_filter($query));
    }
}
