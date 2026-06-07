<?php

declare(strict_types=1);

use GlpiPlugin\Integaglpi\Service\KbSearchService;
use GlpiPlugin\Integaglpi\Service\PluginConfigService;

include '../../../inc/includes.php';

header('Content-Type: application/json; charset=UTF-8');
header('Cache-Control: no-store');

/**
 * Internal, bearer-gated native-KB search endpoint.
 *
 * Phase: integaglpi_ai_kb_ecosystem_ui_and_wiring_001.
 *
 * Called machine-to-machine by the Node SmartHelpService (HttpKbSearchPort) so it
 * can surface native GLPI KB articles without touching MariaDB directly. Read-only;
 * no ticket mutation, no WhatsApp, no auto-publish.
 */

function integaglpiKbSearchRespond(array $payload, int $status = 200): void
{
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

// ── Internal key authentication ──────────────────────────────────────────────
// GLPI 11 / LiteSpeed intercepts the standard Authorization header before the
// plugin script executes, causing spurious 401/403 responses.
// Primary:  X-Integaglpi-Key (avoids the GLPI session interceptor).
// Fallback: Authorization: Bearer (backward-compat; may be blocked by GLPI 11).
$presentedToken = '';

if (isset($_SERVER['HTTP_X_INTEGAGLPI_KEY']) && $_SERVER['HTTP_X_INTEGAGLPI_KEY'] !== '') {
    // LiteSpeed / Apache normalise X-Integaglpi-Key → HTTP_X_INTEGAGLPI_KEY.
    $presentedToken = trim((string) $_SERVER['HTTP_X_INTEGAGLPI_KEY']);
} else {
    // getallheaders() case-insensitive scan (covers non-standard header normalisation).
    $allHeaders = function_exists('getallheaders') ? (array) getallheaders() : [];
    foreach ($allHeaders as $hName => $hValue) {
        if (strcasecmp((string) $hName, 'X-Integaglpi-Key') === 0) {
            $presentedToken = trim((string) $hValue);
            break;
        }
    }
}

// Fallback: Authorization: Bearer (backward-compat — GLPI 11 may intercept this).
if ($presentedToken === '') {
    $legacyAuth = '';
    if (isset($_SERVER['HTTP_AUTHORIZATION'])) {
        $legacyAuth = (string) $_SERVER['HTTP_AUTHORIZATION'];
    } elseif (function_exists('apache_request_headers')) {
        $legacyHeaders = apache_request_headers();
        $legacyAuth = (string) ($legacyHeaders['Authorization'] ?? $legacyHeaders['authorization'] ?? '');
    }
    if (preg_match('/^Bearer\s+(.+)$/i', trim($legacyAuth), $m) === 1) {
        $presentedToken = trim($m[1]);
    }
}

$expectedToken = (new PluginConfigService())->getIntegrationAuthKey();

if ($expectedToken === '' || $presentedToken === '' || !hash_equals($expectedToken, $presentedToken)) {
    integaglpiKbSearchRespond(['ok' => false, 'message' => 'Unauthorized.'], 401);
}

if (strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET')) !== 'POST') {
    integaglpiKbSearchRespond(['ok' => false, 'message' => 'Method not allowed.'], 405);
}

// ── Parse request ───────────────────────────────────────────────────────────
$raw = file_get_contents('php://input');
$body = is_string($raw) ? json_decode($raw, true) : null;
if (!is_array($body)) {
    $body = [];
}

$query = trim((string) ($body['query'] ?? ''));
$limit = (int) ($body['limit'] ?? 5);

if ($query === '') {
    integaglpiKbSearchRespond(['ok' => true, 'articles' => []]);
}

// ── Search (read-only, visibility-filtered) ─────────────────────────────────
try {
    $articles = (new KbSearchService())->search($query, $limit);
    integaglpiKbSearchRespond(['ok' => true, 'articles' => $articles]);
} catch (\Throwable $e) {
    error_log('[integaglpi][kb.search] ' . mb_substr(strip_tags($e->getMessage()), 0, 200, 'UTF-8'));
    integaglpiKbSearchRespond(['ok' => false, 'message' => 'Busca indisponível.', 'articles' => []], 500);
}
