<?php

declare(strict_types=1);

use GlpiPlugin\Integaglpi\LogmeinGroupMenu;
use GlpiPlugin\Integaglpi\Plugin;
use GlpiPlugin\Integaglpi\Service\LogmeinGovernanceService;

include '../../../inc/includes.php';

Session::checkLoginUser();

$service = new LogmeinGovernanceService();
if (!$service->canViewLogmeinReports()) {
    Html::displayRightError();
}

$flash = null;
$report = null;

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (!Plugin::isCsrfValid($_POST)) {
        $flash = [
            'type' => 'danger',
            'message' => __('Token CSRF inválido. Recarregue a página e tente novamente.', 'glpiintegaglpi'),
        ];
    } elseif ((string) ($_POST['action'] ?? '') === 'export_csv') {
        $export = $service->exportOperationalReportCsv($_POST);
        if ($export['ok']) {
            header('Content-Type: text/csv; charset=UTF-8');
            header('Content-Disposition: attachment; filename="' . basename($export['filename']) . '"');
            header('X-Content-Type-Options: nosniff');
            echo "\xEF\xBB\xBF";
            echo $export['content'];
            exit;
        }

        $flash = [
            'type' => 'danger',
            'message' => __('Exportação LogMeIn indisponível para os filtros atuais.', 'glpiintegaglpi'),
        ];
    }
}

$report = $service->buildOperationalReports($_GET);
$csrfToken = Plugin::getCsrfToken();

Html::header(__('Relatórios LogMeIn read-only', 'glpiintegaglpi'), $_SERVER['PHP_SELF'], 'plugins', LogmeinGroupMenu::class);

include __DIR__ . '/../templates/logmein_reports.php';

Html::footer();
