<?php

declare(strict_types=1);

use GlpiPlugin\Integaglpi\Queue;
use GlpiPlugin\Integaglpi\Renderer\CentralModelBRenderer;
use GlpiPlugin\Integaglpi\Service\AttendanceCenterService;
use GlpiPlugin\Integaglpi\Service\PluginConfigService;

include '../../../inc/includes.php';

Session::checkLoginUser();
Session::checkRight(\GlpiPlugin\Integaglpi\Plugin::RIGHT_NAME, READ);

Html::header(
    __('Central B — Inbox', 'glpiintegaglpi'),
    $_SERVER['PHP_SELF'],
    'plugins',
    Queue::class
);

$pluginConfigService = new PluginConfigService();
$service             = new AttendanceCenterService($pluginConfigService);
$renderer            = new CentralModelBRenderer($service);
$renderer->render($_GET);

Html::footer();
