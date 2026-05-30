<?php

declare(strict_types=1);

use GlpiPlugin\Integaglpi\Plugin;
use GlpiPlugin\Integaglpi\Service\SecurityPermissionService;
use GlpiPlugin\Integaglpi\Service\TicketRuntimeService;

include '../../../inc/includes.php';

error_log('[integaglpi][action][REQUEST] method=' . ($_SERVER['REQUEST_METHOD'] ?? '') . ' uri=' . ($_SERVER['REQUEST_URI'] ?? '') . ' post_keys=' . json_encode(array_keys($_POST ?? []), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

Session::checkLoginUser();
Plugin::requireUpdate();

function plugin_integaglpi_ticket_action_json(array $payload, int $statusCode): never
{
    http_response_code($statusCode);
    header('Content-Type: application/json; charset=UTF-8');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

if (strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET')) !== 'POST') {
    plugin_integaglpi_ticket_action_json([
        'ok' => false,
        'error' => 'method_not_allowed',
        'message' => __('Only POST requests are allowed.', 'glpiintegaglpi'),
    ], 405);
}

if (!Plugin::isCsrfValid($_POST)) {
    plugin_integaglpi_ticket_action_json([
        'ok' => false,
        'error' => 'csrf_invalid',
        'message' => __('Token de segurança inválido.', 'glpiintegaglpi'),
    ], 403);
}

$ticketId = (int) ($_POST['ticket_id'] ?? 0);
$conversationId = trim((string) ($_POST['conversation_id'] ?? ''));
$action = trim((string) ($_POST['whatsapp_action'] ?? ''));
error_log('[integaglpi][action] ' . json_encode([
    'ticket_id' => $ticketId,
    'conversation_id' => $conversationId,
    'whatsapp_action' => $action,
    'has_csrf' => array_key_exists('_glpi_csrf_token', $_POST),
    'post_keys' => array_keys($_POST),
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

$actionRightMap = [
    'claim' => SecurityPermissionService::RIGHT_CLAIM_TICKET,
    'reclaim' => SecurityPermissionService::RIGHT_CLAIM_TICKET,
    'assume' => SecurityPermissionService::RIGHT_CLAIM_TICKET,
    'reopen' => SecurityPermissionService::RIGHT_CLAIM_TICKET,
    'transfer' => SecurityPermissionService::RIGHT_TRANSFER_TICKET,
    'close' => SecurityPermissionService::RIGHT_ADMINISTRATIVE_CLOSE,
    'admin_close' => SecurityPermissionService::RIGHT_ADMINISTRATIVE_CLOSE,
];
if (!array_key_exists($action, $actionRightMap)) {
    plugin_integaglpi_ticket_action_json([
        'ok' => false,
        'error' => 'invalid_action',
        'message' => __('Invalid WhatsApp action.', 'glpiintegaglpi'),
    ], 400);
}

$rbacGate = SecurityPermissionService::requirePermissionOrDeny(
    $actionRightMap[$action],
    ['endpoint' => 'ticket.whatsapp.action.php', 'action' => $action, 'ticket_id' => $ticketId]
);
if (!$rbacGate['ok']) {
    plugin_integaglpi_ticket_action_json([
        'ok' => false,
        'error' => $rbacGate['error'],
        'message' => $rbacGate['message'],
    ], $rbacGate['http_status']);
}

$service = new TicketRuntimeService();

try {
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
        case 'reclaim':
        case 'assume':
            $service->claim($ticketId, $conversationId, Plugin::getCurrentUserId());
            Session::addMessageAfterRedirect(__('Attendance claimed successfully.', 'glpiintegaglpi'));
            break;

        case 'close':
        case 'admin_close':
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

Html::redirect(Plugin::getTicketUrl($ticketId));
