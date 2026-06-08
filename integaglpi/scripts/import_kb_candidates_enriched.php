#!/usr/bin/env php
<?php
/**
 * CLI: Import KB Candidates from enriched bundle JSON (integaglpi.kb_bundle.v1.1).
 *
 * Usage:
 *   DB_HOST=<host> DB_PORT=<port> DB_NAME=<dbname> DB_USER=<user> DB_PASS=<pass> \
 *     php scripts/import_kb_candidates_enriched.php <path-to-bundle.json>
 *
 * Environment variables:
 *   DB_HOST  (default: 127.0.0.1)
 *   DB_PORT  (default: 5432)
 *   DB_NAME  (required)
 *   DB_USER  (required)
 *   DB_PASS  (required)
 *
 * Safety:
 *   - publicados_na_kb is ALWAYS 0 (no GLPI article published automatically)
 *   - status is ALWAYS 'candidate' (human review required before any promotion)
 *   - revisao_humana is ALWAYS true
 *   - No WhatsApp, no ticket creation, no MariaDB access
 *
 * PHASE: integaglpi_kb_candidates_enriched_import_001
 */

declare(strict_types=1);

// ── Autoload (composer or fallback) ──────────────────────────────────────────

$pluginRoot = dirname(__DIR__);

if (file_exists($pluginRoot . '/vendor/autoload.php')) {
    require_once $pluginRoot . '/vendor/autoload.php';
} else {
    spl_autoload_register(static function (string $class) use ($pluginRoot): void {
        $prefix = 'GlpiPlugin\\Integaglpi\\';
        if (strncmp($class, $prefix, strlen($prefix)) !== 0) {
            return;
        }
        $relative = substr($class, strlen($prefix));
        $path = $pluginRoot . '/src/' . str_replace('\\', '/', $relative) . '.php';
        if (is_file($path)) {
            require_once $path;
        }
    });
}

// ── Arguments ─────────────────────────────────────────────────────────────────

if (PHP_SAPI !== 'cli') {
    fwrite(STDERR, "Este script só pode ser executado via CLI.\n");
    exit(1);
}

$filePath = $argv[1] ?? '';
if ($filePath === '' || !file_exists($filePath)) {
    fwrite(STDERR, "Uso: php scripts/import_kb_candidates_enriched.php <bundle.json>\n");
    exit(1);
}

// ── DB connection from env ─────────────────────────────────────────────────────

$dbHost = getenv('DB_HOST') ?: '127.0.0.1';
$dbPort = getenv('DB_PORT') ?: '5432';
$dbName = getenv('DB_NAME') ?: '';
$dbUser = getenv('DB_USER') ?: '';
$dbPass = getenv('DB_PASS') ?: '';

if ($dbName === '' || $dbUser === '' || $dbPass === '') {
    fwrite(STDERR, "Variáveis de ambiente obrigatórias: DB_NAME, DB_USER, DB_PASS\n");
    exit(1);
}

try {
    $dsn = sprintf('pgsql:host=%s;port=%s;dbname=%s', $dbHost, $dbPort, $dbName);
    $pdo = new PDO($dsn, $dbUser, $dbPass, [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES   => false,
    ]);
} catch (PDOException $e) {
    fwrite(STDERR, "Falha na conexão com PostgreSQL: " . $e->getMessage() . "\n");
    exit(1);
}

// ── Run import ─────────────────────────────────────────────────────────────────

use GlpiPlugin\Integaglpi\Service\KbCandidateImportService;

$service = new KbCandidateImportService($pdo);
$result  = $service->importFromFile(realpath($filePath) ?: $filePath);

// ── Print SMOKE result ────────────────────────────────────────────────────────

$smoke = [
    'arquivo'               => basename($filePath),
    'resultado' => [
        'total_lido'            => $result['total_lido'],
        'candidatos_importados' => $result['candidatos_importados'],
        'candidatos_skipped'    => $result['candidatos_skipped'],
        'publicados_na_kb'      => $result['publicados_na_kb'],   // ALWAYS 0
        'status'                => $result['status'],              // ALWAYS 'candidate'
        'revisao_humana'        => $result['revisao_humana'],      // ALWAYS true
        'ok'                    => $result['ok'],
    ],
    'imported_keys' => $result['imported_keys'],
    'errors'        => $result['errors'],
];

echo json_encode($smoke, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT) . "\n";

// ── Verify SMOKE_ESPERADO ─────────────────────────────────────────────────────

$pass = true;
$checks = [];

$checks['total_lido >= 20'] = $result['total_lido'] >= 20;
$checks['status === candidate'] = $result['status'] === 'candidate';
$checks['publicados_na_kb === 0'] = $result['publicados_na_kb'] === 0;
$checks['revisao_humana === true'] = $result['revisao_humana'] === true;
$checks['candidatos_importados > 0'] = $result['candidatos_importados'] > 0;
$checks['no_fatal_errors'] = count($result['errors']) === 0;

foreach ($checks as $label => $ok) {
    $icon = $ok ? '✓' : '✗';
    echo sprintf("  %s %s\n", $icon, $label);
    if (!$ok) {
        $pass = false;
    }
}

echo "\n" . ($pass ? "SMOKE: PASS\n" : "SMOKE: FAIL\n");
exit($pass ? 0 : 1);
