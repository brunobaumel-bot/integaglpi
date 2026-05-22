<?php

declare(strict_types=1);

use GlpiPlugin\Integaglpi\Plugin;
use GlpiPlugin\Integaglpi\External\ExternalDatabase;
use GlpiPlugin\Integaglpi\Service\ManualTicketWhatsappService;
use GlpiPlugin\Integaglpi\Service\PluginConfigService;

include '../../../inc/includes.php';

Session::checkLoginUser();
Plugin::requireUpdate();

$ticketId = (int) ($_POST['ticket_id'] ?? 0);

function plugin_integaglpi_mask_phone_for_orphan_audit(string $phone): string
{
    $digits = preg_replace('/\D+/', '', $phone) ?? '';
    if ($digits === '') {
        return '';
    }

    return str_repeat('*', max(4, strlen($digits) - 4)) . substr($digits, -4);
}

function plugin_integaglpi_audit_blocked_deleted_ticket_outbound(int $ticketId, int $userId, string $reason): void
{
    if ($ticketId <= 0) {
        return;
    }

    try {
        $configService = new PluginConfigService();
        if (!$configService->isConfigured()) {
            return;
        }

        $pdo = ExternalDatabase::getConnection($configService->getConnectionConfig());
        $conversationId = null;
        $phoneMasked = '';
        $lookup = $pdo->prepare(
            "SELECT id, phone_e164
             FROM glpi_plugin_integaglpi_conversations
             WHERE glpi_ticket_id = :ticket_id
             ORDER BY updated_at DESC
             LIMIT 1"
        );
        $lookup->execute([':ticket_id' => $ticketId]);
        $conversation = $lookup->fetch();
        if (is_array($conversation)) {
            $conversationId = trim((string) ($conversation['id'] ?? '')) ?: null;
            $phoneMasked = plugin_integaglpi_mask_phone_for_orphan_audit((string) ($conversation['phone_e164'] ?? ''));
        }

        $payload = json_encode([
            'glpi_ticket_id' => $ticketId,
            'conversation_id' => $conversationId,
            'phone_masked' => $phoneMasked,
            'glpi_user_id' => $userId,
            'reason' => $reason,
        ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        if ($payload === false) {
            $payload = '{"reason":"glpi_ticket_missing"}';
        }

        $audit = $pdo->prepare(
            "INSERT INTO glpi_plugin_integaglpi_audit_events (
                correlation_id,
                ticket_id,
                conversation_id,
                event_type,
                status,
                severity,
                source,
                payload_json,
                created_at
            ) VALUES (
                :correlation_id,
                :ticket_id,
                :conversation_id,
                'OUTBOUND_BLOCKED_DELETED_TICKET',
                'ignored',
                'warning',
                'PluginManualTicketWhatsapp',
                :payload_json::jsonb,
                NOW()
            )"
        );
        $audit->execute([
            ':correlation_id' => 'outbound_blocked_deleted_ticket:' . $ticketId,
            ':ticket_id' => $ticketId,
            ':conversation_id' => $conversationId,
            ':payload_json' => $payload,
        ]);
    } catch (Throwable $exception) {
        error_log('[integaglpi][manual_ticket_whatsapp][blocked_deleted_ticket_audit] ticket_id=' . $ticketId . ' ' . $exception->getMessage());
    }
}

function plugin_integaglpi_audit_manual_template_timeout_pending(int $ticketId, int $userId, string $idempotencyKey): void
{
    if ($ticketId <= 0) {
        return;
    }

    try {
        $configService = new PluginConfigService();
        if (!$configService->isConfigured()) {
            return;
        }

        $pdo = ExternalDatabase::getConnection($configService->getConnectionConfig());
        $conversationId = null;
        $lookup = $pdo->prepare(
            "SELECT id
             FROM glpi_plugin_integaglpi_conversations
             WHERE glpi_ticket_id = :ticket_id
             ORDER BY updated_at DESC
             LIMIT 1"
        );
        $lookup->execute([':ticket_id' => $ticketId]);
        $conversation = $lookup->fetch();
        if (is_array($conversation)) {
            $conversationId = trim((string) ($conversation['id'] ?? '')) ?: null;
        }

        $payload = json_encode([
            'glpi_ticket_id' => $ticketId,
            'conversation_id' => $conversationId,
            'glpi_user_id' => $userId,
            'reason' => 'php_timeout_pending',
            'idempotency_key' => $idempotencyKey,
        ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        if ($payload === false) {
            $payload = '{"reason":"php_timeout_pending"}';
        }

        $audit = $pdo->prepare(
            "INSERT INTO glpi_plugin_integaglpi_audit_events (
                correlation_id,
                ticket_id,
                conversation_id,
                event_type,
                status,
                severity,
                source,
                payload_json,
                created_at
            ) VALUES (
                :correlation_id,
                :ticket_id,
                :conversation_id,
                'MANUAL_TICKET_WHATSAPP_TEMPLATE_TIMEOUT_PENDING',
                'pending',
                'warning',
                'PluginManualTicketWhatsapp',
                :payload_json::jsonb,
                NOW()
            )"
        );
        $audit->execute([
            ':correlation_id' => 'manual_ticket_template_timeout_pending:' . $ticketId,
            ':ticket_id' => $ticketId,
            ':conversation_id' => $conversationId,
            ':payload_json' => $payload,
        ]);
    } catch (Throwable $exception) {
        error_log('[integaglpi][manual_ticket_whatsapp][timeout_pending_audit] ticket_id=' . $ticketId . ' ' . $exception->getMessage());
    }
}

try {
    if (strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
        throw new RuntimeException(__('Método inválido.', 'glpiintegaglpi'));
    }
    if (!Plugin::isCsrfValid($_POST)) {
        throw new RuntimeException(__('Token de segurança inválido.', 'glpiintegaglpi'));
    }
    if ($ticketId <= 0) {
        throw new RuntimeException(__('Ticket inválido.', 'glpiintegaglpi'));
    }

    $ticket = new Ticket();
    if (!$ticket->getFromDB($ticketId)) {
        plugin_integaglpi_audit_blocked_deleted_ticket_outbound($ticketId, Plugin::getCurrentUserId(), 'glpi_ticket_missing');
        throw new RuntimeException(__('Ticket não encontrado.', 'glpiintegaglpi'));
    }
    if ((int) ($ticket->fields['is_deleted'] ?? 0) !== 0) {
        plugin_integaglpi_audit_blocked_deleted_ticket_outbound($ticketId, Plugin::getCurrentUserId(), 'glpi_ticket_deleted');
        throw new RuntimeException(__('O chamado GLPI vinculado foi excluído. Esta conversa foi encerrada logicamente e não permite novas mensagens.', 'glpiintegaglpi'));
    }
    $ticket->check($ticketId, UPDATE);

    $action = trim((string) ($_POST['manual_whatsapp_action'] ?? ''));
    if ($action !== 'start_template') {
        throw new RuntimeException(__('Ação WhatsApp manual inválida.', 'glpiintegaglpi'));
    }

    $result = (new ManualTicketWhatsappService())->startTemplate($ticket, $_POST, Plugin::getCurrentUserId());
    if ((string) ($result['status'] ?? '') === 'processing') {
        plugin_integaglpi_audit_manual_template_timeout_pending(
            $ticketId,
            Plugin::getCurrentUserId(),
            (string) ($result['idempotency_key'] ?? '')
        );
        Session::addMessageAfterRedirect(
            (string) ($result['message'] ?? __('Envio em processamento. Verifique a conversa em alguns segundos antes de tentar novamente.', 'glpiintegaglpi')),
            false,
            INFO
        );
        Html::redirect(Plugin::getTicketUrl($ticketId));
    }
    $conversationId = (string) ($result['conversation_id'] ?? '');
    Session::addMessageAfterRedirect(sprintf(
        __('Atendimento WhatsApp iniciado por template aprovado. Conversa: %s', 'glpiintegaglpi'),
        $conversationId !== '' ? $conversationId : '-'
    ));
} catch (Throwable $exception) {
    error_log('[integaglpi][manual_ticket_whatsapp][error] ticket_id=' . $ticketId . ' ' . $exception->getMessage());
    Session::addMessageAfterRedirect($exception->getMessage(), false, ERROR);
}

Html::redirect(Plugin::getTicketUrl($ticketId));
