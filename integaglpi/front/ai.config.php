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

Html::header(__('Configuração IA', 'glpiintegaglpi'), $_SERVER['PHP_SELF'], 'plugins', AiOperationsMenu::class);

$renderer = new AiOperationsRenderer();
$renderer->renderAiConfig((new AiConfigViewService(new PluginConfigService()))->getPageData());

Html::footer();
