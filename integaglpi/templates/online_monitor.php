<?php

declare(strict_types=1);

/** @var \GlpiPlugin\Integaglpi\Renderer\OnlineMonitorRenderer $this */
/** @var array<string, mixed> $data */
/** @var array<string, mixed> $alertData */
/** @var array<string, int> $alertBadgeCounts */

$filters = is_array($data['filters'] ?? null) ? $data['filters'] : [];
$kpis = is_array($data['kpis'] ?? null) ? $data['kpis'] : [];
$rows = is_array($data['rows'] ?? null) ? $data['rows'] : [];
$options = is_array($data['options'] ?? null) ? $data['options'] : [];
$page = (int) ($data['page'] ?? 1);
$limit = (int) ($data['limit'] ?? 50);
$hasNext = (bool) ($data['has_next'] ?? false);
$hasPrevious = (bool) ($data['has_previous'] ?? false);
$lastUpdatedAt = (string) ($data['last_updated_at'] ?? '');
$error = trim((string) ($data['error'] ?? ''));
$supervisor = (bool) ($data['supervisor'] ?? false);
$alertData = is_array($alertData ?? null) ? $alertData : ['visible' => false, 'rows' => [], 'filters' => [], 'options' => [], 'error' => ''];
$alertRows = is_array($alertData['rows'] ?? null) ? $alertData['rows'] : [];
$alertFilters = is_array($alertData['filters'] ?? null) ? $alertData['filters'] : [];
$alertOptions = is_array($alertData['options'] ?? null) ? $alertData['options'] : [];
$alertError = trim((string) ($alertData['error'] ?? ''));
$alertVisible = (bool) ($alertData['visible'] ?? false);
$alertBadgeCounts = is_array($alertBadgeCounts ?? null) ? $alertBadgeCounts : [];

$queues = is_array($options['queues'] ?? null) ? $options['queues'] : [];
$technicians = is_array($options['technicians'] ?? null) ? $options['technicians'] : [];
$entities = is_array($options['entities'] ?? null) ? $options['entities'] : [];
$conversationStatuses = is_array($options['conversation_statuses'] ?? null) ? $options['conversation_statuses'] : [];
$ticketStatuses = is_array($options['ticket_statuses'] ?? null) ? $options['ticket_statuses'] : [];

$views = [
    'all' => __('Fila geral', 'glpiintegaglpi'),
    'mine' => __('Meus', 'glpiintegaglpi'),
    'pending_technician' => __('Aguardando técnico', 'glpiintegaglpi'),
    'pending_customer' => __('Aguardando cliente', 'glpiintegaglpi'),
    'pre_ticket' => __('Pré-ticket', 'glpiintegaglpi'),
    'awaiting_entity' => __('Entidade pendente', 'glpiintegaglpi'),
    'failures' => __('Falhas', 'glpiintegaglpi'),
    'tickets_open' => __('Abertos WhatsApp', 'glpiintegaglpi'),
    'tickets_solved_recent' => __('Solucionados', 'glpiintegaglpi'),
];

$ticketStatusQuickOptions = [
    'active' => __('Ativos', 'glpiintegaglpi'),
    'new' => __('Novo', 'glpiintegaglpi'),
    'processing' => __('Em atendimento', 'glpiintegaglpi'),
    'pending' => __('Pendente', 'glpiintegaglpi'),
    'solved' => __('Solucionado', 'glpiintegaglpi'),
    'closed' => __('Fechado', 'glpiintegaglpi'),
    'without_ticket' => __('Sem ticket', 'glpiintegaglpi'),
    'all' => __('Todos', 'glpiintegaglpi'),
];
$advancedFilterActive = ((int) ($filters['queue_id'] ?? 0) > 0)
    || ((int) ($filters['technician_id'] ?? 0) > 0)
    || ((int) ($filters['entity_id'] ?? 0) > 0)
    || ((string) ($filters['conversation_status'] ?? '') !== '')
    || ((int) ($filters['ticket_status'] ?? 0) > 0)
    || ((string) ($filters['waiting'] ?? '') !== '')
    || ((string) ($filters['ticket_link'] ?? '') !== '')
    || ((string) ($filters['search'] ?? '') !== '')
    || ((string) ($filters['order_by'] ?? 'stalled_time') !== 'stalled_time')
    || ((int) ($filters['limit'] ?? 50) !== 50);

$waitingOptions = [
    '' => __('Todos', 'glpiintegaglpi'),
    'technician' => __('Aguardando técnico', 'glpiintegaglpi'),
    'customer' => __('Aguardando cliente', 'glpiintegaglpi'),
];
$ticketLinkOptions = [
    '' => __('Com ou sem ticket', 'glpiintegaglpi'),
    'with_ticket' => __('Com ticket', 'glpiintegaglpi'),
    'without_ticket' => __('Sem ticket', 'glpiintegaglpi'),
];
$orderOptions = [
    'stalled_time' => __('Tempo parado', 'glpiintegaglpi'),
    'updated_at' => __('Atualização recente', 'glpiintegaglpi'),
];

$kpiCards = [
    ['label' => __('Conversas abertas', 'glpiintegaglpi'), 'value' => (int) ($kpis['open_conversations'] ?? 0), 'class' => 'primary'],
    ['label' => __('Aguardando técnico', 'glpiintegaglpi'), 'value' => (int) ($kpis['waiting_technician'] ?? 0), 'class' => 'warning'],
    ['label' => __('Aguardando cliente', 'glpiintegaglpi'), 'value' => (int) ($kpis['waiting_customer'] ?? 0), 'class' => 'info'],
    ['label' => __('Falhas 24h', 'glpiintegaglpi'), 'value' => (int) ($kpis['failures_24h'] ?? 0), 'class' => 'danger'],
    ['label' => __('Pré-ticket / entidade', 'glpiintegaglpi'), 'value' => (int) ($kpis['pre_ticket_or_entity'] ?? 0), 'class' => 'secondary'],
];

$activeTab = (string) ($_GET['tab'] ?? 'monitor');
if (!in_array($activeTab, ['monitor', 'ai_alerts'], true)) {
    $activeTab = 'monitor';
}
?>

<div class="d-flex flex-wrap align-items-start justify-content-between gap-3 mb-3">
    <div>
        <h2 class="mb-1"><?= $this->escape(__('Monitor Online WhatsApp', 'glpiintegaglpi')); ?></h2>
        <div class="text-muted">
            <?= $this->escape(__('Visão operacional somente leitura. Nenhum WhatsApp é enviado e nenhum ticket é alterado por esta tela.', 'glpiintegaglpi')); ?>
        </div>
    </div>
    <div class="d-flex flex-wrap align-items-center gap-2">
        <span class="badge bg-secondary">
            <?= $this->escape($supervisor ? __('Supervisor', 'glpiintegaglpi') : __('Técnico', 'glpiintegaglpi')); ?>
        </span>
        <span class="text-muted small">
            <?= $this->escape(__('Última atualização:', 'glpiintegaglpi') . ' ' . $lastUpdatedAt); ?>
        </span>
        <a class="btn btn-outline-primary" href="<?= $this->escape($this->getPageUrl($filters, $page)); ?>">
            <?= $this->escape(__('Atualizar agora', 'glpiintegaglpi')); ?>
        </a>
        <label class="form-check form-switch mb-0">
            <input class="form-check-input" type="checkbox" id="integaglpi-online-auto-refresh">
            <span class="form-check-label"><?= $this->escape(__('Auto-atualizar 20s', 'glpiintegaglpi')); ?></span>
        </label>
    </div>
</div>

<?php if ($error !== '') : ?>
    <div class="alert alert-warning"><?= $this->escape($error); ?></div>
<?php endif; ?>

<ul class="nav nav-tabs mb-3">
    <li class="nav-item">
        <a class="nav-link <?= $activeTab === 'monitor' ? 'active' : ''; ?>" href="<?= $this->escape($this->getPageUrl(array_merge($filters, ['tab' => 'monitor']), $page)); ?>">
            <?= $this->escape(__('Monitor operacional', 'glpiintegaglpi')); ?>
        </a>
    </li>
    <?php if ($alertVisible) : ?>
        <li class="nav-item">
            <a class="nav-link <?= $activeTab === 'ai_alerts' ? 'active' : ''; ?>" href="<?= $this->escape($this->getPageUrl(array_merge($filters, ['tab' => 'ai_alerts']), $page)); ?>">
                <?= $this->escape(__('Alertas de IA', 'glpiintegaglpi')); ?>
                <?php if ($alertRows !== []) : ?>
                    <span class="badge bg-warning text-dark ms-1"><?= count($alertRows); ?></span>
                <?php endif; ?>
            </a>
        </li>
    <?php endif; ?>
</ul>

<?php if ($alertVisible) : ?>
    <div class="card mb-3 <?= $activeTab === 'ai_alerts' ? '' : 'd-none'; ?>">
        <div class="card-header d-flex align-items-center justify-content-between">
            <span><?= $this->escape(__('Alertas de IA', 'glpiintegaglpi')); ?></span>
            <span class="badge bg-secondary"><?= $this->escape(__('revisão humana obrigatória', 'glpiintegaglpi')); ?></span>
        </div>
        <div class="card-body">
            <div class="alert alert-info">
                <?= $this->escape(__('Alertas gerados por IA são sinais de apoio à supervisão e melhoria contínua. Não representam decisão disciplinar automática.', 'glpiintegaglpi')); ?>
            </div>
            <?php if ($alertError !== '') : ?>
                <div class="alert alert-warning"><?= $this->escape($alertError); ?></div>
            <?php endif; ?>
            <?php
            $alertTypeOptions = is_array($alertOptions['alert_types'] ?? null) ? $alertOptions['alert_types'] : [];
            $alertSeverityOptions = is_array($alertOptions['severities'] ?? null) ? $alertOptions['severities'] : [];
            $alertStatusOptions = is_array($alertOptions['statuses'] ?? null) ? $alertOptions['statuses'] : [];
            ?>
            <form class="row g-2 mb-3" method="get" action="<?= $this->escape($this->getOnlineMonitorUrl()); ?>">
                <input type="hidden" name="tab" value="ai_alerts">
                <div class="col-md-3">
                    <label class="form-label"><?= $this->escape(__('Severidade', 'glpiintegaglpi')); ?></label>
                    <select class="form-select form-select-sm" name="ai_alert_severity">
                        <?php foreach ($alertSeverityOptions as $value => $label) : ?>
                            <option value="<?= $this->escape((string) $value); ?>" <?= ((string) ($alertFilters['severity'] ?? '') === (string) $value) ? 'selected' : ''; ?>>
                                <?= $this->escape((string) $label); ?>
                            </option>
                        <?php endforeach; ?>
                    </select>
                </div>
                <div class="col-md-3">
                    <label class="form-label"><?= $this->escape(__('Tipo', 'glpiintegaglpi')); ?></label>
                    <select class="form-select form-select-sm" name="ai_alert_type">
                        <option value=""><?= $this->escape(__('Todos', 'glpiintegaglpi')); ?></option>
                        <?php foreach ($alertTypeOptions as $value => $label) : ?>
                            <option value="<?= $this->escape((string) $value); ?>" <?= ((string) ($alertFilters['alert_type'] ?? '') === (string) $value) ? 'selected' : ''; ?>>
                                <?= $this->escape((string) $label); ?>
                            </option>
                        <?php endforeach; ?>
                    </select>
                </div>
                <div class="col-md-2">
                    <label class="form-label"><?= $this->escape(__('Fila ID', 'glpiintegaglpi')); ?></label>
                    <input class="form-control form-control-sm" type="number" min="1" name="ai_alert_queue_id" value="<?= (int) ($alertFilters['queue_id'] ?? 0) ?: ''; ?>">
                </div>
                <div class="col-md-2">
                    <label class="form-label"><?= $this->escape(__('Status', 'glpiintegaglpi')); ?></label>
                    <select class="form-select form-select-sm" name="ai_alert_status">
                        <?php foreach ($alertStatusOptions as $value => $label) : ?>
                            <option value="<?= $this->escape((string) $value); ?>" <?= ((string) ($alertFilters['status'] ?? 'open') === (string) $value) ? 'selected' : ''; ?>>
                                <?= $this->escape((string) $label); ?>
                            </option>
                        <?php endforeach; ?>
                    </select>
                </div>
                <div class="col-md-2 d-flex align-items-end gap-2">
                    <button class="btn btn-sm btn-primary" type="submit"><?= $this->escape(__('Filtrar', 'glpiintegaglpi')); ?></button>
                    <a class="btn btn-sm btn-outline-secondary" href="<?= $this->escape($this->getOnlineMonitorUrl() . '?tab=ai_alerts'); ?>">
                        <?= $this->escape(__('Limpar', 'glpiintegaglpi')); ?>
                    </a>
                </div>
            </form>
            <?php if ($alertRows === []) : ?>
                <div class="text-muted"><?= $this->escape(__('Nenhum alerta de IA para os filtros atuais.', 'glpiintegaglpi')); ?></div>
            <?php else : ?>
                <div class="table-responsive">
                    <table class="table table-sm table-hover align-middle">
                        <thead class="table-light">
                            <tr>
                                <th><?= $this->escape(__('Severidade', 'glpiintegaglpi')); ?></th>
                                <th><?= $this->escape(__('Tipo', 'glpiintegaglpi')); ?></th>
                                <th><?= $this->escape(__('Ticket / Conversa', 'glpiintegaglpi')); ?></th>
                                <th><?= $this->escape(__('Evidência sanitizada', 'glpiintegaglpi')); ?></th>
                                <th><?= $this->escape(__('Ação humana sugerida', 'glpiintegaglpi')); ?></th>
                                <th><?= $this->escape(__('Ações', 'glpiintegaglpi')); ?></th>
                            </tr>
                        </thead>
                        <tbody>
                            <?php foreach ($alertRows as $alert) : ?>
                                <?php
                                $alertId = (string) ($alert['alert_id'] ?? '');
                                $modalId = 'ai-online-alert-' . preg_replace('/[^A-Za-z0-9_-]+/', '-', $alertId);
                                $ticketId = (int) ($alert['glpi_ticket_id'] ?? 0);
                                $severity = (string) ($alert['severity'] ?? 'low');
                                $severityClass = $severity === 'high' ? 'danger' : ($severity === 'medium' ? 'warning text-dark' : 'secondary');
                                ?>
                                <tr>
                                    <td>
                                        <span class="badge bg-<?= $this->escape($severityClass); ?>">
                                            <?= $this->escape($severity); ?> · <?= (int) ($alert['confidence_score'] ?? 0); ?>%
                                        </span>
                                    </td>
                                    <td><?= $this->escape((string) ($alertTypeOptions[(string) ($alert['alert_type'] ?? '')] ?? $alert['alert_type'] ?? '')); ?></td>
                                    <td>
                                        <?php if ($ticketId > 0) : ?>
                                            <a href="<?= $this->escape($this->getTicketUrl($ticketId)); ?>">#<?= $ticketId; ?></a>
                                        <?php else : ?>
                                            <span class="text-muted"><?= $this->escape(__('sem ticket', 'glpiintegaglpi')); ?></span>
                                        <?php endif; ?>
                                        <div class="text-muted small"><?= $this->escape((string) ($alert['conversation_id'] ?? '')); ?></div>
                                    </td>
                                    <td><?= $this->escape((string) ($alert['evidence_summary_sanitized'] ?? '')); ?></td>
                                    <td><?= $this->escape((string) ($alert['recommended_human_action'] ?? '')); ?></td>
                                    <td>
                                        <button class="btn btn-sm btn-outline-primary" type="button" data-bs-toggle="modal" data-bs-target="#<?= $this->escape($modalId); ?>">
                                            <?= $this->escape(__('Detalhes', 'glpiintegaglpi')); ?>
                                        </button>
                                    </td>
                                </tr>
                                <tr class="d-none">
                                    <td colspan="6">
                                        <div class="modal fade" id="<?= $this->escape($modalId); ?>" tabindex="-1" aria-hidden="true">
                                            <div class="modal-dialog modal-lg modal-dialog-scrollable">
                                                <div class="modal-content">
                                                    <div class="modal-header">
                                                        <h5 class="modal-title"><?= $this->escape(__('Detalhe do alerta de IA', 'glpiintegaglpi')); ?></h5>
                                                        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="<?= $this->escape(__('Fechar', 'glpiintegaglpi')); ?>"></button>
                                                    </div>
                                                    <div class="modal-body">
                                                        <div class="alert alert-info">
                                                            <?= $this->escape(__('Este alerta é um apoio supervisório read-only. Revise contexto e evidências antes de orientar qualquer ação humana.', 'glpiintegaglpi')); ?>
                                                        </div>
                                                        <dl class="row">
                                                            <dt class="col-sm-3"><?= $this->escape(__('Tipo', 'glpiintegaglpi')); ?></dt>
                                                            <dd class="col-sm-9"><?= $this->escape((string) ($alert['alert_type'] ?? '')); ?></dd>
                                                            <dt class="col-sm-3"><?= $this->escape(__('Severidade', 'glpiintegaglpi')); ?></dt>
                                                            <dd class="col-sm-9"><?= $this->escape($severity); ?></dd>
                                                            <dt class="col-sm-3"><?= $this->escape(__('Confiança', 'glpiintegaglpi')); ?></dt>
                                                            <dd class="col-sm-9"><?= (int) ($alert['confidence_score'] ?? 0); ?>%</dd>
                                                            <dt class="col-sm-3"><?= $this->escape(__('Evidência', 'glpiintegaglpi')); ?></dt>
                                                            <dd class="col-sm-9"><?= $this->escape((string) ($alert['evidence_summary_sanitized'] ?? '')); ?></dd>
                                                            <dt class="col-sm-3"><?= $this->escape(__('Ação sugerida', 'glpiintegaglpi')); ?></dt>
                                                            <dd class="col-sm-9"><?= $this->escape((string) ($alert['recommended_human_action'] ?? '')); ?></dd>
                                                        </dl>
                                                        <?php $signals = is_array($alert['source_signals_json'] ?? null) ? $alert['source_signals_json'] : []; ?>
                                                        <?php if ($signals !== []) : ?>
                                                            <div class="mb-3">
                                                                <strong><?= $this->escape(__('Sinais de origem', 'glpiintegaglpi')); ?></strong>
                                                                <ul class="mb-0">
                                                                    <?php foreach ($signals as $key => $value) : ?>
                                                                        <li><?= $this->escape((string) $key . ': ' . (is_scalar($value) ? (string) $value : json_encode($value))); ?></li>
                                                                    <?php endforeach; ?>
                                                                </ul>
                                                            </div>
                                                        <?php endif; ?>
                                                        <form method="<?= $this->escape('post'); ?>" action="<?= $this->escape($this->getOnlineMonitorUrl()); ?>">
                                                            <?= $this->renderCsrfToken(); ?>
                                                            <input type="hidden" name="ai_alert_action" value="feedback">
                                                            <input type="hidden" name="alert_id" value="<?= $this->escape($alertId); ?>">
                                                            <div class="mb-2">
                                                                <label class="form-label"><?= $this->escape(__('Feedback do supervisor', 'glpiintegaglpi')); ?></label>
                                                                <select class="form-select" name="feedback_value" required>
                                                                    <option value="useful"><?= $this->escape(__('Útil', 'glpiintegaglpi')); ?></option>
                                                                    <option value="false_positive"><?= $this->escape(__('Falso positivo', 'glpiintegaglpi')); ?></option>
                                                                    <option value="not_applicable"><?= $this->escape(__('Não aplicável', 'glpiintegaglpi')); ?></option>
                                                                    <option value="real_risk"><?= $this->escape(__('Risco real', 'glpiintegaglpi')); ?></option>
                                                                    <option value="dismiss"><?= $this->escape(__('Descartar', 'glpiintegaglpi')); ?></option>
                                                                    <option value="silence_24h"><?= $this->escape(__('Silenciar por 24h', 'glpiintegaglpi')); ?></option>
                                                                </select>
                                                            </div>
                                                            <div class="mb-3">
                                                                <label class="form-label"><?= $this->escape(__('Observação sanitizada', 'glpiintegaglpi')); ?></label>
                                                                <textarea class="form-control" name="feedback_notes" rows="2" maxlength="500"></textarea>
                                                            </div>
                                                            <button class="btn btn-primary" type="submit">
                                                                <?= $this->escape(__('Registrar feedback', 'glpiintegaglpi')); ?>
                                                            </button>
                                                        </form>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </td>
                                </tr>
                            <?php endforeach; ?>
                        </tbody>
                    </table>
                </div>
            <?php endif; ?>
        </div>
    </div>
<?php endif; ?>

<?php if ($activeTab === 'monitor') : ?>
<div class="d-flex flex-wrap gap-2 mb-3">
    <?php foreach ($views as $viewKey => $viewLabel) : ?>
        <?php
        $viewFilters = $filters;
        $viewFilters['view'] = $viewKey;
        $viewFilters['page'] = 1;
        $active = (string) ($filters['view'] ?? '') === $viewKey;
        ?>
        <a class="btn btn-sm <?= $active ? 'btn-primary' : 'btn-outline-secondary'; ?>"
           href="<?= $this->escape($this->getPageUrl($viewFilters, 1)); ?>">
            <?= $this->escape($viewLabel); ?>
        </a>
    <?php endforeach; ?>
</div>

<form class="d-flex flex-wrap align-items-end gap-2 mb-3" method="get" action="<?= $this->escape($this->getOnlineMonitorUrl()); ?>">
    <input type="hidden" name="view" value="<?= $this->escape((string) ($filters['view'] ?? '')); ?>">
    <input type="hidden" name="queue_id" value="<?= (int) ($filters['queue_id'] ?? 0) ?: ''; ?>">
    <input type="hidden" name="technician_id" value="<?= (int) ($filters['technician_id'] ?? 0) ?: ''; ?>">
    <input type="hidden" name="entity_id" value="<?= (int) ($filters['entity_id'] ?? 0) ?: ''; ?>">
    <input type="hidden" name="conversation_status" value="<?= $this->escape((string) ($filters['conversation_status'] ?? '')); ?>">
    <input type="hidden" name="ticket_status" value="<?= (int) ($filters['ticket_status'] ?? 0) ?: ''; ?>">
    <input type="hidden" name="waiting" value="<?= $this->escape((string) ($filters['waiting'] ?? '')); ?>">
    <input type="hidden" name="ticket_link" value="<?= $this->escape((string) ($filters['ticket_link'] ?? '')); ?>">
    <input type="hidden" name="search" value="<?= $this->escape((string) ($filters['search'] ?? '')); ?>">
    <input type="hidden" name="order_by" value="<?= $this->escape((string) ($filters['order_by'] ?? 'stalled_time')); ?>">
    <input type="hidden" name="limit" value="<?= (int) ($filters['limit'] ?? 50); ?>">
    <div>
        <label class="form-label mb-1"><?= $this->escape(__('Status ticket', 'glpiintegaglpi')); ?></label>
        <select class="form-select form-select-sm" name="ticket_status_quick" onchange="this.form.submit()">
            <?php foreach ($ticketStatusQuickOptions as $value => $label) : ?>
                <option value="<?= $this->escape($value); ?>" <?= ((string) ($filters['ticket_status_quick'] ?? 'active') === $value) ? 'selected' : ''; ?>>
                    <?= $this->escape($label); ?>
                </option>
            <?php endforeach; ?>
        </select>
    </div>
    <noscript>
        <button type="submit" class="btn btn-sm btn-outline-primary">
            <?= $this->escape(__('Aplicar', 'glpiintegaglpi')); ?>
        </button>
    </noscript>
    <?php if ($advancedFilterActive) : ?>
        <span class="badge bg-warning text-dark align-self-center">
            <?= $this->escape(__('Filtros avançados ativos', 'glpiintegaglpi')); ?>
        </span>
    <?php endif; ?>
</form>

<div class="row g-3 mb-3">
    <?php foreach ($kpiCards as $card) : ?>
        <div class="col-md-4 col-xl">
            <div class="border rounded p-3 h-100">
                <div class="text-muted small mb-1"><?= $this->escape((string) $card['label']); ?></div>
                <div class="fs-3 fw-bold text-<?= $this->escape((string) $card['class']); ?>">
                    <?= (int) $card['value']; ?>
                </div>
            </div>
        </div>
    <?php endforeach; ?>
</div>

<details class="card mb-3" id="integaglpi-online-advanced-filters">
    <summary class="card-header d-flex align-items-center justify-content-between" style="cursor: pointer;">
        <span><?= $this->escape(__('Filtros avançados', 'glpiintegaglpi')); ?></span>
        <?php if ($advancedFilterActive) : ?>
            <span class="badge bg-warning text-dark"><?= $this->escape(__('Filtros avançados ativos', 'glpiintegaglpi')); ?></span>
        <?php else : ?>
            <span class="text-muted small"><?= $this->escape(__('recolhido por padrão', 'glpiintegaglpi')); ?></span>
        <?php endif; ?>
    </summary>
    <div class="card-body">
        <form method="get" action="<?= $this->escape($this->getOnlineMonitorUrl()); ?>">
            <input type="hidden" name="view" value="<?= $this->escape((string) ($filters['view'] ?? '')); ?>">
            <input type="hidden" name="ticket_status_quick" value="<?= $this->escape((string) ($filters['ticket_status_quick'] ?? 'active')); ?>">
            <div class="row g-3">
                <div class="col-md-2">
                    <label class="form-label"><?= $this->escape(__('Fila', 'glpiintegaglpi')); ?></label>
                    <select class="form-select" name="queue_id">
                        <option value=""><?= $this->escape(__('Todas', 'glpiintegaglpi')); ?></option>
                        <?php foreach ($queues as $queue) : ?>
                            <?php $queueId = (int) ($queue['id'] ?? 0); ?>
                            <option value="<?= $queueId; ?>" <?= ((int) ($filters['queue_id'] ?? 0) === $queueId) ? 'selected' : ''; ?>>
                                <?= $this->escape((string) ($queue['name'] ?? '')); ?>
                            </option>
                        <?php endforeach; ?>
                    </select>
                </div>
                <div class="col-md-2">
                    <label class="form-label"><?= $this->escape(__('Técnico', 'glpiintegaglpi')); ?></label>
                    <select class="form-select" name="technician_id">
                        <option value=""><?= $this->escape(__('Todos', 'glpiintegaglpi')); ?></option>
                        <?php foreach ($technicians as $technician) : ?>
                            <?php $technicianId = (int) ($technician['id'] ?? 0); ?>
                            <option value="<?= $technicianId; ?>" <?= ((int) ($filters['technician_id'] ?? 0) === $technicianId) ? 'selected' : ''; ?>>
                                <?= $this->escape((string) ($technician['name'] ?? '')); ?>
                            </option>
                        <?php endforeach; ?>
                    </select>
                </div>
                <div class="col-md-2">
                    <label class="form-label"><?= $this->escape(__('Entidade', 'glpiintegaglpi')); ?></label>
                    <select class="form-select" name="entity_id">
                        <option value=""><?= $this->escape(__('Todas', 'glpiintegaglpi')); ?></option>
                        <?php foreach ($entities as $entity) : ?>
                            <?php $entityId = (int) ($entity['id'] ?? 0); ?>
                            <option value="<?= $entityId; ?>" <?= ((int) ($filters['entity_id'] ?? 0) === $entityId) ? 'selected' : ''; ?>>
                                <?= $this->escape((string) ($entity['name'] ?? '')); ?>
                            </option>
                        <?php endforeach; ?>
                    </select>
                </div>
                <div class="col-md-2">
                    <label class="form-label"><?= $this->escape(__('Status conversa', 'glpiintegaglpi')); ?></label>
                    <select class="form-select" name="conversation_status">
                        <option value=""><?= $this->escape(__('Todos', 'glpiintegaglpi')); ?></option>
                        <?php foreach ($conversationStatuses as $status) : ?>
                            <?php $statusId = (string) ($status['id'] ?? ''); ?>
                            <option value="<?= $this->escape($statusId); ?>" <?= ((string) ($filters['conversation_status'] ?? '') === $statusId) ? 'selected' : ''; ?>>
                                <?= $this->escape((string) ($status['name'] ?? $statusId)); ?>
                            </option>
                        <?php endforeach; ?>
                    </select>
                </div>
                <div class="col-md-2">
                    <label class="form-label"><?= $this->escape(__('Status ticket', 'glpiintegaglpi')); ?></label>
                    <select class="form-select" name="ticket_status">
                        <option value=""><?= $this->escape(__('Todos', 'glpiintegaglpi')); ?></option>
                        <?php foreach ($ticketStatuses as $status) : ?>
                            <?php $statusId = (int) ($status['id'] ?? 0); ?>
                            <option value="<?= $statusId; ?>" <?= ((int) ($filters['ticket_status'] ?? 0) === $statusId) ? 'selected' : ''; ?>>
                                <?= $this->escape((string) ($status['name'] ?? ('#' . $statusId))); ?>
                            </option>
                        <?php endforeach; ?>
                    </select>
                </div>
                <div class="col-md-2">
                    <label class="form-label"><?= $this->escape(__('Aguardando', 'glpiintegaglpi')); ?></label>
                    <select class="form-select" name="waiting">
                        <?php foreach ($waitingOptions as $value => $label) : ?>
                            <option value="<?= $this->escape($value); ?>" <?= ((string) ($filters['waiting'] ?? '') === $value) ? 'selected' : ''; ?>>
                                <?= $this->escape($label); ?>
                            </option>
                        <?php endforeach; ?>
                    </select>
                </div>
                <div class="col-md-2">
                    <label class="form-label"><?= $this->escape(__('Ticket', 'glpiintegaglpi')); ?></label>
                    <select class="form-select" name="ticket_link">
                        <?php foreach ($ticketLinkOptions as $value => $label) : ?>
                            <option value="<?= $this->escape($value); ?>" <?= ((string) ($filters['ticket_link'] ?? '') === $value) ? 'selected' : ''; ?>>
                                <?= $this->escape($label); ?>
                            </option>
                        <?php endforeach; ?>
                    </select>
                </div>
                <div class="col-md-2">
                    <label class="form-label"><?= $this->escape(__('Busca', 'glpiintegaglpi')); ?></label>
                    <input class="form-control" name="search" maxlength="40" value="<?= $this->escape((string) ($filters['search'] ?? '')); ?>" placeholder="<?= $this->escape(__('ticket ou telefone parcial', 'glpiintegaglpi')); ?>">
                </div>
                <div class="col-md-2">
                    <label class="form-label"><?= $this->escape(__('Ordenação', 'glpiintegaglpi')); ?></label>
                    <select class="form-select" name="order_by">
                        <?php foreach ($orderOptions as $value => $label) : ?>
                            <option value="<?= $this->escape($value); ?>" <?= ((string) ($filters['order_by'] ?? '') === $value) ? 'selected' : ''; ?>>
                                <?= $this->escape($label); ?>
                            </option>
                        <?php endforeach; ?>
                    </select>
                </div>
                <div class="col-md-2">
                    <label class="form-label"><?= $this->escape(__('Itens por página', 'glpiintegaglpi')); ?></label>
                    <select class="form-select" name="limit">
                        <?php foreach ([25, 50, 100] as $option) : ?>
                            <option value="<?= $option; ?>" <?= ($limit === $option) ? 'selected' : ''; ?>>
                                <?= $option; ?>
                            </option>
                        <?php endforeach; ?>
                    </select>
                </div>
                <div class="col-md-4 d-flex align-items-end gap-2">
                    <button type="submit" class="btn btn-primary">
                        <?= $this->escape(__('Aplicar filtros', 'glpiintegaglpi')); ?>
                    </button>
                    <a class="btn btn-outline-secondary" href="<?= $this->escape($this->getOnlineMonitorUrl()); ?>">
                        <?= $this->escape(__('Limpar', 'glpiintegaglpi')); ?>
                    </a>
                </div>
            </div>
            <div class="form-text mt-2">
                <?= $this->escape(__('Critério operacional: última mensagem inbound = aguardando técnico; última outbound = aguardando cliente.', 'glpiintegaglpi')); ?>
            </div>
        </form>
    </div>
</details>

<div class="card">
    <div class="card-header d-flex align-items-center justify-content-between">
        <span><?= $this->escape(__('Conversas e chamados WhatsApp', 'glpiintegaglpi')); ?></span>
        <span class="text-muted small">
            <?= $this->escape(__('Página', 'glpiintegaglpi')); ?> <?= $page; ?> · <?= count($rows); ?> <?= $this->escape(__('registro(s)', 'glpiintegaglpi')); ?>
        </span>
    </div>
    <div class="card-body p-0">
        <?php if ($rows === []) : ?>
            <div class="p-4 text-muted">
                <?= $this->escape(__('Nenhuma conversa encontrada para os filtros atuais.', 'glpiintegaglpi')); ?>
            </div>
        <?php else : ?>
            <div class="table-responsive">
                <table class="table table-sm table-hover mb-0 align-middle">
                    <thead class="table-light">
                        <tr>
                            <th><?= $this->escape(__('Conversa', 'glpiintegaglpi')); ?></th>
                            <th><?= $this->escape(__('Ticket', 'glpiintegaglpi')); ?></th>
                            <th><?= $this->escape(__('Cliente', 'glpiintegaglpi')); ?></th>
                            <th><?= $this->escape(__('Entidade', 'glpiintegaglpi')); ?></th>
                            <th><?= $this->escape(__('Fila / Técnico', 'glpiintegaglpi')); ?></th>
                            <th><?= $this->escape(__('Status', 'glpiintegaglpi')); ?></th>
                            <th><?= $this->escape(__('Última mensagem', 'glpiintegaglpi')); ?></th>
                            <th><?= $this->escape(__('Tempo parado', 'glpiintegaglpi')); ?></th>
                            <th><?= $this->escape(__('Janela / Delivery', 'glpiintegaglpi')); ?></th>
                            <th><?= $this->escape(__('Ações', 'glpiintegaglpi')); ?></th>
                        </tr>
                    </thead>
                    <tbody>
                        <?php foreach ($rows as $row) : ?>
                            <?php
                            $ticketId = (int) ($row['ticket_id'] ?? 0);
                            $conversationId = (string) ($row['conversation_id'] ?? '');
                            $openAlertCount = (int) ($alertBadgeCounts[$conversationId] ?? 0);
                            $waitingState = (string) ($row['waiting_state'] ?? '');
                            $waitingBadge = $waitingState === 'waiting_technician'
                                ? ['class' => 'warning text-dark', 'label' => __('Aguardando técnico', 'glpiintegaglpi')]
                                : ($waitingState === 'waiting_customer'
                                    ? ['class' => 'info text-dark', 'label' => __('Aguardando cliente', 'glpiintegaglpi')]
                                    : ['class' => 'secondary', 'label' => __('Sistema/indefinido', 'glpiintegaglpi')]);
                            $window = (string) ($row['whatsapp_window'] ?? 'not_verified');
                            $windowLabel = $window === 'open'
                                ? __('24h aberta', 'glpiintegaglpi')
                                : ($window === 'closed' ? __('24h fechada', 'glpiintegaglpi') : __('24h não verificada', 'glpiintegaglpi'));
                            ?>
                            <tr class="<?= (bool) ($row['failure'] ?? false) ? 'table-warning' : ''; ?>">
                                <td>
                                    <div class="fw-semibold"><?= $this->escape((string) ($row['conversation_short'] ?? '')); ?></div>
                                    <div class="text-muted small"><?= $this->escape((string) ($row['phone_masked'] ?? '')); ?></div>
                                    <?php if ($openAlertCount > 0) : ?>
                                        <div class="mt-1">
                                            <span class="badge bg-warning text-dark">
                                                <?= $this->escape(__('IA', 'glpiintegaglpi')); ?> <?= $openAlertCount; ?>
                                            </span>
                                        </div>
                                    <?php endif; ?>
                                </td>
                                <td>
                                    <?php if ($ticketId > 0) : ?>
                                        <a href="<?= $this->escape($this->getTicketUrl($ticketId)); ?>">#<?= $ticketId; ?></a>
                                        <div class="text-muted small">
                                            <?= $this->escape(__('Prioridade:', 'glpiintegaglpi') . ' ' . (string) ((int) ($row['ticket_priority'] ?? 0) ?: '-')); ?>
                                        </div>
                                    <?php else : ?>
                                        <span class="text-muted"><?= $this->escape(__('sem ticket', 'glpiintegaglpi')); ?></span>
                                    <?php endif; ?>
                                </td>
                                <td>
                                    <div><?= $this->escape((string) ($row['requester_name'] ?? '')); ?></div>
                                    <div class="text-muted small"><?= $this->escape((string) ($row['company_name'] ?? '')); ?></div>
                                </td>
                                <td><?= $this->escape((string) ($row['entity_name'] ?? '')); ?></td>
                                <td>
                                    <div><?= $this->escape((string) ($row['queue_name'] ?? '')); ?></div>
                                    <div class="text-muted small"><?= $this->escape((string) ($row['technician_name'] ?? __('sem técnico', 'glpiintegaglpi'))); ?></div>
                                </td>
                                <td>
                                    <div><span class="badge bg-secondary"><?= $this->escape((string) ($row['conversation_status'] ?? '')); ?></span></div>
                                    <div class="mt-1">
                                        <span class="badge bg-light text-dark border">
                                            <?= $this->escape(__('Ticket:', 'glpiintegaglpi') . ' ' . (string) ($row['ticket_status_label'] ?? 'not_verified')); ?>
                                        </span>
                                    </div>
                                    <div class="mt-1">
                                        <span class="badge bg-<?= $this->escape($waitingBadge['class']); ?>">
                                            <?= $this->escape($waitingBadge['label']); ?>
                                        </span>
                                    </div>
                                </td>
                                <td style="min-width: 240px;">
                                    <div><?= $this->escape((string) ($row['last_message'] ?? '')); ?></div>
                                    <div class="text-muted small">
                                        <?= $this->escape((string) ($row['last_direction'] ?? 'system')); ?> ·
                                        <?= $this->escape((string) ($row['last_message_at'] ?? '')); ?>
                                    </div>
                                </td>
                                <td>
                                    <span class="fw-semibold"><?= $this->escape((string) ($row['stalled_label'] ?? '')); ?></span>
                                </td>
                                <td>
                                    <div><?= $this->escape($windowLabel); ?></div>
                                    <div class="text-muted small">
                                        <?= $this->escape(__('Delivery:', 'glpiintegaglpi') . ' ' . ((string) ($row['last_delivery_status'] ?? '') !== '' ? (string) ($row['last_delivery_status'] ?? '') : __('não verificado', 'glpiintegaglpi'))); ?>
                                    </div>
                                    <?php if ((string) ($row['inactivity_status'] ?? '') !== '') : ?>
                                        <div class="text-muted small">
                                            <?= $this->escape(__('Inatividade:', 'glpiintegaglpi') . ' ' . (string) ($row['inactivity_status'] ?? '')); ?>
                                        </div>
                                    <?php endif; ?>
                                    <?php if ((bool) ($row['failure'] ?? false)) : ?>
                                        <div class="text-danger small">
                                            <?= $this->escape((string) ($row['failure_reason'] ?? __('falha', 'glpiintegaglpi'))); ?>
                                        </div>
                                    <?php endif; ?>
                                </td>
                                <td>
                                    <?php if ($ticketId > 0) : ?>
                                        <div><a href="<?= $this->escape($this->getTicketUrl($ticketId)); ?>"><?= $this->escape(__('Abrir ticket', 'glpiintegaglpi')); ?></a></div>
                                        <div><a href="<?= $this->escape($this->getTicketContextUrl($ticketId)); ?>"><?= $this->escape(__('Contexto WhatsApp', 'glpiintegaglpi')); ?></a></div>
                                    <?php else : ?>
                                        <span class="text-muted"><?= $this->escape(__('sem ação disponível', 'glpiintegaglpi')); ?></span>
                                    <?php endif; ?>
                                </td>
                            </tr>
                        <?php endforeach; ?>
                    </tbody>
                </table>
            </div>
        <?php endif; ?>
    </div>
    <div class="card-footer d-flex align-items-center justify-content-between">
        <div class="text-muted small">
            <?= $this->escape(__('Limite por página:', 'glpiintegaglpi') . ' ' . (string) $limit); ?>
        </div>
        <div class="d-flex gap-2">
            <?php if ($hasPrevious) : ?>
                <a class="btn btn-outline-secondary btn-sm" href="<?= $this->escape($this->getPageUrl($filters, $page - 1)); ?>">
                    <?= $this->escape(__('Anterior', 'glpiintegaglpi')); ?>
                </a>
            <?php endif; ?>
            <?php if ($hasNext) : ?>
                <a class="btn btn-outline-secondary btn-sm" href="<?= $this->escape($this->getPageUrl($filters, $page + 1)); ?>">
                    <?= $this->escape(__('Próxima', 'glpiintegaglpi')); ?>
                </a>
            <?php endif; ?>
        </div>
    </div>
</div>

<?php endif; ?>

<script>
(function () {
    var checkbox = document.getElementById('integaglpi-online-auto-refresh');
    var advancedFilters = document.getElementById('integaglpi-online-advanced-filters');
    var advancedFiltersKey = 'integaglpi.online_monitor.advanced_filters_open';
    if (advancedFilters && window.localStorage) {
        advancedFilters.open = window.localStorage.getItem(advancedFiltersKey) === '1';
        advancedFilters.addEventListener('toggle', function () {
            window.localStorage.setItem(advancedFiltersKey, advancedFilters.open ? '1' : '0');
        });
    }
    if (!checkbox || !window.localStorage) {
        return;
    }
    var key = 'integaglpi.online_monitor.auto_refresh';
    var timer = null;
    function schedule() {
        if (timer) {
            window.clearTimeout(timer);
            timer = null;
        }
        if (checkbox.checked) {
            timer = window.setTimeout(function () {
                window.location.reload();
            }, 20000);
        }
    }
    checkbox.checked = window.localStorage.getItem(key) === '1';
    checkbox.addEventListener('change', function () {
        window.localStorage.setItem(key, checkbox.checked ? '1' : '0');
        schedule();
    });
    schedule();
}());
</script>
