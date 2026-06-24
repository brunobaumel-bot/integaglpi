<?php

declare(strict_types=1);

use GlpiPlugin\Integaglpi\Plugin;
use GlpiPlugin\Integaglpi\Service\KbCopilotBridgeService;
use GlpiPlugin\Integaglpi\Service\PluginConfigService;

include '../../../inc/includes.php';

/**
 * KB Smart Help — internal AJAX endpoint.
 *
 * GLPI session + CSRF required.
 * Calls Node KB RAG copilot (local Ollama, no cloud, no auto-send).
 * Returns structured playbook JSON for the technician UI.
 *
 * Phase: integaglpi_local_kb_rag_technician_copilot_001
 */

header('Content-Type: application/json; charset=UTF-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

function kbSmartHelpRespond(array $payload, int $status = 200): void
{
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

// ── Auth: session + CSRF ────────────────────────────────────────────────────
Session::checkLoginUser();

if (strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET')) !== 'POST') {
    kbSmartHelpRespond(['ok' => false, 'message' => 'Method not allowed.'], 405);
}

// CSRF check (Plugin::isCsrfValid reads _glpi_csrf_token from body/headers)
$rawBody  = (string) file_get_contents('php://input');
$body     = is_string($rawBody) ? (array) json_decode($rawBody, true) : [];
if (!is_array($body)) {
    $body = [];
}

// Merge POST (form) and JSON body for flexibility
$merged = array_merge($_POST, $body);

if (!Plugin::isCsrfValid($merged)) {
    kbSmartHelpRespond(['ok' => false, 'message' => 'Token CSRF inválido.'], 403);
}

// ── Input ────────────────────────────────────────────────────────────────────
$query = mb_substr(trim((string) ($merged['query'] ?? '')), 0, 800, 'UTF-8');
if ($query === '') {
    kbSmartHelpRespond(['ok' => false, 'message' => 'query é obrigatório.'], 400);
}

$ticketId     = isset($merged['ticket_id']) ? (int) $merged['ticket_id'] : null;
$topK         = max(3, min(5, (int) ($merged['top_k'] ?? 5)));
$technicianId = Plugin::getCurrentUserId() ?: null;

// Validate ticket_id if provided (read-only — never mutated)
if ($ticketId !== null && $ticketId <= 0) {
    $ticketId = null;
}

// ── Client context — read-only extraction from GLPI ticket ───────────────────
// Used for ranking boost only; never as a hard filter. Node never reads MariaDB.
$clientContext = null;
if ($ticketId !== null) {
    try {
        $ticket = new Ticket();
        if ($ticket->getFromDB($ticketId)) {
            $ctx = [];
            // Entity ID for future use (reserved — not yet used in Node ranking)
            $entityId = (int) ($ticket->fields['entities_id'] ?? 0);
            if ($entityId > 0) {
                $ctx['entityId'] = $entityId;
            }
            // Category name (softer boost, 0.05)
            $itilCatId = (int) ($ticket->fields['itilcategories_id'] ?? 0);
            if ($itilCatId > 0) {
                $cat = new ITILCategory();
                if ($cat->getFromDB($itilCatId)) {
                    $catName = trim((string) ($cat->fields['name'] ?? ''));
                    if ($catName !== '') {
                        $ctx['category'] = mb_substr($catName, 0, 120, 'UTF-8');
                    }
                }
            }
            // Product/system from request type or title heuristic (strongest boost, 0.10)
            // Accept explicit override from JS payload if provided
            $productFromPayload = mb_substr(trim((string) ($merged['client_product'] ?? '')), 0, 120, 'UTF-8');
            if ($productFromPayload !== '') {
                $ctx['productOrSystem'] = $productFromPayload;
            }
            if (count($ctx) > 0) {
                $clientContext = $ctx;
            }
        }
    } catch (\Throwable $ctxErr) {
        // Context extraction is best-effort — never block the main flow
        error_log('[integaglpi][kb.smart_help] ctx extract: ' . mb_substr(strip_tags($ctxErr->getMessage()), 0, 100, 'UTF-8'));
    }
}

// ── Bridge call ──────────────────────────────────────────────────────────────
try {
    $result = (new KbCopilotBridgeService(new PluginConfigService()))
        ->fetchPlaybook($query, $ticketId, $technicianId, $topK, $clientContext);

    kbSmartHelpRespond($result);
} catch (\Throwable $e) {
    error_log('[integaglpi][kb.smart_help] ' . mb_substr(strip_tags($e->getMessage()), 0, 200, 'UTF-8'));
    kbSmartHelpRespond(['ok' => false, 'message' => 'Serviço KB indisponível.', 'playbook' => null], 500);
}
