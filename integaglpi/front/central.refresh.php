<?php

declare(strict_types=1);

use GlpiPlugin\Integaglpi\Plugin;
use GlpiPlugin\Integaglpi\Service\AttendanceCenterService;
use GlpiPlugin\Integaglpi\Service\PluginConfigService;

include '../../../inc/includes.php';

header('Content-Type: application/json; charset=UTF-8');

/**
 * @param array<string, mixed> $payload
 */
function plugin_integaglpi_central_refresh_json(array $payload, int $statusCode = 200): never
{
    http_response_code($statusCode);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

try {
    Session::checkLoginUser();

    if (!Session::haveRight(Plugin::RIGHT_NAME, READ)) {
        plugin_integaglpi_central_refresh_json([
            'ok' => false,
            'rows' => [],
            'pagination' => [],
            'refreshed_at' => gmdate('c'),
            'error' => 'forbidden',
            'message' => __('You do not have permission to view the Attendance Center.', 'glpiintegaglpi'),
        ], 403);
    }

    if (strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET')) !== 'GET') {
        plugin_integaglpi_central_refresh_json([
            'ok' => false,
            'rows' => [],
            'pagination' => [],
            'refreshed_at' => gmdate('c'),
            'error' => 'method_not_allowed',
            'message' => __('Only GET requests are allowed.', 'glpiintegaglpi'),
        ], 405);
    }

    $service = new AttendanceCenterService(new PluginConfigService());
    $data = $service->getCentralRefreshData($_GET, Plugin::getCurrentUserId());
    $statusCode = !empty($data['ok']) ? 200 : 503;

    plugin_integaglpi_central_refresh_json([
        'ok' => (bool) ($data['ok'] ?? false),
        'rows' => is_array($data['rows'] ?? null) ? $data['rows'] : [],
        'pagination' => is_array($data['pagination'] ?? null) ? $data['pagination'] : [],
        'refreshed_at' => (string) ($data['refreshed_at'] ?? gmdate('c')),
        'message' => (string) ($data['error'] ?? ''),
    ], $statusCode);
} catch (Throwable $exception) {
    error_log('[integaglpi][central][refresh][error] ' . $exception->getMessage());

    plugin_integaglpi_central_refresh_json([
        'ok' => false,
        'rows' => [],
        'pagination' => [],
        'refreshed_at' => gmdate('c'),
        'error' => 'internal_error',
        'message' => __('Unable to refresh the Attendance Center right now.', 'glpiintegaglpi'),
    ], 500);
}
