<?php

declare(strict_types=1);

function plugin_integaglpi_activate(): bool
{
    return true;
}

function plugin_integaglpi_deactivate(): bool
{
    return true;
}

/**
 * Disparado pelo GLPI após atualização de qualquer Ticket.
 * - PENDING (4): notifica o cliente (transição de outro status para pendente).
 * - SOLVED (5) / CLOSED (6): notifica e sincroniza fechamento no PostgreSQL.
 */
function plugin_integaglpi_ticket_update(\Ticket $ticket): void
{
    $ticketId = (int) ($ticket->fields['id'] ?? $ticket->input['id'] ?? 0);
    $newStatus = plugin_integaglpi_ticket_new_status($ticket);
    $oldStatus = plugin_integaglpi_ticket_old_status($ticket);
    $pendingStatus = 4; // GLPI status Pending/Pendente
    $processingStatus = 2; // GLPI status Processing/Assigned

    if ($ticketId <= 0) {
        return;
    }

    if (
        $newStatus === $pendingStatus
        && $oldStatus !== null
        && $oldStatus !== $pendingStatus
    ) {
        $dateMod = trim((string) ($ticket->fields['date_mod'] ?? $ticket->input['date_mod'] ?? ''));
        if ($dateMod === '') {
            error_log('[integaglpi][notification][pending][skip_missing_date_mod] ticket_id=' . $ticketId);
        } else {
            $conversation = plugin_integaglpi_find_open_conversation_for_pending($ticketId);
            if ($conversation !== null) {
                try {
                    $notificationService = new \GlpiPlugin\Integaglpi\Service\NotificationService();
                    $notificationService->sendTicketPending(
                        $ticketId,
                        (string) ($conversation['conversation_id'] ?? ''),
                        $dateMod
                    );
                } catch (\Throwable $e) {
                    error_log('[integaglpi][notification][pending_hook_error] ticket_id=' . $ticketId . ' ' . $e->getMessage());
                }
            }
        }
    }

    if (
        $newStatus === $processingStatus
        && $oldStatus !== null
        && $oldStatus !== $processingStatus
    ) {
        try {
            $suppressionService = new \GlpiPlugin\Integaglpi\Service\NotificationSuppressionService();
            $shouldSuppress = $suppressionService->shouldSuppressTicketStatusNotification(
                $ticketId,
                $newStatus,
                plugin_integaglpi_ticket_actor_user_id()
            );
            if ($shouldSuppress) {
                return;
            }
        } catch (\Throwable $e) {
            error_log(
                '[integaglpi][notification][suppression_lookup_failed_fail_open] ticket_id='
                . $ticketId . ' ' . $e->getMessage()
            );
        }
    }

    // CommonITILObject::SOLVED = 5 / CommonITILObject::CLOSED = 6
    if ($newStatus !== \CommonITILObject::SOLVED && $newStatus !== \CommonITILObject::CLOSED) {
        return;
    }

    try {
        if ($newStatus === \CommonITILObject::CLOSED) {
            $suppressionService = new \GlpiPlugin\Integaglpi\Service\NotificationSuppressionService();
            $suppressionService->logClosedNotificationDecision(
                $ticketId,
                plugin_integaglpi_ticket_actor_user_id()
            );
        }

        $notificationService = new \GlpiPlugin\Integaglpi\Service\NotificationService();
        if ($newStatus === \CommonITILObject::SOLVED) {
            $notificationService->notifyTicketSolved($ticketId);
        }

        if ($newStatus === \CommonITILObject::CLOSED) {
            $notificationService->notifyTicketClosed($ticketId);
        }
    } catch (\Throwable $e) {
        error_log('[integaglpi][notification][ticket_status_hook_error] ticket_id=' . $ticketId . ' ' . $e->getMessage());
    }

    try {
        $service = new \GlpiPlugin\Integaglpi\Service\TicketSyncService();
        $service->syncCloseByTicket($ticketId);
    } catch (\Throwable $e) {
        error_log('[integaglpi][ticket][SYNC_CLOSE][error] ticket_id=' . $ticketId . ' ' . $e->getMessage());
        error_log($e->getTraceAsString());
    }
}

function plugin_integaglpi_ticket_new_status(\Ticket $ticket): int
{
    return (int) ($ticket->input['status'] ?? $ticket->fields['status'] ?? 0);
}

function plugin_integaglpi_ticket_old_status(\Ticket $ticket): ?int
{
    $oldValues = is_array($ticket->oldvalues ?? null) ? $ticket->oldvalues : [];
    if (!array_key_exists('status', $oldValues)) {
        return null;
    }

    return (int) $oldValues['status'];
}

function plugin_integaglpi_ticket_actor_user_id(): ?int
{
    try {
        if (class_exists('\Session') && method_exists('\Session', 'getLoginUserID')) {
            $userId = (int) \Session::getLoginUserID();
            return $userId > 0 ? $userId : null;
        }
    } catch (\Throwable) {
        return null;
    }

    return null;
}

/**
 * @return array<string, mixed>|null
 */
function plugin_integaglpi_find_open_conversation_for_pending(int $ticketId): ?array
{
    try {
        $configService = new \GlpiPlugin\Integaglpi\Service\PluginConfigService();
        if (!$configService->isConfigured()) {
            error_log('[integaglpi][notification][pending][skip_not_configured] ticket_id=' . $ticketId);
            return null;
        }

        $pdo = \GlpiPlugin\Integaglpi\External\ExternalDatabase::getConnection(
            $configService->getConnectionConfig()
        );
        \GlpiPlugin\Integaglpi\External\ExternalSchemaManager::ensureSchema($pdo);
        $repository = new \GlpiPlugin\Integaglpi\External\Repository\ConversationRepository($pdo);
        $conversation = $repository->findByTicketId($ticketId);
        if ($conversation === null) {
            error_log('[integaglpi][notification][pending][skip_no_conversation] ticket_id=' . $ticketId);
            return null;
        }

        $conversationStatus = strtolower((string) ($conversation['conversation_status'] ?? ''));
        $runtimeStatus = strtolower((string) ($conversation['runtime_status'] ?? ''));
        if ($conversationStatus === 'closed' || $runtimeStatus === 'closed') {
            error_log('[integaglpi][notification][pending][skip_closed_conversation] ticket_id=' . $ticketId);
            return null;
        }

        return $conversation;
    } catch (\Throwable $e) {
        error_log('[integaglpi][notification][pending][lookup_error] ticket_id=' . $ticketId . ' ' . $e->getMessage());
        return null;
    }
}

function plugin_integaglpi_item_add_ticket(\Ticket $ticket): void
{
    $ticketId = (int) ($ticket->fields['id'] ?? $ticket->input['id'] ?? 0);
    if ($ticketId <= 0) {
        return;
    }

    try {
        $service = new \GlpiPlugin\Integaglpi\Service\NotificationService();
        $service->notifyTicketOpened($ticketId);
    } catch (\Throwable $e) {
        error_log('[integaglpi][notification][ticket_opened_hook_error] ticket_id=' . $ticketId . ' ' . $e->getMessage());
    }
}

function plugin_integaglpi_item_add_followup(\ITILFollowup $followup): void
{
    $itemtype = (string) ($followup->fields['itemtype'] ?? $followup->input['itemtype'] ?? '');
    $ticketId = (int) ($followup->fields['items_id'] ?? $followup->input['items_id'] ?? 0);
    $followupId = (int) ($followup->fields['id'] ?? $followup->input['id'] ?? 0);
    $isPrivate = (int) ($followup->fields['is_private'] ?? $followup->input['is_private'] ?? 0);
    $content = (string) ($followup->fields['content'] ?? $followup->input['content'] ?? '');

    if ($itemtype !== \Ticket::class && $itemtype !== 'Ticket') {
        return;
    }

    if ($ticketId <= 0 || $followupId <= 0) {
        return;
    }

    if ($isPrivate !== 0) {
        error_log('[integaglpi][notification][skip_private_followup] ticket_id=' . $ticketId . ' followup_id=' . $followupId);
        return;
    }

    try {
        $service = new \GlpiPlugin\Integaglpi\Service\NotificationService();
        $service->notifyPublicFollowup($ticketId, $followupId, $content);
    } catch (\Throwable $e) {
        error_log('[integaglpi][notification][followup_hook_error] ticket_id=' . $ticketId . ' followup_id=' . $followupId . ' ' . $e->getMessage());
    }
}

function plugin_integaglpi_item_solution(\ITILSolution $solution): void
{
    $itemtype = (string) ($solution->fields['itemtype'] ?? $solution->input['itemtype'] ?? '');
    $ticketId = (int) ($solution->fields['items_id'] ?? $solution->input['items_id'] ?? 0);
    $solutionId = (int) ($solution->fields['id'] ?? $solution->input['id'] ?? 0);

    if ($itemtype !== \Ticket::class && $itemtype !== 'Ticket') {
        return;
    }

    if ($ticketId <= 0 || $solutionId <= 0) {
        return;
    }

    try {
        $service = new \GlpiPlugin\Integaglpi\Service\NotificationService();
        $service->notifyTicketSolved($ticketId, $solutionId);
    } catch (\Throwable $e) {
        error_log('[integaglpi][notification][solution_hook_error] ticket_id=' . $ticketId . ' solution_id=' . $solutionId . ' ' . $e->getMessage());
    }
}
