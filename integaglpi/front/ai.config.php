<?php

declare(strict_types=1);

include '../../../inc/includes.php';

use GlpiPlugin\Integaglpi\AiOperationsMenu;
use GlpiPlugin\Integaglpi\Plugin;
use GlpiPlugin\Integaglpi\Renderer\AiOperationsRenderer;
use GlpiPlugin\Integaglpi\Service\AiConfigViewService;
use GlpiPlugin\Integaglpi\Service\PluginConfigService;

Session::checkLoginUser();
Plugin::requireAiOperationsRead();

$service = new AiConfigViewService(new PluginConfigService());
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

Html::header(__('Configuração IA', 'glpiintegaglpi'), $_SERVER['PHP_SELF'], 'plugins', AiOperationsMenu::class);

$renderer = new AiOperationsRenderer();
$renderer->renderAiConfig($service->getPageData($flash, Plugin::getCurrentUserId()));

Html::footer();
