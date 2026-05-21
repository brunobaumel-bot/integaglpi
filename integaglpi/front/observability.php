<?php

declare(strict_types=1);

use GlpiPlugin\Integaglpi\ObservabilityMenu;
use GlpiPlugin\Integaglpi\Plugin;
use GlpiPlugin\Integaglpi\Renderer\ObservabilityRenderer;
use GlpiPlugin\Integaglpi\Service\ObservabilityService;
use GlpiPlugin\Integaglpi\Service\PluginConfigService;

include '../../../inc/includes.php';

Session::checkLoginUser();
Session::checkRight(Plugin::RIGHT_NAME, READ);
Plugin::requireObservabilityRead();

Html::header(
    __('Observabilidade WhatsApp', 'glpiintegaglpi'),
    $_SERVER['PHP_SELF'],
    'plugins',
    ObservabilityMenu::class
);

$renderer = new ObservabilityRenderer(
    new ObservabilityService(new PluginConfigService())
);
$renderer->render($_GET);

Html::footer();
