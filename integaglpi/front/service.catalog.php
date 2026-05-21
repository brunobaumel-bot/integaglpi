<?php

declare(strict_types=1);

use GlpiPlugin\Integaglpi\Plugin;
use GlpiPlugin\Integaglpi\Renderer\ServiceCatalogRenderer;
use GlpiPlugin\Integaglpi\Service\PluginConfigService;
use GlpiPlugin\Integaglpi\Service\ServiceCatalogService;
use GlpiPlugin\Integaglpi\ServiceCatalogMenu;

include '../../../inc/includes.php';

Session::checkLoginUser();
Plugin::requireServiceCatalogRead();

$service = new ServiceCatalogService(new PluginConfigService());
$flash = null;

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    Plugin::requireServiceCatalogUpdate();
    if (!Plugin::isCsrfValid($_POST)) {
        $flash = [
            'type' => 'danger',
            'message' => __('Token CSRF inválido. Recarregue a página e tente novamente.', 'glpiintegaglpi'),
        ];
    } else {
        $flash = $service->handlePost($_POST, Plugin::getCurrentUserId());
    }
}

Html::header(__('Catálogo de Serviços', 'glpiintegaglpi'), $_SERVER['PHP_SELF'], 'plugins', ServiceCatalogMenu::class);

$renderer = new ServiceCatalogRenderer($service);
$renderer->render($_GET, $flash);

Html::footer();
