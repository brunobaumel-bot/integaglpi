<?php

declare(strict_types=1);

use GlpiPlugin\Integaglpi\Plugin;

include '../../../inc/includes.php';

header('Content-Type: application/json; charset=UTF-8');

/**
 * @param array<string, mixed> $payload
 */
function integaglpi_health_proxy_response(array $payload, int $status = 200): never
{
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

try {
    Session::checkLoginUser();
} catch (Throwable) {
    integaglpi_health_proxy_response([
        'ok' => false,
        'error' => 'unauthorized',
    ], 401);
}

if (!Session::haveRight(Plugin::RIGHT_NAME, READ)) {
    integaglpi_health_proxy_response([
        'ok' => false,
        'error' => 'forbidden',
    ], 403);
}

$healthUrl = 'http://127.0.0.1:3001/health';

$ch = curl_init($healthUrl);
if ($ch === false) {
    integaglpi_health_proxy_response([
        'ok' => false,
        'reachable' => false,
        'message' => 'curl_init_failed',
    ], 200);
}

curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_FOLLOWLOCATION => false,
    CURLOPT_TIMEOUT => 2,
    CURLOPT_CONNECTTIMEOUT => 2,
    CURLOPT_HTTPGET => true,
    CURLOPT_USERAGENT => 'GLPI-Integaglpi-Health-Proxy/1.0',
]);

$raw = curl_exec($ch);
$errno = curl_errno($ch);
$errmsg = (string) curl_error($ch);
$http = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

if ($raw === false || $errno !== 0) {
    integaglpi_health_proxy_response([
        'ok' => false,
        'reachable' => false,
        'message' => 'integration_unreachable',
        'detail' => $errmsg,
    ], 200);
}

$body = json_decode((string) $raw, true);
if (!is_array($body)) {
    integaglpi_health_proxy_response(['ok' => false, 'reachable' => true, 'message' => 'invalid_json'], 200);
}

$safe = [
    'ok' => (bool) ($body['ok'] ?? false),
    'service' => (string) ($body['service'] ?? 'integration-service'),
    'uptime_seconds' => (int) ($body['uptime_seconds'] ?? 0),
    'meta_configured' => (bool) ($body['meta_configured'] ?? false),
    'glpi_configured' => (bool) ($body['glpi_configured'] ?? false),
    'http_status' => $http,
];

if (isset($body['version']) && is_string($body['version'])) {
    $safe['version'] = $body['version'];
}

$pg = $body['postgres'] ?? null;
if (is_array($pg)) {
    $safe['postgres'] = [
        'ok' => (bool) ($pg['ok'] ?? false),
    ];
    if (isset($pg['latency_ms']) && is_numeric($pg['latency_ms'])) {
        $safe['postgres']['latency_ms'] = (int) $pg['latency_ms'];
    }
}

// HTTP 200 para o painel: o cliente usa apenas o campo "ok" do JSON (evita lógica extra com status 503 no fetch).
$safe['reachable'] = true;
$safe['upstream_http'] = $http;
integaglpi_health_proxy_response($safe, 200);
