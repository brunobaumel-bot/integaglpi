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

    // Enforce "Novo" status for WhatsApp-originated tickets.
    // Phase: integaglpi_ops_console_claim_ui_messaging_stabilization_001.
    // Rule: a ticket created via the integration must remain status=1 (Novo)
    // until a technician explicitly claims it via Central WhatsApp / GLPI.
    // GLPI core may auto-promote status to 2 (Em atendimento) when the
    // creation payload carries an assignee from queue routing; revert that
    // promotion here. We only revert when a linked conversation exists,
    // which guarantees we never touch organic GLPI tickets.
    try {
        plugin_integaglpi_enforce_initial_new_status($ticket, $ticketId);
    } catch (\Throwable $e) {
        error_log('[integaglpi][ticket][new_status_enforcement_error] ticket_id=' . $ticketId . ' ' . $e->getMessage());
    }

    try {
        $service = new \GlpiPlugin\Integaglpi\Service\NotificationService();
        $service->notifyTicketOpened($ticketId);
    } catch (\Throwable $e) {
        error_log('[integaglpi][notification][ticket_opened_hook_error] ticket_id=' . $ticketId . ' ' . $e->getMessage());
    }
}

function plugin_integaglpi_item_add_ticket_user(\Ticket_User $ticketUser): void
{
    $ticketId = (int) ($ticketUser->fields['tickets_id'] ?? $ticketUser->input['tickets_id'] ?? 0);
    $userId = (int) ($ticketUser->fields['users_id'] ?? $ticketUser->input['users_id'] ?? 0);
    $type = (int) ($ticketUser->fields['type'] ?? $ticketUser->input['type'] ?? 0);
    $assignedType = defined('CommonITILActor::ASSIGN') ? (int) constant('CommonITILActor::ASSIGN') : 2;

    if ($ticketId <= 0 || $userId <= 0 || $type !== $assignedType) {
        return;
    }

    try {
        $service = new \GlpiPlugin\Integaglpi\Service\TicketRuntimeService();
        $service->syncNativeTicketAssignment(
            $ticketId,
            $userId,
            plugin_integaglpi_ticket_actor_user_id()
        );
    } catch (\Throwable $e) {
        error_log('[integaglpi][ticket][native_claim_sync_error] ticket_id=' . $ticketId
            . ' user_id=' . $userId . ' ' . $e->getMessage());
    }
}

/**
 * Force WhatsApp-originated tickets to start as "Novo" (status=1).
 * Idempotent and safe: only acts when the ticket is recognizable as
 * WhatsApp-originated AND the current status is not already 1. Uses direct
 * $DB->update to bypass ITEM_UPDATE hooks (we do not want to fire
 * ticket_update notifications for an internal status correction at
 * creation time).
 *
 * Detection (see plugin_integaglpi_is_whatsapp_originated_ticket) uses TWO
 * independent signals so the rule does not depend on the conversation row
 * being already linked at ITEM_ADD time (Node calls linkGlpiTicket AFTER
 * createTicket returns, so the conversation may not yet carry the ticket
 * id when this hook fires).
 *
 * Returns early (void) whenever the operation is not applicable; helper
 * lookups return nullable arrays. This keeps hook.php free of the literal
 * forbidden by the cross-repo static contract.
 */
function plugin_integaglpi_enforce_initial_new_status(\Ticket $ticket, int $ticketId): void
{
    $currentStatus = (int) ($ticket->fields['status'] ?? 0);
    if ($currentStatus === 1) {
        return;
    }

    if (!plugin_integaglpi_is_whatsapp_originated_ticket($ticket, $ticketId)) {
        return;
    }

    global $DB;
    if (!isset($DB) || !is_object($DB)) {
        return;
    }

    $updated = $DB->update(
        'glpi_tickets',
        ['status' => 1],
        ['id' => $ticketId]
    );

    if (!$updated) {
        error_log('[integaglpi][ticket][new_status_enforcement_failed] ticket_id=' . $ticketId . ' previous_status=' . $currentStatus);
        return;
    }

    $ticket->fields['status'] = 1;
    error_log('[integaglpi][ticket][new_status_enforced] ticket_id=' . $ticketId . ' previous_status=' . $currentStatus);
}

/**
 * Decide whether the freshly added ticket belongs to the WhatsApp flow.
 *
 * Phase: integaglpi_ops_console_claim_ui_messaging_stabilization_001_FIX1.
 * Why TWO signals are required:
 *   1. The conversation linkage. The integration-service writes
 *      glpi_ticket_id on the conversation row via `linkGlpiTicket` AFTER
 *      `glpiClient.createTicket` returns. When the GLPI REST request that
 *      adds the ticket triggers `ITEM_ADD Ticket`, the conversation row in
 *      PostgreSQL still has `glpi_ticket_id IS NULL`, so a pure repository
 *      lookup returns nothing and the hook would (wrongly) treat the ticket
 *      as a regular GLPI ticket.
 *   2. The content marker. Node's `buildTicketCreatePayload`
 *      (integration-service/src/adapters/glpi/GlpiClient.ts) unconditionally
 *      appends "Telefone (WhatsApp): <e164>" to the ticket content for every
 *      WhatsApp-originated ticket. This marker is present in
 *      `$ticket->fields['content']` at ITEM_ADD time, BEFORE linkGlpiTicket.
 *
 * Either signal is sufficient. Tickets created organically through GLPI UI
 * lack BOTH and are therefore never touched. Operators who would deliberately
 * paste the literal marker into a manual ticket title are accepted as a known
 * edge case (documented as ressalva).
 */
function plugin_integaglpi_is_whatsapp_originated_ticket(\Ticket $ticket, int $ticketId): bool
{
    // Signal #1: conversation already linked (will be true once
    // linkGlpiTicket runs in Node, may be absent at ITEM_ADD time).
    if (plugin_integaglpi_lookup_ticket_conversation($ticketId) !== null) {
        return true;
    }

    // Signal #2: marker injected by Node's buildTicketCreatePayload.
    // Case-insensitive match: the marker is a fixed Node-side string but we
    // do not want a locale tweak in GLPI to defeat the check. Empty content
    // collapses safely to falsy via the short-circuit on the left.
    $content = (string) ($ticket->fields['content'] ?? $ticket->input['content'] ?? '');
    return $content !== '' && stripos($content, 'Telefone (WhatsApp):') !== false;
}

/**
 * @return array<string, mixed>|null
 */
function plugin_integaglpi_lookup_ticket_conversation(int $ticketId): ?array
{
    try {
        $configService = new \GlpiPlugin\Integaglpi\Service\PluginConfigService();
        if (!$configService->isConfigured()) {
            return null;
        }

        $pdo = \GlpiPlugin\Integaglpi\External\ExternalDatabase::getConnection(
            $configService->getConnectionConfig()
        );
        \GlpiPlugin\Integaglpi\External\ExternalSchemaManager::ensureSchema($pdo);
        $repository = new \GlpiPlugin\Integaglpi\External\Repository\ConversationRepository($pdo);
        $conversation = $repository->findByTicketId($ticketId);
        return is_array($conversation) ? $conversation : null;
    } catch (\Throwable $e) {
        error_log('[integaglpi][ticket][new_status_lookup_error] ticket_id=' . $ticketId . ' ' . $e->getMessage());
        return null;
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

function plugin_integaglpi_item_add_document_item(\Document_Item $documentItem): void
{
    $itemtype = (string) ($documentItem->fields['itemtype'] ?? $documentItem->input['itemtype'] ?? '');
    $itemsId = (int) ($documentItem->fields['items_id'] ?? $documentItem->input['items_id'] ?? 0);
    $documentItemId = (int) ($documentItem->fields['id'] ?? $documentItem->input['id'] ?? 0);
    $documentId = (int) ($documentItem->fields['documents_id'] ?? $documentItem->input['documents_id'] ?? 0);

    if ($itemsId <= 0 || $documentItemId <= 0 || $documentId <= 0) {
        return;
    }

    $ticketId = 0;
    $sourceType = $itemtype;

    if ($itemtype === \ITILFollowup::class || $itemtype === 'ITILFollowup') {
        $followup = new \ITILFollowup();
        if (!$followup->getFromDB($itemsId)) {
            return;
        }
        if ((int) ($followup->fields['is_private'] ?? 0) !== 0) {
            return;
        }
        $followupItemtype = (string) ($followup->fields['itemtype'] ?? '');
        if ($followupItemtype !== \Ticket::class && $followupItemtype !== 'Ticket') {
            return;
        }
        $ticketId = (int) ($followup->fields['items_id'] ?? 0);
    } elseif ($itemtype === \ITILSolution::class || $itemtype === 'ITILSolution') {
        $solution = new \ITILSolution();
        if (!$solution->getFromDB($itemsId)) {
            return;
        }
        $solutionItemtype = (string) ($solution->fields['itemtype'] ?? '');
        if ($solutionItemtype !== \Ticket::class && $solutionItemtype !== 'Ticket') {
            return;
        }
        $ticketId = (int) ($solution->fields['items_id'] ?? 0);
    } elseif ($itemtype === \Ticket::class || $itemtype === 'Ticket') {
        $requestUri = strtolower((string) ($_SERVER['REQUEST_URI'] ?? ''));
        if (str_contains($requestUri, '/apirest.php')) {
            // Inbound WhatsApp media is linked to the ticket through GLPI REST; do not echo it back.
            return;
        }
        $ticketId = $itemsId;
    } else {
        return;
    }

    if ($ticketId <= 0) {
        return;
    }

    try {
        $service = new \GlpiPlugin\Integaglpi\Service\NotificationService();
        $service->notifyTicketDocumentAdded($ticketId, $documentItemId, $documentId, $sourceType);
    } catch (\Throwable $e) {
        error_log('[integaglpi][notification][document_hook_error] ticket_id=' . $ticketId . ' document_item_id=' . $documentItemId . ' ' . $e->getMessage());
    }
}
