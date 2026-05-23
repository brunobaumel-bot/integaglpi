<?php

declare(strict_types=1);

include '../../../inc/includes.php';

use GlpiPlugin\Integaglpi\Plugin;
use GlpiPlugin\Integaglpi\Service\CopilotDraftClient;
use GlpiPlugin\Integaglpi\Service\TicketContextService;

Session::checkLoginUser();

header('Content-Type: application/json; charset=UTF-8');

try {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        http_response_code(405);
        echo json_encode(['success' => false, 'message' => __('Método não permitido.', 'glpiintegaglpi')]);
        exit;
    }

    if (!Plugin::canUpdate()) {
        http_response_code(403);
        echo json_encode(['success' => false, 'message' => __('Sem permissão para usar o Copiloto.', 'glpiintegaglpi')]);
        exit;
    }

    if (!Plugin::isCsrfValid($_POST)) {
        http_response_code(403);
        echo json_encode(['success' => false, 'message' => __('Token CSRF inválido.', 'glpiintegaglpi')]);
        exit;
    }

    $ticketId = (int) ($_POST['ticket_id'] ?? 0);
    $conversationId = trim((string) ($_POST['conversation_id'] ?? ''));
    $action = trim((string) ($_POST['copilot_action'] ?? 'generate'));
    $tone = trim((string) ($_POST['tone'] ?? 'neutral'));
    if (!in_array($tone, ['friendly', 'technical', 'neutral', 'concise'], true)) {
        $tone = 'neutral';
    }

    $ticket = new Ticket();
    if ($ticketId <= 0 || !$ticket->getFromDB($ticketId) || !$ticket->can($ticketId, READ)) {
        http_response_code(404);
        echo json_encode(['success' => false, 'message' => __('Chamado não encontrado ou sem permissão.', 'glpiintegaglpi')]);
        exit;
    }

    $client = new CopilotDraftClient();
    $basePayload = [
        'action' => $action,
        'conversation_id' => $conversationId,
        'glpi_ticket_id' => $ticketId,
        'glpi_user_id' => (int) ($_SESSION['glpiID'] ?? 0),
    ];

    if ($action === 'generate') {
        $context = (new TicketContextService())->buildCopilotContext($ticket, $conversationId);
        $response = $client->post($basePayload + [
            'tone' => $tone,
            'context' => $context,
        ]);
    } elseif (in_array($action, ['use', 'discard', 'feedback'], true)) {
        $response = $client->post($basePayload + [
            'draft_hash' => trim((string) ($_POST['draft_hash'] ?? '')),
            'feedback' => trim((string) ($_POST['feedback'] ?? '')),
            'notes' => mb_substr(trim((string) ($_POST['notes'] ?? '')), 0, 500, 'UTF-8'),
        ]);
    } else {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => __('Ação inválida.', 'glpiintegaglpi')]);
        exit;
    }

    http_response_code($response['success'] ? 200 : max(400, (int) $response['status']));
    echo json_encode([
        'success' => $response['success'],
        'body' => $response['body'],
        'message' => (string) ($response['body']['message'] ?? ''),
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
} catch (Throwable $exception) {
    error_log('[integaglpi][copilot][error] ' . preg_replace('/(password|token|secret|bearer)\s*[:=]\s*\S+/i', '$1=[redacted]', $exception->getMessage()));
    http_response_code(500);
    echo json_encode(['success' => false, 'message' => __('Não foi possível usar o Copiloto agora.', 'glpiintegaglpi')]);
}
