<?php

declare(strict_types=1);

/**
 * IntegraGLPI — Internal hardware sync bridge.
 *
 * Lives in the LiteSpeed docroot (public/) so LiteSpeed serves it as a standalone
 * PHP file, bypassing GLPI 11's Symfony router (which applies CSRF to POST on
 * plugin paths). Files that exist in public/ are NOT rewritten to index.php by
 * the .htaccess RewriteCond %{REQUEST_FILENAME} !-f rule.
 *
 * Bootstrap strategy:
 *   1. Pre-auth check (raw key comparison) — runs BEFORE any GLPI loading.
 *   2. vendor/autoload.php — sets up Composer PSR-4 autoloading.
 *   3. Plugin PSR-4 namespace registered via spl_autoload_register.
 *   4. GLPI Kernel booted — establishes DB connection and initialises GLPI config.
 *   5. Confirmed auth via PluginConfigService::getIntegrationAuthKey().
 *
 * Security model:
 *   - X-Integaglpi-Key header required; auth checked BEFORE GLPI is loaded.
 *   - Only POST method accepted.
 *   - File is in public/ but protected by the two-stage key check.
 *
 * PHASE: integaglpi_logmein_hardware_enrichment_php_bridge_001
 */

header('Content-Type: application/json; charset=UTF-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

// ── Minimal pre-GLPI helpers ─────────────────────────────────────────────────
/**
 * @param array<string, mixed> $payload
 */
function igxhw_respond(array $payload, int $status = 200): never
{
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

// ── Method guard ─────────────────────────────────────────────────────────────
if (strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'POST')) !== 'POST') {
    igxhw_respond(['ok' => false, 'error' => 'method_not_allowed'], 405);
}

// ── Stage 1: Pre-load auth check ─────────────────────────────────────────────
// Runs BEFORE loading GLPI so that unauthenticated requests are rejected fast.
$presentedToken = '';
if (isset($_SERVER['HTTP_X_INTEGAGLPI_KEY']) && $_SERVER['HTTP_X_INTEGAGLPI_KEY'] !== '') {
    $presentedToken = trim((string) $_SERVER['HTTP_X_INTEGAGLPI_KEY']);
} else {
    $allHeaders = function_exists('getallheaders') ? (array) getallheaders() : [];
    foreach ($allHeaders as $hName => $hValue) {
        if (strcasecmp((string) $hName, 'X-Integaglpi-Key') === 0) {
            $presentedToken = trim((string) $hValue);
            break;
        }
    }
}
if ($presentedToken === '') {
    igxhw_respond(['ok' => false, 'error' => 'unauthorized'], 401);
}

// ── Bootstrap GLPI ────────────────────────────────────────────────────────────
// 1) Composer PSR-4 autoloader (GLPI core + dependencies).
require __DIR__ . '/../vendor/autoload.php';

// 2) Plugin PSR-4 namespace — not in GLPI's main vendor autoload map because
//    plugin is separate from GLPI core. Register here so service classes resolve.
spl_autoload_register(static function (string $class): void {
    $prefix = 'GlpiPlugin\\Integaglpi\\';
    $baseDir = __DIR__ . '/../plugins/integaglpi/src/';
    if (strncmp($prefix, $class, strlen($prefix)) !== 0) {
        return;
    }
    $relClass = str_replace('\\', '/', substr($class, strlen($prefix)));
    $file = $baseDir . $relClass . '.php';
    if (file_exists($file)) {
        require_once $file;
    }
});

// 3) Boot the GLPI Kernel to initialise DB connection and plugin config.
//    boot() sets up the DI container but does NOT handle HTTP requests.
$kernel = new Glpi\Kernel\Kernel('production', false);
$kernel->boot();

// ── Stage 2: Confirmed auth via GLPI config ────────────────────────────────
use GlpiPlugin\Integaglpi\Service\ComputerHardwareSyncService;
use GlpiPlugin\Integaglpi\Service\PluginConfigService;

$expectedToken = (new PluginConfigService())->getIntegrationAuthKey();
if ($expectedToken === '' || !hash_equals($expectedToken, $presentedToken)) {
    igxhw_respond(['ok' => false, 'error' => 'unauthorized'], 401);
}

// ── Parse JSON body ───────────────────────────────────────────────────────────
$rawBody = (string) file_get_contents('php://input');
if ($rawBody === '') {
    igxhw_respond(['ok' => false, 'error' => 'empty_body'], 400);
}
$input = json_decode($rawBody, true);
if (!is_array($input)) {
    igxhw_respond(['ok' => false, 'error' => 'invalid_json'], 400);
}
$computerId = is_int($input['computer_id'] ?? null) ? (int) $input['computer_id']
    : (is_numeric($input['computer_id'] ?? '') ? (int) $input['computer_id'] : 0);
if ($computerId <= 0) {
    igxhw_respond(['ok' => false, 'error' => 'missing_computer_id'], 400);
}

// ── Delegate ──────────────────────────────────────────────────────────────────
try {
    $service = new ComputerHardwareSyncService();
    $result  = $service->sync($computerId, $input);
    igxhw_respond(['ok' => true, 'result' => $result]);
} catch (Throwable $e) {
    $safe = mb_substr(preg_replace(
        '/(password|token|secret|bearer|psk|companyid|api_key)\s*[:=]\s*\S+/i',
        '$1=[redacted]',
        strip_tags($e->getMessage())
    ) ?? '', 0, 240, 'UTF-8');
    error_log('[integaglpi][hw_bridge] ' . $safe);
    igxhw_respond(['ok' => false, 'error' => 'internal_error', 'message' => $safe], 500);
}
