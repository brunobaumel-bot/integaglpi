<?php

declare(strict_types=1);

include '../../../inc/includes.php';

use GlpiPlugin\Integaglpi\Plugin;
use GlpiPlugin\Integaglpi\Service\CopilotDraftClient;
use GlpiPlugin\Integaglpi\Service\TicketContextService;

Session::checkLoginUser();

header('Content-Type: application/json; charset=UTF-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');

/**
 * @param array<string, mixed> $payload
 */
function integaglpiCopilotJsonResponse(array $payload, int $statusCode = 200): void
{
    if (!isset($payload['csrf_token'])) {
        $payload['csrf_token'] = Plugin::getCsrfToken();
    }

    http_response_code($statusCode);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
}

function integaglpiCopilotUserMessage(string $message): string
{
    if ($message === 'COPILOT_TIMEOUT' || $message === 'COPILOT_PROVIDER_TIMEOUT' || preg_match('/timeout|timed out|aborted/i', $message) === 1) {
        return __('O Copiloto demorou mais que o esperado. Tente novamente ou reduza o contexto do chamado.', 'glpiintegaglpi');
    }

    if ($message === 'COPILOT_PROVIDER_UNAVAILABLE' || preg_match('/COPILOT_(?:OLLAMA|PROVIDER)|fetch failed|connection refused/i', $message) === 1) {
        return __('Serviço de IA indisponível no momento.', 'glpiintegaglpi');
    }

    if (preg_match('/COPILOT_DRAFT_(?:INVALID_JSON|INVALID_SHAPE|INVALID_ENUM|EMPTY)|formato inválido/i', $message) === 1) {
        return __('A IA respondeu em formato inválido. Tente novamente.', 'glpiintegaglpi');
    }

    if ($message === 'COPILOT_DISABLED') {
        return __('Copiloto desabilitado no momento.', 'glpiintegaglpi');
    }

    if ($message === 'COPILOT_INVALID_CONTEXT') {
        return __('Contexto do chamado inválido ou insuficiente para gerar rascunho.', 'glpiintegaglpi');
    }

    return __('Não foi possível usar o Copiloto agora.', 'glpiintegaglpi');
}

function integaglpiCopilotReleaseSession(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        session_write_close();
    }
}

try {
    if ($_SERVER['REQUEST_METHOD'] === 'GET' && (string) ($_GET['csrf_token'] ?? '') === '1') {
        if (!Plugin::canUpdate()) {
            integaglpiCopilotJsonResponse([
                'success' => false,
                'message' => __('Sem permissão para usar o Copiloto.', 'glpiintegaglpi'),
            ], 403);
            exit;
        }

        integaglpiCopilotJsonResponse(['success' => true]);
        exit;
    }

    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        integaglpiCopilotJsonResponse(['success' => false, 'message' => __('Método não permitido.', 'glpiintegaglpi')], 405);
        exit;
    }

    if (!Plugin::canUpdate()) {
        integaglpiCopilotJsonResponse(['success' => false, 'message' => __('Sem permissão para usar o Copiloto.', 'glpiintegaglpi')], 403);
        exit;
    }

    if (!Plugin::isCsrfValid($_POST)) {
        error_log('[integaglpi][copilot][csrf] csrf_denied');
        integaglpiCopilotJsonResponse([
            'success' => false,
            'message' => 'csrf_denied',
            'display_message' => __('Sessão/token expirado. Recarregue a página e tente novamente.', 'glpiintegaglpi'),
            'error_type' => 'csrf_denied',
        ], 403);
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
        integaglpiCopilotJsonResponse(['success' => false, 'message' => __('Chamado não encontrado ou sem permissão.', 'glpiintegaglpi')], 404);
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
        integaglpiCopilotReleaseSession();
        $response = $client->createDraftJob($basePayload + [
            'tone' => $tone,
            'context' => $context,
        ]);
    } elseif ($action === 'status') {
        $jobId = trim((string) ($_POST['job_id'] ?? ''));
        if ($jobId === '' || preg_match('/^[A-Za-z0-9_.:-]{8,120}$/', $jobId) !== 1) {
            integaglpiCopilotJsonResponse([
                'success' => false,
                'message' => __('Job do Copiloto inválido.', 'glpiintegaglpi'),
                'error_type' => 'job_not_found',
            ], 400);
            exit;
        }
        integaglpiCopilotReleaseSession();
        $response = $client->getDraftJobStatus($basePayload + [
            'job_id' => $jobId,
        ]);
    } elseif (in_array($action, ['use', 'discard', 'feedback'], true)) {
        integaglpiCopilotReleaseSession();
        $response = $client->post($basePayload + [
            'draft_hash' => trim((string) ($_POST['draft_hash'] ?? '')),
            'feedback' => trim((string) ($_POST['feedback'] ?? '')),
            'notes' => mb_substr(trim((string) ($_POST['notes'] ?? '')), 0, 500, 'UTF-8'),
        ]);
    } else {
        integaglpiCopilotJsonResponse(['success' => false, 'message' => __('Ação inválida.', 'glpiintegaglpi')], 400);
        exit;
    }

    integaglpiCopilotJsonResponse([
        'success' => $response['success'],
        'body' => $response['body'],
        'message' => $response['success']
            ? (string) ($response['body']['message'] ?? '')
            : integaglpiCopilotUserMessage((string) ($response['body']['message'] ?? '')),
    ], $response['success'] ? max(200, (int) $response['status']) : max(400, (int) $response['status']));
} catch (Throwable $exception) {
    error_log('[integaglpi][copilot][error] ' . preg_replace('/(password|token|secret|bearer)\s*[:=]\s*\S+/i', '$1=[redacted]', $exception->getMessage()));
    $isTimeout = $exception->getMessage() === 'COPILOT_TIMEOUT'
        || preg_match('/timeout|timed out|aborted/i', $exception->getMessage()) === 1;
    integaglpiCopilotJsonResponse([
        'success' => false,
        'message' => integaglpiCopilotUserMessage($exception->getMessage()),
    ], $isTimeout ? 504 : 500);
}
