<?php

declare(strict_types=1);

/** @var \GlpiPlugin\Integaglpi\Renderer\ContractHoursRenderer $this */
/** @var array<string, mixed> $data */

$filters = is_array($data['filters'] ?? null) ? $data['filters'] : [];
$contracts = is_array($data['contracts'] ?? null) ? $data['contracts'] : [];
$adjustments = is_array($data['adjustments'] ?? null) ? $data['adjustments'] : [];
$kpis = is_array($data['kpis'] ?? null) ? $data['kpis'] : [];
$pagination = is_array($data['pagination'] ?? null) ? $data['pagination'] : [];
$adjustmentPagination = is_array($data['adjustment_pagination'] ?? null) ? $data['adjustment_pagination'] : [];
$flash = is_array($data['flash'] ?? null) ? $data['flash'] : null;
$error = trim((string) ($data['error'] ?? ''));
$errorDiagnostic = trim((string) ($data['error_diagnostic'] ?? ''));
$entityScopeLabel = (string) ($data['entity_scope_label'] ?? '');
$editContract = is_array($data['edit_contract'] ?? null) ? $data['edit_contract'] : [];
$entityOptions = is_array($data['entity_options'] ?? null) ? $data['entity_options'] : [];
$entityOptionsById = [];
foreach ($entityOptions as $entityOption) {
    $entityId = (int) ($entityOption['id'] ?? 0);
    if ($entityId > 0) {
        $entityOptionsById[$entityId] = (string) ($entityOption['name'] ?? '');
    }
}
$canUpdate = $this->canUpdate();

$contractForm = [
    'id' => (int) ($editContract['id'] ?? 0),
    'glpi_entity_id' => (int) ($editContract['glpi_entity_id'] ?? ((int) ($filters['entity_id'] ?? 0))),
    'glpi_entity_name' => (string) ($editContract['glpi_entity_name'] ?? ''),
    'glpi_contract_id' => (int) ($editContract['glpi_contract_id'] ?? 0),
    'contract_name' => (string) ($editContract['contract_name'] ?? ''),
    'allocated_hours' => (string) ($editContract['allocated_hours'] ?? ''),
    'period_start' => (string) ($editContract['period_start'] ?? ($filters['date_from'] ?? '')),
    'period_end' => (string) ($editContract['period_end'] ?? ($filters['date_to'] ?? '')),
    'warning_threshold_percent' => (int) ($editContract['warning_threshold_percent'] ?? 70),
    'critical_threshold_percent' => (int) ($editContract['critical_threshold_percent'] ?? 90),
    'exhausted_threshold_percent' => (int) ($editContract['exhausted_threshold_percent'] ?? 100),
    'is_active' => (bool) ($editContract['is_active'] ?? true),
    'notes' => (string) ($editContract['notes'] ?? ''),
];
$isEditingContract = $contractForm['id'] > 0;
$contractEntityLabel = $entityOptionsById[$contractForm['glpi_entity_id']]
    ?? (string) $contractForm['glpi_entity_name'];

$kpiCards = [
    ['label' => __('Horas contratadas', 'glpiintegaglpi'), 'value' => number_format((float) ($kpis['allocated_hours'] ?? 0), 2, ',', '.'), 'class' => 'primary'],
    ['label' => __('Horas consumidas', 'glpiintegaglpi'), 'value' => number_format((float) ($kpis['consumed_hours'] ?? 0), 2, ',', '.'), 'class' => 'warning'],
    ['label' => __('Saldo', 'glpiintegaglpi'), 'value' => number_format((float) ($kpis['balance_hours'] ?? 0), 2, ',', '.'), 'class' => 'success'],
    ['label' => __('Atenção 70%', 'glpiintegaglpi'), 'value' => (string) ((int) ($kpis['warning_contracts'] ?? 0)), 'class' => 'warning'],
    ['label' => __('Crítico 90%', 'glpiintegaglpi'), 'value' => (string) ((int) ($kpis['critical_contracts'] ?? 0)), 'class' => 'danger'],
    ['label' => __('Excedido 100%', 'glpiintegaglpi'), 'value' => (string) ((int) ($kpis['exhausted_contracts'] ?? 0)), 'class' => 'danger'],
];

$statusOptions = [
    'active' => __('Ativos', 'glpiintegaglpi'),
    'inactive' => __('Inativos', 'glpiintegaglpi'),
    'all' => __('Todos', 'glpiintegaglpi'),
];
?>

<div class="d-flex align-items-center justify-content-between gap-3 mb-3">
    <div>
        <h2 class="mb-1"><?= $this->escape(__('Contratos e Horas', 'glpiintegaglpi')); ?></h2>
        <div class="text-muted">
            <?= $this->escape(__('Controle consultivo por entidade. Não bloqueia atendimento, não fatura automaticamente e não usa tempo de conversa WhatsApp como consumo técnico.', 'glpiintegaglpi')); ?>
        </div>
    </div>
    <div class="d-flex align-items-center gap-2">
        <a class="btn btn-outline-secondary" href="<?= $this->escape($this->getSupervisorBackofficeUrl()); ?>">
            <?= $this->escape(__('Backoffice Supervisor', 'glpiintegaglpi')); ?>
        </a>
        <span class="badge bg-secondary">
            <?= $this->escape(__('Escopo:', 'glpiintegaglpi') . ' ' . $entityScopeLabel); ?>
        </span>
    </div>
</div>

<script>
(function () {
    function bindContractEntityPickers() {
        var pickers = document.querySelectorAll('[data-contract-entity-picker]');
        pickers.forEach(function (picker) {
            var filter = picker.querySelector('[data-entity-filter]');
            var select = picker.querySelector('[data-entity-select]');
            var output = picker.parentElement ? picker.parentElement.querySelector('[data-entity-name-output]') : null;

            function updateEntityName() {
                if (!select || !output) {
                    return;
                }
                var option = select.options[select.selectedIndex];
                output.value = option ? (option.getAttribute('data-entity-name') || option.textContent || '').trim() : '';
            }

            if (select) {
                select.addEventListener('change', updateEntityName);
                updateEntityName();
            }

            if (filter && select) {
                filter.addEventListener('input', function () {
                    var query = filter.value.toLowerCase().trim();
                    Array.prototype.forEach.call(select.options, function (option) {
                        if (option.value === '') {
                            option.hidden = false;
                            return;
                        }
                        option.hidden = query !== '' && option.textContent.toLowerCase().indexOf(query) === -1;
                    });
                });
            }
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bindContractEntityPickers);
    } else {
        bindContractEntityPickers();
    }
})();
</script>

<?php if ($flash !== null) : ?>
    <div class="alert alert-<?= $this->escape((string) ($flash['type'] ?? 'info')); ?>">
        <?= $this->escape((string) ($flash['message'] ?? '')); ?>
        <?php $flashDiagnostic = trim((string) ($flash['diagnostic'] ?? '')); ?>
        <?php if ($flashDiagnostic !== '') : ?>
            <div class="small mt-2"><?= $this->escape($flashDiagnostic); ?></div>
        <?php endif; ?>
    </div>
<?php endif; ?>

<?php if ($error !== '') : ?>
    <div class="alert alert-warning">
        <?= $this->escape($error); ?>
        <?php if ($errorDiagnostic !== '') : ?>
            <div class="small mt-2"><?= $this->escape($errorDiagnostic); ?></div>
        <?php endif; ?>
    </div>
<?php endif; ?>

<div class="alert alert-info">
    <?= $this->escape(__('Fonte oficial de consumo: tarefas GLPI com actiontime, quando disponíveis, somadas aos ajustes manuais auditados. Alertas são apenas internos.', 'glpiintegaglpi')); ?>
    <?php if (!(bool) ($data['task_actiontime_available'] ?? false)) : ?>
        <strong><?= $this->escape(__('Campo glpi_tickettasks.actiontime não disponível neste ambiente; exibindo apenas ajustes manuais.', 'glpiintegaglpi')); ?></strong>
    <?php endif; ?>
</div>

<?php if (!$canUpdate) : ?>
    <div class="alert alert-secondary">
        <?= $this->escape(__('Seu perfil pode consultar Contratos e Horas, mas não possui permissão para criar, editar ou ajustar contratos.', 'glpiintegaglpi')); ?>
    </div>
<?php endif; ?>

<div class="card mb-3">
    <div class="card-header"><?= $this->escape(__('Filtros', 'glpiintegaglpi')); ?></div>
    <div class="card-body">
        <form method="get" action="<?= $this->escape($this->getContractHoursUrl()); ?>">
            <div class="row g-3">
                <div class="col-md-2">
                    <label class="form-label"><?= $this->escape(__('De', 'glpiintegaglpi')); ?></label>
                    <input class="form-control" type="date" name="date_from" value="<?= $this->escape((string) ($filters['date_from'] ?? '')); ?>">
                </div>
                <div class="col-md-2">
                    <label class="form-label"><?= $this->escape(__('Até', 'glpiintegaglpi')); ?></label>
                    <input class="form-control" type="date" name="date_to" value="<?= $this->escape((string) ($filters['date_to'] ?? '')); ?>">
                </div>
                <div class="col-md-2">
                    <label class="form-label"><?= $this->escape(__('Entidade', 'glpiintegaglpi')); ?></label>
                    <select class="form-select" name="entity_id">
                        <option value="0"><?= $this->escape(__('Todas no escopo ativo', 'glpiintegaglpi')); ?></option>
                        <?php foreach ($entityOptions as $entityOption) : ?>
                            <?php $entityId = (int) ($entityOption['id'] ?? 0); ?>
                            <?php if ($entityId <= 0) { continue; } ?>
                            <option value="<?= $entityId; ?>" <?= ((int) ($filters['entity_id'] ?? 0) === $entityId) ? 'selected' : ''; ?>>
                                <?= $this->escape((string) ($entityOption['name'] ?? ('#' . $entityId))); ?>
                            </option>
                        <?php endforeach; ?>
                    </select>
                </div>
                <div class="col-md-2">
                    <label class="form-label"><?= $this->escape(__('Status', 'glpiintegaglpi')); ?></label>
                    <select class="form-select" name="status">
                        <?php foreach ($statusOptions as $value => $label) : ?>
                            <option value="<?= $this->escape($value); ?>" <?= ((string) ($filters['status'] ?? '') === $value) ? 'selected' : ''; ?>>
                                <?= $this->escape($label); ?>
                            </option>
                        <?php endforeach; ?>
                    </select>
                </div>
                <div class="col-md-2">
                    <label class="form-label"><?= $this->escape(__('Itens por página', 'glpiintegaglpi')); ?></label>
                    <select class="form-select" name="limit">
                        <?php foreach ([10, 25, 50] as $option) : ?>
                            <option value="<?= $option; ?>" <?= ((int) ($filters['limit'] ?? 25) === $option) ? 'selected' : ''; ?>>
                                <?= $option; ?>
                            </option>
                        <?php endforeach; ?>
                    </select>
                </div>
                <div class="col-md-2 d-flex align-items-end gap-2">
                    <button type="submit" class="btn btn-primary">
                        <?= $this->escape(__('Aplicar', 'glpiintegaglpi')); ?>
                    </button>
                    <a class="btn btn-outline-secondary" href="<?= $this->escape($this->getContractHoursUrl()); ?>">
                        <?= $this->escape(__('Limpar', 'glpiintegaglpi')); ?>
                    </a>
                </div>
            </div>
            <div class="form-text mt-2">
                <?= $this->escape(__('Período padrão: últimos 30 dias. Janela máxima aplicada: 90 dias. Limite máximo: 50 registros por página.', 'glpiintegaglpi')); ?>
            </div>
        </form>
    </div>
</div>

<div class="row g-3 mb-3">
    <?php foreach ($kpiCards as $card) : ?>
        <div class="col-md-4 col-xl-2">
            <div class="border rounded p-3 h-100">
                <div class="text-muted small mb-1"><?= $this->escape((string) $card['label']); ?></div>
                <div class="fs-3 fw-bold text-<?= $this->escape((string) $card['class']); ?>">
                    <?= $this->escape((string) $card['value']); ?>
                </div>
            </div>
        </div>
    <?php endforeach; ?>
</div>

<?php if ($canUpdate) : ?>
    <div class="card mb-3">
        <div class="card-header">
            <?= $contractForm['id'] > 0
                ? $this->escape(__('Editar contrato operacional', 'glpiintegaglpi'))
                : $this->escape(__('Novo contrato operacional', 'glpiintegaglpi')); ?>
        </div>
        <div class="card-body">
            <form method="post" action="<?= $this->escape($this->getContractHoursUrl()); ?>">
                <?= $this->renderCsrfToken(); ?>
                <input type="hidden" name="action" value="save_contract">
                <input type="hidden" name="contract_id" value="<?= (int) $contractForm['id']; ?>">
                <div class="row g-3">
                    <div class="col-md-3" data-contract-entity-picker>
                        <label class="form-label"><?= $this->escape(__('Entidade GLPI', 'glpiintegaglpi')); ?></label>
                        <?php if ($isEditingContract) : ?>
                            <input type="hidden" name="glpi_entity_id" value="<?= (int) $contractForm['glpi_entity_id']; ?>">
                            <select class="form-select" disabled data-entity-select>
                                <option
                                    value="<?= (int) $contractForm['glpi_entity_id']; ?>"
                                    data-entity-name="<?= $this->escape($contractEntityLabel); ?>"
                                    selected
                                >
                                    <?= $this->escape($contractEntityLabel !== '' ? $contractEntityLabel : ('#' . (int) $contractForm['glpi_entity_id'])); ?>
                                </option>
                            </select>
                            <div class="form-text">
                                <?= $this->escape(__('A entidade de um contrato existente não pode ser alterada. Desative este contrato e crie um novo para outra entidade.', 'glpiintegaglpi')); ?>
                            </div>
                        <?php else : ?>
                            <input
                                class="form-control form-control-sm mb-2"
                                type="search"
                                placeholder="<?= $this->escape(__('Buscar entidade permitida...', 'glpiintegaglpi')); ?>"
                                data-entity-filter
                                aria-label="<?= $this->escape(__('Buscar entidade permitida', 'glpiintegaglpi')); ?>"
                            >
                            <select class="form-select" name="glpi_entity_id" required data-entity-select <?= $entityOptions === [] ? 'disabled' : ''; ?>>
                                <option value=""><?= $this->escape(__('Selecione uma entidade', 'glpiintegaglpi')); ?></option>
                                <?php foreach ($entityOptions as $entityOption) : ?>
                                    <?php $entityId = (int) ($entityOption['id'] ?? 0); ?>
                                    <?php if ($entityId <= 0) { continue; } ?>
                                    <option
                                        value="<?= $entityId; ?>"
                                        data-entity-name="<?= $this->escape((string) ($entityOption['name'] ?? '')); ?>"
                                        <?= $contractForm['glpi_entity_id'] === $entityId ? 'selected' : ''; ?>
                                    >
                                        <?= $this->escape((string) ($entityOption['name'] ?? ('#' . $entityId))); ?>
                                    </option>
                                <?php endforeach; ?>
                            </select>
                            <?php if ($entityOptions === []) : ?>
                                <div class="form-text text-danger">
                                    <?= $this->escape(__('Nenhuma entidade permitida disponível na sessão atual.', 'glpiintegaglpi')); ?>
                                </div>
                            <?php endif; ?>
                        <?php endif; ?>
                    </div>
                    <div class="col-md-2">
                        <label class="form-label"><?= $this->escape(__('Nome/caminho da entidade', 'glpiintegaglpi')); ?></label>
                        <input
                            class="form-control"
                            type="text"
                            value="<?= $this->escape($contractEntityLabel); ?>"
                            readonly
                            data-entity-name-output
                        >
                    </div>
                    <div class="col-md-2">
                        <label class="form-label"><?= $this->escape(__('Contrato GLPI ID opcional', 'glpiintegaglpi')); ?></label>
                        <input class="form-control" type="number" min="1" name="glpi_contract_id" value="<?= (int) $contractForm['glpi_contract_id'] ?: ''; ?>">
                    </div>
                    <div class="col-md-3">
                        <label class="form-label"><?= $this->escape(__('Nome do contrato', 'glpiintegaglpi')); ?></label>
                        <input class="form-control" type="text" name="contract_name" value="<?= $this->escape((string) $contractForm['contract_name']); ?>">
                    </div>
                    <div class="col-md-2">
                        <label class="form-label"><?= $this->escape(__('Horas contratadas', 'glpiintegaglpi')); ?></label>
                        <input class="form-control" type="number" min="0" step="0.01" name="allocated_hours" required value="<?= $this->escape((string) $contractForm['allocated_hours']); ?>">
                    </div>
                    <div class="col-md-2">
                        <label class="form-label"><?= $this->escape(__('Início', 'glpiintegaglpi')); ?></label>
                        <input class="form-control" type="date" name="period_start" required value="<?= $this->escape((string) $contractForm['period_start']); ?>">
                    </div>
                    <div class="col-md-2">
                        <label class="form-label"><?= $this->escape(__('Fim', 'glpiintegaglpi')); ?></label>
                        <input class="form-control" type="date" name="period_end" required value="<?= $this->escape((string) $contractForm['period_end']); ?>">
                    </div>
                    <div class="col-md-2">
                        <label class="form-label"><?= $this->escape(__('Alerta %', 'glpiintegaglpi')); ?></label>
                        <input class="form-control" type="number" min="1" name="warning_threshold_percent" value="<?= (int) $contractForm['warning_threshold_percent']; ?>">
                    </div>
                    <div class="col-md-2">
                        <label class="form-label"><?= $this->escape(__('Crítico %', 'glpiintegaglpi')); ?></label>
                        <input class="form-control" type="number" min="1" name="critical_threshold_percent" value="<?= (int) $contractForm['critical_threshold_percent']; ?>">
                    </div>
                    <div class="col-md-2">
                        <label class="form-label"><?= $this->escape(__('Excedido %', 'glpiintegaglpi')); ?></label>
                        <input class="form-control" type="number" min="1" name="exhausted_threshold_percent" value="<?= (int) $contractForm['exhausted_threshold_percent']; ?>">
                    </div>
                    <div class="col-md-2 d-flex align-items-end">
                        <label class="form-check">
                            <input type="hidden" name="is_active" value="0">
                            <input class="form-check-input" type="checkbox" name="is_active" value="1" <?= $contractForm['is_active'] ? 'checked' : ''; ?>>
                            <span class="form-check-label"><?= $this->escape(__('Ativo', 'glpiintegaglpi')); ?></span>
                        </label>
                    </div>
                    <div class="col-md-8">
                        <label class="form-label"><?= $this->escape(__('Observações internas', 'glpiintegaglpi')); ?></label>
                        <input class="form-control" type="text" name="notes" value="<?= $this->escape((string) $contractForm['notes']); ?>">
                    </div>
                    <div class="col-md-4 d-flex align-items-end gap-2">
                        <button type="submit" class="btn btn-primary">
                            <?= $this->escape(__('Salvar contrato', 'glpiintegaglpi')); ?>
                        </button>
                        <?php if ($contractForm['id'] > 0) : ?>
                            <a class="btn btn-outline-secondary" href="<?= $this->escape($this->getContractHoursUrl()); ?>">
                                <?= $this->escape(__('Cancelar edição', 'glpiintegaglpi')); ?>
                            </a>
                        <?php endif; ?>
                    </div>
                </div>
            </form>
        </div>
    </div>
<?php endif; ?>

<div class="card mb-3">
    <div class="card-header d-flex align-items-center justify-content-between">
        <span><?= $this->escape(__('Contratos por entidade', 'glpiintegaglpi')); ?></span>
        <span class="text-muted small"><?= (int) ($data['contracts_total'] ?? 0); ?> <?= $this->escape(__('registro(s)', 'glpiintegaglpi')); ?></span>
    </div>
    <div class="card-body p-0">
        <?php if ($contracts === []) : ?>
            <div class="p-3 text-muted"><?= $this->escape(__('Nenhum contrato operacional encontrado no período/escopo filtrado.', 'glpiintegaglpi')); ?></div>
        <?php else : ?>
            <div class="table-responsive">
                <table class="table table-sm table-hover mb-0">
                    <thead class="table-light">
                        <tr>
                            <th><?= $this->escape(__('Entidade', 'glpiintegaglpi')); ?></th>
                            <th><?= $this->escape(__('Contrato', 'glpiintegaglpi')); ?></th>
                            <th><?= $this->escape(__('Vigência', 'glpiintegaglpi')); ?></th>
                            <th><?= $this->escape(__('Horas', 'glpiintegaglpi')); ?></th>
                            <th><?= $this->escape(__('Consumo', 'glpiintegaglpi')); ?></th>
                            <th><?= $this->escape(__('Alerta', 'glpiintegaglpi')); ?></th>
                            <th><?= $this->escape(__('Status', 'glpiintegaglpi')); ?></th>
                            <?php if ($canUpdate) : ?>
                                <th><?= $this->escape(__('Ações', 'glpiintegaglpi')); ?></th>
                            <?php endif; ?>
                        </tr>
                    </thead>
                    <tbody>
                        <?php foreach ($contracts as $contract) : ?>
                            <?php
                            $contractId = (int) ($contract['id'] ?? 0);
                            $alertStatus = (string) ($contract['alert_status'] ?? 'ok');
                            $alertClass = match ($alertStatus) {
                                'warning' => 'warning text-dark',
                                'critical', 'exhausted' => 'danger',
                                default => 'success',
                            };
                            ?>
                            <tr>
                                <td>
                                    <div><?= $this->escape((string) ($contract['glpi_entity_name'] ?? '-')); ?></div>
                                    <div class="text-muted small">ID <?= (int) ($contract['glpi_entity_id'] ?? 0); ?></div>
                                </td>
                                <td>
                                    <div><?= $this->escape((string) ($contract['contract_name'] ?? '-')); ?></div>
                                    <?php if ((int) ($contract['glpi_contract_id'] ?? 0) > 0) : ?>
                                        <div class="text-muted small"><?= $this->escape(__('Ref. contrato GLPI:', 'glpiintegaglpi')); ?> <?= (int) ($contract['glpi_contract_id'] ?? 0); ?></div>
                                    <?php endif; ?>
                                </td>
                                <td><?= $this->escape((string) ($contract['period_start'] ?? '-')); ?> - <?= $this->escape((string) ($contract['period_end'] ?? '-')); ?></td>
                                <td>
                                    <div><?= number_format((float) ($contract['allocated_hours'] ?? 0), 2, ',', '.'); ?>h <?= $this->escape(__('contratadas', 'glpiintegaglpi')); ?></div>
                                    <div class="text-muted small"><?= number_format((float) ($contract['balance_hours'] ?? 0), 2, ',', '.'); ?>h <?= $this->escape(__('saldo', 'glpiintegaglpi')); ?></div>
                                </td>
                                <td>
                                    <div><?= number_format((float) ($contract['consumed_hours'] ?? 0), 2, ',', '.'); ?>h (<?= number_format((float) ($contract['consumed_percent'] ?? 0), 1, ',', '.'); ?>%)</div>
                                    <div class="text-muted small">
                                        <?= $this->escape(__('Tarefas GLPI:', 'glpiintegaglpi')); ?>
                                        <?= $contract['glpi_task_hours'] === null ? $this->escape(__('indisponível', 'glpiintegaglpi')) : number_format((float) $contract['glpi_task_hours'], 2, ',', '.') . 'h'; ?>
                                        · <?= $this->escape(__('Ajustes:', 'glpiintegaglpi')); ?>
                                        <?= number_format((float) ($contract['manual_adjustment_hours'] ?? 0), 2, ',', '.'); ?>h
                                    </div>
                                </td>
                                <td>
                                    <span class="badge bg-<?= $this->escape($alertClass); ?>">
                                        <?= $this->escape((string) ($contract['alert_label'] ?? '')); ?>
                                    </span>
                                    <div class="text-muted small">
                                        <?= (int) ($contract['warning_threshold_percent'] ?? 70); ?>% / <?= (int) ($contract['critical_threshold_percent'] ?? 90); ?>% / <?= (int) ($contract['exhausted_threshold_percent'] ?? 100); ?>%
                                    </div>
                                </td>
                                <td><?= ((bool) ($contract['is_active'] ?? false)) ? $this->escape(__('Ativo', 'glpiintegaglpi')) : $this->escape(__('Inativo', 'glpiintegaglpi')); ?></td>
                                <?php if ($canUpdate) : ?>
                                    <td>
                                        <a class="small me-2" href="<?= $this->escape($this->getEditUrl($filters, $contractId)); ?>">
                                            <?= $this->escape(__('Editar', 'glpiintegaglpi')); ?>
                                        </a>
                                        <form method="post" action="<?= $this->escape($this->getContractHoursUrl()); ?>" class="d-inline">
                                            <?= $this->renderCsrfToken(); ?>
                                            <input type="hidden" name="contract_id" value="<?= $contractId; ?>">
                                            <input type="hidden" name="action" value="<?= ((bool) ($contract['is_active'] ?? false)) ? 'disable_contract' : 'enable_contract'; ?>">
                                            <button type="submit" class="btn btn-link btn-sm p-0">
                                                <?= ((bool) ($contract['is_active'] ?? false)) ? $this->escape(__('Desativar', 'glpiintegaglpi')) : $this->escape(__('Reativar', 'glpiintegaglpi')); ?>
                                            </button>
                                        </form>
                                    </td>
                                <?php endif; ?>
                            </tr>
                        <?php endforeach; ?>
                    </tbody>
                </table>
            </div>
        <?php endif; ?>
    </div>
    <div class="card-footer d-flex justify-content-between">
        <?php if ((bool) ($pagination['has_previous'] ?? false)) : ?>
            <a href="<?= $this->escape($this->getPageUrl($filters, max(1, (int) ($pagination['page'] ?? 1) - 1))); ?>">&laquo; <?= $this->escape(__('Anterior', 'glpiintegaglpi')); ?></a>
        <?php else : ?>
            <span></span>
        <?php endif; ?>
        <?php if ((bool) ($pagination['has_next'] ?? false)) : ?>
            <a href="<?= $this->escape($this->getPageUrl($filters, (int) ($pagination['page'] ?? 1) + 1)); ?>"><?= $this->escape(__('Próxima', 'glpiintegaglpi')); ?> &raquo;</a>
        <?php endif; ?>
    </div>
</div>

<?php if ($canUpdate && $contracts !== []) : ?>
    <div class="card mb-3">
        <div class="card-header"><?= $this->escape(__('Ajuste manual auditado', 'glpiintegaglpi')); ?></div>
        <div class="card-body">
            <form method="post" action="<?= $this->escape($this->getContractHoursUrl()); ?>">
                <?= $this->renderCsrfToken(); ?>
                <input type="hidden" name="action" value="add_adjustment">
                <div class="row g-3">
                    <div class="col-md-3">
                        <label class="form-label"><?= $this->escape(__('Contrato', 'glpiintegaglpi')); ?></label>
                        <select class="form-select" name="contract_id" required>
                            <?php foreach ($contracts as $contract) : ?>
                                <option value="<?= (int) ($contract['id'] ?? 0); ?>">
                                    #<?= (int) ($contract['id'] ?? 0); ?> - <?= $this->escape((string) ($contract['contract_name'] ?? $contract['glpi_entity_name'] ?? 'Contrato')); ?>
                                </option>
                            <?php endforeach; ?>
                        </select>
                    </div>
                    <div class="col-md-2">
                        <label class="form-label"><?= $this->escape(__('Tipo', 'glpiintegaglpi')); ?></label>
                        <select class="form-select" name="adjustment_type">
                            <option value="add"><?= $this->escape(__('Adicionar horas', 'glpiintegaglpi')); ?></option>
                            <option value="remove"><?= $this->escape(__('Remover horas', 'glpiintegaglpi')); ?></option>
                            <option value="correction"><?= $this->escape(__('Correção', 'glpiintegaglpi')); ?></option>
                        </select>
                    </div>
                    <div class="col-md-2">
                        <label class="form-label"><?= $this->escape(__('Horas', 'glpiintegaglpi')); ?></label>
                        <input class="form-control" type="number" min="0.01" step="0.01" name="adjusted_hours" required>
                    </div>
                    <div class="col-md-2">
                        <label class="form-label"><?= $this->escape(__('Ticket GLPI opcional', 'glpiintegaglpi')); ?></label>
                        <input class="form-control" type="number" min="1" name="glpi_ticket_id">
                    </div>
                    <div class="col-md-3">
                        <label class="form-label"><?= $this->escape(__('Justificativa obrigatória', 'glpiintegaglpi')); ?></label>
                        <input class="form-control" type="text" name="review_notes" required>
                    </div>
                    <div class="col-12">
                        <button type="submit" class="btn btn-primary">
                            <?= $this->escape(__('Registrar ajuste', 'glpiintegaglpi')); ?>
                        </button>
                    </div>
                </div>
            </form>
        </div>
    </div>
<?php endif; ?>

<div class="card">
    <div class="card-header d-flex align-items-center justify-content-between">
        <span><?= $this->escape(__('Histórico de ajustes', 'glpiintegaglpi')); ?></span>
        <span class="text-muted small"><?= (int) ($data['adjustments_total'] ?? 0); ?> <?= $this->escape(__('registro(s)', 'glpiintegaglpi')); ?></span>
    </div>
    <div class="card-body p-0">
        <?php if ($adjustments === []) : ?>
            <div class="p-3 text-muted"><?= $this->escape(__('Sem ajustes manuais no período filtrado.', 'glpiintegaglpi')); ?></div>
        <?php else : ?>
            <div class="table-responsive">
                <table class="table table-sm table-hover mb-0">
                    <thead class="table-light">
                        <tr>
                            <th><?= $this->escape(__('Data', 'glpiintegaglpi')); ?></th>
                            <th><?= $this->escape(__('Contrato', 'glpiintegaglpi')); ?></th>
                            <th><?= $this->escape(__('Horas', 'glpiintegaglpi')); ?></th>
                            <th><?= $this->escape(__('Origem', 'glpiintegaglpi')); ?></th>
                            <th><?= $this->escape(__('Ticket', 'glpiintegaglpi')); ?></th>
                            <th><?= $this->escape(__('Revisado por', 'glpiintegaglpi')); ?></th>
                            <th><?= $this->escape(__('Justificativa', 'glpiintegaglpi')); ?></th>
                        </tr>
                    </thead>
                    <tbody>
                        <?php foreach ($adjustments as $adjustment) : ?>
                            <?php $ticketId = (int) ($adjustment['glpi_ticket_id'] ?? 0); ?>
                            <tr>
                                <td><?= $this->escape((string) ($adjustment['created_at'] ?? '-')); ?></td>
                                <td>
                                    <div>#<?= (int) ($adjustment['contract_id'] ?? 0); ?> <?= $this->escape((string) ($adjustment['contract_name'] ?? '')); ?></div>
                                    <div class="text-muted small"><?= $this->escape((string) ($adjustment['glpi_entity_name'] ?? '')); ?></div>
                                </td>
                                <td><?= number_format((float) ($adjustment['adjusted_hours'] ?? 0), 2, ',', '.'); ?>h</td>
                                <td><?= $this->escape((string) ($adjustment['source'] ?? '')); ?> / <?= $this->escape((string) ($adjustment['adjustment_type'] ?? '')); ?></td>
                                <td>
                                    <?php if ($ticketId > 0) : ?>
                                        <a href="<?= $this->escape($this->getTicketUrl($ticketId)); ?>" target="_blank" rel="noopener noreferrer">#<?= $ticketId; ?></a>
                                    <?php else : ?>
                                        -
                                    <?php endif; ?>
                                </td>
                                <td><?= $this->escape((string) ($adjustment['reviewed_by_name'] ?? '-')); ?></td>
                                <td><?= $this->escape((string) ($adjustment['review_notes'] ?? '')); ?></td>
                            </tr>
                        <?php endforeach; ?>
                    </tbody>
                </table>
            </div>
        <?php endif; ?>
    </div>
    <div class="card-footer d-flex justify-content-between">
        <?php if ((bool) ($adjustmentPagination['has_previous'] ?? false)) : ?>
            <a href="<?= $this->escape($this->getAdjustmentPageUrl($filters, max(1, (int) ($adjustmentPagination['page'] ?? 1) - 1))); ?>">&laquo; <?= $this->escape(__('Anterior', 'glpiintegaglpi')); ?></a>
        <?php else : ?>
            <span></span>
        <?php endif; ?>
        <?php if ((bool) ($adjustmentPagination['has_next'] ?? false)) : ?>
            <a href="<?= $this->escape($this->getAdjustmentPageUrl($filters, (int) ($adjustmentPagination['page'] ?? 1) + 1)); ?>"><?= $this->escape(__('Próxima', 'glpiintegaglpi')); ?> &raquo;</a>
        <?php endif; ?>
    </div>
</div>
