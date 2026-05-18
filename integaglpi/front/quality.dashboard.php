<?php

declare(strict_types=1);

use GlpiPlugin\Integaglpi\Plugin;
use GlpiPlugin\Integaglpi\QualityDashboardMenu;
use GlpiPlugin\Integaglpi\Renderer\QualityDashboardRenderer;
use GlpiPlugin\Integaglpi\Service\PluginConfigService;
use GlpiPlugin\Integaglpi\Service\QualityDashboardService;

include '../../../inc/includes.php';

Session::checkLoginUser();
Session::checkRight(Plugin::RIGHT_NAME, READ);
Plugin::requireQualityDashboardRead();

Html::header(__('Dashboard de Qualidade', 'glpiintegaglpi'), $_SERVER['PHP_SELF'], 'plugins', QualityDashboardMenu::class);

$renderer = new QualityDashboardRenderer(
    new QualityDashboardService(new PluginConfigService())
);
$renderer->render($_GET);

Html::footer();
