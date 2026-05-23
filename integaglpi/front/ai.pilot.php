<?php

declare(strict_types=1);

use GlpiPlugin\Integaglpi\Plugin;
use GlpiPlugin\Integaglpi\QualityDashboardMenu;
use GlpiPlugin\Integaglpi\Renderer\AiPilotRenderer;
use GlpiPlugin\Integaglpi\Service\AiPilotService;

include '../../../inc/includes.php';

Session::checkLoginUser();
Plugin::requireAiPilotRead();

$service = new AiPilotService();
$data = [
    'status' => $service->getStatus(),
    'test_result' => null,
    'message' => '',
];

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (!Plugin::isCsrfValid($_POST)) {
        Session::addMessageAfterRedirect(__('Token CSRF inválido.', 'glpiintegaglpi'), false, ERROR);
        Html::redirect(Plugin::getAiPilotUrl());
    }

    $action = trim((string) ($_POST['action'] ?? ''));
    if ($action === 'synthetic_test') {
        $data['test_result'] = $service->runSyntheticTest((string) ($_POST['payload'] ?? ''), Plugin::getCurrentUserId());
        $data['message'] = __('Teste sintético processado. Verifique bloqueios, custo e hashes abaixo.', 'glpiintegaglpi');
        $data['status'] = $service->getStatus();
    }
}

Html::header(__('Piloto IA Cloud / Embeddings', 'glpiintegaglpi'), $_SERVER['PHP_SELF'], 'plugins', QualityDashboardMenu::class);
(new AiPilotRenderer())->render($data);
Html::footer();
