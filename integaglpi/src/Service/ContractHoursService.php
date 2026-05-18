<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi\Service;

use DateInterval;
use DateTimeImmutable;
use DateTimeZone;
use GlpiPlugin\Integaglpi\External\ExternalDatabase;
use GlpiPlugin\Integaglpi\External\Repository\ContractHoursRepository;
use PDO;
use PDOException;
use RuntimeException;
use Throwable;

final class ContractHoursService
{
    private ?PDO $pdo = null;

    private ?ContractHoursRepository $repository = null;

    public function __construct(private readonly PluginConfigService $pluginConfigService)
    {
    }

    /**
     * @param array<string, mixed> $query
     * @param array{type: string, message: string}|null $flash
     * @return array<string, mixed>
     */
    public function getPageData(array $query, ?array $flash = null): array
    {
        $filters = $this->normalizeFilters($query);
        $entityIds = $this->getActiveEntityIds();

        $data = [
            'filters' => $filters,
            'active_entity_ids' => $entityIds,
            'entity_scope_label' => $this->formatEntityScopeLabel($entityIds),
            'contracts' => [],
            'contracts_total' => 0,
            'adjustments' => [],
            'adjustments_total' => 0,
            'edit_contract' => null,
            'entity_options' => [],
            'kpis' => $this->emptyKpis(),
            'pagination' => [
                'page' => $filters['page'],
                'limit' => $filters['limit'],
                'has_previous' => $filters['page'] > 1,
                'has_next' => false,
            ],
            'adjustment_pagination' => [
                'page' => $filters['adjustment_page'],
                'limit' => $filters['limit'],
                'has_previous' => $filters['adjustment_page'] > 1,
                'has_next' => false,
            ],
            'task_actiontime_available' => $this->isGlpiTaskActiontimeAvailable(),
            'flash' => $flash,
            'error' => '',
            'error_diagnostic' => '',
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
            $data['entity_options'] = $this->loadGlpiEntityOptions();
            $repository = $this->getRepository();
            $contractOffset = (($filters['page'] - 1) * $filters['limit']);
            $adjustmentOffset = (($filters['adjustment_page'] - 1) * $filters['limit']);

            $contracts = $repository->findContracts($filters, $entityIds, $filters['limit'], $contractOffset);
            $contracts = $this->decorateContracts($contracts);
            $data['contracts'] = $contracts;
            $data['contracts_total'] = $repository->countContracts($filters, $entityIds);
            $data['adjustments'] = $this->decorateAdjustments(
                $repository->findAdjustments($filters, $entityIds, $filters['limit'], $adjustmentOffset)
            );
            $data['adjustments_total'] = $repository->countAdjustments($filters, $entityIds);
            $data['kpis'] = $this->buildKpis($contracts);
            $data['pagination']['has_next'] = ($contractOffset + $filters['limit']) < $data['contracts_total'];
            $data['adjustment_pagination']['has_next'] = ($adjustmentOffset + $filters['limit']) < $data['adjustments_total'];

            $editId = (int) ($filters['edit_contract_id'] ?? 0);
            if ($editId > 0) {
                $contract = $repository->findContractById($editId);
                if (is_array($contract) && in_array((int) ($contract['glpi_entity_id'] ?? 0), $entityIds, true)) {
                    $data['edit_contract'] = $contract;
                }
            }
        } catch (Throwable $exception) {
            $this->logContractThrowable($exception, 'load');
            $data['error'] = $this->friendlyStorageExceptionMessage($exception, 'load');
            if ($this->canSeeAdminDiagnostic()) {
                $data['error_diagnostic'] = $this->formatAdminThrowableDiagnostic($exception, 'load');
            }
        }

        return $data;
    }

    /**
     * @param array<string, mixed> $post
     * @return array{type: string, message: string}
     */
    public function handlePost(array $post, int $userId): array
    {
        if (!$this->pluginConfigService->isConfigured()) {
            return ['type' => 'danger', 'message' => __('PostgreSQL externo ainda não está configurado.', 'glpiintegaglpi')];
        }

        $action = trim((string) ($post['action'] ?? ''));

        try {
            return match ($action) {
                'save_contract' => $this->saveContract($post, $userId),
                'disable_contract' => $this->setContractActive($post, $userId, false),
                'enable_contract' => $this->setContractActive($post, $userId, true),
                'add_adjustment' => $this->addAdjustment($post, $userId),
                default => ['type' => 'danger', 'message' => __('Ação inválida.', 'glpiintegaglpi')],
            };
        } catch (Throwable $exception) {
            $this->logContractThrowable($exception, 'save');
            if ($exception instanceof RuntimeException && $exception->getPrevious() === null) {
                $response = ['type' => 'danger', 'message' => $exception->getMessage()];
                if ($this->canSeeAdminDiagnostic()) {
                    $response['diagnostic'] = $this->formatAdminThrowableDiagnostic($exception, 'save');
                }

                return $response;
            }

            $response = ['type' => 'danger', 'message' => $this->friendlyStorageExceptionMessage($exception, 'save')];
            if ($this->canSeeAdminDiagnostic()) {
                $response['diagnostic'] = $this->formatAdminThrowableDiagnostic($exception, 'save');
            }

            return $response;
        }
    }

    /**
     * @param array<string, mixed> $post
     * @return array{type: string, message: string}
     */
    private function saveContract(array $post, int $userId): array
    {
        $entityId = (int) ($post['glpi_entity_id'] ?? 0);
        if ($entityId <= 0 || !$this->canUseEntity($entityId)) {
            throw new RuntimeException(__('Entidade GLPI inválida ou fora do escopo ativo.', 'glpiintegaglpi'));
        }

        $entityOption = $this->findGlpiEntityOption($entityId);
        if ($entityOption === null) {
            throw new RuntimeException(__('Entidade GLPI inválida ou fora do escopo ativo.', 'glpiintegaglpi'));
        }

        $id = (int) ($post['contract_id'] ?? 0);
        if ($id > 0) {
            $existingContract = $this->getScopedContract($id);
            if ((int) ($existingContract['glpi_entity_id'] ?? 0) !== $entityId) {
                throw new RuntimeException(__('Contrato existente não pode trocar de entidade. Desative este contrato e crie um novo para outra entidade.', 'glpiintegaglpi'));
            }
        }

        $allocatedHours = $this->parseDecimalHours((string) ($post['allocated_hours'] ?? ''));
        $periodStart = $this->parseDateString((string) ($post['period_start'] ?? ''));
        $periodEnd = $this->parseDateString((string) ($post['period_end'] ?? ''));
        if ($allocatedHours < 0) {
            throw new RuntimeException(__('Horas contratadas não podem ser negativas.', 'glpiintegaglpi'));
        }
        if ($periodStart === '' || $periodEnd === '' || $periodEnd < $periodStart) {
            throw new RuntimeException(__('Vigência inválida para o contrato.', 'glpiintegaglpi'));
        }

        $warning = max(1, (int) ($post['warning_threshold_percent'] ?? 70));
        $critical = max($warning, (int) ($post['critical_threshold_percent'] ?? 90));
        $exhausted = max($critical, (int) ($post['exhausted_threshold_percent'] ?? 100));

        $payload = [
            'glpi_entity_id' => $entityId,
            'glpi_entity_name' => (string) $entityOption['name'],
            'glpi_contract_id' => max(0, (int) ($post['glpi_contract_id'] ?? 0)),
            'contract_name' => $this->cleanText((string) ($post['contract_name'] ?? '')),
            'allocated_hours' => $this->formatDecimal($allocatedHours),
            'period_start' => $periodStart,
            'period_end' => $periodEnd,
            'warning_threshold_percent' => $warning,
            'critical_threshold_percent' => $critical,
            'exhausted_threshold_percent' => $exhausted,
            'is_active' => $this->normalizeBool($post['is_active'] ?? false),
            'notes' => $this->cleanText((string) ($post['notes'] ?? '')),
            'created_by' => $userId,
            'updated_by' => $userId,
        ];

        $savedId = $this->getRepository()->saveContract($payload, $id > 0 ? $id : null);

        return [
            'type' => 'success',
            'message' => sprintf(__('Contrato operacional #%d salvo.', 'glpiintegaglpi'), $savedId),
        ];
    }

    /**
     * @param array<string, mixed> $post
     * @return array{type: string, message: string}
     */
    private function setContractActive(array $post, int $userId, bool $active): array
    {
        $contract = $this->getScopedContract((int) ($post['contract_id'] ?? 0));
        $this->getRepository()->setContractActive((int) $contract['id'], $active, $userId);

        return [
            'type' => 'success',
            'message' => $active
                ? __('Contrato reativado.', 'glpiintegaglpi')
                : __('Contrato desativado sem remoção física.', 'glpiintegaglpi'),
        ];
    }

    /**
     * @param array<string, mixed> $post
     * @return array{type: string, message: string}
     */
    private function addAdjustment(array $post, int $userId): array
    {
        $contract = $this->getScopedContract((int) ($post['contract_id'] ?? 0));
        $notes = $this->cleanText((string) ($post['review_notes'] ?? ''));
        if ($notes === '') {
            throw new RuntimeException(__('Justificativa é obrigatória para ajuste manual.', 'glpiintegaglpi'));
        }

        $type = (string) ($post['adjustment_type'] ?? 'add');
        if (!in_array($type, ['add', 'remove', 'correction'], true)) {
            $type = 'correction';
        }

        $hours = abs($this->parseDecimalHours((string) ($post['adjusted_hours'] ?? '')));
        if ($hours <= 0.0) {
            throw new RuntimeException(__('Informe uma quantidade de horas maior que zero.', 'glpiintegaglpi'));
        }

        $signedHours = $type === 'remove' ? -$hours : $hours;
        $previousValue = $this->getRepository()->sumManualAdjustments((int) $contract['id']);
        $this->getRepository()->insertAdjustment([
            'contract_id' => (int) $contract['id'],
            'glpi_entity_id' => (int) $contract['glpi_entity_id'],
            'glpi_ticket_id' => max(0, (int) ($post['glpi_ticket_id'] ?? 0)) ?: null,
            'adjusted_hours' => $this->formatDecimal($signedHours),
            'adjustment_type' => $type,
            'source' => 'manual_adjustment',
            'previous_value' => $this->formatDecimal($previousValue),
            'reviewed_by' => $userId,
            'review_notes' => $notes,
        ]);

        return [
            'type' => 'success',
            'message' => __('Ajuste manual registrado com auditoria.', 'glpiintegaglpi'),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function getScopedContract(int $contractId): array
    {
        if ($contractId <= 0) {
            throw new RuntimeException(__('Contrato inválido.', 'glpiintegaglpi'));
        }

        $contract = $this->getRepository()->findContractById($contractId);
        if (!is_array($contract) || !$this->canUseEntity((int) ($contract['glpi_entity_id'] ?? 0))) {
            throw new RuntimeException(__('Contrato não encontrado no escopo ativo.', 'glpiintegaglpi'));
        }

        return $contract;
    }

    /**
     * @param list<array<string, mixed>> $contracts
     * @return list<array<string, mixed>>
     */
    private function decorateContracts(array $contracts): array
    {
        $manualByContract = $this->getRepository()->sumManualAdjustmentsByContractIds(
            array_map(static fn (array $row): int => (int) ($row['id'] ?? 0), $contracts)
        );

        return array_map(function (array $contract) use ($manualByContract): array {
            $contractId = (int) ($contract['id'] ?? 0);
            $allocated = (float) ($contract['allocated_hours'] ?? 0);
            $manualHours = (float) ($manualByContract[$contractId] ?? 0);
            $taskHours = $this->getGlpiTaskHours($contract);
            $taskHoursValue = $taskHours ?? 0.0;
            $consumed = $taskHoursValue + $manualHours;
            $percent = $allocated > 0 ? ($consumed / $allocated) * 100 : 0.0;

            $contract['manual_adjustment_hours'] = round($manualHours, 2);
            $contract['glpi_task_hours'] = $taskHours === null ? null : round($taskHours, 2);
            $contract['consumed_hours'] = round($consumed, 2);
            $contract['balance_hours'] = round($allocated - $consumed, 2);
            $contract['consumed_percent'] = round($percent, 1);
            $contract['alert_status'] = $this->resolveAlertStatus($contract, $percent);
            $contract['alert_label'] = $this->formatAlertLabel((string) $contract['alert_status']);

            return $contract;
        }, $contracts);
    }

    /**
     * @param list<array<string, mixed>> $adjustments
     * @return list<array<string, mixed>>
     */
    private function decorateAdjustments(array $adjustments): array
    {
        return array_map(static function (array $row): array {
            $reviewedBy = (int) ($row['reviewed_by'] ?? 0);
            $row['reviewed_by_name'] = $reviewedBy > 0 ? (string) getUserName($reviewedBy) : __('Usuário desconhecido', 'glpiintegaglpi');

            return $row;
        }, $adjustments);
    }

    /**
     * @param list<array<string, mixed>> $contracts
     * @return array<string, mixed>
     */
    private function buildKpis(array $contracts): array
    {
        $kpis = $this->emptyKpis();
        foreach ($contracts as $contract) {
            $kpis['allocated_hours'] += (float) ($contract['allocated_hours'] ?? 0);
            $kpis['consumed_hours'] += (float) ($contract['consumed_hours'] ?? 0);
            $kpis['balance_hours'] += (float) ($contract['balance_hours'] ?? 0);
            $status = (string) ($contract['alert_status'] ?? 'ok');
            if (isset($kpis[$status . '_contracts'])) {
                $kpis[$status . '_contracts']++;
            }
        }

        $kpis['allocated_hours'] = round((float) $kpis['allocated_hours'], 2);
        $kpis['consumed_hours'] = round((float) $kpis['consumed_hours'], 2);
        $kpis['balance_hours'] = round((float) $kpis['balance_hours'], 2);

        return $kpis;
    }

    /**
     * @return array<string, mixed>
     */
    private function emptyKpis(): array
    {
        return [
            'allocated_hours' => 0.0,
            'consumed_hours' => 0.0,
            'balance_hours' => 0.0,
            'warning_contracts' => 0,
            'critical_contracts' => 0,
            'exhausted_contracts' => 0,
        ];
    }

    /**
     * @param array<string, mixed> $contract
     */
    private function resolveAlertStatus(array $contract, float $percent): string
    {
        if ($percent >= (float) ($contract['exhausted_threshold_percent'] ?? 100)) {
            return 'exhausted';
        }

        if ($percent >= (float) ($contract['critical_threshold_percent'] ?? 90)) {
            return 'critical';
        }

        if ($percent >= (float) ($contract['warning_threshold_percent'] ?? 70)) {
            return 'warning';
        }

        return 'ok';
    }

    private function formatAlertLabel(string $status): string
    {
        return match ($status) {
            'warning' => __('Atenção', 'glpiintegaglpi'),
            'critical' => __('Crítico', 'glpiintegaglpi'),
            'exhausted' => __('Excedido', 'glpiintegaglpi'),
            default => __('Normal', 'glpiintegaglpi'),
        };
    }

    /**
     * @param array<string, mixed> $contract
     */
    private function getGlpiTaskHours(array $contract): ?float
    {
        if (!$this->isGlpiTaskActiontimeAvailable()) {
            return null;
        }

        global $DB;
        $entityId = (int) ($contract['glpi_entity_id'] ?? 0);
        if ($entityId <= 0 || !$this->canUseEntity($entityId) || !is_object($DB) || !method_exists($DB, 'request')) {
            return null;
        }

        $start = $this->parseDateString((string) ($contract['period_start'] ?? ''));
        $end = $this->parseDateString((string) ($contract['period_end'] ?? ''));
        if ($start === '' || $end === '') {
            return null;
        }

        try {
            $seconds = 0.0;
            foreach ($DB->request([
                'SELECT' => ['glpi_tickettasks.actiontime'],
                'FROM' => 'glpi_tickettasks',
                'INNER JOIN' => [
                    'glpi_tickets' => [
                        'FKEY' => [
                            'glpi_tickettasks' => 'tickets_id',
                            'glpi_tickets' => 'id',
                        ],
                    ],
                ],
                'WHERE' => [
                    'glpi_tickets.entities_id' => $entityId,
                    'glpi_tickets.is_deleted' => 0,
                    ['glpi_tickettasks.actiontime' => ['>', 0]],
                    ['glpi_tickettasks.date' => ['>=', $start . ' 00:00:00']],
                    ['glpi_tickettasks.date' => ['<=', $end . ' 23:59:59']],
                ],
                'LIMIT' => 5000,
            ]) as $row) {
                $seconds += (float) ($row['actiontime'] ?? 0);
            }

            return round($seconds / 3600, 2);
        } catch (Throwable $exception) {
            error_log('[integaglpi][contracts-hours][actiontime] ' . $exception->getMessage());
            return null;
        }
    }

    private function isGlpiTaskActiontimeAvailable(): bool
    {
        static $available = null;
        if ($available !== null) {
            return $available;
        }

        global $DB;
        if (!is_object($DB) || !method_exists($DB, 'fieldExists') || !method_exists($DB, 'request')) {
            $available = false;
            return false;
        }

        try {
            if (method_exists($DB, 'tableExists') && !$DB->tableExists('glpi_tickettasks')) {
                $available = false;
                return false;
            }
            $available = (bool) $DB->fieldExists('glpi_tickettasks', 'actiontime');
        } catch (Throwable) {
            $available = false;
        }

        return $available;
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

        $status = (string) ($query['status'] ?? 'active');
        if (!in_array($status, ['active', 'inactive', 'all'], true)) {
            $status = 'active';
        }

        return [
            'date_from' => $dateFrom->format('Y-m-d'),
            'date_to' => $dateTo->format('Y-m-d'),
            'date_from_sql' => $dateFrom->setTime(0, 0, 0)->format(DATE_ATOM),
            'date_to_sql' => $dateTo->setTime(23, 59, 59)->format(DATE_ATOM),
            'entity_id' => max(0, (int) ($query['entity_id'] ?? 0)),
            'status' => $status,
            'page' => max(1, (int) ($query['page'] ?? 1)),
            'adjustment_page' => max(1, (int) ($query['adjustment_page'] ?? 1)),
            'limit' => max(1, min((int) ($query['limit'] ?? 25), 50)),
            'edit_contract_id' => max(0, (int) ($query['edit_contract_id'] ?? 0)),
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

    private function parseDateString(string $value): string
    {
        $value = trim($value);
        $parsed = DateTimeImmutable::createFromFormat('Y-m-d', $value);

        return $parsed instanceof DateTimeImmutable ? $parsed->format('Y-m-d') : '';
    }

    private function parseDecimalHours(string $value): float
    {
        $normalized = str_replace(',', '.', trim($value));
        if ($normalized === '' || !is_numeric($normalized)) {
            return 0.0;
        }

        return round((float) $normalized, 2);
    }

    private function formatDecimal(float $value): string
    {
        return number_format($value, 2, '.', '');
    }

    private function cleanText(string $value): string
    {
        return trim(preg_replace('/\s+/', ' ', $value) ?? '');
    }

    private function normalizeBool(mixed $value): bool
    {
        if (is_bool($value)) {
            return $value;
        }

        if ($value === null) {
            return false;
        }

        $normalized = strtolower(trim((string) $value));
        if ($normalized === '') {
            return false;
        }

        if (in_array($normalized, ['1', 'true', 'on', 'yes'], true)) {
            return true;
        }

        if (in_array($normalized, ['0', 'false', 'off', 'no'], true)) {
            return false;
        }

        return false;
    }

    private function friendlyStorageExceptionMessage(Throwable $exception, string $operation): string
    {
        $storageException = $this->storageExceptionForClassification($exception);
        $message = $storageException->getMessage();
        $code = (string) $storageException->getCode();
        $sqlState = $this->extractSqlState($message, $code);
        $normalizedMessage = strtolower($message);
        $prefix = $operation === 'load'
            ? __('Não foi possível carregar contratos e horas:', 'glpiintegaglpi')
            : __('Não foi possível salvar contratos e horas:', 'glpiintegaglpi');

        if ($storageException instanceof PDOException || str_contains($message, 'SQLSTATE')) {
            if (in_array($sqlState, ['08006', '08001'], true)
                || str_contains($normalizedMessage, 'connection refused')
                || str_contains($normalizedMessage, 'could not connect')
                || str_contains($normalizedMessage, 'no route to host')
                || str_contains($normalizedMessage, 'server closed the connection')) {
                return $prefix . ' ' . __('falha de conexão com o PostgreSQL externo.', 'glpiintegaglpi');
            }
            if ($sqlState === '28P01' || str_contains($normalizedMessage, 'authentication failed')) {
                return $prefix . ' ' . __('credencial do PostgreSQL externo inválida.', 'glpiintegaglpi');
            }
            if ($sqlState === '42501' || str_contains($normalizedMessage, 'permission denied')) {
                return $prefix . ' ' . __('permissão insuficiente no PostgreSQL externo para contratos/horas.', 'glpiintegaglpi');
            }
            if ($sqlState === '42P01' || str_contains($normalizedMessage, 'undefined table')) {
                $table = $this->extractMissingRelation($message);
                return $prefix . ' ' . sprintf(
                    __('tabela de contratos/horas ausente%s. Verifique migrations 016+ antes de produção.', 'glpiintegaglpi'),
                    $table !== '' ? ' (' . $table . ')' : ''
                );
            }
            if ($sqlState === '42703' || str_contains($normalizedMessage, 'undefined column')) {
                $column = $this->extractMissingColumn($message);
                return $prefix . ' ' . sprintf(
                    __('coluna esperada não existe no schema de contratos/horas%s. Verifique migrations pendentes.', 'glpiintegaglpi'),
                    $column !== '' ? ' (' . $column . ')' : ''
                );
            }
            if ($sqlState === '22P02' || str_contains($normalizedMessage, 'invalid input syntax')) {
                return $prefix . ' ' . __('valor inválido recebido do formulário. Revise booleanos, entidade e campos numéricos.', 'glpiintegaglpi');
            }
            if ($sqlState === '23505') {
                return $prefix . ' ' . __('registro duplicado detectado no schema de contratos/horas.', 'glpiintegaglpi');
            }
            if ($sqlState === '23503') {
                return $prefix . ' ' . __('referência inválida no schema de contratos/horas. Verifique contrato, entidade e ticket informados.', 'glpiintegaglpi');
            }
            if ($sqlState === '23514') {
                return $prefix . ' ' . __('valor fora da regra permitida no schema de contratos/horas.', 'glpiintegaglpi');
            }
            if (str_contains($normalizedMessage, 'timeout') || $sqlState === '57014') {
                return $prefix . ' ' . __('timeout ao consultar o PostgreSQL externo.', 'glpiintegaglpi');
            }
            if ($sqlState !== '') {
                return $prefix . ' ' . sprintf(
                    __('erro de banco mapeado pelo SQLSTATE %s. Consulte o log técnico sanitizado.', 'glpiintegaglpi'),
                    $sqlState
                );
            }
        }

        if (str_contains($normalizedMessage, 'could not find driver')) {
            return $prefix . ' ' . __('driver PDO do PostgreSQL indisponível no PHP.', 'glpiintegaglpi');
        }

        if (str_contains($normalizedMessage, 'unable to connect to the external postgresql database')) {
            return $prefix . ' ' . __('falha de conexão com o PostgreSQL externo.', 'glpiintegaglpi');
        }

        if ($storageException instanceof \Error) {
            return $prefix . ' ' . sprintf(
                __('erro PHP interno em Contratos/Horas (%s). Consulte o diagnóstico técnico sanitizado.', 'glpiintegaglpi'),
                $this->sanitizeExceptionClass($storageException)
            );
        }

        if ($storageException instanceof RuntimeException) {
            return $prefix . ' ' . __('erro operacional interno em Contratos/Horas. Consulte o diagnóstico técnico sanitizado.', 'glpiintegaglpi');
        }

        return $prefix . ' ' . sprintf(
            __('erro interno classificado como %s. Consulte o diagnóstico técnico sanitizado.', 'glpiintegaglpi'),
            $this->sanitizeExceptionClass($storageException)
        );
    }

    private function logContractThrowable(Throwable $exception, string $operation): void
    {
        error_log('[integaglpi][contracts-hours][diagnostic] ' . json_encode(
            $this->buildThrowableDiagnostic($exception, $operation),
            JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE
        ));
    }

    /**
     * @return array<string, int|string|null>
     */
    private function buildThrowableDiagnostic(Throwable $exception, string $operation): array
    {
        $previous = $exception->getPrevious();

        return [
            'operation' => $operation,
            'exception_class' => $this->sanitizeExceptionClass($exception),
            'relative_file' => $this->relativeThrowableFile($exception->getFile()),
            'line' => $exception->getLine(),
            'sanitized_message' => $this->sanitizeThrowableMessage($exception->getMessage()),
            'previous_exception_class' => $previous instanceof Throwable ? $this->sanitizeExceptionClass($previous) : null,
            'previous_sanitized_message' => $previous instanceof Throwable
                ? $this->sanitizeThrowableMessage($previous->getMessage())
                : null,
        ];
    }

    private function formatAdminThrowableDiagnostic(Throwable $exception, string $operation): string
    {
        $diagnostic = $this->buildThrowableDiagnostic($exception, $operation);
        $parts = [
            'op=' . $diagnostic['operation'],
            'class=' . $diagnostic['exception_class'],
            'file=' . $diagnostic['relative_file'],
            'line=' . $diagnostic['line'],
        ];

        if ($diagnostic['previous_exception_class'] !== null) {
            $parts[] = 'previous=' . $diagnostic['previous_exception_class'];
        }

        $parts[] = 'message=' . $diagnostic['sanitized_message'];

        return __('Diagnóstico técnico:', 'glpiintegaglpi') . ' ' . implode(' · ', $parts);
    }

    private function canSeeAdminDiagnostic(): bool
    {
        try {
            return class_exists('\Session')
                && (
                    (bool) \Session::haveRight('config', READ)
                    || (bool) \Session::haveRight('profile', READ)
                );
        } catch (Throwable) {
            return false;
        }
    }

    private function relativeThrowableFile(string $file): string
    {
        $normalized = str_replace('\\', '/', $file);
        $root = defined('PLUGIN_INTEGAGLPI_ROOT')
            ? str_replace('\\', '/', (string) PLUGIN_INTEGAGLPI_ROOT)
            : '';

        if ($root !== '' && str_starts_with($normalized, rtrim($root, '/') . '/')) {
            return 'integaglpi/' . ltrim(substr($normalized, strlen(rtrim($root, '/'))), '/');
        }

        $marker = '/plugins/integaglpi/';
        $position = stripos($normalized, $marker);
        if ($position !== false) {
            return 'integaglpi/' . substr($normalized, $position + strlen($marker));
        }

        return basename($normalized);
    }

    private function sanitizeThrowableMessage(string $message): string
    {
        $sanitized = preg_replace('/(password|passwd|pwd|token|secret|authorization|bearer|x-api-key)(\\s*[=:]\\s*)[^\\s;&]+/i', '$1$2[redacted]', $message) ?? '';
        $sanitized = preg_replace('/pgsql:[^\\s]+/i', 'pgsql:[redacted]', $sanitized) ?? '';
        $sanitized = preg_replace('/\\s+/', ' ', $sanitized) ?? '';
        $sanitized = trim($sanitized);

        if ($sanitized === '') {
            return '[empty]';
        }

        return strlen($sanitized) > 180 ? substr($sanitized, 0, 177) . '...' : $sanitized;
    }

    private function storageExceptionForClassification(Throwable $exception): Throwable
    {
        $current = $exception;
        while ($current->getPrevious() instanceof Throwable) {
            $previous = $current->getPrevious();
            if ($previous instanceof PDOException || str_contains($previous->getMessage(), 'SQLSTATE')) {
                return $previous;
            }

            $current = $previous;
        }

        return $current;
    }

    private function extractSqlState(string $message, string $code): string
    {
        if (preg_match('/SQLSTATE\\[([A-Z0-9]{5})\\]/', $message, $matches) === 1) {
            return $matches[1];
        }

        return preg_match('/^[A-Z0-9]{5}$/', $code) === 1 ? $code : '';
    }

    private function extractMissingRelation(string $message): string
    {
        if (preg_match('/relation "?([a-z0-9_.]+)"? does not exist/i', $message, $matches) !== 1) {
            return '';
        }

        return $this->sanitizeStorageIdentifier($matches[1]);
    }

    private function extractMissingColumn(string $message): string
    {
        if (preg_match('/column "?([a-z0-9_.]+)"? does not exist/i', $message, $matches) !== 1) {
            return '';
        }

        return $this->sanitizeStorageIdentifier($matches[1]);
    }

    private function sanitizeStorageIdentifier(string $value): string
    {
        return preg_replace('/[^a-z0-9_.]/i', '', $value) ?? '';
    }

    private function sanitizeExceptionClass(Throwable $exception): string
    {
        $class = str_replace('\\', '_', $exception::class);
        return preg_replace('/[^a-zA-Z0-9_]/', '', $class) ?: 'Throwable';
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

    private function canUseEntity(int $entityId): bool
    {
        if ($entityId <= 0) {
            return false;
        }

        try {
            if (class_exists('\Session') && method_exists('\Session', 'haveAccessToEntity')) {
                return (bool) \Session::haveAccessToEntity($entityId);
            }
        } catch (Throwable) {
            return false;
        }

        return in_array($entityId, $this->getActiveEntityIds(), true);
    }

    /**
     * @return list<array{id: int, name: string}>
     */
    private function loadGlpiEntityOptions(): array
    {
        global $DB;

        $activeEntityIds = $this->getActiveEntityIds();
        if ($activeEntityIds === [] || !is_object($DB) || !method_exists($DB, 'request')) {
            return [];
        }

        try {
            if (method_exists($DB, 'tableExists') && !$DB->tableExists('glpi_entities')) {
                return [];
            }

            $entities = [];
            foreach ($DB->request([
                'SELECT' => ['id', 'name', 'completename'],
                'FROM' => 'glpi_entities',
                'WHERE' => ['id' => $activeEntityIds],
                'ORDER' => ['completename', 'name', 'id'],
                'LIMIT' => 250,
            ]) as $row) {
                $id = (int) ($row['id'] ?? 0);
                if ($id <= 0 || !$this->canUseEntity($id)) {
                    continue;
                }

                $name = $this->cleanText((string) ($row['completename'] ?? ''));
                if ($name === '') {
                    $name = $this->cleanText((string) ($row['name'] ?? ''));
                }
                if ($name === '') {
                    $name = sprintf(__('Entidade #%d', 'glpiintegaglpi'), $id);
                }

                $entities[] = ['id' => $id, 'name' => $name];
            }

            return $entities;
        } catch (Throwable $exception) {
            error_log('[integaglpi][contracts-hours][entities] ' . $exception->getMessage());
            return [];
        }
    }

    /**
     * @return array{id: int, name: string}|null
     */
    private function findGlpiEntityOption(int $entityId): ?array
    {
        if ($entityId <= 0 || !$this->canUseEntity($entityId)) {
            return null;
        }

        global $DB;
        if (!is_object($DB) || !method_exists($DB, 'request')) {
            return null;
        }

        try {
            if (method_exists($DB, 'tableExists') && !$DB->tableExists('glpi_entities')) {
                return null;
            }

            foreach ($DB->request([
                'SELECT' => ['id', 'name', 'completename'],
                'FROM' => 'glpi_entities',
                'WHERE' => ['id' => $entityId],
                'LIMIT' => 1,
            ]) as $row) {
                $id = (int) ($row['id'] ?? 0);
                if ($id <= 0 || !$this->canUseEntity($id)) {
                    return null;
                }

                $name = $this->cleanText((string) ($row['completename'] ?? ''));
                if ($name === '') {
                    $name = $this->cleanText((string) ($row['name'] ?? ''));
                }
                if ($name === '') {
                    $name = sprintf(__('Entidade #%d', 'glpiintegaglpi'), $id);
                }

                return ['id' => $id, 'name' => $name];
            }
        } catch (Throwable $exception) {
            error_log('[integaglpi][contracts-hours][entity] ' . $exception->getMessage());
            return null;
        }

        return null;
    }

    /**
     * @param list<int> $entityIds
     */
    private function formatEntityScopeLabel(array $entityIds): string
    {
        if ($entityIds === []) {
            return __('sem entidades ativas', 'glpiintegaglpi');
        }

        return sprintf(__('%d entidade(s) ativa(s)', 'glpiintegaglpi'), count($entityIds));
    }

    private function getRepository(): ContractHoursRepository
    {
        if ($this->repository instanceof ContractHoursRepository) {
            return $this->repository;
        }

        $this->pdo = ExternalDatabase::getConnection($this->pluginConfigService->getConnectionConfig());
        $this->repository = new ContractHoursRepository($this->pdo);

        return $this->repository;
    }
}
