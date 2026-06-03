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
    if (!array_key_exists('ok', $payload)) {
        $payload['ok'] = (bool) ($payload['success'] ?? ($statusCode >= 200 && $statusCode < 300));
    }

    if (!isset($payload['csrf_token'])) {
        $payload['csrf_token'] = Plugin::getCsrfToken();
    }

    http_response_code($statusCode);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
}

function integaglpiCopilotErrorType(string $message, ?Throwable $exception = null): string
{
    if ($exception instanceof TypeError || preg_match('/TypeError|must be of type/i', $message) === 1) {
        return 'type_error';
    }

    if (preg_match('/csrf|token de segurança|sessão\/token/i', $message) === 1) {
        return 'csrf_failed';
    }

    if (preg_match('/sem permissão|forbidden|permission/i', $message) === 1) {
        return 'permission_denied';
    }

    if (preg_match('/contexto.*inválido|contexto.*insuficiente|COPILOT_INVALID_CONTEXT/i', $message) === 1) {
        return 'missing_context';
    }

    if (preg_match('/diagnostics?.*(timeout|timed out|aborted)|request aborted/i', $message) === 1) {
        return 'diagnostics_timeout';
    }

    if (preg_match('/COPILOT_TIMEOUT|timeout|timed out|aborted/i', $message) === 1) {
        return 'node_timeout';
    }

    if (preg_match('/not configured|auth key|COPILOT_DISABLED|desabilitado|configuration/i', $message) === 1) {
        return 'configuration_pending';
    }

    if (preg_match('/provider|fetch failed|connection refused|indispon/i', $message) === 1) {
        return 'provider_unavailable';
    }

    return 'internal_error';
}

function integaglpiCopilotUserMessage(string $message): string
{
    if ($message === 'Copiloto temporariamente indisponível. Tente novamente em breve.' || in_array($message, ['COPILOT_CIRCUIT_OPEN', 'COPILOT_PROVIDER_BUSY'], true)) {
        return __('Copiloto temporariamente indisponível. Tente novamente em breve.', 'glpiintegaglpi');
    }

    if ($message === 'COPILOT_TIMEOUT' || $message === 'COPILOT_PROVIDER_TIMEOUT' || preg_match('/timeout|timed out|aborted/i', $message) === 1) {
        return __('O Copiloto demorou mais que o esperado. Tente novamente ou reduza o contexto do chamado.', 'glpiintegaglpi');
    }

    if ($message === 'COPILOT_PROVIDER_UNAVAILABLE' || preg_match('/COPILOT_(?:OLLAMA|PROVIDER)|fetch failed|connection refused/i', $message) === 1) {
        return __('Serviço de IA indisponível no momento.', 'glpiintegaglpi');
    }

    if (preg_match('/COPILOT_DRAFT_(?:INVALID_JSON|INVALID_SHAPE|INVALID_ENUM|EMPTY)|formato inválido/i', $message) === 1) {
        return __('A IA respondeu em formato inválido. Tente novamente.', 'glpiintegaglpi');
    }

    if ($message === 'COPILOT_DRAFT_CHECKLIST_REQUIRED') {
        return __('A IA retornou um rascunho sem checklist técnico obrigatório. Gere novamente ou revise o contexto antes de usar.', 'glpiintegaglpi');
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
            'display_message' => __('Sem permissão para usar o Copiloto.', 'glpiintegaglpi'),
            'error_type' => 'permission_denied',
        ], 403);
        exit;
        }

        integaglpiCopilotJsonResponse(['success' => true]);
        exit;
    }

    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        integaglpiCopilotJsonResponse([
            'success' => false,
            'message' => __('Método não permitido.', 'glpiintegaglpi'),
            'display_message' => __('Método não permitido.', 'glpiintegaglpi'),
            'error_type' => 'internal_error',
        ], 405);
        exit;
    }

    if (!Plugin::canUpdate()) {
        integaglpiCopilotJsonResponse([
            'success' => false,
            'message' => __('Sem permissão para usar o Copiloto.', 'glpiintegaglpi'),
            'display_message' => __('Sem permissão para usar o Copiloto.', 'glpiintegaglpi'),
            'error_type' => 'permission_denied',
        ], 403);
        exit;
    }

    if (!Plugin::isCsrfValid($_POST)) {
        error_log('[integaglpi][copilot][csrf] csrf_denied');
        integaglpiCopilotJsonResponse([
            'success' => false,
            'message' => 'csrf_failed',
            'display_message' => __('Sessão/token expirado. Recarregue a página e tente novamente.', 'glpiintegaglpi'),
            'error_type' => 'csrf_failed',
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
        integaglpiCopilotJsonResponse([
            'success' => false,
            'message' => __('Chamado não encontrado ou sem permissão.', 'glpiintegaglpi'),
            'display_message' => __('Chamado não encontrado ou sem permissão.', 'glpiintegaglpi'),
            'error_type' => 'missing_context',
        ], 404);
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
                'display_message' => __('Job do Copiloto inválido.', 'glpiintegaglpi'),
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
        integaglpiCopilotJsonResponse([
            'success' => false,
            'message' => __('Ação inválida.', 'glpiintegaglpi'),
            'display_message' => __('Ação inválida.', 'glpiintegaglpi'),
            'error_type' => 'internal_error',
        ], 400);
        exit;
    }

    $rawMessage = (string) ($response['body']['message'] ?? '');
    $displayMessage = $response['success'] ? $rawMessage : integaglpiCopilotUserMessage($rawMessage);
    integaglpiCopilotJsonResponse([
        'success' => $response['success'],
        'body' => $response['body'],
        'message' => $displayMessage,
        'display_message' => $displayMessage,
        'error_type' => $response['success'] ? null : integaglpiCopilotErrorType($rawMessage),
    ], $response['success'] ? max(200, (int) $response['status']) : max(400, (int) $response['status']));
} catch (Throwable $exception) {
    error_log('[integaglpi][copilot][error] ' . preg_replace('/(password|token|secret|bearer)\s*[:=]\s*\S+/i', '$1=[redacted]', $exception->getMessage()));
    $isTimeout = $exception->getMessage() === 'COPILOT_TIMEOUT'
        || preg_match('/timeout|timed out|aborted/i', $exception->getMessage()) === 1;
    $message = integaglpiCopilotUserMessage($exception->getMessage());
    integaglpiCopilotJsonResponse([
        'success' => false,
        'message' => $message,
        'display_message' => $message,
        'error_type' => integaglpiCopilotErrorType($exception->getMessage(), $exception),
    ], $isTimeout ? 504 : 500);
}
