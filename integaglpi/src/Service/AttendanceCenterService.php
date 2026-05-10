<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi\Service;

use CommonITILObject;
use GlpiPlugin\Integaglpi\External\ExternalDatabase;
use GlpiPlugin\Integaglpi\External\Repository\ConversationRepository;
use GlpiPlugin\Integaglpi\External\Repository\MessageRepository;
use PDO;
use Throwable;

final class AttendanceCenterService
{
    private const DEFAULT_LIMIT = 20;
    private const MAX_LIMIT = 50;
    private const MAX_REPLY_LENGTH = 4096;
    private const ALLOWED_STATUSES = [
        'open',
        'pending_glpi',
        'awaiting_queue_selection',
    ];

    private PluginConfigService $pluginConfigService;

    private ?PDO $pdo = null;

    private ?ConversationRepository $conversationRepository = null;

    private ?MessageRepository $messageRepository = null;

    private ?TicketRuntimeService $ticketRuntimeService = null;

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
        $filters = $this->normalizeFilters($query);
        $pagination = $this->normalizePagination($query);
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
            'error' => null,
            'is_configured' => $this->pluginConfigService->isConfigured(),
            'allowed_statuses' => self::ALLOWED_STATUSES,
            'limit_options' => [10, 20, 50],
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

            return [
                ...$baseData,
                'rows' => $this->decorateRows($rows),
                'queues' => $repository->findAttendanceQueues(),
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
            error_log('[integaglpi][central][error] ' . $exception->getMessage());
            error_log($exception->getTraceAsString());

            $baseData['error'] = __(
                'Unable to load WhatsApp conversations right now. Please check the external PostgreSQL connection.',
                'glpiintegaglpi'
            );
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

                $row['can_claim'] = $effectiveStatus === 'open'
                    && $assignedUserId <= 0
                    && $ticketId > 0
                    && $conversationId !== '';
                $row['can_reply'] = $effectiveStatus === 'open'
                    && $assignedUserId === $currentUserId
                    && $ticketId > 0
                    && $conversationId !== '';

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
            $previousAssignedUserId = (int) ($currentConversation['assigned_user_id'] ?? 0);
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
            $this->solveGlpiTicket($ticketId);
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
                'error' => 'solve_failed',
                'message' => __('Unable to solve this ticket right now.', 'glpiintegaglpi'),
            ];
        }

        return [
            'ok' => true,
            'status' => 'solved',
            'message' => __('Chamado solucionado.', 'glpiintegaglpi'),
        ];
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
        if ($conversationId === '' || $ticketId <= 0) {
            return [
                'ok' => false,
                'http_status' => 400,
                'error' => 'invalid_request',
                'message' => __('Invalid conversation or ticket.', 'glpiintegaglpi'),
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
            if ($conversation === null) {
                return [
                    'ok' => false,
                    'http_status' => 404,
                    'error' => 'not_found',
                    'message' => __('Conversation not found for this ticket.', 'glpiintegaglpi'),
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
     * @return array{status: string, queue_id: int|null, search: string}
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

        return [
            'status' => $status,
            'queue_id' => $queueId,
            'search' => $search,
        ];
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
        $limit = min(self::MAX_LIMIT, max(1, $limit));

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

            return $row;
        }, $rows);
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

    private function solveGlpiTicket(int $ticketId): void
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

        $updated = $ticket->update([
            'id' => $ticketId,
            'status' => CommonITILObject::SOLVED,
        ]);
        if ($updated === false) {
            throw new \RuntimeException(__('Failed to update ticket status.', 'glpiintegaglpi'));
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
            static fn (array $message): array => [
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
                'created_at' => (string) ($message['created_at'] ?? ''),
                'updated_at' => (string) ($message['updated_at'] ?? ''),
            ],
            $messages
        );
    }
}
