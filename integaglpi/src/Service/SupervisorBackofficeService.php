<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi\Service;

use DateInterval;
use DateTimeImmutable;
use DateTimeZone;
use GlpiPlugin\Integaglpi\External\ExternalDatabase;
use GlpiPlugin\Integaglpi\External\Repository\SupervisorBackofficeRepository;
use PDO;
use Throwable;

final class SupervisorBackofficeService
{
    private ?PDO $pdo = null;

    private ?SupervisorBackofficeRepository $repository = null;

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
        $entityIds = $this->getActiveEntityIds();

        $data = [
            'filters' => $filters,
            'active_entity_ids' => $entityIds,
            'entity_scope_label' => $this->formatEntityScopeLabel($entityIds),
            'kpis' => $this->emptyKpis(),
            'review_rows' => [],
            'review_total' => 0,
            'technician_rows' => [],
            'queues' => [],
            'ai_supervisor_enabled' => \GlpiPlugin\Integaglpi\Plugin::isAiSupervisorEnabled(),
            'pagination' => [
                'page' => $filters['page'],
                'limit' => $filters['limit'],
                'has_previous' => $filters['page'] > 1,
                'has_next' => false,
            ],
            'error' => '',
        ];

        if (!$this->pluginConfigService->isConfigured()) {
            $data['error'] = __('PostgreSQL externo ainda não está configurado.', 'glpiintegaglpi');
            return $data;
        }

        if ($entityIds === []) {
            $data['error'] = __('Nenhuma entidade GLPI ativa disponível para consulta.', 'glpiintegaglpi');
            return $data;
        }

        try {
            $repository = $this->getRepository();
            $offset = (($filters['page'] - 1) * $filters['limit']);
            $data['kpis'] = $repository->getKpis($filters, $entityIds);
            $data['review_total'] = $repository->countReviewTickets($filters, $entityIds);
            $reviewRows = $repository->findReviewTickets($filters, $entityIds, $filters['limit'], $offset);
            $ticketIds = array_values(array_filter(
                array_map(static fn (array $row): int => (int) ($row['glpi_ticket_id'] ?? 0), $reviewRows),
                static fn (int $ticketId): bool => $ticketId > 0
            ));
            $data['review_rows'] = $this->decorateReviewRows(
                $reviewRows,
                $repository->findLatestAiQualityByTicketIds($ticketIds)
            );
            $data['technician_rows'] = $this->decorateTechnicianRows($repository->findTechnicianPerformance($filters, $entityIds, 50));
            $data['queues'] = $repository->findQueues();
            $data['pagination']['has_next'] = ($offset + $filters['limit']) < $data['review_total'];
        } catch (Throwable $exception) {
            error_log('[integaglpi][supervisor][dashboard] ' . $exception->getMessage());
            $data['error'] = __('Não foi possível carregar o backoffice supervisor agora.', 'glpiintegaglpi');
        }

        return $data;
    }

    /**
     * @param array<string, mixed> $query
     * @return array<string, mixed>
     */
    private function normalizeFilters(array $query): array
    {
        $timezone = new DateTimeZone(date_default_timezone_get() ?: 'America/Sao_Paulo');
        $today = new DateTimeImmutable('today', $timezone);
        $defaultFrom = $today->sub(new DateInterval('P29D'));
        $defaultTo = $today;

        $dateFrom = $this->parseDate((string) ($query['date_from'] ?? ''), $defaultFrom, $timezone);
        $dateTo = $this->parseDate((string) ($query['date_to'] ?? ''), $defaultTo, $timezone);
        if ($dateTo < $dateFrom) {
            $dateTo = $dateFrom;
        }

        $maxFrom = $dateTo->sub(new DateInterval('P89D'));
        if ($dateFrom < $maxFrom) {
            $dateFrom = $maxFrom;
        }

        $limit = max(1, min((int) ($query['limit'] ?? 25), 50));
        $page = max(1, (int) ($query['page'] ?? 1));
        $quality = trim((string) ($query['quality'] ?? ''));
        $allowedQuality = [
            '',
            'csat_dissatisfied',
            'supervisor_review',
            'inactivity_failed',
            'inactivity_autoclose',
            'critical_error',
        ];
        if (!in_array($quality, $allowedQuality, true)) {
            $quality = '';
        }

        $status = trim((string) ($query['status'] ?? ''));
        if (!in_array($status, ['', 'open', 'closed', 'awaiting_queue_selection', 'awaiting_entity_selection'], true)) {
            $status = '';
        }

        return [
            'date_from' => $dateFrom->format('Y-m-d'),
            'date_to' => $dateTo->format('Y-m-d'),
            'date_from_sql' => $dateFrom->setTime(0, 0, 0)->format(DATE_ATOM),
            'date_to_sql' => $dateTo->setTime(23, 59, 59)->format(DATE_ATOM),
            'agent_id' => max(0, (int) ($query['agent_id'] ?? 0)),
            'entity_id' => max(0, (int) ($query['entity_id'] ?? 0)),
            'queue_id' => max(0, (int) ($query['queue_id'] ?? 0)),
            'status' => $status,
            'quality' => $quality,
            'page' => $page,
            'limit' => $limit,
        ];
    }

    private function parseDate(string $value, DateTimeImmutable $fallback, DateTimeZone $timezone): DateTimeImmutable
    {
        $value = trim($value);
        if ($value === '') {
            return $fallback;
        }

        $parsed = DateTimeImmutable::createFromFormat('Y-m-d', $value, $timezone);
        if (!$parsed instanceof DateTimeImmutable) {
            return $fallback;
        }

        return $parsed;
    }

    /**
     * @return list<int>
     */
    private function getActiveEntityIds(): array
    {
        try {
            if (class_exists('\Session') && method_exists('\Session', 'getActiveEntities')) {
                $ids = \Session::getActiveEntities();
                if (is_array($ids)) {
                    return array_values(array_filter(array_map('intval', $ids), static fn (int $id): bool => $id > 0));
                }
            }
        } catch (Throwable) {
            return [];
        }

        $entities = $_SESSION['glpiactiveentities'] ?? [];
        if (!is_array($entities)) {
            return [];
        }

        return array_values(array_filter(array_map('intval', $entities), static fn (int $id): bool => $id > 0));
    }

    /**
     * @param list<int> $entityIds
     */
    private function formatEntityScopeLabel(array $entityIds): string
    {
        if ($entityIds === []) {
            return __('sem entidades ativas', 'glpiintegaglpi');
        }

        return sprintf(
            __('%d entidade(s) ativa(s)', 'glpiintegaglpi'),
            count($entityIds)
        );
    }

    /**
     * @return array<string, int>
     */
    private function emptyKpis(): array
    {
        return [
            'total_tickets' => 0,
            'open_tickets' => 0,
            'solved_tickets' => 0,
            'closed_tickets' => 0,
            'dissatisfied_tickets' => 0,
            'supervisor_review_tickets' => 0,
            'inactivity_autoclose_tickets' => 0,
            'inactivity_attention_tickets' => 0,
            'operational_risk_tickets' => 0,
        ];
    }

    /**
     * @param list<array<string, mixed>> $rows
     * @param array<int, array<string, mixed>> $aiQualityByTicketId
     * @return list<array<string, mixed>>
     */
    private function decorateReviewRows(array $rows, array $aiQualityByTicketId = []): array
    {
        return array_map(function (array $row) use ($aiQualityByTicketId): array {
            $row['phone_masked'] = $this->maskPhone((string) ($row['phone_e164'] ?? ''));
            $row['email_masked'] = $this->maskEmail((string) ($row['email_address'] ?? ''));
            unset($row['phone_e164'], $row['email_address']);
            $row['review_reasons'] = $this->buildReviewReasons($row);
            $assignedUserId = (int) ($row['assigned_user_id'] ?? 0);
            $row['assigned_user_name'] = $assignedUserId > 0 ? (string) getUserName($assignedUserId) : __('Sem técnico', 'glpiintegaglpi');
            $row['ai_quality'] = $aiQualityByTicketId[(int) ($row['glpi_ticket_id'] ?? 0)] ?? null;

            return $row;
        }, $rows);
    }

    /**
     * @param list<array<string, mixed>> $rows
     * @return list<array<string, mixed>>
     */
    private function decorateTechnicianRows(array $rows): array
    {
        return array_map(static function (array $row): array {
            $assignedUserId = (int) ($row['assigned_user_id'] ?? 0);
            $row['assigned_user_name'] = $assignedUserId > 0 ? (string) getUserName($assignedUserId) : __('Sem técnico', 'glpiintegaglpi');

            return $row;
        }, $rows);
    }

    /**
     * @param array<string, mixed> $row
     * @return list<string>
     */
    private function buildReviewReasons(array $row): array
    {
        $reasons = [];
        if ((bool) ($row['csat_dissatisfied'] ?? false)) {
            $reasons[] = __('CSAT insatisfeito', 'glpiintegaglpi');
        }
        if ((bool) ($row['supervisor_review_required'] ?? false)) {
            $reasons[] = __('Revisão de supervisor', 'glpiintegaglpi');
        }
        if ((string) ($row['inactivity_status'] ?? '') === 'failed') {
            $reasons[] = __('Falha de inatividade', 'glpiintegaglpi');
        }
        if ((string) ($row['inactivity_status'] ?? '') === 'autoclose_done') {
            $reasons[] = __('Encerrado por inatividade', 'glpiintegaglpi');
        }
        if ((bool) ($row['has_critical_event'] ?? false)) {
            $reasons[] = __('Erro crítico recente', 'glpiintegaglpi');
        }

        return $reasons === [] ? [__('Risco operacional', 'glpiintegaglpi')] : $reasons;
    }

    private function maskPhone(string $phone): string
    {
        $digits = preg_replace('/\D+/', '', $phone) ?? '';
        if (strlen($digits) <= 4) {
            return '****';
        }

        return substr($digits, 0, 2) . '******' . substr($digits, -4);
    }

    private function maskEmail(string $email): string
    {
        $email = trim($email);
        if ($email === '' || !str_contains($email, '@')) {
            return '';
        }

        [$local, $domain] = explode('@', $email, 2);
        $prefix = substr($local, 0, 1);

        return $prefix . '***@' . $domain;
    }

    private function getRepository(): SupervisorBackofficeRepository
    {
        if ($this->repository instanceof SupervisorBackofficeRepository) {
            return $this->repository;
        }

        $this->repository = new SupervisorBackofficeRepository($this->getPdo());

        return $this->repository;
    }

    private function getPdo(): PDO
    {
        if ($this->pdo instanceof PDO) {
            return $this->pdo;
        }

        $this->pdo = ExternalDatabase::getConnection($this->pluginConfigService->getConnectionConfig());

        return $this->pdo;
    }
}
