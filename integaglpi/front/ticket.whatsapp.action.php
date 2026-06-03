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

// ── Read-only AI/KB assist actions (Smart Help panel) ───────────────────────
// These are handled BEFORE the ticket-mutation action map. They never mutate the
// ticket, never send WhatsApp, never publish KB. CSRF was validated above and the
// page already requires plugin UPDATE (technicians/supervisors). Each call proxies
// to the Node AI services via SmartHelpService.php (local-KB-first; cloud only with
// explicit consent; PII sanitized server-side by the Node sanitizer).
$aiAssistActions = ['smart_help', 'kb_feedback', 'smart_external', 'suggest_kb'];
if (in_array($action, $aiAssistActions, true)) {
    $smartHelp = new \GlpiPlugin\Integaglpi\Service\SmartHelpService();

    if (!\GlpiPlugin\Integaglpi\Service\SmartHelpService::canViewPanel()) {
        plugin_integaglpi_ticket_action_json(['ok' => false, 'error' => 'forbidden'], 403);
    }
    if ($ticketId <= 0) {
        plugin_integaglpi_ticket_action_json(['ok' => false, 'error' => 'invalid_ticket'], 400);
    }

    if ($action === 'smart_help') {
        // Build the summary SERVER-SIDE from the ticket (don't trust client text).
        $summary = '';
        $ticket = new \Ticket();
        if ($ticket->getFromDB($ticketId) && $ticket->can($ticketId, READ)) {
            $name = (string) ($ticket->fields['name'] ?? '');
            $content = trim(strip_tags((string) ($ticket->fields['content'] ?? '')));
            $summary = mb_substr(trim($name . '. ' . $content), 0, 2000, 'UTF-8');
        } else {
            plugin_integaglpi_ticket_action_json(['ok' => false, 'error' => 'forbidden_ticket'], 403);
        }
        // Local-first: never returns a raw error — searches the native KB in PHP and
        // degrades to a local checklist/questions if the Node AI service is down.
        plugin_integaglpi_ticket_action_json(['ok' => true, 'result' => $smartHelp->localFirstAssist($ticketId, $summary)], 200);
    }
    if ($action === 'kb_feedback') {
        $kbCandidateId = (int) ($_POST['kb_candidate_id'] ?? 0);
        $helpful = ($_POST['helpful'] ?? '') === '1' || ($_POST['helpful'] ?? '') === 'true';
        $note = trim((string) ($_POST['feedback_text'] ?? ''));
        plugin_integaglpi_ticket_action_json(['ok' => true, 'result' => $smartHelp->recordFeedback($ticketId, $kbCandidateId, $helpful, $note)], 200);
    }
    if ($action === 'smart_external') {
        // Cloud requires explicit human consent (the panel sends consent=1 on click).
        $consent = ($_POST['consent'] ?? '') === '1' || ($_POST['consent'] ?? '') === 'true';
        // Context built server-side from the ticket; the Node sanitizer strips PII
        // before anything leaves to the cloud.
        $context = '';
        $ticket = new \Ticket();
        if ($ticket->getFromDB($ticketId) && $ticket->can($ticketId, READ)) {
            $context = mb_substr(
                trim((string) ($ticket->fields['name'] ?? '') . '. ' . strip_tags((string) ($ticket->fields['content'] ?? ''))),
                0,
                6000,
                'UTF-8'
            );
        } else {
            plugin_integaglpi_ticket_action_json(['ok' => false, 'error' => 'forbidden_ticket'], 403);
        }
        plugin_integaglpi_ticket_action_json(['ok' => true, 'result' => $smartHelp->externalResearch($ticketId, $context, $consent)], 200);
    }
    if ($action === 'suggest_kb') {
        plugin_integaglpi_ticket_action_json(['ok' => true, 'result' => $smartHelp->suggestKb($ticketId)], 200);
    }
}

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
