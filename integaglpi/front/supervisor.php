<?php

declare(strict_types=1);

use GlpiPlugin\Integaglpi\Plugin;
use GlpiPlugin\Integaglpi\Renderer\SupervisorBackofficeRenderer;
use GlpiPlugin\Integaglpi\Service\PluginConfigService;
use GlpiPlugin\Integaglpi\Service\SupervisorBackofficeService;
use GlpiPlugin\Integaglpi\SupervisorBackofficeMenu;

include '../../../inc/includes.php';

Session::checkLoginUser();
Session::checkRight(Plugin::RIGHT_NAME, READ);
Plugin::requireSupervisorRead();

Html::header(__('Backoffice Supervisor', 'glpiintegaglpi'), $_SERVER['PHP_SELF'], 'plugins', SupervisorBackofficeMenu::class);

$renderer = new SupervisorBackofficeRenderer(
    new SupervisorBackofficeService(new PluginConfigService())
);
$renderer->render($_GET);

Html::footer();
