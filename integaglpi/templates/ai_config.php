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
        <span class="badge bg-secondary"><?= $this->escape(__('read-only', 'glpiintegaglpi')); ?></span>
    </div>

    <div class="alert alert-info">
        <?= $this->escape(__('Esta tela não edita .env, não mostra tokens/API keys e não habilita cloud/embeddings.', 'glpiintegaglpi')); ?>
    </div>

    <?php if ($diagnosticsError !== '') { ?>
        <div class="alert alert-warning"><?= $this->escape($diagnosticsError); ?></div>
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
                            ]); ?>
                        </tbody>
                    </table>
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
