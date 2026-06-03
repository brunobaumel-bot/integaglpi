<?php

declare(strict_types=1);

use GlpiPlugin\Integaglpi\Plugin;
use GlpiPlugin\Integaglpi\Service\PluginConfigService;
use GlpiPlugin\Integaglpi\Service\SupervisorCommandCenterService;
use GlpiPlugin\Integaglpi\SupervisaoGroupMenu;

include '../../../inc/includes.php';

Session::checkLoginUser();
Session::checkRight(Plugin::RIGHT_NAME, READ);
Plugin::requireSupervisorRead();

Html::header(
    __('Central do Supervisor', 'glpiintegaglpi'),
    $_SERVER['PHP_SELF'],
    'plugins',
    SupervisaoGroupMenu::class
);

$service = new SupervisorCommandCenterService(new PluginConfigService());
$data = $service->getDashboardData($_GET);

require PLUGIN_INTEGAGLPI_ROOT . '/templates/supervisor_command_center.php';

Html::footer();
