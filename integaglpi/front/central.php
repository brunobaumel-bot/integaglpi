<?php

declare(strict_types=1);

use GlpiPlugin\Integaglpi\Plugin;
use GlpiPlugin\Integaglpi\Queue;
use GlpiPlugin\Integaglpi\Renderer\CentralRenderer;
use GlpiPlugin\Integaglpi\Service\AttendanceCenterService;
use GlpiPlugin\Integaglpi\Service\PluginConfigService;

include '../../../inc/includes.php';

Session::checkLoginUser();
Plugin::requireRead();
Session::checkRight(Plugin::RIGHT_NAME, READ);

Html::header(__('Central de Atendimento', 'glpiintegaglpi'), $_SERVER['PHP_SELF'], 'plugins', Queue::class);

$pluginConfigService = new PluginConfigService();
$service = new AttendanceCenterService($pluginConfigService);
$renderer = new CentralRenderer($service);
$renderer->render($_GET);

Html::footer();
