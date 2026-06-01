<?php

declare(strict_types=1);

use GlpiPlugin\Integaglpi\MonitoramentoGroupMenu;
use GlpiPlugin\Integaglpi\Plugin;
use GlpiPlugin\Integaglpi\Service\TechnicalHealthDashboardService;

include '../../../inc/includes.php';

Session::checkLoginUser();

if (!Plugin::canOperationalDiagnosticsRead()
    && !Plugin::canObservabilityRead()
    && !Plugin::canAuditRead()
) {
    Html::displayRightError();
}

$service  = new TechnicalHealthDashboardService();
$snapshot = $service->getSnapshot();

Html::header(
    __('Saúde Técnica IntegraGLPI', 'glpiintegaglpi'),
    $_SERVER['PHP_SELF'],
    'plugins',
    MonitoramentoGroupMenu::class,
);

include __DIR__ . '/../templates/technical_health.php';

Html::footer();
