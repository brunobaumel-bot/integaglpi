<?php

declare(strict_types=1);

/** @var \GlpiPlugin\Integaglpi\Renderer\ObservabilityRenderer $this */
/** @var array<string, mixed> $data */

$filters = is_array($data['filters'] ?? null) ? $data['filters'] : [];
$health = is_array($data['health'] ?? null) ? $data['health'] : [];
$environment = is_array($data['environment'] ?? null) ? $data['environment'] : [];
$cards = is_array($data['cards'] ?? null) ? $data['cards'] : [];
$latest = is_array($data['latest'] ?? null) ? $data['latest'] : [];
$events = is_array($data['events'] ?? null) ? $data['events'] : [];
$pagination = is_array($data['pagination'] ?? null) ? $data['pagination'] : [];
$safety = is_array($data['safety'] ?? null) ? $data['safety'] : [];
$error = trim((string) ($data['error'] ?? ''));
$page = (int) ($pagination['page'] ?? 1);
$limit = (int) ($pagination['limit'] ?? 20);
$total = (int) ($pagination['total'] ?? 0);
$totalPages = (int) ($pagination['total_pages'] ?? 1);

$node = is_array($health['node'] ?? null) ? $health['node'] : [];
$postgres = is_array($health['postgres'] ?? null) ? $health['postgres'] : [];
$redis = is_array($health['redis'] ?? null) ? $health['redis'] : [];
$glpiApi = is_array($health['glpi_api'] ?? null) ? $health['glpi_api'] : [];
$runtimeMismatch = is_array($health['runtime_mismatch'] ?? null) ? $health['runtime_mismatch'] : [];
$auditCards = is_array($cards['audit'] ?? null) ? $cards['audit'] : [];
$deliveryCards = is_array($cards['delivery'] ?? null) ? $cards['delivery'] : [];
$deadLetterCards = is_array($cards['dead_letter'] ?? null) ? $cards['dead_letter'] : [];
$webhookCards = is_array($cards['webhook'] ?? null) ? $cards['webhook'] : [];

$periodOptions = [1 => '24h', 7 => '7 dias', 30 => '30 dias'];
$severityOptions = [
    '' => __('Todas', 'glpiintegaglpi'),
    'info' => 'info',
    'warning' => 'warning',
    'error' => 'error',
    'critical' => 'critical',
];
$sourceOptions = [
    '' => __('Todas', 'glpiintegaglpi'),
    'audit_events' => 'audit_events',
    'dead_letter' => 'dead_letter',
    'delivery' => 'delivery',
];
$eventOptions = [
    '' => __('Todos', 'glpiintegaglpi'),
    'DROPPED_UNAUTHORIZED_NUMBER' => 'DROPPED_UNAUTHORIZED_NUMBER',
    'META_API_FAILED' => 'META_API_FAILED',
    'DELIVERY_FAILED' => 'DELIVERY_FAILED',
    'UNMATCHED_WAMID' => 'UNMATCHED_WAMID',
    'OAUTH_EXCEPTION' => 'OAUTH_EXCEPTION',
    'TEMPLATE_ERROR' => 'TEMPLATE_ERROR',
    'DEAD_LETTER' => 'DEAD_LETTER',
];

$badgeClass = static function (bool $ok): string {
    return $ok ? 'bg-success' : 'bg-warning text-dark';
};
$value = static function (array $source, string $key, mixed $fallback = 'n/a'): mixed {
    return $source[$key] ?? $fallback;
};
$formatJson = static function (mixed $payload): string {
    $encoded = json_encode($payload, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    return is_string($encoded) ? $encoded : '';
};
$environmentLabel = strtoupper((string) ($environment['integration_env'] ?? $environment['node_env'] ?? ''));
if ($environmentLabel === '') {
    $environmentLabel = __('NÃO DISPONÍVEL', 'glpiintegaglpi');
}
?>

<div class="d-flex align-items-center justify-content-between gap-3 mb-3">
    <div>
        <h2 class="mb-1"><?= $this->escape(__('Observabilidade WhatsApp / Meta', 'glpiintegaglpi')); ?></h2>
        <div class="text-muted">
            <?= $this->escape(__('Painel read-only para diagnosticar integração, delivery, Meta, GLPI API, Redis, PostgreSQL e runtime.', 'glpiintegaglpi')); ?>
        </div>
    </div>
    <div class="d-flex gap-2 align-items-center">
        <span class="badge bg-info text-dark"><?= $this->escape($environmentLabel); ?></span>
        <span class="badge bg-secondary"><?= $this->escape(__('Somente leitura', 'glpiintegaglpi')); ?></span>
    </div>
</div>

<?php if ($error !== '') : ?>
    <div class="alert alert-warning"><?= $this->escape($error); ?></div>
<?php endif; ?>

<div class="alert alert-info py-2">
    <?= $this->escape(__('Este painel não executa retry, reprocessamento, reenvio, fechamento, reabertura ou qualquer mutação operacional.', 'glpiintegaglpi')); ?>
</div>

<div class="row g-3 mb-3">
    <div class="col-md-3">
        <div class="card h-100">
            <div class="card-header">Integration-service / Node</div>
            <div class="card-body">
                <span class="badge <?= $badgeClass((bool) ($node['ok'] ?? false)); ?>"><?= $this->escape((bool) ($node['ok'] ?? false) ? 'ok' : 'attention'); ?></span>
                <div class="small text-muted mt-2">uptime: <?= (int) ($node['uptime_seconds'] ?? 0); ?>s</div>
                <div class="small text-muted">build: <?= $this->escape((string) ($node['build_id'] ?? 'n/a')); ?></div>
                <div class="small text-muted">memory rss: <?= (int) ((is_array($node['memory_mb'] ?? null) ? $node['memory_mb'] : [])['rss'] ?? 0); ?> MB</div>
            </div>
        </div>
    </div>
    <div class="col-md-3">
        <div class="card h-100">
            <div class="card-header">PostgreSQL</div>
            <div class="card-body">
                <span class="badge <?= $badgeClass((bool) ($postgres['ok'] ?? false)); ?>"><?= $this->escape((bool) ($postgres['ok'] ?? false) ? 'ok' : 'attention'); ?></span>
                <div class="small text-muted mt-2">latência: <?= $this->escape((string) ($postgres['latency_ms'] ?? 'n/a')); ?>ms</div>
            </div>
        </div>
    </div>
    <div class="col-md-3">
        <div class="card h-100">
            <div class="card-header">Redis</div>
            <div class="card-body">
                <span class="badge <?= $badgeClass((bool) ($redis['ok'] ?? false)); ?>"><?= $this->escape((bool) ($redis['ok'] ?? false) ? 'ok' : 'attention'); ?></span>
                <div class="small text-muted mt-2">status: <?= $this->escape((string) ($redis['client_status'] ?? 'n/a')); ?></div>
            </div>
        </div>
    </div>
    <div class="col-md-3">
        <div class="card h-100">
            <div class="card-header">GLPI API</div>
            <div class="card-body">
                <span class="badge <?= $badgeClass((bool) ($glpiApi['ok'] ?? false)); ?>"><?= $this->escape((bool) ($glpiApi['ok'] ?? false) ? 'ok' : 'attention'); ?></span>
                <div class="small text-muted mt-2">latência: <?= $this->escape((string) ($glpiApi['latency_ms'] ?? 'n/a')); ?>ms</div>
                <div class="small text-muted">cache: <?= $this->escape((string) ($glpiApi['cache_status'] ?? 'n/a')); ?></div>
            </div>
        </div>
    </div>
</div>

<div class="row g-3 mb-3">
    <div class="col-md-3">
        <div class="card h-100">
            <div class="card-header"><?= $this->escape(__('Webhook Guard', 'glpiintegaglpi')); ?></div>
            <div class="card-body">
                <div class="fs-3"><?= (int) $value($auditCards, 'webhook_guard_drops', 0); ?></div>
                <div class="text-muted small"><?= $this->escape(__('drops no período', 'glpiintegaglpi')); ?></div>
                <div class="text-muted small"><?= $this->escape(__('último inbound:', 'glpiintegaglpi')); ?> <?= $this->escape((string) $value($webhookCards, 'last_successful_inbound_at', 'n/a')); ?></div>
            </div>
        </div>
    </div>
    <div class="col-md-3">
        <div class="card h-100">
            <div class="card-header">Meta API errors</div>
            <div class="card-body">
                <div class="fs-3"><?= (int) $value($auditCards, 'meta_api_errors', 0); ?></div>
                <div class="text-muted small">META_API_FAILED / OAUTH / TEMPLATE</div>
            </div>
        </div>
    </div>
    <div class="col-md-3">
        <div class="card h-100">
            <div class="card-header">Delivery failed</div>
            <div class="card-body">
                <div class="fs-3"><?= (int) $value($deliveryCards, 'failed_messages', 0); ?></div>
                <div class="text-muted small"><?= $this->escape((string) $value($deliveryCards, 'last_failed_at', 'sem falha')); ?></div>
            </div>
        </div>
    </div>
    <div class="col-md-3">
        <div class="card h-100">
            <div class="card-header">Dead-letter</div>
            <div class="card-body">
                <div class="fs-3"><?= (int) $value($deadLetterCards, 'open_total', 0); ?></div>
                <div class="text-muted small"><?= $this->escape(__('abertos', 'glpiintegaglpi')); ?> / total <?= (int) $value($deadLetterCards, 'total', 0); ?></div>
            </div>
        </div>
    </div>
</div>

<div class="row g-3 mb-3">
    <div class="col-md-6">
        <div class="card h-100">
            <div class="card-header"><?= $this->escape(__('Runtime mismatch plugin ↔ Node', 'glpiintegaglpi')); ?></div>
            <div class="card-body">
                <div><strong>status:</strong> <?= $this->escape((string) ($runtimeMismatch['status'] ?? 'não disponível')); ?></div>
                <div><strong>node build:</strong> <?= $this->escape((string) ($runtimeMismatch['node_build_id'] ?? 'n/a')); ?></div>
                <div><strong>node package:</strong> <?= $this->escape((string) ($runtimeMismatch['node_package_id'] ?? 'n/a')); ?></div>
                <div class="text-muted small mt-2"><?= $this->escape(__('Comparação automática depende de manifest compatível entre plugin e Node.', 'glpiintegaglpi')); ?></div>
            </div>
        </div>
    </div>
    <div class="col-md-6">
        <div class="card h-100">
            <div class="card-header"><?= $this->escape(__('Últimos sinais críticos', 'glpiintegaglpi')); ?></div>
            <div class="card-body">
                <?php foreach ($latest as $key => $row) : ?>
                    <?php $row = is_array($row) ? $row : []; ?>
                    <div class="d-flex justify-content-between border-bottom py-1">
                        <span><?= $this->escape((string) $key); ?></span>
                        <span class="text-muted small"><?= $this->escape((string) ($row['created_at'] ?? 'n/a')); ?></span>
                    </div>
                <?php endforeach; ?>
            </div>
        </div>
    </div>
</div>

<div class="card mb-3">
    <div class="card-header"><?= $this->escape(__('Filtros', 'glpiintegaglpi')); ?></div>
    <div class="card-body">
        <form method="get" action="<?= $this->escape($this->getObservabilityUrl()); ?>">
            <div class="row g-3">
                <div class="col-md-2">
                    <label class="form-label"><?= $this->escape(__('Período', 'glpiintegaglpi')); ?></label>
                    <select class="form-select" name="period">
                        <?php foreach ($periodOptions as $period => $label) : ?>
                            <option value="<?= (int) $period; ?>" <?= ((int) ($filters['period'] ?? 1) === (int) $period) ? 'selected' : ''; ?>><?= $this->escape($label); ?></option>
                        <?php endforeach; ?>
                    </select>
                </div>
                <div class="col-md-2">
                    <label class="form-label"><?= $this->escape(__('Severidade', 'glpiintegaglpi')); ?></label>
                    <select class="form-select" name="severity">
                        <?php foreach ($severityOptions as $optionValue => $label) : ?>
                            <option value="<?= $this->escape((string) $optionValue); ?>" <?= ((string) ($filters['severity'] ?? '') === (string) $optionValue) ? 'selected' : ''; ?>><?= $this->escape($label); ?></option>
                        <?php endforeach; ?>
                    </select>
                </div>
                <div class="col-md-3">
                    <label class="form-label">event_type</label>
                    <select class="form-select" name="event_type">
                        <?php foreach ($eventOptions as $optionValue => $label) : ?>
                            <option value="<?= $this->escape((string) $optionValue); ?>" <?= ((string) ($filters['event_type'] ?? '') === (string) $optionValue) ? 'selected' : ''; ?>><?= $this->escape($label); ?></option>
                        <?php endforeach; ?>
                    </select>
                </div>
                <div class="col-md-2">
                    <label class="form-label"><?= $this->escape(__('Ticket ID', 'glpiintegaglpi')); ?></label>
                    <input class="form-control" type="number" min="1" name="ticket_id" value="<?= (int) ($filters['ticket_id'] ?? 0) ?: ''; ?>">
                </div>
                <div class="col-md-2">
                    <label class="form-label"><?= $this->escape(__('Telefone', 'glpiintegaglpi')); ?></label>
                    <input class="form-control" type="text" name="phone" value="<?= $this->escape((string) ($filters['phone'] ?? '')); ?>" placeholder="+55...">
                </div>
                <div class="col-md-2">
                    <label class="form-label"><?= $this->escape(__('Origem', 'glpiintegaglpi')); ?></label>
                    <select class="form-select" name="source">
                        <?php foreach ($sourceOptions as $optionValue => $label) : ?>
                            <option value="<?= $this->escape((string) $optionValue); ?>" <?= ((string) ($filters['source'] ?? '') === (string) $optionValue) ? 'selected' : ''; ?>><?= $this->escape($label); ?></option>
                        <?php endforeach; ?>
                    </select>
                </div>
                <div class="col-md-2">
                    <label class="form-label"><?= $this->escape(__('Por página', 'glpiintegaglpi')); ?></label>
                    <select class="form-select" name="limit">
                        <?php foreach ([20, 50] as $option) : ?>
                            <option value="<?= $option; ?>" <?= ((int) ($filters['limit'] ?? 20) === $option) ? 'selected' : ''; ?>><?= $option; ?></option>
                        <?php endforeach; ?>
                    </select>
                </div>
                <div class="col-md-3 d-flex align-items-end gap-2">
                    <button type="submit" class="btn btn-primary"><?= $this->escape(__('Aplicar', 'glpiintegaglpi')); ?></button>
                    <a class="btn btn-outline-secondary" href="<?= $this->escape($this->getObservabilityUrl()); ?>"><?= $this->escape(__('Limpar', 'glpiintegaglpi')); ?></a>
                </div>
            </div>
            <div class="form-text mt-2">
                <?= $this->escape(__('Consulta read-only, paginada no servidor. Nenhuma ação corretiva é exposta por este painel.', 'glpiintegaglpi')); ?>
            </div>
        </form>
    </div>
</div>

<div class="card">
    <div class="card-header d-flex justify-content-between">
        <span><?= $this->escape(__('Eventos observáveis', 'glpiintegaglpi')); ?></span>
        <span class="text-muted small"><?= $total; ?> total · página <?= $page; ?>/<?= $totalPages; ?></span>
    </div>
    <div class="table-responsive">
        <table class="table table-sm align-middle mb-0">
            <thead>
                <tr>
                    <th><?= $this->escape(__('Data', 'glpiintegaglpi')); ?></th>
                    <th><?= $this->escape(__('Origem', 'glpiintegaglpi')); ?></th>
                    <th>event_type</th>
                    <th><?= $this->escape(__('Sev.', 'glpiintegaglpi')); ?></th>
                    <th>status</th>
                    <th>ticket</th>
                    <th><?= $this->escape(__('Telefone', 'glpiintegaglpi')); ?></th>
                    <th><?= $this->escape(__('Erro sanitizado', 'glpiintegaglpi')); ?></th>
                    <th><?= $this->escape(__('Detalhe', 'glpiintegaglpi')); ?></th>
                </tr>
            </thead>
            <tbody>
            <?php if ($events === []) : ?>
                <tr><td colspan="9" class="text-muted"><?= $this->escape(__('Nenhum evento encontrado nos filtros atuais.', 'glpiintegaglpi')); ?></td></tr>
            <?php endif; ?>
            <?php foreach ($events as $event) : ?>
                <?php $event = is_array($event) ? $event : []; ?>
                <?php $ticketId = (int) ($event['ticket_id'] ?? 0); ?>
                <tr>
                    <td class="text-nowrap"><?= $this->escape((string) ($event['created_at'] ?? '')); ?></td>
                    <td><?= $this->escape((string) ($event['source'] ?? '')); ?></td>
                    <td><?= $this->escape((string) ($event['event_type'] ?? '')); ?></td>
                    <td><span class="badge bg-secondary"><?= $this->escape((string) ($event['severity'] ?? '')); ?></span></td>
                    <td><?= $this->escape((string) ($event['status'] ?? '')); ?></td>
                    <td>
                        <?php if ($ticketId > 0) : ?>
                            <a href="<?= $this->escape($this->getTicketUrl($ticketId)); ?>">#<?= $ticketId; ?></a>
                        <?php else : ?>
                            <span class="text-muted">-</span>
                        <?php endif; ?>
                    </td>
                    <td><?= $this->escape((string) ($event['phone_masked'] ?? '-')); ?></td>
                    <td style="max-width: 260px; white-space: normal;"><?= $this->escape((string) ($event['error_message'] ?? '')); ?></td>
                    <td>
                        <details>
                            <summary><?= $this->escape(__('ver', 'glpiintegaglpi')); ?></summary>
                            <pre class="small bg-light p-2 mt-2" style="max-width: 420px; max-height: 240px; overflow: auto;"><?= $this->escape($formatJson($event)); ?></pre>
                        </details>
                    </td>
                </tr>
            <?php endforeach; ?>
            </tbody>
        </table>
    </div>
    <div class="card-footer d-flex justify-content-between">
        <div class="text-muted small">
            <?= $this->escape(__('Payloads são truncados e chaves sensíveis são redigidas no integration-service.', 'glpiintegaglpi')); ?>
        </div>
        <div class="d-flex gap-2">
            <?php if ($page > 1) : ?>
                <a class="btn btn-sm btn-outline-secondary" href="<?= $this->escape($this->getPageUrl($filters, $page - 1)); ?>">&laquo; <?= $this->escape(__('Anterior', 'glpiintegaglpi')); ?></a>
            <?php endif; ?>
            <?php if ($page < $totalPages) : ?>
                <a class="btn btn-sm btn-outline-secondary" href="<?= $this->escape($this->getPageUrl($filters, $page + 1)); ?>"><?= $this->escape(__('Próxima', 'glpiintegaglpi')); ?> &raquo;</a>
            <?php endif; ?>
        </div>
    </div>
</div>

<div class="text-muted small mt-3">
    read_only=<?= $this->escape((bool) ($safety['read_only'] ?? true) ? 'true' : 'false'); ?> ·
    no_retry=<?= $this->escape((bool) ($safety['no_retry'] ?? true) ? 'true' : 'false'); ?> ·
    no_resend=<?= $this->escape((bool) ($safety['no_resend'] ?? true) ? 'true' : 'false'); ?> ·
    query_timeout_ms=<?= (int) ($safety['query_timeout_ms'] ?? 0); ?>
</div>
