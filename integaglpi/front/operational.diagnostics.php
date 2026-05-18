<?php

declare(strict_types=1);

use GlpiPlugin\Integaglpi\OperationalDiagnosticsMenu;
use GlpiPlugin\Integaglpi\Plugin;
use GlpiPlugin\Integaglpi\Renderer\OperationalDiagnosticsRenderer;
use GlpiPlugin\Integaglpi\Service\OperationalDiagnosticsService;

include '../../../inc/includes.php';

Session::checkLoginUser();
Session::checkRight(Plugin::RIGHT_NAME, READ);
Plugin::requireOperationalDiagnosticsRead();

Html::header(
    __('Diagnóstico Operacional', 'glpiintegaglpi'),
    $_SERVER['PHP_SELF'],
    'plugins',
    OperationalDiagnosticsMenu::class
);

(new OperationalDiagnosticsRenderer(new OperationalDiagnosticsService()))->render();

Html::footer();
