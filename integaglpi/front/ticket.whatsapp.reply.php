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
    if (!isset($payload['csrf_token'])) {
        $payload['csrf_token'] = Plugin::getCsrfToken();
    }

    http_response_code($code);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

// ── Shared payload builder (GET or POST source) ──────────────────────────────
function integaglpiBuildOutboundPayload(
    int $ticketId,
    string $conversationId,
    string $replyText,
    int $userId,
    ?array $media = null
): array {
    $idempotencyKey = sprintf(
        '%04x%04x-%04x-%04x-%04x-%04x%04x%04x',
        mt_rand(0, 0xffff), mt_rand(0, 0xffff),
        mt_rand(0, 0xffff),
        mt_rand(0, 0x0fff) | 0x4000,
        mt_rand(0, 0x3fff) | 0x8000,
        mt_rand(0, 0xffff), mt_rand(0, 0xffff), mt_rand(0, 0xffff)
    );

    $payload = [
        'ticket_id'       => $ticketId,
        'conversation_id' => $conversationId,
        'text'            => $replyText,
        'message_type'    => $media !== null
            ? integaglpiMessageTypeForMime((string) ($media['mime_type'] ?? ''))
            : 'text',
        'glpi_user_id'    => $userId,
        'idempotency_key' => $idempotencyKey,
    ];

    if ($media !== null) {
        $payload['media'] = $media;
    }

    return $payload;
}

function integaglpiMessageTypeForMime(string $mime): string
{
    $mime = strtolower(trim(explode(';', $mime, 2)[0]));
    if (str_starts_with($mime, 'image/')) {
        return 'image';
    }
    if (str_starts_with($mime, 'audio/')) {
        return 'audio';
    }
    if (str_starts_with($mime, 'video/')) {
        return 'video';
    }

    return 'document';
}

function integaglpiMaxBytesForMime(string $mime): int
{
    $messageType = integaglpiMessageTypeForMime($mime);
    if ($messageType === 'audio') {
        return 16 * 1024 * 1024;
    }
    if ($messageType === 'video') {
        return 64 * 1024 * 1024;
    }

    return 15_728_640;
}

/**
 * Decide whether the current technician may reply on this conversation/ticket.
 *
 * Phase: integaglpi_ops_console_claim_ui_messaging_stabilization_001.
 * Rules:
 *  - The conversation must exist and be bound to the ticket.
 *  - It must be open (not closed/cancelled).
 *  - The conversation.assigned_user_id (= claimed technician) must equal $currentUserId.
 *    Read-only viewing is allowed, but sending requires ownership.
 *
 * Fail-closed: any lookup failure denies the send.
 *
 * @return array{allowed: bool, http_status: int, error: string, reason: string, message: string}
 */
function plugin_integaglpi_resolve_reply_gate(int $ticketId, string $conversationId, int $currentUserId): array
{
    $deny = static fn (int $code, string $error, string $reason, string $message): array => [
        'allowed' => false,
        'http_status' => $code,
        'error' => $error,
        'reason' => $reason,
        'message' => $message,
    ];

    if ($ticketId <= 0 || $conversationId === '' || $currentUserId <= 0) {
        return $deny(400, 'invalid_request', 'invalid_input', 'Requisição inválida para envio.');
    }

    try {
        $configService = new \GlpiPlugin\Integaglpi\Service\PluginConfigService();
        if (!$configService->isConfigured()) {
            return $deny(503, 'not_configured', 'integration_not_configured', 'Integração não configurada.');
        }
        $pdo = \GlpiPlugin\Integaglpi\External\ExternalDatabase::getConnection(
            $configService->getConnectionConfig()
        );
        \GlpiPlugin\Integaglpi\External\ExternalSchemaManager::ensureSchema($pdo);
        $repository = new \GlpiPlugin\Integaglpi\External\Repository\ConversationRepository($pdo);
        $conversation = $repository->findBoundToTicket($ticketId, $conversationId);
    } catch (\Throwable $e) {
        error_log('[integaglpi][outbound][reply_gate_lookup_error] ticket_id=' . $ticketId . ' ' . $e->getMessage());
        return $deny(500, 'lookup_failed', 'conversation_lookup_error', 'Não foi possível validar a conversa agora.');
    }

    if (!is_array($conversation)) {
        return $deny(404, 'not_found', 'conversation_not_found', 'Conversa não encontrada para este chamado.');
    }

    $conversationStatus = strtolower(trim((string) ($conversation['conversation_status'] ?? '')));
    $runtimeStatus = strtolower(trim((string) ($conversation['runtime_status'] ?? '')));
    if ($conversationStatus === 'closed' || $runtimeStatus === 'closed') {
        return $deny(409, 'conversation_closed', 'conversation_closed', 'Conversa encerrada. Não é possível responder.');
    }

    // Phase: integaglpi_ops_console_claim_ui_messaging_stabilization_001_FIX1.
    // Mirrors AttendanceCenterService::replyConversation: anything that is not
    // explicitly 'open' blocks the outbound. Pre-ticket states (awaiting_*,
    // collecting_contact_profile, pending_glpi, media_error, cancelled,
    // unknown) all fall here. Backend gate, not frontend cosmetic, so a direct
    // POST cannot bypass it.
    if ($conversationStatus !== 'open') {
        return $deny(
            409,
            'conversation_not_open',
            'conversation_status_' . ($conversationStatus !== '' ? $conversationStatus : 'unknown'),
            'A conversa não está aberta para resposta. Assuma/reabra o atendimento antes de responder.'
        );
    }

    $assignedUserId = (int) ($conversation['assigned_user_id'] ?? 0);
    if ($assignedUserId <= 0) {
        return $deny(
            403,
            'not_claimed',
            'no_claim',
            'Assuma o atendimento para responder. A conversa ainda não tem técnico responsável.'
        );
    }

    if ($assignedUserId !== $currentUserId) {
        return $deny(
            403,
            'not_owner',
            'owned_by_other_technician',
            'Você pode visualizar esta conversa, mas a resposta cabe ao técnico responsável. Solicite transferência.'
        );
    }

    return [
        'allowed' => true,
        'http_status' => 200,
        'error' => '',
        'reason' => '',
        'message' => '',
    ];
}

function integaglpiHasReplyUpload(): bool
{
    return isset($_FILES['reply_file'])
        && is_array($_FILES['reply_file'])
        && (int) ($_FILES['reply_file']['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_NO_FILE;
}

/**
 * @return array{filename: string, mime_type: string, content_base64: string}
 */
function integaglpiBuildReplyMediaPayload(array $file): array
{
    $error = (int) ($file['error'] ?? UPLOAD_ERR_NO_FILE);
    if ($error !== UPLOAD_ERR_OK) {
        throw new RuntimeException('Falha ao receber o arquivo enviado.');
    }

    $tmpName = (string) ($file['tmp_name'] ?? '');
    if ($tmpName === '' || !is_uploaded_file($tmpName) || !is_readable($tmpName)) {
        throw new RuntimeException('Arquivo enviado inválido.');
    }

    $size = (int) ($file['size'] ?? 0);
    if ($size <= 0) {
        throw new RuntimeException('Não consegui enviar o anexo pelo WhatsApp porque o arquivo está vazio.');
    }

    $detectedMime = '';
    if (class_exists('finfo')) {
        $finfo = new finfo(FILEINFO_MIME_TYPE);
        $candidate = $finfo->file($tmpName);
        $detectedMime = is_string($candidate) ? strtolower($candidate) : '';
    }
    if ($detectedMime === '' && function_exists('mime_content_type')) {
        $candidate = @mime_content_type($tmpName);
        $detectedMime = is_string($candidate) ? strtolower($candidate) : '';
    }
    $mime = explode(';', $detectedMime, 2)[0];
    if (!in_array($mime, [
        'application/pdf',
        'image/jpeg',
        'image/png',
        'image/gif',
        'audio/ogg',
        'audio/mpeg',
        'audio/mp4',
        'audio/aac',
        'audio/webm',
        'video/mp4',
        'video/3gpp',
    ], true)) {
        throw new RuntimeException('Formato de arquivo não suportado para envio via WhatsApp.');
    }

    if ($size > integaglpiMaxBytesForMime($mime)) {
        throw new RuntimeException('Não consegui enviar o anexo pelo WhatsApp porque o arquivo excede o limite permitido. Acesse o GLPI para visualizar.');
    }

    $originalName = basename(str_replace(['\\', '/'], DIRECTORY_SEPARATOR, (string) ($file['name'] ?? '')));
    $safeName = preg_replace('/[^\w.\- ()\[\]]+/', '_', $originalName) ?: '';
    if ($safeName === '') {
        $messageType = integaglpiMessageTypeForMime($mime);
        if ($messageType === 'image') {
            $safeName = 'imagem.png';
        } elseif ($messageType === 'audio') {
            $safeName = 'audio.ogg';
        } elseif ($messageType === 'video') {
            $safeName = 'video.mp4';
        } else {
            $safeName = 'documento.pdf';
        }
    }

    $content = file_get_contents($tmpName);
    if ($content === false || $content === '') {
        throw new RuntimeException('Não foi possível ler o arquivo enviado.');
    }

    return [
        'filename' => substr($safeName, 0, 180),
        'mime_type' => $mime,
        'content_base64' => base64_encode($content),
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
        $mediaPayload   = null;

        if ($ticketId <= 0) {
            integaglpiJsonResponse(['success' => false, 'message' => 'ticket_id inválido.', 'error' => 'invalid_ticket_id'], 400);
        }
        if ($conversationId === '') {
            integaglpiJsonResponse(['success' => false, 'message' => 'conversation_id obrigatório.', 'error' => 'missing_conversation_id'], 400);
        }
        if (integaglpiHasReplyUpload()) {
            try {
                $mediaPayload = integaglpiBuildReplyMediaPayload($_FILES['reply_file']);
            } catch (RuntimeException $exception) {
                integaglpiJsonResponse([
                    'success' => false,
                    'message' => $exception->getMessage(),
                    'error' => 'invalid_attachment',
                ], 400);
            }
            if ($replyText === '') {
                $replyText = sprintf('Anexo do chamado #%d: %s.', $ticketId, $mediaPayload['filename']);
            }
        }
        if ($replyText === '' && $mediaPayload === null) {
            integaglpiJsonResponse(['success' => false, 'message' => 'Informe uma mensagem ou anexe um arquivo.', 'error' => 'empty_reply'], 400);
        }

        $ticket = new \Ticket();
        if (!$ticket->getFromDB($ticketId)) {
            integaglpiJsonResponse(['success' => false, 'message' => 'Ticket não encontrado.', 'error' => 'ticket_not_found'], 404);
        }
        $ticket->check($ticketId, UPDATE);

        // Phase: integaglpi_ops_console_claim_ui_messaging_stabilization_001.
        // Only the assigned technician may respond via WhatsApp from inside the
        // ticket. Backend gate, not frontend cosmetic. Mirrors the same rule
        // enforced in AttendanceCenterService::replyConversation.
        $replyGate = plugin_integaglpi_resolve_reply_gate($ticketId, $conversationId, $currentUserId);
        if (!$replyGate['allowed']) {
            integaglpiJsonResponse([
                'success' => false,
                'message' => $replyGate['message'],
                'error'   => $replyGate['error'],
                'reason'  => $replyGate['reason'],
            ], $replyGate['http_status']);
        }

        $payload = integaglpiBuildOutboundPayload($ticketId, $conversationId, $replyText, $currentUserId, $mediaPayload);

        error_log('[integaglpi][outbound][BEFORE_NODE] ' . json_encode([
            'method'          => 'POST',
            'ticket_id'       => $ticketId,
            'conversation_id' => $conversationId,
            'glpi_user_id'    => $currentUserId,
            'idempotency_key' => $payload['idempotency_key'],
            'message_type'    => $payload['message_type'],
            'text_len'        => mb_strlen($replyText),
            'has_media'       => $mediaPayload !== null,
        ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

        $client = new IntegrationServiceClient();
        $result = $client->sendOutbound($payload);

        if (!$result['success']) {
            $body = is_array($result['body'] ?? null) ? $result['body'] : [];
            $errorCode = (string) ($body['error_code'] ?? 'upstream_error');
            $message = (string) ($body['message'] ?? '');
            if ($errorCode === 'WINDOW_24H_CLOSED_TEMPLATE_REQUIRED') {
                $message = 'A janela de 24h está fechada. Use um template aprovado antes de enviar texto livre.';
            } elseif ($errorCode === 'TEMPLATE_NOT_ALLOWED') {
                $message = 'Template não permitido para envio manual. Use um template aprovado e ativo pelo fluxo controlado.';
            } elseif ($message === '') {
                $message = 'Não foi possível enviar a mensagem pelo WhatsApp agora.';
            }
            $httpStatus = (int) ($result['status'] ?? 502);
            if ($httpStatus < 400 || $httpStatus > 599) {
                $httpStatus = 502;
            }

            integaglpiJsonResponse([
                'success' => false,
                'message' => $message,
                'error'   => $errorCode,
                'detail'  => [
                    'status' => (string) ($body['status'] ?? 'failed'),
                    'error_code' => $errorCode,
                ],
            ], $httpStatus);
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
