<?php

declare(strict_types=1);

/** @var \GlpiPlugin\Integaglpi\Renderer\SupervisorBackofficeRenderer $this */
/** @var array<string, mixed> $data */

$filters = is_array($data['filters'] ?? null) ? $data['filters'] : [];
$kpis = is_array($data['kpis'] ?? null) ? $data['kpis'] : [];
$reviewRows = is_array($data['review_rows'] ?? null) ? $data['review_rows'] : [];
$technicianRows = is_array($data['technician_rows'] ?? null) ? $data['technician_rows'] : [];
$queues = is_array($data['queues'] ?? null) ? $data['queues'] : [];
$pagination = is_array($data['pagination'] ?? null) ? $data['pagination'] : [];
$error = trim((string) ($data['error'] ?? ''));
$entityScopeLabel = (string) ($data['entity_scope_label'] ?? '');
$reviewTotal = (int) ($data['review_total'] ?? 0);
$page = (int) ($pagination['page'] ?? 1);
$limit = (int) ($pagination['limit'] ?? 25);
$hasPrevious = (bool) ($pagination['has_previous'] ?? false);
$hasNext = (bool) ($pagination['has_next'] ?? false);
$aiSupervisorEnabled = (bool) ($data['ai_supervisor_enabled'] ?? false);

$kpiCards = [
    ['label' => __('Chamados WhatsApp', 'glpiintegaglpi'), 'value' => (int) ($kpis['total_tickets'] ?? 0), 'class' => 'primary'],
    ['label' => __('Abertos', 'glpiintegaglpi'), 'value' => (int) ($kpis['open_tickets'] ?? 0), 'class' => 'info'],
    ['label' => __('Solucionados', 'glpiintegaglpi'), 'value' => (int) ($kpis['solved_tickets'] ?? 0), 'class' => 'success'],
    ['label' => __('Fechados', 'glpiintegaglpi'), 'value' => (int) ($kpis['closed_tickets'] ?? 0), 'class' => 'secondary'],
    ['label' => __('CSAT insatisfeito', 'glpiintegaglpi'), 'value' => (int) ($kpis['dissatisfied_tickets'] ?? 0), 'class' => 'danger'],
    ['label' => __('Revisão supervisor', 'glpiintegaglpi'), 'value' => (int) ($kpis['supervisor_review_tickets'] ?? 0), 'class' => 'warning'],
    ['label' => __('Encerrados por inatividade', 'glpiintegaglpi'), 'value' => (int) ($kpis['inactivity_autoclose_tickets'] ?? 0), 'class' => 'dark'],
    ['label' => __('Falha/atenção inatividade', 'glpiintegaglpi'), 'value' => (int) ($kpis['inactivity_attention_tickets'] ?? 0), 'class' => 'danger'],
    ['label' => __('Risco operacional', 'glpiintegaglpi'), 'value' => (int) ($kpis['operational_risk_tickets'] ?? 0), 'class' => 'danger'],
];

$qualityOptions = [
    '' => __('Todos os riscos', 'glpiintegaglpi'),
    'csat_dissatisfied' => __('CSAT insatisfeito', 'glpiintegaglpi'),
    'supervisor_review' => __('Revisão de supervisor', 'glpiintegaglpi'),
    'inactivity_failed' => __('Falha de inatividade', 'glpiintegaglpi'),
    'inactivity_autoclose' => __('Encerrado por inatividade', 'glpiintegaglpi'),
    'critical_error' => __('Erro crítico', 'glpiintegaglpi'),
];

$statusOptions = [
    '' => __('Todos', 'glpiintegaglpi'),
    'open' => __('Aberto', 'glpiintegaglpi'),
    'closed' => __('Fechado', 'glpiintegaglpi'),
    'awaiting_queue_selection' => __('Aguardando fila', 'glpiintegaglpi'),
    'awaiting_entity_selection' => __('Aguardando entidade', 'glpiintegaglpi'),
];
?>

<div class="d-flex align-items-center justify-content-between gap-3 mb-3">
    <div>
        <h2 class="mb-1"><?= $this->escape(__('Backoffice Supervisor WhatsApp', 'glpiintegaglpi')); ?></h2>
        <div class="text-muted">
            <?= $this->escape(__('Painel read-only de qualidade, CSAT, inatividade e produtividade básica.', 'glpiintegaglpi')); ?>
        </div>
    </div>
    <div class="d-flex align-items-center gap-2">
        <a class="btn btn-outline-secondary" href="<?= $this->escape($this->getContractHoursUrl()); ?>">
            <?= $this->escape(__('Contratos e Horas', 'glpiintegaglpi')); ?>
        </a>
        <span class="badge bg-secondary">
            <?= $this->escape(__('Escopo:', 'glpiintegaglpi') . ' ' . $entityScopeLabel); ?>
        </span>
    </div>
</div>

<?php if ($error !== '') : ?>
    <div class="alert alert-warning"><?= $this->escape($error); ?></div>
<?php endif; ?>

<div class="card mb-3">
    <div class="card-header"><?= $this->escape(__('Filtros', 'glpiintegaglpi')); ?></div>
    <div class="card-body">
        <form method="get" action="<?= $this->escape($this->getSupervisorBackofficeUrl()); ?>">
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
                    <label class="form-label"><?= $this->escape(__('Técnico ID', 'glpiintegaglpi')); ?></label>
                    <input class="form-control" type="number" min="1" name="agent_id" value="<?= (int) ($filters['agent_id'] ?? 0) ?: ''; ?>">
                </div>
                <div class="col-md-2">
                    <label class="form-label"><?= $this->escape(__('Entidade ID', 'glpiintegaglpi')); ?></label>
                    <input class="form-control" type="number" min="1" name="entity_id" value="<?= (int) ($filters['entity_id'] ?? 0) ?: ''; ?>">
                </div>
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
                    <label class="form-label"><?= $this->escape(__('Status', 'glpiintegaglpi')); ?></label>
                    <select class="form-select" name="status">
                        <?php foreach ($statusOptions as $value => $label) : ?>
                            <option value="<?= $this->escape($value); ?>" <?= ((string) ($filters['status'] ?? '') === $value) ? 'selected' : ''; ?>>
                                <?= $this->escape($label); ?>
                            </option>
                        <?php endforeach; ?>
                    </select>
                </div>
                <div class="col-md-3">
                    <label class="form-label"><?= $this->escape(__('Qualidade', 'glpiintegaglpi')); ?></label>
                    <select class="form-select" name="quality">
                        <?php foreach ($qualityOptions as $value => $label) : ?>
                            <option value="<?= $this->escape($value); ?>" <?= ((string) ($filters['quality'] ?? '') === $value) ? 'selected' : ''; ?>>
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
                <div class="col-md-3 d-flex align-items-end gap-2">
                    <button type="submit" class="btn btn-primary">
                        <?= $this->escape(__('Aplicar filtros', 'glpiintegaglpi')); ?>
                    </button>
                    <a class="btn btn-outline-secondary" href="<?= $this->escape($this->getSupervisorBackofficeUrl()); ?>">
                        <?= $this->escape(__('Limpar', 'glpiintegaglpi')); ?>
                    </a>
                </div>
            </div>
            <div class="form-text mt-2">
                <?= $this->escape(__('Período padrão: últimos 30 dias. Janela máxima aplicada: 90 dias.', 'glpiintegaglpi')); ?>
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
                    <?= (int) $card['value']; ?>
                </div>
            </div>
        </div>
    <?php endforeach; ?>
</div>

<div class="card mb-3">
    <div class="card-header d-flex align-items-center justify-content-between">
        <span><?= $this->escape(__('Chamados para revisão', 'glpiintegaglpi')); ?></span>
        <span class="text-muted small"><?= $reviewTotal; ?> <?= $this->escape(__('registro(s)', 'glpiintegaglpi')); ?></span>
    </div>
    <div class="card-body p-0">
        <?php if ($reviewRows === []) : ?>
            <div class="p-3 text-muted"><?= $this->escape(__('Sem chamados para revisão no período filtrado.', 'glpiintegaglpi')); ?></div>
        <?php else : ?>
            <div class="table-responsive">
                <table class="table table-sm table-hover mb-0">
                    <thead class="table-light">
                        <tr>
                            <th><?= $this->escape(__('Ticket', 'glpiintegaglpi')); ?></th>
                            <th><?= $this->escape(__('Motivos', 'glpiintegaglpi')); ?></th>
                            <th><?= $this->escape(__('Cliente', 'glpiintegaglpi')); ?></th>
                            <th><?= $this->escape(__('Telefone', 'glpiintegaglpi')); ?></th>
                            <th><?= $this->escape(__('E-mail', 'glpiintegaglpi')); ?></th>
                            <th><?= $this->escape(__('Fila / Técnico', 'glpiintegaglpi')); ?></th>
                            <th><?= $this->escape(__('Entidade', 'glpiintegaglpi')); ?></th>
                            <th><?= $this->escape(__('IA', 'glpiintegaglpi')); ?></th>
                            <th><?= $this->escape(__('Última atividade', 'glpiintegaglpi')); ?></th>
                            <th><?= $this->escape(__('Ações', 'glpiintegaglpi')); ?></th>
                        </tr>
                    </thead>
                    <tbody>
                        <?php foreach ($reviewRows as $row) : ?>
                            <?php
                            $ticketId = (int) ($row['glpi_ticket_id'] ?? 0);
                            $reasons = is_array($row['review_reasons'] ?? null) ? $row['review_reasons'] : [];
                            $aiQuality = is_array($row['ai_quality'] ?? null) ? $row['ai_quality'] : null;
                            $aiResult = [];
                            if ($aiQuality !== null) {
                                $rawAiResult = $aiQuality['result_json'] ?? null;
                                if (is_string($rawAiResult) && trim($rawAiResult) !== '') {
                                    $decodedAiResult = json_decode($rawAiResult, true);
                                    $aiResult = is_array($decodedAiResult) ? $decodedAiResult : [];
                                } elseif (is_array($rawAiResult)) {
                                    $aiResult = $rawAiResult;
                                }
                            }
                            ?>
                            <tr>
                                <td>#<?= $ticketId; ?></td>
                                <td>
                                    <?php foreach ($reasons as $reason) : ?>
                                        <span class="badge bg-warning text-dark me-1"><?= $this->escape((string) $reason); ?></span>
                                    <?php endforeach; ?>
                                </td>
                                <td>
                                    <div><?= $this->escape((string) ($row['requester_name'] ?? '-')); ?></div>
                                    <div class="text-muted small"><?= $this->escape((string) ($row['company_name_raw'] ?? '')); ?></div>
                                </td>
                                <td><?= $this->escape((string) ($row['phone_masked'] ?? '')); ?></td>
                                <td><?= $this->escape((string) ($row['email_masked'] ?? '')); ?></td>
                                <td>
                                    <div><?= $this->escape((string) ($row['queue_name'] ?? '-')); ?></div>
                                    <div class="text-muted small"><?= $this->escape((string) ($row['assigned_user_name'] ?? '-')); ?></div>
                                </td>
                                <td>
                                    <div><?= $this->escape((string) ($row['entity_name'] ?? '-')); ?></div>
                                    <div class="text-muted small">ID <?= (int) ($row['entity_id'] ?? 0); ?></div>
                                </td>
                                <td>
                                    <?php if ($aiQuality !== null) : ?>
                                        <span class="badge bg-secondary"><?= $this->escape((string) ($aiQuality['status'] ?? '-')); ?></span>
                                        <div class="small text-muted"><?= $this->escape((string) ($aiQuality['summary'] ?? '')); ?></div>
                                        <?php if ($aiResult !== []) : ?>
                                            <div class="small">
                                                <?= $this->escape(__('Risco', 'glpiintegaglpi')); ?>:
                                                <?= $this->escape((string) ($aiResult['riskLevel'] ?? $aiResult['risk_level'] ?? '-')); ?>
                                                · <?= $this->escape(__('Urgência', 'glpiintegaglpi')); ?>:
                                                <?= $this->escape((string) ($aiResult['urgency'] ?? '-')); ?>
                                            </div>
                                            <div class="small text-muted">
                                                <?= $this->escape(__('Próxima ação', 'glpiintegaglpi')); ?>:
                                                <?= $this->escape((string) ($aiResult['suggestedNextAction'] ?? $aiResult['suggested_next_action'] ?? $aiQuality['recommendation'] ?? '-')); ?>
                                            </div>
                                        <?php endif; ?>
                                    <?php elseif ($aiSupervisorEnabled && $ticketId > 0 && trim((string) ($row['conversation_id'] ?? '')) !== '') : ?>
                                        <form method="post" action="<?= $this->escape($this->getAiQualityUrl()); ?>">
                                            <?= \GlpiPlugin\Integaglpi\Plugin::renderCsrfToken(); ?>
                                            <input type="hidden" name="action" value="analyze">
                                            <input type="hidden" name="ticket_id" value="<?= $ticketId; ?>">
                                            <input type="hidden" name="conversation_id" value="<?= $this->escape((string) ($row['conversation_id'] ?? '')); ?>">
                                            <button type="submit" class="btn btn-sm btn-outline-primary">
                                                <?= $this->escape(__('Analisar conversa', 'glpiintegaglpi')); ?>
                                            </button>
                                        </form>
                                    <?php else : ?>
                                        <span class="text-muted small">-</span>
                                    <?php endif; ?>
                                </td>
                                <td><?= $this->escape((string) ($row['last_message_at'] ?? '-')); ?></td>
                                <td>
                                    <?php if ($ticketId > 0) : ?>
                                        <a class="small me-2" href="<?= $this->escape($this->getTicketUrl($ticketId)); ?>" target="_blank" rel="noopener noreferrer">
                                            <?= $this->escape(__('Ticket', 'glpiintegaglpi')); ?>
                                        </a>
                                        <a class="small" href="<?= $this->escape($this->getTicketContextUrl($ticketId)); ?>" target="_blank" rel="noopener noreferrer">
                                            <?= $this->escape(__('Contexto WhatsApp', 'glpiintegaglpi')); ?>
                                        </a>
                                    <?php endif; ?>
                                </td>
                            </tr>
                        <?php endforeach; ?>
                    </tbody>
                </table>
            </div>
        <?php endif; ?>
    </div>
    <div class="card-footer d-flex justify-content-between align-items-center">
        <span class="text-muted small">
            <?= $this->escape(__('Página', 'glpiintegaglpi')); ?> <?= $page; ?> · <?= $limit; ?> <?= $this->escape(__('por página', 'glpiintegaglpi')); ?>
        </span>
        <div class="btn-group">
            <a class="btn btn-outline-secondary btn-sm <?= $hasPrevious ? '' : 'disabled'; ?>" href="<?= $this->escape($this->getPageUrl($filters, max(1, $page - 1))); ?>">
                <?= $this->escape(__('Anterior', 'glpiintegaglpi')); ?>
            </a>
            <a class="btn btn-outline-secondary btn-sm <?= $hasNext ? '' : 'disabled'; ?>" href="<?= $this->escape($this->getPageUrl($filters, $page + 1)); ?>">
                <?= $this->escape(__('Próxima', 'glpiintegaglpi')); ?>
            </a>
        </div>
    </div>
</div>

<div class="card mb-3">
    <div class="card-header"><?= $this->escape(__('Desempenho por técnico', 'glpiintegaglpi')); ?></div>
    <div class="card-body p-0">
        <?php if ($technicianRows === []) : ?>
            <div class="p-3 text-muted"><?= $this->escape(__('Sem dados de técnico no período filtrado.', 'glpiintegaglpi')); ?></div>
        <?php else : ?>
            <div class="table-responsive">
                <table class="table table-sm table-hover mb-0">
                    <thead class="table-light">
                        <tr>
                            <th><?= $this->escape(__('Técnico', 'glpiintegaglpi')); ?></th>
                            <th><?= $this->escape(__('Total', 'glpiintegaglpi')); ?></th>
                            <th><?= $this->escape(__('Solucionados/fechados', 'glpiintegaglpi')); ?></th>
                            <th><?= $this->escape(__('CSAT insatisfeito', 'glpiintegaglpi')); ?></th>
                            <th><?= $this->escape(__('Revisão supervisor', 'glpiintegaglpi')); ?></th>
                        </tr>
                    </thead>
                    <tbody>
                        <?php foreach ($technicianRows as $row) : ?>
                            <tr>
                                <td><?= $this->escape((string) ($row['assigned_user_name'] ?? '-')); ?></td>
                                <td><?= (int) ($row['total_tickets'] ?? 0); ?></td>
                                <td><?= (int) ($row['resolved_or_closed_tickets'] ?? 0); ?></td>
                                <td><?= (int) ($row['dissatisfied_tickets'] ?? 0); ?></td>
                                <td><?= (int) ($row['supervisor_review_tickets'] ?? 0); ?></td>
                            </tr>
                        <?php endforeach; ?>
                    </tbody>
                </table>
            </div>
        <?php endif; ?>
    </div>
</div>
