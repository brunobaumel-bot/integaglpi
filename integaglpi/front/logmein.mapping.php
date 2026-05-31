<?php

declare(strict_types=1);

use GlpiPlugin\Integaglpi\GestaoGroupMenu;
use GlpiPlugin\Integaglpi\Plugin;
use GlpiPlugin\Integaglpi\Service\LogmeinGovernanceService;
use GlpiPlugin\Integaglpi\Service\SecurityPermissionService;

include '../../../inc/includes.php';

Session::checkLoginUser();

if (!SecurityPermissionService::hasRight(SecurityPermissionService::RIGHT_MANAGE_LOGMEIN_MAPPING)) {
    Html::displayRightError();
}

$service = new LogmeinGovernanceService();
$flash = null;

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (!Plugin::isCsrfValid($_POST)) {
        $flash = [
            'type' => 'danger',
            'message' => __('Token CSRF inválido. Recarregue a página e tente novamente.', 'glpiintegaglpi'),
        ];
    } else {
        $action = trim((string) ($_POST['action'] ?? ''));
        if ($action === 'save_mapping') {
            $flash = $service->saveMapping($_POST, Plugin::getCurrentUserId());
        } elseif ($action === 'disable_mapping') {
            $flash = $service->disableMapping((int) ($_POST['mapping_id'] ?? 0), Plugin::getCurrentUserId());
        } else {
            $flash = [
                'type' => 'danger',
                'message' => __('Ação inválida para mapeamento LogMeIn.', 'glpiintegaglpi'),
            ];
        }
    }
}

$mappings = $service->listMappings();
$featureEnabled = $service->isFeatureEnabled();

Html::header(__('Mapeamento LogMeIn read-only', 'glpiintegaglpi'), $_SERVER['PHP_SELF'], 'plugins', GestaoGroupMenu::class);

include __DIR__ . '/../templates/logmein_mapping.php';

Html::footer();
