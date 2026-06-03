<?php

declare(strict_types=1);

use GlpiPlugin\Integaglpi\Plugin;
use GlpiPlugin\Integaglpi\Service\SecurityPermissionService;
use GlpiPlugin\Integaglpi\Service\TicketRuntimeService;

include '../../../inc/includes.php';

error_log('[integaglpi][action][REQUEST] method=' . ($_SERVER['REQUEST_METHOD'] ?? '') . ' uri=' . ($_SERVER['REQUEST_URI'] ?? '') . ' post_keys=' . json_encode(array_keys($_POST ?? []), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

Session::checkLoginUser();

function plugin_integaglpi_ticket_action_json(array $payload, int $statusCode): never
{
    http_response_code($statusCode);
    header('Content-Type: application/json; charset=UTF-8');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function plugin_integaglpi_ai_error_type(Throwable $exception): string
{
    $message = $exception->getMessage();
    if ($exception instanceof TypeError || preg_match('/TypeError|must be of type/i', $message) === 1) {
        return 'type_error';
    }
    if (preg_match('/csrf|token/i', $message) === 1) {
        return 'csrf_failed';
    }
    if (preg_match('/permission|forbidden|sem permissão/i', $message) === 1) {
        return 'permission_denied';
    }
    if (preg_match('/contexto|ticket|conversa/i', $message) === 1) {
        return 'missing_context';
    }
    if (preg_match('/diagnostics?.*(timeout|timed out|aborted)|request aborted/i', $message) === 1) {
        return 'diagnostics_timeout';
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

function plugin_integaglpi_ai_error_message(string $errorType): string
{
    return match ($errorType) {
        'csrf_failed' => __('Token de segurança inválido. Recarregue a página e tente novamente.', 'glpiintegaglpi'),
        'permission_denied' => __('Sem permissão para executar esta ação de IA.', 'glpiintegaglpi'),
        'missing_context' => __('Contexto insuficiente para executar esta ação de IA.', 'glpiintegaglpi'),
        'diagnostics_timeout' => __('Diagnóstico do integration-service excedeu o tempo limite. A IA não será tratada como offline sem nova evidência.', 'glpiintegaglpi'),
        'node_timeout' => __('Integration-service demorou mais que o esperado. Tente novamente em breve.', 'glpiintegaglpi'),
        'configuration_pending' => __('IA local/configuração pendente. Revise a configuração antes de tentar novamente.', 'glpiintegaglpi'),
        'provider_unavailable' => __('Serviço de IA indisponível no momento. Tente novamente em breve.', 'glpiintegaglpi'),
        'type_error' => __('Erro interno ao normalizar dados da análise. O retorno foi bloqueado com segurança.', 'glpiintegaglpi'),
        default => __('Erro interno na ação de IA. Revise a configuração local.', 'glpiintegaglpi'),
    };
}

function plugin_integaglpi_ticket_ai_error_json(string $action, Throwable $exception): never
{
    $errorType = plugin_integaglpi_ai_error_type($exception);
    error_log('[integaglpi][ai_action][' . preg_replace('/[^a-z0-9_:-]/i', '', $action) . '][unexpected] '
        . mb_substr(preg_replace('/(password|token|secret|bearer)\s*[:=]\s*\S+/i', '$1=[redacted]', $exception->getMessage()), 0, 200, 'UTF-8'));

    plugin_integaglpi_ticket_action_json([
        'ok' => false,
        'error' => $action . '_error',
        'error_type' => $errorType,
        'message' => plugin_integaglpi_ai_error_message($errorType),
    ], $errorType === 'permission_denied' || $errorType === 'csrf_failed' ? 403 : 500);
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
// ticket, never send WhatsApp, never publish KB. CSRF was validated above.
//
// Permission model:
//   smart_help, kb_feedback, suggest_kb — READ-only: canViewPanel() (Plugin::canRead())
//   smart_external                       — cloud/external: requires Plugin::canUpdate()
//                                          PLUS explicit human consent on every call.
//   Ticket-mutation actions              — always require Plugin::requireUpdate() below.
$aiAssistActions = ['smart_help', 'kb_feedback', 'smart_external', 'suggest_kb', 'analyze_conversation'];
if (in_array($action, $aiAssistActions, true)) {
    $smartHelp = new \GlpiPlugin\Integaglpi\Service\SmartHelpService();

    // Base gate: all AI assist actions require at least READ (canViewPanel).
    if (!\GlpiPlugin\Integaglpi\Service\SmartHelpService::canViewPanel()) {
        plugin_integaglpi_ticket_action_json([
            'ok' => false,
            'error' => 'forbidden',
            'error_type' => 'permission_denied',
            'message' => __('Sem permissão para visualizar a Ajuda Inteligente.', 'glpiintegaglpi'),
        ], 403);
    }
    if ($ticketId <= 0) {
        plugin_integaglpi_ticket_action_json([
            'ok' => false,
            'error' => 'invalid_ticket',
            'error_type' => 'missing_context',
            'message' => __('Chamado inválido para ação de IA.', 'glpiintegaglpi'),
        ], 400);
    }

    // Cloud/external gate: smart_external additionally requires UPDATE permission.
    // This prevents READ-only profiles from triggering any outbound cloud call.
    if ($action === 'smart_external' && !\GlpiPlugin\Integaglpi\Plugin::canUpdate()) {
        plugin_integaglpi_ticket_action_json([
            'ok'         => false,
            'error'      => 'forbidden',
            'error_type' => 'permission_denied',
            'message'    => 'A pesquisa externa requer permissão de atualização do plugin.',
        ], 403);
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
        try {
            plugin_integaglpi_ticket_action_json(['ok' => true, 'result' => $smartHelp->localFirstAssist($ticketId, $summary)], 200);
        } catch (\Throwable $e) {
            plugin_integaglpi_ticket_ai_error_json($action, $e);
        }
    }
    if ($action === 'kb_feedback') {
        try {
            $kbCandidateId = (int) ($_POST['kb_candidate_id'] ?? 0);
            $glpiKnowbaseitemId = (int) ($_POST['glpi_knowbaseitem_id'] ?? 0);
            $helpful = ($_POST['helpful'] ?? '') === '1' || ($_POST['helpful'] ?? '') === 'true';
            $note = trim((string) ($_POST['feedback_text'] ?? ''));
            plugin_integaglpi_ticket_action_json([
                'ok' => true,
                'result' => $smartHelp->recordFeedback($ticketId, $kbCandidateId, $glpiKnowbaseitemId, $helpful, $note),
            ], 200);
        } catch (\Throwable $e) {
            plugin_integaglpi_ticket_ai_error_json($action, $e);
        }
    }
    if ($action === 'smart_external') {
        try {
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
                plugin_integaglpi_ticket_action_json(['ok' => false, 'error' => 'forbidden_ticket', 'error_type' => 'permission_denied', 'message' => __('Sem permissão no chamado.', 'glpiintegaglpi')], 403);
            }
            plugin_integaglpi_ticket_action_json(['ok' => true, 'result' => $smartHelp->externalResearch($ticketId, $context, $consent)], 200);
        } catch (\Throwable $e) {
            plugin_integaglpi_ticket_ai_error_json($action, $e);
        }
    }
    if ($action === 'suggest_kb') {
        try {
            plugin_integaglpi_ticket_action_json(['ok' => true, 'result' => $smartHelp->suggestKb($ticketId)], 200);
        } catch (\Throwable $e) {
            plugin_integaglpi_ticket_ai_error_json($action, $e);
        }
    }
    if ($action === 'analyze_conversation') {
        try {
            if (!Plugin::isAiSupervisorEnabled()) {
                plugin_integaglpi_ticket_action_json([
                    'ok' => false,
                    'error' => 'ai_supervisor_disabled',
                    'error_type' => 'configuration_pending',
                    'message' => __('IA supervisora está desativada neste ambiente.', 'glpiintegaglpi'),
                ], 503);
            }
            if ($conversationId === '') {
                plugin_integaglpi_ticket_action_json([
                    'ok' => false,
                    'error' => 'missing_conversation',
                    'error_type' => 'missing_context',
                    'message' => __('Conversa obrigatória para análise IA.', 'glpiintegaglpi'),
                ], 400);
            }

            $ticket = new \Ticket();
            if (!$ticket->getFromDB($ticketId) || !$ticket->can($ticketId, READ)) {
                plugin_integaglpi_ticket_action_json([
                    'ok' => false,
                    'error' => 'forbidden_ticket',
                    'error_type' => 'permission_denied',
                    'message' => __('Chamado não encontrado ou sem permissão.', 'glpiintegaglpi'),
                ], 403);
            }

            $kbContext = [];
            try {
                $kbSourceTerms = [
                    'ticket_name' => (string) ($ticket->fields['name'] ?? ''),
                    'summary' => (string) ($ticket->fields['content'] ?? ''),
                ];
                $kbContext = (new \GlpiPlugin\Integaglpi\Service\NativeKnowledgeBaseService())
                    ->buildRelatedArticlesContext($kbSourceTerms, 5);
            } catch (\Throwable $kbException) {
                error_log('[integaglpi][ai_action][analyze_conversation][kb_context_error] '
                    . mb_substr(preg_replace('/(password|token|secret|bearer)\s*[:=]\s*\S+/i', '$1=[redacted]', $kbException->getMessage()), 0, 200, 'UTF-8'));
            }

            $response = (new \GlpiPlugin\Integaglpi\Service\IntegrationServiceClient())->requestAiQualityAnalysis([
                'conversation_id' => $conversationId,
                'glpi_ticket_id' => $ticketId,
                'glpi_user_id' => Plugin::getCurrentUserId(),
                'kb_context' => $kbContext,
            ]);

            if (!($response['success'] ?? false)) {
                $status = (int) ($response['status'] ?? 500);
                plugin_integaglpi_ticket_action_json([
                    'ok' => false,
                    'error' => 'analyze_conversation_error',
                    'error_type' => $status >= 500 ? 'provider_unavailable' : 'internal_error',
                    'message' => __('Não foi possível concluir a análise IA agora.', 'glpiintegaglpi'),
                ], max(400, $status));
            }

            plugin_integaglpi_ticket_action_json([
                'ok' => true,
                'result' => $response['body'] ?? [],
                'message' => __('Análise IA registrada para revisão humana.', 'glpiintegaglpi'),
            ], 200);
        } catch (\Throwable $e) {
            plugin_integaglpi_ticket_ai_error_json($action, $e);
        }
    }
}

Plugin::requireUpdate();

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
