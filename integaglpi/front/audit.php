<?php

declare(strict_types=1);

use GlpiPlugin\Integaglpi\OperationLogMenu;
use GlpiPlugin\Integaglpi\Plugin;
use GlpiPlugin\Integaglpi\Renderer\OperationalAuditRenderer;
use GlpiPlugin\Integaglpi\Service\OperationalAuditService;
use GlpiPlugin\Integaglpi\Service\PluginConfigService;

include '../../../inc/includes.php';

Session::checkLoginUser();
Plugin::requireAuditRead();

Html::header(__('Auditoria Operacional', 'glpiintegaglpi'), $_SERVER['PHP_SELF'], 'plugins', OperationLogMenu::class);

$service = new OperationalAuditService(new PluginConfigService());
$renderer = new OperationalAuditRenderer($service);
$renderer->render($_GET);

Html::footer();
