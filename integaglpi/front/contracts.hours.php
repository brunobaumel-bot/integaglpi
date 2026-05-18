<?php

declare(strict_types=1);

use GlpiPlugin\Integaglpi\ContractsHoursMenu;
use GlpiPlugin\Integaglpi\Plugin;
use GlpiPlugin\Integaglpi\Renderer\ContractHoursRenderer;
use GlpiPlugin\Integaglpi\Service\ContractHoursService;
use GlpiPlugin\Integaglpi\Service\PluginConfigService;

include '../../../inc/includes.php';

Session::checkLoginUser();
Plugin::requireContractRead();

$service = new ContractHoursService(new PluginConfigService());
$flash = null;

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    Plugin::requireContractUpdate();
    if (!Plugin::isCsrfValid($_POST)) {
        $flash = [
            'type' => 'danger',
            'message' => __('Token CSRF inválido. Recarregue a página e tente novamente.', 'glpiintegaglpi'),
        ];
    } else {
        $flash = $service->handlePost($_POST, Plugin::getCurrentUserId());
    }
}

Html::header(__('Contratos e Horas', 'glpiintegaglpi'), $_SERVER['PHP_SELF'], 'plugins', ContractsHoursMenu::class);

$renderer = new ContractHoursRenderer($service);
$renderer->render($_GET, $flash);

Html::footer();
