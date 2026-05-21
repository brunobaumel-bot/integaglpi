<?php

declare(strict_types=1);

use GlpiPlugin\Integaglpi\Plugin;
use GlpiPlugin\Integaglpi\Service\AttachmentRetentionService;
use GlpiPlugin\Integaglpi\Service\PluginConfigService;

include '../../../inc/includes.php';

Session::checkLoginUser();
Session::checkRight(Plugin::RIGHT_NAME, UPDATE);

$ticketId = max(0, (int) ($_POST['ticket_id'] ?? 0));
$redirectUrl = $ticketId > 0
    ? Plugin::getTicketUrl($ticketId) . '&forcetab=PluginIntegaglpiTicketRuntime$1'
    : Plugin::getWebBasePath() . '/front/central.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    Html::redirect($redirectUrl);
}

if (!Plugin::isCsrfValid($_POST)) {
    Session::addMessageAfterRedirect(__('Token CSRF inválido. Recarregue a página e tente novamente.', 'glpiintegaglpi'), false, ERROR);
    Html::redirect($redirectUrl);
}

$messageId = trim((string) ($_POST['message_id'] ?? ''));
$action = trim((string) ($_POST['attachment_action'] ?? ''));

if ($messageId === '' || !in_array($action, ['soft_delete', 'restore'], true)) {
    Session::addMessageAfterRedirect(__('Ação de anexo inválida.', 'glpiintegaglpi'), false, ERROR);
    Html::redirect($redirectUrl);
}

try {
    $service = new AttachmentRetentionService(new PluginConfigService());
    if ($action === 'soft_delete') {
        $service->softDelete($messageId, Plugin::getCurrentUserId());
        Session::addMessageAfterRedirect(__('Anexo marcado como excluído logicamente. O arquivo físico não foi removido.', 'glpiintegaglpi'), false, INFO);
    } else {
        $service->restore($messageId, Plugin::getCurrentUserId());
        Session::addMessageAfterRedirect(__('Anexo restaurado logicamente.', 'glpiintegaglpi'), false, INFO);
    }
} catch (Throwable $exception) {
    error_log('[integaglpi][attachment-action][failed] ' . $exception->getMessage());
    Session::addMessageAfterRedirect(__('Não foi possível atualizar a retenção do anexo.', 'glpiintegaglpi'), false, ERROR);
}

Html::redirect($redirectUrl);
