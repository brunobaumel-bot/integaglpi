<?php

declare(strict_types=1);

use GlpiPlugin\Integaglpi\KnowledgeBaseMenu;
use GlpiPlugin\Integaglpi\Plugin;
use GlpiPlugin\Integaglpi\Renderer\KnowledgeBaseRenderer;
use GlpiPlugin\Integaglpi\Service\KnowledgeBaseService;
use GlpiPlugin\Integaglpi\Service\PluginConfigService;

include '../../../inc/includes.php';

Session::checkLoginUser();
Plugin::requireKnowledgeBaseRead();

$service = new KnowledgeBaseService(new PluginConfigService());
$flash = null;

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    Plugin::requireKnowledgeBaseUpdate();
    if (!Plugin::isCsrfValid($_POST)) {
        $flash = [
            'type' => 'danger',
            'message' => __('Token CSRF inválido. Recarregue a página e tente novamente.', 'glpiintegaglpi'),
        ];
    } else {
        $flash = $service->handlePost($_POST, Plugin::getCurrentUserId());
    }
}

Html::header(__('Base de Conhecimento', 'glpiintegaglpi'), $_SERVER['PHP_SELF'], 'plugins', KnowledgeBaseMenu::class);

$renderer = new KnowledgeBaseRenderer($service);
$renderer->render($_GET, $flash);

Html::footer();
