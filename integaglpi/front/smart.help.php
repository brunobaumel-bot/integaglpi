<?php

declare(strict_types=1);

use GlpiPlugin\Integaglpi\Plugin;
use GlpiPlugin\Integaglpi\Service\SmartHelpService;

include '../../../inc/includes.php';

Session::checkLoginUser();

header('Content-Type: application/json; charset=UTF-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');

/**
 * @param array<string, mixed> $payload
 */
function integaglpiSmartHelpJsonResponse(array $payload, int $statusCode = 200): void
{
    if (!array_key_exists('ok', $payload)) {
        $payload['ok'] = $statusCode >= 200 && $statusCode < 300;
    }

    if (!array_key_exists('csrf_token', $payload)) {
        try {
            $payload['csrf_token'] = Plugin::getCsrfToken();
        } catch (Throwable) {
            // Token generation must never turn a SmartHelp response into HTML/fatal.
        }
    }

    http_response_code($statusCode);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
}

function integaglpiSmartHelpErrorType(string $message, ?Throwable $exception = null): string
{
    if ($exception instanceof TypeError || preg_match('/TypeError|must be of type/i', $message) === 1) {
        return 'type_error';
    }
    if (preg_match('/csrf|token/i', $message) === 1) {
        return 'csrf_failed';
    }
    if (preg_match('/permission|forbidden|sem permissão/i', $message) === 1) {
        return 'permission_denied';
    }
    if (preg_match('/ticket|contexto|chamado/i', $message) === 1) {
        return 'missing_context';
    }
    if (preg_match('/timeout|timed out|aborted/i', $message) === 1) {
        return 'node_timeout';
    }
    if (preg_match('/config|auth key|disabled|desativad/i', $message) === 1) {
        return 'configuration_pending';
    }
    if (preg_match('/curl|provider|indispon/i', $message) === 1) {
        return 'provider_unavailable';
    }

    return 'internal_error';
}

function integaglpiSmartHelpUserMessage(string $errorType): string
{
    return match ($errorType) {
        'csrf_failed' => __('Sessão/token expirado. Recarregue a aba e tente novamente.', 'glpiintegaglpi'),
        'permission_denied' => __('Sem permissão para usar a Ajuda Inteligente.', 'glpiintegaglpi'),
        'missing_context' => __('Chamado inválido ou sem contexto suficiente para a Ajuda Inteligente.', 'glpiintegaglpi'),
        'node_timeout' => __('A Ajuda Inteligente demorou mais que o esperado. Tente novamente em breve.', 'glpiintegaglpi'),
        'configuration_pending' => __('Ajuda Inteligente não configurada para este ambiente.', 'glpiintegaglpi'),
        'provider_unavailable' => __('Serviço de Ajuda Inteligente indisponível no momento.', 'glpiintegaglpi'),
        'type_error' => __('Erro interno ao normalizar dados da Ajuda Inteligente.', 'glpiintegaglpi'),
        default => __('Não foi possível consultar a Ajuda Inteligente agora.', 'glpiintegaglpi'),
    };
}

/**
 * @return array{0:int,1:string}
 */
function integaglpiSmartHelpTicketContext(int $ticketId): array
{
    $ticket = new Ticket();
    if ($ticketId <= 0 || !$ticket->getFromDB($ticketId) || !$ticket->can($ticketId, READ)) {
        integaglpiSmartHelpJsonResponse([
            'ok' => false,
            'error' => 'forbidden_ticket',
            'error_type' => 'permission_denied',
            'message' => __('Chamado não encontrado ou sem permissão.', 'glpiintegaglpi'),
        ], 403);
        exit;
    }

    $summary = (new SmartHelpService())->buildTicketContextSummary($ticket);

    return [$ticketId, $summary];
}

try {
    if ($_SERVER['REQUEST_METHOD'] === 'GET' && (string) ($_GET['csrf_token'] ?? '') === '1') {
        if (!SmartHelpService::canViewPanel()) {
            integaglpiSmartHelpJsonResponse([
                'ok' => false,
                'error' => 'forbidden',
                'error_type' => 'permission_denied',
                'message' => __('Sem permissão para visualizar a Ajuda Inteligente.', 'glpiintegaglpi'),
            ], 403);
            exit;
        }

        integaglpiSmartHelpJsonResponse(['ok' => true], 200);
        exit;
    }

    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        integaglpiSmartHelpJsonResponse([
            'ok' => false,
            'error' => 'method_not_allowed',
            'error_type' => 'invalid_method',
            'message' => __('Método não permitido.', 'glpiintegaglpi'),
        ], 405);
        exit;
    }

    // Normalize CSRF token aliases into the canonical `_glpi_csrf_token` BEFORE
    // validation. The JS sends the same fresh token via three channels for GLPI
    // core compatibility (canonical field, `csrf_token` alias, `X-Glpi-Csrf-Token`
    // header). We never accept an empty token and never bypass Plugin::isCsrfValid.
    if (trim((string) ($_POST['_glpi_csrf_token'] ?? '')) === '') {
        $aliasToken = trim((string) ($_POST['csrf_token'] ?? ''));
        if ($aliasToken === '') {
            $aliasToken = trim((string) ($_SERVER['HTTP_X_GLPI_CSRF_TOKEN'] ?? ''));
        }
        if ($aliasToken !== '') {
            $_POST['_glpi_csrf_token'] = $aliasToken;
        }
    }

    if (!Plugin::isCsrfValid($_POST)) {
        error_log('[integaglpi][smart_help][csrf] csrf_denied');
        integaglpiSmartHelpJsonResponse([
            'ok' => false,
            'error' => 'csrf_invalid',
            'error_type' => 'csrf_failed',
            'message' => __('Sessão/token de segurança expirado. Tente novamente.', 'glpiintegaglpi'),
        ], 403);
        exit;
    }

    $action = trim((string) ($_POST['smart_action'] ?? $_POST['whatsapp_action'] ?? 'smart_help'));
    $allowedActions = ['smart_help', 'summarize_ticket', 'local_search', 'kb_feedback', 'suggest_kb', 'prepare_external_context', 'smart_external'];
    if (!in_array($action, $allowedActions, true)) {
        integaglpiSmartHelpJsonResponse([
            'ok' => false,
            'error' => 'invalid_action',
            'error_type' => 'missing_context',
            'message' => __('Ação inválida para Ajuda Inteligente.', 'glpiintegaglpi'),
        ], 400);
        exit;
    }

    if (!SmartHelpService::canViewPanel()) {
        integaglpiSmartHelpJsonResponse([
            'ok' => false,
            'error' => 'forbidden',
            'error_type' => 'permission_denied',
            'message' => __('Sem permissão para visualizar a Ajuda Inteligente.', 'glpiintegaglpi'),
        ], 403);
        exit;
    }

    // Both cloud-flow steps (preview AND send) require the strong UPDATE permission.
    // Consent is enforced only on the actual send below.
    if (in_array($action, ['prepare_external_context', 'smart_external'], true) && !Plugin::canUpdate()) {
        integaglpiSmartHelpJsonResponse([
            'ok' => false,
            'error' => 'forbidden',
            'error_type' => 'permission_denied',
            'message' => __('A pesquisa externa requer permissão de atualização do plugin.', 'glpiintegaglpi'),
        ], 403);
        exit;
    }

    $ticketId = (int) ($_POST['ticket_id'] ?? 0);
    [$ticketId, $summary] = integaglpiSmartHelpTicketContext($ticketId);
    $smartHelp = new SmartHelpService();

    if ($action === 'summarize_ticket') {
        $wantAiSummary = ($_POST['ai_summary'] ?? '') === '1'
            || ($_POST['ai_summary'] ?? '') === 'true';
        integaglpiSmartHelpJsonResponse([
            'ok' => true,
            'result' => $smartHelp->summarizeTicket($ticketId, $summary, $wantAiSummary)
                + ['workflow_step' => 'summarized'],
        ], 200);
        exit;
    }

    if ($action === 'smart_help') {
        integaglpiSmartHelpJsonResponse([
            'ok' => true,
            'result' => $smartHelp->localFirstAssist($ticketId, $summary, false, false)
                + ['workflow_step' => 'summarized'],
        ], 200);
        exit;
    }

    if ($action === 'local_search') {
        $currentSummary = trim((string) ($_POST['technical_summary'] ?? $_POST['summary'] ?? ''));
        $searchSummary = $currentSummary !== '' ? mb_substr($currentSummary, 0, 2000, 'UTF-8') : $summary;
        integaglpiSmartHelpJsonResponse([
            'ok' => true,
            'result' => $smartHelp->localFirstAssist($ticketId, $searchSummary, false, true)
                + ['workflow_step' => 'local_searched'],
        ], 200);
        exit;
    }

    if ($action === 'kb_feedback') {
        $schema044Status = SmartHelpService::migration044SchemaStatus();
        if (($schema044Status['ok'] ?? false) !== true) {
            integaglpiSmartHelpJsonResponse([
                'ok' => false,
                'error' => 'schema_pending',
                'error_type' => 'schema_pending',
                'message' => __('Feedback indisponível: schema 044 pendente de homologação.', 'glpiintegaglpi'),
                'feedback_available' => false,
                'schema044Status' => $schema044Status,
            ], 503);
            exit;
        }

        integaglpiSmartHelpJsonResponse([
            'ok' => true,
            'result' => $smartHelp->recordFeedback(
                $ticketId,
                (int) ($_POST['kb_candidate_id'] ?? 0),
                (int) ($_POST['glpi_knowbaseitem_id'] ?? 0),
                ($_POST['helpful'] ?? '') === '1' || ($_POST['helpful'] ?? '') === 'true',
                trim((string) ($_POST['feedback_text'] ?? ''))
            ),
        ], 200);
        exit;
    }

    if ($action === 'suggest_kb') {
        integaglpiSmartHelpJsonResponse([
            'ok' => true,
            'result' => $smartHelp->suggestKb($ticketId),
        ], 200);
        exit;
    }

    if ($action === 'prepare_external_context') {
        // Step 1: cloud-safe rewrite/preview. No cloud send, no consent here.
        // Base is the technician-edited LOCAL SUMMARY only — never the raw ticket
        // content/history. Node rewrites it into a generic technical context.
        $currentSummary = trim((string) ($_POST['sanitized_context'] ?? $_POST['technical_summary'] ?? $_POST['summary'] ?? ''));
        if ($currentSummary === '') {
            integaglpiSmartHelpJsonResponse([
                'ok' => false,
                'error' => 'missing_summary',
                'error_type' => 'missing_context',
                'message' => __('Gere o resumo técnico antes de pedir ajuda externa.', 'glpiintegaglpi'),
            ], 400);
            exit;
        }
        $externalSummary = mb_substr($currentSummary, 0, 2000, 'UTF-8');
        integaglpiSmartHelpJsonResponse([
            'ok' => true,
            'result' => $smartHelp->prepareExternalContext($ticketId, $externalSummary),
        ], 200);
        exit;
    }

    if ($action === 'smart_external') {
        // Step 2: the actual cloud send. Requires explicit consent. Base is the LOCAL
        // SUMMARY only (never raw ticket). Node rewrites to a cloud-safe context and
        // re-validates the PII Guard before any provider call.
        $consent = ($_POST['consent'] ?? '') === '1' || ($_POST['consent'] ?? '') === 'true';
        $currentSummary = trim((string) ($_POST['technical_summary'] ?? $_POST['summary'] ?? ''));
        if ($currentSummary === '') {
            integaglpiSmartHelpJsonResponse([
                'ok' => false,
                'error' => 'missing_summary',
                'error_type' => 'missing_context',
                'message' => __('Gere o resumo técnico antes de pedir ajuda externa.', 'glpiintegaglpi'),
            ], 400);
            exit;
        }
        $externalSummary = mb_substr($currentSummary, 0, 2000, 'UTF-8');
        integaglpiSmartHelpJsonResponse([
            'ok' => true,
            'result' => $smartHelp->externalResearch($ticketId, $externalSummary, $consent),
        ], 200);
        exit;
    }

    // Unreachable: $allowedActions is validated above. Defensive typed response.
    integaglpiSmartHelpJsonResponse([
        'ok' => false,
        'error' => 'invalid_action',
        'error_type' => 'missing_context',
        'message' => __('Ação inválida para Ajuda Inteligente.', 'glpiintegaglpi'),
    ], 400);
} catch (Throwable $exception) {
    $errorType = integaglpiSmartHelpErrorType($exception->getMessage(), $exception);
    error_log('[integaglpi][smart_help][error] '
        . mb_substr(preg_replace('/(password|token|secret|bearer)\s*[:=]\s*\S+/i', '$1=[redacted]', $exception->getMessage()), 0, 200, 'UTF-8'));
    integaglpiSmartHelpJsonResponse([
        'ok' => false,
        'error' => 'smart_help_error',
        'error_type' => $errorType,
        'message' => integaglpiSmartHelpUserMessage($errorType),
    ], in_array($errorType, ['csrf_failed', 'permission_denied'], true) ? 403 : 500);
}
