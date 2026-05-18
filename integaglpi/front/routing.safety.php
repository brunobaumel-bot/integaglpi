<?php

declare(strict_types=1);

use GlpiPlugin\Integaglpi\Plugin;
use GlpiPlugin\Integaglpi\RoutingSafetyMenu;
use GlpiPlugin\Integaglpi\Service\RoutingSafetyService;

include '../../../inc/includes.php';

Session::checkLoginUser();
Plugin::requireAuditRead();

$service = new RoutingSafetyService();
$report = $service->buildReport();

Html::header(__('Filas e Roteamento', 'glpiintegaglpi'), $_SERVER['PHP_SELF'], 'plugins', RoutingSafetyMenu::class);
require PLUGIN_INTEGAGLPI_ROOT . '/templates/routing_safety.php';
Html::footer();
