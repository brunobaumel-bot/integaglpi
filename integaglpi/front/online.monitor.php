<?php

declare(strict_types=1);

use GlpiPlugin\Integaglpi\OnlineMonitorMenu;
use GlpiPlugin\Integaglpi\Plugin;
use GlpiPlugin\Integaglpi\Renderer\OnlineMonitorRenderer;
use GlpiPlugin\Integaglpi\Service\AiOnlineAlertService;
use GlpiPlugin\Integaglpi\Service\OnlineMonitorService;
use GlpiPlugin\Integaglpi\Service\PluginConfigService;

include '../../../inc/includes.php';

Session::checkLoginUser();
Plugin::requireOnlineMonitorRead();

$pluginConfigService = new PluginConfigService();
$alertService = new AiOnlineAlertService($pluginConfigService);

if ($_SERVER['REQUEST_METHOD'] === 'POST' && (string) ($_POST['ai_alert_action'] ?? '') === 'feedback') {
    if (!Plugin::canOnlineMonitorSupervisorRead()) {
        Session::addMessageAfterRedirect(__('Somente supervisores podem revisar alertas de IA.', 'glpiintegaglpi'), false, ERROR);
        Html::redirect(Plugin::getOnlineMonitorUrl());
    }
    if (!Plugin::isCsrfValid($_POST)) {
        Session::addMessageAfterRedirect(__('Sessão expirada. Recarregue a página e tente novamente.', 'glpiintegaglpi'), false, ERROR);
        Html::redirect(Plugin::getOnlineMonitorUrl() . '?tab=ai_alerts');
    }

    $result = $alertService->handleFeedback($_POST, Plugin::getCurrentUserId());
    Session::addMessageAfterRedirect((string) ($result['message'] ?? ''), false, (bool) ($result['ok'] ?? false) ? INFO : ERROR);
    Html::redirect(Plugin::getOnlineMonitorUrl() . '?tab=ai_alerts');
}

Html::header(__('Monitor Online WhatsApp', 'glpiintegaglpi'), $_SERVER['PHP_SELF'], 'plugins', OnlineMonitorMenu::class);

$renderer = new OnlineMonitorRenderer(new OnlineMonitorService($pluginConfigService), $alertService);
$renderer->render($_GET, Plugin::getCurrentUserId(), Plugin::canOnlineMonitorSupervisorRead());

Html::footer();
