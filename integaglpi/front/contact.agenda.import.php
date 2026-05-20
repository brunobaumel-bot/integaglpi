<?php

declare(strict_types=1);

use GlpiPlugin\Integaglpi\ContactAgendaImportMenu;
use GlpiPlugin\Integaglpi\Plugin;
use GlpiPlugin\Integaglpi\Service\IntegrationServiceClient;

include '../../../inc/includes.php';

Session::checkLoginUser();
Session::checkRight(Plugin::RIGHT_NAME, UPDATE);
Plugin::requireUpdate();

Html::header(__('Importar agenda WhatsApp', 'glpiintegaglpi'), $_SERVER['PHP_SELF'], 'plugins', ContactAgendaImportMenu::class);

$client = new IntegrationServiceClient();
$view = [
    'error' => '',
    'response' => null,
    'batch_id' => trim((string) ($_GET['batch_id'] ?? '')),
];

function plugin_integaglpi_contact_import_redirect(string $batchId): void
{
    Html::redirect(Plugin::getContactAgendaImportUrl() . '?' . http_build_query(['batch_id' => $batchId]));
}

try {
    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        if (!Plugin::isCsrfValid($_POST)) {
            throw new RuntimeException(__('Token CSRF inválido.', 'glpiintegaglpi'));
        }

        $action = trim((string) ($_POST['action'] ?? ''));
        if ($action === 'preview') {
            $file = $_FILES['csv_file'] ?? null;
            if (!is_array($file) || (int) ($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
                throw new RuntimeException(__('Envie um arquivo CSV válido.', 'glpiintegaglpi'));
            }

            $tmpName = (string) ($file['tmp_name'] ?? '');
            if ($tmpName === '' || !is_uploaded_file($tmpName)) {
                throw new RuntimeException(__('Upload CSV inválido.', 'glpiintegaglpi'));
            }

            $content = file_get_contents($tmpName);
            if ($content === false || trim($content) === '') {
                throw new RuntimeException(__('CSV vazio ou ilegível.', 'glpiintegaglpi'));
            }

            $result = $client->previewContactAgendaImport([
                'filename' => (string) ($file['name'] ?? 'agenda.csv'),
                'csv_base64' => base64_encode($content),
                'uploaded_by' => Plugin::getCurrentUserId(),
            ]);
            if (!$result['success']) {
                throw new RuntimeException((string) ($result['body']['message'] ?? __('Falha no preview CSV.', 'glpiintegaglpi')));
            }

            $batchId = (string) ($result['body']['batch']['batchId'] ?? '');
            if ($batchId !== '') {
                plugin_integaglpi_contact_import_redirect($batchId);
            }
            $view['response'] = $result['body'];
        } elseif ($action === 'confirm') {
            $batchId = trim((string) ($_POST['batch_id'] ?? ''));
            if ($batchId === '') {
                throw new RuntimeException(__('Batch obrigatório.', 'glpiintegaglpi'));
            }
            $result = $client->confirmContactAgendaImport($batchId, [
                'confirmed_by' => Plugin::getCurrentUserId(),
            ]);
            if (!$result['success']) {
                throw new RuntimeException((string) ($result['body']['message'] ?? __('Falha ao confirmar importação.', 'glpiintegaglpi')));
            }
            plugin_integaglpi_contact_import_redirect($batchId);
        } elseif ($action === 'rollback') {
            $batchId = trim((string) ($_POST['batch_id'] ?? ''));
            $reason = trim((string) ($_POST['reason'] ?? ''));
            if ($batchId === '' || $reason === '') {
                throw new RuntimeException(__('Batch e justificativa são obrigatórios para rollback.', 'glpiintegaglpi'));
            }
            $result = $client->rollbackContactAgendaImport($batchId, [
                'requested_by' => Plugin::getCurrentUserId(),
                'reason' => $reason,
            ]);
            if (!$result['success']) {
                throw new RuntimeException((string) ($result['body']['message'] ?? __('Falha no rollback lógico.', 'glpiintegaglpi')));
            }
            plugin_integaglpi_contact_import_redirect($batchId);
        }
    }

    if ($view['batch_id'] !== '') {
        $result = $client->getContactAgendaImportStatus($view['batch_id']);
        if ($result['success']) {
            $view['response'] = $result['body'];
        } else {
            $view['error'] = (string) ($result['body']['message'] ?? __('Não foi possível carregar o batch.', 'glpiintegaglpi'));
        }
    }
} catch (Throwable $exception) {
    $view['error'] = $exception->getMessage();
}

require PLUGIN_INTEGAGLPI_ROOT . '/templates/contact_agenda_import.php';

Html::footer();
