<?php

declare(strict_types=1);

/** @var \GlpiPlugin\Integaglpi\Renderer\ServiceCatalogRenderer $this */
/** @var array<string, mixed> $data */

$filters = is_array($data['filters'] ?? null) ? $data['filters'] : [];
$flash = is_array($data['flash'] ?? null) ? $data['flash'] : null;
$error = trim((string) ($data['error'] ?? ''));
$services = is_array($data['services'] ?? null) ? $data['services'] : [];
$queues = is_array($data['queues'] ?? null) ? $data['queues'] : [];
$editService = is_array($data['edit_service'] ?? null) ? $data['edit_service'] : [];
$canUpdate = $this->canUpdate();
$serviceForm = [
    'id' => (int) ($editService['id'] ?? 0),
    'service_key' => (string) ($editService['service_key'] ?? ''),
    'name' => (string) ($editService['name'] ?? ''),
    'description' => (string) ($editService['description'] ?? ''),
    'routing_queue_id' => (int) ($editService['routing_queue_id'] ?? 0),
    'glpi_entity_id' => (int) ($editService['glpi_entity_id'] ?? 0),
    'default_priority' => (string) ($editService['default_priority'] ?? ''),
    'required_fields_json' => (string) ($editService['required_fields_json'] ?? '[]'),
    'sla_response_minutes' => (string) ($editService['sla_response_minutes'] ?? ''),
    'sla_solution_minutes' => (string) ($editService['sla_solution_minutes'] ?? ''),
    'is_active' => (bool) ($editService['is_active'] ?? true),
];
$statusOptions = [
    'active' => __('Ativos', 'glpiintegaglpi'),
    'inactive' => __('Inativos', 'glpiintegaglpi'),
    'all' => __('Todos', 'glpiintegaglpi'),
];
$priorityOptions = [
    '' => __('Sem padrão', 'glpiintegaglpi'),
    'low' => __('Baixa', 'glpiintegaglpi'),
    'medium' => __('Média', 'glpiintegaglpi'),
    'high' => __('Alta', 'glpiintegaglpi'),
    'urgent' => __('Urgente', 'glpiintegaglpi'),
];
?>

<div class="d-flex align-items-center justify-content-between gap-3 mb-3">
    <div>
        <h2 class="mb-1"><?= $this->escape(__('Catálogo de Serviços', 'glpiintegaglpi')); ?></h2>
        <div class="text-muted">
            <?= $this->escape(__('Catálogo consultivo por fila/entidade. Não cria ticket, não altera entidade e não gera faturamento.', 'glpiintegaglpi')); ?>
        </div>
    </div>
    <span class="badge bg-secondary"><?= $this->escape(__('Alertas SLA somente visuais', 'glpiintegaglpi')); ?></span>
</div>

<?php if ($flash !== null) : ?>
    <div class="alert alert-<?= $this->escape((string) ($flash['type'] ?? 'info')); ?>">
        <?= $this->escape((string) ($flash['message'] ?? '')); ?>
    </div>
<?php endif; ?>

<?php if ($error !== '') : ?>
    <div class="alert alert-warning"><?= $this->escape($error); ?></div>
<?php endif; ?>

<div class="card mb-3">
    <div class="card-header"><?= $this->escape(__('Filtros', 'glpiintegaglpi')); ?></div>
    <div class="card-body">
        <form method="get" action="<?= $this->escape($this->getServiceCatalogUrl()); ?>">
            <div class="row g-3">
                <div class="col-md-3">
                    <label class="form-label"><?= $this->escape(__('Status', 'glpiintegaglpi')); ?></label>
                    <select class="form-select" name="status">
                        <?php foreach ($statusOptions as $value => $label) : ?>
                            <option value="<?= $this->escape($value); ?>" <?= ((string) ($filters['status'] ?? 'active') === $value) ? 'selected' : ''; ?>>
                                <?= $this->escape($label); ?>
                            </option>
                        <?php endforeach; ?>
                    </select>
                </div>
                <div class="col-md-4">
                    <label class="form-label"><?= $this->escape(__('Fila', 'glpiintegaglpi')); ?></label>
                    <select class="form-select" name="queue_id">
                        <option value="0"><?= $this->escape(__('Todas', 'glpiintegaglpi')); ?></option>
                        <?php foreach ($queues as $queue) : ?>
                            <?php $queueId = (int) ($queue['id'] ?? 0); ?>
                            <option value="<?= $queueId; ?>" <?= ((int) ($filters['queue_id'] ?? 0) === $queueId) ? 'selected' : ''; ?>>
                                <?= $this->escape((string) ($queue['name'] ?? ('#' . $queueId))); ?>
                            </option>
                        <?php endforeach; ?>
                    </select>
                </div>
                <div class="col-md-3 d-flex align-items-end gap-2">
                    <button type="submit" class="btn btn-primary"><?= $this->escape(__('Aplicar', 'glpiintegaglpi')); ?></button>
                    <a class="btn btn-outline-secondary" href="<?= $this->escape($this->getServiceCatalogUrl()); ?>">
                        <?= $this->escape(__('Limpar', 'glpiintegaglpi')); ?>
                    </a>
                </div>
            </div>
        </form>
    </div>
</div>

<?php if ($canUpdate && $error === '') : ?>
    <div class="card mb-3">
        <div class="card-header">
            <?= $serviceForm['id'] > 0
                ? $this->escape(__('Editar serviço', 'glpiintegaglpi'))
                : $this->escape(__('Novo serviço', 'glpiintegaglpi')); ?>
        </div>
        <div class="card-body">
            <form method="post" action="<?= $this->escape($this->getServiceCatalogUrl()); ?>">
                <?= $this->renderCsrfToken(); ?>
                <input type="hidden" name="action" value="save_service">
                <input type="hidden" name="service_id" value="<?= (int) $serviceForm['id']; ?>">
                <div class="row g-3">
                    <div class="col-md-3">
                        <label class="form-label"><?= $this->escape(__('Chave', 'glpiintegaglpi')); ?></label>
                        <input class="form-control" type="text" name="service_key" required value="<?= $this->escape($serviceForm['service_key']); ?>" placeholder="suporte.desktop">
                    </div>
                    <div class="col-md-4">
                        <label class="form-label"><?= $this->escape(__('Nome', 'glpiintegaglpi')); ?></label>
                        <input class="form-control" type="text" name="name" required value="<?= $this->escape($serviceForm['name']); ?>">
                    </div>
                    <div class="col-md-3">
                        <label class="form-label"><?= $this->escape(__('Fila', 'glpiintegaglpi')); ?></label>
                        <select class="form-select" name="routing_queue_id">
                            <option value="0"><?= $this->escape(__('Sem fila fixa', 'glpiintegaglpi')); ?></option>
                            <?php foreach ($queues as $queue) : ?>
                                <?php $queueId = (int) ($queue['id'] ?? 0); ?>
                                <option value="<?= $queueId; ?>" <?= $serviceForm['routing_queue_id'] === $queueId ? 'selected' : ''; ?>>
                                    <?= $this->escape((string) ($queue['name'] ?? ('#' . $queueId))); ?>
                                </option>
                            <?php endforeach; ?>
                        </select>
                    </div>
                    <div class="col-md-2">
                        <label class="form-label"><?= $this->escape(__('Entidade opcional', 'glpiintegaglpi')); ?></label>
                        <input class="form-control" type="number" min="1" name="glpi_entity_id" value="<?= $serviceForm['glpi_entity_id'] > 0 ? (int) $serviceForm['glpi_entity_id'] : ''; ?>">
                    </div>
                    <div class="col-md-5">
                        <label class="form-label"><?= $this->escape(__('Descrição', 'glpiintegaglpi')); ?></label>
                        <input class="form-control" type="text" name="description" value="<?= $this->escape($serviceForm['description']); ?>">
                    </div>
                    <div class="col-md-2">
                        <label class="form-label"><?= $this->escape(__('Prioridade padrão', 'glpiintegaglpi')); ?></label>
                        <select class="form-select" name="default_priority">
                            <?php foreach ($priorityOptions as $value => $label) : ?>
                                <option value="<?= $this->escape($value); ?>" <?= $serviceForm['default_priority'] === $value ? 'selected' : ''; ?>>
                                    <?= $this->escape($label); ?>
                                </option>
                            <?php endforeach; ?>
                        </select>
                    </div>
                    <div class="col-md-2">
                        <label class="form-label"><?= $this->escape(__('SLA resposta min', 'glpiintegaglpi')); ?></label>
                        <input class="form-control" type="number" min="1" name="sla_response_minutes" value="<?= $this->escape($serviceForm['sla_response_minutes']); ?>">
                    </div>
                    <div class="col-md-2">
                        <label class="form-label"><?= $this->escape(__('SLA solução min', 'glpiintegaglpi')); ?></label>
                        <input class="form-control" type="number" min="1" name="sla_solution_minutes" value="<?= $this->escape($serviceForm['sla_solution_minutes']); ?>">
                    </div>
                    <div class="col-md-1 d-flex align-items-end">
                        <label class="form-check">
                            <input type="hidden" name="is_active" value="0">
                            <input class="form-check-input" type="checkbox" name="is_active" value="1" <?= $serviceForm['is_active'] ? 'checked' : ''; ?>>
                            <span class="form-check-label"><?= $this->escape(__('Ativo', 'glpiintegaglpi')); ?></span>
                        </label>
                    </div>
                    <div class="col-12">
                        <label class="form-label"><?= $this->escape(__('Checklist obrigatório JSON', 'glpiintegaglpi')); ?></label>
                        <textarea class="form-control font-monospace" name="required_fields_json" rows="4"><?= $this->escape($serviceForm['required_fields_json']); ?></textarea>
                        <div class="form-text">
                            <?= $this->escape(__('Formato: [{"key":"patrimonio","label":"Patrimônio","required":true}]. O checklist é validado antes de salvar e não altera tickets existentes automaticamente.', 'glpiintegaglpi')); ?>
                        </div>
                    </div>
                    <div class="col-12 d-flex gap-2">
                        <button type="submit" class="btn btn-primary"><?= $this->escape(__('Salvar serviço', 'glpiintegaglpi')); ?></button>
                        <?php if ($serviceForm['id'] > 0) : ?>
                            <a class="btn btn-outline-secondary" href="<?= $this->escape($this->getServiceCatalogUrl()); ?>">
                                <?= $this->escape(__('Cancelar edição', 'glpiintegaglpi')); ?>
                            </a>
                        <?php endif; ?>
                    </div>
                </div>
            </form>
        </div>
    </div>
<?php endif; ?>

<div class="card">
    <div class="card-header d-flex align-items-center justify-content-between">
        <span><?= $this->escape(__('Serviços cadastrados', 'glpiintegaglpi')); ?></span>
        <span class="text-muted small"><?= count($services); ?> <?= $this->escape(__('registro(s)', 'glpiintegaglpi')); ?></span>
    </div>
    <div class="card-body p-0">
        <?php if ($services === []) : ?>
            <div class="p-3 text-muted"><?= $this->escape(__('Nenhum serviço encontrado.', 'glpiintegaglpi')); ?></div>
        <?php else : ?>
            <div class="table-responsive">
                <table class="table table-sm table-hover mb-0">
                    <thead class="table-light">
                        <tr>
                            <th><?= $this->escape(__('Serviço', 'glpiintegaglpi')); ?></th>
                            <th><?= $this->escape(__('Fila/Entidade', 'glpiintegaglpi')); ?></th>
                            <th><?= $this->escape(__('SLA', 'glpiintegaglpi')); ?></th>
                            <th><?= $this->escape(__('Checklist', 'glpiintegaglpi')); ?></th>
                            <th><?= $this->escape(__('Status', 'glpiintegaglpi')); ?></th>
                            <?php if ($canUpdate) : ?>
                                <th><?= $this->escape(__('Ações', 'glpiintegaglpi')); ?></th>
                            <?php endif; ?>
                        </tr>
                    </thead>
                    <tbody>
                        <?php foreach ($services as $service) : ?>
                            <?php $serviceId = (int) ($service['id'] ?? 0); ?>
                            <tr>
                                <td>
                                    <div class="fw-bold"><?= $this->escape((string) ($service['name'] ?? '-')); ?></div>
                                    <div class="text-muted small"><?= $this->escape((string) ($service['service_key'] ?? '')); ?></div>
                                    <div class="small"><?= $this->escape((string) ($service['description'] ?? '')); ?></div>
                                </td>
                                <td>
                                    <div><?= $this->escape((string) ($service['queue_name'] ?? __('Sem fila fixa', 'glpiintegaglpi'))); ?></div>
                                    <div class="text-muted small">
                                        <?= $this->escape(__('Entidade:', 'glpiintegaglpi')); ?>
                                        <?= ((int) ($service['glpi_entity_id'] ?? 0) > 0) ? (int) $service['glpi_entity_id'] : $this->escape(__('qualquer', 'glpiintegaglpi')); ?>
                                    </div>
                                </td>
                                <td>
                                    <div><?= $this->escape(__('Resposta:', 'glpiintegaglpi')); ?> <?= (int) ($service['sla_response_minutes'] ?? 0) ?: '-'; ?> min</div>
                                    <div><?= $this->escape(__('Solução:', 'glpiintegaglpi')); ?> <?= (int) ($service['sla_solution_minutes'] ?? 0) ?: '-'; ?> min</div>
                                    <div class="text-muted small"><?= $this->escape(__('Prioridade:', 'glpiintegaglpi')); ?> <?= $this->escape((string) ($service['default_priority'] ?? '-')); ?></div>
                                </td>
                                <td><code><?= $this->escape((string) ($service['required_fields_json'] ?? '[]')); ?></code></td>
                                <td>
                                    <span class="badge bg-<?= ((bool) ($service['is_active'] ?? false)) ? 'success' : 'secondary'; ?>">
                                        <?= ((bool) ($service['is_active'] ?? false)) ? $this->escape(__('Ativo', 'glpiintegaglpi')) : $this->escape(__('Inativo', 'glpiintegaglpi')); ?>
                                    </span>
                                </td>
                                <?php if ($canUpdate) : ?>
                                    <td>
                                        <a class="small me-2" href="<?= $this->escape($this->getEditUrl($filters, $serviceId)); ?>">
                                            <?= $this->escape(__('Editar', 'glpiintegaglpi')); ?>
                                        </a>
                                        <form method="post" action="<?= $this->escape($this->getServiceCatalogUrl()); ?>" class="d-inline">
                                            <?= $this->renderCsrfToken(); ?>
                                            <input type="hidden" name="service_id" value="<?= $serviceId; ?>">
                                            <input type="hidden" name="action" value="<?= ((bool) ($service['is_active'] ?? false)) ? 'disable_service' : 'enable_service'; ?>">
                                            <button type="submit" class="btn btn-link btn-sm p-0">
                                                <?= ((bool) ($service['is_active'] ?? false)) ? $this->escape(__('Desativar', 'glpiintegaglpi')) : $this->escape(__('Reativar', 'glpiintegaglpi')); ?>
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
</div>
