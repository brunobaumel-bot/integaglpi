<?php

declare(strict_types=1);

include '../../../inc/includes.php';

use GlpiPlugin\Integaglpi\Plugin;
use GlpiPlugin\Integaglpi\Renderer\CoachingRenderer;
use GlpiPlugin\Integaglpi\Service\CoachingService;
use GlpiPlugin\Integaglpi\Service\PluginConfigService;
use GlpiPlugin\Integaglpi\QualityDashboardMenu;

Session::checkLoginUser();
Session::checkRight(Plugin::RIGHT_NAME, READ);
Plugin::requireCoachingRead();

$service = new CoachingService(new PluginConfigService());

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (!Plugin::isCsrfValid($_POST)) {
        Session::addMessageAfterRedirect(__('CSRF inválido. Atualize a página e tente novamente.', 'glpiintegaglpi'), false, ERROR);
        Html::redirect(Plugin::getCoachingUrl());
    }

    $result = $service->handlePost($_POST, Plugin::getCurrentUserId());
    $type = $result['type'] === 'success' ? INFO : ERROR;
    Session::addMessageAfterRedirect($result['message'], false, $type);
    Html::redirect(Plugin::getCoachingUrl());
}

Html::header(
    __('Coaching e Onboarding IA', 'glpiintegaglpi'),
    $_SERVER['PHP_SELF'],
    'plugins',
    QualityDashboardMenu::class
);

$renderer = new CoachingRenderer();
$renderer->render($service->getDashboardData($_GET));

Html::footer();
