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
    private const EVENT_TICKET_DOCUMENT_ADDED = 'ticket_document_added';

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

    public function notifyTicketDocumentAdded(
        int $ticketId,
        int $documentItemId,
        int $documentId,
        string $sourceType
    ): void {
        $this->safeNotify(function () use ($ticketId, $documentItemId, $documentId, $sourceType): void {
            if ($ticketId <= 0 || $documentItemId <= 0 || $documentId <= 0) {
                return;
            }

            $conversation = $this->findOpenConversation($ticketId);
            if ($conversation === null) {
                $this->log('document][skip_no_conversation', [
                    'ticket_id' => $ticketId,
                    'document_item_id' => $documentItemId,
                    'document_id' => $documentId,
                ]);
                return;
            }

            $documentName = $this->getDocumentDisplayName($documentId);
            $fallbackText = null;
            $mediaPayload = $this->buildDocumentOutboundPayload($documentId, $fallbackText);
            $text = $mediaPayload !== null
                ? sprintf(
                    'Anexo do chamado #%d%s.',
                    $ticketId,
                    $documentName !== '' ? ': ' . $documentName : ''
                )
                : ($fallbackText ?? sprintf(
                    'Não consegui enviar o anexo pelo WhatsApp. Acesse o GLPI para visualizar o arquivo.%s',
                    $documentName !== '' ? ' Arquivo: ' . $documentName . '.' : ''
                ));

            $this->sendOnce(
                $ticketId,
                $conversation,
                self::EVENT_TICKET_DOCUMENT_ADDED,
                (string) $documentItemId,
                'notify_document_' . $ticketId . '_' . $documentItemId,
                $text,
                false,
                [
                    'document_id' => $documentId,
                    'document_source_type' => $sourceType,
                    ...($mediaPayload ?? []),
                ]
            );
        }, 'ticket_document_added', $ticketId);
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

    public function sendTechnicianAssigned(
        int $ticketId,
        int $technicianId,
        string $conversationId,
        ?int $previousTechnicianId = null
    ): void
    {
        $this->safeNotify(function () use ($ticketId, $technicianId, $conversationId, $previousTechnicianId): void {
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

            $previousKeyPart = $previousTechnicianId !== null && $previousTechnicianId > 0
                ? (string) $previousTechnicianId
                : 'none';

            $this->sendOnce(
                $ticketId,
                $conversation,
                self::EVENT_TECHNICIAN_ASSIGNED,
                (string) $technicianId,
                // Idempotent per ownership transition. Duplicate clicks for the
                // same transition are skipped, but assigning back to a previous
                // technician after a transfer still notifies the customer.
                'notify_ticket_assigned_' . $ticketId . '_' . $conversationId . '_' . $previousKeyPart . '_' . $technicianId,
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
            if (!isset($payload['message_type'])) {
                $payload['message_type'] = 'text';
            }
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

    private function getDocumentDisplayName(int $documentId): string
    {
        try {
            if (!class_exists('\Document')) {
                return '';
            }

            $document = new \Document();
            if (!$document->getFromDB($documentId)) {
                return '';
            }

            foreach (['name', 'filename', 'filepath'] as $field) {
                $value = trim((string) ($document->fields[$field] ?? ''));
                if ($value !== '') {
                    return $this->plainText($value, 160);
                }
            }
        } catch (Throwable $exception) {
            $this->log('document][name_lookup_failed', [
                'document_id' => $documentId,
                'message' => $exception->getMessage(),
            ]);
        }

        return '';
    }

    /**
     * @return array<string, mixed>|null
     */
    private function buildDocumentOutboundPayload(int $documentId, ?string &$fallbackText = null): ?array
    {
        try {
            if (!class_exists('\Document')) {
                return null;
            }

            $document = new \Document();
            if (!$document->getFromDB($documentId)) {
                return null;
            }

            $path = $this->resolveDocumentPath($document);
            if ($path === null || !is_readable($path)) {
                $this->log('document][skip_unreadable_file', ['document_id' => $documentId]);
                $fallbackText = 'Não consegui enviar o anexo pelo WhatsApp. Acesse o GLPI para visualizar o arquivo.';
                return null;
            }

            $size = filesize($path);
            if ($size === false || $size <= 0) {
                $this->log('document][skip_invalid_size', ['document_id' => $documentId, 'size' => $size ?: 0]);
                $fallbackText = 'Não consegui enviar o anexo pelo WhatsApp porque o arquivo excede o limite permitido. Acesse o GLPI para visualizar.';
                return null;
            }

            $mime = $this->resolveDocumentMime($document, $path);
            $messageType = $this->outboundMessageTypeForMime($mime);
            if (!in_array($mime, [
                'application/pdf',
                'image/jpeg',
                'image/png',
                'image/gif',
                'audio/ogg',
                'audio/mpeg',
                'audio/mp4',
                'audio/aac',
                'audio/webm',
                'video/mp4',
                'video/3gpp',
            ], true)) {
                $this->log('document][skip_unsupported_mime', ['document_id' => $documentId, 'mime' => $mime]);
                $fallbackText = 'Formato de arquivo não suportado para envio via WhatsApp.';
                return null;
            }

            if ($size > $this->outboundMaxBytesForMime($mime)) {
                $this->log('document][skip_invalid_size', ['document_id' => $documentId, 'size' => $size ?: 0]);
                $fallbackText = 'Não consegui enviar o anexo pelo WhatsApp porque o arquivo excede o limite permitido. Acesse o GLPI para visualizar.';
                return null;
            }

            $content = file_get_contents($path);
            if ($content === false || $content === '') {
                return null;
            }

            return [
                'message_type' => $messageType,
                'media' => [
                    'document_id' => $documentId,
                    'filename' => $this->resolveDocumentFilename($document, $path),
                    'mime_type' => $mime,
                    'content_base64' => base64_encode($content),
                ],
            ];
        } catch (Throwable $exception) {
            $this->log('document][payload_failed', [
                'document_id' => $documentId,
                'message' => $exception->getMessage(),
            ]);
            return null;
        }
    }

    private function resolveDocumentPath(\Document $document): ?string
    {
        $filepath = trim((string) ($document->fields['filepath'] ?? ''));
        $candidates = [];
        $docRoot = defined('GLPI_DOC_DIR') ? realpath((string) GLPI_DOC_DIR) : false;

        if ($filepath !== '') {
            if (preg_match('/^(?:[A-Za-z]:[\\\\\\/]|\\\\\\\\|\\/)/', $filepath) === 1) {
                $candidates[] = $filepath;
            } elseif (defined('GLPI_DOC_DIR')) {
                $base = rtrim((string) GLPI_DOC_DIR, '/\\');
                $relative = ltrim($filepath, '/\\');
                $candidates[] = $base . DIRECTORY_SEPARATOR . $relative;
                $candidates[] = $base . DIRECTORY_SEPARATOR . '_uploads' . DIRECTORY_SEPARATOR . $relative;
                $candidates[] = $base . DIRECTORY_SEPARATOR . '_uploads' . DIRECTORY_SEPARATOR . basename($relative);
            }
        }

        foreach ($candidates as $candidate) {
            $realCandidate = realpath($candidate);
            if ($realCandidate === false || !is_readable($realCandidate)) {
                continue;
            }

            if ($docRoot !== false && !str_starts_with($realCandidate, rtrim($docRoot, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR)) {
                $this->log('document][skip_path_outside_glpi_doc_dir', [
                    'document_id' => (int) ($document->fields['id'] ?? 0),
                ]);
                continue;
            }

            return $realCandidate;
        }

        return null;
    }

    private function outboundMessageTypeForMime(string $mime): string
    {
        $mime = strtolower(trim(explode(';', $mime, 2)[0]));
        if (str_starts_with($mime, 'image/')) {
            return 'image';
        }
        if (str_starts_with($mime, 'audio/')) {
            return 'audio';
        }
        if (str_starts_with($mime, 'video/')) {
            return 'video';
        }

        return 'document';
    }

    private function outboundMaxBytesForMime(string $mime): int
    {
        $messageType = $this->outboundMessageTypeForMime($mime);
        if ($messageType === 'audio') {
            return 16 * 1024 * 1024;
        }
        if ($messageType === 'video') {
            return 64 * 1024 * 1024;
        }

        return 15_728_640;
    }

    private function resolveDocumentMime(\Document $document, string $path): string
    {
        $mime = strtolower(trim((string) ($document->fields['mime'] ?? $document->fields['mime_type'] ?? '')));
        if ($mime !== '') {
            return explode(';', $mime, 2)[0];
        }

        $detected = function_exists('mime_content_type') ? @mime_content_type($path) : false;
        return is_string($detected) && $detected !== '' ? strtolower(explode(';', $detected, 2)[0]) : 'application/octet-stream';
    }

    private function resolveDocumentFilename(\Document $document, string $path): string
    {
        foreach (['filename', 'name'] as $field) {
            $value = trim((string) ($document->fields[$field] ?? ''));
            if ($value !== '') {
                return basename(str_replace(['\\', '/'], DIRECTORY_SEPARATOR, $value));
            }
        }

        return basename($path) ?: 'document.pdf';
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
