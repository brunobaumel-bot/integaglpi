<?php

declare(strict_types=1);

use GlpiPlugin\Integaglpi\Service\FormCatalogService;
use GlpiPlugin\Integaglpi\Service\PluginConfigService;

include '../../../inc/includes.php';

header('Content-Type: application/json; charset=UTF-8');
header('Cache-Control: no-store');

/**
 * Read-only JSON endpoint for native GLPI form catalog (glpi_forms_forms).
 *
 * Called machine-to-machine by the Node GlpiFormCatalogAdapter — never touches
 * the PostgreSQL integration DB. Read-only; no ticket mutation, no WhatsApp, no
 * auto-publish.
 *
 * Auth: shared bearer token (same integration_auth_key used by kb.search.php).
 *
 * PHASE: integaglpi_v8_service_catalog_gap_fix_and_bridge_001
 */

/**
 * @param array<string, mixed> $payload
 */
function integaglpi_form_catalog_respond(array $payload, int $status = 200): never
{
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

// ── Method guard ────────────────────────────────────────────────────────────
if (strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET')) !== 'GET') {
    integaglpi_form_catalog_respond(['ok' => false, 'error' => 'method_not_allowed'], 405);
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
    integaglpi_form_catalog_respond(['ok' => false, 'error' => 'unauthorized'], 401);
}

// ── Query parameters ─────────────────────────────────────────────────────────
$entitiesId = max(0, (int) ($_GET['entities_id'] ?? 0));

// ── Fetch forms (read-only, never mutates) ───────────────────────────────────
try {
    $forms = (new FormCatalogService())->getActiveFormsByEntity($entitiesId);
    integaglpi_form_catalog_respond(['ok' => true, 'forms' => $forms]);
} catch (Throwable $e) {
    error_log('[integaglpi][form.catalog] ' . mb_substr(strip_tags($e->getMessage()), 0, 200, 'UTF-8'));
    integaglpi_form_catalog_respond(['ok' => false, 'error' => 'internal_error'], 500);
}
