<?php

declare(strict_types=1);

/** @var \GlpiPlugin\Integaglpi\Renderer\OperationalDiagnosticsRenderer $this */
/** @var array<string, mixed> $data */

$plugin = is_array($data['plugin'] ?? null) ? $data['plugin'] : [];
$localManifest = is_array($data['local_manifest'] ?? null) ? $data['local_manifest'] : [];
$node = is_array($data['node'] ?? null) ? $data['node'] : [];
$nodeDiagnostics = is_array($node['diagnostics'] ?? null) ? $node['diagnostics'] : [];
$nodeBuild = is_array($nodeDiagnostics['build'] ?? null) ? $nodeDiagnostics['build'] : [];
$postgres = is_array($nodeDiagnostics['postgres'] ?? null) ? $nodeDiagnostics['postgres'] : [];
$redis = is_array($nodeDiagnostics['redis'] ?? null) ? $nodeDiagnostics['redis'] : [];
$glpiApi = is_array($nodeDiagnostics['glpi_api'] ?? null) ? $nodeDiagnostics['glpi_api'] : [];
$meta = is_array($nodeDiagnostics['meta'] ?? null) ? $nodeDiagnostics['meta'] : [];
$schema = is_array($nodeDiagnostics['schema'] ?? null) ? $nodeDiagnostics['schema'] : [];
$runtimeConsistency = is_array($data['runtime_consistency'] ?? null) ? $data['runtime_consistency'] : [];
$opcache = is_array($data['opcache'] ?? null) ? $data['opcache'] : [];
$categories = is_array($data['diagnostic_categories'] ?? null) ? $data['diagnostic_categories'] : [];
$nodeError = is_array($node['error'] ?? null) ? $node['error'] : null;
$alerts = is_array($runtimeConsistency['alerts'] ?? null) ? $runtimeConsistency['alerts'] : [];

$badgeClass = static function (bool $ok): string {
    return $ok ? 'bg-success' : 'bg-warning text-dark';
};
?>

<div class="d-flex align-items-center justify-content-between gap-3 mb-3">
    <div>
        <h2 class="mb-1"><?= $this->escape(__('Diagnóstico Operacional IntegraGLPI', 'glpiintegaglpi')); ?></h2>
        <div class="text-muted">
            <?= $this->escape(__('Readiness read-only de pacote, runtime, integração e segurança operacional.', 'glpiintegaglpi')); ?>
        </div>
    </div>
    <span class="badge bg-secondary"><?= $this->escape(__('Somente leitura', 'glpiintegaglpi')); ?></span>
</div>

<?php if ($alerts !== []) : ?>
    <div class="alert alert-warning">
        <strong><?= $this->escape(__('Atenção de runtime:', 'glpiintegaglpi')); ?></strong>
        <?= $this->escape(implode(', ', array_map('strval', $alerts))); ?>
    </div>
<?php endif; ?>

<?php if ($nodeError !== null) : ?>
    <div class="alert alert-warning">
        <?= $this->escape(__('Node readiness indisponível:', 'glpiintegaglpi')); ?>
        <?= $this->escape((string) ($nodeError['category'] ?? 'connection')); ?> ·
        <?= $this->escape((string) ($nodeError['message'] ?? '')); ?>
    </div>
<?php endif; ?>

<div class="row g-3 mb-3">
    <div class="col-md-6">
        <div class="card h-100">
            <div class="card-header"><?= $this->escape(__('Pacote local do plugin', 'glpiintegaglpi')); ?></div>
            <div class="card-body">
                <div><strong>plugin_version:</strong> <?= $this->escape((string) ($plugin['version'] ?? 'unknown')); ?></div>
                <div><strong>build_id:</strong> <?= $this->escape((string) ($plugin['build_id'] ?? '')); ?></div>
                <div><strong>package_id:</strong> <?= $this->escape((string) ($plugin['package_id'] ?? '')); ?></div>
                <div><strong>manifest:</strong>
                    <span class="badge <?= $badgeClass((string) ($localManifest['status'] ?? '') === 'ok'); ?>">
                        <?= $this->escape((string) ($localManifest['status'] ?? 'package_incomplete')); ?>
                    </span>
                </div>
                <div><strong>migrations esperadas:</strong> <?= (int) ($localManifest['expected_migrations_count'] ?? 0); ?></div>
                <div><strong>arquivos críticos:</strong> <?= (int) ($localManifest['critical_files_count'] ?? 0); ?></div>
            </div>
        </div>
    </div>

    <div class="col-md-6">
        <div class="card h-100">
            <div class="card-header"><?= $this->escape(__('Runtime Node', 'glpiintegaglpi')); ?></div>
            <div class="card-body">
                <div><strong>build_id:</strong> <?= $this->escape((string) ($nodeBuild['build_id'] ?? '')); ?></div>
                <div><strong>package_id:</strong> <?= $this->escape((string) ($nodeBuild['package_id'] ?? '')); ?></div>
                <div><strong>package_status:</strong>
                    <span class="badge <?= $badgeClass((string) ($nodeBuild['package_status'] ?? '') === 'ok'); ?>">
                        <?= $this->escape((string) ($nodeBuild['package_status'] ?? 'n/a')); ?>
                    </span>
                </div>
                <div><strong>runtime_consistency:</strong>
                    <span class="badge <?= $badgeClass((string) ($runtimeConsistency['status'] ?? '') === 'ok'); ?>">
                        <?= $this->escape((string) ($runtimeConsistency['status'] ?? 'attention')); ?>
                    </span>
                </div>
                <div><strong>generated_at:</strong> <?= $this->escape((string) ($nodeBuild['generated_at'] ?? '')); ?></div>
            </div>
        </div>
    </div>
</div>

<div class="row g-3 mb-3">
    <div class="col-md-3">
        <div class="card h-100">
            <div class="card-header">PostgreSQL</div>
            <div class="card-body">
                <span class="badge <?= $badgeClass((bool) ($postgres['ok'] ?? false)); ?>">
                    <?= $this->escape((bool) ($postgres['ok'] ?? false) ? 'ok' : 'attention'); ?>
                </span>
                <div class="text-muted mt-2">latência: <?= $this->escape((string) ($postgres['latency_ms'] ?? 'n/a')); ?>ms</div>
            </div>
        </div>
    </div>
    <div class="col-md-3">
        <div class="card h-100">
            <div class="card-header">Redis</div>
            <div class="card-body">
                <span class="badge <?= $badgeClass((bool) ($redis['configured'] ?? false)); ?>">
                    <?= $this->escape((bool) ($redis['configured'] ?? false) ? 'configured' : 'missing'); ?>
                </span>
                <div class="text-muted mt-2">client_status: <?= $this->escape((string) ($redis['client_status'] ?? 'n/a')); ?></div>
            </div>
        </div>
    </div>
    <div class="col-md-3">
        <div class="card h-100">
            <div class="card-header">GLPI API</div>
            <div class="card-body">
                <span class="badge <?= $badgeClass((bool) ($glpiApi['ok'] ?? false)); ?>">
                    <?= $this->escape((bool) ($glpiApi['ok'] ?? false) ? 'ok' : 'attention'); ?>
                </span>
                <div class="text-muted mt-2">configured: <?= $this->escape((bool) ($glpiApi['configured'] ?? false) ? 'yes' : 'no'); ?></div>
            </div>
        </div>
    </div>
    <div class="col-md-3">
        <div class="card h-100">
            <div class="card-header">Meta/Webhook Guard</div>
            <div class="card-body">
                <span class="badge <?= $badgeClass((bool) ($meta['configured'] ?? false)); ?>">
                    <?= $this->escape((bool) ($meta['configured'] ?? false) ? 'configured' : 'missing'); ?>
                </span>
                <div class="text-muted mt-2">allowlist: <?= $this->escape((bool) ($meta['allowed_phone_number_ids_configured'] ?? false) ? 'yes' : 'check'); ?></div>
            </div>
        </div>
    </div>
</div>

<div class="row g-3">
    <div class="col-md-6">
        <div class="card h-100">
            <div class="card-header"><?= $this->escape(__('Schema/migrations essenciais', 'glpiintegaglpi')); ?></div>
            <div class="card-body">
                <?php foreach ($schema as $key => $value) : ?>
                    <div class="d-flex justify-content-between border-bottom py-1">
                        <span><?= $this->escape((string) $key); ?></span>
                        <span class="badge <?= $badgeClass((bool) $value); ?>"><?= $this->escape((bool) $value ? 'ok' : 'attention'); ?></span>
                    </div>
                <?php endforeach; ?>
            </div>
        </div>
    </div>
    <div class="col-md-6">
        <div class="card h-100">
            <div class="card-header"><?= $this->escape(__('Higiene runtime', 'glpiintegaglpi')); ?></div>
            <div class="card-body">
                <div><strong>OPcache loaded:</strong> <?= $this->escape((bool) ($opcache['loaded'] ?? false) ? 'yes' : 'no'); ?></div>
                <div><strong>OPcache enabled hint:</strong> <?= $this->escape((string) ($opcache['enabled_hint'] ?? '')); ?></div>
                <div class="text-muted mt-2"><?= $this->escape((string) ($opcache['readiness_hint'] ?? '')); ?></div>
                <hr>
                <div><strong><?= $this->escape(__('Categorias padronizadas:', 'glpiintegaglpi')); ?></strong></div>
                <div class="small text-muted"><?= $this->escape(implode(', ', array_map('strval', $categories))); ?></div>
            </div>
        </div>
    </div>
</div>
