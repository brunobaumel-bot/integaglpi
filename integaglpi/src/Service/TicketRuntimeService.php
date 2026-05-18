<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi\Service;

use Dropdown;
use GlpiPlugin\Integaglpi\External\ExternalDatabase;
use GlpiPlugin\Integaglpi\External\ExternalSchemaManager;
use GlpiPlugin\Integaglpi\External\Repository\ConversationRepository;
use GlpiPlugin\Integaglpi\External\Repository\MessageRepository;
use PDO;
use RuntimeException;
use Throwable;

final class TicketRuntimeService
{
    private PluginConfigService $pluginConfigService;

    private ?PDO $pdo = null;

    private ?ConversationRepository $conversationRepository = null;

    private ?MessageRepository $messageRepository = null;

    private ?QueueService $queueService = null;

    public function __construct(?PluginConfigService $pluginConfigService = null)
    {
        $this->pluginConfigService = $pluginConfigService ?? new PluginConfigService();
    }

    public function isExternalConfigured(): bool
    {
        return $this->pluginConfigService->isConfigured();
    }

    /**
     * @return array<string, mixed>
     */
    public function getConnectionConfig(): array
    {
        return $this->pluginConfigService->getConnectionConfig();
    }

    /**
     * @return array<string, mixed>|null
     */
    public function getRuntimeByTicketId(int $ticketId): ?array
    {
        if (!$this->isExternalConfigured()) {
            return null;
        }

        $conversation = $this->getConversationRepository()->findByTicketId($ticketId);
        if ($conversation === null) {
            return null;
        }

        $runtime = $this->getConversationRepository()->ensureRuntime($conversation);

        return $this->decorateRuntime($runtime);
    }

    /**
     * @return list<array<string, mixed>>
     */
    public function getMessagesForTicket(int $ticketId): array
    {
        $runtime = $this->getRuntimeByTicketId($ticketId);
        if ($runtime === null) {
            return [];
        }

        return $this->getMessageRepository()->findByConversationId((string) $runtime['conversation_id']);
    }

    public function claim(int $ticketId, string $conversationId, int $userId): void
    {
        $runtime = $this->requireRuntime($ticketId, $conversationId);
        if ((string) ($runtime['conversation_status'] ?? 'open') === 'closed') {
            throw new RuntimeException(__('Cannot assume a closed WhatsApp conversation.', 'glpiintegaglpi'));
        }
        $previousAssignedUserId = (int) ($runtime['assigned_user_id'] ?? 0);

        $queue = !empty($runtime['queue_id']) ? $this->getQueueService()->getQueueById((int) $runtime['queue_id']) : null;
        $groupId = isset($queue['default_group_id']) && (int) $queue['default_group_id'] > 0
            ? (int) $queue['default_group_id']
            : null;

        // Primary effect: always claim in PostgreSQL (runtime) first.
        $this->getConversationRepository()->claim($ticketId, $conversationId, $userId, $groupId);

        // Secondary effect: try to assign the GLPI ticket; failures must be logged but must not revert the claim.
        try {
            $this->ensureTicketUserAssignment($ticketId, $userId);
            if ($groupId !== null) {
                $this->ensureTicketGroupAssignment($ticketId, $groupId);
            }
        } catch (Throwable $e) {
            error_log('[integaglpi][ticket][assign][error] ' . $e->getMessage());
            error_log($e->getTraceAsString());
        }

        $this->recordTicketHistory(
            $ticketId,
            sprintf(
                'WhatsApp: atendimento assumido por %s.',
                (string) getUserName($userId)
            ),
            $userId
        );

        if ($previousAssignedUserId !== $userId) {
            (new NotificationService($this->pluginConfigService))->sendTechnicianAssigned(
                $ticketId,
                $userId,
                $conversationId
            );
        }
    }

    public function assignTicketToTechnicianFromCentral(int $ticketId, int $userId): bool
    {
        try {
            $this->ensureTicketUserAssignment($ticketId, $userId);
            $this->recordTicketHistory(
                $ticketId,
                sprintf(
                    'WhatsApp: atendimento assumido pela Central por %s.',
                    (string) getUserName($userId)
                ),
                $userId
            );

            return true;
        } catch (Throwable $e) {
            error_log('[integaglpi][central][claim][glpi_assign_error] ' . json_encode([
                'ticket_id' => $ticketId,
                'user_id'   => $userId,
                'message'   => $e->getMessage(),
            ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

            return false;
        }
    }

    public function assignTicketToTechnicianFromTransfer(int $ticketId, int $userId, int $actorUserId): bool
    {
        try {
            $this->ensureTicketUserAssignment($ticketId, $userId);
            $this->recordTicketHistory(
                $ticketId,
                sprintf(
                    'WhatsApp: atendimento transferido pela Central para %s.',
                    (string) getUserName($userId)
                ),
                $actorUserId
            );

            return true;
        } catch (Throwable $e) {
            error_log('[integaglpi][central][transfer][glpi_assign_error] ' . json_encode([
                'ticket_id' => $ticketId,
                'user_id'   => $userId,
                'actor_id'  => $actorUserId,
                'message'   => $e->getMessage(),
            ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

            return false;
        }
    }

    public function close(int $ticketId, string $conversationId, int $actorUserId): void
    {
        $runtime = $this->requireRuntime($ticketId, $conversationId);
        if ((string) ($runtime['conversation_status'] ?? 'open') === 'closed') {
            throw new RuntimeException(__('This WhatsApp conversation is already closed.', 'glpiintegaglpi'));
        }

        $this->getConversationRepository()->close($ticketId, $conversationId);
        $this->recordTicketHistory(
            $ticketId,
            sprintf(
                'WhatsApp: conversa encerrada por %s.',
                (string) getUserName($actorUserId)
            ),
            $actorUserId
        );
    }

    public function reopen(int $ticketId, string $conversationId, int $actorUserId): void
    {
        $runtime = $this->requireRuntime($ticketId, $conversationId);
        if ((string) ($runtime['status'] ?? 'open') !== 'closed') {
            throw new RuntimeException(__('This WhatsApp conversation is not closed.', 'glpiintegaglpi'));
        }

        $this->getConversationRepository()->reopen($ticketId, $conversationId);

        error_log('[integaglpi][action][REOPEN] ' . json_encode([
            'conversation_id' => $conversationId,
            'ticket_id'       => $ticketId,
            'actor_user_id'   => $actorUserId,
        ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

        $this->recordTicketHistory(
            $ticketId,
            sprintf(
                'WhatsApp: conversa reaberta por %s.',
                (string) getUserName($actorUserId)
            ),
            $actorUserId
        );
    }

    public function transfer(int $ticketId, string $conversationId, int $queueId, int $actorUserId): void
    {
        $runtime = $this->requireRuntime($ticketId, $conversationId);
        if ((string) ($runtime['conversation_status'] ?? 'open') === 'closed') {
            throw new RuntimeException(__('Closed WhatsApp conversations cannot be transferred.', 'glpiintegaglpi'));
        }

        $queue = $this->getQueueService()->getQueueById($queueId);
        if ($queue === null || !(bool) $queue['is_active']) {
            throw new RuntimeException(__('Selected queue is invalid or inactive.', 'glpiintegaglpi'));
        }

        $groupId = isset($queue['default_group_id']) && (int) $queue['default_group_id'] > 0
            ? (int) $queue['default_group_id']
            : null;

        // Primary effect: always transfer in PostgreSQL (runtime) first.
        $this->getConversationRepository()->transfer($ticketId, $conversationId, $queueId, $groupId);

        // Secondary effect: try to assign the GLPI group (if any); failure must not revert the transfer.
        if ($groupId !== null) {
            try {
                $this->ensureTicketGroupAssignment($ticketId, $groupId);
            } catch (Throwable $e) {
                error_log('[integaglpi][ticket][assign][error] ' . $e->getMessage());
                error_log($e->getTraceAsString());
            }
        }

        $this->recordTicketHistory(
            $ticketId,
            sprintf(
                'Conversa WhatsApp transferida para a fila %s.',
                (string) ($queue['name'] ?? (string) $queueId),
            ),
            $actorUserId
        );
    }

    /**
     * @return list<array<string, mixed>>
     */
    public function getQueues(): array
    {
        if (!$this->isExternalConfigured()) {
            return [];
        }

        return $this->getQueueService()->getActiveQueues();
    }

    public function resolveAssignedUserLabel(?int $userId): string
    {
        if ($userId === null || $userId <= 0) {
            return __('Unassigned', 'glpiintegaglpi');
        }

        return (string) getUserName($userId);
    }

    public function resolveGroupLabel(?int $groupId): string
    {
        if ($groupId === null || $groupId <= 0) {
            return __('No group', 'glpiintegaglpi');
        }

        return (string) Dropdown::getDropdownName('glpi_groups', $groupId);
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

    private function getMessageRepository(): MessageRepository
    {
        if ($this->messageRepository instanceof MessageRepository) {
            return $this->messageRepository;
        }

        $this->messageRepository = new MessageRepository($this->getPdo());

        return $this->messageRepository;
    }

    private function getQueueService(): QueueService
    {
        if ($this->queueService instanceof QueueService) {
            return $this->queueService;
        }

        $this->queueService = new QueueService($this->pluginConfigService);

        return $this->queueService;
    }

    /**
     * @return array<string, mixed>
     */
    private function requireRuntime(int $ticketId, string $conversationId): array
    {
        if (!$this->isExternalConfigured()) {
            throw new RuntimeException(__('Configure the external PostgreSQL connection before operating WhatsApp conversations.', 'glpiintegaglpi'));
        }

        $conversationId = trim($conversationId);
        if ($ticketId <= 0 || $conversationId === '') {
            throw new RuntimeException(__('A valid ticket and conversation context is required.', 'glpiintegaglpi'));
        }

        $runtime = $this->getConversationRepository()->findBoundToTicket($ticketId, $conversationId);
        if ($runtime === null) {
            throw new RuntimeException(__('The selected WhatsApp conversation does not belong to this ticket.', 'glpiintegaglpi'));
        }

        return $this->decorateRuntime($this->getConversationRepository()->ensureRuntime($runtime));
    }

    /**
     * @param array<string, mixed> $runtime
     * @return array<string, mixed>
     */
    private function decorateRuntime(array $runtime): array
    {
        $runtimeStatus = strtolower(trim((string) ($runtime['runtime_status'] ?? '')));
        $conversationStatus = strtolower(trim((string) ($runtime['conversation_status'] ?? '')));
        $effectiveStatus = $conversationStatus !== ''
            ? $conversationStatus
            : ($runtimeStatus !== '' ? $runtimeStatus : 'open');
        $isClosed = $effectiveStatus === 'closed';
        // assigned_user_id is the source of truth for "quem está com o atendimento".
        // claimed_at pode permanecer após transferência de fila (assigned limpo); não deve esconder "Assumir".
        $assignedUserId = isset($runtime['assigned_user_id']) ? (int) $runtime['assigned_user_id'] : 0;
        if ($assignedUserId < 0) {
            $assignedUserId = 0;
        }
        $isClaimed = !$isClosed && $assignedUserId > 0;
        // Reatribuição: claim atualiza assigned_user_id; permitir sempre que a conversa estiver aberta.
        $runtime['can_claim'] = !$isClosed;

        $runtime['status'] = $effectiveStatus;
        $runtime['is_closed'] = $isClosed;
        $runtime['is_claimed'] = $isClaimed;
        $runtime['can_transfer'] = !$isClosed;
        $runtime['can_close'] = !$isClosed;
        $runtime['assigned_user_id_int'] = $assignedUserId;
        $runtime['assigned_user_label'] = $this->resolveAssignedUserLabel(
            $assignedUserId > 0 ? $assignedUserId : null
        );
        $runtime['assigned_group_label'] = $this->resolveGroupLabel(
            isset($runtime['assigned_group_id']) ? (int) $runtime['assigned_group_id'] : null
        );
        $runtime['queue_default_group_label'] = $this->resolveGroupLabel(
            isset($runtime['queue_default_group_id']) ? (int) $runtime['queue_default_group_id'] : null
        );
        $runtime['queue_label'] = !empty($runtime['queue_name'])
            ? (string) $runtime['queue_name']
            : __('No queue', 'glpiintegaglpi');
        $runtime['contact_profile_snapshot'] = $this->decodeProfileSnapshot($runtime['profile_snapshot_json'] ?? null);

        return $runtime;
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

    private function ensureTicketUserAssignment(int $ticketId, int $userId): void
    {
        if (!class_exists('\Ticket_User')) {
            throw new RuntimeException(__('GLPI Ticket_User class is not available.', 'glpiintegaglpi'));
        }

        $type = $this->getAssignedActorType();
        $ticketUser = new \Ticket_User();
        $criteria = [
            'tickets_id' => $ticketId,
            'users_id'   => $userId,
            'type'       => $type,
        ];

        if ($ticketUser->getFromDBByCrit($criteria)) {
            return;
        }

        $created = $ticketUser->add($criteria + [
            'use_notification' => 1,
        ]);

        if ($created === false || (int) $created <= 0) {
            throw new RuntimeException(__('Failed to assign the GLPI ticket to the current technician.', 'glpiintegaglpi'));
        }
    }

    private function ensureTicketGroupAssignment(int $ticketId, int $groupId): void
    {
        if ($groupId <= 0) {
            return;
        }

        if (!class_exists('\Group_Ticket')) {
            throw new RuntimeException(__('GLPI Group_Ticket class is not available.', 'glpiintegaglpi'));
        }

        $type = $this->getAssignedActorType();
        $existing = new \Group_Ticket();

        if (
            $existing->getFromDBByCrit([
                'tickets_id' => $ticketId,
                'groups_id'  => $groupId,
                'type'       => $type,
            ])
        ) {
            return;
        }

        $assignedGroup = new \Group_Ticket();
        if (
            $assignedGroup->getFromDBByCrit([
                'tickets_id' => $ticketId,
                'type'       => $type,
            ])
        ) {
            $updated = $assignedGroup->update([
                'id'         => (int) $assignedGroup->fields['id'],
                'tickets_id' => $ticketId,
                'groups_id'  => $groupId,
                'type'       => $type,
            ]);

            if ($updated === false) {
                throw new RuntimeException(__('Failed to update the assigned GLPI ticket group.', 'glpiintegaglpi'));
            }

            return;
        }

        $created = $assignedGroup->add([
            'tickets_id' => $ticketId,
            'groups_id'  => $groupId,
            'type'       => $type,
        ]);

        if ($created === false || (int) $created <= 0) {
            throw new RuntimeException(__('Failed to assign the GLPI ticket group.', 'glpiintegaglpi'));
        }
    }

    private function getAssignedActorType(): int
    {
        if (defined('CommonITILActor::ASSIGN')) {
            return (int) constant('CommonITILActor::ASSIGN');
        }

        return 2;
    }

    private function recordTicketHistory(int $ticketId, string $message, ?int $actorUserId = null): void
    {
        $this->writeHistory($ticketId, $message);
        $this->addFollowup($ticketId, $message, $actorUserId);
    }

    private function writeHistory(int $ticketId, string $message): void
    {
        try {
            if (!class_exists('\Log')) {
                return;
            }

            // GLPI 11: Log::history expects [$id_search_option, $old, $new].
            // We use a best-effort approach; failure must never abort the main action.
            \Log::history($ticketId, 'Ticket', [0, '', $message]);
        } catch (\Throwable $e) {
            error_log('[integaglpi][history] writeHistory failed for ticket=' . $ticketId . ': ' . $e->getMessage());
        }
    }

    private function addFollowup(int $ticketId, string $message, ?int $actorUserId): void
    {
        try {
            if (!class_exists('\ITILFollowup')) {
                return;
            }

            $followup = new \ITILFollowup();
            $payload = [
                'itemtype'   => 'Ticket',
                'items_id'   => $ticketId,
                'content'    => $message,
                'is_private' => 0,
            ];

            if ($actorUserId !== null && $actorUserId > 0) {
                $payload['users_id'] = $actorUserId;
            }

            $followup->add($payload);
        } catch (\Throwable $e) {
            error_log('[integaglpi][history] addFollowup failed for ticket=' . $ticketId . ': ' . $e->getMessage());
        }
    }
}
