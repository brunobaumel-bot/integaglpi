<?php

declare(strict_types=1);

use GlpiPlugin\Integaglpi\OnlineMonitorMenu;
use GlpiPlugin\Integaglpi\Plugin;
use GlpiPlugin\Integaglpi\Renderer\OnlineMonitorRenderer;
use GlpiPlugin\Integaglpi\Service\OnlineMonitorService;
use GlpiPlugin\Integaglpi\Service\PluginConfigService;

include '../../../inc/includes.php';

Session::checkLoginUser();
Plugin::requireOnlineMonitorRead();

Html::header(__('Monitor Online WhatsApp', 'glpiintegaglpi'), $_SERVER['PHP_SELF'], 'plugins', OnlineMonitorMenu::class);

$renderer = new OnlineMonitorRenderer(new OnlineMonitorService(new PluginConfigService()));
$renderer->render($_GET, Plugin::getCurrentUserId(), Plugin::canOnlineMonitorSupervisorRead());

Html::footer();
