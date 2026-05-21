<?php

declare(strict_types=1);

use GlpiPlugin\Integaglpi\Plugin;

/** @var array<string, mixed> $view */

$response = is_array($view['response'] ?? null) ? $view['response'] : [];
$batch = is_array($response['batch'] ?? null) ? $response['batch'] : [];
$items = is_array($response['items'] ?? null) ? $response['items'] : [];
$error = trim((string) ($view['error'] ?? ''));
$notice = trim((string) ($view['notice'] ?? ''));
$processedFilename = trim((string) ($view['processed_filename'] ?? ''));

if (!function_exists('plugin_integaglpi_contact_import_h')) {
    function plugin_integaglpi_contact_import_h(mixed $value): string
    {
        return Html::cleanInputText((string) $value);
    }
}

if (!function_exists('plugin_integaglpi_contact_import_status_badge')) {
    function plugin_integaglpi_contact_import_status_badge(string $status): string
    {
        $class = match ($status) {
            'completed' => 'bg-success',
            'failed' => 'bg-danger',
            'processing', 'confirmed' => 'bg-warning text-dark',
            'rolled_back' => 'bg-secondary',
            default => 'bg-info text-dark',
        };

        return '<span class="badge ' . $class . '">' . plugin_integaglpi_contact_import_h($status) . '</span>';
    }
}

$batchId = (string) ($batch['batchId'] ?? '');
$status = (string) ($batch['status'] ?? '');
$validRows = (int) ($batch['validRows'] ?? 0);
$invalidRows = (int) ($batch['invalidRows'] ?? 0);
$duplicateRows = (int) ($batch['duplicateRows'] ?? 0);
$conflictRows = (int) ($batch['conflictRows'] ?? 0);
?>

<div class="d-flex align-items-start justify-content-between gap-3 mb-3">
    <div>
        <h2 class="mb-1"><?= plugin_integaglpi_contact_import_h(__('Importar agenda de contatos', 'glpiintegaglpi')); ?></h2>
        <div class="text-muted">
            <?= plugin_integaglpi_contact_import_h(__('Upload manual com preview obrigatório, deduplicação, auditoria e rollback lógico.', 'glpiintegaglpi')); ?>
        </div>
    </div>
    <span class="badge bg-light text-dark"><?= plugin_integaglpi_contact_import_h(__('Sem criação de ticket, usuário GLPI ou entidade automática', 'glpiintegaglpi')); ?></span>
</div>

<?php if ($error !== '') : ?>
    <div class="alert alert-warning"><?= plugin_integaglpi_contact_import_h($error); ?></div>
<?php endif; ?>

<?php if ($notice !== '') : ?>
    <div class="alert alert-success"><?= plugin_integaglpi_contact_import_h($notice); ?></div>
<?php endif; ?>

<div class="card mb-3">
    <div class="card-header"><?= plugin_integaglpi_contact_import_h(__('1. Upload para preview', 'glpiintegaglpi')); ?></div>
    <div class="card-body">
        <form method="post" enctype="multipart/form-data" action="<?= plugin_integaglpi_contact_import_h(Plugin::getContactAgendaImportUrl()); ?>">
            <?= Plugin::renderCsrfToken(); ?>
            <input type="hidden" name="action" value="preview">
            <div class="row g-3 align-items-end">
                <div class="col-md-6">
                    <label class="form-label"><?= plugin_integaglpi_contact_import_h(__('Arquivo CSV', 'glpiintegaglpi')); ?></label>
                    <input class="form-control" type="file" name="csv_file" accept=".csv,text/csv" required>
                    <div class="form-text">
                        <?= plugin_integaglpi_contact_import_h(__('Cabeçalhos aceitos: telefone, email, nome, empresa, etiqueta.', 'glpiintegaglpi')); ?>
                    </div>
                </div>
                <div class="col-md-3">
                    <button class="btn btn-primary" type="submit">
                        <?= plugin_integaglpi_contact_import_h(__('Gerar preview', 'glpiintegaglpi')); ?>
                    </button>
                </div>
            </div>
        </form>
    </div>
</div>

<?php if ($batch !== []) : ?>
    <div class="card mb-3">
        <div class="card-header d-flex align-items-center justify-content-between">
            <span><?= plugin_integaglpi_contact_import_h(__('2. Preview do batch', 'glpiintegaglpi')); ?></span>
            <?= plugin_integaglpi_contact_import_status_badge($status); ?>
        </div>
        <div class="card-body">
            <div class="row g-3 mb-3">
                <div class="col-md-3"><strong>Batch:</strong> <?= plugin_integaglpi_contact_import_h($batchId); ?></div>
                <div class="col-md-2"><strong>Total:</strong> <?= (int) ($batch['totalRows'] ?? 0); ?></div>
                <div class="col-md-2 text-success"><strong>Válidos:</strong> <?= $validRows; ?></div>
                <div class="col-md-2 text-danger"><strong>Inválidos:</strong> <?= $invalidRows; ?></div>
                <div class="col-md-2 text-warning"><strong>Duplicados:</strong> <?= $duplicateRows; ?></div>
                <div class="col-md-1 text-warning"><strong>Conflitos:</strong> <?= $conflictRows; ?></div>
            </div>
            <?php if ($processedFilename !== '') : ?>
                <div class="text-muted small mb-3">
                    <?= plugin_integaglpi_contact_import_h(__('Arquivo processado:', 'glpiintegaglpi')); ?>
                    <?= plugin_integaglpi_contact_import_h($processedFilename); ?>
                </div>
            <?php endif; ?>

            <?php if ($status === 'previewed' && $validRows > 0) : ?>
                <form
                    id="plugin-integaglpi-contact-import-confirm"
                    method="post"
                    action="<?= plugin_integaglpi_contact_import_h(Plugin::getContactAgendaImportUrl()); ?>"
                    class="d-inline"
                >
                    <?= Plugin::renderCsrfToken(); ?>
                    <input type="hidden" name="action" value="confirm">
                    <input type="hidden" name="batch_id" value="<?= plugin_integaglpi_contact_import_h($batchId); ?>">
                    <button
                        class="btn btn-success"
                        type="submit"
                        form="plugin-integaglpi-contact-import-confirm"
                    >
                        <?= plugin_integaglpi_contact_import_h(__('Confirmar importação', 'glpiintegaglpi')); ?>
                    </button>
                </form>
            <?php endif; ?>

            <?php if ($status === 'completed') : ?>
                <form method="post" action="<?= plugin_integaglpi_contact_import_h(Plugin::getContactAgendaImportUrl()); ?>" class="mt-3">
                    <?= Plugin::renderCsrfToken(); ?>
                    <input type="hidden" name="action" value="rollback">
                    <input type="hidden" name="batch_id" value="<?= plugin_integaglpi_contact_import_h($batchId); ?>">
                    <label class="form-label"><?= plugin_integaglpi_contact_import_h(__('Justificativa do rollback lógico', 'glpiintegaglpi')); ?></label>
                    <div class="input-group">
                        <input class="form-control" type="text" name="reason" maxlength="500" required>
                        <button class="btn btn-outline-danger" type="submit">
                            <?= plugin_integaglpi_contact_import_h(__('Rollback lógico do batch', 'glpiintegaglpi')); ?>
                        </button>
                    </div>
                </form>
            <?php endif; ?>
        </div>
    </div>

    <div class="card">
        <div class="card-header"><?= plugin_integaglpi_contact_import_h(__('Linhas do preview', 'glpiintegaglpi')); ?></div>
        <div class="table-responsive">
            <table class="table table-sm table-striped mb-0">
                <thead>
                    <tr>
                        <th>#</th>
                        <th><?= plugin_integaglpi_contact_import_h(__('Telefone', 'glpiintegaglpi')); ?></th>
                        <th><?= plugin_integaglpi_contact_import_h(__('E-mail', 'glpiintegaglpi')); ?></th>
                        <th><?= plugin_integaglpi_contact_import_h(__('Nome', 'glpiintegaglpi')); ?></th>
                        <th><?= plugin_integaglpi_contact_import_h(__('Empresa', 'glpiintegaglpi')); ?></th>
                        <th><?= plugin_integaglpi_contact_import_h(__('Etiqueta', 'glpiintegaglpi')); ?></th>
                        <th><?= plugin_integaglpi_contact_import_h(__('Validação', 'glpiintegaglpi')); ?></th>
                        <th><?= plugin_integaglpi_contact_import_h(__('Dedup', 'glpiintegaglpi')); ?></th>
                        <th><?= plugin_integaglpi_contact_import_h(__('Ação', 'glpiintegaglpi')); ?></th>
                        <th><?= plugin_integaglpi_contact_import_h(__('Aplicado', 'glpiintegaglpi')); ?></th>
                    </tr>
                </thead>
                <tbody>
                    <?php foreach ($items as $item) : ?>
                        <?php $errors = is_array($item['validation_errors'] ?? null) ? implode('; ', $item['validation_errors']) : ''; ?>
                        <tr>
                            <td><?= (int) ($item['row_number'] ?? 0); ?></td>
                            <td><?= plugin_integaglpi_contact_import_h($item['phone_masked'] ?? ''); ?></td>
                            <td><?= plugin_integaglpi_contact_import_h($item['email_masked'] ?? ''); ?></td>
                            <td><?= plugin_integaglpi_contact_import_h($item['contact_name'] ?? ''); ?></td>
                            <td><?= plugin_integaglpi_contact_import_h($item['company_name'] ?? ''); ?></td>
                            <td><?= plugin_integaglpi_contact_import_h($item['equipment_tag'] ?? ''); ?></td>
                            <td>
                                <?= plugin_integaglpi_contact_import_h($item['validation_status'] ?? ''); ?>
                                <?php if ($errors !== '') : ?>
                                    <div class="text-danger small"><?= plugin_integaglpi_contact_import_h($errors); ?></div>
                                <?php endif; ?>
                            </td>
                            <td><?= plugin_integaglpi_contact_import_h($item['dedup_status'] ?? ''); ?></td>
                            <td><?= plugin_integaglpi_contact_import_h($item['action_planned'] ?? ''); ?></td>
                            <td><?= plugin_integaglpi_contact_import_h($item['action_applied'] ?? ''); ?></td>
                        </tr>
                    <?php endforeach; ?>
                </tbody>
            </table>
        </div>
    </div>
<?php endif; ?>
