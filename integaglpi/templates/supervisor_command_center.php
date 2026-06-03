<?php

declare(strict_types=1);

use GlpiPlugin\Integaglpi\Plugin;

/** @var array<string, mixed> $data */

$escape = static fn (string $value): string => Html::cleanInputText($value);
$filters = is_array($data['filters'] ?? null) ? $data['filters'] : [];
$kpis = is_array($data['kpis'] ?? null) ? $data['kpis'] : [];
$actionQueue = is_array($data['action_queue'] ?? null) ? $data['action_queue'] : [];
$team = is_array($data['team_management'] ?? null) ? $data['team_management'] : [];
$clientRisk = is_array($data['client_entity_risk'] ?? null) ? $data['client_entity_risk'] : [];
$qualityAi = is_array($data['quality_ai'] ?? null) ? $data['quality_ai'] : [];
$technicalFooter = is_array($data['technical_footer'] ?? null) ? $data['technical_footer'] : [];
$drilldowns = is_array($data['drilldowns'] ?? null) ? $data['drilldowns'] : [];
$sourceErrors = is_array($data['source_errors'] ?? null) ? $data['source_errors'] : [];
$commandCenterUrl = Plugin::getWebBasePath() . '/front/supervisor.command.php';
$toneClass = static function (string $tone): string {
    return [
        'success' => 'text-bg-success',
        'warning' => 'text-bg-warning',
        'danger' => 'text-bg-danger',
        'primary' => 'text-bg-primary',
        'secondary' => 'text-bg-secondary',
    ][$tone] ?? 'text-bg-secondary';
};
$priorityClass = static function (string $priority): string {
    return [
        'critical' => 'text-bg-danger',
        'warning' => 'text-bg-warning',
        'normal' => 'text-bg-secondary',
    ][$priority] ?? 'text-bg-secondary';
};
$statusClass = static function (string $status): string {
    return [
        'ok' => 'text-bg-success',
        'off' => 'text-bg-secondary',
        'degraded' => 'text-bg-warning',
        'failed' => 'text-bg-danger',
    ][$status] ?? 'text-bg-secondary';
};
$renderDistribution = static function (array $rows, string $labelKey) use ($escape): void {
    if ($rows === []) {
        echo '<div class="text-muted small py-2">' . $escape(__('Sem dados suficientes para esta distribuição.', 'glpiintegaglpi')) . '</div>';
        return;
    }
    echo '<div class="list-group list-group-flush">';
    foreach ($rows as $row) {
        if (!is_array($row)) {
            continue;
        }
        echo '<div class="list-group-item px-0">';
        echo '<div class="d-flex justify-content-between gap-2">';
        echo '<span>' . $escape((string) ($row[$labelKey] ?? __('Não informado', 'glpiintegaglpi'))) . '</span>';
        echo '<span class="badge text-bg-light border">' . (int) ($row['count'] ?? 0) . '</span>';
        echo '</div>';
        $critical = (int) ($row['critical'] ?? 0);
        $warning = (int) ($row['warning'] ?? 0);
        if ($critical > 0 || $warning > 0) {
            echo '<div class="small text-muted">' . $escape(sprintf(__('Críticos: %d · Atenção: %d', 'glpiintegaglpi'), $critical, $warning)) . '</div>';
        }
        echo '</div>';
    }
    echo '</div>';
};
?>

<div class="container-fluid integaglpi-supervisor-command">
    <div class="d-flex flex-wrap justify-content-between align-items-start gap-3 mb-3">
        <div>
            <h2 class="mb-1"><?= $escape(__('Dashboard Geral do Supervisor', 'glpiintegaglpi')); ?></h2>
            <div class="text-muted">
                <?= $escape(__('Ações, riscos e saúde operacional do atendimento.', 'glpiintegaglpi')); ?>
            </div>
        </div>
        <div class="d-flex flex-column align-items-end gap-1">
            <span class="badge text-bg-light border"><?= $escape(__('read-only', 'glpiintegaglpi')); ?></span>
            <span class="small text-muted"><?= $escape(__('Última atualização:', 'glpiintegaglpi')); ?> <?= $escape((string) ($data['generated_at'] ?? '')); ?></span>
        </div>
    </div>

    <form method="get" action="<?= $escape($commandCenterUrl); ?>" class="card mb-3">
        <div class="card-body">
            <div class="row g-2 align-items-end">
                <div class="col-md-2">
                    <label class="form-label" for="period"><?= $escape(__('Período', 'glpiintegaglpi')); ?></label>
                    <select class="form-select" id="period" name="period">
                        <?php foreach ([1, 7, 15, 30, 90] as $period) : ?>
                            <option value="<?= $period; ?>" <?= (int) ($filters['period'] ?? 7) === $period ? 'selected' : ''; ?>><?= $period; ?> <?= $escape(__('dia(s)', 'glpiintegaglpi')); ?></option>
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
                            <option value="<?= $escape((string) $value); ?>" <?= (string) ($filters['status'] ?? '') === (string) $value ? 'selected' : ''; ?>><?= $escape((string) $label); ?></option>
                        <?php endforeach; ?>
                    </select>
                </div>
                <div class="col-md-2">
                    <label class="form-label" for="risk"><?= $escape(__('Risco', 'glpiintegaglpi')); ?></label>
                    <select class="form-select" id="risk" name="risk">
                        <?php foreach (['' => __('Todos', 'glpiintegaglpi'), 'sla' => 'SLA', 'inactivity' => __('Inatividade', 'glpiintegaglpi'), 'csat' => 'CSAT', 'ai' => 'IA', 'queue' => __('Fila', 'glpiintegaglpi'), 'integration' => __('Integração', 'glpiintegaglpi')] as $value => $label) : ?>
                            <option value="<?= $escape((string) $value); ?>" <?= (string) ($filters['risk'] ?? '') === (string) $value ? 'selected' : ''; ?>><?= $escape((string) $label); ?></option>
                        <?php endforeach; ?>
                    </select>
                </div>
                <div class="col-12 d-flex justify-content-end gap-2">
                    <a class="btn btn-outline-secondary" href="<?= $escape($commandCenterUrl); ?>"><?= $escape(__('Limpar', 'glpiintegaglpi')); ?></a>
                    <button class="btn btn-primary" type="submit"><?= $escape(__('Filtrar', 'glpiintegaglpi')); ?></button>
                </div>
            </div>
        </div>
    </form>

    <?php if ($sourceErrors !== []) : ?>
        <div class="alert alert-warning">
            <strong><?= $escape(__('Falha parcial', 'glpiintegaglpi')); ?></strong>
            <?= $escape(__('Uma ou mais fontes não responderam; a visão operacional restante continua disponível.', 'glpiintegaglpi')); ?>
        </div>
    <?php endif; ?>

    <div class="row g-3 mb-3">
        <?php foreach ($kpis as $kpi) : ?>
            <?php if (!is_array($kpi)) { continue; } ?>
            <div class="col-sm-6 col-xl-3">
                <a class="card h-100 text-decoration-none" href="<?= $escape((string) ($kpi['url'] ?? '#')); ?>">
                    <div class="card-body">
                        <div class="d-flex justify-content-between gap-2">
                            <span class="fw-semibold"><?= $escape((string) ($kpi['label'] ?? '-')); ?></span>
                            <span class="badge <?= $escape($toneClass((string) ($kpi['tone'] ?? 'secondary'))); ?>"><?= (int) ($kpi['value'] ?? 0); ?></span>
                        </div>
                        <div class="display-6 mt-2"><?= (int) ($kpi['value'] ?? 0); ?></div>
                        <div class="small text-muted"><?= $escape((string) ($kpi['hint'] ?? '')); ?></div>
                    </div>
                </a>
            </div>
        <?php endforeach; ?>
    </div>

    <div class="card mb-3">
        <div class="card-header d-flex justify-content-between align-items-center">
            <div>
                <strong><?= $escape(__('Ações do Supervisor — Prioridade agora', 'glpiintegaglpi')); ?></strong>
                <div class="small text-muted"><?= $escape(__('Maior área da tela: onde clicar e por quê.', 'glpiintegaglpi')); ?></div>
            </div>
            <span class="badge text-bg-light border"><?= $escape(__('Somente links', 'glpiintegaglpi')); ?></span>
        </div>
        <div class="table-responsive">
            <table class="table table-vcenter card-table">
                <thead>
                    <tr>
                        <th><?= $escape(__('Prioridade', 'glpiintegaglpi')); ?></th>
                        <th><?= $escape(__('Ticket', 'glpiintegaglpi')); ?></th>
                        <th><?= $escape(__('Cliente/Entidade', 'glpiintegaglpi')); ?></th>
                        <th><?= $escape(__('Fila', 'glpiintegaglpi')); ?></th>
                        <th><?= $escape(__('Responsável', 'glpiintegaglpi')); ?></th>
                        <th><?= $escape(__('Motivo', 'glpiintegaglpi')); ?></th>
                        <th><?= $escape(__('Idade/SLA', 'glpiintegaglpi')); ?></th>
                        <th><?= $escape(__('Última interação', 'glpiintegaglpi')); ?></th>
                        <th><?= $escape(__('Ação sugerida', 'glpiintegaglpi')); ?></th>
                    </tr>
                </thead>
                <tbody>
                    <?php if ($actionQueue === []) : ?>
                        <tr><td colspan="9" class="text-muted text-center py-4"><?= $escape(__('Nenhuma ação imediata encontrada para os filtros atuais.', 'glpiintegaglpi')); ?></td></tr>
                    <?php endif; ?>
                    <?php foreach ($actionQueue as $row) : ?>
                        <?php if (!is_array($row)) { continue; } ?>
                        <tr>
                            <td><span class="badge <?= $escape($priorityClass((string) ($row['priority'] ?? 'normal'))); ?>"><?= $escape((string) ($row['priority'] ?? 'normal')); ?></span></td>
                            <td>
                                <?php if ((int) ($row['ticket_id'] ?? 0) > 0) : ?>
                                    <a href="<?= $escape((string) ($row['ticket_url'] ?? '#')); ?>">#<?= (int) $row['ticket_id']; ?></a>
                                    <div><a class="small" href="<?= $escape((string) ($row['context_url'] ?? '#')); ?>"><?= $escape(__('Contexto WhatsApp', 'glpiintegaglpi')); ?></a></div>
                                <?php else : ?>
                                    <span class="text-muted">-</span>
                                <?php endif; ?>
                            </td>
                            <td><?= $escape((string) ($row['entity'] ?? '-')); ?></td>
                            <td><?= $escape((string) ($row['queue'] ?? '-')); ?></td>
                            <td><?= $escape((string) ($row['technician'] ?? '-')); ?></td>
                            <td>
                                <span class="badge text-bg-warning"><?= $escape((string) ($row['reason'] ?? '-')); ?></span>
                                <?php if (trim((string) ($row['evidence'] ?? '')) !== '') : ?>
                                    <div class="small text-muted mt-1"><?= $escape((string) $row['evidence']); ?></div>
                                <?php endif; ?>
                            </td>
                            <td>
                                <div><?= $escape((string) ($row['age_label'] ?? '-')); ?></div>
                                <div class="small text-muted"><?= $escape((string) ($row['sla_remaining'] ?? '-')); ?></div>
                            </td>
                            <td><?= $escape((string) ($row['last_interaction'] ?? '-')); ?></td>
                            <td>
                                <?= $escape((string) ($row['suggested_action'] ?? '-')); ?>
                                <?php if (trim((string) ($row['monitor_url'] ?? '')) !== '') : ?>
                                    <div><a class="small" href="<?= $escape((string) $row['monitor_url']); ?>"><?= $escape((string) ($row['monitor_label'] ?? __('Monitor Online / Detalhes', 'glpiintegaglpi'))); ?></a></div>
                                <?php endif; ?>
                            </td>
                        </tr>
                    <?php endforeach; ?>
                </tbody>
            </table>
        </div>
    </div>

    <div class="row g-3 mb-3">
        <div class="col-xl-4">
            <div class="card h-100">
                <div class="card-header"><strong><?= $escape(__('Gestão da equipe', 'glpiintegaglpi')); ?></strong></div>
                <div class="card-body">
                    <h4 class="h6"><?= $escape(__('Distribuição de carga por fila', 'glpiintegaglpi')); ?></h4>
                    <?php $renderDistribution(is_array($team['queue_load'] ?? null) ? $team['queue_load'] : [], 'queue'); ?>
                    <h4 class="h6 mt-3"><?= $escape(__('Chamados por responsável', 'glpiintegaglpi')); ?></h4>
                    <?php $renderDistribution(is_array($team['assignee_load'] ?? null) ? $team['assignee_load'] : [], 'technician'); ?>
                    <div class="alert alert-light border mt-3 mb-0">
                        <?= $escape(__('Chamados sem técnico:', 'glpiintegaglpi')); ?> <strong><?= (int) ($team['unassigned_tickets'] ?? 0); ?></strong>
                    </div>
                </div>
            </div>
        </div>

        <div class="col-xl-4">
            <div class="card h-100">
                <div class="card-header"><strong><?= $escape(__('Clientes/Entidades em atenção', 'glpiintegaglpi')); ?></strong></div>
                <div class="card-body">
                    <h4 class="h6"><?= $escape(__('Entidades com mais chamados abertos', 'glpiintegaglpi')); ?></h4>
                    <?php $renderDistribution(is_array($clientRisk['entities_with_open_tickets'] ?? null) ? $clientRisk['entities_with_open_tickets'] : [], 'entity'); ?>
                    <h4 class="h6 mt-3"><?= $escape(__('Entidades com SLA/CSAT em risco', 'glpiintegaglpi')); ?></h4>
                    <?php $renderDistribution(is_array($clientRisk['entities_with_sla_risk'] ?? null) ? $clientRisk['entities_with_sla_risk'] : [], 'entity'); ?>
                    <a class="btn btn-outline-secondary btn-sm mt-3" href="<?= $escape((string) (($clientRisk['contracts_attention']['url'] ?? null) ?: Plugin::getContractHoursUrl())); ?>">
                        <?= $escape(__('Ver contratos e banco de horas', 'glpiintegaglpi')); ?>
                    </a>
                </div>
            </div>
        </div>

        <div class="col-xl-4">
            <div class="card h-100">
                <div class="card-header"><strong><?= $escape(__('Qualidade e IA', 'glpiintegaglpi')); ?></strong></div>
                <div class="card-body">
                    <div class="row g-2">
                        <?php foreach ([
                            __('Alertas IA críticos', 'glpiintegaglpi') => (int) ($qualityAi['critical_ai_alerts'] ?? 0),
                            __('Alertas IA abertos', 'glpiintegaglpi') => (int) ($qualityAi['open_ai_alerts'] ?? 0),
                            __('CSAT ruim', 'glpiintegaglpi') => (int) ($qualityAi['bad_csat'] ?? 0),
                            __('Reaberturas', 'glpiintegaglpi') => (int) ($qualityAi['reopened'] ?? 0),
                            __('Risco de frustração', 'glpiintegaglpi') => (int) ($qualityAi['frustration_risk'] ?? 0),
                            __('Revisão supervisor', 'glpiintegaglpi') => (int) ($qualityAi['supervisor_review_candidates'] ?? 0),
                            __('SLA em risco', 'glpiintegaglpi') => (int) ($qualityAi['sla_risk'] ?? 0),
                        ] as $label => $value) : ?>
                            <div class="col-6">
                                <div class="border rounded p-2">
                                    <div class="small text-muted"><?= $escape((string) $label); ?></div>
                                    <div class="h4 mb-0"><?= $value; ?></div>
                                </div>
                            </div>
                        <?php endforeach; ?>
                    </div>
                    <div class="d-flex flex-wrap gap-2 mt-3">
                        <a class="btn btn-outline-secondary btn-sm" href="<?= $escape((string) ($qualityAi['quality_url'] ?? Plugin::getQualityDashboardUrl())); ?>"><?= $escape(__('Dashboard de Qualidade', 'glpiintegaglpi')); ?></a>
                        <a class="btn btn-outline-secondary btn-sm" href="<?= $escape((string) ($qualityAi['ai_alerts_url'] ?? (Plugin::getOnlineMonitorUrl() . '?tab=ai_alerts'))); ?>"><?= $escape(__('Monitor Online / Alertas IA', 'glpiintegaglpi')); ?></a>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <div class="card mb-3">
        <div class="card-header"><strong><?= $escape(__('Drill-downs operacionais', 'glpiintegaglpi')); ?></strong></div>
        <div class="card-body">
            <div class="row g-2">
                <?php foreach ($drilldowns as $drilldown) : ?>
                    <?php if (!is_array($drilldown)) { continue; } ?>
                    <div class="col-md-3">
                        <a class="btn btn-outline-secondary w-100 text-start" href="<?= $escape((string) ($drilldown['url'] ?? '#')); ?>">
                            <strong><?= $escape((string) ($drilldown['label'] ?? '-')); ?></strong>
                            <span class="d-block small text-muted"><?= $escape((string) ($drilldown['hint'] ?? '')); ?></span>
                        </a>
                    </div>
                <?php endforeach; ?>
            </div>
        </div>
    </div>

    <div class="card">
        <div class="card-body py-2">
            <div class="d-flex flex-wrap align-items-center gap-2">
                <strong class="me-2"><?= $escape(__('Rodapé técnico compacto', 'glpiintegaglpi')); ?></strong>
                <?php foreach ($technicalFooter as $item) : ?>
                    <?php if (!is_array($item)) { continue; } ?>
                    <a class="badge <?= $escape($statusClass((string) ($item['status'] ?? 'degraded'))); ?> text-decoration-none" href="<?= $escape((string) ($item['url'] ?? '#')); ?>">
                        <?= $escape((string) ($item['label'] ?? '-')); ?>: <?= $escape((string) ($item['status'] ?? '-')); ?>
                    </a>
                <?php endforeach; ?>
            </div>
            <div class="small text-muted mt-2">
                <?= $escape(__('PII Guard ativo: telefone/e-mail completos e payload bruto não aparecem. LogMeIn Reconciliation permanece OFF/provedor HTTP 500, sem botão de execução.', 'glpiintegaglpi')); ?>
            </div>
        </div>
    </div>
</div>
