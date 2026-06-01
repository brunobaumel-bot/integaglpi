<?php

declare(strict_types=1);

use GlpiPlugin\Integaglpi\Plugin;

/** @var array<string, mixed> $data */

$escape = static fn (string $value): string => Html::cleanInputText($value);
$filters = is_array($data['filters'] ?? null) ? $data['filters'] : [];
$kpis = is_array($data['kpis'] ?? null) ? $data['kpis'] : [];
$actionQueue = is_array($data['action_queue'] ?? null) ? $data['action_queue'] : [];
$integrations = is_array($data['integration_status'] ?? null) ? $data['integration_status'] : [];
$drilldowns = is_array($data['drilldowns'] ?? null) ? $data['drilldowns'] : [];
$sourceErrors = is_array($data['source_errors'] ?? null) ? $data['source_errors'] : [];
$toneClass = static function (string $tone): string {
    return [
        'success' => 'text-bg-success',
        'warning' => 'text-bg-warning',
        'danger' => 'text-bg-danger',
        'primary' => 'text-bg-primary',
        'secondary' => 'text-bg-secondary',
    ][$tone] ?? 'text-bg-secondary';
};
$statusClass = static function (string $status): string {
    return [
        'ok' => 'text-bg-success',
        'off' => 'text-bg-secondary',
        'degraded' => 'text-bg-warning',
        'failed' => 'text-bg-danger',
    ][$status] ?? 'text-bg-secondary';
};
$commandCenterUrl = Plugin::getWebBasePath() . '/front/supervisor.command.php';
?>

<div class="container-fluid integaglpi-supervisor-command">
    <div class="d-flex flex-wrap justify-content-between align-items-start gap-3 mb-3">
        <div>
            <h2 class="mb-1"><?= $escape(__('Dashboard Geral do Supervisor', 'glpiintegaglpi')); ?></h2>
            <div class="text-muted">
                <?= $escape(__('Visão read-only para priorização humana, saúde operacional e drill-down para telas existentes.', 'glpiintegaglpi')); ?>
            </div>
        </div>
        <div class="d-flex flex-column align-items-end gap-1">
            <span class="badge text-bg-light border"><?= $escape(__('MVP read-only', 'glpiintegaglpi')); ?></span>
            <span class="small text-muted"><?= $escape((string) ($data['generated_at'] ?? '')); ?></span>
        </div>
    </div>

    <form method="get" action="<?= $escape($commandCenterUrl); ?>" class="card mb-3">
        <div class="card-body">
            <div class="row g-2 align-items-end">
                <div class="col-md-2">
                    <label class="form-label" for="period"><?= $escape(__('Período', 'glpiintegaglpi')); ?></label>
                    <select class="form-select" id="period" name="period">
                        <?php foreach ([1, 7, 15, 30, 90] as $period) : ?>
                            <option value="<?= $period; ?>" <?= (int) ($filters['period'] ?? 7) === $period ? 'selected' : ''; ?>>
                                <?= $period; ?> <?= $escape(__('dia(s)', 'glpiintegaglpi')); ?>
                            </option>
                        <?php endforeach; ?>
                    </select>
                </div>
                <div class="col-md-2">
                    <label class="form-label" for="entity_id"><?= $escape(__('Entidade', 'glpiintegaglpi')); ?></label>
                    <input class="form-control" id="entity_id" name="entity_id" type="number" min="0" value="<?= (int) ($filters['entity_id'] ?? 0); ?>">
                </div>
                <div class="col-md-2">
                    <label class="form-label" for="queue_id"><?= $escape(__('Fila', 'glpiintegaglpi')); ?></label>
                    <input class="form-control" id="queue_id" name="queue_id" type="number" min="0" value="<?= (int) ($filters['queue_id'] ?? 0); ?>">
                </div>
                <div class="col-md-2">
                    <label class="form-label" for="technician_id"><?= $escape(__('Responsável', 'glpiintegaglpi')); ?></label>
                    <input class="form-control" id="technician_id" name="technician_id" type="number" min="0" value="<?= (int) ($filters['technician_id'] ?? 0); ?>">
                </div>
                <div class="col-md-2">
                    <label class="form-label" for="status"><?= $escape(__('Status', 'glpiintegaglpi')); ?></label>
                    <select class="form-select" id="status" name="status">
                        <?php foreach (['' => __('Todos', 'glpiintegaglpi'), 'open' => 'open', 'awaiting_entity_selection' => 'awaiting_entity_selection', 'awaiting_queue_selection' => 'awaiting_queue_selection', 'closed' => 'closed'] as $value => $label) : ?>
                            <option value="<?= $escape((string) $value); ?>" <?= (string) ($filters['status'] ?? '') === (string) $value ? 'selected' : ''; ?>>
                                <?= $escape((string) $label); ?>
                            </option>
                        <?php endforeach; ?>
                    </select>
                </div>
                <div class="col-md-2">
                    <label class="form-label" for="risk"><?= $escape(__('Risco', 'glpiintegaglpi')); ?></label>
                    <select class="form-select" id="risk" name="risk">
                        <?php foreach (['' => __('Todos', 'glpiintegaglpi'), 'sla' => 'SLA', 'inactivity' => __('Inatividade', 'glpiintegaglpi'), 'csat' => 'CSAT', 'ai' => 'IA', 'queue' => __('Fila', 'glpiintegaglpi'), 'integration' => __('Integração', 'glpiintegaglpi')] as $value => $label) : ?>
                            <option value="<?= $escape((string) $value); ?>" <?= (string) ($filters['risk'] ?? '') === (string) $value ? 'selected' : ''; ?>>
                                <?= $escape((string) $label); ?>
                            </option>
                        <?php endforeach; ?>
                    </select>
                </div>
                <div class="col-12 d-flex justify-content-end gap-2">
                    <a class="btn btn-outline-secondary" href="<?= $escape($commandCenterUrl); ?>">
                        <?= $escape(__('Limpar', 'glpiintegaglpi')); ?>
                    </a>
                    <button class="btn btn-primary" type="submit">
                        <?= $escape(__('Filtrar', 'glpiintegaglpi')); ?>
                    </button>
                </div>
            </div>
        </div>
    </form>

    <?php if ($sourceErrors !== []) : ?>
        <div class="alert alert-warning">
            <strong><?= $escape(__('Falha parcial', 'glpiintegaglpi')); ?></strong>
            <?= $escape(__('Algumas fontes não responderam; o restante do dashboard continua disponível.', 'glpiintegaglpi')); ?>
        </div>
    <?php endif; ?>

    <div class="row g-3 mb-3">
        <?php foreach ($kpis as $kpi) : ?>
            <?php if (!is_array($kpi)) { continue; } ?>
            <div class="col-sm-6 col-xl-3">
                <a class="card h-100 text-decoration-none" href="<?= $escape((string) ($kpi['url'] ?? '#')); ?>">
                    <div class="card-body">
                        <div class="d-flex justify-content-between gap-2">
                            <span class="text-muted"><?= $escape((string) ($kpi['label'] ?? '-')); ?></span>
                            <span class="badge <?= $escape($toneClass((string) ($kpi['tone'] ?? 'secondary'))); ?>"><?= (int) ($kpi['value'] ?? 0); ?></span>
                        </div>
                        <div class="display-6 mt-2"><?= (int) ($kpi['value'] ?? 0); ?></div>
                    </div>
                </a>
            </div>
        <?php endforeach; ?>
    </div>

    <div class="row g-3">
        <div class="col-xl-8">
            <div class="card h-100">
                <div class="card-header d-flex justify-content-between align-items-center">
                    <strong><?= $escape(__('Fila de Ações do Supervisor', 'glpiintegaglpi')); ?></strong>
                    <span class="small text-muted"><?= $escape(__('Somente links de análise; nenhuma ação é executada aqui.', 'glpiintegaglpi')); ?></span>
                </div>
                <div class="table-responsive">
                    <table class="table table-vcenter card-table">
                        <thead>
                            <tr>
                                <th><?= $escape(__('Ticket', 'glpiintegaglpi')); ?></th>
                                <th><?= $escape(__('Entidade / Fila', 'glpiintegaglpi')); ?></th>
                                <th><?= $escape(__('Responsável', 'glpiintegaglpi')); ?></th>
                                <th><?= $escape(__('Risco', 'glpiintegaglpi')); ?></th>
                                <th><?= $escape(__('Ação sugerida', 'glpiintegaglpi')); ?></th>
                            </tr>
                        </thead>
                        <tbody>
                            <?php if ($actionQueue === []) : ?>
                                <tr>
                                    <td colspan="5" class="text-muted text-center py-4">
                                        <?= $escape(__('Nenhuma ação prioritária encontrada para os filtros atuais.', 'glpiintegaglpi')); ?>
                                    </td>
                                </tr>
                            <?php endif; ?>
                            <?php foreach ($actionQueue as $row) : ?>
                                <?php if (!is_array($row)) { continue; } ?>
                                <tr>
                                    <td>
                                        <?php if ((int) ($row['ticket_id'] ?? 0) > 0) : ?>
                                            <a href="<?= $escape((string) ($row['ticket_url'] ?? '#')); ?>">#<?= (int) $row['ticket_id']; ?></a>
                                            <div><a class="small" href="<?= $escape((string) ($row['context_url'] ?? '#')); ?>"><?= $escape(__('Contexto WhatsApp', 'glpiintegaglpi')); ?></a></div>
                                        <?php else : ?>
                                            <span class="text-muted">-</span>
                                        <?php endif; ?>
                                    </td>
                                    <td>
                                        <div><?= $escape((string) ($row['entity'] ?? '-')); ?></div>
                                        <div class="small text-muted"><?= $escape((string) ($row['queue'] ?? '-')); ?></div>
                                    </td>
                                    <td><?= $escape((string) ($row['technician'] ?? '-')); ?></td>
                                    <td>
                                        <span class="badge text-bg-warning"><?= $escape((string) ($row['reason'] ?? '-')); ?></span>
                                        <div class="small text-muted"><?= $escape((string) ($row['sla_remaining'] ?? '-')); ?></div>
                                    </td>
                                    <td><?= $escape((string) ($row['suggested_action'] ?? '-')); ?></td>
                                </tr>
                            <?php endforeach; ?>
                        </tbody>
                    </table>
                </div>
            </div>
        </div>

        <div class="col-xl-4">
            <div class="card mb-3">
                <div class="card-header"><strong><?= $escape(__('Status das Integrações', 'glpiintegaglpi')); ?></strong></div>
                <div class="list-group list-group-flush">
                    <?php foreach ($integrations as $integration) : ?>
                        <?php if (!is_array($integration)) { continue; } ?>
                        <a class="list-group-item list-group-item-action" href="<?= $escape((string) ($integration['url'] ?? '#')); ?>">
                            <div class="d-flex justify-content-between gap-2">
                                <span><?= $escape((string) ($integration['label'] ?? '-')); ?></span>
                                <span class="badge <?= $escape($statusClass((string) ($integration['status'] ?? 'degraded'))); ?>">
                                    <?= $escape((string) ($integration['status'] ?? '-')); ?>
                                </span>
                            </div>
                            <div class="small text-muted"><?= $escape((string) ($integration['detail'] ?? '')); ?></div>
                        </a>
                    <?php endforeach; ?>
                </div>
            </div>

            <div class="card">
                <div class="card-header"><strong><?= $escape(__('Drill-downs', 'glpiintegaglpi')); ?></strong></div>
                <div class="list-group list-group-flush">
                    <?php foreach ($drilldowns as $drilldown) : ?>
                        <?php if (!is_array($drilldown)) { continue; } ?>
                        <a class="list-group-item list-group-item-action" href="<?= $escape((string) ($drilldown['url'] ?? '#')); ?>">
                            <div><?= $escape((string) ($drilldown['label'] ?? '-')); ?></div>
                            <div class="small text-muted"><?= $escape((string) ($drilldown['hint'] ?? '')); ?></div>
                        </a>
                    <?php endforeach; ?>
                </div>
            </div>
        </div>
    </div>

    <div class="alert alert-info mt-3">
        <?= $escape(__('PII Guard ativo: listas agregadas usam dados mascarados/truncados e não exibem payload bruto. O dashboard não assume, transfere, soluciona, reabre, envia WhatsApp ou aciona LogMeIn Reconciliation.', 'glpiintegaglpi')); ?>
        <div class="small mt-1"><?= $escape((string) ($data['cache_strategy'] ?? '')); ?></div>
    </div>
</div>
