<?php

declare(strict_types=1);

use GlpiPlugin\Integaglpi\Plugin;
use GlpiPlugin\Integaglpi\Service\LogmeinFieldMappingService;
use GlpiPlugin\Integaglpi\Service\SecurityPermissionService;

include '../../../inc/includes.php';

Session::checkLoginUser();

if (!Plugin::canRead()) {
    Html::displayRightError();
}

$service = new LogmeinFieldMappingService();
$flash   = null;

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (!Plugin::isCsrfValid($_POST)) {
        $flash = [
            'type'    => 'danger',
            'message' => __('Token CSRF inválido. Recarregue a página e tente novamente.', 'glpiintegaglpi'),
        ];
    } else {
        $action = trim((string) ($_POST['action'] ?? ''));
        $userId = Plugin::getCurrentUserId();

        if ($action === 'toggle_active') {
            $id     = (int) ($_POST['mapping_id'] ?? 0);
            $active = (bool) ($_POST['is_active'] ?? false);
            $flash  = $service->setActive($id, $active, $userId);
        } elseif ($action === 'set_policy') {
            $id     = (int) ($_POST['mapping_id'] ?? 0);
            $policy = trim((string) ($_POST['overwrite_policy'] ?? ''));
            $flash  = $service->setPolicy($id, $policy, $userId);
        } elseif ($action === 'dry_run') {
            $currentValues = [];
            if (isset($_POST['current_glpi_values']) && is_array($_POST['current_glpi_values'])) {
                foreach ($_POST['current_glpi_values'] as $k => $v) {
                    $currentValues[(string) $k] = ($v !== '' && $v !== null) ? (string) $v : null;
                }
            }
            $syncLocalIp = (bool) ($_POST['sync_local_ip'] ?? false);
            $dryRunResult = $service->dryRun($currentValues, [], $syncLocalIp);
        } else {
            $flash = [
                'type'    => 'danger',
                'message' => __('Ação inválida.', 'glpiintegaglpi'),
            ];
        }
    }
}

$mappings       = $service->listAll();
$forbiddenFields = $service->getForbiddenFields();
$validPolicies  = $service->getValidPolicies();
$schemaReady    = $service->isSchemaReady();
$dryRunResult   = $dryRunResult ?? null;

Html::header(
    __('Mapeamento de Campos LogMeIn → GLPI', 'glpiintegaglpi'),
    $_SERVER['PHP_SELF'],
    'plugins',
    \GlpiPlugin\Integaglpi\GestaoGroupMenu::class
);

include __DIR__ . '/../templates/logmein_fieldmapping.php';

Html::footer();
