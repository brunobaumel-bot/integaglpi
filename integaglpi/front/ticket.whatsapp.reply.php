<?php

declare(strict_types=1);

use GlpiPlugin\Integaglpi\Plugin;
use GlpiPlugin\Integaglpi\Service\IntegrationServiceClient;

include '../../../inc/includes.php';

$method = strtoupper(trim($_SERVER['REQUEST_METHOD'] ?? 'GET'));

error_log('[integaglpi][outbound][REPLY_ENDPOINT_HIT] ' . json_encode([
    'method'   => $method,
    'uri'      => $_SERVER['REQUEST_URI'] ?? '',
    'has_csrf' => array_key_exists('_glpi_csrf_token', $_POST ?? []),
    'user_id'  => (int) (Session::getLoginUserID() ?: 0),
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

// ── Shared helper — JSON-only, exits immediately ─────────────────────────────
function integaglpiJsonResponse(array $payload, int $code = 200): never
{
    http_response_code($code);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

// ── Shared payload builder (GET or POST source) ──────────────────────────────
function integaglpiBuildOutboundPayload(
    int $ticketId,
    string $conversationId,
    string $replyText,
    int $userId
): array {
    $idempotencyKey = sprintf(
        '%04x%04x-%04x-%04x-%04x-%04x%04x%04x',
        mt_rand(0, 0xffff), mt_rand(0, 0xffff),
        mt_rand(0, 0xffff),
        mt_rand(0, 0x0fff) | 0x4000,
        mt_rand(0, 0x3fff) | 0x8000,
        mt_rand(0, 0xffff), mt_rand(0, 0xffff), mt_rand(0, 0xffff)
    );

    return [
        'ticket_id'       => $ticketId,
        'conversation_id' => $conversationId,
        'text'            => $replyText,
        'message_type'    => 'text',
        'glpi_user_id'    => $userId,
        'idempotency_key' => $idempotencyKey,
    ];
}

// ── POST path — always returns JSON, never HTML ──────────────────────────────
if ($method === 'POST') {
    header('Content-Type: application/json; charset=UTF-8');

    try {
        $currentUserId = (int) Session::getLoginUserID();
        if ($currentUserId <= 0) {
            integaglpiJsonResponse(['success' => false, 'message' => 'Não autenticado.', 'error' => 'unauthenticated'], 401);
        }

        // Phase 7.4C alignment: use the same CSRF helper as config.form.php and the
        // Central. Premise (GLPI 11): the upstream middleware validates and consumes
        // _glpi_csrf_token before our code runs, so Plugin::isCsrfValid trusts the
        // upstream when the token is present in the request but already consumed
        // from the session. Empty token is always rejected.
        if (!Plugin::isCsrfValid($_POST)) {
            error_log('[integaglpi][outbound][ERROR] CSRF validation failed user_id=' . $currentUserId);
            integaglpiJsonResponse(['success' => false, 'message' => 'Token de segurança inválido.', 'error' => 'csrf_invalid'], 403);
        }

        if (!Plugin::canUpdate()) {
            integaglpiJsonResponse(['success' => false, 'message' => 'Permissão insuficiente.', 'error' => 'forbidden'], 403);
        }

        $ticketId       = (int)   ($_POST['ticket_id']       ?? 0);
        $conversationId = trim((string) ($_POST['conversation_id'] ?? ''));
        $replyText      = trim((string) ($_POST['reply_text']      ?? ''));

        if ($ticketId <= 0) {
            integaglpiJsonResponse(['success' => false, 'message' => 'ticket_id inválido.', 'error' => 'invalid_ticket_id'], 400);
        }
        if ($conversationId === '') {
            integaglpiJsonResponse(['success' => false, 'message' => 'conversation_id obrigatório.', 'error' => 'missing_conversation_id'], 400);
        }
        if ($replyText === '') {
            integaglpiJsonResponse(['success' => false, 'message' => 'A mensagem não pode ser vazia.', 'error' => 'empty_reply_text'], 400);
        }

        $ticket = new \Ticket();
        if (!$ticket->getFromDB($ticketId)) {
            integaglpiJsonResponse(['success' => false, 'message' => 'Ticket não encontrado.', 'error' => 'ticket_not_found'], 404);
        }
        $ticket->check($ticketId, UPDATE);

        $payload = integaglpiBuildOutboundPayload($ticketId, $conversationId, $replyText, $currentUserId);

        error_log('[integaglpi][outbound][BEFORE_NODE] ' . json_encode([
            'method'          => 'POST',
            'ticket_id'       => $ticketId,
            'conversation_id' => $conversationId,
            'glpi_user_id'    => $currentUserId,
            'idempotency_key' => $payload['idempotency_key'],
            'text_len'        => mb_strlen($replyText),
        ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

        $client = new IntegrationServiceClient();
        $result = $client->sendOutbound($payload);

        if (!$result['success']) {
            integaglpiJsonResponse([
                'success' => false,
                'message' => 'integration-service retornou HTTP ' . $result['status'],
                'error'   => 'upstream_error',
                'detail'  => $result['body'],
            ], 502);
        }

        integaglpiJsonResponse(['success' => true]);

    } catch (Throwable $exception) {
        error_log('[integaglpi][outbound][ERROR] ' . $exception->getMessage());
        error_log($exception->getTraceAsString());
        integaglpiJsonResponse([
            'success' => false,
            'message' => $exception->getMessage(),
            'error'   => 'internal_error',
        ], 500);
    }
}

// ── Non-POST methods are not allowed — Phase 7.4C hardening ──────────────────
// The previous GET path issued real outbound messages without CSRF. It has been
// removed: only POST (handled above) may send WhatsApp messages. The WhatsApp
// tab and Central already POST via fetch, so removing GET is contract-safe.
header('Content-Type: application/json; charset=UTF-8');
header('Allow: POST');
integaglpiJsonResponse([
    'success' => false,
    'message' => 'Método não permitido. Use POST.',
    'error'   => 'method_not_allowed',
], 405);
