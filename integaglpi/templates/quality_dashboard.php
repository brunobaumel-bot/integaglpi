<?php

declare(strict_types=1);

/** @var \GlpiPlugin\Integaglpi\Renderer\QualityDashboardRenderer $this */
/** @var array<string, mixed> $data */

$filters = is_array($data['filters'] ?? null) ? $data['filters'] : [];
$kpis = is_array($data['kpis'] ?? null) ? $data['kpis'] : [];
$breakdowns = is_array($data['breakdowns'] ?? null) ? $data['breakdowns'] : [];
$rows = is_array($data['rows'] ?? null) ? $data['rows'] : [];
$pagination = is_array($data['pagination'] ?? null) ? $data['pagination'] : [];
$entityOptions = is_array($data['entity_options'] ?? null) ? $data['entity_options'] : [];
$reopenReasons = is_array($breakdowns['reopen_reasons'] ?? null) ? $breakdowns['reopen_reasons'] : [];
$inactivityRows = is_array($breakdowns['inactivity'] ?? null) ? $breakdowns['inactivity'] : [];
$contractRows = is_array($breakdowns['contracts_hours'] ?? null) ? $breakdowns['contracts_hours'] : [];
$error = trim((string) ($data['error'] ?? ''));
$dateRangeError = trim((string) ($data['date_range_error'] ?? ''));
$cacheStatus = (string) ($data['cache_status'] ?? '');
$entityScopeLabel = (string) ($data['entity_scope_label'] ?? '');
$page = (int) ($pagination['page'] ?? 1);
$limit = (int) ($pagination['limit'] ?? 25);
$total = (int) ($pagination['total'] ?? 0);
$totalPages = (int) ($pagination['total_pages'] ?? 1);

$cards = [
    ['label' => __('Conversas', 'glpiintegaglpi'), 'value' => (int) ($kpis['total_conversations'] ?? 0), 'class' => 'primary'],
    ['label' => __('Tickets criados', 'glpiintegaglpi'), 'value' => (int) ($kpis['total_tickets_created'] ?? 0), 'class' => 'info'],
    ['label' => __('Abertos', 'glpiintegaglpi'), 'value' => (int) ($kpis['tickets_open'] ?? 0), 'class' => 'info'],
    ['label' => __('Solucionados', 'glpiintegaglpi'), 'value' => (int) ($kpis['tickets_solved'] ?? 0), 'class' => 'success'],
    ['label' => __('Fechados', 'glpiintegaglpi'), 'value' => (int) ($kpis['tickets_closed'] ?? 0), 'class' => 'secondary'],
    ['label' => __('Reabertos', 'glpiintegaglpi'), 'value' => (int) ($kpis['tickets_reopened'] ?? 0), 'class' => 'warning'],
    ['label' => __('Autoclose', 'glpiintegaglpi'), 'value' => (int) ($kpis['tickets_closed_by_inactivity'] ?? 0), 'class' => 'dark'],
    ['label' => __('SLA risco', 'glpiintegaglpi'), 'value' => (int) ($kpis['sla_risk'] ?? 0), 'class' => 'warning'],
    ['label' => __('SLA violado', 'glpiintegaglpi'), 'value' => (int) ($kpis['sla_violated'] ?? 0), 'class' => 'danger'],
    ['label' => __('Meta falhou', 'glpiintegaglpi'), 'value' => (int) ($kpis['messages_failed'] ?? 0), 'class' => 'danger'],
    ['label' => __('Reminders', 'glpiintegaglpi'), 'value' => (int) ($kpis['inactivity_reminders_sent'] ?? 0), 'class' => 'secondary'],
    ['label' => __('Contrato alerta', 'glpiintegaglpi'), 'value' => (int) ($kpis['contracts_hours_alerts'] ?? 0), 'class' => 'warning'],
];

$statusOptions = [
    '' => __('Todos', 'glpiintegaglpi'),
    'open' => __('Aberto', 'glpiintegaglpi'),
    'closed' => __('Fechado', 'glpiintegaglpi'),
    'awaiting_entity_selection' => __('Aguardando entidade', 'glpiintegaglpi'),
    'collecting_contact_profile' => __('Coletando perfil', 'glpiintegaglpi'),
    'awaiting_queue_selection' => __('Aguardando fila', 'glpiintegaglpi'),
    'media_error' => __('Erro de mídia', 'glpiintegaglpi'),
];
$csatOptions = [
    '' => __('Todos', 'glpiintegaglpi'),
    'very_satisfied' => __('Muito satisfeito', 'glpiintegaglpi'),
    'satisfied' => __('Satisfeito', 'glpiintegaglpi'),
    'neutral' => __('Neutro', 'glpiintegaglpi'),
    'dissatisfied' => __('Insatisfeito', 'glpiintegaglpi'),
    'very_dissatisfied' => __('Muito insatisfeito', 'glpiintegaglpi'),
    'sem_resposta' => __('Sem resposta', 'glpiintegaglpi'),
];
$slaOptions = ['' => __('Todos', 'glpiintegaglpi'), 'ok' => 'OK', 'risk' => __('Em risco', 'glpiintegaglpi'), 'violated' => __('Violado', 'glpiintegaglpi')];
$deliveryOptions = ['' => __('Todos', 'glpiintegaglpi'), 'pending' => __('Pendente', 'glpiintegaglpi'), 'sent' => __('Enviada', 'glpiintegaglpi'), 'delivered' => __('Entregue', 'glpiintegaglpi'), 'read' => __('Lida', 'glpiintegaglpi'), 'failed' => __('Falhou', 'glpiintegaglpi')];
$inactivityOptions = ['' => __('Todos', 'glpiintegaglpi'), 'pending' => __('Pendente', 'glpiintegaglpi'), 'reminder_1_sent' => 'Reminder 1', 'reminder_2_sent' => 'Reminder 2', 'reminder_3_sent' => 'Reminder 3', 'autoclose_done' => 'Autoclose', 'failed' => __('Falhou', 'glpiintegaglpi')];
?>

<div class="d-flex align-items-center justify-content-between gap-3 mb-3">
    <div>
        <h2 class="mb-1"><?= $this->escape(__('Dashboard de Qualidade WhatsApp', 'glpiintegaglpi')); ?></h2>
        <div class="text-muted">
            <?= $this->escape(__('Métricas read-only de atendimento, CSAT, delivery, inatividade, contratos e IA Supervisora.', 'glpiintegaglpi')); ?>
        </div>
    </div>
    <div class="d-flex align-items-center gap-2">
        <a class="btn btn-outline-secondary" href="<?= $this->escape($this->getConsoleUrl($filters)); ?>">
            <?= $this->escape(__('Abrir Console filtrado', 'glpiintegaglpi')); ?>
        </a>
        <span class="badge bg-secondary"><?= $this->escape($entityScopeLabel); ?></span>
        <span class="badge bg-light text-dark">cache: <?= $this->escape($cacheStatus !== '' ? $cacheStatus : 'n/a'); ?></span>
    </div>
</div>

<?php if ($dateRangeError !== '') : ?>
    <div class="alert alert-warning"><?= $this->escape($dateRangeError); ?></div>
<?php endif; ?>
<?php if ($error !== '') : ?>
    <div class="alert alert-warning"><?= $this->escape($error); ?></div>
<?php endif; ?>

<div class="card mb-3">
    <div class="card-header"><?= $this->escape(__('Filtros', 'glpiintegaglpi')); ?></div>
    <div class="card-body">
        <form method="get" action="<?= $this->escape($this->getQualityDashboardUrl()); ?>">
            <div class="row g-3">
                <div class="col-md-2">
                    <label class="form-label"><?= $this->escape(__('De', 'glpiintegaglpi')); ?></label>
                    <input class="form-control" type="date" name="date_from" required value="<?= $this->escape((string) ($filters['date_from'] ?? '')); ?>">
                </div>
                <div class="col-md-2">
                    <label class="form-label"><?= $this->escape(__('Até', 'glpiintegaglpi')); ?></label>
                    <input class="form-control" type="date" name="date_to" required value="<?= $this->escape((string) ($filters['date_to'] ?? '')); ?>">
                </div>
                <div class="col-md-3">
                    <label class="form-label"><?= $this->escape(__('Entidade', 'glpiintegaglpi')); ?></label>
                    <select class="form-select" name="entity_id">
                        <option value=""><?= $this->escape(__('Todas permitidas', 'glpiintegaglpi')); ?></option>
                        <?php foreach ($entityOptions as $entity) : ?>
                            <?php $entityId = (int) ($entity['id'] ?? 0); ?>
                            <option value="<?= $entityId; ?>" <?= ((int) ($filters['entity_id'] ?? 0) === $entityId) ? 'selected' : ''; ?>>
                                <?= $this->escape((string) ($entity['name'] ?? '')); ?>
                            </option>
                        <?php endforeach; ?>
                    </select>
                </div>
                <div class="col-md-2">
                    <label class="form-label"><?= $this->escape(__('Fila ID', 'glpiintegaglpi')); ?></label>
                    <input class="form-control" type="number" min="1" name="queue_id" value="<?= (int) ($filters['queue_id'] ?? 0) ?: ''; ?>">
                </div>
                <div class="col-md-2">
                    <label class="form-label"><?= $this->escape(__('Técnico ID', 'glpiintegaglpi')); ?></label>
                    <input class="form-control" type="number" min="1" name="technician_id" value="<?= (int) ($filters['technician_id'] ?? 0) ?: ''; ?>">
                </div>
                <div class="col-md-2">
                    <label class="form-label"><?= $this->escape(__('Status', 'glpiintegaglpi')); ?></label>
                    <select class="form-select" name="status">
                        <?php foreach ($statusOptions as $value => $label) : ?>
                            <option value="<?= $this->escape($value); ?>" <?= ((string) ($filters['status'] ?? '') === $value) ? 'selected' : ''; ?>><?= $this->escape($label); ?></option>
                        <?php endforeach; ?>
                    </select>
                </div>
                <div class="col-md-2">
                    <label class="form-label">CSAT</label>
                    <select class="form-select" name="csat">
                        <?php foreach ($csatOptions as $value => $label) : ?>
                            <option value="<?= $this->escape($value); ?>" <?= ((string) ($filters['csat'] ?? '') === $value) ? 'selected' : ''; ?>><?= $this->escape($label); ?></option>
                        <?php endforeach; ?>
                    </select>
                </div>
                <div class="col-md-2">
                    <label class="form-label">SLA</label>
                    <select class="form-select" name="sla">
                        <?php foreach ($slaOptions as $value => $label) : ?>
                            <option value="<?= $this->escape($value); ?>" <?= ((string) ($filters['sla'] ?? '') === $value) ? 'selected' : ''; ?>><?= $this->escape($label); ?></option>
                        <?php endforeach; ?>
                    </select>
                </div>
                <div class="col-md-2">
                    <label class="form-label"><?= $this->escape(__('Delivery', 'glpiintegaglpi')); ?></label>
                    <select class="form-select" name="delivery_status">
                        <?php foreach ($deliveryOptions as $value => $label) : ?>
                            <option value="<?= $this->escape($value); ?>" <?= ((string) ($filters['delivery_status'] ?? '') === $value) ? 'selected' : ''; ?>><?= $this->escape($label); ?></option>
                        <?php endforeach; ?>
                    </select>
                </div>
                <div class="col-md-2">
                    <label class="form-label"><?= $this->escape(__('Inatividade', 'glpiintegaglpi')); ?></label>
                    <select class="form-select" name="inactivity">
                        <?php foreach ($inactivityOptions as $value => $label) : ?>
                            <option value="<?= $this->escape($value); ?>" <?= ((string) ($filters['inactivity'] ?? '') === $value) ? 'selected' : ''; ?>><?= $this->escape($label); ?></option>
                        <?php endforeach; ?>
                    </select>
                </div>
                <div class="col-md-2">
                    <label class="form-label"><?= $this->escape(__('Por página', 'glpiintegaglpi')); ?></label>
                    <select class="form-select" name="limit">
                        <?php foreach ([25, 50] as $option) : ?>
                            <option value="<?= $option; ?>" <?= ((int) ($filters['limit'] ?? 25) === $option) ? 'selected' : ''; ?>><?= $option; ?></option>
                        <?php endforeach; ?>
                    </select>
                </div>
                <div class="col-md-3 d-flex align-items-end gap-2">
                    <button type="submit" class="btn btn-primary"><?= $this->escape(__('Aplicar', 'glpiintegaglpi')); ?></button>
                    <a class="btn btn-outline-secondary" href="<?= $this->escape($this->getQualityDashboardUrl()); ?>"><?= $this->escape(__('Limpar', 'glpiintegaglpi')); ?></a>
                </div>
            </div>
            <div class="form-text mt-2">
                <?= $this->escape(__('Período obrigatório. Limite máximo: 30 dias. Consultas usam cache Redis por filtros e escopo.', 'glpiintegaglpi')); ?>
            </div>
        </form>
    </div>
</div>

<div class="row g-3 mb-3">
    <div class="col-lg-4">
        <div class="card h-100">
            <div class="card-header"><?= $this->escape(__('Reaberturas por motivo', 'glpiintegaglpi')); ?></div>
            <div class="card-body">
                <?php if ($reopenReasons === []) : ?>
                    <div class="text-muted small"><?= $this->escape(__('Sem reaberturas no período filtrado.', 'glpiintegaglpi')); ?></div>
                <?php else : ?>
                    <?php foreach ($reopenReasons as $row) : ?>
                        <div class="d-flex justify-content-between">
                            <span><?= $this->escape((string) ($row['reason_label'] ?? $row['reason_key'] ?? '')); ?></span>
                            <strong><?= (int) ($row['total'] ?? 0); ?></strong>
                        </div>
                    <?php endforeach; ?>
                <?php endif; ?>
            </div>
        </div>
    </div>
    <div class="col-lg-4">
        <div class="card h-100">
            <div class="card-header"><?= $this->escape(__('Inatividade e autoclose', 'glpiintegaglpi')); ?></div>
            <div class="card-body">
                <?php if ($inactivityRows === []) : ?>
                    <div class="text-muted small"><?= $this->escape(__('Sem eventos de inatividade no período.', 'glpiintegaglpi')); ?></div>
                <?php else : ?>
                    <?php foreach (array_slice($inactivityRows, 0, 8) as $row) : ?>
                        <div class="d-flex justify-content-between">
                            <span><?= $this->escape(trim((string) ($row['event_key'] ?? '') . ' ' . (string) ($row['status'] ?? ''))); ?></span>
                            <strong><?= (int) ($row['total'] ?? 0); ?></strong>
                        </div>
                    <?php endforeach; ?>
                <?php endif; ?>
            </div>
        </div>
    </div>
    <div class="col-lg-4">
        <div class="card h-100">
            <div class="card-header"><?= $this->escape(__('Contratos em alerta', 'glpiintegaglpi')); ?></div>
            <div class="card-body">
                <?php if ($contractRows === []) : ?>
                    <div class="text-muted small"><?= $this->escape(__('Sem alertas de contrato no período.', 'glpiintegaglpi')); ?></div>
                <?php else : ?>
                    <?php foreach (array_slice($contractRows, 0, 8) as $row) : ?>
                        <div class="d-flex justify-content-between">
                            <span><?= $this->escape((string) ($row['glpi_entity_name'] ?? $row['glpi_entity_id'] ?? '')); ?></span>
                            <strong><?= $this->escape((string) ($row['usage_percent'] ?? '0')); ?>%</strong>
                        </div>
                    <?php endforeach; ?>
                <?php endif; ?>
            </div>
        </div>
    </div>
</div>

<div class="row g-3 mb-3">
    <?php foreach ($cards as $card) : ?>
        <div class="col-md-3 col-xl-2">
            <div class="border rounded p-3 h-100">
                <div class="text-muted small mb-1"><?= $this->escape((string) $card['label']); ?></div>
                <div class="fs-3 fw-bold text-<?= $this->escape((string) $card['class']); ?>"><?= (int) $card['value']; ?></div>
            </div>
        </div>
    <?php endforeach; ?>
</div>

<div class="row g-3 mb-3">
    <div class="col-lg-4">
        <div class="card h-100">
            <div class="card-header">CSAT</div>
            <div class="card-body">
                <div class="mb-2"><?= $this->escape(__('Média', 'glpiintegaglpi')); ?>: <strong><?= $this->escape((string) ($kpis['csat_average'] ?? 'n/a')); ?></strong></div>
                <?php foreach ((array) ($breakdowns['csat'] ?? []) as $row) : ?>
                    <div class="d-flex justify-content-between"><span><?= $this->escape((string) ($row['csat_rating'] ?? '')); ?></span><strong><?= (int) ($row['total'] ?? 0); ?></strong></div>
                <?php endforeach; ?>
            </div>
        </div>
    </div>
    <div class="col-lg-4">
        <div class="card h-100">
            <div class="card-header"><?= $this->escape(__('Delivery e Meta', 'glpiintegaglpi')); ?></div>
            <div class="card-body">
                <?php foreach ((array) ($breakdowns['delivery_status'] ?? []) as $row) : ?>
                    <div class="d-flex justify-content-between"><span><?= $this->escape((string) ($row['status'] ?? '')); ?></span><strong><?= (int) ($row['total'] ?? 0); ?></strong></div>
                <?php endforeach; ?>
            </div>
        </div>
    </div>
    <div class="col-lg-4">
        <div class="card h-100">
            <div class="card-header"><?= $this->escape(__('IA Supervisora e Contratos', 'glpiintegaglpi')); ?></div>
            <div class="card-body">
                <?php foreach ((array) ($breakdowns['ai_flags'] ?? []) as $row) : ?>
                    <div class="d-flex justify-content-between"><span><?= $this->escape((string) ($row['flag'] ?? '')); ?></span><strong><?= (int) ($row['total'] ?? 0); ?></strong></div>
                <?php endforeach; ?>
                <?php foreach ((array) ($breakdowns['ai_feedback'] ?? []) as $row) : ?>
                    <div class="d-flex justify-content-between small text-muted"><span><?= $this->escape((string) ($row['supervisor_feedback'] ?? '')); ?></span><strong><?= (int) ($row['total'] ?? 0); ?></strong></div>
                <?php endforeach; ?>
                <?php if ((array) ($breakdowns['ai_flags'] ?? []) === []) : ?>
                    <div class="text-muted small"><?= $this->escape(__('Sem flags IA no período.', 'glpiintegaglpi')); ?></div>
                <?php endif; ?>
            </div>
        </div>
    </div>
</div>

<div class="card mb-3">
    <div class="card-header d-flex justify-content-between">
        <span><?= $this->escape(__('Atendimentos em atenção', 'glpiintegaglpi')); ?></span>
        <span class="text-muted small"><?= $total; ?> <?= $this->escape(__('registro(s)', 'glpiintegaglpi')); ?></span>
    </div>
    <div class="card-body p-0">
        <?php if ($rows === []) : ?>
            <div class="p-3 text-muted"><?= $this->escape(__('Sem registros no período filtrado.', 'glpiintegaglpi')); ?></div>
        <?php else : ?>
            <div class="table-responsive">
                <table class="table table-sm table-hover mb-0">
                    <thead class="table-light">
                        <tr>
                            <th><?= $this->escape(__('Contato', 'glpiintegaglpi')); ?></th>
                            <th><?= $this->escape(__('Ticket', 'glpiintegaglpi')); ?></th>
                            <th><?= $this->escape(__('Entidade', 'glpiintegaglpi')); ?></th>
                            <th><?= $this->escape(__('Fila/Técnico', 'glpiintegaglpi')); ?></th>
                            <th><?= $this->escape(__('Status', 'glpiintegaglpi')); ?></th>
                            <th>SLA</th>
                            <th><?= $this->escape(__('Delivery', 'glpiintegaglpi')); ?></th>
                            <th><?= $this->escape(__('Inatividade', 'glpiintegaglpi')); ?></th>
                            <th><?= $this->escape(__('IA', 'glpiintegaglpi')); ?></th>
                            <th><?= $this->escape(__('Última interação', 'glpiintegaglpi')); ?></th>
                        </tr>
                    </thead>
                    <tbody>
                        <?php foreach ($rows as $row) : ?>
                            <?php $ticketId = (int) ($row['glpi_ticket_id'] ?? 0); ?>
                            <tr>
                                <td><?= $this->escape((string) ($row['masked_phone'] ?? '')); ?></td>
                                <td>
                                    <?php if ($ticketId > 0) : ?>
                                        <a href="<?= $this->escape($this->getTicketUrl($ticketId)); ?>" target="_blank" rel="noopener noreferrer">#<?= $ticketId; ?></a>
                                    <?php else : ?>
                                        <span class="text-muted"><?= $this->escape(__('Pré-ticket', 'glpiintegaglpi')); ?></span>
                                    <?php endif; ?>
                                </td>
                                <td>
                                    <div><?= $this->escape((string) ($row['entity_name'] ?? '-')); ?></div>
                                    <div class="text-muted small">ID <?= (int) ($row['entity_id'] ?? 0); ?></div>
                                </td>
                                <td>
                                    <div><?= $this->escape((string) ($row['queue_name'] ?? '-')); ?></div>
                                    <div class="text-muted small"><?= $this->escape((string) ($row['assigned_user_name'] ?? '-')); ?></div>
                                </td>
                                <td><?= $this->escape((string) ($row['status_label'] ?? '')); ?></td>
                                <td><?= $this->escape((string) ($row['sla_label'] ?? '')); ?></td>
                                <td><?= $this->escape((string) ($row['last_delivery_status'] ?? '')); ?></td>
                                <td><?= $this->escape((string) ($row['inactivity_status'] ?? '')); ?></td>
                                <td>
                                    <div><?= $this->escape((string) ($row['ai_sentiment'] ?? '')); ?> <?= $this->escape((string) ($row['ai_status'] ?? '')); ?></div>
                                    <div class="small"><?= $this->escape((string) ($row['ai_supervisor_feedback'] ?? '')); ?></div>
                                    <div class="text-muted small"><?= $this->escape(mb_substr((string) json_encode($row['ai_flags'] ?? [], JSON_UNESCAPED_UNICODE), 0, 80)); ?></div>
                                    <div class="text-muted small"><?= $this->escape(mb_substr((string) ($row['ai_recommendation'] ?? ''), 0, 100)); ?></div>
                                </td>
                                <td>
                                    <div><?= $this->escape((string) ($row['last_message_at'] ?? '')); ?></div>
                                </td>
                            </tr>
                        <?php endforeach; ?>
                    </tbody>
                </table>
            </div>
        <?php endif; ?>
    </div>
    <div class="card-footer d-flex justify-content-between align-items-center">
        <span class="text-muted small"><?= $this->escape(__('Página', 'glpiintegaglpi')); ?> <?= $page; ?> / <?= max(1, $totalPages); ?> · <?= $limit; ?> <?= $this->escape(__('por página', 'glpiintegaglpi')); ?></span>
        <div class="btn-group">
            <a class="btn btn-outline-secondary btn-sm <?= $page > 1 ? '' : 'disabled'; ?>" href="<?= $this->escape($this->getPageUrl($filters, max(1, $page - 1))); ?>"><?= $this->escape(__('Anterior', 'glpiintegaglpi')); ?></a>
            <a class="btn btn-outline-secondary btn-sm <?= $page < $totalPages ? '' : 'disabled'; ?>" href="<?= $this->escape($this->getPageUrl($filters, $page + 1)); ?>"><?= $this->escape(__('Próxima', 'glpiintegaglpi')); ?></a>
        </div>
    </div>
</div>

<div class="alert alert-info">
    <?= $this->escape(__('Dashboard read-only: não chama IA/Ollama, não envia WhatsApp, não altera tickets, contratos ou regras de inatividade. Exportação CSV permanece bloqueada neste MVP até gate de permissão/auditoria dedicado.', 'glpiintegaglpi')); ?>
</div>
