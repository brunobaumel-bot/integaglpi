<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi\Service;

use GlpiPlugin\Integaglpi\External\ExternalDatabase;
use GlpiPlugin\Integaglpi\External\ExternalSchemaManager;
use GlpiPlugin\Integaglpi\External\Repository\ConversationRepository;
use GlpiPlugin\Integaglpi\External\Repository\NotificationRepository;
use PDO;
use Session;
use Throwable;

final class NotificationService
{
    private const EVENT_TICKET_OPENED = 'ticket_opened';
    private const EVENT_PUBLIC_FOLLOWUP = 'public_followup';
    private const EVENT_TICKET_SOLVED = 'ticket_solved';
    private const EVENT_TICKET_CLOSED = 'ticket_closed';
    private const EVENT_TICKET_PENDING = 'ticket_pending';
    private const EVENT_TECHNICIAN_ASSIGNED = 'technician_assigned';
    private const EVENT_TICKET_TRANSFERRED = 'ticket_transferred';

    private PluginConfigService $pluginConfigService;

    private ?PDO $pdo = null;

    private ?ConversationRepository $conversationRepository = null;

    private ?NotificationRepository $notificationRepository = null;

    public function __construct(?PluginConfigService $pluginConfigService = null)
    {
        $this->pluginConfigService = $pluginConfigService ?? new PluginConfigService();
    }

    public function notifyTicketOpened(int $ticketId): void
    {
        $this->safeNotify(function () use ($ticketId): void {
            if ($ticketId <= 0) {
                return;
            }

            $conversation = $this->findOpenConversation($ticketId);
            if ($conversation === null) {
                $this->log('skip_no_conversation', ['ticket_id' => $ticketId]);
                return;
            }

            $text = sprintf(
                'Seu chamado #%d foi aberto. Nossa equipe acompanhará seu atendimento por aqui.',
                $ticketId
            );
            $this->sendOnce(
                $ticketId,
                $conversation,
                self::EVENT_TICKET_OPENED,
                null,
                'notify_ticket_opened_' . $ticketId,
                $text
            );
        }, 'ticket_opened', $ticketId);
    }

    public function notifyPublicFollowup(int $ticketId, int $followupId, string $content): void
    {
        $this->safeNotify(function () use ($ticketId, $followupId, $content): void {
            if ($ticketId <= 0 || $followupId <= 0) {
                return;
            }

            if ($this->isWhatsAppOriginFollowup($content)) {
                $this->log('followup][skip_whatsapp_origin', [
                    'ticket_id' => $ticketId,
                    'followup_id' => $followupId,
                ]);
                return;
            }

            $conversation = $this->findOpenConversation($ticketId);
            if ($conversation === null) {
                $this->log('skip_no_conversation', [
                    'ticket_id' => $ticketId,
                    'followup_id' => $followupId,
                ]);
                return;
            }

            if ($this->isAutomaticFollowup($content)) {
                $this->log('skip_automatic_followup', [
                    'ticket_id' => $ticketId,
                    'followup_id' => $followupId,
                ]);
                return;
            }

            $text = trim($this->plainText($content, 4000));
            if ($text === '') {
                $this->log('skip_empty_followup', [
                    'ticket_id' => $ticketId,
                    'followup_id' => $followupId,
                ]);
                return;
            }

            if ($this->matchesPendingSolutionContent($ticketId, $text)) {
                $this->log('followup][skip_solution_content', [
                    'ticket_id' => $ticketId,
                    'followup_id' => $followupId,
                ]);
                return;
            }

            $this->sendOnce(
                $ticketId,
                $conversation,
                self::EVENT_PUBLIC_FOLLOWUP,
                (string) $followupId,
                'notify_followup_' . $ticketId . '_' . $followupId,
                sprintf('Atualização no chamado #%d: %s', $ticketId, $text)
            );
        }, 'public_followup', $ticketId);
    }

    public function notifyTicketSolved(int $ticketId, ?int $solutionId = null): void
    {
        $this->safeNotify(function () use ($ticketId, $solutionId): void {
            if ($ticketId <= 0) {
                return;
            }

            if (!$this->isTicketSolved($ticketId)) {
                $this->log('solution][skip_ticket_not_solved', ['ticket_id' => $ticketId]);
                return;
            }

            $conversation = $this->findLinkedConversation($ticketId);
            if ($conversation === null) {
                $this->log('skip_no_conversation', ['ticket_id' => $ticketId]);
                return;
            }

            $solution = $this->findPendingTicketSolution($ticketId);
            if ($solution === null) {
                $this->log('solution][skip_no_pending_solution', [
                    'ticket_id' => $ticketId,
                    'hint_solution_id' => $solutionId,
                ]);

                $this->sendOnce(
                    $ticketId,
                    $conversation,
                    self::EVENT_TICKET_SOLVED,
                    null,
                    'notify_ticket_solved_' . $ticketId,
                    sprintf(
                        'Uma solução foi registrada no chamado #%d. Caso precise complementar, responda por aqui.',
                        $ticketId
                    ),
                    true
                );
                return;
            }

            $resolvedSolutionId = isset($solution['id']) ? (int) $solution['id'] : null;
            $solutionText = is_string($solution['content'] ?? null)
                ? $this->plainText((string) $solution['content'], 4000)
                : '';
            $idempotencyKey = $resolvedSolutionId !== null && $resolvedSolutionId > 0
                ? 'notify_ticket_solved_' . $ticketId . '_' . $resolvedSolutionId
                : 'notify_ticket_solved_' . $ticketId;

            $this->sendOnce(
                $ticketId,
                $conversation,
                self::EVENT_TICKET_SOLVED,
                $resolvedSolutionId !== null ? (string) $resolvedSolutionId : null,
                $idempotencyKey,
                sprintf(
                    'Uma solução foi registrada no chamado #%d. Caso precise complementar, responda por aqui.',
                    $ticketId
                ),
                true,
                [
                    'solution_id' => $resolvedSolutionId,
                    'solution_content' => $solutionText,
                    'solution_status' => isset($solution['status']) ? (int) $solution['status'] : null,
                ]
            );
        }, 'ticket_solved', $ticketId);
    }

    public function notifyTicketClosed(int $ticketId): void
    {
        $this->safeNotify(function () use ($ticketId): void {
            if ($ticketId <= 0) {
                return;
            }

            $conversation = $this->findLinkedConversation($ticketId);
            if ($conversation === null) {
                $this->log('skip_no_conversation', ['ticket_id' => $ticketId]);
                return;
            }

            $this->sendOnce(
                $ticketId,
                $conversation,
                self::EVENT_TICKET_CLOSED,
                null,
                'notify_ticket_closed_' . $ticketId,
                sprintf('Seu chamado #%d foi fechado com sucesso.', $ticketId)
            );
        }, 'ticket_closed', $ticketId);
    }

    public function sendTicketPending(int $ticketId, string $conversationId, string $dateMod): void
    {
        $this->safeNotify(function () use ($ticketId, $conversationId, $dateMod): void {
            $conversationId = trim($conversationId);
            $dateMod = trim($dateMod);
            if ($ticketId <= 0 || $conversationId === '' || $dateMod === '') {
                return;
            }

            $conversation = $this->findAssignableConversation($ticketId, $conversationId);
            if ($conversation === null) {
                $this->log('pending', [
                    'action' => 'skip_no_open_conversation',
                    'ticket_id' => $ticketId,
                    'conversation_id' => $conversationId,
                    'date_mod' => $dateMod,
                ]);
                return;
            }

            $this->log('pending', [
                'action' => 'send_attempt',
                'ticket_id' => $ticketId,
                'conversation_id' => $conversationId,
                'date_mod' => $dateMod,
            ]);

            $this->sendOnce(
                $ticketId,
                $conversation,
                self::EVENT_TICKET_PENDING,
                $dateMod,
                'notify_ticket_pending_' . $ticketId . '_' . $dateMod,
                sprintf(
                    'Seu chamado #%d foi marcado como pendente. Estamos aguardando uma ação/informação para continuar o atendimento.',
                    $ticketId
                )
            );
        }, 'ticket_pending', $ticketId);
    }

    public function sendTechnicianAssigned(int $ticketId, int $technicianId, string $conversationId): void
    {
        $this->safeNotify(function () use ($ticketId, $technicianId, $conversationId): void {
            $conversationId = trim($conversationId);
            if ($ticketId <= 0 || $technicianId <= 0 || $conversationId === '') {
                return;
            }

            $conversation = $this->findAssignableConversation($ticketId, $conversationId);
            if ($conversation === null) {
                $this->log('assigned', [
                    'action' => 'skip_no_open_conversation',
                    'ticket_id' => $ticketId,
                    'conversation_id' => $conversationId,
                    'technician_id' => $technicianId,
                ]);
                return;
            }

            $technicianName = $this->getTechnicianName($technicianId);
            $this->log('assigned', [
                'action' => 'send_attempt',
                'ticket_id' => $ticketId,
                'conversation_id' => $conversationId,
                'technician_id' => $technicianId,
            ]);

            $this->sendOnce(
                $ticketId,
                $conversation,
                self::EVENT_TECHNICIAN_ASSIGNED,
                (string) $technicianId,
                // Product rule: send at most one assignment notification per
                // technician for the same conversation. A reopen + same
                // technician intentionally reuses this key and is skipped by
                // idempotency; a different technician gets a different key.
                'notify_ticket_assigned_' . $ticketId . '_' . $conversationId . '_' . $technicianId,
                sprintf('O técnico %s assumiu seu atendimento no chamado #%d.', $technicianName, $ticketId)
            );
        }, 'technician_assigned', $ticketId);
    }

    public function sendTicketTransferred(int $ticketId, string $conversationId, int $newTechnicianId): void
    {
        $this->safeNotify(function () use ($ticketId, $conversationId, $newTechnicianId): void {
            $conversationId = trim($conversationId);
            if ($ticketId <= 0 || $newTechnicianId <= 0 || $conversationId === '') {
                return;
            }

            $conversation = $this->findAssignableConversation($ticketId, $conversationId);
            if ($conversation === null) {
                $this->log('transfer', [
                    'action' => 'skip_no_open_conversation',
                    'ticket_id' => $ticketId,
                    'conversation_id' => $conversationId,
                    'technician_id' => $newTechnicianId,
                ]);
                return;
            }

            $technicianName = $this->getTechnicianName($newTechnicianId);
            $this->log('transfer', [
                'action' => 'send_attempt',
                'ticket_id' => $ticketId,
                'conversation_id' => $conversationId,
                'technician_id' => $newTechnicianId,
            ]);

            $this->sendOnce(
                $ticketId,
                $conversation,
                self::EVENT_TICKET_TRANSFERRED,
                (string) $newTechnicianId,
                'notify_ticket_transferred_' . $ticketId . '_' . $conversationId . '_' . $newTechnicianId,
                sprintf('O atendimento do chamado #%d foi transferido para %s.', $ticketId, $technicianName)
            );
        }, 'ticket_transferred', $ticketId);
    }

    /**
     * @param callable(): void $callback
     */
    private function safeNotify(callable $callback, string $stage, int $ticketId): void
    {
        try {
            if (!$this->pluginConfigService->isConfigured()) {
                $this->log('skip_not_configured', [
                    'stage' => $stage,
                    'ticket_id' => $ticketId,
                ]);
                return;
            }

            $callback();
        } catch (Throwable $exception) {
            $this->log('error', [
                'stage' => $stage,
                'ticket_id' => $ticketId,
                'message' => $exception->getMessage(),
            ]);
        }
    }

    /**
     * @return array<string, mixed>|null
     */
    private function findOpenConversation(int $ticketId): ?array
    {
        $conversation = $this->findLinkedConversation($ticketId);
        if ($conversation === null) {
            return null;
        }

        $conversationStatus = strtolower((string) ($conversation['conversation_status'] ?? ''));
        $runtimeStatus = strtolower((string) ($conversation['runtime_status'] ?? ''));
        if ($conversationStatus === 'closed' || $runtimeStatus === 'closed') {
            $this->log('skip_closed_conversation', [
                'ticket_id' => $ticketId,
                'conversation_id' => (string) ($conversation['conversation_id'] ?? ''),
            ]);
            return null;
        }

        return $conversation;
    }

    /**
     * @return array<string, mixed>|null
     */
    private function findLinkedConversation(int $ticketId): ?array
    {
        return $this->getConversationRepository()->findByTicketId($ticketId);
    }

    /**
     * @return array<string, mixed>|null
     */
    private function findAssignableConversation(int $ticketId, string $conversationId): ?array
    {
        $conversation = $this->getConversationRepository()->findBoundToTicket($ticketId, $conversationId);
        if ($conversation === null) {
            return null;
        }

        $conversationStatus = strtolower((string) ($conversation['conversation_status'] ?? ''));
        $runtimeStatus = strtolower((string) ($conversation['runtime_status'] ?? ''));
        if ($conversationStatus === 'closed' || $runtimeStatus === 'closed') {
            return null;
        }

        return $conversation;
    }

    /**
     * @param array<string, mixed> $conversation
     */
    private function sendOnce(
        int $ticketId,
        array $conversation,
        string $eventType,
        ?string $eventItemId,
        string $idempotencyKey,
        string $text,
        bool $preferSolutionButtons = false,
        array $extraPayload = []
    ): void {
        $conversationId = (string) ($conversation['conversation_id'] ?? '');
        if ($conversationId === '') {
            return;
        }

        $reserved = $this->getNotificationRepository()->reserve(
            $ticketId,
            $conversationId,
            $eventType,
            $eventItemId,
            $idempotencyKey
        );
        if (!$reserved) {
            $this->log('skip_duplicate', [
                'ticket_id' => $ticketId,
                'conversation_id' => $conversationId,
                'event_type' => $eventType,
                'event_item_id' => $eventItemId,
                'idempotency_key' => $idempotencyKey,
                'reason' => 'idempotency_key_already_reserved',
            ]);
            return;
        }

        $payload = [
            'ticket_id' => $ticketId,
            'conversation_id' => $conversationId,
            'glpi_user_id' => $this->getPositiveGlpiUserId(),
            'idempotency_key' => $idempotencyKey,
        ];
        foreach ($extraPayload as $key => $value) {
            if ($value !== null && $value !== '') {
                $payload[$key] = $value;
            }
        }

        if (!$preferSolutionButtons) {
            $payload['text'] = $text;
            $payload['message_type'] = 'text';
        }

        try {
            $client = new IntegrationServiceClient($this->pluginConfigService);
            $result = $preferSolutionButtons
                ? $client->sendTicketSolvedNotification($payload)
                : $client->sendOutbound($payload);
            if (!$result['success']) {
                $message = 'integration-service returned HTTP ' . (int) $result['status'];
                $this->getNotificationRepository()->markFailed($idempotencyKey, $message);
                $this->log('send_failed', [
                    'ticket_id' => $ticketId,
                    'conversation_id' => $conversationId,
                    'idempotency_key' => $idempotencyKey,
                    'status' => (int) $result['status'],
                ]);
                return;
            }

            $this->getNotificationRepository()->markSent($idempotencyKey);
            $this->log('sent', [
                'ticket_id' => $ticketId,
                'conversation_id' => $conversationId,
                'idempotency_key' => $idempotencyKey,
            ]);
        } catch (Throwable $exception) {
            $this->getNotificationRepository()->markFailed($idempotencyKey, $exception->getMessage());
            $this->log('send_exception', [
                'ticket_id' => $ticketId,
                'conversation_id' => $conversationId,
                'idempotency_key' => $idempotencyKey,
                'message' => $exception->getMessage(),
            ]);
        }
    }

    private function getPositiveGlpiUserId(): int
    {
        $userId = (int) Session::getLoginUserID();
        if ($userId > 0) {
            return $userId;
        }

        // Node validates glpi_user_id as a positive integer. System hooks may run
        // without an interactive user, so use the conventional GLPI super-admin id.
        return 1;
    }

    private function isTicketSolved(int $ticketId): bool
    {
        try {
            $ticket = new \Ticket();
            if (!$ticket->getFromDB($ticketId)) {
                return false;
            }

            return (int) ($ticket->fields['status'] ?? 0) === \CommonITILObject::SOLVED;
        } catch (Throwable) {
            return false;
        }
    }

    /**
     * @return array<string, mixed>|null
     */
    private function findPendingTicketSolution(int $ticketId): ?array
    {
        global $DB;

        if (!isset($DB)) {
            return null;
        }

        $ticketId = max(0, $ticketId);
        $result = @$DB->doQuery(
            "SELECT `id`, `content`, `status`, `date_creation`, `users_id`, `date_approval`, `users_id_approval` "
            . "FROM `glpi_itilsolutions` "
            . "WHERE `itemtype` = 'Ticket' "
            . "AND `items_id` = " . $ticketId . " "
            . "AND `status` = 2 "
            . "AND `date_approval` IS NULL "
            . "AND `users_id_approval` = 0 "
            . "ORDER BY `id` DESC "
            . "LIMIT 1"
        );

        if (!$result) {
            $this->log('solution][pending_lookup_failed', [
                'ticket_id' => $ticketId,
                'error' => method_exists($DB, 'error') ? (string) $DB->error() : 'unknown',
            ]);
            return null;
        }

        $row = null;
        if (method_exists($DB, 'fetchAssoc')) {
            $fetched = $DB->fetchAssoc($result);
            $row = is_array($fetched) ? $fetched : null;
        } elseif (function_exists('mysqli_fetch_assoc')) {
            $fetched = @mysqli_fetch_assoc($result);
            $row = is_array($fetched) ? $fetched : null;
        }

        if (is_array($row)) {
            return [
                'id' => (int) ($row['id'] ?? 0),
                'content' => (string) ($row['content'] ?? ''),
                'status' => isset($row['status']) ? (int) $row['status'] : null,
                'date_creation' => (string) ($row['date_creation'] ?? ''),
                'users_id' => isset($row['users_id']) ? (int) $row['users_id'] : null,
                'date_approval' => (string) ($row['date_approval'] ?? ''),
                'users_id_approval' => isset($row['users_id_approval']) ? (int) $row['users_id_approval'] : null,
            ];
        }

        return null;
    }

    private function matchesPendingSolutionContent(int $ticketId, string $followupText): bool
    {
        $solution = $this->findPendingTicketSolution($ticketId);
        if ($solution === null) {
            return false;
        }

        $solutionText = trim($this->plainText((string) ($solution['content'] ?? ''), 4000));
        if ($solutionText === '' || $followupText === '') {
            return false;
        }

        return hash_equals($solutionText, $followupText);
    }

    private function plainText(string $content, int $limit = 1500): string
    {
        $content = preg_replace('/<\s*br\s*\/?>/i', "\n", $content) ?? $content;
        $content = preg_replace('/<\s*\/\s*(p|div|li|tr|h[1-6])\s*>/i', "\n", $content) ?? $content;

        $text = html_entity_decode(strip_tags($content), ENT_QUOTES | ENT_HTML5, 'UTF-8');
        $text = str_replace(["\r\n", "\r"], "\n", $text);
        $lines = array_map(
            static fn (string $line): string => trim(preg_replace('/[ \t]+/', ' ', $line) ?? $line),
            explode("\n", $text)
        );
        $text = preg_replace("/\n{3,}/", "\n\n", trim(implode("\n", $lines))) ?? '';

        $text = trim((string) $text);
        if (function_exists('mb_substr')) {
            return mb_substr($text, 0, $limit);
        }

        return substr($text, 0, $limit);
    }

    private function isAutomaticFollowup(string $content): bool
    {
        $text = strtolower($this->plainText($content, 500));

        return str_contains($text, '[integaglpi-notification]')
            || str_contains($text, '[integaglpi notification]')
            || str_contains($text, 'integaglpi automatic notification')
            || str_contains($text, 'whatsapp: atendimento assumido')
            || str_contains($text, 'whatsapp: atendimento transferido');
    }

    private function isWhatsAppOriginFollowup(string $content): bool
    {
        $text = strtolower($this->plainText($content, 1000));

        return str_contains($text, 'mensagem recebida via whatsapp')
            || str_contains($text, 'origem: whatsapp')
            || str_contains($text, 'origem whatsapp');
    }

    private function getTechnicianName(int $technicianId): string
    {
        $name = '';

        try {
            if (class_exists('\User') && method_exists('\User', 'getName')) {
                $candidate = \User::getName($technicianId);
                if (is_string($candidate)) {
                    $name = trim($candidate);
                }
            }
        } catch (Throwable) {
            $name = '';
        }

        if ($name === '' && function_exists('getUserName')) {
            $name = trim((string) getUserName($technicianId));
        }

        return $name !== '' ? $name : 'Um de nossos técnicos';
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

    private function getConversationRepository(): ConversationRepository
    {
        if ($this->conversationRepository instanceof ConversationRepository) {
            return $this->conversationRepository;
        }

        $this->conversationRepository = new ConversationRepository($this->getPdo());

        return $this->conversationRepository;
    }

    private function getNotificationRepository(): NotificationRepository
    {
        if ($this->notificationRepository instanceof NotificationRepository) {
            return $this->notificationRepository;
        }

        $this->notificationRepository = new NotificationRepository($this->getPdo());

        return $this->notificationRepository;
    }

    /**
     * @param array<string, mixed> $context
     */
    private function log(string $event, array $context): void
    {
        error_log('[integaglpi][notification][' . $event . '] ' . json_encode(
            $context,
            JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES
        ));
    }
}
