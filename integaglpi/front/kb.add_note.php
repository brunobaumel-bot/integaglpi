<?php

declare(strict_types=1);

use GlpiPlugin\Integaglpi\Plugin;

include '../../../inc/includes.php';

/**
 * KB Add Private Note — GLPI-session-gated endpoint.
 *
 * Adds a technician-composed note as a PRIVATE ITILFollowup (is_private=1).
 *
 * Safety contract:
 *   - is_private ALWAYS = 1.  NEVER = 0.
 *   - Human click required (UI confirmation dialog before fetch).
 *   - CSRF validated.
 *   - Ticket READ + UPDATE permission verified before writing.
 *   - Content sanitized (strip_tags, max 10 000 chars).
 *   - No auto-trigger: PHP does NOT call this endpoint autonomously.
 *   - No WhatsApp send. No ticket status change. No category change.
 *   - No Node.js / no MariaDB direct: uses GLPI ORM (ITILFollowup::add).
 *
 * Input (POST, JSON body):
 *   {
 *     "_glpi_csrf_token": "...",
 *     "ticket_id": 123,
 *     "content": "texto da nota"
 *   }
 *
 * Output:
 *   { "ok": true,  "followup_id": 456 }
 *   { "ok": false, "message": "..." }
 *
 * Phase: integaglpi_local_kb_rag_technician_copilot_001
 * Adendo: integaglpi_local_kb_rag_technician_copilot_001_adendo_pipeline_qdrant_001
 */

header('Content-Type: application/json; charset=UTF-8');
header('Cache-Control: no-store');

function kbAddNoteRespond(array $payload, int $status = 200): void
{
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

// 1. Session required
Session::checkLoginUser();

// 2. POST only
if (strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET')) !== 'POST') {
    kbAddNoteRespond(['ok' => false, 'message' => 'Method not allowed.'], 405);
}

// 3. Parse body
$rawBody = (string) file_get_contents('php://input');
$body    = json_decode($rawBody, true);
$merged  = array_merge($_POST, is_array($body) ? $body : []);

// 4. CSRF
if (!Plugin::isCsrfValid($merged)) {
    kbAddNoteRespond(['ok' => false, 'message' => 'Token CSRF inválido.'], 403);
}

// 5. Validate ticket_id
$ticketId = isset($merged['ticket_id']) ? (int) $merged['ticket_id'] : 0;
if ($ticketId <= 0) {
    kbAddNoteRespond(['ok' => false, 'message' => 'ticket_id obrigatório.'], 400);
}

// 6. Check ticket READ + UPDATE permission via GLPI ORM
$ticket = new Ticket();
if (!$ticket->getFromDB($ticketId) || !$ticket->can($ticketId, UPDATE)) {
    kbAddNoteRespond(['ok' => false, 'message' => 'Permissão insuficiente para este chamado.'], 403);
}

// 7. Sanitize content
$rawContent = (string) ($merged['content'] ?? '');
$content    = mb_substr(strip_tags($rawContent), 0, 10_000, 'UTF-8');

if (mb_strlen(trim($content), 'UTF-8') < 5) {
    kbAddNoteRespond(['ok' => false, 'message' => 'Conteúdo muito curto.'], 400);
}

// 8. Add private followup using GLPI ORM
// is_private ALWAYS = 1. This is enforced here — never passed from client.
$followup = new ITILFollowup();
$insertId = $followup->add([
    'itemtype'  => 'Ticket',
    'items_id'  => $ticketId,
    'content'   => $content,
    'is_private' => 1,                           // ALWAYS private
    'users_id'  => (int) Session::getLoginUserID(),
    'date'      => date('Y-m-d H:i:s'),
]);

if ($insertId === false || $insertId <= 0) {
    kbAddNoteRespond(['ok' => false, 'message' => 'Falha ao adicionar nota no GLPI.'], 500);
}

kbAddNoteRespond([
    'ok'          => true,
    'followup_id' => (int) $insertId,
    'ticket_id'   => $ticketId,
    'is_private'  => 1,
]);
