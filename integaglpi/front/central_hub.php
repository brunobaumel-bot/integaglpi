<?php

declare(strict_types=1);

use GlpiPlugin\Integaglpi\CentralHubMenu;
use GlpiPlugin\Integaglpi\Plugin;
use GlpiPlugin\Integaglpi\Service\CentralHubViewService;
use GlpiPlugin\Integaglpi\Service\PluginConfigService;
use GlpiPlugin\Integaglpi\SupervisaoGroupMenu;

include '../../../inc/includes.php';

Session::checkLoginUser();
Session::checkRight(Plugin::RIGHT_NAME, READ);
Plugin::requireSupervisorRead();

Html::header(
    __('Hub Operacional', 'glpiintegaglpi'),
    $_SERVER['PHP_SELF'],
    'plugins',
    SupervisaoGroupMenu::class,
    CentralHubMenu::class,
);

$service = new CentralHubViewService(new PluginConfigService());
$data    = $service->getHubSnapshot();

require PLUGIN_INTEGAGLPI_ROOT . '/templates/central_hub_dashboard.php';

Html::footer();
