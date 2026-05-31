<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi\Service;

use CommonITILObject;
use GlpiPlugin\Integaglpi\External\ExternalDatabase;
use GlpiPlugin\Integaglpi\External\ExternalSchemaManager;
use GlpiPlugin\Integaglpi\External\Repository\ConversationRepository;
use GlpiPlugin\Integaglpi\External\Repository\MessageRepository;
use GlpiPlugin\Integaglpi\Service\SecurityAuditService;
use GlpiPlugin\Integaglpi\Service\SecurityPermissionService;
use PDO;
use Throwable;

final class AttendanceCenterService
{
    private const DEFAULT_LIMIT = 25;
    private const MAX_LIMIT = 50;
    private const MAX_REPLY_LENGTH = 4096;
    private const ALLOWED_STATUSES = [
        'open',
        'closed',
        'media_error',
        'pending_glpi',
        'cancelled',
        'awaiting_queue_selection',
        'collecting_contact_profile',
        'awaiting_entity_selection',
    ];

    private const STATUS_LABELS = [
        'collecting_contact_profile' => 'Coletando perfil',
        'awaiting_entity_selection' => 'Aguardando seleção de entidade',
        'awaiting_queue_selection' => 'Aguardando escolha de fila',
        'open' => 'Chamado aberto',
        'closed' => 'Fechado',
        'cancelled' => 'Encerrada administrativamente',
        'media_error' => 'Erro de mídia',
        'pending_glpi' => 'Aguardando GLPI',
    ];

    private const PRE_TICKET_STATUSES = [
        'awaiting_queue_selection',
        'collecting_contact_profile',
        'awaiting_entity_selection',
    ];

    private const SOFT_CLOSE_MINIMUM_STALLED_SECONDS = 1800;
    private const SOFT_CLOSE_ELIGIBLE_STATUSES = [
        'awaiting_queue_selection',
        'collecting_contact_profile',
        'awaiting_entity_selection',
        'pending_glpi',
        'media_error',
        'open',
        'failed',
        'failed_before_ticket',
    ];
    private const TERMINAL_STATUSES = [
        'closed',
        'cancelled',
        'resolved',
        'soft_closed',
    ];

    private PluginConfigService $pluginConfigService;

    private ?PDO $pdo = null;

    private ?ConversationRepository $conversationRepository = null;

    private ?MessageRepository $messageRepository = null;

    private ?TicketRuntimeService $ticketRuntimeService = null;

    private int $orphanedConversationCleanupCount = 0;

    public function __construct(?PluginConfigService $pluginConfigService = null)
    {
        $this->pluginConfigService = $pluginConfigService ?? new PluginConfigService();
    }

    /**
     * @param array<string, mixed> $query
     * @return array<string, mixed>
     */
    public function getCentralData(array $query): array
    {
        $this->orphanedConversationCleanupCount = 0;
        $filters = $this->normalizeFilters($query);
        $pagination = $this->normalizePagination($query);
        $glpiEntities = $this->loadGlpiEntityOptions();
        $allowedEntityIds = array_values(array_filter(
            array_map(static fn (array $entity): int => (int) ($entity['id'] ?? 0), $glpiEntities),
            static fn (int $id): bool => $id > 0
        ));
        $requestedEntityId = (int) ($filters['entity_id'] ?? 0);
        if ($requestedEntityId > 0 && !in_array($requestedEntityId, $allowedEntityIds, true)) {
            $filters['entity_id'] = -1;
        }
        $filters['allowed_entity_ids'] = $allowedEntityIds;

        $baseData = [
            'filters' => $filters,
            'pagination' => [
                ...$pagination,
                'total' => 0,
                'total_pages' => 1,
                'has_previous' => false,
                'has_next' => false,
            ],
            'rows' => [],
            'queues' => [],
            'service_catalog' => [],
            'technicians' => [],
            'glpi_entities' => $glpiEntities,
            'glpi_entities_error' => null,
            'diagnostics' => null,
            'central_error_diagnostic' => null,
            'error' => null,
            'is_configured' => $this->pluginConfigService->isConfigured(),
            'allowed_statuses' => self::ALLOWED_STATUSES,
            'limit_options' => [25, 50],
            'orphaned_cleanup_count' => 0,
        ];

        if (!$this->pluginConfigService->isConfigured()) {
            $baseData['error'] = __(
                'Configure the external PostgreSQL connection before using the Attendance Center.',
                'glpiintegaglpi'
            );
            return $baseData;
        }

        try {
            $repository = $this->getConversationRepository();
            $total = $repository->countForAttendanceCenter($filters);
            $totalPages = max(1, (int) ceil($total / $pagination['limit']));
            $page = min($pagination['page'], $totalPages);
            $offset = ($page - 1) * $pagination['limit'];

            $rows = $repository->findForAttendanceCenter($filters, $pagination['limit'], $offset);
            $rows = $this->filterAndMarkDeletedTicketRows($rows);

            return [
                ...$baseData,
                'rows' => $this->decorateRows($rows),
                'orphaned_cleanup_count' => $this->orphanedConversationCleanupCount,
                'queues' => $repository->findAttendanceQueues(),
                'service_catalog' => $this->loadServiceCatalogOptions(),
                'technicians' => $this->buildTechnicianOptions($repository->findAttendanceTechnicianIds()),
                'diagnostics' => $this->loadReadOnlyDiagnostics(),
                'pagination' => [
                    'page' => $page,
                    'limit' => $pagination['limit'],
                    'offset' => $offset,
                    'total' => $total,
                    'total_pages' => $totalPages,
                    'has_previous' => $page > 1,
                    'has_next' => $page < $totalPages,
                ],
            ];
        } catch (Throwable $exception) {
            $diagnostic = $this->classifyCentralLoadException($exception);
            error_log('[integaglpi][central][error] type=' . $diagnostic['type'] . ' sqlstate=' . ($diagnostic['sqlstate'] ?? '-') . ' detail=' . $diagnostic['log_detail']);

            if (($diagnostic['type'] ?? '') === 'schema') {
                try {
                    return $this->loadMinimalCentralFallback($baseData, $filters, $pagination, $diagnostic);
                } catch (Throwable $fallbackException) {
                    $fallbackDiagnostic = $this->classifyCentralLoadException($fallbackException);
                    error_log('[integaglpi][central][fallback][error] type=' . $fallbackDiagnostic['type'] . ' sqlstate=' . ($fallbackDiagnostic['sqlstate'] ?? '-') . ' detail=' . $fallbackDiagnostic['log_detail']);
                }
            }

            $baseData['error'] = (string) $diagnostic['user_message'];
            if (\GlpiPlugin\Integaglpi\Plugin::canAuditRead()) {
                $baseData['central_error_diagnostic'] = $diagnostic['admin_diagnostic'];
                $baseData['diagnostics'] = $this->loadReadOnlyDiagnostics();
            }
            return $baseData;
        }
    }

    /**
     * @param array<string, mixed> $query
     * @return array<string, mixed>
     */
    public function getCentralRefreshData(array $query, int $currentUserId): array
    {
        $data = $this->getCentralData($query);
        $rows = is_array($data['rows'] ?? null) ? $data['rows'] : [];

        $data['rows'] = array_map(
            static function (array $row) use ($currentUserId): array {
                $ticketId = (int) ($row['glpi_ticket_id'] ?? 0);
                $conversationId = trim((string) ($row['conversation_id'] ?? ''));
                $assignedUserId = (int) ($row['assigned_user_id'] ?? 0);
                $effectiveStatus = (string) ($row['effective_status'] ?? $row['conversation_status'] ?? '');
                $entityId = (int) ($row['glpi_entity_id'] ?? 0);

                $row['can_claim'] = $effectiveStatus === 'open'
                    && $assignedUserId <= 0
                    && $ticketId > 0
                    && $entityId > 0
                    && $conversationId !== '';
                $row['can_reply'] = $effectiveStatus === 'open'
                    && $assignedUserId === $currentUserId
                    && $ticketId > 0
                    && $conversationId !== '';
                $profileComplete = self::isProfileCollectionComplete($row['profile_collection_state'] ?? null);
                $row['profile_collection_complete'] = $profileComplete;
                $row['can_confirm_entity'] = (
                    $effectiveStatus === 'awaiting_entity_selection'
                    || ($effectiveStatus === 'collecting_contact_profile' && $profileComplete)
                )
                    && $ticketId <= 0
                    && $conversationId !== '';
                $row['can_edit_entity'] = !$row['can_confirm_entity'] && $conversationId !== '';
                $row['can_soft_close'] = self::isPotentialSoftCloseEligible($row);

                return $row;
            },
            $rows
        );
        $data['ok'] = empty($data['error']);
        $data['refreshed_at'] = gmdate('c');

        return $data;
    }

    /**
     * @return array<string, mixed>
     */
    public function confirmConversationEntity(
        string $conversationId,
        int $glpiEntityId,
        ?string $glpiEntityName,
        int $userId,
        bool $createTicket,
        int $submittedTicketId = 0,
        ?string $idempotencyKey = null,
        int $serviceCatalogId = 0,
        string $serviceChecklistJson = ''
    ): array {
        $conversationId = trim($conversationId);
        if ($glpiEntityId <= 0) {
            return [
                'ok' => false,
                'http_status' => 400,
                'error' => 'invalid_entity',
                'message' => __('Selecione uma entidade GLPI válida.', 'glpiintegaglpi'),
            ];
        }

        if ($conversationId === '' || $userId <= 0) {
            return [
                'ok' => false,
                'http_status' => 400,
                'error' => 'invalid_request',
                'message' => __('Conversa ou usuário inválido.', 'glpiintegaglpi'),
            ];
        }

        $selectedEntity = $this->findGlpiEntityOption($glpiEntityId);
        if ($selectedEntity === null) {
            return [
                'ok' => false,
                'http_status' => 400,
                'error' => 'invalid_entity',
                'message' => __('Selecione uma entidade GLPI válida disponível para sua sessão.', 'glpiintegaglpi'),
            ];
        }
        $glpiEntityName = $selectedEntity['name'];

        if (!$this->pluginConfigService->isConfigured()) {
            return [
                'ok' => false,
                'http_status' => 503,
                'error' => 'not_configured',
                'message' => __('Integração não configurada.', 'glpiintegaglpi'),
            ];
        }

        try {
            $conversation = $this->getConversationRepository()->findByConversationId($conversationId);
        } catch (Throwable $exception) {
            error_log('[integaglpi][entity_selection][lookup_error] ' . $exception->getMessage());

            return [
                'ok' => false,
                'http_status' => 500,
                'error' => 'lookup_failed',
                'message' => __('Não foi possível validar a conversa agora. Atualize a Central.', 'glpiintegaglpi'),
            ];
        }

        if ($conversation === null) {
            return [
                'ok' => false,
                'http_status' => 404,
                'error' => 'conversation_not_found',
                'message' => __('Conversa não encontrada para confirmação de entidade.', 'glpiintegaglpi'),
            ];
        }

        if ($this->hasValidTicketId($conversation['glpi_ticket_id'] ?? null)) {
            return $this->buildEntitySelectionRecoveredSuccess($conversation);
        }

        $conversationStatus = strtolower(trim((string) ($conversation['conversation_status'] ?? '')));
        if (
            $conversationStatus !== 'awaiting_entity_selection'
            && !(
                $conversationStatus === 'collecting_contact_profile'
                && self::isProfileCollectionComplete($conversation['profile_collection_state'] ?? null)
            )
        ) {
            return [
                'ok' => false,
                'http_status' => 409,
                'error' => 'conversation_status_not_allowed',
                'message' => __('A conversa não está aguardando definição de entidade. Atualize a Central.', 'glpiintegaglpi'),
            ];
        }

        if ($submittedTicketId > 0) {
            return [
                'ok' => false,
                'http_status' => 409,
                'error' => 'ticket_already_linked',
                'message' => __('Esta conversa já possui chamado vinculado. Atualize a Central.', 'glpiintegaglpi'),
            ];
        }

        $checklistValidation = $this->validateServiceChecklist($serviceCatalogId, $serviceChecklistJson);
        if (!$checklistValidation['ok']) {
            return [
                'ok' => false,
                'http_status' => 409,
                'error' => 'service_checklist_incomplete',
                'message' => (string) $checklistValidation['message'],
            ];
        }

        if ($serviceCatalogId > 0) {
            try {
                $this->getConversationRepository()->assignServiceCatalogForPreTicket($conversationId, $serviceCatalogId);
            } catch (Throwable $exception) {
                error_log('[integaglpi][service_catalog][assign_error] ' . $exception->getMessage());
                return [
                    'ok' => false,
                    'http_status' => 500,
                    'error' => 'service_catalog_assign_failed',
                    'message' => __('Não foi possível vincular o serviço ao pré-ticket agora.', 'glpiintegaglpi'),
                ];
            }
        }

        try {
            $client = new IntegrationServiceClient($this->pluginConfigService);
            $response = $client->confirmConversationEntity($conversationId, [
                'glpi_entity_id' => $glpiEntityId,
                'glpi_entity_name' => $glpiEntityName,
                'glpi_user_id' => $userId,
                'create_ticket' => $createTicket,
                'permission_validated' => true,
                'idempotency_key' => $this->normalizeEntitySelectionIdempotencyKey(
                    $conversationId,
                    $glpiEntityId,
                    $idempotencyKey
                ),
            ]);
        } catch (Throwable $exception) {
            error_log('[integaglpi][entity_selection][error] ' . $exception->getMessage());
            $recovered = $this->recoverEntitySelectionSuccess($conversationId);
            if ($recovered !== null) {
                return $recovered;
            }

            return [
                'ok' => false,
                'http_status' => 502,
                'error' => 'integration_error',
                'message' => __('A criação pode ter sido concluída no GLPI. Não tente novamente até a reconciliação ser verificada.', 'glpiintegaglpi'),
            ];
        }

        $body = $response['body'];
        $status = (int) $response['status'];
        if (!$response['success']) {
            $recovered = $this->recoverEntitySelectionSuccess($conversationId);
            if ($recovered !== null) {
                return $recovered;
            }

            return [
                'ok' => false,
                'http_status' => $status > 0 ? $status : 502,
                'error' => (string) ($body['error_code'] ?? 'entity_selection_failed'),
                'message' => (string) ($body['message'] ?? __('Falha ao confirmar entidade.', 'glpiintegaglpi')),
                'body' => $body,
            ];
        }

        return [
            'ok' => true,
            'http_status' => $status,
            'status' => (string) ($body['status'] ?? ($status === 202 ? 'processing' : 'succeeded')),
            'message' => (string) ($body['message'] ?? __('Entidade confirmada com sucesso.', 'glpiintegaglpi')),
            'conversation_id' => (string) ($body['conversation_id'] ?? $conversationId),
            'glpi_ticket_id' => (int) ($body['glpi_ticket_id'] ?? 0),
            'warning' => (string) ($body['warning'] ?? ''),
            'body' => $body,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public function updateConversationEntity(
        string $conversationId,
        int $glpiEntityId,
        ?string $glpiEntityName,
        int $userId,
        bool $applyToTicket
    ): array {
        $conversationId = trim($conversationId);
        if ($conversationId === '' || $userId <= 0) {
            return [
                'ok' => false,
                'http_status' => 400,
                'error' => 'invalid_request',
                'message' => __('Conversa ou usuário inválido.', 'glpiintegaglpi'),
            ];
        }

        if ($glpiEntityId <= 0) {
            return [
                'ok' => false,
                'http_status' => 400,
                'error' => 'invalid_entity',
                'message' => __('Selecione uma entidade GLPI válida.', 'glpiintegaglpi'),
            ];
        }

        $selectedEntity = $this->findGlpiEntityOption($glpiEntityId);
        if ($selectedEntity === null) {
            return [
                'ok' => false,
                'http_status' => 400,
                'error' => 'invalid_entity',
                'message' => __('Entidade GLPI inválida ou fora do escopo permitido.', 'glpiintegaglpi'),
            ];
        }
        $glpiEntityName = (string) $selectedEntity['name'];

        if (!$this->pluginConfigService->isConfigured()) {
            return [
                'ok' => false,
                'http_status' => 503,
                'error' => 'not_configured',
                'message' => __('Integração não configurada.', 'glpiintegaglpi'),
            ];
        }

        try {
            $conversation = $this->getConversationRepository()->findByConversationId($conversationId);
        } catch (Throwable $exception) {
            error_log('[integaglpi][entity_edit][lookup_error] ' . $exception->getMessage());

            return [
                'ok' => false,
                'http_status' => 500,
                'error' => 'lookup_failed',
                'message' => __('Não foi possível validar a conversa agora. Atualize a Central.', 'glpiintegaglpi'),
            ];
        }

        if ($conversation === null) {
            return [
                'ok' => false,
                'http_status' => 404,
                'error' => 'conversation_not_found',
                'message' => __('Conversa não encontrada para alteração de entidade.', 'glpiintegaglpi'),
            ];
        }

        try {
            $updated = $this->getConversationRepository()->updateConversationEntity(
                $conversationId,
                $glpiEntityId,
                $glpiEntityName,
                $userId
            );
        } catch (Throwable $exception) {
            error_log('[integaglpi][entity_edit][error] ' . $exception->getMessage());

            return [
                'ok' => false,
                'http_status' => 500,
                'error' => 'entity_update_failed',
                'message' => __('Não foi possível atualizar a entidade da conversa agora.', 'glpiintegaglpi'),
            ];
        }

        if ($updated === null) {
            return [
                'ok' => false,
                'http_status' => 404,
                'error' => 'conversation_not_found',
                'message' => __('Conversa não encontrada para alteração de entidade.', 'glpiintegaglpi'),
            ];
        }

        $ticketId = (int) ($updated['glpi_ticket_id'] ?? 0);
        $warning = '';
        if ($ticketId > 0) {
            $warning = $applyToTicket
                ? __('A entidade da conversa e da memória foi atualizada. O ticket GLPI existente não foi movido nesta fase; altere a entidade no GLPI manualmente se necessário.', 'glpiintegaglpi')
                : __('A entidade da conversa e da memória foi atualizada. O ticket GLPI existente não foi movido.', 'glpiintegaglpi');
        }

        return [
            'ok' => true,
            'http_status' => 200,
            'message' => __('Entidade da conversa atualizada com auditoria.', 'glpiintegaglpi'),
            'warning' => $warning,
            'conversation_id' => $conversationId,
            'glpi_ticket_id' => $ticketId,
            'glpi_entity_id' => $glpiEntityId,
            'glpi_entity_name' => $glpiEntityName,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public function getConversationEntityStatus(string $conversationId): array
    {
        $conversationId = trim($conversationId);
        if ($conversationId === '') {
            return [
                'ok' => false,
                'http_status' => 400,
                'error' => 'invalid_request',
                'message' => __('Conversa inválida.', 'glpiintegaglpi'),
            ];
        }

        if (!$this->pluginConfigService->isConfigured()) {
            return [
                'ok' => false,
                'http_status' => 503,
                'error' => 'not_configured',
                'message' => __('Integração não configurada.', 'glpiintegaglpi'),
            ];
        }

        try {
            $response = (new IntegrationServiceClient($this->pluginConfigService))
                ->getConversationEntityStatus($conversationId);
        } catch (Throwable $exception) {
            error_log('[integaglpi][entity_selection][status_error] ' . $exception->getMessage());

            return [
                'ok' => false,
                'http_status' => 502,
                'error' => 'integration_error',
                'message' => __('Não foi possível consultar o status da criação agora.', 'glpiintegaglpi'),
            ];
        }

        $body = $response['body'];
        $status = (int) $response['status'];
        if (!$response['success']) {
            return [
                'ok' => false,
                'http_status' => $status > 0 ? $status : 502,
                'error' => (string) ($body['error_code'] ?? 'entity_status_failed'),
                'message' => (string) ($body['message'] ?? __('Falha ao consultar status da tentativa.', 'glpiintegaglpi')),
                'body' => $body,
            ];
        }

        return [
            'ok' => true,
            'http_status' => 200,
            'status' => (string) ($body['status'] ?? 'not_started'),
            'message' => (string) ($body['message'] ?? __('Status da tentativa atualizado.', 'glpiintegaglpi')),
            'conversation_id' => (string) ($body['conversation_id'] ?? $conversationId),
            'glpi_ticket_id' => (int) ($body['glpi_ticket_id'] ?? 0),
            'glpi_entity_id' => (int) ($body['glpi_entity_id'] ?? 0),
            'glpi_entity_name' => (string) ($body['glpi_entity_name'] ?? ''),
            'error_type' => (string) ($body['error_type'] ?? ''),
            'error_message' => (string) ($body['error_message'] ?? ''),
            'started_at' => (string) ($body['started_at'] ?? ''),
            'finished_at' => (string) ($body['finished_at'] ?? ''),
            'duration_seconds' => $body['duration_seconds'] ?? null,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public function softCloseConversation(string $conversationId, int $userId, string $reason): array
    {
        $conversationId = trim($conversationId);
        $reason = trim(preg_replace('/\s+/', ' ', $reason) ?? $reason);
        if ($conversationId === '' || $userId <= 0) {
            return [
                'ok' => false,
                'http_status' => 400,
                'error' => 'invalid_request',
                'message' => __('Conversa ou usuário inválido.', 'glpiintegaglpi'),
            ];
        }

        if ($reason === '') {
            return [
                'ok' => false,
                'http_status' => 400,
                'error' => 'reason_required',
                'message' => __('Informe o motivo do encerramento administrativo.', 'glpiintegaglpi'),
            ];
        }

        if (!$this->pluginConfigService->isConfigured()) {
            return [
                'ok' => false,
                'http_status' => 503,
                'error' => 'not_configured',
                'message' => __('Integração não configurada.', 'glpiintegaglpi'),
            ];
        }

        try {
            $conversation = $this->getConversationRepository()->findByConversationId($conversationId);
        } catch (Throwable $exception) {
            error_log('[integaglpi][soft_close][lookup_error] ' . $exception->getMessage());

            return [
                'ok' => false,
                'http_status' => 500,
                'error' => 'lookup_failed',
                'message' => __('Não foi possível validar a conversa agora. Atualize a Central.', 'glpiintegaglpi'),
            ];
        }

        if ($conversation === null) {
            return [
                'ok' => false,
                'http_status' => 404,
                'error' => 'conversation_not_found',
                'message' => __('Conversa não encontrada.', 'glpiintegaglpi'),
            ];
        }

        if ($this->hasValidTicketId($conversation['glpi_ticket_id'] ?? null)) {
            return [
                'ok' => false,
                'http_status' => 409,
                'error' => 'conversation_has_ticket',
                'message' => __('Conversa vinculada a ticket GLPI não pode ser encerrada por esta ação.', 'glpiintegaglpi'),
            ];
        }

        try {
            $response = (new IntegrationServiceClient($this->pluginConfigService))
                ->softCloseConversation($conversationId, [
                    'reason' => $reason,
                    'glpi_user_id' => $userId,
                    'operator_name' => getUserName($userId),
                    'permission_validated' => true,
                ]);
        } catch (Throwable $exception) {
            error_log('[integaglpi][soft_close][error] ' . $exception->getMessage());

            return [
                'ok' => false,
                'http_status' => 502,
                'error' => 'integration_error',
                'message' => __('Não foi possível encerrar administrativamente a conversa agora.', 'glpiintegaglpi'),
            ];
        }

        $body = $response['body'];
        $status = (int) $response['status'];
        if (!$response['success']) {
            return [
                'ok' => false,
                'http_status' => $status > 0 ? $status : 502,
                'error' => (string) ($body['error_code'] ?? 'soft_close_failed'),
                'message' => (string) ($body['message'] ?? __('Falha ao encerrar administrativamente a conversa.', 'glpiintegaglpi')),
                'body' => $body,
            ];
        }

        return [
            'ok' => true,
            'http_status' => 200,
            'status' => (string) ($body['status'] ?? 'cancelled'),
            'message' => (string) ($body['message'] ?? __('Conversa encerrada administrativamente.', 'glpiintegaglpi')),
            'conversation_id' => (string) ($body['conversation_id'] ?? $conversationId),
            'previous_status' => (string) ($body['previous_status'] ?? ''),
            'new_status' => (string) ($body['new_status'] ?? 'cancelled'),
            'idempotent' => !empty($body['idempotent']),
            'body' => $body,
        ];
    }

    /**
     * @param array<string, mixed> $conversation
     * @return array<string, mixed>
     */
    private function buildEntitySelectionRecoveredSuccess(array $conversation): array
    {
        return [
            'ok' => true,
            'http_status' => 200,
            'message' => __('Chamado criado com sucesso.', 'glpiintegaglpi'),
            'conversation_id' => (string) ($conversation['conversation_id'] ?? ''),
            'glpi_ticket_id' => (int) ($conversation['glpi_ticket_id'] ?? 0),
            'recovered' => true,
        ];
    }

    /**
     * @return array<string, mixed>|null
     */
    private function recoverEntitySelectionSuccess(string $conversationId): ?array
    {
        try {
            $conversation = $this->getConversationRepository()->findByConversationId($conversationId);
        } catch (Throwable $exception) {
            error_log('[integaglpi][entity_selection][recover_error] ' . $exception->getMessage());

            return null;
        }

        if ($conversation !== null && $this->hasValidTicketId($conversation['glpi_ticket_id'] ?? null)) {
            return $this->buildEntitySelectionRecoveredSuccess($conversation);
        }

        return null;
    }

    /**
     * @return array<string, mixed>
     */
    public function claimConversation(string $conversationId, int $ticketId, int $userId): array
    {
        $conversationId = trim($conversationId);
        if ($conversationId === '' || $ticketId <= 0 || $userId <= 0) {
            return [
                'ok' => false,
                'http_status' => 400,
                'error' => 'invalid_request',
                'message' => __('Invalid conversation, ticket or technician.', 'glpiintegaglpi'),
            ];
        }

        if (!$this->pluginConfigService->isConfigured()) {
            return [
                'ok' => false,
                'http_status' => 500,
                'error' => 'not_configured',
                'message' => __('The external PostgreSQL connection is not configured.', 'glpiintegaglpi'),
            ];
        }

        try {
            $currentConversation = $this->getConversationRepository()->findBoundToTicket($ticketId, $conversationId);
            if ($currentConversation !== null) {
                $conversationStatus = strtolower(trim((string) ($currentConversation['conversation_status'] ?? '')));
                $conversationEntityId = (int) ($currentConversation['glpi_entity_id'] ?? 0);
                $effectiveEntityId = $conversationEntityId > 0
                    ? $conversationEntityId
                    : $this->syncConversationEntityFromTicketIfMissing($currentConversation, $ticketId, $userId);
                if ($effectiveEntityId <= 0) {
                    return [
                        'ok' => false,
                        'http_status' => 409,
                        'error' => 'entity_required_before_claim',
                        'message' => __('Defina uma entidade GLPI real antes de assumir este atendimento.', 'glpiintegaglpi'),
                    ];
                }
            }
            $previousAssignedUserId = (int) ($currentConversation['assigned_user_id'] ?? 0);
            if ($previousAssignedUserId === $userId) {
                return [
                    'ok' => true,
                    'http_status' => 200,
                    'status' => 'already_claimed_by_you',
                    'message' => __('Atendimento já estava assumido por você.', 'glpiintegaglpi'),
                    'technician_id' => $userId,
                    'technician_name' => getUserName($userId),
                    'glpi_assignment_warning' => false,
                ];
            }
            $claim = $this->getConversationRepository()->claimForAttendanceCenter(
                $ticketId,
                $conversationId,
                $userId
            );
        } catch (Throwable $exception) {
            error_log('[integaglpi][central][claim][error] ' . $exception->getMessage());

            return [
                'ok' => false,
                'http_status' => 500,
                'error' => 'claim_failed',
                'message' => __('Unable to claim this conversation right now.', 'glpiintegaglpi'),
            ];
        }

        if (($claim['status'] ?? '') === 'already_claimed') {
            $assignedUserId = (int) ($claim['assigned_user_id'] ?? 0);

            return [
                'ok' => false,
                'http_status' => 409,
                'error' => 'already_claimed',
                'message' => __('Conversa já assumida por outro técnico.', 'glpiintegaglpi'),
                'technician_id' => $assignedUserId,
                'technician_name' => $assignedUserId > 0 ? getUserName($assignedUserId) : '',
            ];
        }

        if (($claim['status'] ?? '') === 'closed') {
            return [
                'ok' => false,
                'http_status' => 409,
                'error' => 'conversation_closed',
                'message' => __('This WhatsApp conversation is closed.', 'glpiintegaglpi'),
            ];
        }

        if (($claim['status'] ?? '') !== 'claimed') {
            return [
                'ok' => false,
                'http_status' => 404,
                'error' => 'not_found',
                'message' => __('Conversation not found for this ticket.', 'glpiintegaglpi'),
            ];
        }

        $glpiAssigned = $this->getTicketRuntimeService()->assignTicketToTechnicianFromCentral($ticketId, $userId);
        if ($previousAssignedUserId !== $userId) {
            (new NotificationService($this->pluginConfigService))->sendTechnicianAssigned(
                $ticketId,
                $userId,
                $conversationId
            );
        }

        return [
            'ok' => true,
            'status' => 'claimed',
            'technician_id' => $userId,
            'technician_name' => getUserName($userId),
            'glpi_assignment_warning' => !$glpiAssigned,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public function replyConversation(
        string $conversationId,
        int $ticketId,
        int $userId,
        string $messageText,
        ?string $idempotencyKey = null
    ): array {
        $conversationId = trim($conversationId);
        $messageText = trim($messageText);

        if ($conversationId === '' || $ticketId <= 0 || $userId <= 0) {
            return [
                'ok' => false,
                'http_status' => 400,
                'error' => 'invalid_request',
                'message' => __('Invalid conversation, ticket or technician.', 'glpiintegaglpi'),
            ];
        }

        if ($messageText === '') {
            return [
                'ok' => false,
                'http_status' => 400,
                'error' => 'empty_message',
                'message' => __('A mensagem não pode ser vazia.', 'glpiintegaglpi'),
            ];
        }

        if ($this->textLength($messageText) > self::MAX_REPLY_LENGTH) {
            return [
                'ok' => false,
                'http_status' => 400,
                'error' => 'message_too_long',
                'message' => __('A mensagem deve ter no máximo 4096 caracteres.', 'glpiintegaglpi'),
            ];
        }

        if (!$this->pluginConfigService->isConfigured()) {
            return [
                'ok' => false,
                'http_status' => 500,
                'error' => 'not_configured',
                'message' => __('The external PostgreSQL connection is not configured.', 'glpiintegaglpi'),
            ];
        }

        try {
            $conversation = $this->getConversationRepository()->findBoundToTicket($ticketId, $conversationId);
        } catch (Throwable $exception) {
            error_log('[integaglpi][central][reply][lookup_error] ' . json_encode([
                'ticket_id' => $ticketId,
                'conversation_id' => $conversationId,
                'user_id' => $userId,
                'message' => $exception->getMessage(),
            ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

            return [
                'ok' => false,
                'http_status' => 500,
                'error' => 'lookup_failed',
                'message' => __('Unable to validate this conversation right now.', 'glpiintegaglpi'),
            ];
        }

        if ($conversation === null) {
            return [
                'ok' => false,
                'http_status' => 404,
                'error' => 'not_found',
                'message' => __('Conversation not found for this ticket.', 'glpiintegaglpi'),
            ];
        }

        $conversationStatus = strtolower(trim((string) ($conversation['conversation_status'] ?? '')));
        $runtimeStatus = strtolower(trim((string) ($conversation['runtime_status'] ?? '')));

        if ($conversationStatus === 'closed' || $runtimeStatus === 'closed') {
            return [
                'ok' => false,
                'http_status' => 409,
                'error' => 'conversation_closed',
                'message' => __('Conversa encerrada. Atualize a Central.', 'glpiintegaglpi'),
            ];
        }

        if ($conversationStatus !== 'open') {
            return [
                'ok' => false,
                'http_status' => 409,
                'error' => 'conversation_not_open',
                'message' => __('A conversa não está aberta para resposta.', 'glpiintegaglpi'),
            ];
        }

        $effectiveEntityId = $this->syncConversationEntityFromTicketIfMissing($conversation, $ticketId, $userId);
        if ($effectiveEntityId <= 0) {
            return [
                'ok' => false,
                'http_status' => 409,
                'error' => 'entity_required_before_reply',
                'message' => __('Defina uma entidade GLPI real antes de responder por WhatsApp.', 'glpiintegaglpi'),
            ];
        }

        if ((int) ($conversation['assigned_user_id'] ?? 0) !== $userId) {
            return [
                'ok' => false,
                'http_status' => 403,
                'error' => 'not_owner',
                'message' => __('Assuma o atendimento antes de responder.', 'glpiintegaglpi'),
            ];
        }

        $payload = [
            'ticket_id' => $ticketId,
            'conversation_id' => $conversationId,
            'text' => $messageText,
            'message_type' => 'text',
            'glpi_user_id' => $userId,
            'idempotency_key' => $this->normalizeIdempotencyKey($idempotencyKey),
        ];

        try {
            $result = (new IntegrationServiceClient())->sendOutbound($payload);
        } catch (Throwable $exception) {
            error_log('[integaglpi][central][reply][send_error] ' . json_encode([
                'ticket_id' => $ticketId,
                'conversation_id' => $conversationId,
                'user_id' => $userId,
                'message' => $exception->getMessage(),
            ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

            return [
                'ok' => false,
                'http_status' => 500,
                'error' => 'send_failed',
                'message' => __('Unable to send this WhatsApp message right now.', 'glpiintegaglpi'),
            ];
        }

        if (!$result['success']) {
            $body = $result['body'];
            $status = (int) ($result['status'] ?? 502);
            $httpStatus = $status === 409 ? 409 : 502;

            return [
                'ok' => false,
                'http_status' => $httpStatus,
                'error' => (string) ($body['error_code'] ?? 'upstream_error'),
                'message' => (string) ($body['message'] ?? __('Failed to send WhatsApp message.', 'glpiintegaglpi')),
                'outbound_status' => (string) ($body['status'] ?? 'failed'),
            ];
        }

        return [
            'ok' => true,
            'message' => __('Mensagem enviada.', 'glpiintegaglpi'),
            'outbound_status' => (string) ($result['body']['status'] ?? 'sent'),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public function transferConversation(
        string $conversationId,
        int $ticketId,
        int $currentUserId,
        int $newTechnicianId
    ): array {
        $conversationId = trim($conversationId);
        if ($conversationId === '' || $ticketId <= 0 || $currentUserId <= 0 || $newTechnicianId <= 0) {
            return [
                'ok' => false,
                'http_status' => 400,
                'error' => 'invalid_request',
                'message' => __('Invalid conversation, ticket or technician.', 'glpiintegaglpi'),
            ];
        }

        if ($currentUserId === $newTechnicianId) {
            return [
                'ok' => false,
                'http_status' => 400,
                'error' => 'same_technician',
                'message' => __('Select a different technician to transfer this conversation.', 'glpiintegaglpi'),
            ];
        }

        if (!$this->isActiveGlpiUser($newTechnicianId)) {
            return [
                'ok' => false,
                'http_status' => 400,
                'error' => 'invalid_technician',
                'message' => __('Selected technician is invalid or inactive.', 'glpiintegaglpi'),
            ];
        }

        if (!$this->pluginConfigService->isConfigured()) {
            return [
                'ok' => false,
                'http_status' => 500,
                'error' => 'not_configured',
                'message' => __('The external PostgreSQL connection is not configured.', 'glpiintegaglpi'),
            ];
        }

        try {
            $transfer = $this->getConversationRepository()->transferAssignedUser(
                $ticketId,
                $conversationId,
                $currentUserId,
                $newTechnicianId
            );
        } catch (Throwable $exception) {
            error_log('[integaglpi][central][transfer][error] ' . json_encode([
                'ticket_id' => $ticketId,
                'conversation_id' => $conversationId,
                'current_user_id' => $currentUserId,
                'new_technician_id' => $newTechnicianId,
                'message' => $exception->getMessage(),
            ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

            return [
                'ok' => false,
                'http_status' => 500,
                'error' => 'transfer_failed',
                'message' => __('Unable to transfer this conversation right now.', 'glpiintegaglpi'),
            ];
        }

        if (($transfer['status'] ?? '') === 'closed') {
            $this->logTransfer('closed', $ticketId, $conversationId, $currentUserId, $newTechnicianId);

            return [
                'ok' => false,
                'http_status' => 409,
                'error' => 'conversation_closed',
                'message' => __('Conversa encerrada. Atualize a Central.', 'glpiintegaglpi'),
            ];
        }

        if (($transfer['status'] ?? '') === 'not_owner') {
            $this->logTransfer('not_owner', $ticketId, $conversationId, $currentUserId, $newTechnicianId);

            return [
                'ok' => false,
                'http_status' => 403,
                'error' => 'not_owner',
                'message' => __('Only the current technician can transfer this conversation.', 'glpiintegaglpi'),
                'technician_id' => (int) ($transfer['assigned_user_id'] ?? 0),
            ];
        }

        if (($transfer['status'] ?? '') !== 'transferred') {
            $this->logTransfer('not_found', $ticketId, $conversationId, $currentUserId, $newTechnicianId);

            return [
                'ok' => false,
                'http_status' => 404,
                'error' => 'not_found',
                'message' => __('Conversation not found for this ticket.', 'glpiintegaglpi'),
            ];
        }

        $glpiAssigned = $this->getTicketRuntimeService()->assignTicketToTechnicianFromTransfer(
            $ticketId,
            $newTechnicianId,
            $currentUserId
        );
        (new NotificationService($this->pluginConfigService))->sendTicketTransferred(
            $ticketId,
            $conversationId,
            $newTechnicianId
        );
        $this->logTransfer('transferred', $ticketId, $conversationId, $currentUserId, $newTechnicianId);

        return [
            'ok' => true,
            'status' => 'transferred',
            'technician_id' => $newTechnicianId,
            'technician_name' => getUserName($newTechnicianId),
            'glpi_assignment_warning' => !$glpiAssigned,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public function solveConversation(string $conversationId, int $ticketId, int $userId): array
    {
        $conversationId = trim($conversationId);
        if ($conversationId === '' || $ticketId <= 0 || $userId <= 0) {
            return [
                'ok' => false,
                'http_status' => 400,
                'error' => 'invalid_request',
                'message' => __('Invalid conversation, ticket or technician.', 'glpiintegaglpi'),
            ];
        }

        if (!$this->pluginConfigService->isConfigured()) {
            return [
                'ok' => false,
                'http_status' => 500,
                'error' => 'not_configured',
                'message' => __('The external PostgreSQL connection is not configured.', 'glpiintegaglpi'),
            ];
        }

        try {
            $conversation = $this->getConversationRepository()->findBoundToTicket($ticketId, $conversationId);
        } catch (Throwable $exception) {
            error_log('[integaglpi][central][solve][lookup_error] ' . json_encode([
                'ticket_id' => $ticketId,
                'conversation_id' => $conversationId,
                'user_id' => $userId,
                'message' => $exception->getMessage(),
            ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

            return [
                'ok' => false,
                'http_status' => 500,
                'error' => 'lookup_failed',
                'message' => __('Unable to validate this conversation right now.', 'glpiintegaglpi'),
            ];
        }

        if ($conversation === null) {
            return [
                'ok' => false,
                'http_status' => 404,
                'error' => 'not_found',
                'message' => __('Conversation not found for this ticket.', 'glpiintegaglpi'),
            ];
        }

        $conversationStatus = strtolower(trim((string) ($conversation['conversation_status'] ?? '')));
        $runtimeStatus = strtolower(trim((string) ($conversation['runtime_status'] ?? '')));

        if ($conversationStatus === 'closed' || $runtimeStatus === 'closed') {
            return [
                'ok' => false,
                'http_status' => 409,
                'error' => 'conversation_closed',
                'message' => __('Conversa encerrada. Atualize a Central.', 'glpiintegaglpi'),
            ];
        }

        if ((int) ($conversation['assigned_user_id'] ?? 0) !== $userId) {
            return [
                'ok' => false,
                'http_status' => 403,
                'error' => 'not_owner',
                'message' => __('Only the current technician can solve this conversation.', 'glpiintegaglpi'),
            ];
        }

        try {
            $solutionResult = $this->solveGlpiTicket($ticketId);
        } catch (Throwable $exception) {
            error_log('[integaglpi][central][solve][error] ' . json_encode([
                'ticket_id' => $ticketId,
                'conversation_id' => $conversationId,
                'user_id' => $userId,
                'message' => $exception->getMessage(),
            ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

            return [
                'ok' => false,
                'http_status' => 500,
                'error' => 'glpi_solution_failed',
                'message' => $this->friendlySolveExceptionMessage($exception),
            ];
        }

        $notificationWarning = '';
        if (($solutionResult['status'] ?? '') !== 'already_solved') {
            try {
                // Idempotency key MUST match NotificationService::notifyTicketSolved
                // (notify_ticket_solved_<ticketId>_<solutionId>). The ITEM_ADD ITILSolution
                // hook fires concurrently with this Central call and reserves the same key
                // first; whichever path wins, the other is deduped at the repository level
                // so the customer receives a single ticket_solved message.
                // Phase: integaglpi_ops_console_claim_ui_messaging_stabilization_001.
                $resolvedSolutionId = (int) ($solutionResult['solution_id'] ?? 0);
                $solveIdempotencyKey = $resolvedSolutionId > 0
                    ? 'notify_ticket_solved_' . $ticketId . '_' . $resolvedSolutionId
                    : 'notify_ticket_solved_' . $ticketId;
                $notification = (new IntegrationServiceClient($this->pluginConfigService))
                    ->sendTicketSolvedNotification([
                        'ticket_id' => $ticketId,
                        'conversation_id' => $conversationId,
                        'glpi_user_id' => $userId,
                        'idempotency_key' => $solveIdempotencyKey,
                        'solution_id' => $resolvedSolutionId > 0 ? $resolvedSolutionId : null,
                        'solution_content' => 'Ticket resolvido via Central WhatsApp.',
                        'solution_status' => (int) ($solutionResult['ticket_status'] ?? CommonITILObject::SOLVED),
                    ]);
                if (!$notification['success']) {
                    $notificationWarning = __('Ticket solucionado no GLPI, mas houve falha ao avisar o cliente pelo WhatsApp.', 'glpiintegaglpi');
                }
            } catch (Throwable $exception) {
                error_log('[integaglpi][central][solve][whatsapp_warning] ' . json_encode([
                    'ticket_id' => $ticketId,
                    'conversation_id' => $conversationId,
                    'user_id' => $userId,
                    'message' => $exception->getMessage(),
                ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
                $notificationWarning = __('Ticket solucionado no GLPI, mas houve falha ao avisar o cliente pelo WhatsApp.', 'glpiintegaglpi');
            }
        }

        if (($solutionResult['status'] ?? '') === 'status_update_failed') {
            return [
                'ok' => true,
                'http_status' => 207,
                'status' => 'solution_created_status_update_failed',
                'message' => __('Solução criada, mas não foi possível atualizar o status do ticket por permissão GLPI.', 'glpiintegaglpi'),
                'warning' => $notificationWarning,
            ];
        }

        if ($notificationWarning !== '') {
            return [
                'ok' => true,
                'http_status' => 207,
                'status' => 'solved_whatsapp_failed',
                'message' => $notificationWarning,
            ];
        }

        try {
            $this->getConversationRepository()->markFirstResponseIfMissing($conversationId);
        } catch (Throwable $exception) {
            error_log('[integaglpi][sla][first_response_update_failed] ' . $exception->getMessage());
        }

        return [
            'ok' => true,
            'status' => (string) ($solutionResult['status'] ?? 'solved'),
            'message' => ($solutionResult['status'] ?? '') === 'already_solved'
                ? __('Chamado já estava solucionado ou fechado.', 'glpiintegaglpi')
                : __('Chamado solucionado.', 'glpiintegaglpi'),
        ];
    }

    /**
     * @return list<array{id: int, name: string}>
     */
    private function loadGlpiEntityOptions(): array
    {
        global $DB;

        try {
            if (!isset($DB) || !is_object($DB) || !$DB->tableExists('glpi_entities')) {
                return [];
            }

            $criteria = [
                'SELECT' => ['id', 'name', 'completename'],
                'FROM' => 'glpi_entities',
                'ORDER' => ['completename', 'name', 'id'],
                'LIMIT' => 250,
            ];

            $activeEntityIds = $this->getActiveEntityIds();
            if ($activeEntityIds !== []) {
                $criteria['WHERE'] = ['id' => $activeEntityIds];
            }

            $entities = [];
            foreach ($DB->request($criteria) as $row) {
                $id = (int) ($row['id'] ?? 0);
                if ($id <= 0) {
                    continue;
                }
                if (!$this->canUseEntity($id)) {
                    continue;
                }

                $label = trim((string) ($row['completename'] ?? ''));
                if ($label === '') {
                    $label = trim((string) ($row['name'] ?? ''));
                }
                if ($label === '') {
                    $label = 'Entidade #' . $id;
                }

                $entities[] = [
                    'id' => $id,
                    'name' => $label,
                ];
            }

            return $entities;
        } catch (Throwable $exception) {
            error_log('[integaglpi][central][entities][load_error] ' . $exception->getMessage());
            return [];
        }
    }

    /**
     * @return array{id: int, name: string}|null
     */
    private function findGlpiEntityOption(int $entityId): ?array
    {
        foreach ($this->loadGlpiEntityOptions() as $entity) {
            if ((int) $entity['id'] === $entityId) {
                return $entity;
            }
        }

        return null;
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

        return [];
    }

    private function canUseEntity(int $entityId): bool
    {
        if ($entityId <= 0 || !class_exists('\Session')) {
            return false;
        }

        try {
            if (method_exists('\Session', 'haveAccessToEntity')) {
                return \Session::haveAccessToEntity($entityId);
            }
        } catch (Throwable) {
            return false;
        }

        $entities = $_SESSION['glpiactiveentities'] ?? [];
        if (!is_array($entities)) {
            return false;
        }

        return in_array($entityId, array_map('intval', $entities), true);
    }

    /**
     * @return array<string, mixed>
     */
    public function getConversationMessages(
        string $conversationId,
        int $ticketId,
        ?string $afterCreatedAt,
        ?string $afterId,
        int $limit
    ): array {
        $conversationId = trim($conversationId);
        if ($conversationId === '') {
            return [
                'ok' => false,
                'http_status' => 400,
                'error' => 'invalid_request',
                'message' => __('Conversa ou chamado inválido.', 'glpiintegaglpi'),
            ];
        }

        if (!$this->pluginConfigService->isConfigured()) {
            return [
                'ok' => false,
                'http_status' => 500,
                'error' => 'not_configured',
                'message' => __('The external PostgreSQL connection is not configured.', 'glpiintegaglpi'),
            ];
        }

        try {
            $conversation = $ticketId > 0
                ? $this->getConversationRepository()->findBoundToTicket($ticketId, $conversationId)
                : $this->getConversationRepository()->findByConversationId($conversationId);
        if ($conversation === null) {
            return [
                'ok' => false,
                'http_status' => 404,
                'error' => 'not_found',
                'message' => __('Conversa não encontrada para este identificador.', 'glpiintegaglpi'),
            ];
        }

            $conversationStatus = trim((string) ($conversation['conversation_status'] ?? ''));
            if ($ticketId <= 0 && !in_array($conversationStatus, self::PRE_TICKET_STATUSES, true)) {
                return [
                    'ok' => false,
                    'http_status' => 409,
                    'error' => 'ticket_required',
                    'message' => __('This conversation already requires a valid ticket.', 'glpiintegaglpi'),
                ];
            }

            $messages = $this->getMessageRepository()->findNewerByConversationId(
                $conversationId,
                $afterCreatedAt,
                $afterId,
                max(1, min(50, $limit))
            );

            return [
                'ok' => true,
                'messages' => $this->decorateMessages($messages),
                'refreshed_at' => gmdate('c'),
            ];
        } catch (Throwable $exception) {
            error_log('[integaglpi][central][messages][error] ' . json_encode([
                'ticket_id' => $ticketId,
                'conversation_id' => $conversationId,
                'message' => $exception->getMessage(),
            ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

            return [
                'ok' => false,
                'http_status' => 500,
                'error' => 'messages_failed',
                'message' => __('Unable to load WhatsApp messages right now.', 'glpiintegaglpi'),
            ];
        }
    }

    /**
     * @param array<string, mixed> $query
     * @return array<string, mixed>
     */
    private function normalizeFilters(array $query): array
    {
        $status = trim((string) ($query['status'] ?? ''));
        if (!in_array($status, self::ALLOWED_STATUSES, true)) {
            $status = '';
        }

        $queueId = null;
        if (isset($query['queue_id']) && ctype_digit((string) $query['queue_id'])) {
            $candidateQueueId = (int) $query['queue_id'];
            $queueId = $candidateQueueId > 0 ? $candidateQueueId : null;
        }

        $search = trim((string) ($query['search'] ?? ''));
        if (strlen($search) > 80) {
            $search = substr($search, 0, 80);
        }

        $technicianId = 0;
        if (isset($query['technician_id']) && ctype_digit((string) $query['technician_id'])) {
            $technicianId = max(0, (int) $query['technician_id']);
        }

        // Phase: integaglpi_ops_console_claim_ui_messaging_stabilization_001.
        // mine_only restricts Central rows to conversations whose
        // assigned_user_id matches the logged-in technician (i.e. those
        // claimed/transferred to them). Default = on. Opt-out is explicit
        // (?mine_only=0) so technicians can browse the full queue when
        // searching for a conversation to claim or transfer.
        $mineOnly = true;
        if (array_key_exists('mine_only', $query)) {
            $rawMineOnly = strtolower(trim((string) ($query['mine_only'] ?? '')));
            if ($rawMineOnly === '0' || $rawMineOnly === 'false' || $rawMineOnly === 'no' || $rawMineOnly === 'off') {
                $mineOnly = false;
            }
        }
        $currentUserId = $this->resolveCurrentUserId();

        $entityId = 0;
        if (isset($query['entity_id']) && ctype_digit((string) $query['entity_id'])) {
            $entityId = max(0, (int) $query['entity_id']);
        }

        $windowStatus = $this->normalizeChoice((string) ($query['window_status'] ?? ''), ['open', 'closed']);
        $inactivityFilter = $this->normalizeChoice((string) ($query['inactivity'] ?? ''), ['attention', 'sent', 'skipped']);
        $deliveryFilter = $this->normalizeChoice((string) ($query['delivery'] ?? ''), ['failed', 'pending', 'sent', 'delivered', 'read']);
        $operationalState = $this->normalizeChoice((string) ($query['operational_state'] ?? ''), [
            'pre_ticket',
            'awaiting_entity',
            'processing',
            'ambiguous_reconciliation',
            'delivery_failed',
            'inactivity_attention',
            'risk',
        ]);

        return [
            'status' => $status,
            'queue_id' => $queueId,
            'search' => $search,
            'technician_id' => $technicianId,
            'entity_id' => $entityId,
            'window_status' => $windowStatus,
            'inactivity' => $inactivityFilter,
            'delivery' => $deliveryFilter,
            'operational_state' => $operationalState,
            'mine_only' => $mineOnly,
            'current_user_id' => $currentUserId,
        ];
    }

    /**
     * Resolves the logged-in GLPI user id once per request. Falls back to 0 when
     * not running inside a GLPI session (e.g. background tests).
     *
     * Phase: integaglpi_ops_console_claim_ui_messaging_stabilization_001.
     */
    private function resolveCurrentUserId(): int
    {
        try {
            if (class_exists('\GlpiPlugin\Integaglpi\Plugin')
                && method_exists('\GlpiPlugin\Integaglpi\Plugin', 'getCurrentUserId')) {
                return max(0, (int) \GlpiPlugin\Integaglpi\Plugin::getCurrentUserId());
            }
            if (class_exists('\Session') && method_exists('\Session', 'getLoginUserID')) {
                return max(0, (int) \Session::getLoginUserID());
            }
        } catch (Throwable) {
            return 0;
        }

        return 0;
    }

    /**
     * @param array<string, mixed> $query
     * @return array{page: int, limit: int, offset: int}
     */
    private function normalizePagination(array $query): array
    {
        $page = 1;
        if (isset($query['page']) && ctype_digit((string) $query['page'])) {
            $page = max(1, (int) $query['page']);
        }

        $limit = self::DEFAULT_LIMIT;
        if (isset($query['limit']) && ctype_digit((string) $query['limit'])) {
            $limit = (int) $query['limit'];
        }
        $limit = min(self::MAX_LIMIT, max(25, $limit));

        return [
            'page' => $page,
            'limit' => $limit,
            'offset' => ($page - 1) * $limit,
        ];
    }

    /**
     * @param list<array<string, mixed>> $rows
     * @return list<array<string, mixed>>
     */
    private function decorateRows(array $rows): array
    {
        return array_map(function (array $row): array {
            $assignedUserId = isset($row['assigned_user_id']) ? (int) $row['assigned_user_id'] : 0;
            $conversationStatus = trim((string) ($row['conversation_status'] ?? ''));
            $runtimeStatus = trim((string) ($row['runtime_status'] ?? ''));
            $row['effective_status'] = $conversationStatus !== ''
                ? $conversationStatus
                : ($runtimeStatus !== '' ? $runtimeStatus : 'open');
            $row['assigned_user_label'] = $assignedUserId > 0 ? getUserName($assignedUserId) : '';
            $row['activity_at'] = (string) (
                $row['activity_at']
                ?? $row['last_message_at']
                ?? $row['conversation_updated_at']
                ?? ''
            );
            $memoryEntityId = isset($row['memory_entity_id']) ? (int) $row['memory_entity_id'] : 0;
            $row['memory_entity_id'] = $memoryEntityId;
            $row['memory_entity_name'] = $memoryEntityId > 0
                ? trim((string) ($row['memory_entity_name'] ?? ''))
                : '';
            $ticketId = $row['glpi_ticket_id'] ?? null;
            $hasTicket = $this->hasValidTicketId($ticketId);
            $row['is_pre_ticket'] = !$hasTicket;
            $row['ticket_label'] = $hasTicket ? '#' . (int) $ticketId : __('Pré-Ticket', 'glpiintegaglpi');
            $row['masked_phone'] = $this->maskPhone((string) ($row['phone_e164'] ?? ''));
            $row['entity_label'] = $this->resolveEntityLabel($row);
            $profileComplete = self::isProfileCollectionComplete($row['profile_collection_state'] ?? null);
            $row['profile_collection_complete'] = $profileComplete;
            $row['status_label'] = $this->statusLabel($row['effective_status']);
            $row['stalled_seconds'] = $this->calculateStalledSeconds((string) ($row['activity_at'] ?? ''));
            $row['stalled_label'] = $this->formatDuration((int) ($row['stalled_seconds'] ?? 0));
            $row['contact_profile_snapshot'] = $this->decodeProfileSnapshot($row['profile_snapshot_json'] ?? null);
            $row['profile_context'] = $this->buildProfileContext($row);
            $awaitingProfileReturn = !empty($row['profile_context']['awaiting_return']);
            $row['next_action'] = $awaitingProfileReturn
                ? __('Aguardando retorno do cliente para completar o pré-ticket', 'glpiintegaglpi')
                : $this->nextAction($row['effective_status'], $hasTicket, $profileComplete);
            $row['can_soft_close'] = self::isPotentialSoftCloseEligible($row);
            $row['entity_attempt_status_label'] = $this->entityAttemptStatusLabel(
                (string) ($row['entity_attempt_status'] ?? ''),
                (string) ($row['entity_attempt_error_message'] ?? '')
            );
            $row['entity_attempt_error_sanitized'] = $this->sanitizeEntityAttemptError(
                (string) ($row['entity_attempt_error_message'] ?? '')
            );
            $row['inactivity_status_label'] = $this->inactivityStatusLabel(
                (string) ($row['inactivity_event_status'] ?? ''),
                (string) ($row['inactivity_tracking_status'] ?? '')
            );
            $row['inactivity_next_action'] = $this->inactivityNextAction(
                (string) ($row['inactivity_event_status'] ?? ''),
                (string) ($row['inactivity_event_reason'] ?? ''),
                (string) ($row['inactivity_tracking_skip_reason'] ?? '')
            );
            $row['inactivity_last_error_sanitized'] = $this->sanitizeInactivityError(
                (string) ($row['inactivity_meta_error_message_sanitized'] ?? ''),
                (string) ($row['inactivity_event_reason'] ?? '')
            );
            $row['whatsapp_window'] = $this->buildWhatsappWindow((string) ($row['last_inbound_at'] ?? ''));
            $row['last_delivery_status_label'] = self::deliveryStatusLabel((string) ($row['last_delivery_status'] ?? ''));
            $row['last_delivery_error_sanitized'] = $this->sanitizeInactivityError(
                (string) ($row['last_delivery_error_message_sanitized'] ?? ''),
                ''
            );
            $row['business_hours_label'] = $this->buildBusinessHoursLabel();
            $row['operational_state_label'] = $this->operationalStateLabel($row);
            $row['sla_context'] = $this->buildSlaContext($row);
            $row['risk_badges'] = $this->buildRiskBadges($row);
            $row['memory_entity_source_label'] = $this->resolveEntitySourceLabel($row);
            $row['activity_at'] = $this->formatDisplayTimestamp($row['activity_at'] ?? null);
            $row['last_message_at'] = $this->formatDisplayTimestamp($row['last_message_at'] ?? null);
            $row['last_inbound_at'] = $this->formatDisplayTimestamp($row['last_inbound_at'] ?? null);
            $row['last_outbound_at'] = $this->formatDisplayTimestamp($row['last_outbound_at'] ?? null);
            $row['inactivity_last_checked_at'] = $this->formatDisplayTimestamp($row['inactivity_last_checked_at'] ?? null);
            $row['last_message_preview'] = trim((string) ($row['last_message_preview'] ?? ''));
            $row = $this->applyPiiGuard($row, $assignedUserId);

            return $row;
        }, $rows);
    }

    /**
     * @param list<array<string, mixed>> $rows
     * @return list<array<string, mixed>>
     */
    private function filterAndMarkDeletedTicketRows(array $rows): array
    {
        $visibleRows = [];
        foreach ($rows as $row) {
            $ticketId = (int) ($row['glpi_ticket_id'] ?? 0);
            if ($ticketId <= 0) {
                $visibleRows[] = $row;
                continue;
            }

            $reason = $this->detectUnavailableGlpiTicketReason($ticketId);
            if ($reason === null) {
                $visibleRows[] = $row;
                continue;
            }

            $this->markConversationOrphaned($row, $reason);
        }

        return $visibleRows;
    }

    private function detectUnavailableGlpiTicketReason(int $ticketId): ?string
    {
        $ticket = new \Ticket();
        if (!$ticket->getFromDB($ticketId)) {
            return 'glpi_ticket_missing';
        }

        return (int) ($ticket->fields['is_deleted'] ?? 0) !== 0
            ? 'glpi_ticket_deleted'
            : null;
    }

    /**
     * @param array<string, mixed> $row
     */
    private function markConversationOrphaned(array $row, string $reason): void
    {
        $conversationId = trim((string) ($row['conversation_id'] ?? ''));
        $ticketId = (int) ($row['glpi_ticket_id'] ?? 0);
        if ($conversationId === '' || $ticketId <= 0) {
            return;
        }

        try {
            $pdo = $this->getPdo();
            $startedTransaction = !$pdo->inTransaction();
            if ($startedTransaction) {
                $pdo->beginTransaction();
            }

            $statePayload = json_encode([
                'orphan_reason' => $reason,
                'orphaned_at' => gmdate('c'),
                'orphan_source' => 'PluginAttendanceCenter',
            ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
            if ($statePayload === false) {
                $statePayload = '{"orphan_reason":"glpi_ticket_missing"}';
            }

            $conversationUpdate = $pdo->prepare(
                "UPDATE glpi_plugin_integaglpi_conversations
                 SET
                    status = 'closed',
                    profile_collection_state = COALESCE(profile_collection_state, '{}'::jsonb) || :state_payload::jsonb,
                    updated_at = NOW()
                 WHERE id = :conversation_id
                   AND glpi_ticket_id = :ticket_id
                   AND status <> 'closed'"
            );
            $conversationUpdate->execute([
                ':state_payload' => $statePayload,
                ':conversation_id' => $conversationId,
                ':ticket_id' => $ticketId,
            ]);
            $changed = $conversationUpdate->rowCount() > 0;

            if ($this->externalTableExists('glpi_plugin_integaglpi_conversation_runtime')) {
                $runtimeUpdate = $pdo->prepare(
                    "UPDATE glpi_plugin_integaglpi_conversation_runtime
                     SET
                        status = 'closed',
                        closed_at = COALESCE(closed_at, NOW()),
                        updated_at = NOW()
                     WHERE conversation_id = :conversation_id
                       AND ticket_id = :ticket_id
                       AND status <> 'closed'"
                );
                $runtimeUpdate->execute([
                    ':conversation_id' => $conversationId,
                    ':ticket_id' => $ticketId,
                ]);
                $changed = $changed || $runtimeUpdate->rowCount() > 0;
            }

            if ($changed) {
                $this->orphanedConversationCleanupCount++;
                $this->insertOrphanConversationAudit($row, $reason, 'ORPHAN_CONVERSATION_DETECTED');
                $this->insertOrphanConversationAudit($row, $reason, 'MANUAL_TICKET_LINK_ORPHANED');
            }

            if ($startedTransaction) {
                $pdo->commit();
            }
        } catch (Throwable $exception) {
            if (isset($pdo) && $pdo instanceof PDO && $pdo->inTransaction()) {
                $pdo->rollBack();
            }
            error_log('[integaglpi][central][orphan_conversation] ticket_id=' . $ticketId
                . ' conversation_id=' . $conversationId . ' ' . $exception->getMessage());
        }
    }

    /**
     * @param array<string, mixed> $row
     */
    private function insertOrphanConversationAudit(array $row, string $reason, string $eventType): void
    {
        if (!$this->externalTableExists('glpi_plugin_integaglpi_audit_events')) {
            return;
        }

        $conversationId = trim((string) ($row['conversation_id'] ?? ''));
        $ticketId = (int) ($row['glpi_ticket_id'] ?? 0);
        $payload = json_encode([
            'glpi_ticket_id' => $ticketId,
            'conversation_id' => $conversationId,
            'phone_masked' => $this->maskPhone((string) ($row['phone_e164'] ?? '')),
            'reason' => $reason,
            'previous_conversation_status' => (string) ($row['conversation_status'] ?? ''),
            'previous_runtime_status' => (string) ($row['runtime_status'] ?? ''),
        ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        if ($payload === false) {
            $payload = '{"reason":"glpi_ticket_missing"}';
        }

        $statement = $this->getPdo()->prepare(
            "INSERT INTO glpi_plugin_integaglpi_audit_events (
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
                :event_type,
                'ignored',
                'warning',
                'PluginAttendanceCenter',
                :payload_json::jsonb,
                NOW()
            )"
        );
        $statement->execute([
            ':correlation_id' => 'orphan_conversation:' . $conversationId . ':' . $eventType,
            ':ticket_id' => $ticketId,
            ':conversation_id' => $conversationId,
            ':event_type' => $eventType,
            ':payload_json' => $payload,
        ]);
    }

    /**
     * @param list<int> $userIds
     * @return list<array{id: int, name: string}>
     */
    private function buildTechnicianOptions(array $userIds): array
    {
        $options = [];
        foreach ($userIds as $userId) {
            if ($userId <= 0) {
                continue;
            }
            $options[] = [
                'id' => $userId,
                'name' => getUserName($userId),
            ];
        }

        return $options;
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function loadServiceCatalogOptions(): array
    {
        try {
            if (!$this->externalTableExists('glpi_plugin_integaglpi_service_catalog')) {
                return [];
            }

            $hasQueues = $this->externalTableExists('glpi_plugin_integaglpi_queues');
            $sql = $hasQueues
                ? "SELECT sc.id,
                         sc.service_key,
                         sc.name,
                         sc.routing_queue_id,
                         sc.glpi_entity_id,
                         sc.required_fields_json::text AS required_fields_json,
                         q.name AS queue_name
                   FROM glpi_plugin_integaglpi_service_catalog sc
                   LEFT JOIN glpi_plugin_integaglpi_queues q ON q.id = sc.routing_queue_id
                   WHERE sc.is_active = TRUE
                   ORDER BY sc.name ASC
                   LIMIT 200"
                : "SELECT sc.id,
                         sc.service_key,
                         sc.name,
                         sc.routing_queue_id,
                         sc.glpi_entity_id,
                         sc.required_fields_json::text AS required_fields_json,
                         NULL::text AS queue_name
                   FROM glpi_plugin_integaglpi_service_catalog sc
                   WHERE sc.is_active = TRUE
                   ORDER BY sc.name ASC
                   LIMIT 200";

            $statement = $this->getPdo()->query($sql);
            $rows = $statement ? ($statement->fetchAll(PDO::FETCH_ASSOC) ?: []) : [];

            return array_values(array_map(static function (array $row): array {
                $requiredFields = json_decode((string) ($row['required_fields_json'] ?? '[]'), true);

                return [
                    'id' => (int) ($row['id'] ?? 0),
                    'service_key' => (string) ($row['service_key'] ?? ''),
                    'name' => (string) ($row['name'] ?? ''),
                    'routing_queue_id' => isset($row['routing_queue_id']) ? (int) $row['routing_queue_id'] : 0,
                    'glpi_entity_id' => isset($row['glpi_entity_id']) ? (int) $row['glpi_entity_id'] : 0,
                    'queue_name' => (string) ($row['queue_name'] ?? ''),
                    'required_fields' => is_array($requiredFields) ? $requiredFields : [],
                ];
            }, $rows));
        } catch (Throwable $exception) {
            error_log('[integaglpi][service_catalog][central_options] ' . $exception->getMessage());
            return [];
        }
    }

    /**
     * @return array{ok: bool, message: string}
     */
    private function validateServiceChecklist(int $serviceCatalogId, string $serviceChecklistJson): array
    {
        if ($serviceCatalogId <= 0) {
            return ['ok' => true, 'message' => ''];
        }

        try {
            if (!$this->externalTableExists('glpi_plugin_integaglpi_service_catalog')) {
                return [
                    'ok' => false,
                    'message' => __('Catálogo de serviços indisponível para validar checklist.', 'glpiintegaglpi'),
                ];
            }

            $statement = $this->getPdo()->prepare(
                "SELECT required_fields_json::text AS required_fields_json
                 FROM glpi_plugin_integaglpi_service_catalog
                 WHERE id = :id AND is_active = TRUE
                 LIMIT 1"
            );
            $statement->execute([':id' => $serviceCatalogId]);
            $row = $statement->fetch(PDO::FETCH_ASSOC);
            if (!is_array($row)) {
                return [
                    'ok' => false,
                    'message' => __('Serviço selecionado não está ativo no catálogo.', 'glpiintegaglpi'),
                ];
            }

            $requiredFields = json_decode((string) ($row['required_fields_json'] ?? '[]'), true);
            if (!is_array($requiredFields) || $requiredFields === []) {
                return ['ok' => true, 'message' => ''];
            }

            $answers = [];
            $trimmedChecklist = trim($serviceChecklistJson);
            if ($trimmedChecklist !== '') {
                $decodedAnswers = json_decode($trimmedChecklist, true);
                if (!is_array($decodedAnswers)) {
                    return [
                        'ok' => false,
                        'message' => __('Checklist obrigatório inválido. Use JSON simples com os campos exigidos.', 'glpiintegaglpi'),
                    ];
                }
                $answers = $decodedAnswers;
            }

            $missing = [];
            foreach ($requiredFields as $field) {
                if (is_string($field)) {
                    $key = trim($field);
                    $label = $key;
                    $required = true;
                } elseif (is_array($field)) {
                    $key = trim((string) ($field['key'] ?? $field['name'] ?? ''));
                    $label = trim((string) ($field['label'] ?? $key));
                    $required = array_key_exists('required', $field)
                        ? filter_var($field['required'], FILTER_VALIDATE_BOOL, FILTER_NULL_ON_FAILURE) !== false
                        : true;
                } else {
                    continue;
                }

                if ($key === '' || !$required) {
                    continue;
                }

                $value = $answers[$key] ?? null;
                if (is_array($value) || trim((string) $value) === '') {
                    $missing[] = $label !== '' ? $label : $key;
                }
            }

            if ($missing !== []) {
                return [
                    'ok' => false,
                    'message' => sprintf(
                        __('Checklist obrigatório incompleto: %s.', 'glpiintegaglpi'),
                        implode(', ', $missing)
                    ),
                ];
            }

            return ['ok' => true, 'message' => ''];
        } catch (Throwable $exception) {
            error_log('[integaglpi][service_catalog][checklist_validate] ' . $exception->getMessage());
            return [
                'ok' => false,
                'message' => __('Não foi possível validar o checklist do serviço agora.', 'glpiintegaglpi'),
            ];
        }
    }

    /**
     * @param array<string, mixed> $row
     */
    private static function isPotentialSoftCloseEligible(array $row): bool
    {
        $conversationId = trim((string) ($row['conversation_id'] ?? ''));
        $ticketId = (int) ($row['glpi_ticket_id'] ?? 0);
        $status = strtolower(trim((string) ($row['effective_status'] ?? $row['conversation_status'] ?? '')));
        $stalledSeconds = (int) ($row['stalled_seconds'] ?? 0);

        return $conversationId !== ''
            && $ticketId <= 0
            && !in_array($status, self::TERMINAL_STATUSES, true)
            && in_array($status, self::SOFT_CLOSE_ELIGIBLE_STATUSES, true)
            && $stalledSeconds >= self::SOFT_CLOSE_MINIMUM_STALLED_SECONDS;
    }

    /**
     * @param list<string> $allowed
     */
    private function normalizeChoice(string $value, array $allowed): string
    {
        $value = trim($value);
        return in_array($value, $allowed, true) ? $value : '';
    }

    /**
     * @param array<string, mixed> $baseData
     * @param array<string, mixed> $filters
     * @param array<string, int> $pagination
     * @param array<string, mixed> $diagnostic
     * @return array<string, mixed>
     */
    private function loadMinimalCentralFallback(array $baseData, array $filters, array $pagination, array $diagnostic): array
    {
        $pdo = $this->getPdo();
        $conversationColumns = $this->loadExternalTableColumns('glpi_plugin_integaglpi_conversations');
        if ($conversationColumns === []) {
            throw new \RuntimeException('CENTRAL_SCHEMA_MISSING_CONVERSATIONS');
        }

        $hasConversationColumn = static fn (string $column): bool => in_array($column, $conversationColumns, true);
        $hasRuntime = $this->externalTableExists('glpi_plugin_integaglpi_conversation_runtime');
        $hasContacts = $this->externalTableExists('glpi_plugin_integaglpi_contacts') && $hasConversationColumn('contact_id');
        $hasQueues = $this->externalTableExists('glpi_plugin_integaglpi_queues');
        $hasMessages = $this->externalTableExists('glpi_plugin_integaglpi_messages');

        $select = [
            'c.id AS conversation_id',
            $hasConversationColumn('phone_e164') ? 'c.phone_e164' : "''::text AS phone_e164",
            $hasConversationColumn('glpi_ticket_id') ? 'c.glpi_ticket_id' : 'NULL::bigint AS glpi_ticket_id',
            $hasConversationColumn('glpi_entity_id') ? 'c.glpi_entity_id' : 'NULL::bigint AS glpi_entity_id',
            $hasConversationColumn('glpi_entity_name') ? 'c.glpi_entity_name' : 'NULL::text AS glpi_entity_name',
            $hasConversationColumn('status') ? 'c.status AS conversation_status' : "'open'::text AS conversation_status",
            $hasConversationColumn('profile_collection_state') ? 'c.profile_collection_state' : 'NULL AS profile_collection_state',
            $hasConversationColumn('last_message_at') ? 'c.last_message_at' : 'NULL::timestamptz AS last_message_at',
            $hasConversationColumn('updated_at') ? 'c.updated_at AS conversation_updated_at' : 'NULL::timestamptz AS conversation_updated_at',
            $hasContacts ? 'ct.name AS contact_name' : "''::text AS contact_name",
            $hasRuntime ? 'COALESCE(rt.queue_id, ' . ($hasConversationColumn('queue_id') ? 'c.queue_id' : 'NULL') . ') AS queue_id' : ($hasConversationColumn('queue_id') ? 'c.queue_id' : 'NULL::bigint AS queue_id'),
            $hasRuntime ? 'rt.assigned_user_id' : 'NULL::bigint AS assigned_user_id',
            $hasRuntime ? 'rt.assigned_group_id' : 'NULL::bigint AS assigned_group_id',
            $hasRuntime ? 'rt.status AS runtime_status' : 'NULL::text AS runtime_status',
            $hasRuntime ? 'rt.updated_at AS runtime_updated_at' : 'NULL::timestamptz AS runtime_updated_at',
            $hasQueues ? 'q.name AS queue_name' : "''::text AS queue_name",
            $hasConversationColumn('last_message_at') ? 'c.last_message_at AS activity_at' : ($hasConversationColumn('updated_at') ? 'c.updated_at AS activity_at' : 'NULL::timestamptz AS activity_at'),
            $hasMessages ? 'lm.message_text AS last_message_preview' : "''::text AS last_message_preview",
            $hasMessages ? 'li.created_at AS last_inbound_at' : 'NULL::timestamptz AS last_inbound_at',
            'NULL AS profile_snapshot_json',
            'NULL::bigint AS memory_entity_id',
            "''::text AS memory_entity_name",
            "''::text AS entity_attempt_status",
            'NULL::bigint AS entity_attempt_ticket_id',
            "''::text AS entity_attempt_error_message",
            'NULL::timestamptz AS entity_attempt_finished_at',
            'NULL::int AS entity_attempt_duration_seconds',
            'NULL::timestamptz AS entity_attempt_updated_at',
            "''::text AS inactivity_tracking_status",
            "''::text AS inactivity_tracking_skip_reason",
            'NULL::timestamptz AS inactivity_tracking_updated_at',
            "''::text AS inactivity_event_key",
            "''::text AS inactivity_event_status",
            "''::text AS inactivity_event_reason",
            "''::text AS inactivity_delivery_status",
            "''::text AS inactivity_meta_error_code",
            "''::text AS inactivity_meta_error_message_sanitized",
            'NULL::timestamptz AS inactivity_last_checked_at',
            "''::text AS last_delivery_status",
            "''::text AS last_meta_message_id",
            "''::text AS last_delivery_error_code",
            "''::text AS last_delivery_error_message_sanitized",
            'NULL::timestamptz AS last_outbound_at',
            'FALSE AS csat_dissatisfied',
            'FALSE AS supervisor_review_required',
            "''::text AS ai_quality_status",
            "''::text AS ai_sentiment",
            "''::text AS ai_resolution",
            "'[]'::text AS ai_flags_json",
            'FALSE AS ai_supervisor_review_required',
            "''::text AS contract_alert_status",
            'NULL::numeric AS contract_consumed_percent',
        ];

        $joins = [];
        if ($hasContacts) {
            $joins[] = 'LEFT JOIN glpi_plugin_integaglpi_contacts ct ON ct.id = c.contact_id';
        }
        if ($hasRuntime) {
            $joins[] = 'LEFT JOIN glpi_plugin_integaglpi_conversation_runtime rt ON rt.conversation_id = c.id';
        }
        if ($hasQueues) {
            $queueExpression = $hasRuntime
                ? 'COALESCE(rt.queue_id, ' . ($hasConversationColumn('queue_id') ? 'c.queue_id' : 'NULL') . ')'
                : ($hasConversationColumn('queue_id') ? 'c.queue_id' : 'NULL');
            $joins[] = 'LEFT JOIN glpi_plugin_integaglpi_queues q ON q.id = ' . $queueExpression;
        }
        if ($hasMessages) {
            $joins[] = "LEFT JOIN LATERAL (
                SELECT m.message_text
                FROM glpi_plugin_integaglpi_messages m
                WHERE m.conversation_id = c.id
                ORDER BY m.created_at DESC
                LIMIT 1
            ) lm ON TRUE";
            $joins[] = "LEFT JOIN LATERAL (
                SELECT m.created_at
                FROM glpi_plugin_integaglpi_messages m
                WHERE m.conversation_id = c.id AND m.direction = 'inbound'
                ORDER BY m.created_at DESC
                LIMIT 1
            ) li ON TRUE";
        }

        [$whereSql, $params] = $this->buildMinimalCentralWhere($filters, $hasConversationColumn, $hasRuntime, $hasMessages);
        $fromSql = 'FROM glpi_plugin_integaglpi_conversations c ' . implode(' ', $joins);

        $count = $pdo->prepare('SELECT COUNT(*) ' . $fromSql . ' WHERE ' . $whereSql);
        $this->bindMinimalCentralParams($count, $params);
        $count->execute();
        $total = (int) $count->fetchColumn();
        $totalPages = max(1, (int) ceil($total / $pagination['limit']));
        $page = min($pagination['page'], $totalPages);
        $offset = ($page - 1) * $pagination['limit'];

        $orderExpression = $hasConversationColumn('last_message_at')
            ? 'c.last_message_at'
            : ($hasConversationColumn('updated_at') ? 'c.updated_at' : 'c.id');

        $statement = $pdo->prepare(
            'SELECT ' . implode(",\n", $select) . ' ' . $fromSql
            . ' WHERE ' . $whereSql
            . ' ORDER BY ' . $orderExpression . ' DESC NULLS LAST'
            . ' LIMIT :limit OFFSET :offset'
        );
        $this->bindMinimalCentralParams($statement, $params);
        $statement->bindValue(':limit', $pagination['limit'], PDO::PARAM_INT);
        $statement->bindValue(':offset', $offset, PDO::PARAM_INT);
        $statement->execute();
        $rows = $statement->fetchAll(PDO::FETCH_ASSOC);

        return [
            ...$baseData,
            'rows' => $this->decorateRows($this->filterAndMarkDeletedTicketRows(is_array($rows) ? $rows : [])),
            'orphaned_cleanup_count' => $this->orphanedConversationCleanupCount,
            'queues' => $hasQueues ? $this->loadFallbackQueues($pdo) : [],
            'technicians' => $hasRuntime ? $this->buildTechnicianOptions($this->loadFallbackTechnicianIds($pdo)) : [],
            'error' => __('Console carregado em modo de compatibilidade porque o schema operacional está incompleto. Revise migrations pendentes antes de produção.', 'glpiintegaglpi'),
            'central_error_diagnostic' => \GlpiPlugin\Integaglpi\Plugin::canAuditRead() ? $diagnostic['admin_diagnostic'] : null,
            'diagnostics' => \GlpiPlugin\Integaglpi\Plugin::canAuditRead() ? $this->loadReadOnlyDiagnostics() : null,
            'pagination' => [
                'page' => $page,
                'limit' => $pagination['limit'],
                'offset' => $offset,
                'total' => $total,
                'total_pages' => $totalPages,
                'has_previous' => $page > 1,
                'has_next' => $page < $totalPages,
            ],
        ];
    }

    /**
     * @param array<string, mixed> $filters
     * @param callable(string): bool $hasConversationColumn
     * @return array{0: string, 1: array<string, array{value: mixed, type: int}>}
     */
    private function buildMinimalCentralWhere(array $filters, callable $hasConversationColumn, bool $hasRuntime, bool $hasMessages): array
    {
        $where = [];
        $params = [];

        if ($hasConversationColumn('status')) {
            $where[] = "c.status != 'closed'";
        }
        if ($hasRuntime) {
            $where[] = "(rt.status IS NULL OR rt.status != 'closed')";
        }

        $allowedEntityIds = is_array($filters['allowed_entity_ids'] ?? null)
            ? array_values(array_filter(array_map('intval', $filters['allowed_entity_ids']), static fn (int $id): bool => $id > 0))
            : [];
        if ($hasConversationColumn('glpi_entity_id') && $allowedEntityIds !== []) {
            $placeholders = [];
            foreach ($allowedEntityIds as $index => $entityId) {
                $placeholder = ':allowed_entity_' . $index;
                $placeholders[] = $placeholder;
                $params[$placeholder] = ['value' => $entityId, 'type' => PDO::PARAM_INT];
            }
            $where[] = '(c.glpi_entity_id IS NULL OR c.glpi_entity_id = 0 OR c.glpi_entity_id IN (' . implode(', ', $placeholders) . '))';
        }

        $status = trim((string) ($filters['status'] ?? ''));
        if ($status !== '' && $hasConversationColumn('status')) {
            $where[] = $hasRuntime ? 'COALESCE(rt.status, c.status) = :status' : 'c.status = :status';
            $params[':status'] = ['value' => $status, 'type' => PDO::PARAM_STR];
        }

        $queueId = $filters['queue_id'] ?? null;
        if (is_int($queueId) && $queueId > 0 && ($hasRuntime || $hasConversationColumn('queue_id'))) {
            $where[] = $hasRuntime && $hasConversationColumn('queue_id')
                ? 'COALESCE(rt.queue_id, c.queue_id) = :queue_id'
                : ($hasRuntime ? 'rt.queue_id = :queue_id' : 'c.queue_id = :queue_id');
            $params[':queue_id'] = ['value' => $queueId, 'type' => PDO::PARAM_INT];
        }

        $entityId = $filters['entity_id'] ?? null;
        if (is_int($entityId) && $entityId > 0 && $hasConversationColumn('glpi_entity_id')) {
            $where[] = 'c.glpi_entity_id = :entity_id';
            $params[':entity_id'] = ['value' => $entityId, 'type' => PDO::PARAM_INT];
        } elseif (is_int($entityId) && $entityId === -1) {
            $where[] = '1 = 0';
        }

        $windowStatus = trim((string) ($filters['window_status'] ?? ''));
        if ($hasMessages && in_array($windowStatus, ['open', 'closed'], true)) {
            $exists = "EXISTS (
                SELECT 1
                FROM glpi_plugin_integaglpi_messages win
                WHERE win.conversation_id = c.id
                  AND win.direction = 'inbound'
                  AND win.created_at >= NOW() - INTERVAL '24 hours'
            )";
            $where[] = $windowStatus === 'open' ? $exists : 'NOT ' . $exists;
        }

        $search = trim((string) ($filters['search'] ?? ''));
        if ($search !== '') {
            $searchConditions = [];
            if ($hasConversationColumn('phone_e164')) {
                $searchConditions[] = 'c.phone_e164 ILIKE :search_like';
                $params[':search_like'] = ['value' => '%' . $search . '%', 'type' => PDO::PARAM_STR];
            }
            if (ctype_digit($search) && $hasConversationColumn('glpi_ticket_id')) {
                $searchConditions[] = 'c.glpi_ticket_id = :search_ticket_id';
                $params[':search_ticket_id'] = ['value' => (int) $search, 'type' => PDO::PARAM_INT];
            }
            if ($searchConditions !== []) {
                $where[] = '(' . implode(' OR ', $searchConditions) . ')';
            }
        }

        return [implode(' AND ', $where !== [] ? $where : ['1 = 1']), $params];
    }

    /**
     * @return list<string>
     */
    private function loadExternalTableColumns(string $table): array
    {
        $statement = $this->getPdo()->prepare(
            "SELECT column_name
             FROM information_schema.columns
             WHERE table_schema = current_schema()
               AND table_name = :table"
        );
        $statement->execute([':table' => $table]);

        return array_values(array_map('strval', $statement->fetchAll(PDO::FETCH_COLUMN) ?: []));
    }

    private function externalTableExists(string $table): bool
    {
        $statement = $this->getPdo()->prepare("SELECT to_regclass(:table) IS NOT NULL");
        $statement->execute([':table' => $table]);

        return (bool) $statement->fetchColumn();
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function loadFallbackQueues(PDO $pdo): array
    {
        try {
            $statement = $pdo->query(
                "SELECT id, name, is_active
                 FROM glpi_plugin_integaglpi_queues
                 ORDER BY name ASC"
            );
            $rows = $statement ? $statement->fetchAll(PDO::FETCH_ASSOC) : [];
            return is_array($rows) ? $rows : [];
        } catch (Throwable) {
            return [];
        }
    }

    /**
     * @return list<int>
     */
    private function loadFallbackTechnicianIds(PDO $pdo): array
    {
        try {
            $statement = $pdo->query(
                "SELECT DISTINCT assigned_user_id
                 FROM glpi_plugin_integaglpi_conversation_runtime
                 WHERE assigned_user_id IS NOT NULL
                   AND assigned_user_id > 0
                 ORDER BY assigned_user_id ASC
                 LIMIT 100"
            );
            return array_values(array_filter(
                array_map('intval', $statement ? $statement->fetchAll(PDO::FETCH_COLUMN) : []),
                static fn (int $id): bool => $id > 0
            ));
        } catch (Throwable) {
            return [];
        }
    }

    /**
     * @param array<string, array{value: mixed, type: int}> $params
     */
    private function bindMinimalCentralParams(\PDOStatement $statement, array $params): void
    {
        foreach ($params as $name => $definition) {
            $statement->bindValue($name, $definition['value'], $definition['type']);
        }
    }

    /**
     * @return array{type: string, user_message: string, log_detail: string, admin_diagnostic: array<string, mixed>, sqlstate?: string|null}
     */
    private function classifyCentralLoadException(Throwable $exception): array
    {
        $message = $exception->getMessage();
        $sqlState = $exception instanceof \PDOException ? (string) ($exception->errorInfo[0] ?? $exception->getCode()) : '';
        $lower = strtolower($message);
        $type = 'query';
        $userMessage = __('Não foi possível carregar a Central agora. Verifique a consulta operacional ou o schema externo.', 'glpiintegaglpi');

        if (str_contains($lower, 'could not connect') || str_contains($lower, 'connection refused') || str_contains($lower, 'timeout expired') || str_contains($lower, 'timed out')) {
            $type = str_contains($lower, 'timeout') || str_contains($lower, 'timed out') ? 'timeout' : 'connection';
            $userMessage = $type === 'timeout'
                ? __('Timeout ao consultar o PostgreSQL externo. Tente novamente em instantes.', 'glpiintegaglpi')
                : __('Não foi possível conectar ao PostgreSQL externo configurado.', 'glpiintegaglpi');
        } elseif (str_contains($lower, 'password authentication failed') || str_contains($lower, 'authentication failed') || $sqlState === '28P01') {
            $type = 'credential';
            $userMessage = __('Credenciais do PostgreSQL externo foram recusadas.', 'glpiintegaglpi');
        } elseif (str_contains($lower, 'permission denied') || $sqlState === '42501') {
            $type = 'permission';
            $userMessage = __('Usuário do PostgreSQL externo sem permissão para consultar a Central.', 'glpiintegaglpi');
        } elseif (str_contains($lower, 'does not exist') || in_array($sqlState, ['42P01', '42703'], true)) {
            $type = 'schema';
            $userMessage = __('Schema externo incompleto para a Central. Aplique as migrations pendentes em TESTE antes do smoke.', 'glpiintegaglpi');
        }

        return [
            'type' => $type,
            'sqlstate' => $sqlState !== '' ? $sqlState : null,
            'user_message' => $userMessage,
            'log_detail' => $this->sanitizeDiagnosticText($message),
            'admin_diagnostic' => [
                'type' => $type,
                'sqlstate' => $sqlState !== '' ? $sqlState : null,
                'detail' => $this->sanitizeDiagnosticText($message),
            ],
        ];
    }

    private function sanitizeDiagnosticText(string $message): string
    {
        $message = preg_replace('/(password|passwd|pwd|token|secret|key)=([^\\s;]+)/i', '$1=***', $message) ?? $message;
        $message = preg_replace('/postgres(?:ql)?:\\/\\/[^\\s]+/i', 'postgresql://***', $message) ?? $message;
        $message = preg_replace('/\\b\\d{10,}\\b/', '********', $message) ?? $message;

        return trim(substr($message, 0, 500));
    }

    /**
     * @return array<string, mixed>|null
     */
    private function loadReadOnlyDiagnostics(): ?array
    {
        try {
            $response = (new IntegrationServiceClient($this->pluginConfigService))->getDiagnostics();
            if (!empty($response['success']) && is_array($response['body'] ?? null)) {
                return $response['body'];
            }
        } catch (Throwable $exception) {
            error_log('[integaglpi][central][diagnostics][error] ' . $exception->getMessage());
        }

        return null;
    }

    private function maskPhone(string $phone): string
    {
        $digits = preg_replace('/\D+/', '', $phone) ?? '';
        if ($digits === '') {
            return '';
        }

        return str_repeat('*', max(4, strlen($digits) - 4)) . substr($digits, -4);
    }

    /**
     * @param array<string, mixed> $row
     * @return array<string, mixed>
     */
    private function applyPiiGuard(array $row, int $assignedUserId): array
    {
        $currentUserId = $this->resolveCurrentUserId();
        $canViewRawPii = $currentUserId > 0
            && (
                ($assignedUserId > 0 && $assignedUserId === $currentUserId)
                || SecurityPermissionService::hasRight(SecurityPermissionService::RIGHT_VIEW_UNMASKED_PII)
            );

        $rawPhone = trim((string) ($row['phone_e164'] ?? ''));
        $rawEmail = trim((string) ($row['email_address'] ?? ''));
        $maskedPhone = $this->maskPhone($rawPhone);
        $maskedEmail = $this->maskEmail($rawEmail);

        if (!$canViewRawPii) {
            $row['phone_e164'] = $maskedPhone;
            $row['email_address'] = $maskedEmail;
            if (is_array($row['contact_profile_snapshot'] ?? null)) {
                $row['contact_profile_snapshot']['email_address'] = $maskedEmail;
            }
            if (is_array($row['profile_context'] ?? null)) {
                $row['profile_context']['email'] = $maskedEmail;
            }
        } elseif ($rawPhone !== '' || $rawEmail !== '') {
            SecurityAuditService::logPiiUnmaskedView(
                'conversation',
                hash('sha256', (string) ($row['conversation_id'] ?? '') . '|' . $currentUserId)
            );
        }

        $row['masked_phone'] = $maskedPhone;
        $row['masked_email'] = $maskedEmail;
        $row['pii_unmasked'] = $canViewRawPii;

        return $row;
    }

    private function maskEmail(string $email): string
    {
        $email = trim($email);
        if ($email === '' || !str_contains($email, '@')) {
            return $email === '' ? '' : '[email]';
        }

        [$local, $domain] = explode('@', $email, 2);
        $prefix = substr($local, 0, min(2, strlen($local)));

        return $prefix . str_repeat('*', max(2, strlen($local) - strlen($prefix))) . '@' . $domain;
    }

    /**
     * @param array<string, mixed> $row
     */
    private function resolveEntityLabel(array $row): string
    {
        $conversationEntity = trim((string) ($row['glpi_entity_name'] ?? ''));
        if ($conversationEntity !== '') {
            return $conversationEntity;
        }

        $memoryEntity = trim((string) ($row['memory_entity_name'] ?? ''));
        if ($memoryEntity !== '') {
            return $memoryEntity;
        }

        $entityId = (int) ($row['glpi_entity_id'] ?? 0);
        if ($entityId > 0) {
            return 'Entidade #' . $entityId;
        }

        return __('Sem entidade', 'glpiintegaglpi');
    }

    /**
     * @param array<string, mixed> $conversation
     */
    private function syncConversationEntityFromTicketIfMissing(array $conversation, int $ticketId, int $userId): int
    {
        $conversationEntityId = (int) ($conversation['glpi_entity_id'] ?? 0);
        if ($conversationEntityId > 0) {
            return $conversationEntityId;
        }

        $ticketEntityId = $this->resolveTicketEntityId($ticketId);
        if ($ticketEntityId <= 0) {
            return 0;
        }

        try {
            $conversationId = trim((string) ($conversation['conversation_id'] ?? $conversation['id'] ?? ''));
            if ($conversationId !== '') {
                $this->getConversationRepository()->updateConversationEntity(
                    $conversationId,
                    $ticketEntityId,
                    $this->resolveEntityNameById($ticketEntityId),
                    $userId
                );
            }
        } catch (Throwable $exception) {
            error_log('[integaglpi][central][entity_sync_from_ticket_failed] ticket_id=' . $ticketId . ' ' . $exception->getMessage());
        }

        return $ticketEntityId;
    }

    private function resolveTicketEntityId(int $ticketId): int
    {
        if ($ticketId <= 0 || !class_exists(\Ticket::class)) {
            return 0;
        }

        $ticket = new \Ticket();
        if (!$ticket->getFromDB($ticketId)) {
            return 0;
        }

        return max(0, (int) ($ticket->fields['entities_id'] ?? 0));
    }

    private function resolveEntityNameById(int $entityId): string
    {
        if ($entityId <= 0 || !class_exists(\Dropdown::class)) {
            return '';
        }

        $name = \Dropdown::getDropdownName('glpi_entities', $entityId);
        return is_string($name) ? $name : '';
    }

    /**
     * Derives the display label for the origin of the memorised entity.
     *
     * Uses data already available in the decorated row:
     *  - entity_attempt_status = 'succeeded' → entity was confirmed manually via the Central
     *  - otherwise → entity came from an automatic or plugin-override write to memory
     *
     * NOTE: the canonical `source` column of the contact_entity_memory table is stored
     * by the Node FSM ('manual') and by the PHP override flow ('plugin_entity_edit').
     * Because ConversationRepository.php is outside this phase's allowlist, we derive
     * the label from the already-available entity_attempt_status instead of joining cem.source.
     *
     * @param array<string, mixed> $row
     */
    private function resolveEntitySourceLabel(array $row): string
    {
        $memoryEntityId = (int) ($row['memory_entity_id'] ?? 0);
        if ($memoryEntityId <= 0) {
            return '';
        }

        $attemptStatus = strtolower(trim((string) ($row['entity_attempt_status'] ?? '')));
        if ($attemptStatus === 'succeeded') {
            return __('seleção manual', 'glpiintegaglpi');
        }

        // Covers both 'manual' (Node auto-applied from memory) and 'plugin_entity_edit' (PHP override).
        return __('memória', 'glpiintegaglpi');
    }

    private function calculateStalledSeconds(string $activityAt): int
    {
        $activityAt = trim($activityAt);
        if ($activityAt === '') {
            return 0;
        }

        try {
            $activity = new \DateTimeImmutable($activityAt);
            $now = new \DateTimeImmutable('now');
            return max(0, $now->getTimestamp() - $activity->getTimestamp());
        } catch (Throwable) {
            return 0;
        }
    }

    private function formatDuration(int $seconds): string
    {
        if ($seconds <= 0) {
            return '-';
        }

        $hours = intdiv($seconds, 3600);
        if ($hours >= 24) {
            return intdiv($hours, 24) . 'd';
        }
        if ($hours > 0) {
            return $hours . 'h';
        }

        return max(1, intdiv($seconds, 60)) . 'min';
    }

    private function buildBusinessHoursLabel(): string
    {
        try {
            $config = $this->pluginConfigService->getBusinessHoursConfig();
            if (empty($config['business_hours_enabled'])) {
                return __('Horário comercial desativado', 'glpiintegaglpi');
            }

            return __('Horário comercial configurado', 'glpiintegaglpi');
        } catch (Throwable) {
            return __('Horário comercial indisponível', 'glpiintegaglpi');
        }
    }

    /**
     * @param array<string, mixed> $row
     */
    private function operationalStateLabel(array $row): string
    {
        $status = (string) ($row['effective_status'] ?? '');
        $attemptStatus = (string) ($row['entity_attempt_status'] ?? '');
        $attemptError = (string) ($row['entity_attempt_error_message'] ?? '');
        $ticketId = (int) ($row['glpi_ticket_id'] ?? 0);

        if (str_starts_with($attemptError, 'ambiguous_reconciliation:')) {
            return __('Reconciliação ambígua', 'glpiintegaglpi');
        }
        if ($attemptStatus === 'processing') {
            return __('Criação em andamento', 'glpiintegaglpi');
        }
        if ($ticketId <= 0) {
            return match ($status) {
                'awaiting_entity_selection' => __('Aguardando entidade', 'glpiintegaglpi'),
                'collecting_contact_profile' => !empty($row['profile_collection_complete'])
                    ? __('Perfil completo sem entidade', 'glpiintegaglpi')
                    : (
                        !empty($row['profile_context']['awaiting_return'])
                            ? __('Aguardando retorno do cliente', 'glpiintegaglpi')
                            : __('Aguardando perfil', 'glpiintegaglpi')
                    ),
                'awaiting_queue_selection' => __('Aguardando fila', 'glpiintegaglpi'),
                default => __('Pré-ticket', 'glpiintegaglpi'),
            };
        }

        return $status === 'closed'
            ? __('Fechado', 'glpiintegaglpi')
            : __('Ticket aberto', 'glpiintegaglpi');
    }

    /**
     * @param array<string, mixed> $row
     * @return list<array{label: string, class: string}>
     */
    private function buildRiskBadges(array $row): array
    {
        $badges = [];
        $deliveryStatus = (string) ($row['last_delivery_status'] ?? '');
        $inactivityStatus = (string) ($row['inactivity_event_status'] ?? '');
        $attemptStatus = (string) ($row['entity_attempt_status'] ?? '');
        $attemptError = (string) ($row['entity_attempt_error_message'] ?? '');
        $window = is_array($row['whatsapp_window'] ?? null) ? $row['whatsapp_window'] : [];

        if ($window !== [] && empty($window['is_open'])) {
            $badges[] = ['label' => __('Janela 24h fechada', 'glpiintegaglpi'), 'class' => 'bg-warning text-dark'];
        }
        if (!empty($row['profile_context']['awaiting_return'])) {
            $badges[] = ['label' => __('Aguardando retorno do cliente', 'glpiintegaglpi'), 'class' => 'bg-warning text-dark'];
        }
        if ($deliveryStatus === 'failed') {
            $badges[] = ['label' => __('Falha Meta', 'glpiintegaglpi'), 'class' => 'bg-danger'];
        }
        if ($inactivityStatus === 'failed') {
            $badges[] = ['label' => __('Inatividade falhou', 'glpiintegaglpi'), 'class' => 'bg-danger'];
        }
        if ($attemptStatus === 'processing') {
            $badges[] = ['label' => __('Processing', 'glpiintegaglpi'), 'class' => 'bg-info text-dark'];
        }
        if (str_starts_with($attemptError, 'ambiguous_reconciliation:')) {
            $badges[] = ['label' => __('Reconciliação ambígua', 'glpiintegaglpi'), 'class' => 'bg-danger'];
        }
        if (!empty($row['csat_dissatisfied'])) {
            $badges[] = ['label' => __('CSAT insatisfeito', 'glpiintegaglpi'), 'class' => 'bg-danger'];
        }
        if (!empty($row['ai_supervisor_review_required'])) {
            $badges[] = ['label' => __('IA: revisão humana', 'glpiintegaglpi'), 'class' => 'bg-warning text-dark'];
        }
        if ((string) ($row['contract_alert_status'] ?? '') !== '' && (string) ($row['contract_alert_status'] ?? '') !== 'ok') {
            $badges[] = ['label' => __('Contrato em atenção', 'glpiintegaglpi'), 'class' => 'bg-warning text-dark'];
        }
        $slaContext = is_array($row['sla_context'] ?? null) ? $row['sla_context'] : [];
        $slaStatus = (string) ($slaContext['status'] ?? 'not_configured');
        if ($slaStatus !== 'normal') {
            $badges[] = [
                'label' => (string) ($slaContext['label'] ?? __('SLA em atenção', 'glpiintegaglpi')),
                'class' => (string) ($slaContext['badge_class'] ?? 'bg-warning text-dark'),
            ];
        }

        return $badges;
    }

    /**
     * @param array<string, mixed> $row
     * @return array<string, mixed>
     */
    private function buildSlaContext(array $row): array
    {
        $responseDeadline = $this->timestampOrNull($row['sla_response_deadline'] ?? null);
        $solutionDeadline = $this->timestampOrNull($row['sla_solution_deadline'] ?? null);
        $firstResponseAt = $this->timestampOrNull($row['sla_first_response_at'] ?? null);
        $resolutionAt = $this->timestampOrNull($row['sla_resolution_at'] ?? null);
        $pausedMinutes = max(0, (int) ($row['accumulated_paused_minutes'] ?? 0));
        $reopenCount = max(0, (int) ($row['reopen_count'] ?? 0));
        $now = time();
        $deadline = $resolutionAt === null && $solutionDeadline !== null
            ? $solutionDeadline
            : ($firstResponseAt === null ? $responseDeadline : $solutionDeadline);
        $startedAt = $this->timestampOrNull($row['last_inbound_at'] ?? null)
            ?? $this->timestampOrNull($row['conversation_updated_at'] ?? null)
            ?? $this->timestampOrNull($row['activity_at'] ?? null);

        $status = 'not_configured';
        if ($deadline !== null) {
            $status = 'normal';
            if ($deadline <= $now) {
                $status = 'breached';
            } elseif ($startedAt !== null && $deadline > $startedAt) {
                $elapsed = max(0, $now - $startedAt);
                $total = max(1, $deadline - $startedAt);
                $percent = ($elapsed / $total) * 100;
                if ($percent >= 90) {
                    $status = 'critical';
                } elseif ($percent >= 70) {
                    $status = 'attention';
                }
            }
        }

        $labels = [
            'not_configured' => __('SLA não configurado', 'glpiintegaglpi'),
            'normal' => __('SLA normal', 'glpiintegaglpi'),
            'attention' => __('SLA atenção', 'glpiintegaglpi'),
            'critical' => __('SLA crítico', 'glpiintegaglpi'),
            'breached' => __('SLA vencido', 'glpiintegaglpi'),
        ];
        $classes = [
            'not_configured' => 'bg-secondary',
            'normal' => 'bg-success',
            'attention' => 'bg-warning text-dark',
            'critical' => 'bg-danger',
            'breached' => 'bg-dark',
        ];

        return [
            'status' => $status,
            'label' => $labels[$status],
            'badge_class' => $classes[$status],
            'response_deadline' => $this->formatSlaTimestamp($row['sla_response_deadline'] ?? null),
            'solution_deadline' => $this->formatSlaTimestamp($row['sla_solution_deadline'] ?? null),
            'first_response_at' => $this->formatSlaTimestamp($row['sla_first_response_at'] ?? null),
            'resolution_at' => $this->formatSlaTimestamp($row['sla_resolution_at'] ?? null),
            'paused_minutes' => $pausedMinutes,
            'reopen_count' => $reopenCount,
            'service_name' => trim((string) ($row['service_catalog_name'] ?? '')),
            'service_key' => trim((string) ($row['service_catalog_key'] ?? '')),
        ];
    }

    private function timestampOrNull(mixed $value): ?int
    {
        $value = trim((string) $value);
        if ($value === '') {
            return null;
        }

        $timestamp = strtotime($value);
        return $timestamp === false ? null : $timestamp;
    }

    private function formatSlaTimestamp(mixed $value): string
    {
        return $this->formatDisplayTimestamp($value);
    }

    private function displayTimezone(): \DateTimeZone
    {
        $timezone = date_default_timezone_get() ?: 'America/Sao_Paulo';
        if (strtoupper($timezone) === 'UTC') {
            $timezone = 'America/Sao_Paulo';
        }

        try {
            return new \DateTimeZone($timezone);
        } catch (\Throwable) {
            return new \DateTimeZone('America/Sao_Paulo');
        }
    }

    private function parseStorageTimestamp(mixed $value): ?\DateTimeImmutable
    {
        $value = trim((string) $value);
        if ($value === '') {
            return null;
        }

        try {
            return new \DateTimeImmutable($value, new \DateTimeZone('UTC'));
        } catch (\Throwable) {
            return null;
        }
    }

    private function formatDisplayTimestamp(mixed $value): string
    {
        $date = $this->parseStorageTimestamp($value);
        if ($date === null) {
            return '';
        }

        return $date->setTimezone($this->displayTimezone())->format('Y-m-d H:i');
    }

    private function statusLabel(string $status): string
    {
        $status = trim($status);
        return self::STATUS_LABELS[$status] ?? ($status !== '' ? $status : __('Sem status', 'glpiintegaglpi'));
    }

    private function entityAttemptStatusLabel(string $status, string $errorMessage): string
    {
        if (str_starts_with($errorMessage, 'ambiguous_reconciliation:')) {
            return __('Reconciliação ambígua', 'glpiintegaglpi');
        }

        return match ($status) {
            'processing' => __('Criando chamado...', 'glpiintegaglpi'),
            'succeeded' => __('Chamado criado/reconciliado', 'glpiintegaglpi'),
            'failed_before_ticket' => __('Falha antes de vincular chamado', 'glpiintegaglpi'),
            'failed_after_ticket' => __('Ticket criado, vínculo pendente', 'glpiintegaglpi'),
            'cancelled' => __('Cancelada', 'glpiintegaglpi'),
            default => '',
        };
    }

    private function sanitizeEntityAttemptError(string $errorMessage): string
    {
        $errorMessage = trim($errorMessage);
        if ($errorMessage === '') {
            return '';
        }

        if (str_contains($errorMessage, 'glpi_ticket_create timeout')) {
            return __('A criação pode ter sido concluída no GLPI. Não tente novamente até a reconciliação ser verificada.', 'glpiintegaglpi');
        }

        if (str_starts_with($errorMessage, 'ambiguous_reconciliation:')) {
            return __('Há múltiplos chamados candidatos no GLPI. Exige decisão humana antes de nova tentativa.', 'glpiintegaglpi');
        }

        return mb_substr(preg_replace('/\s+/', ' ', $errorMessage) ?? $errorMessage, 0, 180);
    }

    private function inactivityStatusLabel(string $eventStatus, string $trackingStatus): string
    {
        $eventStatus = trim($eventStatus);
        $trackingStatus = trim($trackingStatus);

        return match ($eventStatus) {
            'checked' => __('Checado', 'glpiintegaglpi'),
            'eligible' => __('Elegível', 'glpiintegaglpi'),
            'skipped' => __('Ignorado por regra', 'glpiintegaglpi'),
            'planned' => __('Envio planejado', 'glpiintegaglpi'),
            'sent' => __('Mensagem enviada', 'glpiintegaglpi'),
            'failed' => __('Falha na inatividade', 'glpiintegaglpi'),
            default => $trackingStatus !== '' ? $trackingStatus : '',
        };
    }

    private function inactivityNextAction(string $eventStatus, string $eventReason, string $skipReason): string
    {
        $reason = trim($eventReason) !== '' ? trim($eventReason) : trim($skipReason);

        if ($reason === 'skipped_missing_template_outside_24h') {
            return __('Configurar template local ativo para enviar fora da janela 24h.', 'glpiintegaglpi');
        }

        return match ($eventStatus) {
            'checked' => __('Aguardando próximo ciclo de inatividade', 'glpiintegaglpi'),
            'eligible' => __('Mensagem de inatividade elegível para envio', 'glpiintegaglpi'),
            'planned' => __('Envio de inatividade planejado', 'glpiintegaglpi'),
            'sent' => __('Aguardar delivery/read da Meta', 'glpiintegaglpi'),
            'failed' => __('Verificar erro de envio da Meta', 'glpiintegaglpi'),
            'skipped' => $reason !== '' ? $reason : __('Sem ação por regra de inatividade', 'glpiintegaglpi'),
            default => '',
        };
    }

    private function sanitizeInactivityError(string $metaError, string $reason): string
    {
        $message = trim($metaError) !== '' ? trim($metaError) : trim($reason);
        if ($message === '' || $message === 'candidates_found' || $message === 'no_eligible_candidates') {
            return '';
        }

        return mb_substr(preg_replace('/\s+/', ' ', $message) ?? $message, 0, 180);
    }

    private function nextAction(string $status, bool $hasTicket, bool $profileComplete = false): string
    {
        if ($status === 'collecting_contact_profile' && $profileComplete && !$hasTicket) {
            return __('Selecione a entidade para criar o chamado', 'glpiintegaglpi');
        }

        return match ($status) {
            'awaiting_entity_selection' => __('Selecione a entidade para criar o chamado', 'glpiintegaglpi'),
            'awaiting_queue_selection' => __('Selecione a fila', 'glpiintegaglpi'),
            'collecting_contact_profile' => __('Aguarde o usuário responder', 'glpiintegaglpi'),
            'media_error' => __('Verifique erro de mídia', 'glpiintegaglpi'),
            'open' => __('Responda o cliente', 'glpiintegaglpi'),
            'closed' => __('Acompanhe o chamado', 'glpiintegaglpi'),
            default => $hasTicket
                ? __('Acompanhe o chamado', 'glpiintegaglpi')
                : __('Aguarde o usuário responder', 'glpiintegaglpi'),
        };
    }

    /**
     * @param array<string, mixed> $row
     * @return array<string, mixed>
     */
    private function buildProfileContext(array $row): array
    {
        $state = $this->decodeArrayValue($row['profile_collection_state'] ?? null);
        $snapshot = is_array($row['contact_profile_snapshot'] ?? null)
            ? $row['contact_profile_snapshot']
            : [];
        $source = array_merge($snapshot, $state);
        $step = trim((string) ($state['step'] ?? $snapshot['profile_status'] ?? ''));

        $name = trim((string) ($source['requester_name'] ?? $row['contact_name'] ?? ''));
        $company = trim((string) ($source['company_name_raw'] ?? ''));
        $email = trim((string) ($source['email_address'] ?? ''));
        $equipmentUnknown = !empty($source['equipment_tag_unknown']);
        $equipment = $equipmentUnknown
            ? __('Não informado', 'glpiintegaglpi')
            : trim((string) ($source['last_equipment_tag'] ?? $source['equipment_tag'] ?? ''));
        $reason = trim((string) ($source['reason'] ?? $source['last_problem_summary'] ?? $source['problem_summary'] ?? ''));

        $answered = [];
        if ($company !== '') {
            $answered[] = __('empresa', 'glpiintegaglpi');
        }
        if ($name !== '') {
            $answered[] = __('nome', 'glpiintegaglpi');
        }
        if ($email !== '' || (string) ($source['email_status'] ?? '') === 'not_provided') {
            $answered[] = __('e-mail', 'glpiintegaglpi');
        }
        if ($equipment !== '') {
            $answered[] = __('equipamento', 'glpiintegaglpi');
        }
        if ($reason !== '') {
            $answered[] = __('motivo', 'glpiintegaglpi');
        }

        $pendingByStep = [
            'confirming_existing_profile' => [__('confirmação do perfil', 'glpiintegaglpi'), __('motivo', 'glpiintegaglpi')],
            'asking_company' => [__('empresa', 'glpiintegaglpi'), __('nome', 'glpiintegaglpi'), __('e-mail', 'glpiintegaglpi'), __('equipamento', 'glpiintegaglpi'), __('motivo', 'glpiintegaglpi')],
            'asking_name' => [__('nome', 'glpiintegaglpi'), __('e-mail', 'glpiintegaglpi'), __('equipamento', 'glpiintegaglpi'), __('motivo', 'glpiintegaglpi')],
            'asking_email' => [__('e-mail', 'glpiintegaglpi'), __('equipamento', 'glpiintegaglpi'), __('motivo', 'glpiintegaglpi')],
            'asking_tag' => [__('equipamento', 'glpiintegaglpi'), __('motivo', 'glpiintegaglpi')],
            'asking_reason' => [__('motivo', 'glpiintegaglpi')],
            'complete' => [],
        ];
        $pending = $pendingByStep[$step] ?? [];
        if (self::isProfileCollectionComplete($row['profile_collection_state'] ?? null)) {
            $pending = [];
        }

        return [
            'name' => $name,
            'company' => $company,
            'email' => $email,
            'equipment' => $equipment,
            'reason' => $reason,
            'step' => $step,
            'answered_fields' => $answered,
            'pending_fields' => $pending,
            'answered_label' => $answered !== [] ? implode(', ', $answered) : '-',
            'pending_label' => $pending !== [] ? implode(', ', $pending) : '-',
            'awaiting_return' => (string) ($row['effective_status'] ?? '') === 'collecting_contact_profile'
                && $pending !== []
                && (int) ($row['stalled_seconds'] ?? 0) >= 300,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function decodeArrayValue(mixed $value): array
    {
        if (is_array($value)) {
            return $value;
        }

        if (!is_string($value) || trim($value) === '') {
            return [];
        }

        $decoded = json_decode($value, true);
        return is_array($decoded) ? $decoded : [];
    }

    private static function isProfileCollectionComplete(mixed $value): bool
    {
        if (is_string($value)) {
            $decoded = json_decode($value, true);
            $value = is_array($decoded) ? $decoded : [];
        }

        return is_array($value) && (string) ($value['step'] ?? '') === 'complete';
    }

    /**
     * @return array<string, mixed>|null
     */
    private function decodeProfileSnapshot(mixed $value): ?array
    {
        if (is_array($value)) {
            return $value;
        }

        if (!is_string($value) || trim($value) === '') {
            return null;
        }

        $decoded = json_decode($value, true);
        if (!is_array($decoded)) {
            return null;
        }

        if (isset($decoded['snapshot_json'])) {
            $snapshot = $decoded['snapshot_json'];
            if (is_string($snapshot)) {
                $snapshot = json_decode($snapshot, true);
            }
            if (is_array($snapshot)) {
                $decoded = $snapshot;
            }
        }

        if (!array_key_exists('last_equipment_tag', $decoded) && array_key_exists('equipment_tag', $decoded)) {
            $decoded['last_equipment_tag'] = $decoded['equipment_tag'];
        }
        if (!array_key_exists('last_problem_summary', $decoded) && array_key_exists('problem_summary', $decoded)) {
            $decoded['last_problem_summary'] = $decoded['problem_summary'];
        }

        return $decoded;
    }

    private function getConversationRepository(): ConversationRepository
    {
        if ($this->conversationRepository instanceof ConversationRepository) {
            return $this->conversationRepository;
        }

        $this->conversationRepository = new ConversationRepository($this->getPdo());

        return $this->conversationRepository;
    }

    private function getMessageRepository(): MessageRepository
    {
        if ($this->messageRepository instanceof MessageRepository) {
            return $this->messageRepository;
        }

        $this->messageRepository = new MessageRepository($this->getPdo());

        return $this->messageRepository;
    }

    private function getTicketRuntimeService(): TicketRuntimeService
    {
        if ($this->ticketRuntimeService instanceof TicketRuntimeService) {
            return $this->ticketRuntimeService;
        }

        $this->ticketRuntimeService = new TicketRuntimeService($this->pluginConfigService);

        return $this->ticketRuntimeService;
    }

    private function getPdo(): PDO
    {
        if ($this->pdo instanceof PDO) {
            return $this->pdo;
        }

        $this->pdo = ExternalDatabase::getConnection($this->pluginConfigService->getConnectionConfig());
        ExternalSchemaManager::ensureSchema($this->pdo);

        return $this->pdo;
    }

    private function textLength(string $value): int
    {
        return function_exists('mb_strlen') ? mb_strlen($value) : strlen($value);
    }

    private function normalizeIdempotencyKey(?string $idempotencyKey): string
    {
        $candidate = trim((string) $idempotencyKey);

        if (strlen($candidate) >= 8 && strlen($candidate) <= 256) {
            return $candidate;
        }

        try {
            return 'central-reply-' . bin2hex(random_bytes(16));
        } catch (Throwable) {
            return 'central-reply-' . time() . '-' . mt_rand(100000, 999999);
        }
    }

    private function normalizeEntitySelectionIdempotencyKey(
        string $conversationId,
        int $glpiEntityId,
        ?string $idempotencyKey
    ): string {
        $candidate = trim((string) $idempotencyKey);
        if ($candidate !== '' && preg_match('/^[a-zA-Z0-9:._-]{1,180}$/', $candidate) === 1) {
            return $candidate;
        }

        $safeConversationId = preg_replace('/[^a-zA-Z0-9._-]/', '_', $conversationId) ?: 'conversation';

        return 'entity_selection:' . $safeConversationId . ':' . $glpiEntityId;
    }

    private function isActiveGlpiUser(int $userId): bool
    {
        if ($userId <= 0 || !class_exists('\User')) {
            return false;
        }

        $user = new \User();
        if (!$user->getFromDB($userId)) {
            return false;
        }

        return (int) ($user->fields['is_deleted'] ?? 0) === 0
            && (int) ($user->fields['is_active'] ?? 1) === 1;
    }

    private function hasValidTicketId(mixed $value): bool
    {
        if (is_int($value)) {
            return $value > 0;
        }

        if (is_float($value)) {
            return floor($value) === $value && $value > 0;
        }

        if (is_string($value)) {
            $trimmed = trim($value);
            return $trimmed !== '' && ctype_digit($trimmed) && (int) $trimmed > 0;
        }

        return false;
    }

    /**
     * @return array{status: string, solution_id?: int|null, status_updated?: bool, ticket_status?: int}
     */
    private function solveGlpiTicket(int $ticketId): array
    {
        if (!class_exists(\Ticket::class)) {
            throw new \RuntimeException(__('GLPI Ticket class is not available.', 'glpiintegaglpi'));
        }

        if (!class_exists(\ITILSolution::class)) {
            throw new \RuntimeException(__('ITILSolution is not available.', 'glpiintegaglpi'));
        }

        $ticket = new \Ticket();
        if (!$ticket->getFromDB($ticketId)) {
            throw new \RuntimeException(__('Ticket not found.', 'glpiintegaglpi'));
        }

        $currentStatus = (int) ($ticket->fields['status'] ?? 0);
        if ($currentStatus === CommonITILObject::SOLVED || $currentStatus === CommonITILObject::CLOSED) {
            return [
                'status' => 'already_solved',
                'solution_id' => null,
                'status_updated' => false,
                'ticket_status' => $currentStatus,
            ];
        }

        $solution = new \ITILSolution();
        $solutionId = $solution->add([
            'itemtype' => 'Ticket',
            'items_id' => $ticketId,
            'content' => 'Ticket resolvido via Central WhatsApp.',
            'solutiontypes_id' => 0,
        ]);

        if ($solutionId === false) {
            throw new \RuntimeException(__('Failed to add ticket solution.', 'glpiintegaglpi'));
        }

        $updated = $ticket->update([
            'id' => $ticketId,
            'status' => CommonITILObject::SOLVED,
        ]);
        if ($updated === false) {
            return [
                'status' => 'status_update_failed',
                'solution_id' => (int) $solutionId,
                'status_updated' => false,
                'ticket_status' => $currentStatus,
            ];
        }

        return [
            'status' => 'solved',
            'solution_id' => (int) $solutionId,
            'status_updated' => true,
            'ticket_status' => CommonITILObject::SOLVED,
        ];
    }

    private function friendlySolveExceptionMessage(Throwable $exception): string
    {
        $message = $exception->getMessage();
        if (stripos($message, 'not found') !== false) {
            return __('Ticket não encontrado no GLPI.', 'glpiintegaglpi');
        }
        if (stripos($message, 'solution') !== false) {
            return __('Não foi possível criar a solução no GLPI. Verifique permissões do técnico.', 'glpiintegaglpi');
        }
        if (stripos($message, 'timeout') !== false || stripos($message, 'timed out') !== false) {
            return __('Timeout ao comunicar com o GLPI durante a solução do chamado.', 'glpiintegaglpi');
        }

        return __('Falha específica ao solucionar chamado no GLPI. Verifique permissões e logs técnicos.', 'glpiintegaglpi');
    }

    private function logTransfer(
        string $status,
        int $ticketId,
        string $conversationId,
        int $currentUserId,
        int $newTechnicianId
    ): void {
        error_log('[integaglpi][central][transfer] ' . json_encode([
            'status' => $status,
            'ticket_id' => $ticketId,
            'conversation_id' => $conversationId,
            'current_user_id' => $currentUserId,
            'new_technician_id' => $newTechnicianId,
        ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
    }

    /**
     * @param list<array<string, mixed>> $messages
     * @return list<array<string, mixed>>
     */
    private function decorateMessages(array $messages): array
    {
        return array_map(
            function (array $message): array {
                $createdAt = (string) ($message['created_at'] ?? '');
                $updatedAt = (string) ($message['updated_at'] ?? '');

                return [
                'id' => (string) ($message['id'] ?? ''),
                'message_id' => (string) ($message['message_id'] ?? ''),
                'conversation_id' => (string) ($message['conversation_id'] ?? ''),
                'direction' => (string) ($message['direction'] ?? ''),
                'sender_phone' => (string) ($message['sender_phone'] ?? ''),
                'recipient_phone' => (string) ($message['recipient_phone'] ?? ''),
                'message_type' => (string) ($message['message_type'] ?? ''),
                'message_text' => (string) ($message['message_text'] ?? ''),
                'processing_status' => (string) ($message['processing_status'] ?? ''),
                'glpi_sync_status' => (string) ($message['glpi_sync_status'] ?? ''),
                'meta_message_id' => (string) ($message['meta_message_id'] ?? ''),
                'delivery_status' => (string) ($message['delivery_status'] ?? ''),
                'delivery_status_label' => self::deliveryStatusLabel((string) ($message['delivery_status'] ?? '')),
                'delivery_status_updated_at' => (string) ($message['delivery_status_updated_at'] ?? ''),
                'meta_error_code' => (string) ($message['meta_error_code'] ?? ''),
                'meta_error_message_sanitized' => (string) ($message['meta_error_message_sanitized'] ?? ''),
                'created_at' => $createdAt,
                'created_at_display' => $this->formatDisplayTimestamp($createdAt),
                'updated_at' => $updatedAt,
                'updated_at_display' => $this->formatDisplayTimestamp($updatedAt),
            ];
            },
            $messages
        );
    }

    /**
     * @return array{is_open: bool, label: string, expires_at: string, alert: string}
     */
    private function buildWhatsappWindow(string $lastInboundAt): array
    {
        $lastInboundAt = trim($lastInboundAt);
        if ($lastInboundAt === '') {
            return [
                'is_open' => false,
                'label' => __('Janela fechada — use template', 'glpiintegaglpi'),
                'expires_at' => '',
                'alert' => __('Sem mensagem inbound recente do cliente. Use template aprovado para iniciar contato.', 'glpiintegaglpi'),
            ];
        }

        try {
            $lastInbound = new \DateTimeImmutable($lastInboundAt);
            $expiresAt = $lastInbound->modify('+24 hours');
            $now = new \DateTimeImmutable('now', $expiresAt->getTimezone());
            $isOpen = $expiresAt > $now;
            $expiresAtLocal = $expiresAt->setTimezone($this->displayTimezone());
            $formatted = $expiresAtLocal->format('H:i');

            return [
                'is_open' => $isOpen,
                'label' => $isOpen
                    ? sprintf(__('Janela aberta até %s', 'glpiintegaglpi'), $formatted)
                    : __('Janela fechada — use template', 'glpiintegaglpi'),
                'expires_at' => $expiresAtLocal->format('c'),
                'alert' => $isOpen
                    ? ''
                    : __('A janela de 24h está fechada. Use um template aprovado antes de enviar texto livre.', 'glpiintegaglpi'),
            ];
        } catch (Throwable) {
            return [
                'is_open' => false,
                'label' => __('Janela fechada — use template', 'glpiintegaglpi'),
                'expires_at' => '',
                'alert' => __('Não foi possível calcular a janela de 24h com segurança.', 'glpiintegaglpi'),
            ];
        }
    }

    private static function deliveryStatusLabel(string $status): string
    {
        return match (strtolower(trim($status))) {
            'pending' => __('Pendente', 'glpiintegaglpi'),
            'sent' => __('Enviada', 'glpiintegaglpi'),
            'delivered' => __('Entregue', 'glpiintegaglpi'),
            'read' => __('Lida', 'glpiintegaglpi'),
            'failed' => __('Falhou', 'glpiintegaglpi'),
            default => '',
        };
    }
}
