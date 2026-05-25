<?php

declare(strict_types=1);

/**
 * @var GlpiPlugin\Integaglpi\Renderer\AiOperationsRenderer $this
 * @var array<string, mixed> $data
 */

$ai = is_array($data['ai_supervisor'] ?? null) ? $data['ai_supervisor'] : [];
$copilot = is_array($data['copilot'] ?? null) ? $data['copilot'] : [];
$pilot = is_array($data['cloud_pilot'] ?? null) ? $data['cloud_pilot'] : [];
$integration = is_array($data['integration_service'] ?? null) ? $data['integration_service'] : [];
$diagnosticsError = trim((string) ($data['diagnostics_error'] ?? ''));
$flash = is_array($data['flash'] ?? null) ? $data['flash'] : null;
$environment = (string) ($data['environment'] ?? 'desconhecido');
$riskAlerts = is_array($data['risk_alerts'] ?? null) ? $data['risk_alerts'] : [];
$pendingSafeFields = is_array($data['pending_safe_fields'] ?? null) ? $data['pending_safe_fields'] : [];
$csrf = GlpiPlugin\Integaglpi\Plugin::getCsrfToken();

$renderRows = function (array $rows): void {
    foreach ($rows as $label => $value) { ?>
        <tr>
            <th style="width: 280px;"><?= $this->escape((string) $label); ?></th>
            <td><code><?= $this->escape(is_bool($value) ? ($value ? 'true' : 'false') : (string) $value); ?></code></td>
        </tr>
    <?php }
};
?>

<div class="container-fluid plugin-integaglpi-ai-config">
    <div class="d-flex flex-wrap justify-content-between align-items-start gap-2 mb-3">
        <div>
            <h1 class="h3 mb-1"><?= $this->escape(__('Configuração IA', 'glpiintegaglpi')); ?></h1>
            <p class="text-muted mb-0">
                <?= $this->escape(__('Visão operacional sem segredos. Alterações sensíveis continuam manuais via ambiente/ops.', 'glpiintegaglpi')); ?>
            </p>
        </div>
        <span class="badge bg-secondary"><?= $this->escape($environment); ?></span>
    </div>

    <div class="alert alert-info">
        <?= $this->escape(__('Esta tela não edita .env, não mostra tokens/API keys e não habilita cloud/embeddings por padrão.', 'glpiintegaglpi')); ?>
    </div>

    <?php if ($flash !== null) { ?>
        <div class="alert alert-<?= $this->escape((string) ($flash['type'] ?? 'info')); ?>">
            <?= $this->escape((string) ($flash['message'] ?? '')); ?>
        </div>
    <?php } ?>

    <?php if ($diagnosticsError !== '') { ?>
        <div class="alert alert-warning"><?= $this->escape($diagnosticsError); ?></div>
    <?php } ?>

    <?php if ($riskAlerts !== []) { ?>
        <div class="alert alert-warning">
            <strong><?= $this->escape(__('Alertas de risco:', 'glpiintegaglpi')); ?></strong>
            <?= $this->escape(implode(', ', array_map('strval', $riskAlerts))); ?>
        </div>
    <?php } ?>

    <div class="row g-3">
        <div class="col-lg-6">
            <div class="card h-100">
                <div class="card-header"><?= $this->escape(__('IA Supervisora / Ollama', 'glpiintegaglpi')); ?></div>
                <div class="table-responsive">
                    <table class="table table-sm mb-0">
                        <tbody>
                            <?php $renderRows([
                                'enabled' => $ai['enabled'] ?? false,
                                'provider' => $ai['provider'] ?? 'não verificado',
                                'model' => $ai['model'] ?? 'não verificado',
                                'timeout_seconds' => $ai['timeout_seconds'] ?? 'não verificado',
                                'max_messages' => $ai['max_messages'] ?? 'não verificado',
                                'max_chars' => $ai['max_chars'] ?? 'não verificado',
                                'dry_run' => $ai['dry_run'] ?? true,
                                'base_url_masked' => $ai['base_url'] ?? 'não verificado',
                                'base_url_configured' => $ai['base_url_configured'] ?? 'não verificado',
                            ]); ?>
                        </tbody>
                    </table>
                </div>
                <div class="card-footer">
                    <form method="post" action="<?= $this->escape($this->getAiConfigUrl()); ?>" class="d-flex flex-wrap gap-3 align-items-end">
                        <input type="hidden" name="_glpi_csrf_token" value="<?= $this->escape($csrf); ?>">
                        <input type="hidden" name="action" value="save_safe_config">
                        <div class="form-check">
                            <input class="form-check-input" type="checkbox" id="ai_supervisor_enabled_safe" name="ai_supervisor_enabled" value="1" <?= !empty($ai['enabled']) ? 'checked' : ''; ?>>
                            <label class="form-check-label" for="ai_supervisor_enabled_safe">
                                <?= $this->escape(__('Habilitar IA Supervisora no plugin', 'glpiintegaglpi')); ?>
                            </label>
                        </div>
                        <button class="btn btn-sm btn-outline-primary" type="submit">
                            <?= $this->escape(__('Salvar flag segura', 'glpiintegaglpi')); ?>
                        </button>
                    </form>
                    <?php if ($pendingSafeFields !== []) { ?>
                        <div class="text-muted small mt-2">
                            <?= $this->escape(__('Pendentes sem storage seguro nesta fase:', 'glpiintegaglpi')); ?>
                            <code><?= $this->escape(implode(', ', array_map('strval', $pendingSafeFields))); ?></code>
                        </div>
                    <?php } ?>
                </div>
            </div>
        </div>

        <div class="col-lg-6">
            <div class="card h-100">
                <div class="card-header"><?= $this->escape(__('Copiloto interno', 'glpiintegaglpi')); ?></div>
                <div class="table-responsive">
                    <table class="table table-sm mb-0">
                        <tbody>
                            <?php $renderRows([
                                'enabled' => $copilot['enabled'] ?? false,
                                'provider' => $copilot['provider'] ?? 'disabled',
                                'dry_run' => $copilot['dry_run'] ?? true,
                                'auto_send' => 'false',
                                'ticket_mutation' => 'false',
                            ]); ?>
                        </tbody>
                    </table>
                </div>
            </div>
        </div>

        <div class="col-lg-6">
            <div class="card h-100">
                <div class="card-header"><?= $this->escape(__('Piloto Cloud / Embeddings', 'glpiintegaglpi')); ?></div>
                <div class="table-responsive">
                    <table class="table table-sm mb-0">
                        <tbody>
                            <?php $renderRows([
                                'cloud_enabled' => $pilot['cloud_enabled'] ?? 'false',
                                'embeddings_enabled' => $pilot['embeddings_enabled'] ?? 'false',
                                'provider' => $pilot['provider'] ?? 'disabled',
                                'dpo_approved' => $pilot['dpo_approved'] ?? 'false',
                                'director_approved' => $pilot['director_approved'] ?? 'false',
                                'admin_opt_in' => $pilot['admin_opt_in'] ?? 'false',
                                'incident_ack' => $pilot['incident_ack'] ?? 'false',
                                'monthly_budget_limit' => $pilot['monthly_budget_limit'] ?? '0',
                                'gates_ok' => $pilot['gates_ok'] ?? false,
                            ]); ?>
                        </tbody>
                    </table>
                </div>
                <div class="card-footer">
                    <?php $missingGates = is_array($pilot['missing_gates'] ?? null) ? $pilot['missing_gates'] : []; ?>
                    <?php if ($missingGates !== []) { ?>
                        <div class="alert alert-warning py-2">
                            <?= $this->escape(__('Cloud bloqueada por gates pendentes:', 'glpiintegaglpi')); ?>
                            <code><?= $this->escape(implode(', ', array_map('strval', $missingGates))); ?></code>
                        </div>
                    <?php } ?>
                    <form method="post" action="<?= $this->escape($this->getAiConfigUrl()); ?>">
                        <input type="hidden" name="_glpi_csrf_token" value="<?= $this->escape($csrf); ?>">
                        <input type="hidden" name="action" value="request_cloud_enable">
                        <button class="btn btn-sm btn-outline-warning" type="submit">
                            <?= $this->escape(__('Validar gates para habilitar cloud', 'glpiintegaglpi')); ?>
                        </button>
                    </form>
                </div>
            </div>
        </div>

        <div class="col-lg-6">
            <div class="card h-100">
                <div class="card-header"><?= $this->escape(__('Integration-service', 'glpiintegaglpi')); ?></div>
                <div class="table-responsive">
                    <table class="table table-sm mb-0">
                        <tbody>
                            <?php $renderRows([
                                'url_masked' => $integration['url_masked'] ?? 'não verificado',
                                'configured' => $integration['configured'] ?? false,
                                'auth_key_visible' => 'false',
                            ]); ?>
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    </div>
</div>
