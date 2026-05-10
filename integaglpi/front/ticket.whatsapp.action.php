<?php

declare(strict_types=1);

use GlpiPlugin\Integaglpi\Plugin;
use GlpiPlugin\Integaglpi\Service\TicketRuntimeService;

include '../../../inc/includes.php';

error_log('[integaglpi][action][REQUEST] method=' . ($_SERVER['REQUEST_METHOD'] ?? '') . ' uri=' . ($_SERVER['REQUEST_URI'] ?? '') . ' post_keys=' . json_encode(array_keys($_POST ?? []), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

Session::checkLoginUser();
Plugin::requireUpdate();
// Plugin::requireCsrf($_POST);

$ticketId = (int) ($_POST['ticket_id'] ?? 0);
$conversationId = trim((string) ($_POST['conversation_id'] ?? ''));
$action = (string) ($_POST['whatsapp_action'] ?? '');
error_log('[integaglpi][action] ' . json_encode([
    'ticket_id' => $ticketId,
    'conversation_id' => $conversationId,
    'whatsapp_action' => $action,
    'has_csrf' => array_key_exists('_glpi_csrf_token', $_POST),
    'post_keys' => array_keys($_POST),
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
$service = new TicketRuntimeService();

try {
    if (
        ($_SERVER['REQUEST_METHOD'] ?? '') === 'GET'
        && (string) ($_GET['debug_get'] ?? '') === '1'
    ) {
        $ticketId = (int) ($_GET['ticket_id'] ?? 0);
        $conversationId = trim((string) ($_GET['conversation_id'] ?? ''));
        $action = (string) ($_GET['whatsapp_action'] ?? '');

        error_log('[integaglpi][action][DEBUG_GET] ' . json_encode([
            'ticket_id' => $ticketId,
            'conversation_id' => $conversationId,
            'whatsapp_action' => $action,
            'get_keys' => array_keys($_GET),
        ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
    }

    if ($ticketId <= 0) {
        throw new RuntimeException(__('A valid ticket context is required.', 'glpiintegaglpi'));
    }

    $ticket = new \Ticket();
    if (!$ticket->getFromDB($ticketId)) {
        throw new RuntimeException(__('Ticket not found for WhatsApp action.', 'glpiintegaglpi'));
    }

    // Ensure the current user can update this ticket (not only the plugin right).
    $ticket->check($ticketId, UPDATE);

    switch ($action) {
        case 'claim':
            $service->claim($ticketId, $conversationId, Plugin::getCurrentUserId());
            Session::addMessageAfterRedirect(__('Attendance claimed successfully.', 'glpiintegaglpi'));
            break;

        case 'close':
            $service->close($ticketId, $conversationId, Plugin::getCurrentUserId());
            Session::addMessageAfterRedirect(__('Conversation closed successfully.', 'glpiintegaglpi'));
            break;

        case 'reopen':
            $service->reopen($ticketId, $conversationId, Plugin::getCurrentUserId());
            Session::addMessageAfterRedirect(__('Conversa reaberta com sucesso.', 'glpiintegaglpi'));
            break;

        case 'transfer':
            $queueId = (int) ($_POST['queue_id'] ?? $_GET['queue_id'] ?? 0);
            if ($queueId <= 0) {
                throw new RuntimeException(__('Select a valid queue.', 'glpiintegaglpi'));
            }

            $service->transfer($ticketId, $conversationId, $queueId, Plugin::getCurrentUserId());
            Session::addMessageAfterRedirect(__('Queue transfer registered successfully.', 'glpiintegaglpi'));
            break;

        default:
            throw new RuntimeException(__('Invalid WhatsApp action.', 'glpiintegaglpi'));
    }
} catch (Throwable $exception) {
    error_log('[integaglpi][action][error] ' . $exception->getMessage());
    error_log($exception->getTraceAsString());
    Session::addMessageAfterRedirect($exception->getMessage(), false, ERROR);
}

Html::redirect($CFG_GLPI['root_doc'] . '/front/ticket.form.php?id=' . $ticketId);
