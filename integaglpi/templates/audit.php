<?php

declare(strict_types=1);

/** @var \GlpiPlugin\Integaglpi\Renderer\OperationalAuditRenderer $this */
/** @var array<string, mixed> $data */

$filters = is_array($data['filters'] ?? null) ? $data['filters'] : [];
$pagination = is_array($data['pagination'] ?? null) ? $data['pagination'] : [];
$auditRows = is_array($data['audit_rows'] ?? null) ? $data['audit_rows'] : [];
$auditDetail = is_array($data['audit_detail'] ?? null) ? $data['audit_detail'] : null;
$deadLetterRows = is_array($data['dead_letter_rows'] ?? null) ? $data['dead_letter_rows'] : [];
$deadLetterDetail = is_array($data['dead_letter_detail'] ?? null) ? $data['dead_letter_detail'] : null;
$deadLetterAvailable = (bool) ($data['dead_letter_available'] ?? false);
$health = is_array($data['health'] ?? null) ? $data['health'] : [];
$healthCards = is_array($health['cards'] ?? null) ? $health['cards'] : [];
$riskList = is_array($health['risk_list'] ?? null) ? $health['risk_list'] : [];
$riskItems = is_array($riskList['items'] ?? null) ? $riskList['items'] : [];
$limitOptions = is_array($data['limit_options'] ?? null) ? $data['limit_options'] : [25, 50, 100];
$error = isset($data['error']) ? (string) $data['error'] : '';
$entityNotice = isset($data['entity_notice']) ? (string) $data['entity_notice'] : '';
$page = (int) ($pagination['page'] ?? 1);
$limit = (int) ($pagination['limit'] ?? 50);
$hasPrevious = (bool) ($pagination['has_previous'] ?? false);
$hasNext = (bool) ($pagination['has_next'] ?? false);
$auditUrl = $this->getAuditUrl();

$short = static function (mixed $value, int $max = 120): string {
    $text = trim((string) $value);
    if (strlen($text) <= $max) {
        return $text;
    }

    return substr($text, 0, $max) . '...';
};

$statusClass = static function (mixed $status): string {
    return match ((string) $status) {
        'ok' => 'success',
        'warning' => 'warning',
        'critical' => 'danger',
        default => 'secondary',
    };
};

$statusLabel = static function (mixed $status): string {
    return match ((string) $status) {
        'ok' => __('Saudável', 'glpiintegaglpi'),
        'warning' => __('Atenção', 'glpiintegaglpi'),
        'critical' => __('Crítico', 'glpiintegaglpi'),
        default => (string) $status,
    };
};
?>

<div class="d-flex align-items-center justify-content-between gap-3 mb-3">
    <div>
        <h2 class="mb-1"><?= $this->escape(__('Auditoria Operacional', 'glpiintegaglpi')); ?></h2>
        <div class="text-muted">
            <?= $this->escape(__('Consulta read-only de auditoria, correlação, falhas e dead-letter.', 'glpiintegaglpi')); ?>
        </div>
    </div>
</div>

<?php if ($entityNotice !== '') : ?>
    <div class="alert alert-info"><?= $this->escape($entityNotice); ?></div>
<?php endif; ?>

<?php if ($error !== '') : ?>
    <div class="alert alert-warning"><?= $this->escape($error); ?></div>
<?php endif; ?>

<div class="card mb-3">
    <div class="card-header d-flex align-items-center justify-content-between">
        <span><?= $this->escape(__('Saúde Operacional', 'glpiintegaglpi')); ?></span>
        <span class="text-muted small"><?= $this->escape(__('Janela fixa: últimas 24h', 'glpiintegaglpi')); ?></span>
    </div>
    <div class="card-body">
        <?php if ($healthCards === []) : ?>
            <div class="text-muted">
                <?= $this->escape(__('Saúde operacional indisponível até configurar o PostgreSQL externo.', 'glpiintegaglpi')); ?>
            </div>
        <?php else : ?>
            <div class="row g-3">
                <?php foreach ($healthCards as $card) : ?>
                    <?php
                    $cardStatus = (string) ($card['status'] ?? 'secondary');
                    $badgeClass = $statusClass($cardStatus);
                    $cardFilters = is_array($card['filters'] ?? null) ? $card['filters'] : [];
                    $cardLinks = is_array($card['links'] ?? null) ? $card['links'] : [];
                    ?>
                    <div class="col-md-6 col-xl-3">
                        <div class="border rounded p-3 h-100">
                            <div class="d-flex align-items-center justify-content-between gap-2 mb-2">
                                <div class="fw-bold"><?= $this->escape((string) ($card['title'] ?? '')); ?></div>
                                <span class="badge bg-<?= $this->escape($badgeClass); ?>">
                                    <?= $this->escape($statusLabel($cardStatus)); ?>
                                </span>
                            </div>
                            <div class="fs-3 fw-bold mb-1"><?= $this->escape((string) ($card['value'] ?? '')); ?></div>
                            <div class="text-muted small mb-2"><?= $this->escape((string) ($card['window'] ?? '')); ?></div>
                            <div class="small mb-2"><?= $this->escape((string) ($card['description'] ?? '')); ?></div>
                            <?php if ($cardFilters !== []) : ?>
                                <a class="small" href="<?= $this->escape($this->getHealthFilterUrl($cardFilters)); ?>">
                                    <?= $this->escape(__('Ver auditoria filtrada', 'glpiintegaglpi')); ?>
                                </a>
                            <?php endif; ?>
                            <?php if ($cardLinks !== []) : ?>
                                <div class="d-flex flex-wrap gap-2">
                                    <?php foreach ($cardLinks as $link) : ?>
                                        <?php
                                        $linkFilters = is_array($link['filters'] ?? null) ? $link['filters'] : [];
                                        if ($linkFilters === []) {
                                            continue;
                                        }
                                        ?>
                                        <a class="small" href="<?= $this->escape($this->getHealthFilterUrl($linkFilters)); ?>">
                                            <?= $this->escape((string) ($link['label'] ?? '')); ?>
                                        </a>
                                    <?php endforeach; ?>
                                </div>
                            <?php endif; ?>
                        </div>
                    </div>
                <?php endforeach; ?>
            </div>
        <?php endif; ?>
    </div>
</div>

<div class="card mb-3">
    <div class="card-header d-flex align-items-center justify-content-between">
        <span><?= $this->escape(__('Chamados em risco operacional WhatsApp', 'glpiintegaglpi')); ?></span>
        <span class="text-muted small"><?= $this->escape(__('Lista limitada e read-only', 'glpiintegaglpi')); ?></span>
    </div>
    <div class="card-body p-0">
        <?php if (empty($riskList['available'])) : ?>
            <div class="p-3 text-muted">
                <?= $this->escape((string) ($riskList['message'] ?? __('Chamados em risco indisponiveis.', 'glpiintegaglpi'))); ?>
            </div>
        <?php elseif ($riskItems === []) : ?>
            <div class="p-3 text-muted">
                <?= $this->escape(__('Sem dados', 'glpiintegaglpi')); ?>
            </div>
        <?php else : ?>
            <table class="table table-sm table-hover mb-0">
                <thead class="table-light">
                    <tr>
                        <th><?= $this->escape(__('Ticket', 'glpiintegaglpi')); ?></th>
                        <th><?= $this->escape(__('Risco', 'glpiintegaglpi')); ?></th>
                        <th><?= $this->escape(__('Motivo', 'glpiintegaglpi')); ?></th>
                        <th><?= $this->escape(__('Ultima interação WhatsApp', 'glpiintegaglpi')); ?></th>
                        <th><?= $this->escape(__('Status conversa', 'glpiintegaglpi')); ?></th>
                        <th><?= $this->escape(__('Ações read-only', 'glpiintegaglpi')); ?></th>
                    </tr>
                </thead>
                <tbody>
                <?php foreach ($riskItems as $item) : ?>
                    <?php
                    $risk = is_array($item['risk'] ?? null) ? $item['risk'] : [];
                    $riskLevel = (string) ($risk['risk_level'] ?? 'ok');
                    $ticketId = (int) ($item['ticket_id'] ?? 0);
                    ?>
                    <tr>
                        <td>#<?= $ticketId; ?></td>
                        <td>
                            <span class="badge bg-<?= $this->escape($statusClass($riskLevel)); ?>">
                                <?= $this->escape((string) ($risk['risk_label'] ?? $statusLabel($riskLevel))); ?>
                            </span>
                        </td>
                        <td><?= $this->escape((string) ($risk['risk_reason'] ?? '-')); ?></td>
                        <td>
                            <?= $this->escape((string) ($risk['last_interaction_age'] ?? '-')); ?>
                            <span class="text-muted small">
                                <?= $this->escape((string) ($item['last_interaction_at'] ?? '')); ?>
                            </span>
                        </td>
                        <td><?= $this->escape((string) ($item['conversation_status'] ?? '-')); ?></td>
                        <td>
                            <?php if ($ticketId > 0) : ?>
                                <a
                                    class="small me-2"
                                    href="<?= $this->escape($this->getTicketUrl($ticketId)); ?>"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                >
                                    <?= $this->escape(__('Abrir ticket', 'glpiintegaglpi')); ?>
                                </a>
                                <a
                                    class="small"
                                    href="<?= $this->escape($this->getAuditUrlForTicket($ticketId)); ?>"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                >
                                    <?= $this->escape(__('Ver auditoria', 'glpiintegaglpi')); ?>
                                </a>
                            <?php endif; ?>
                        </td>
                    </tr>
                <?php endforeach; ?>
                </tbody>
            </table>
        <?php endif; ?>
    </div>
</div>

<div class="card mb-3">
    <div class="card-header"><?= $this->escape(__('Filtros', 'glpiintegaglpi')); ?></div>
    <div class="card-body">
        <form method="get" action="<?= $this->escape($auditUrl); ?>">
            <div class="row g-3">
                <div class="col-md-2">
                    <label class="form-label"><?= $this->escape(__('Ticket ID', 'glpiintegaglpi')); ?></label>
                    <input type="number" min="1" name="ticket_id" class="form-control" value="<?= (int) ($filters['ticket_id'] ?? 0) ?: ''; ?>">
                </div>
                <div class="col-md-4">
                    <label class="form-label"><?= $this->escape(__('Correlation ID', 'glpiintegaglpi')); ?></label>
                    <input type="text" name="correlation_id" class="form-control" maxlength="160" value="<?= $this->escape((string) ($filters['correlation_id'] ?? '')); ?>">
                </div>
                <div class="col-md-3">
                    <label class="form-label"><?= $this->escape(__('Data inicial', 'glpiintegaglpi')); ?></label>
                    <input type="datetime-local" name="date_from" class="form-control" value="<?= $this->escape((string) ($filters['date_from'] ?? '')); ?>">
                </div>
                <div class="col-md-3">
                    <label class="form-label"><?= $this->escape(__('Data final', 'glpiintegaglpi')); ?></label>
                    <input type="datetime-local" name="date_to" class="form-control" value="<?= $this->escape((string) ($filters['date_to'] ?? '')); ?>">
                </div>

                <div class="col-md-3">
                    <label class="form-label"><?= $this->escape(__('Event type', 'glpiintegaglpi')); ?></label>
                    <input type="text" name="event_type" class="form-control" maxlength="120" value="<?= $this->escape((string) ($filters['event_type'] ?? '')); ?>">
                </div>
                <div class="col-md-2">
                    <label class="form-label"><?= $this->escape(__('Severity', 'glpiintegaglpi')); ?></label>
                    <select name="severity" class="form-select">
                        <?php foreach (['' => 'Todos', 'info' => 'info', 'warning' => 'warning', 'error' => 'error', 'critical' => 'critical'] as $value => $label) : ?>
                            <option value="<?= $this->escape($value); ?>" <?= (string) ($filters['severity'] ?? '') === $value ? 'selected' : ''; ?>>
                                <?= $this->escape($label); ?>
                            </option>
                        <?php endforeach; ?>
                    </select>
                </div>
                <div class="col-md-2">
                    <label class="form-label"><?= $this->escape(__('Status', 'glpiintegaglpi')); ?></label>
                    <input type="text" name="status" class="form-control" maxlength="32" value="<?= $this->escape((string) ($filters['status'] ?? '')); ?>">
                </div>
                <div class="col-md-3">
                    <label class="form-label"><?= $this->escape(__('Source', 'glpiintegaglpi')); ?></label>
                    <input type="text" name="source" class="form-control" maxlength="120" value="<?= $this->escape((string) ($filters['source'] ?? '')); ?>">
                </div>
                <div class="col-md-2">
                    <label class="form-label"><?= $this->escape(__('Limit', 'glpiintegaglpi')); ?></label>
                    <select name="limit" class="form-select">
                        <?php foreach ($limitOptions as $option) : ?>
                            <?php $option = (int) $option; ?>
                            <option value="<?= $option; ?>" <?= $limit === $option ? 'selected' : ''; ?>><?= $option; ?></option>
                        <?php endforeach; ?>
                    </select>
                </div>

                <div class="col-md-4">
                    <label class="form-label"><?= $this->escape(__('Conversation ID', 'glpiintegaglpi')); ?></label>
                    <input type="text" name="conversation_id" class="form-control" maxlength="160" value="<?= $this->escape((string) ($filters['conversation_id'] ?? '')); ?>">
                </div>
                <div class="col-md-4">
                    <label class="form-label"><?= $this->escape(__('Message ID', 'glpiintegaglpi')); ?></label>
                    <input type="text" name="message_id" class="form-control" maxlength="220" value="<?= $this->escape((string) ($filters['message_id'] ?? '')); ?>">
                </div>
                <div class="col-md-4 d-flex align-items-end">
                    <div class="form-check">
                        <input type="checkbox" name="only_errors" value="1" id="itg-audit-only-errors" class="form-check-input" <?= !empty($filters['only_errors']) ? 'checked' : ''; ?>>
                        <label for="itg-audit-only-errors" class="form-check-label">
                            <?= $this->escape(__('Somente erros', 'glpiintegaglpi')); ?>
                        </label>
                    </div>
                </div>

                <div class="col-12 d-flex gap-2">
                    <button type="submit" class="btn btn-primary">
                        <?= $this->escape(__('Filtrar', 'glpiintegaglpi')); ?>
                    </button>
                    <a href="<?= $this->escape($auditUrl); ?>" class="btn btn-outline-secondary">
                        <?= $this->escape(__('Limpar', 'glpiintegaglpi')); ?>
                    </a>
                </div>
            </div>
        </form>
    </div>
</div>

<?php if ($auditDetail !== null) : ?>
    <div class="card mb-3">
        <div class="card-header"><?= $this->escape(__('Payload sanitizado do evento', 'glpiintegaglpi')); ?> #<?= (int) ($auditDetail['id'] ?? 0); ?></div>
        <div class="card-body">
            <pre class="bg-light border rounded p-3 mb-0" style="white-space: pre-wrap; max-height: 360px; overflow: auto;"><?= $this->escape($this->renderPayload($auditDetail['payload_json'] ?? null)); ?></pre>
        </div>
    </div>
<?php endif; ?>

<div class="card mb-4">
    <div class="card-header"><?= $this->escape(__('Eventos de auditoria', 'glpiintegaglpi')); ?></div>
    <div class="card-body p-0">
        <table class="table table-sm table-hover mb-0">
            <thead class="table-light">
                <tr>
                    <th><?= $this->escape(__('Criado em', 'glpiintegaglpi')); ?></th>
                    <th><?= $this->escape(__('Correlation', 'glpiintegaglpi')); ?></th>
                    <th><?= $this->escape(__('Ticket', 'glpiintegaglpi')); ?></th>
                    <th><?= $this->escape(__('Conversation', 'glpiintegaglpi')); ?></th>
                    <th><?= $this->escape(__('Message', 'glpiintegaglpi')); ?></th>
                    <th><?= $this->escape(__('Event', 'glpiintegaglpi')); ?></th>
                    <th><?= $this->escape(__('Status', 'glpiintegaglpi')); ?></th>
                    <th><?= $this->escape(__('Severity', 'glpiintegaglpi')); ?></th>
                    <th><?= $this->escape(__('Source', 'glpiintegaglpi')); ?></th>
                    <th><?= $this->escape(__('Erro', 'glpiintegaglpi')); ?></th>
                    <th><?= $this->escape(__('Detalhe', 'glpiintegaglpi')); ?></th>
                </tr>
            </thead>
            <tbody>
            <?php if ($auditRows === []) : ?>
                <tr>
                    <td colspan="11" class="text-center text-muted p-3">
                        <?= $this->escape(__('Sem dados', 'glpiintegaglpi')); ?>
                    </td>
                </tr>
            <?php endif; ?>
            <?php foreach ($auditRows as $row) : ?>
                <?php
                $correlationId = (string) ($row['correlation_id'] ?? '');
                $rowId = (int) ($row['id'] ?? 0);
                ?>
                <tr>
                    <td><?= $this->escape((string) ($row['created_at'] ?? '')); ?></td>
                    <td>
                        <code><?= $this->escape($short($correlationId, 36)); ?></code>
                        <?php if ($correlationId !== '') : ?>
                            <button type="button" class="btn btn-link btn-sm p-0 ms-1 js-itg-copy-correlation" data-correlation="<?= $this->escape($correlationId); ?>">
                                <?= $this->escape(__('copiar', 'glpiintegaglpi')); ?>
                            </button>
                        <?php endif; ?>
                    </td>
                    <td><?= (int) ($row['ticket_id'] ?? 0) ?: '-'; ?></td>
                    <td><code><?= $this->escape($short($row['conversation_id'] ?? '', 34)); ?></code></td>
                    <td><code><?= $this->escape($short($row['message_id'] ?? '', 34)); ?></code></td>
                    <td><span class="badge bg-secondary"><?= $this->escape((string) ($row['event_type'] ?? '')); ?></span></td>
                    <td><?= $this->escape((string) ($row['status'] ?? '')); ?></td>
                    <td><?= $this->escape((string) ($row['severity'] ?? '')); ?></td>
                    <td><?= $this->escape((string) ($row['source'] ?? '')); ?></td>
                    <td><?= $this->escape($short($row['error_message'] ?? '', 90)); ?></td>
                    <td>
                        <?php if ($rowId > 0) : ?>
                            <a class="btn btn-sm btn-outline-secondary" href="<?= $this->escape($this->getDetailUrl($filters, 'audit_detail_id', $rowId, $page, $limit)); ?>">
                                <?= $this->escape(__('Ver payload', 'glpiintegaglpi')); ?>
                            </a>
                        <?php endif; ?>
                    </td>
                </tr>
            <?php endforeach; ?>
            </tbody>
        </table>
    </div>
</div>

<div class="card mb-4">
    <div class="card-header"><?= $this->escape(__('Dead-letter', 'glpiintegaglpi')); ?></div>
    <div class="card-body p-0">
        <?php if (!$deadLetterAvailable) : ?>
            <div class="p-3 text-muted"><?= $this->escape(__('Dead-letter não disponível nesta instalação.', 'glpiintegaglpi')); ?></div>
        <?php else : ?>
            <?php if ($deadLetterDetail !== null) : ?>
                <div class="p-3 border-bottom">
                    <strong><?= $this->escape(__('Payload sanitizado do dead-letter', 'glpiintegaglpi')); ?> #<?= (int) ($deadLetterDetail['id'] ?? 0); ?></strong>
                    <pre class="bg-light border rounded p-3 mt-2 mb-0" style="white-space: pre-wrap; max-height: 320px; overflow: auto;"><?= $this->escape($this->renderPayload($deadLetterDetail['payload_json'] ?? null)); ?></pre>
                </div>
            <?php endif; ?>
            <table class="table table-sm table-hover mb-0">
                <thead class="table-light">
                    <tr>
                        <th><?= $this->escape(__('Criado em', 'glpiintegaglpi')); ?></th>
                        <th><?= $this->escape(__('Status', 'glpiintegaglpi')); ?></th>
                        <th><?= $this->escape(__('Operation', 'glpiintegaglpi')); ?></th>
                        <th><?= $this->escape(__('Failure', 'glpiintegaglpi')); ?></th>
                        <th><?= $this->escape(__('Reason', 'glpiintegaglpi')); ?></th>
                        <th><?= $this->escape(__('Retry', 'glpiintegaglpi')); ?></th>
                        <th><?= $this->escape(__('Correlation', 'glpiintegaglpi')); ?></th>
                        <th><?= $this->escape(__('Ticket', 'glpiintegaglpi')); ?></th>
                        <th><?= $this->escape(__('Conversation', 'glpiintegaglpi')); ?></th>
                        <th><?= $this->escape(__('Message', 'glpiintegaglpi')); ?></th>
                        <th><?= $this->escape(__('Detalhe', 'glpiintegaglpi')); ?></th>
                    </tr>
                </thead>
                <tbody>
                <?php if ($deadLetterRows === []) : ?>
                    <tr>
                        <td colspan="11" class="text-center text-muted p-3">
                            <?= $this->escape(__('Sem dados', 'glpiintegaglpi')); ?>
                        </td>
                    </tr>
                <?php endif; ?>
                <?php foreach ($deadLetterRows as $row) : ?>
                    <?php $rowId = (int) ($row['id'] ?? 0); ?>
                    <tr>
                        <td><?= $this->escape((string) ($row['created_at'] ?? '')); ?></td>
                        <td><?= $this->escape((string) ($row['status'] ?? '')); ?></td>
                        <td><?= $this->escape((string) ($row['operation_type'] ?? '')); ?></td>
                        <td><?= $this->escape((string) ($row['failure_type'] ?? '')); ?></td>
                        <td><?= $this->escape($short($row['failure_reason'] ?? '', 120)); ?></td>
                        <td><?= (int) ($row['retry_count'] ?? 0); ?></td>
                        <td><code><?= $this->escape($short($row['correlation_id'] ?? '', 34)); ?></code></td>
                        <td><?= (int) ($row['ticket_id'] ?? 0) ?: '-'; ?></td>
                        <td><code><?= $this->escape($short($row['conversation_id'] ?? '', 34)); ?></code></td>
                        <td><code><?= $this->escape($short($row['message_id'] ?? '', 34)); ?></code></td>
                        <td>
                            <?php if ($rowId > 0) : ?>
                                <a class="btn btn-sm btn-outline-secondary" href="<?= $this->escape($this->getDetailUrl($filters, 'dead_letter_detail_id', $rowId, $page, $limit)); ?>">
                                    <?= $this->escape(__('Ver payload', 'glpiintegaglpi')); ?>
                                </a>
                            <?php endif; ?>
                        </td>
                    </tr>
                <?php endforeach; ?>
                </tbody>
            </table>
        <?php endif; ?>
    </div>
</div>

<div class="d-flex justify-content-between align-items-center mb-4">
    <div class="text-muted">
        <?= $this->escape(__('Ordenação fixa por created_at DESC. Total exato omitido para evitar COUNT pesado.', 'glpiintegaglpi')); ?>
    </div>
    <div class="btn-group">
        <?php if ($hasPrevious) : ?>
            <a class="btn btn-outline-secondary" href="<?= $this->escape($this->getPageUrl($filters, max(1, $page - 1), $limit)); ?>">
                <?= $this->escape(__('Anterior', 'glpiintegaglpi')); ?>
            </a>
        <?php endif; ?>
        <span class="btn btn-outline-secondary disabled">Página <?= $page; ?></span>
        <?php if ($hasNext) : ?>
            <a class="btn btn-outline-secondary" href="<?= $this->escape($this->getPageUrl($filters, $page + 1, $limit)); ?>">
                <?= $this->escape(__('Próxima', 'glpiintegaglpi')); ?>
            </a>
        <?php endif; ?>
    </div>
</div>

<script>
(function () {
    document.addEventListener('click', function (event) {
        var button = event.target.closest('.js-itg-copy-correlation');
        if (!button || !navigator.clipboard) {
            return;
        }
        event.preventDefault();
        navigator.clipboard.writeText(button.getAttribute('data-correlation') || '');
    });
}());
</script>
