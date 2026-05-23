<?php

declare(strict_types=1);

use GlpiPlugin\Integaglpi\Plugin;
use GlpiPlugin\Integaglpi\Renderer\KbCandidateRenderer;
use GlpiPlugin\Integaglpi\Service\KbCandidateService;
use GlpiPlugin\Integaglpi\Service\PluginConfigService;

include '../../../inc/includes.php';

Session::checkLoginUser();
Plugin::requireSupervisorRead();

$service = new KbCandidateService(new PluginConfigService());
$flash = null;

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    Plugin::requireUpdate();
    if (!Plugin::isCsrfValid($_POST)) {
        $flash = [
            'type' => 'danger',
            'message' => __('Token CSRF inválido. Recarregue a página e tente novamente.', 'glpiintegaglpi'),
        ];
    } else {
        $flash = $service->handlePost($_POST, Plugin::getCurrentUserId());
    }
}

Html::header(__('Candidatos de KB por IA', 'glpiintegaglpi'), $_SERVER['PHP_SELF'], 'plugins');

$renderer = new KbCandidateRenderer($service);
$renderer->render($_GET, $flash);

Html::footer();
