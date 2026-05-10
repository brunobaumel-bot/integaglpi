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
function plugin_integaglpi_central_messages_json(array $payload, int $statusCode = 200): never
{
    http_response_code($statusCode);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

try {
    Session::checkLoginUser();

    if (!Session::haveRight(Plugin::RIGHT_NAME, READ)) {
        plugin_integaglpi_central_messages_json([
            'ok' => false,
            'messages' => [],
            'refreshed_at' => gmdate('c'),
            'error' => 'forbidden',
            'message' => __('You do not have permission to view WhatsApp messages.', 'glpiintegaglpi'),
        ], 403);
    }

    if (strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET')) !== 'GET') {
        plugin_integaglpi_central_messages_json([
            'ok' => false,
            'messages' => [],
            'refreshed_at' => gmdate('c'),
            'error' => 'method_not_allowed',
            'message' => __('Only GET requests are allowed.', 'glpiintegaglpi'),
        ], 405);
    }

    $conversationId = trim((string) ($_GET['conversation_id'] ?? ''));
    $ticketId = (int) ($_GET['ticket_id'] ?? 0);
    $afterCreatedAt = isset($_GET['after_created_at']) ? trim((string) $_GET['after_created_at']) : null;
    $afterId = isset($_GET['after_id']) ? trim((string) $_GET['after_id']) : null;
    $limit = (int) ($_GET['limit'] ?? 50);

    $service = new AttendanceCenterService(new PluginConfigService());
    $result = $service->getConversationMessages(
        $conversationId,
        $ticketId,
        $afterCreatedAt !== '' ? $afterCreatedAt : null,
        $afterId !== '' ? $afterId : null,
        $limit
    );
    $statusCode = (int) ($result['http_status'] ?? 200);
    unset($result['http_status']);

    plugin_integaglpi_central_messages_json($result, $statusCode);
} catch (Throwable $exception) {
    error_log('[integaglpi][central][messages][error] ' . $exception->getMessage());

    plugin_integaglpi_central_messages_json([
        'ok' => false,
        'messages' => [],
        'refreshed_at' => gmdate('c'),
        'error' => 'internal_error',
        'message' => __('Unable to load WhatsApp messages right now.', 'glpiintegaglpi'),
    ], 500);
}
