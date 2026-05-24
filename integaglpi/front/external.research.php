<?php

declare(strict_types=1);

include '../../../inc/includes.php';

use GlpiPlugin\Integaglpi\Plugin;
use GlpiPlugin\Integaglpi\QualityDashboardMenu;
use GlpiPlugin\Integaglpi\Renderer\ExternalResearchRenderer;
use GlpiPlugin\Integaglpi\Service\ExternalResearchService;
use GlpiPlugin\Integaglpi\Service\PluginConfigService;

Session::checkLoginUser();
Plugin::requireExternalResearchRead();

$service = new ExternalResearchService(new PluginConfigService());
$flash = null;

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (!Plugin::isCsrfValid($_POST)) {
        $flash = [
            'type' => 'danger',
            'message' => __('Token CSRF inválido. Recarregue a página e tente novamente.', 'glpiintegaglpi'),
        ];
    } else {
        $flash = $service->handlePost($_POST, Plugin::getCurrentUserId());
    }
}

Html::header(
    __('Pesquisa externa controlada', 'glpiintegaglpi'),
    $_SERVER['PHP_SELF'],
    'plugins',
    QualityDashboardMenu::class
);

$renderer = new ExternalResearchRenderer();
$renderer->render($service->getPageData($_GET, $flash));

Html::footer();
