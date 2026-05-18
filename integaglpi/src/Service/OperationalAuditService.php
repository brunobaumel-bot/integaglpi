<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi\Service;

use DateTimeImmutable;
use DateTimeZone;
use GlpiPlugin\Integaglpi\External\ExternalDatabase;
use GlpiPlugin\Integaglpi\External\Repository\AuditRepository;
use PDO;
use Throwable;

final class OperationalAuditService
{
    private const DEFAULT_LIMIT = 50;
    private const MAX_LIMIT = 100;
    private const HEALTH_HEARTBEAT_WARNING_MINUTES = 30;
    private const HEALTH_HEARTBEAT_CRITICAL_MINUTES = 60;
    private const HEALTH_DEAD_LETTER_CRITICAL_COUNT = 5;
    private const HEALTH_FAILURE_WARNING_COUNT = 5;
    private const HEALTH_FAILURE_CRITICAL_COUNT = 10;
    private const HEALTH_DUPLICATED_WARNING_COUNT = 5;

    private PluginConfigService $pluginConfigService;

    private ?PDO $pdo = null;

    private ?AuditRepository $auditRepository = null;

    private ?OperationalQualityService $operationalQualityService = null;

    public function __construct(?PluginConfigService $pluginConfigService = null)
    {
        $this->pluginConfigService = $pluginConfigService ?? new PluginConfigService();
    }

    /**
     * @param array<string, mixed> $query
     * @return array<string, mixed>
     */
    public function getAuditData(array $query): array
    {
        $filters = $this->normalizeFilters($query);
        $pagination = $this->normalizePagination($query);
        $baseData = [
            'filters' => $filters,
            'pagination' => [
                ...$pagination,
                'has_previous' => $pagination['page'] > 1,
                'has_next' => false,
            ],
            'audit_rows' => [],
            'audit_detail' => null,
            'dead_letter_rows' => [],
            'dead_letter_detail' => null,
            'dead_letter_available' => false,
            'health' => $this->buildUnavailableHealthData(),
            'limit_options' => [25, 50, 100],
            'error' => null,
            'is_configured' => $this->pluginConfigService->isConfigured(),
            'entity_notice' => __(
                'Nesta fase, a auditoria global fica restrita a perfis administrativos autorizados; refinamento multi-entidade detalhado fica para fase futura.',
                'glpiintegaglpi'
            ),
        ];

        if (!$this->pluginConfigService->isConfigured()) {
            $baseData['error'] = __(
                'Configure the external PostgreSQL connection before using operational audit.',
                'glpiintegaglpi'
            );
            return $baseData;
        }

        try {
            $repository = $this->getAuditRepository();
            $health = $this->buildHealthData($repository);
            $auditRows = $repository->findAuditEvents($filters, $pagination['limit'] + 1, $pagination['offset']);
            $hasNext = count($auditRows) > $pagination['limit'];
            if ($hasNext) {
                array_pop($auditRows);
            }

            $deadLetterAvailable = $repository->hasDeadLetterTable();
            $deadLetterRows = [];
            $deadLetterDetail = null;
            $deadLetterHasNext = false;
            if ($deadLetterAvailable) {
                $deadLetterRows = $repository->findDeadLetters($filters, $pagination['limit'] + 1, $pagination['offset']);
                $deadLetterHasNext = count($deadLetterRows) > $pagination['limit'];
                if ($deadLetterHasNext) {
                    array_pop($deadLetterRows);
                }
                $deadLetterDetailId = (int) ($filters['dead_letter_detail_id'] ?? 0);
                if ($deadLetterDetailId > 0) {
                    $deadLetterDetail = $repository->findDeadLetterDetail($deadLetterDetailId);
                }
            }

            $auditDetail = null;
            $auditDetailId = (int) ($filters['audit_detail_id'] ?? 0);
            if ($auditDetailId > 0) {
                $auditDetail = $repository->findAuditEventDetail($auditDetailId);
            }

            return [
                ...$baseData,
                'audit_rows' => $auditRows,
                'audit_detail' => $auditDetail,
                'dead_letter_rows' => $deadLetterRows,
                'dead_letter_detail' => $deadLetterDetail,
                'dead_letter_available' => $deadLetterAvailable,
                'health' => $health,
                'pagination' => [
                    ...$baseData['pagination'],
                    'has_next' => $hasNext || $deadLetterHasNext,
                ],
            ];
        } catch (Throwable $exception) {
            error_log('[integaglpi][audit][error] ' . $exception->getMessage());

            $baseData['error'] = __(
                'Unable to load operational audit right now. Please check the external PostgreSQL connection.',
                'glpiintegaglpi'
            );
            return $baseData;
        }
    }

    /**
     * @return array<string, mixed>
     */
    private function buildHealthData(AuditRepository $repository): array
    {
        $counts = $repository->getHealthCounts24h();
        $heartbeat = $this->buildHeartbeatData($repository->findLatestSuccessfulHeartbeat24h());
        $openDeadLetters = $repository->countOpenDeadLetters();
        $general = $this->calculateGeneralHealth($counts, $heartbeat, $openDeadLetters);
        $riskList = $this->getOperationalQualityService()->buildRiskList();

        return [
            'window_label' => __('Últimas 24h', 'glpiintegaglpi'),
            'dead_letter_available' => $openDeadLetters !== null,
            'overall' => $general,
            'risk_list' => $riskList,
            'cards' => [
                [
                    'key' => 'overall',
                    'title' => __('Saúde geral', 'glpiintegaglpi'),
                    'value' => $general['label'],
                    'status' => $general['status'],
                    'description' => $general['reason'],
                    'window' => __('Agora', 'glpiintegaglpi'),
                    'filters' => [],
                ],
                [
                    'key' => 'heartbeat',
                    'title' => __('Heartbeat', 'glpiintegaglpi'),
                    'value' => $heartbeat['label'],
                    'status' => $heartbeat['status'],
                    'description' => $heartbeat['description'],
                    'window' => __('Últimas 24h', 'glpiintegaglpi'),
                    'filters' => [
                        'status' => 'success',
                    ],
                ],
                [
                    'key' => 'error_critical',
                    'title' => __('Erros/critical', 'glpiintegaglpi'),
                    'value' => (string) $counts['error_critical_count'],
                    'status' => $counts['critical_count'] > 0 ? 'critical' : (
                        $counts['error_critical_count'] > 0 ? 'warning' : 'ok'
                    ),
                    'description' => __('Eventos severity error ou critical.', 'glpiintegaglpi'),
                    'window' => __('Últimas 24h', 'glpiintegaglpi'),
                    'filters' => [
                        'only_errors' => '1',
                    ],
                ],
                [
                    'key' => 'meta_failures',
                    'title' => __('Falhas Meta API', 'glpiintegaglpi'),
                    'value' => (string) $counts['meta_failure_count'],
                    'status' => $this->failureStatus($counts['meta_failure_count']),
                    'description' => __('META_API_FAILED e MESSAGE_FAILED.', 'glpiintegaglpi'),
                    'window' => __('Últimas 24h', 'glpiintegaglpi'),
                    'links' => [
                        [
                            'label' => __('Ver META_API_FAILED', 'glpiintegaglpi'),
                            'filters' => ['event_type' => 'META_API_FAILED'],
                        ],
                        [
                            'label' => __('Ver MESSAGE_FAILED', 'glpiintegaglpi'),
                            'filters' => ['event_type' => 'MESSAGE_FAILED'],
                        ],
                    ],
                ],
                [
                    'key' => 'glpi_failures',
                    'title' => __('Falhas GLPI', 'glpiintegaglpi'),
                    'value' => (string) $counts['glpi_failure_count'],
                    'status' => $this->failureStatus($counts['glpi_failure_count']),
                    'description' => __('Eventos GLPI_SYNC_FAILED.', 'glpiintegaglpi'),
                    'window' => __('Últimas 24h', 'glpiintegaglpi'),
                    'filters' => [
                        'event_type' => 'GLPI_SYNC_FAILED',
                    ],
                ],
                [
                    'key' => 'dead_letter_open',
                    'title' => __('Dead-letter aberto', 'glpiintegaglpi'),
                    'value' => $openDeadLetters === null ? '-' : (string) $openDeadLetters,
                    'status' => $this->deadLetterStatus($openDeadLetters),
                    'description' => $openDeadLetters === null
                        ? __('Tabela dead-letter indisponível.', 'glpiintegaglpi')
                        : __('Total read-only de registros com status open.', 'glpiintegaglpi'),
                    'window' => __('Atual', 'glpiintegaglpi'),
                    'filters' => [],
                ],
                [
                    'key' => 'duplicated_webhooks',
                    'title' => __('Webhooks duplicados', 'glpiintegaglpi'),
                    'value' => (string) $counts['duplicated_webhook_count'],
                    'status' => $counts['duplicated_webhook_count'] >= self::HEALTH_DUPLICATED_WARNING_COUNT
                        ? 'warning'
                        : 'ok',
                    'description' => __('WEBHOOK_DUPLICATED, MESSAGE_DUPLICATED e IDEMPOTENCY_CONFLICT.', 'glpiintegaglpi'),
                    'window' => __('Últimas 24h', 'glpiintegaglpi'),
                    'links' => [
                        [
                            'label' => __('Ver WEBHOOK_DUPLICATED', 'glpiintegaglpi'),
                            'filters' => ['event_type' => 'WEBHOOK_DUPLICATED'],
                        ],
                        [
                            'label' => __('Ver MESSAGE_DUPLICATED', 'glpiintegaglpi'),
                            'filters' => ['event_type' => 'MESSAGE_DUPLICATED'],
                        ],
                        [
                            'label' => __('Ver IDEMPOTENCY_CONFLICT', 'glpiintegaglpi'),
                            'filters' => ['event_type' => 'IDEMPOTENCY_CONFLICT'],
                        ],
                    ],
                ],
            ],
        ];
    }

    /**
     * @param array<string, mixed>|null $row
     * @return array<string, mixed>
     */
    private function buildHeartbeatData(?array $row): array
    {
        if ($row === null) {
            return [
                'status' => 'critical',
                'label' => __('Sem evento nas últimas 24h', 'glpiintegaglpi'),
                'description' => __('Nenhum WEBHOOK_RECEIVED, MESSAGE_RECEIVED ou MESSAGE_SENT recente.', 'glpiintegaglpi'),
                'minutes_ago' => null,
                'created_at' => null,
            ];
        }

        $createdAt = $this->parseDatabaseTimestamp((string) ($row['created_at'] ?? ''));
        if ($createdAt === null) {
            return [
                'status' => 'critical',
                'label' => __('Indisponível', 'glpiintegaglpi'),
                'description' => __('Heartbeat indisponível - timestamp inválido.', 'glpiintegaglpi'),
                'minutes_ago' => null,
                'created_at' => null,
            ];
        }

        $now = new DateTimeImmutable('now', new DateTimeZone(date_default_timezone_get()));
        $secondsAgo = max(0, $now->getTimestamp() - $createdAt->getTimestamp());
        $minutesAgo = intdiv($secondsAgo, 60);
        $status = 'ok';
        if ($minutesAgo > self::HEALTH_HEARTBEAT_CRITICAL_MINUTES) {
            $status = 'critical';
        } elseif ($minutesAgo > self::HEALTH_HEARTBEAT_WARNING_MINUTES) {
            $status = 'warning';
        }

        return [
            'status' => $status,
            'label' => $this->formatMinutesAgo($minutesAgo),
            'description' => sprintf(
                '%s: %s (%s)',
                __('Última comunicação', 'glpiintegaglpi'),
                $createdAt->format('Y-m-d H:i:s T'),
                (string) ($row['event_type'] ?? '')
            ),
            'minutes_ago' => $minutesAgo,
            'created_at' => $createdAt->format('Y-m-d H:i:sP'),
        ];
    }

    /**
     * @param array<string, int> $counts
     * @param array<string, mixed> $heartbeat
     * @return array{status: string, label: string, reason: string}
     */
    private function calculateGeneralHealth(array $counts, array $heartbeat, ?int $openDeadLetters): array
    {
        if (
            $counts['critical_count'] > 0
            || $heartbeat['status'] === 'critical'
            || $counts['meta_failure_count'] >= self::HEALTH_FAILURE_CRITICAL_COUNT
            || $counts['glpi_failure_count'] >= self::HEALTH_FAILURE_CRITICAL_COUNT
            || ($openDeadLetters !== null && $openDeadLetters >= self::HEALTH_DEAD_LETTER_CRITICAL_COUNT)
        ) {
            return [
                'status' => 'critical',
                'label' => __('Crítico', 'glpiintegaglpi'),
                'reason' => __('Há sinal crítico recente ou heartbeat antigo.', 'glpiintegaglpi'),
            ];
        }

        if (
            $counts['error_critical_count'] > 0
            || $heartbeat['status'] === 'warning'
            || $counts['meta_failure_count'] >= self::HEALTH_FAILURE_WARNING_COUNT
            || $counts['glpi_failure_count'] >= self::HEALTH_FAILURE_WARNING_COUNT
            || ($openDeadLetters !== null && $openDeadLetters > 0)
            || $counts['duplicated_webhook_count'] >= self::HEALTH_DUPLICATED_WARNING_COUNT
        ) {
            return [
                'status' => 'warning',
                'label' => __('Atenção', 'glpiintegaglpi'),
                'reason' => __('Há falhas, duplicidades, dead-letter ou heartbeat em atenção.', 'glpiintegaglpi'),
            ];
        }

        return [
            'status' => 'ok',
            'label' => __('Saudável', 'glpiintegaglpi'),
            'reason' => __('Heartbeat recente e sem falhas relevantes.', 'glpiintegaglpi'),
        ];
    }

    private function failureStatus(int $count): string
    {
        if ($count >= self::HEALTH_FAILURE_CRITICAL_COUNT) {
            return 'critical';
        }

        return $count >= self::HEALTH_FAILURE_WARNING_COUNT ? 'warning' : 'ok';
    }

    private function deadLetterStatus(?int $count): string
    {
        if ($count === null) {
            return 'warning';
        }

        if ($count >= self::HEALTH_DEAD_LETTER_CRITICAL_COUNT) {
            return 'critical';
        }

        return $count > 0 ? 'warning' : 'ok';
    }

    private function parseDatabaseTimestamp(string $value): ?DateTimeImmutable
    {
        try {
            return new DateTimeImmutable($value, new DateTimeZone(date_default_timezone_get()));
        } catch (Throwable) {
            return null;
        }
    }

    private function formatMinutesAgo(int $minutes): string
    {
        if ($minutes <= 0) {
            return __('Agora', 'glpiintegaglpi');
        }

        if ($minutes < 60) {
            return sprintf(__('Há %d minutos', 'glpiintegaglpi'), $minutes);
        }

        $hours = intdiv($minutes, 60);
        $remainingMinutes = $minutes % 60;
        if ($remainingMinutes === 0) {
            return sprintf(__('Há %d horas', 'glpiintegaglpi'), $hours);
        }

        return sprintf(__('Há %d horas e %d minutos', 'glpiintegaglpi'), $hours, $remainingMinutes);
    }

    /**
     * @return array<string, mixed>
     */
    private function buildUnavailableHealthData(): array
    {
        return [
            'window_label' => __('Últimas 24h', 'glpiintegaglpi'),
            'dead_letter_available' => false,
            'overall' => [
                'status' => 'warning',
                'label' => __('Indisponível', 'glpiintegaglpi'),
                'reason' => __('Configure o PostgreSQL externo para exibir saúde operacional.', 'glpiintegaglpi'),
            ],
            'cards' => [],
            'risk_list' => [
                'available' => false,
                'items' => [],
                'limit' => OperationalQualityService::RISK_LIST_LIMIT,
                'message' => __('Configure o PostgreSQL externo para exibir chamados em risco.', 'glpiintegaglpi'),
            ],
        ];
    }

    /**
     * @param array<string, mixed> $query
     * @return array<string, mixed>
     */
    private function normalizeFilters(array $query): array
    {
        $defaultTo = new DateTimeImmutable('now', new DateTimeZone(date_default_timezone_get()));
        $defaultFrom = $defaultTo->modify('-7 days');
        $dateFrom = $this->parseDateTime((string) ($query['date_from'] ?? ''), $defaultFrom);
        $dateTo = $this->parseDateTime((string) ($query['date_to'] ?? ''), $defaultTo);

        if ($dateFrom > $dateTo) {
            [$dateFrom, $dateTo] = [$dateTo, $dateFrom];
        }

        return [
            'ticket_id' => $this->positiveInt($query['ticket_id'] ?? null),
            'correlation_id' => $this->safeToken($query['correlation_id'] ?? null, 160),
            'conversation_id' => $this->safeToken($query['conversation_id'] ?? null, 160),
            'message_id' => $this->safeToken($query['message_id'] ?? null, 220),
            'event_type' => $this->safeToken($query['event_type'] ?? null, 120),
            'severity' => $this->safeToken($query['severity'] ?? null, 32),
            'status' => $this->safeToken($query['status'] ?? null, 32),
            'source' => $this->safeToken($query['source'] ?? null, 120),
            'only_errors' => (string) ($query['only_errors'] ?? '') === '1',
            'date_from' => $dateFrom->format('Y-m-d\TH:i'),
            'date_to' => $dateTo->format('Y-m-d\TH:i'),
            'date_from_sql' => $dateFrom->format('Y-m-d H:i:sP'),
            'date_to_sql' => $dateTo->format('Y-m-d H:i:sP'),
            'audit_detail_id' => $this->positiveInt($query['audit_detail_id'] ?? null),
            'dead_letter_detail_id' => $this->positiveInt($query['dead_letter_detail_id'] ?? null),
        ];
    }

    /**
     * @param array<string, mixed> $query
     * @return array{page: int, limit: int, offset: int}
     */
    private function normalizePagination(array $query): array
    {
        $page = $this->positiveInt($query['page'] ?? null);
        if ($page <= 0) {
            $page = 1;
        }

        $limit = $this->positiveInt($query['limit'] ?? null);
        if ($limit <= 0) {
            $limit = self::DEFAULT_LIMIT;
        }
        $limit = min(self::MAX_LIMIT, max(1, $limit));

        return [
            'page' => $page,
            'limit' => $limit,
            'offset' => ($page - 1) * $limit,
        ];
    }

    private function parseDateTime(string $value, DateTimeImmutable $fallback): DateTimeImmutable
    {
        $value = trim($value);
        if ($value === '') {
            return $fallback;
        }

        $parsed = DateTimeImmutable::createFromFormat('Y-m-d\TH:i', $value)
            ?: DateTimeImmutable::createFromFormat('Y-m-d H:i', $value);

        return $parsed instanceof DateTimeImmutable ? $parsed : $fallback;
    }

    private function positiveInt(mixed $value): int
    {
        if (!ctype_digit((string) $value)) {
            return 0;
        }

        return max(0, (int) $value);
    }

    private function safeToken(mixed $value, int $maxLength): string
    {
        $token = trim((string) $value);
        if ($token === '') {
            return '';
        }

        $token = substr($token, 0, $maxLength);

        return preg_match('/^[A-Za-z0-9_.:@|=+\-]+$/', $token) === 1 ? $token : '';
    }

    private function getAuditRepository(): AuditRepository
    {
        if ($this->auditRepository instanceof AuditRepository) {
            return $this->auditRepository;
        }

        $this->auditRepository = new AuditRepository($this->getPdo());

        return $this->auditRepository;
    }

    private function getOperationalQualityService(): OperationalQualityService
    {
        if ($this->operationalQualityService instanceof OperationalQualityService) {
            return $this->operationalQualityService;
        }

        $this->operationalQualityService = new OperationalQualityService($this->pluginConfigService);

        return $this->operationalQualityService;
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
