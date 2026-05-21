<?php

declare(strict_types=1);

use GlpiPlugin\Integaglpi\Plugin;
use GlpiPlugin\Integaglpi\Service\ManualTicketWhatsappService;

include '../../../inc/includes.php';

Session::checkLoginUser();
Plugin::requireUpdate();

$ticketId = (int) ($_POST['ticket_id'] ?? 0);

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
        throw new RuntimeException(__('Ticket não encontrado.', 'glpiintegaglpi'));
    }
    $ticket->check($ticketId, UPDATE);

    $action = trim((string) ($_POST['manual_whatsapp_action'] ?? ''));
    if ($action !== 'start_template') {
        throw new RuntimeException(__('Ação WhatsApp manual inválida.', 'glpiintegaglpi'));
    }

    $result = (new ManualTicketWhatsappService())->startTemplate($ticket, $_POST, Plugin::getCurrentUserId());
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
