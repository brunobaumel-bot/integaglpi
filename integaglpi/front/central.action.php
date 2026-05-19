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
function plugin_integaglpi_central_json(array $payload, int $statusCode = 200): never
{
    if (!isset($payload['csrf_token'])) {
        $payload['csrf_token'] = Plugin::getCsrfToken();
    }

    http_response_code($statusCode);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

try {
    Session::checkLoginUser();
    if (!Session::haveRight(Plugin::RIGHT_NAME, UPDATE)) {
        plugin_integaglpi_central_json([
            'ok' => false,
            'error' => 'forbidden',
            'message' => __('You do not have permission to operate conversations.', 'glpiintegaglpi'),
        ], 403);
    }

    if (strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET')) !== 'POST') {
        plugin_integaglpi_central_json([
            'ok' => false,
            'error' => 'method_not_allowed',
            'message' => __('Only POST requests are allowed.', 'glpiintegaglpi'),
        ], 405);
    }

    if (!Plugin::isCsrfValid($_POST)) {
        plugin_integaglpi_central_json([
            'ok' => false,
            'error' => 'csrf_invalid',
            'message' => __('Invalid security token. Please refresh the page and try again.', 'glpiintegaglpi'),
        ], 403);
    }

    $action = trim((string) ($_POST['action'] ?? ''));
    if (!in_array($action, ['claim', 'reply', 'transfer', 'solve', 'confirm_entity', 'update_entity', 'entity_status', 'soft_close'], true)) {
        plugin_integaglpi_central_json([
            'ok' => false,
            'error' => 'invalid_action',
            'message' => __('Invalid action.', 'glpiintegaglpi'),
        ], 400);
    }

    $conversationId = trim((string) ($_POST['conversation_id'] ?? ''));
    $ticketId = (int) ($_POST['ticket_id'] ?? 0);
    $userId = Plugin::getCurrentUserId();

    $service = new AttendanceCenterService(new PluginConfigService());
    if ($action === 'claim') {
        $result = $service->claimConversation($conversationId, $ticketId, $userId);
    } elseif ($action === 'reply') {
        $messageText = (string) ($_POST['message'] ?? $_POST['reply_text'] ?? '');
        $idempotencyKey = isset($_POST['idempotency_key']) ? (string) $_POST['idempotency_key'] : null;
        $result = $service->replyConversation(
            $conversationId,
            $ticketId,
            $userId,
            $messageText,
            $idempotencyKey
        );
    } elseif ($action === 'transfer') {
        $result = $service->transferConversation(
            $conversationId,
            $ticketId,
            $userId,
            (int) ($_POST['new_technician_id'] ?? 0)
        );
    } elseif ($action === 'confirm_entity') {
        $rawEntityId = $_POST['glpi_entity_id'] ?? $_POST['entity_id'] ?? null;
        $glpiEntityId = 0;
        if (is_string($rawEntityId) || is_int($rawEntityId)) {
            $trimmed = trim((string) $rawEntityId);
            if ($trimmed !== '' && ctype_digit($trimmed)) {
                $parsed = (int) $trimmed;
                if ($parsed > 0) {
                    $glpiEntityId = $parsed;
                }
            }
        }

        $result = $service->confirmConversationEntity(
            $conversationId,
            $glpiEntityId,
            isset($_POST['glpi_entity_name']) ? (string) $_POST['glpi_entity_name'] : null,
            $userId,
            (string) ($_POST['create_ticket'] ?? '1') !== '0',
            $ticketId,
            isset($_POST['idempotency_key']) ? (string) $_POST['idempotency_key'] : null
        );
    } elseif ($action === 'update_entity') {
        $rawEntityId = $_POST['glpi_entity_id'] ?? $_POST['entity_id'] ?? null;
        $glpiEntityId = 0;
        if (is_string($rawEntityId) || is_int($rawEntityId)) {
            $trimmed = trim((string) $rawEntityId);
            if ($trimmed !== '' && ctype_digit($trimmed)) {
                $parsed = (int) $trimmed;
                if ($parsed > 0) {
                    $glpiEntityId = $parsed;
                }
            }
        }

        $result = $service->updateConversationEntity(
            $conversationId,
            $glpiEntityId,
            isset($_POST['glpi_entity_name']) ? (string) $_POST['glpi_entity_name'] : null,
            $userId,
            (string) ($_POST['apply_to_ticket'] ?? '0') === '1'
        );
    } elseif ($action === 'entity_status') {
        $result = $service->getConversationEntityStatus($conversationId);
    } elseif ($action === 'soft_close') {
        $result = $service->softCloseConversation(
            $conversationId,
            $userId,
            (string) ($_POST['reason'] ?? '')
        );
    } else {
        $result = $service->solveConversation($conversationId, $ticketId, $userId);
    }

    $statusCode = (int) ($result['http_status'] ?? 200);
    unset($result['http_status']);

    plugin_integaglpi_central_json($result, $statusCode);
} catch (Throwable $exception) {
    error_log('[integaglpi][central][action][error] ' . $exception->getMessage());

    plugin_integaglpi_central_json([
        'ok' => false,
        'error' => 'internal_error',
        'message' => __('Unable to process the Attendance Center action.', 'glpiintegaglpi'),
    ], 500);
}
