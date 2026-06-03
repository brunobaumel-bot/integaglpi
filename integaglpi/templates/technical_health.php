<?php

declare(strict_types=1);

use GlpiPlugin\Integaglpi\Plugin;

/** @var array<string, mixed> $snapshot */

$escape = static fn (mixed $v): string => htmlspecialchars((string) $v, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
$bool   = static fn (mixed $v, string $yes = 'Sim', string $no = 'Não'): string => $v ? $yes : $no;

$trafficLight = is_array($snapshot['traffic_light'] ?? null) ? $snapshot['traffic_light'] : ['status' => 'unavailable', 'label' => '—', 'reason' => ''];
$tlStatus = (string) ($trafficLight['status'] ?? 'unavailable');
$tlBadge  = match ($tlStatus) {
    'ok'       => 'success',
    'warning'  => 'warning',
    'critical' => 'danger',
    default    => 'secondary',
};

$node     = is_array($snapshot['node'] ?? null) ? $snapshot['node'] : [];
$obs      = is_array($snapshot['observability'] ?? null) ? $snapshot['observability'] : [];
$diagn    = is_array($snapshot['operational_diagnostics'] ?? null) ? $snapshot['operational_diagnostics'] : [];
$audit    = is_array($snapshot['audit'] ?? null) ? $snapshot['audit'] : [];
$ai       = is_array($snapshot['ai'] ?? null) ? $snapshot['ai'] : [];
$recs     = is_array($snapshot['recommendations'] ?? null) ? $snapshot['recommendations'] : [];

$pluginInfo  = is_array($diagn['plugin'] ?? null) ? $diagn['plugin'] : [];
$readiness   = is_array($node['readiness'] ?? null) ? $node['readiness'] : [];
$manifest    = is_array($diagn['local_manifest'] ?? null) ? $diagn['local_manifest'] : [];
$rtCons      = is_array($diagn['runtime_consistency'] ?? null) ? $diagn['runtime_consistency'] : [];

// Drill-down URLs (all existing pages — kept as-is).
$urls = [
    'observabilidade' => Plugin::getObservabilityUrl(),
    'diagnostico_op'  => Plugin::getOperationalDiagnosticsUrl(),
    'auditoria'       => Plugin::getAuditUrl(),
    'events'          => Plugin::getAuditUrl() . '?view=events',
    'config'          => Plugin::getWebBasePath() . '/front/config.form.php?tab=diagnostics',
    'health'          => Plugin::getOperationalDiagnosticsUrl() . '?view=health',
    'ai_config'       => Plugin::getWebBasePath() . '/front/ai.config.php',
];
?>

<div class="container-fluid py-3">

    <?php /* ── Header ──────────────────────────────────────────────────────── */ ?>
    <div class="d-flex flex-wrap align-items-center justify-content-between gap-3 mb-3">
        <div>
            <h2 class="mb-0">
                <i class="ti ti-dashboard me-2"></i>
                <?= $escape(__('Monitoramento Operacional', 'glpiintegaglpi')); ?>
            </h2>
            <div class="text-muted small mt-1">
                <?= $escape(__('Hub read-only para saúde técnica, WhatsApp/Meta, auditoria, eventos e runtime.', 'glpiintegaglpi')); ?>
                &middot;
                <?= $escape(__('Versão:', 'glpiintegaglpi')); ?>
                <strong><?= $escape($snapshot['plugin_version'] ?? '—'); ?></strong>
                &middot;
                <?= $escape(__('Ambiente:', 'glpiintegaglpi')); ?>
                <strong><?= $escape($snapshot['environment'] ?? '—'); ?></strong>
                &middot;
                <?= $escape(__('Gerado em:', 'glpiintegaglpi')); ?>
                <strong><?= $escape($snapshot['generated_at'] ?? '—'); ?></strong>
            </div>
        </div>
        <div class="d-flex align-items-center gap-2">
            <span class="badge bg-secondary"><?= $escape(__('read-only', 'glpiintegaglpi')); ?></span>
            <span class="badge bg-<?= $escape($tlBadge); ?> fs-6">
                <?= $escape((string) ($trafficLight['label'] ?? '—')); ?>
            </span>
            <a class="btn btn-sm btn-outline-secondary" href="<?= $escape($_SERVER['PHP_SELF'] ?? ''); ?>">
                <i class="ti ti-refresh me-1"></i><?= $escape(__('Atualizar', 'glpiintegaglpi')); ?>
            </a>
        </div>
    </div>

    <div class="card mb-3">
        <div class="card-body py-2">
            <div class="d-flex flex-wrap align-items-center gap-2">
                <span class="fw-bold small text-muted me-1">
                    <?= $escape(__('Áreas consolidadas:', 'glpiintegaglpi')); ?>
                </span>
                <a class="btn btn-sm btn-outline-primary" href="#itg-monitoring-health">
                    <?= $escape(__('Saúde Técnica', 'glpiintegaglpi')); ?>
                </a>
                <a class="btn btn-sm btn-outline-primary" href="<?= $escape($urls['observabilidade']); ?>">
                    <?= $escape(__('WhatsApp / Meta', 'glpiintegaglpi')); ?>
                </a>
                <a class="btn btn-sm btn-outline-primary" href="<?= $escape($urls['auditoria']); ?>">
                    <?= $escape(__('Auditoria', 'glpiintegaglpi')); ?>
                </a>
                <a class="btn btn-sm btn-outline-primary" href="<?= $escape($urls['events']); ?>">
                    <?= $escape(__('Eventos', 'glpiintegaglpi')); ?>
                </a>
                <a class="btn btn-sm btn-outline-primary" href="<?= $escape($urls['diagnostico_op']); ?>">
                    <?= $escape(__('Diagnóstico / Readiness', 'glpiintegaglpi')); ?>
                </a>
                <a class="btn btn-sm btn-outline-primary" href="<?= $escape($urls['health']); ?>">
                    <?= $escape(__('Health / Runtime', 'glpiintegaglpi')); ?>
                </a>
            </div>
            <div class="form-text">
                <?= $escape(__('As rotas antigas continuam acessíveis pelos links internos; a sidebar usa esta entrada única para reduzir duplicidade.', 'glpiintegaglpi')); ?>
            </div>
        </div>
    </div>

    <?php if (($trafficLight['reason'] ?? '') !== '') { ?>
        <div class="alert alert-<?= $escape($tlBadge); ?> py-2 mb-3">
            <i class="ti ti-alert-triangle me-1"></i>
            <?= $escape((string) ($trafficLight['reason'] ?? '')); ?>
        </div>
    <?php } ?>

    <?php /* ── Recommendations ──────────────────────────────────────────── */ ?>
    <?php if ($recs !== []) { ?>
        <div class="card border-<?= $escape($tlBadge); ?> mb-3">
            <div class="card-header fw-bold">
                <i class="ti ti-list-check me-1"></i>
                <?= $escape(__('Próxima Ação Manual Recomendada', 'glpiintegaglpi')); ?>
            </div>
            <div class="card-body">
                <ul class="mb-0">
                    <?php foreach ($recs as $rec) { ?>
                        <li><?= $escape((string) $rec); ?></li>
                    <?php } ?>
                </ul>
                <div class="form-text mt-1">
                    <?= $escape(__('Somente orientação. Nenhuma ação é executada por esta tela.', 'glpiintegaglpi')); ?>
                </div>
            </div>
        </div>
    <?php } ?>

    <?php /* ── Top cards ────────────────────────────────────────────────── */ ?>
    <?php

    function techCardBadge(mixed $ok, string $yesLabel = 'OK', string $noLabel = 'Indisponível'): string
    {
        if ($ok === null || $ok === '') {
            return '<span class="badge bg-secondary">—</span>';
        }
        $class = $ok ? 'success' : 'danger';
        $label = $ok ? $yesLabel : $noLabel;
        return '<span class="badge bg-' . htmlspecialchars($class, ENT_QUOTES) . '">' . htmlspecialchars($label, ENT_QUOTES) . '</span>';
    }

    $cards = [
        [
            'icon'  => 'ti ti-plug',
            'title' => __('Plugin GLPI', 'glpiintegaglpi'),
            'ok'    => true,
            'detail' => ($pluginInfo['version'] ?? '') !== '' ? 'v' . $pluginInfo['version'] : '—',
        ],
        [
            'icon'  => 'ti ti-server',
            'title' => __('Node / integration-service', 'glpiintegaglpi'),
            'ok'    => ($node['available'] ?? false) && ($node['ok'] ?? false),
            'detail' => $node['available'] ?? false
                ? (($node['version'] ?? '') !== '' ? 'v' . $node['version'] : 'disponível')
                : ($node['error'] ?? 'indisponível'),
        ],
        [
            'icon'  => 'ti ti-database',
            'title' => __('PostgreSQL', 'glpiintegaglpi'),
            'ok'    => ($node['postgres']['ok'] ?? null),
            'detail' => isset($node['postgres']['latency_ms']) ? $node['postgres']['latency_ms'] . ' ms' : '',
        ],
        [
            'icon'  => 'ti ti-brand-redis',
            'title' => __('Redis', 'glpiintegaglpi'),
            'ok'    => ($node['redis']['configured'] ?? false),
            'detail' => (string) ($node['redis']['client_status'] ?? ''),
        ],
        [
            'icon'  => 'ti ti-link',
            'title' => __('GLPI API', 'glpiintegaglpi'),
            'ok'    => ($node['glpi_api']['ok'] ?? null),
            'detail' => isset($node['glpi_api']['latency_ms'])
                ? $node['glpi_api']['latency_ms'] . ' ms'
                : (($node['glpi_api']['error_stage'] ?? '') ?: ''),
        ],
        [
            'icon'  => 'ti ti-brand-whatsapp',
            'title' => __('Meta API', 'glpiintegaglpi'),
            'ok'    => ($node['meta']['configured'] ?? false),
            'detail' => ($node['meta']['configured'] ?? false) ? __('Configurado', 'glpiintegaglpi') : __('Não configurado', 'glpiintegaglpi'),
        ],
        [
            'icon'  => 'ti ti-shield-check',
            'title' => __('Webhook Guard', 'glpiintegaglpi'),
            'ok'    => ($readiness['webhook_guard']['app_signature_configured'] ?? false)
                && ($readiness['webhook_guard']['allowlist_configured'] ?? false),
            'detail' => ($readiness['webhook_guard']['app_signature_configured'] ?? false) ? __('Assinatura configurada', 'glpiintegaglpi') : __('Assinatura ausente', 'glpiintegaglpi'),
        ],
        [
            'icon'  => 'ti ti-mail',
            'title' => __('Delivery / Dead-letter', 'glpiintegaglpi'),
            'ok'    => !($audit['dead_letter_available'] ?? false),
            'detail' => ($audit['dead_letter_available'] ?? false) ? __('Dead-letter aberto', 'glpiintegaglpi') : __('Sem dead-letter', 'glpiintegaglpi'),
        ],
        [
            'icon'  => 'ti ti-brain',
            'title' => __('IA / Ollama', 'glpiintegaglpi'),
            'ok'    => ($ai['available'] ?? false) && ($ai['supervisor_enabled'] ?? false),
            'detail' => ($ai['available'] ?? false)
                ? ($ai['supervisor_dry_run'] ?? true ? 'dry-run' : ($ai['supervisor_provider'] ?? 'disabled'))
                : '—',
        ],
        [
            'icon'  => 'ti ti-package',
            'title' => __('Package / Runtime', 'glpiintegaglpi'),
            'ok'    => ($rtCons['status'] ?? '') === 'ok',
            'detail' => (string) ($manifest['status'] ?? ''),
        ],
    ];
    ?>

    <div class="row g-3 mb-3">
        <?php foreach ($cards as $card) { ?>
            <?php
            $cardOk = $card['ok'] ?? null;
            $cardBg = $cardOk === true ? 'border-success' : ($cardOk === false ? 'border-danger' : 'border-secondary');
            ?>
            <div class="col-md-3 col-xl-2">
                <div class="card h-100 <?= $escape($cardBg); ?>">
                    <div class="card-body p-2">
                        <div class="d-flex align-items-center gap-2 mb-1">
                            <i class="<?= $escape($card['icon']); ?> text-muted"></i>
                            <span class="small fw-bold"><?= $escape($card['title']); ?></span>
                        </div>
                        <?= techCardBadge($cardOk); ?>
                        <?php if (($card['detail'] ?? '') !== '') { ?>
                            <div class="text-muted small mt-1"><?= $escape($card['detail']); ?></div>
                        <?php } ?>
                    </div>
                </div>
            </div>
        <?php } ?>
    </div>

    <?php /* ── Dependency map ────────────────────────────────────────────── */ ?>
    <div class="card mb-3">
        <div class="card-header"><i class="ti ti-git-branch me-1"></i><?= $escape(__('Mapa de Interconexões', 'glpiintegaglpi')); ?></div>
        <div class="card-body p-3">
            <div class="d-flex flex-wrap align-items-center gap-2 text-center small">
                <?php

                $mapNodes = [
                    ['icon' => 'ti-brand-whatsapp', 'label' => 'Meta WhatsApp', 'ok' => ($node['meta']['configured'] ?? false)],
                    ['arrow' => true],
                    ['icon' => 'ti-shield-check',   'label' => 'Webhook Guard', 'ok' => ($readiness['webhook_guard']['app_signature_configured'] ?? false)],
                    ['arrow' => true],
                    ['icon' => 'ti-server',          'label' => 'Node / integration-service', 'ok' => ($node['available'] ?? false) && ($node['ok'] ?? false)],
                    ['arrow' => true],
                    ['icon' => 'ti-database',        'label' => 'PostgreSQL', 'ok' => ($node['postgres']['ok'] ?? null)],
                    ['sep' => true],
                    ['icon' => 'ti-brand-redis',     'label' => 'Redis', 'ok' => ($node['redis']['configured'] ?? false)],
                    ['arrow' => true],
                    ['icon' => 'ti-link',            'label' => 'GLPI API', 'ok' => ($node['glpi_api']['ok'] ?? null)],
                    ['arrow' => true],
                    ['icon' => 'ti-plug',            'label' => 'Plugin GLPI', 'ok' => true],
                    ['arrow' => true],
                    ['icon' => 'ti-ticket',          'label' => 'Ticket / Follow-up', 'ok' => true],
                ];

                foreach ($mapNodes as $mn) {
                    if (!empty($mn['arrow'])) {
                        echo '<span class="text-muted">→</span>';
                    } elseif (!empty($mn['sep'])) {
                        echo '<span class="text-muted">|</span>';
                    } else {
                        $mnOk = $mn['ok'] ?? null;
                        $mnColor = $mnOk === true ? 'text-success' : ($mnOk === false ? 'text-danger' : 'text-secondary');
                        echo '<div class="px-2">';
                        echo '<i class="' . htmlspecialchars((string) ($mn['icon'] ?? ''), ENT_QUOTES) . ' fs-5 ' . $mnColor . '"></i>';
                        echo '<div class="small">' . htmlspecialchars((string) ($mn['label'] ?? ''), ENT_QUOTES) . '</div>';
                        echo '</div>';
                    }
                }
                ?>
            </div>
        </div>
    </div>

    <?php /* ── Readiness / Package / Runtime ────────────────────────────── */ ?>
    <details class="mb-3" open>
        <summary class="fw-bold py-2 px-3 bg-light border rounded">
            <i class="ti ti-package me-1"></i>
            <?= $escape(__('Readiness / Pacote / Runtime', 'glpiintegaglpi')); ?>
        </summary>
        <div class="card border-top-0 rounded-top-0">
            <div class="card-body">
        <div class="row g-3" id="itg-monitoring-health">
                    <?php
                    $rdItems = [
                        [__('Versão plugin', 'glpiintegaglpi'),    $pluginInfo['version'] ?? '—'],
                        [__('build_id',      'glpiintegaglpi'),    $manifest['build_id'] ?? '—'],
                        [__('package_id',    'glpiintegaglpi'),    $manifest['package_id'] ?? '—'],
                        [__('package_status','glpiintegaglpi'),    $manifest['status'] ?? '—'],
                        [__('Node version',  'glpiintegaglpi'),    $node['version'] ?? '—'],
                        [__('Runtime consistency', 'glpiintegaglpi'), $rtCons['status'] ?? '—'],
                        [__('Manifest found','glpiintegaglpi'),    $bool($readiness['manifest_found'] ?? null, 'Sim', 'Não')],
                        [__('Esperado migrations', 'glpiintegaglpi'), (string) ($readiness['expected_migrations_count'] ?? '—')],
                        [__('OPcache', 'glpiintegaglpi'),          is_array($diagn['opcache'] ?? null) ? ($bool(($diagn['opcache']['enabled'] ?? false), 'Ativo', 'Inativo')) : '—'],
                    ];
                    foreach ($rdItems as [$label, $value]) { ?>
                        <div class="col-md-3 col-xl-2">
                            <div class="border rounded p-2 h-100">
                                <div class="text-muted small"><?= $escape($label); ?></div>
                                <strong><?= $escape($value); ?></strong>
                            </div>
                        </div>
                    <?php } ?>
                </div>
                <?php if (!empty($rtCons['details'])) { ?>
                    <div class="mt-2 small text-muted"><?= $escape(implode(' | ', (array) $rtCons['details'])); ?></div>
                <?php } ?>
            </div>
        </div>
    </details>

    <?php /* ── Technical events ──────────────────────────────────────────── */ ?>
    <details class="mb-3">
        <summary class="fw-bold py-2 px-3 bg-light border rounded">
            <i class="ti ti-shield-search me-1"></i>
            <?= $escape(__('Eventos Técnicos Recentes', 'glpiintegaglpi')); ?>
            <span class="badge bg-secondary ms-1"><?= $escape(__('últimas', 'glpiintegaglpi')); ?> <?= (int) ($snapshot['events_window_hours'] ?? 24); ?>h / <?= $escape(__('máx', 'glpiintegaglpi')); ?> <?= (int) ($snapshot['events_limit'] ?? 50); ?></span>
        </summary>
        <div class="card border-top-0 rounded-top-0">
            <div class="card-body p-0">
                <?php
                $auditRows = is_array($audit['events'] ?? null) ? $audit['events'] : [];
                if ($auditRows === []) {
                    echo '<div class="p-3 text-muted">' . htmlspecialchars(__('Sem eventos técnicos recentes. A janela padrão é 24 h.', 'glpiintegaglpi'), ENT_QUOTES) . '</div>';
                } else {
                    ?>
                    <div class="table-responsive">
                        <table class="table table-sm table-hover mb-0">
                            <thead class="table-light">
                                <tr>
                                    <th><?= $escape(__('Tipo', 'glpiintegaglpi')); ?></th>
                                    <th><?= $escape(__('Status', 'glpiintegaglpi')); ?></th>
                                    <th><?= $escape(__('Severidade', 'glpiintegaglpi')); ?></th>
                                    <th><?= $escape(__('Data/hora', 'glpiintegaglpi')); ?></th>
                                    <th><?= $escape(__('Fonte', 'glpiintegaglpi')); ?></th>
                                </tr>
                            </thead>
                            <tbody>
                                <?php foreach (array_slice($auditRows, 0, (int) ($snapshot['events_limit'] ?? 50)) as $ev) {
                                    if (!is_array($ev)) continue;
                                    $evSev = strtolower((string) ($ev['severity'] ?? ''));
                                    $sevClass = match ($evSev) {
                                        'critical' => 'danger',
                                        'warning'  => 'warning',
                                        'info'     => 'info',
                                        default    => 'secondary',
                                    };
                                    ?>
                                    <tr>
                                        <td class="small"><?= $escape((string) ($ev['event_type'] ?? '')); ?></td>
                                        <td class="small"><?= $escape((string) ($ev['status'] ?? '')); ?></td>
                                        <td><span class="badge bg-<?= $escape($sevClass); ?>"><?= $escape($evSev ?: '—'); ?></span></td>
                                        <td class="small text-muted"><?= $escape(substr((string) ($ev['created_at'] ?? ''), 0, 19)); ?></td>
                                        <td class="small text-muted"><?= $escape((string) ($ev['source'] ?? '')); ?></td>
                                    </tr>
                                <?php } ?>
                            </tbody>
                        </table>
                    </div>
                    <?php
                }
                ?>
            </div>
        </div>
    </details>

    <?php /* ── Workers ──────────────────────────────────────────────────── */ ?>
    <details class="mb-3">
        <summary class="fw-bold py-2 px-3 bg-light border rounded">
            <i class="ti ti-robot me-1"></i>
            <?= $escape(__('Workers / Jobs', 'glpiintegaglpi')); ?>
        </summary>
        <div class="card border-top-0 rounded-top-0">
            <div class="card-body">
                <?php
                // Workers are reported from Node diagnostics ai_runtime_config_summary.
                $aiWorker  = is_array($node['ai_runtime_config_summary']['worker'] ?? null) ? $node['ai_runtime_config_summary']['worker'] : [];
                $auditHb   = null;
                foreach ((array) ($audit['health']['indicators'] ?? []) as $ind) {
                    if (($ind['key'] ?? '') === 'heartbeat') {
                        $auditHb = $ind;
                        break;
                    }
                }
                $workers = [
                    [
                        'name'   => __('AI Observer / Alert Worker', 'glpiintegaglpi'),
                        'status' => ($aiWorker['loop_env'] ?? false) ? 'enabled' : 'disabled',
                        'detail' => isset($aiWorker['interval_seconds']) ? $aiWorker['interval_seconds'] . 's interval' : '',
                        'source' => 'Node ai_runtime_config',
                    ],
                    [
                        'name'   => __('Inatividade / Autoclose', 'glpiintegaglpi'),
                        'status' => $auditHb !== null ? ($auditHb['status'] ?? '—') : 'unknown',
                        'detail' => is_array($auditHb) ? (string) ($auditHb['value'] ?? '') : '',
                        'source' => 'audit heartbeat',
                    ],
                ];
                ?>
                <div class="row g-2">
                    <?php foreach ($workers as $w) {
                        $wSt = strtolower((string) ($w['status'] ?? ''));
                        $wClass = match ($wSt) {
                            'ok', 'enabled', 'success', 'completed' => 'border-success',
                            'warning' => 'border-warning',
                            'critical', 'failed', 'error' => 'border-danger',
                            'disabled' => 'border-secondary',
                            default => 'border-secondary',
                        };
                        ?>
                        <div class="col-md-4">
                            <div class="border rounded p-2 h-100 <?= $escape($wClass); ?>">
                                <div class="fw-bold small"><?= $escape((string) ($w['name'] ?? '')); ?></div>
                                <div class="small"><?= $escape((string) ($w['status'] ?? '')); ?></div>
                                <?php if (($w['detail'] ?? '') !== '') { ?>
                                    <div class="text-muted small"><?= $escape((string) $w['detail']); ?></div>
                                <?php } ?>
                                <div class="text-muted" style="font-size:.7rem"><?= $escape((string) ($w['source'] ?? '')); ?></div>
                            </div>
                        </div>
                    <?php } ?>
                </div>
                <div class="form-text mt-2"><?= $escape(__('Worker heartbeat e status provêm de audit_events e Node diagnostics. Sem ação executável aqui.', 'glpiintegaglpi')); ?></div>
            </div>
        </div>
    </details>

    <?php /* ── IA / Ollama ──────────────────────────────────────────────── */ ?>
    <details class="mb-3">
        <summary class="fw-bold py-2 px-3 bg-light border rounded">
            <i class="ti ti-brain me-1"></i>
            <?= $escape(__('IA / Ollama (serviço técnico)', 'glpiintegaglpi')); ?>
        </summary>
        <div class="card border-top-0 rounded-top-0">
            <div class="card-body">
                <?php if (!($ai['available'] ?? false)) { ?>
                    <div class="text-muted"><?= $escape(__('Configuração IA indisponível.', 'glpiintegaglpi') . ' ' . (string) ($ai['error'] ?? '')); ?></div>
                <?php } else {
                    $aiItems = [
                        [__('Supervisor habilitado', 'glpiintegaglpi'), $bool($ai['supervisor_enabled'])],
                        [__('Provider supervisor', 'glpiintegaglpi'), $ai['supervisor_provider'] ?? '—'],
                        [__('Modelo supervisor',   'glpiintegaglpi'), $ai['supervisor_model'] ?? '—'],
                        [__('Dry-run supervisor',  'glpiintegaglpi'), $bool($ai['supervisor_dry_run'], 'Sim (simulado)', 'Não (produção)')],
                        [__('Timeout supervisor',  'glpiintegaglpi'), ($ai['supervisor_timeout_sec'] ?? 0) > 0 ? $ai['supervisor_timeout_sec'] . 's' : '—'],
                        [__('Copiloto habilitado', 'glpiintegaglpi'), $bool($ai['copilot_enabled'])],
                        [__('Provider copiloto',   'glpiintegaglpi'), $ai['copilot_provider'] ?? '—'],
                        [__('Dry-run copiloto',    'glpiintegaglpi'), $bool($ai['copilot_dry_run'], 'Sim (simulado)', 'Não (produção)')],
                    ];
                    ?>
                    <div class="row g-2">
                        <?php foreach ($aiItems as [$label, $value]) { ?>
                            <div class="col-md-3 col-xl-2">
                                <div class="border rounded p-2 h-100">
                                    <div class="text-muted small"><?= $escape($label); ?></div>
                                    <strong><?= $escape($value); ?></strong>
                                </div>
                            </div>
                        <?php } ?>
                    </div>
                    <div class="form-text mt-2"><?= $escape(__('Sem conteúdo de conversa ou análise. Somente estado técnico do serviço.', 'glpiintegaglpi')); ?></div>
                <?php } ?>
            </div>
        </div>
    </details>

    <?php /* ── Feature flags & migrations (V8 observabilidade segura) ─────── */ ?>
    <?php
    $featureFlags = is_array($snapshot['feature_flags'] ?? null) ? $snapshot['feature_flags'] : [];
    $migrations   = is_array($snapshot['migrations'] ?? null) ? $snapshot['migrations'] : [];
    $flagBadge = static function (string $status): string {
        return match ($status) {
            'ok'       => 'success',
            'warning'  => 'warning',
            'critical' => 'danger',
            default    => 'secondary',
        };
    };
    ?>
    <div class="row g-3 mb-3">
        <div class="col-lg-7">
            <div class="card h-100">
                <div class="card-header fw-bold">
                    <i class="ti ti-flag me-1"></i><?= $escape(__('Flags Críticas e Ambiente', 'glpiintegaglpi')); ?>
                    <span class="badge bg-light text-dark ms-2"><?= $escape(__('somente leitura', 'glpiintegaglpi')); ?></span>
                </div>
                <div class="card-body">
                    <div class="form-text mb-2">
                        <?= $escape(__('Valores não sensíveis. Segredos, tokens e URLs completas nunca são exibidos. Flags não alteram nada aqui.', 'glpiintegaglpi')); ?>
                    </div>
                    <table class="table table-sm mb-0">
                        <thead>
                            <tr>
                                <th><?= $escape(__('Flag', 'glpiintegaglpi')); ?></th>
                                <th><?= $escape(__('Valor', 'glpiintegaglpi')); ?></th>
                                <th><?= $escape(__('Fonte', 'glpiintegaglpi')); ?></th>
                            </tr>
                        </thead>
                        <tbody>
                            <?php foreach ($featureFlags as $flag) { ?>
                                <tr>
                                    <td>
                                        <code><?= $escape($flag['key'] ?? ''); ?></code><br>
                                        <span class="text-muted small"><?= $escape($flag['label'] ?? ''); ?></span>
                                    </td>
                                    <td>
                                        <span class="badge bg-<?= $escape($flagBadge((string) ($flag['status'] ?? 'secondary'))); ?>">
                                            <?= $escape($flag['value'] ?? '—'); ?>
                                        </span>
                                    </td>
                                    <td class="text-muted small"><?= $escape($flag['source'] ?? ''); ?></td>
                                </tr>
                            <?php } ?>
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
        <div class="col-lg-5">
            <div class="card h-100">
                <div class="card-header fw-bold">
                    <i class="ti ti-database-cog me-1"></i><?= $escape(__('Migrations Críticas', 'glpiintegaglpi')); ?>
                </div>
                <div class="card-body">
                    <div class="form-text mb-2">
                        <?= $escape(__('Verificação por arquivo (sem acesso ao banco). Aplicação permanece manual.', 'glpiintegaglpi')); ?>
                    </div>
                    <ul class="list-group list-group-flush">
                        <?php foreach ($migrations as $mig) { ?>
                            <?php $migOk = (bool) ($mig['ok'] ?? false); ?>
                            <li class="list-group-item d-flex justify-content-between align-items-start px-0">
                                <div>
                                    <div class="fw-bold small"><?= $escape($mig['label'] ?? ''); ?></div>
                                    <code class="small"><?= $escape($mig['key'] ?? ''); ?></code>
                                    <?php if (!$migOk && !empty($mig['missing'])) { ?>
                                        <div class="text-muted small">
                                            <?= $escape(__('Tokens ausentes:', 'glpiintegaglpi')); ?>
                                            <?= $escape(implode(', ', array_slice((array) $mig['missing'], 0, 5))); ?>
                                        </div>
                                    <?php } ?>
                                </div>
                                <span class="badge bg-<?= $migOk ? 'success' : 'warning'; ?>">
                                    <?= $migOk ? $escape(__('compatível', 'glpiintegaglpi')) : $escape(__('pendente', 'glpiintegaglpi')); ?>
                                </span>
                            </li>
                        <?php } ?>
                    </ul>
                </div>
            </div>
        </div>
    </div>

    <?php /* ── Drill-down links ─────────────────────────────────────────── */ ?>
    <div class="card mb-3">
        <div class="card-header"><i class="ti ti-external-link me-1"></i><?= $escape(__('Drill-down — Telas Detalhadas', 'glpiintegaglpi')); ?></div>
        <div class="card-body">
            <div class="d-flex flex-wrap gap-2">
                <a class="btn btn-outline-secondary btn-sm" href="<?= $escape($urls['observabilidade']); ?>">
                    <i class="ti ti-heartbeat me-1"></i><?= $escape(__('Observabilidade WhatsApp', 'glpiintegaglpi')); ?>
                </a>
                <a class="btn btn-outline-secondary btn-sm" href="<?= $escape($urls['diagnostico_op']); ?>">
                    <i class="ti ti-stethoscope me-1"></i><?= $escape(__('Diagnóstico Operacional', 'glpiintegaglpi')); ?>
                </a>
                <a class="btn btn-outline-secondary btn-sm" href="<?= $escape($urls['auditoria']); ?>">
                    <i class="ti ti-shield-search me-1"></i><?= $escape(__('Auditoria Operacional', 'glpiintegaglpi')); ?>
                </a>
                <a class="btn btn-outline-secondary btn-sm" href="<?= $escape($urls['events']); ?>">
                    <i class="ti ti-calendar-event me-1"></i><?= $escape(__('Central de Eventos', 'glpiintegaglpi')); ?>
                </a>
                <a class="btn btn-outline-secondary btn-sm" href="<?= $escape($urls['health']); ?>">
                    <i class="ti ti-activity me-1"></i><?= $escape(__('Health / Status Serviços', 'glpiintegaglpi')); ?>
                </a>
                <a class="btn btn-outline-secondary btn-sm" href="<?= $escape($urls['config']); ?>">
                    <i class="ti ti-settings me-1"></i><?= $escape(__('Diagnóstico Configuração', 'glpiintegaglpi')); ?>
                </a>
                <a class="btn btn-outline-secondary btn-sm" href="<?= $escape($urls['ai_config']); ?>">
                    <i class="ti ti-brain me-1"></i><?= $escape(__('Configuração IA', 'glpiintegaglpi')); ?>
                </a>
            </div>
            <div class="form-text mt-2">
                <?= $escape(__('As telas acima continuam disponíveis para diagnóstico detalhado. Esta tela é o ponto de entrada unificado.', 'glpiintegaglpi')); ?>
            </div>
        </div>
    </div>

    <div class="text-muted small text-end">
        <?= $escape(__('Dashboard técnico read-only. Sem retry, sem reprocessamento, sem ação mutável.', 'glpiintegaglpi')); ?>
    </div>

</div>
