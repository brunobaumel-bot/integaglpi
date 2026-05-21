<?php

declare(strict_types=1);

use GlpiPlugin\Integaglpi\ContactAgendaImportMenu;
use GlpiPlugin\Integaglpi\Plugin;
use GlpiPlugin\Integaglpi\Service\IntegrationServiceClient;

include '../../../inc/includes.php';

Session::checkLoginUser();
Session::checkRight(Plugin::RIGHT_NAME, UPDATE);
Plugin::requireUpdate();

$client = new IntegrationServiceClient();
$view = [
    'error' => '',
    'notice' => '',
    'response' => null,
    'batch_id' => trim((string) ($_GET['batch_id'] ?? '')),
    'processed_filename' => '',
];

function plugin_integaglpi_contact_import_redirect(string $batchId): void
{
    Html::redirect(Plugin::getContactAgendaImportUrl() . '?' . http_build_query(['batch_id' => $batchId]));
}

function plugin_integaglpi_contact_import_upload_error_message(int $errorCode): string
{
    return match ($errorCode) {
        UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE => __('O arquivo CSV excede o limite de upload configurado.', 'glpiintegaglpi'),
        UPLOAD_ERR_PARTIAL => __('O upload do CSV foi enviado parcialmente. Tente novamente.', 'glpiintegaglpi'),
        UPLOAD_ERR_NO_FILE => __('Selecione um arquivo CSV antes de gerar o preview.', 'glpiintegaglpi'),
        UPLOAD_ERR_NO_TMP_DIR => __('Diretório temporário de upload indisponível no servidor.', 'glpiintegaglpi'),
        UPLOAD_ERR_CANT_WRITE => __('Não foi possível gravar o upload CSV no servidor.', 'glpiintegaglpi'),
        UPLOAD_ERR_EXTENSION => __('Uma extensão PHP bloqueou o upload CSV.', 'glpiintegaglpi'),
        default => __('Falha ao receber o arquivo CSV.', 'glpiintegaglpi'),
    };
}

function plugin_integaglpi_contact_import_batch_id(array $body): string
{
    $batch = is_array($body['batch'] ?? null) ? $body['batch'] : [];

    return trim((string) ($batch['batchId'] ?? $batch['batch_id'] ?? ''));
}

function plugin_integaglpi_contact_import_status(array $body): string
{
    $batch = is_array($body['batch'] ?? null) ? $body['batch'] : [];

    return trim((string) ($batch['status'] ?? ''));
}

try {
    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        if (!Plugin::isCsrfValid($_POST)) {
            throw new RuntimeException(__('Token CSRF inválido.', 'glpiintegaglpi'));
        }

        $action = trim((string) ($_POST['action'] ?? ''));
        if ($action === 'preview') {
            $file = $_FILES['csv_file'] ?? null;
            if (!is_array($file)) {
                throw new RuntimeException(__('Selecione um arquivo CSV antes de gerar o preview.', 'glpiintegaglpi'));
            }

            $uploadError = (int) ($file['error'] ?? UPLOAD_ERR_NO_FILE);
            if ($uploadError !== UPLOAD_ERR_OK) {
                throw new RuntimeException(plugin_integaglpi_contact_import_upload_error_message($uploadError));
            }

            $tmpName = (string) ($file['tmp_name'] ?? '');
            if ($tmpName === '' || !is_uploaded_file($tmpName)) {
                throw new RuntimeException(__('Upload CSV inválido.', 'glpiintegaglpi'));
            }

            $originalName = basename((string) ($file['name'] ?? 'agenda.csv'));
            if (strtolower(pathinfo($originalName, PATHINFO_EXTENSION)) !== 'csv') {
                throw new RuntimeException(__('Envie um arquivo com extensão .csv.', 'glpiintegaglpi'));
            }

            $content = file_get_contents($tmpName);
            if ($content === false || trim($content) === '') {
                throw new RuntimeException(__('CSV vazio ou ilegível.', 'glpiintegaglpi'));
            }

            $result = $client->previewContactAgendaImport([
                'filename' => $originalName,
                'csv_base64' => base64_encode($content),
                'uploaded_by' => Plugin::getCurrentUserId(),
            ]);
            if (!$result['success']) {
                throw new RuntimeException((string) ($result['body']['message'] ?? __('Falha no preview CSV.', 'glpiintegaglpi')));
            }

            $batchId = plugin_integaglpi_contact_import_batch_id($result['body']);
            if ($batchId === '') {
                throw new RuntimeException(__('Preview retornou sem batch_id. Verifique o integration-service.', 'glpiintegaglpi'));
            }

            $view['batch_id'] = $batchId;
            $view['processed_filename'] = $originalName;
            $view['response'] = $result['body'];
            $view['notice'] = __('Preview CSV gerado com sucesso. Revise as linhas antes de confirmar.', 'glpiintegaglpi');
        } elseif ($action === 'confirm') {
            $batchId = trim((string) ($_POST['batch_id'] ?? ''));
            if ($batchId === '') {
                throw new RuntimeException(__('Batch obrigatório.', 'glpiintegaglpi'));
            }
            error_log('[integaglpi][contact_import][confirm][REQUEST] batch_id=' . substr($batchId, 0, 80));
            $result = $client->confirmContactAgendaImport($batchId, [
                'confirmed_by' => Plugin::getCurrentUserId(),
            ]);
            if (!$result['success']) {
                throw new RuntimeException((string) ($result['body']['message'] ?? __('Falha ao confirmar importação.', 'glpiintegaglpi')));
            }

            $view['batch_id'] = $batchId;
            $view['response'] = $result['body'];
            $status = plugin_integaglpi_contact_import_status($result['body']);
            $view['notice'] = $status === 'completed'
                ? __('Importação confirmada e processada com sucesso.', 'glpiintegaglpi')
                : sprintf(__('Confirmação enviada. Status atual do batch: %s.', 'glpiintegaglpi'), $status !== '' ? $status : __('indefinido', 'glpiintegaglpi'));
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
        } else {
            throw new RuntimeException(__('Ação de importação inválida.', 'glpiintegaglpi'));
        }
    }

    if ($view['batch_id'] !== '' && $view['response'] === null) {
        $result = $client->getContactAgendaImportStatus($view['batch_id']);
        if ($result['success']) {
            $view['response'] = $result['body'];
        } else {
            $view['error'] = (string) ($result['body']['message'] ?? __('Não foi possível carregar o batch.', 'glpiintegaglpi'));
        }
    }
} catch (Throwable $exception) {
    $view['error'] = $exception->getMessage();
    error_log('[integaglpi][contact_import][ERROR] action=' . trim((string) ($_POST['action'] ?? '')) . ' message=' . $exception->getMessage());
}

Html::header(__('Importar agenda WhatsApp', 'glpiintegaglpi'), $_SERVER['PHP_SELF'], 'plugins', ContactAgendaImportMenu::class);

require PLUGIN_INTEGAGLPI_ROOT . '/templates/contact_agenda_import.php';

Html::footer();
