<?php

declare(strict_types=1);

use GlpiPlugin\Integaglpi\Plugin;
use GlpiPlugin\Integaglpi\Service\PluginConfigService;
use GlpiPlugin\Integaglpi\Service\RiskScoreService;

include '../../../inc/includes.php';

Session::checkLoginUser();

$ticketId = (int) ($_POST['ticket_id'] ?? 0);
$conversationId = trim((string) ($_POST['conversation_id'] ?? ''));

try {
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
        throw new RuntimeException(__('Método inválido para feedback de risco.', 'glpiintegaglpi'));
    }

    if (!Plugin::canUpdate()) {
        throw new RuntimeException(__('Sem permissão para registrar feedback de risco.', 'glpiintegaglpi'));
    }

    if (!Plugin::isCsrfValid($_POST)) {
        throw new RuntimeException(__('Token CSRF inválido. Recarregue a página e tente novamente.', 'glpiintegaglpi'));
    }

    $service = new RiskScoreService(new PluginConfigService());
    $flash = $service->recordFeedback($_POST, Plugin::getCurrentUserId());
    Session::addMessageAfterRedirect($flash['message'], false, $flash['type'] === 'success' ? INFO : ERROR);
} catch (Throwable $exception) {
    error_log('[integaglpi][risk_score][feedback] ticket_id=' . $ticketId . ' conversation_id=' . substr($conversationId, 0, 12) . ' message=' . $exception->getMessage());
    Session::addMessageAfterRedirect($exception->getMessage(), false, ERROR);
}

Html::redirect(Plugin::getTicketUrl($ticketId) . '&forcetab=PluginIntegaglpiTicketRuntime$2');
