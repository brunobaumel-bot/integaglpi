<?php

declare(strict_types=1);

/**
 * @var GlpiPlugin\Integaglpi\Renderer\AiOperationsRenderer $this
 * @var array<string, mixed> $data
 */

$ai = is_array($data['ai_supervisor'] ?? null) ? $data['ai_supervisor'] : [];
$copilot = is_array($data['copilot'] ?? null) ? $data['copilot'] : [];
$pilot = is_array($data['cloud_pilot'] ?? null) ? $data['cloud_pilot'] : [];
$externalResearch = is_array($data['external_research'] ?? null) ? $data['external_research'] : [];
$p4CandidateReview = is_array($data['p4_candidate_review'] ?? null) ? $data['p4_candidate_review'] : [];
$embeddings = is_array($data['embeddings'] ?? null) ? $data['embeddings'] : [];
$auditStatus = is_array($data['audit_status'] ?? null) ? $data['audit_status'] : [];
$governance = is_array($data['governance'] ?? null) ? $data['governance'] : [];
$integration = is_array($data['integration_service'] ?? null) ? $data['integration_service'] : [];
$diagnosticsError = trim((string) ($data['diagnostics_error'] ?? ''));
$flash = is_array($data['flash'] ?? null) ? $data['flash'] : null;
$environment = (string) ($data['environment'] ?? 'desconhecido');
$riskAlerts = is_array($data['risk_alerts'] ?? null) ? $data['risk_alerts'] : [];
$pendingSafeFields = is_array($data['pending_safe_fields'] ?? null) ? $data['pending_safe_fields'] : [];
$safeSettings = is_array($data['safe_settings'] ?? null) ? $data['safe_settings'] : [];
$safeSettingsAvailable = (bool) ($data['safe_settings_available'] ?? false);
$ollamaModels = is_array($data['ollama_models'] ?? null) ? array_values(array_map('strval', $data['ollama_models'])) : [];
$cloudProviderCatalog = is_array($data['cloud_provider_catalog'] ?? null) ? $data['cloud_provider_catalog'] : [];
$effectiveConfig = is_array($data['effective_config'] ?? null) ? $data['effective_config'] : [];
$secretVault = is_array($data['secret_vault'] ?? null) ? $data['secret_vault'] : [];
$secretVaultProviders = is_array($secretVault['providers'] ?? null) ? $secretVault['providers'] : [];
$csrf = GlpiPlugin\Integaglpi\Plugin::getCsrfToken();

$renderRows = function (array $rows): void {
    foreach ($rows as $label => $value) { ?>
        <tr>
            <th style="width: 280px;"><?= $this->escape((string) $label); ?></th>
            <td><code><?= $this->escape(is_bool($value) ? ($value ? 'true' : 'false') : (string) $value); ?></code></td>
        </tr>
    <?php }
};

$renderModelPicker = function (string $fieldName, string $label, string $currentValue) use ($ollamaModels, $safeSettingsAvailable): void {
    $currentValue = trim($currentValue);
    $options = $ollamaModels;
    $currentMissing = $currentValue !== '' && $options !== [] && !in_array($currentValue, $options, true);
    if ($currentMissing) {
        array_unshift($options, $currentValue);
    }
    ?>
    <label class="form-label mt-2"><?= $this->escape($label); ?></label>
    <?php if ($options !== []) { ?>
        <select class="form-select form-select-sm" name="<?= $this->escape($fieldName); ?>" <?= !$safeSettingsAvailable ? 'disabled' : ''; ?>>
            <?php foreach ($options as $modelOption) { ?>
                <option value="<?= $this->escape($modelOption); ?>" <?= $currentValue === $modelOption ? 'selected' : ''; ?>><?= $this->escape($modelOption); ?></option>
            <?php } ?>
        </select>
        <?php if ($currentMissing) { ?>
            <div class="text-warning small mt-1"><?= $this->escape(__('Modelo salvo não apareceu em /api/tags nesta atualização.', 'glpiintegaglpi')); ?></div>
        <?php } ?>
        <input class="form-control form-control-sm mt-1" name="<?= $this->escape($fieldName); ?>_manual" maxlength="120" value="" placeholder="<?= $this->escape(__('Modelo manual opcional se não estiver na lista', 'glpiintegaglpi')); ?>" <?= !$safeSettingsAvailable ? 'disabled' : ''; ?>>
    <?php } else { ?>
        <input class="form-control form-control-sm" name="<?= $this->escape($fieldName); ?>" maxlength="120" value="<?= $this->escape($currentValue); ?>" <?= !$safeSettingsAvailable ? 'disabled' : ''; ?>>
        <div class="text-muted small mt-1"><?= $this->escape(__('Use “Atualizar modelos Ollama” para preencher o dropdown. O fallback manual fica preservado.', 'glpiintegaglpi')); ?></div>
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
        <?= $this->escape(__('Esta tela não edita .env, não mostra tokens/API keys e não habilita cloud/embeddings por padrão. Chaves cloud são write-only no Secret Vault.', 'glpiintegaglpi')); ?>
    </div>

    <div class="card mb-3">
        <div class="card-header"><?= $this->escape(__('Política operacional', 'glpiintegaglpi')); ?></div>
        <div class="card-body py-2">
            <div class="d-flex flex-wrap gap-2">
                <?php foreach ($governance as $key => $value) { ?>
                    <span class="badge bg-light text-dark border">
                        <?= $this->escape((string) $key); ?>=<code><?= $this->escape(is_bool($value) ? ($value ? 'true' : 'false') : (string) $value); ?></code>
                    </span>
                <?php } ?>
            </div>
        </div>
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

    <div class="card mb-3">
        <div class="card-header"><?= $this->escape(__('Configurações não sensíveis', 'glpiintegaglpi')); ?></div>
        <div class="card-body">
            <?php if (!$safeSettingsAvailable) { ?>
                <div class="alert alert-warning">
                    <?= $this->escape(__('Storage de configurações IA ainda não está pronto. Execute a migration 038 antes de editar pela UI.', 'glpiintegaglpi')); ?>
                </div>
            <?php } ?>
            <form method="post" action="<?= $this->escape($this->getAiConfigUrl()); ?>" class="mb-3">
                <input type="hidden" name="_glpi_csrf_token" value="<?= $this->escape($csrf); ?>">
                <input type="hidden" name="action" value="refresh_ollama_models">
                <button class="btn btn-sm btn-outline-secondary" type="submit">
                    <?= $this->escape(__('Atualizar modelos Ollama', 'glpiintegaglpi')); ?>
                </button>
                <span class="text-muted small ms-2">
                    <?= $this->escape(__('Consulta manual local em /api/tags, sem prompt e sem rede externa.', 'glpiintegaglpi')); ?>
                </span>
                <?php if ($ollamaModels !== []) { ?>
                    <div class="small text-success mt-1">
                        <?= $this->escape(__('Modelos locais em cache:', 'glpiintegaglpi')); ?>
                        <code><?= $this->escape(implode(', ', $ollamaModels)); ?></code>
                    </div>
                <?php } ?>
            </form>
            <form method="post" action="<?= $this->escape($this->getAiConfigUrl()); ?>">
                <input type="hidden" name="_glpi_csrf_token" value="<?= $this->escape($csrf); ?>">
                <input type="hidden" name="action" value="save_safe_config">
                <div class="row g-3">
                    <div class="col-lg-4">
                        <h2 class="h6"><?= $this->escape(__('Provider local', 'glpiintegaglpi')); ?></h2>
                        <label class="form-check">
                            <input class="form-check-input" type="checkbox" name="ai_supervisor_enabled" value="1" <?= ((string) ($safeSettings['ai_supervisor_enabled'] ?? '') === 'true' || !empty($ai['enabled'])) ? 'checked' : ''; ?> <?= !$safeSettingsAvailable ? 'disabled' : ''; ?>>
                            <span class="form-check-label"><?= $this->escape(__('IA Supervisora habilitada', 'glpiintegaglpi')); ?></span>
                        </label>
                        <label class="form-check">
                            <input class="form-check-input" type="checkbox" name="ai_supervisor_dry_run" value="1" <?= ((string) ($safeSettings['ai_supervisor_dry_run'] ?? $ai['dry_run'] ?? 'true') !== 'false') ? 'checked' : ''; ?> <?= !$safeSettingsAvailable ? 'disabled' : ''; ?>>
                            <span class="form-check-label"><?= $this->escape(__('Dry-run inicial', 'glpiintegaglpi')); ?></span>
                        </label>
                        <label class="form-label mt-2"><?= $this->escape(__('Provider lógico', 'glpiintegaglpi')); ?></label>
                        <select class="form-select form-select-sm" name="ai_supervisor_provider" <?= !$safeSettingsAvailable ? 'disabled' : ''; ?>>
                            <?php foreach (['disabled', 'ollama', 'local'] as $providerOption) { ?>
                                <option value="<?= $this->escape($providerOption); ?>" <?= (string) ($safeSettings['ai_supervisor_provider'] ?? $ai['provider'] ?? 'disabled') === $providerOption ? 'selected' : ''; ?>><?= $this->escape($providerOption); ?></option>
                            <?php } ?>
                        </select>
                        <?php $renderModelPicker('ai_supervisor_model', __('Modelo local', 'glpiintegaglpi'), (string) ($safeSettings['ai_supervisor_model'] ?? $ai['model'] ?? '')); ?>
                        <div class="row g-2 mt-1">
                            <div class="col-4">
                                <label class="form-label small"><?= $this->escape(__('Timeout s', 'glpiintegaglpi')); ?></label>
                                <input class="form-control form-control-sm" type="number" name="ai_supervisor_timeout_seconds" min="15" max="180" value="<?= $this->escape((string) ($safeSettings['ai_supervisor_timeout_seconds'] ?? $ai['timeout_seconds'] ?? 75)); ?>" <?= !$safeSettingsAvailable ? 'disabled' : ''; ?>>
                            </div>
                            <div class="col-4">
                                <label class="form-label small"><?= $this->escape(__('Mensagens', 'glpiintegaglpi')); ?></label>
                                <input class="form-control form-control-sm" type="number" name="ai_supervisor_max_messages" min="1" max="20" value="<?= $this->escape((string) ($safeSettings['ai_supervisor_max_messages'] ?? $ai['max_messages'] ?? 8)); ?>" <?= !$safeSettingsAvailable ? 'disabled' : ''; ?>>
                            </div>
                            <div class="col-4">
                                <label class="form-label small"><?= $this->escape(__('Chars', 'glpiintegaglpi')); ?></label>
                                <input class="form-control form-control-sm" type="number" name="ai_supervisor_max_chars" min="500" max="12000" value="<?= $this->escape((string) ($safeSettings['ai_supervisor_max_chars'] ?? $ai['max_chars'] ?? 6000)); ?>" <?= !$safeSettingsAvailable ? 'disabled' : ''; ?>>
                            </div>
                        </div>
                    </div>
                    <div class="col-lg-4">
                        <h2 class="h6"><?= $this->escape(__('Copiloto e Pesquisa', 'glpiintegaglpi')); ?></h2>
                        <label class="form-check">
                            <input class="form-check-input" type="checkbox" name="copilot_enabled" value="1" <?= ((string) ($safeSettings['copilot_enabled'] ?? $copilot['enabled'] ?? '') === 'true' || !empty($copilot['enabled'])) ? 'checked' : ''; ?> <?= !$safeSettingsAvailable ? 'disabled' : ''; ?>>
                            <span class="form-check-label"><?= $this->escape(__('Copiloto habilitado', 'glpiintegaglpi')); ?></span>
                        </label>
                        <label class="form-check">
                            <input class="form-check-input" type="checkbox" name="copilot_dry_run" value="1" <?= ((string) ($safeSettings['copilot_dry_run'] ?? $copilot['dry_run'] ?? 'true') !== 'false') ? 'checked' : ''; ?> <?= !$safeSettingsAvailable ? 'disabled' : ''; ?>>
                            <span class="form-check-label"><?= $this->escape(__('Copiloto dry-run', 'glpiintegaglpi')); ?></span>
                        </label>
                        <label class="form-check">
                            <input class="form-check-input" type="checkbox" name="external_research_enabled" value="1" <?= ((string) ($safeSettings['external_research_enabled'] ?? $externalResearch['enabled'] ?? '') === 'true') ? 'checked' : ''; ?> <?= !$safeSettingsAvailable ? 'disabled' : ''; ?>>
                            <span class="form-check-label"><?= $this->escape(__('Pesquisa externa manual', 'glpiintegaglpi')); ?></span>
                        </label>
                        <label class="form-check">
                            <input class="form-check-input" type="checkbox" name="external_research_cloud_enabled" value="1" <?= ((string) ($safeSettings['external_research_cloud_enabled'] ?? 'false') === 'true') ? 'checked' : ''; ?> <?= !$safeSettingsAvailable ? 'disabled' : ''; ?>>
                            <span class="form-check-label"><?= $this->escape(__('Cloud para pesquisa externa somente com gates', 'glpiintegaglpi')); ?></span>
                        </label>
                        <label class="form-label mt-2"><?= $this->escape(__('Provider Copiloto', 'glpiintegaglpi')); ?></label>
                        <select class="form-select form-select-sm" name="copilot_provider" <?= !$safeSettingsAvailable ? 'disabled' : ''; ?>>
                            <?php foreach (['disabled', 'ollama', 'local'] as $providerOption) { ?>
                                <option value="<?= $this->escape($providerOption); ?>" <?= (string) ($safeSettings['copilot_provider'] ?? $copilot['provider'] ?? 'disabled') === $providerOption ? 'selected' : ''; ?>><?= $this->escape($providerOption); ?></option>
                            <?php } ?>
                        </select>
                        <?php $renderModelPicker('copilot_model', __('Modelo Copiloto', 'glpiintegaglpi'), (string) ($safeSettings['copilot_model'] ?? $copilot['model'] ?? '')); ?>
                        <div class="row g-2 mt-1">
                            <div class="col-4">
                                <label class="form-label small"><?= $this->escape(__('Timeout ms', 'glpiintegaglpi')); ?></label>
                                <input class="form-control form-control-sm" type="number" name="copilot_timeout_ms" min="15000" max="120000" value="<?= $this->escape((string) ($safeSettings['copilot_timeout_ms'] ?? $copilot['timeout_ms'] ?? 90000)); ?>" <?= !$safeSettingsAvailable ? 'disabled' : ''; ?>>
                            </div>
                            <div class="col-4">
                                <label class="form-label small"><?= $this->escape(__('Msgs', 'glpiintegaglpi')); ?></label>
                                <input class="form-control form-control-sm" type="number" name="copilot_max_context_messages" min="1" max="12" value="<?= $this->escape((string) ($safeSettings['copilot_max_context_messages'] ?? $copilot['max_context_messages'] ?? 8)); ?>" <?= !$safeSettingsAvailable ? 'disabled' : ''; ?>>
                            </div>
                            <div class="col-4">
                                <label class="form-label small"><?= $this->escape(__('Chars', 'glpiintegaglpi')); ?></label>
                                <input class="form-control form-control-sm" type="number" name="copilot_max_context_chars" min="1000" max="12000" value="<?= $this->escape((string) ($safeSettings['copilot_max_context_chars'] ?? $copilot['max_context_chars'] ?? 6000)); ?>" <?= !$safeSettingsAvailable ? 'disabled' : ''; ?>>
                            </div>
                        </div>
                        <label class="form-label mt-2"><?= $this->escape(__('Limite pesquisa externa/dia', 'glpiintegaglpi')); ?></label>
                        <input class="form-control form-control-sm" type="number" name="external_research_rate_limit_per_day" min="0" max="200" value="<?= $this->escape((string) ($safeSettings['external_research_rate_limit_per_day'] ?? $externalResearch['rate_limit_per_day'] ?? 20)); ?>" <?= !$safeSettingsAvailable ? 'disabled' : ''; ?>>
                    </div>
                    <div class="col-lg-4">
                        <h2 class="h6"><?= $this->escape(__('P4, Embeddings e Gates', 'glpiintegaglpi')); ?></h2>
                        <label class="form-check">
                            <input class="form-check-input" type="checkbox" name="p4_candidate_review_enabled" value="1" <?= ((string) ($safeSettings['p4_candidate_review_enabled'] ?? $p4CandidateReview['enabled'] ?? '') === 'true') ? 'checked' : ''; ?> <?= !$safeSettingsAvailable ? 'disabled' : ''; ?>>
                            <span class="form-check-label"><?= $this->escape(__('P4 revisão IA de candidatos', 'glpiintegaglpi')); ?></span>
                        </label>
                        <label class="form-check">
                            <input class="form-check-input" type="checkbox" name="embeddings_enabled" value="1" <?= ((string) ($safeSettings['embeddings_enabled'] ?? $embeddings['enabled'] ?? '') === 'true') ? 'checked' : ''; ?> <?= !$safeSettingsAvailable ? 'disabled' : ''; ?>>
                            <span class="form-check-label"><?= $this->escape(__('Embeddings piloto', 'glpiintegaglpi')); ?></span>
                        </label>
                        <label class="form-label mt-2"><?= $this->escape(__('Provider P4', 'glpiintegaglpi')); ?></label>
                        <select class="form-select form-select-sm" name="p4_candidate_review_provider" <?= !$safeSettingsAvailable ? 'disabled' : ''; ?>>
                            <?php foreach (['disabled', 'ollama', 'local'] as $providerOption) { ?>
                                <option value="<?= $this->escape($providerOption); ?>" <?= (string) ($safeSettings['p4_candidate_review_provider'] ?? $p4CandidateReview['provider'] ?? 'disabled') === $providerOption ? 'selected' : ''; ?>><?= $this->escape($providerOption); ?></option>
                            <?php } ?>
                        </select>
                        <?php $renderModelPicker('p4_candidate_review_model', __('Modelo P4', 'glpiintegaglpi'), (string) ($safeSettings['p4_candidate_review_model'] ?? $p4CandidateReview['model'] ?? '')); ?>
                        <div class="row g-2 mt-1">
                            <div class="col-6">
                                <label class="form-label small"><?= $this->escape(__('Confiança', 'glpiintegaglpi')); ?></label>
                                <input class="form-control form-control-sm" type="number" name="p4_confidence_threshold" min="0" max="100" value="<?= $this->escape((string) ($safeSettings['p4_confidence_threshold'] ?? $p4CandidateReview['confidence_threshold'] ?? 70)); ?>" <?= !$safeSettingsAvailable ? 'disabled' : ''; ?>>
                            </div>
                            <div class="col-6">
                                <label class="form-label small"><?= $this->escape(__('Lote P4', 'glpiintegaglpi')); ?></label>
                                <input class="form-control form-control-sm" type="number" name="p4_max_candidates_per_run" min="1" max="50" value="<?= $this->escape((string) ($safeSettings['p4_max_candidates_per_run'] ?? $p4CandidateReview['max_candidates_per_run'] ?? 10)); ?>" <?= !$safeSettingsAvailable ? 'disabled' : ''; ?>>
                            </div>
                        </div>
                        <div class="border rounded p-2 mt-3">
                            <?php foreach ([
                                'cloud_dpo_approved' => __('DPO/LGPD aprovado', 'glpiintegaglpi'),
                                'cloud_director_approved' => __('Direção aprovada', 'glpiintegaglpi'),
                                'cloud_admin_opt_in' => __('Admin opt-in', 'glpiintegaglpi'),
                                'cloud_budget_configured' => __('Budget configurado', 'glpiintegaglpi'),
                                'cloud_incident_ack' => __('Incidente ack', 'glpiintegaglpi'),
                                'cloud_synthetic_test_ok' => __('Teste sintético OK', 'glpiintegaglpi'),
                            ] as $gateName => $gateLabel) { ?>
                                <label class="form-check">
                                    <input class="form-check-input" type="checkbox" name="<?= $this->escape($gateName); ?>" value="1" <?= ((string) ($safeSettings[$gateName] ?? 'false') === 'true') ? 'checked' : ''; ?> <?= !$safeSettingsAvailable ? 'disabled' : ''; ?>>
                                    <span class="form-check-label"><?= $this->escape($gateLabel); ?></span>
                                </label>
                            <?php } ?>
                        </div>
                    </div>
                </div>
                <div class="d-flex gap-2 align-items-center mt-3">
                    <button class="btn btn-primary" type="submit" <?= !$safeSettingsAvailable ? 'disabled' : ''; ?>>
                        <?= $this->escape(__('Salvar configurações não sensíveis', 'glpiintegaglpi')); ?>
                    </button>
                    <span class="text-muted small"><?= $this->escape(__('Base_url sensível e chave mestra ficam em ambiente/ops. API keys cloud ficam apenas no Secret Vault criptografado.', 'glpiintegaglpi')); ?></span>
                </div>
            </form>
        </div>
    </div>

    <div class="card mb-3">
        <div class="card-header"><?= $this->escape(__('Secret Vault cloud', 'glpiintegaglpi')); ?></div>
        <div class="card-body">
            <?php if (!empty($secretVault['locked'])) { ?>
                <div class="alert alert-warning py-2">
                    <?= $this->escape(__('Secret Vault bloqueado ou indisponível. Configure INTEGAGLPI_AI_VAULT_MASTER_KEY no ambiente/ops e aplique a migration 039.', 'glpiintegaglpi')); ?>
                </div>
            <?php } ?>
            <div class="row g-3">
                <div class="col-lg-5">
                    <form method="post" action="<?= $this->escape($this->getAiConfigUrl()); ?>">
                        <input type="hidden" name="_glpi_csrf_token" value="<?= $this->escape($csrf); ?>">
                        <input type="hidden" name="action" value="save_cloud_secret">
                        <label class="form-label"><?= $this->escape(__('Provider cloud', 'glpiintegaglpi')); ?></label>
                        <select class="form-select form-select-sm" name="vault_provider" <?= !empty($secretVault['locked']) ? 'disabled' : ''; ?>>
                            <?php foreach ($cloudProviderCatalog as $provider) {
                                if (!is_array($provider)) {
                                    continue;
                                }
                                ?>
                                <option value="<?= $this->escape((string) ($provider['id'] ?? '')); ?>"><?= $this->escape((string) ($provider['name'] ?? '')); ?></option>
                            <?php } ?>
                        </select>
                        <label class="form-label mt-2"><?= $this->escape(__('API key cloud', 'glpiintegaglpi')); ?></label>
                        <input class="form-control form-control-sm" type="password" name="vault_secret" autocomplete="new-password" maxlength="4096" placeholder="<?= $this->escape(__('Cole para substituir. O valor não será exibido novamente.', 'glpiintegaglpi')); ?>" <?= !empty($secretVault['locked']) ? 'disabled' : ''; ?>>
                        <label class="form-label mt-2"><?= $this->escape(__('Rótulo interno opcional', 'glpiintegaglpi')); ?></label>
                        <input class="form-control form-control-sm" type="text" name="vault_label" maxlength="120" placeholder="<?= $this->escape(__('Ex.: homologação OpenAI', 'glpiintegaglpi')); ?>" <?= !empty($secretVault['locked']) ? 'disabled' : ''; ?>>
                        <button class="btn btn-sm btn-outline-primary mt-3" type="submit" <?= !empty($secretVault['locked']) ? 'disabled' : ''; ?>>
                            <?= $this->escape(__('Salvar segredo no cofre', 'glpiintegaglpi')); ?>
                        </button>
                    </form>
                </div>
                <div class="col-lg-7">
                    <div class="table-responsive">
                        <table class="table table-sm mb-0">
                            <thead>
                                <tr>
                                    <th><?= $this->escape(__('Provider', 'glpiintegaglpi')); ?></th>
                                    <th><?= $this->escape(__('configured', 'glpiintegaglpi')); ?></th>
                                    <th><?= $this->escape(__('fingerprint', 'glpiintegaglpi')); ?></th>
                                    <th><?= $this->escape(__('last_test_status', 'glpiintegaglpi')); ?></th>
                                </tr>
                            </thead>
                            <tbody>
                                <?php foreach ($secretVaultProviders as $providerRow) {
                                    if (!is_array($providerRow)) {
                                        continue;
                                    }
                                    ?>
                                    <tr>
                                        <td><code><?= $this->escape((string) ($providerRow['provider'] ?? '')); ?></code></td>
                                        <td><code><?= $this->escape(!empty($providerRow['configured']) ? 'true' : 'false'); ?></code></td>
                                        <td><code><?= $this->escape((string) ($providerRow['fingerprint'] ?? '')); ?></code></td>
                                        <td><code><?= $this->escape((string) ($providerRow['last_test_status'] ?? 'not_tested')); ?></code></td>
                                    </tr>
                                <?php } ?>
                            </tbody>
                        </table>
                    </div>
                    <div class="text-muted small mt-2">
                        <?= $this->escape(__('Write-only: a UI nunca renderiza API key, token, Bearer, senha ou segredo em HTML/JS/hidden input.', 'glpiintegaglpi')); ?>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <div class="row g-3 mb-3">
        <div class="col-lg-6">
            <div class="card h-100">
                <div class="card-header"><?= $this->escape(__('Config efetiva', 'glpiintegaglpi')); ?></div>
                <div class="table-responsive">
                    <table class="table table-sm mb-0">
                        <tbody>
                            <?php foreach ($effectiveConfig as $feature => $configRows) {
                                if (!is_array($configRows)) {
                                    continue;
                                }
                                foreach ($configRows as $key => $value) { ?>
                                    <tr>
                                        <th style="width: 280px;"><?= $this->escape((string) $feature . '.' . (string) $key); ?></th>
                                        <td><code><?= $this->escape(is_bool($value) ? ($value ? 'true' : 'false') : (string) $value); ?></code></td>
                                    </tr>
                                <?php }
                            } ?>
                        </tbody>
                    </table>
                </div>
                <div class="card-footer text-muted small">
                    <?= $this->escape(__('Ordem: ai_settings no PostgreSQL para campos não sensíveis; segredos/base_url continuam em ambiente/ops.', 'glpiintegaglpi')); ?>
                </div>
            </div>
        </div>
        <div class="col-lg-6">
            <div class="card h-100">
                <div class="card-header"><?= $this->escape(__('Catálogo cloud seguro', 'glpiintegaglpi')); ?></div>
                <div class="table-responsive">
                    <table class="table table-sm mb-0">
                        <thead>
                            <tr>
                                <th><?= $this->escape(__('Provider', 'glpiintegaglpi')); ?></th>
                                <th><?= $this->escape(__('Modelos allowlist', 'glpiintegaglpi')); ?></th>
                                <th><?= $this->escape(__('Secret', 'glpiintegaglpi')); ?></th>
                                <th><?= $this->escape(__('Status', 'glpiintegaglpi')); ?></th>
                            </tr>
                        </thead>
                        <tbody>
                            <?php foreach ($cloudProviderCatalog as $provider) {
                                if (!is_array($provider)) {
                                    continue;
                                }
                                $models = is_array($provider['models'] ?? null) ? array_map('strval', $provider['models']) : [];
                                ?>
                                <tr>
                                    <td><?= $this->escape((string) ($provider['name'] ?? '')); ?></td>
                                    <td><code><?= $this->escape(implode(', ', $models)); ?></code></td>
                                    <td><code><?= $this->escape(!empty($provider['secret_configured']) ? 'configured=true' : 'configured=false'); ?></code></td>
                                    <td>
                                        <span class="badge bg-warning text-dark"><?= $this->escape(__('bloqueado', 'glpiintegaglpi')); ?></span>
                                        <code><?= $this->escape((string) ($provider['blocked_reason'] ?? 'cloud_disabled_by_default')); ?></code>
                                    </td>
                                </tr>
                            <?php } ?>
                        </tbody>
                    </table>
                </div>
                <div class="card-footer text-muted small">
                    <?= $this->escape(__('Sem descoberta externa automática. API keys ficam somente em ambiente/ops e aparecem apenas como configured=true/false.', 'glpiintegaglpi')); ?>
                </div>
            </div>
        </div>
    </div>

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
                    <div class="text-muted small">
                        <?= $this->escape(__('A edição fica no bloco “Configurações não sensíveis”. Esta seção é somente status efetivo/diagnóstico.', 'glpiintegaglpi')); ?>
                    </div>
                    <?php if ($pendingSafeFields !== []) { ?>
                        <div class="text-muted small mt-2">
                            <?= $this->escape(__('Pendentes sem storage seguro nesta fase:', 'glpiintegaglpi')); ?>
                            <code><?= $this->escape(implode(', ', array_map('strval', $pendingSafeFields))); ?></code>
                        </div>
                    <?php } ?>
                    <form method="post" action="<?= $this->escape($this->getAiConfigUrl()); ?>" class="mt-2">
                        <input type="hidden" name="_glpi_csrf_token" value="<?= $this->escape($csrf); ?>">
                        <input type="hidden" name="action" value="run_synthetic_local_test">
                        <button class="btn btn-sm btn-outline-secondary" type="submit">
                            <?= $this->escape(__('Validar configuração local sem dados reais', 'glpiintegaglpi')); ?>
                        </button>
                    </form>
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
                                'kb_local_lookup' => $copilot['kb_local_lookup'] ?? 'enabled',
                                'kb_local_first' => $copilot['kb_local_first'] ?? 'true',
                                'max_context_messages' => $copilot['max_context_messages'] ?? '8',
                                'max_kb_articles' => $copilot['max_kb_articles'] ?? '3',
                                'timeout_ms' => $copilot['timeout_ms'] ?? '90000',
                                'auto_send' => $copilot['auto_send'] ?? 'false',
                                'ticket_mutation' => $copilot['ticket_mutation'] ?? 'false',
                            ]); ?>
                        </tbody>
                    </table>
                </div>
                <div class="card-footer text-muted small">
                    <?= $this->escape(__('O Copiloto monta contexto sanitizado, consulta KB local primeiro e apenas gera rascunho para revisão humana.', 'glpiintegaglpi')); ?>
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
                                'synthetic_test_ok' => $pilot['synthetic_test_ok'] ?? 'false',
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

        <div class="col-lg-6">
            <div class="card h-100">
                <div class="card-header"><?= $this->escape(__('Pesquisa Externa Controlada', 'glpiintegaglpi')); ?></div>
                <div class="table-responsive">
                    <table class="table table-sm mb-0">
                        <tbody>
                            <?php $renderRows([
                                'enabled' => $externalResearch['enabled'] ?? 'false',
                                'enabled_default' => $externalResearch['enabled_default'] ?? 'false',
                                'cloud_enabled' => $externalResearch['cloud_enabled'] ?? 'false',
                                'manual_trigger_required' => $externalResearch['manual_trigger_required'] ?? 'true',
                                'prompt_preview_required' => $externalResearch['prompt_preview_required'] ?? 'true',
                                'source_allowlist_required' => $externalResearch['source_allowlist_required'] ?? 'true',
                                'tables_ready' => $externalResearch['tables_ready'] ?? false,
                                'status' => $externalResearch['status'] ?? 'disabled',
                                'blocked_reason' => $externalResearch['blocked_reason'] ?? 'feature_flag_disabled',
                            ]); ?>
                        </tbody>
                    </table>
                </div>
                <div class="card-footer">
                    <a class="btn btn-sm btn-outline-primary" href="<?= $this->escape(GlpiPlugin\Integaglpi\Plugin::getExternalResearchUrl()); ?>">
                        <?= $this->escape(__('Abrir pesquisa externa manual', 'glpiintegaglpi')); ?>
                    </a>
                    <div class="text-muted small mt-2">
                        <?= $this->escape(__('A pesquisa externa exige clique explícito, preview anonimizado, allowlist de fontes e não publica KB automaticamente.', 'glpiintegaglpi')); ?>
                    </div>
                </div>
            </div>
        </div>

        <div class="col-lg-6">
            <div class="card h-100">
                <div class="card-header"><?= $this->escape(__('P4 Revisão de Candidatos KB', 'glpiintegaglpi')); ?></div>
                <div class="table-responsive">
                    <table class="table table-sm mb-0">
                        <tbody>
                            <?php $renderRows([
                                'enabled' => $p4CandidateReview['enabled'] ?? 'false',
                                'enabled_default' => $p4CandidateReview['enabled_default'] ?? 'false',
                                'provider' => $p4CandidateReview['provider'] ?? 'disabled',
                                'model' => $p4CandidateReview['model'] ?? 'não verificado',
                                'local_provider_configured' => $p4CandidateReview['local_provider_configured'] ?? false,
                                'confidence_threshold' => $p4CandidateReview['confidence_threshold'] ?? '70',
                                'max_candidates_per_run' => $p4CandidateReview['max_candidates_per_run'] ?? '10',
                                'tables_ready' => $p4CandidateReview['tables_ready'] ?? false,
                                'human_review_required' => $p4CandidateReview['human_review_required'] ?? 'true',
                                'no_auto_publish' => $p4CandidateReview['no_auto_publish'] ?? 'true',
                            ]); ?>
                        </tbody>
                    </table>
                </div>
                <div class="card-footer text-muted small">
                    <?= $this->escape(__('P4 usa apenas candidatos P3 sanitizados e persistidos. Merge/improve/discard exigem revisão humana.', 'glpiintegaglpi')); ?>
                </div>
            </div>
        </div>

        <div class="col-lg-6">
            <div class="card h-100">
                <div class="card-header"><?= $this->escape(__('Embeddings', 'glpiintegaglpi')); ?></div>
                <div class="table-responsive">
                    <table class="table table-sm mb-0">
                        <tbody>
                            <?php $renderRows([
                                'enabled' => $embeddings['enabled'] ?? 'false',
                                'default_enabled' => $embeddings['default_enabled'] ?? 'false',
                                'provider' => $embeddings['provider'] ?? 'disabled',
                                'operational_rag' => $embeddings['operational_rag'] ?? 'false',
                            ]); ?>
                        </tbody>
                    </table>
                </div>
                <div class="card-footer text-muted small">
                    <?= $this->escape(__('Embeddings permanecem piloto controlado e desabilitado por padrão; não há RAG operacional automático nesta tela.', 'glpiintegaglpi')); ?>
                </div>
            </div>
        </div>

        <div class="col-lg-6">
            <div class="card h-100">
                <div class="card-header"><?= $this->escape(__('Auditoria IA', 'glpiintegaglpi')); ?></div>
                <div class="table-responsive">
                    <table class="table table-sm mb-0">
                        <tbody>
                            <?php $renderRows([
                                'table_available' => $auditStatus['table_available'] ?? false,
                                'payload_policy' => $auditStatus['payload_policy'] ?? 'hashes_only_no_raw_prompt_no_pii',
                                'source_required' => $auditStatus['source_required'] ?? 'true',
                                'retention_documented' => $auditStatus['retention_documented'] ?? 'true',
                            ]); ?>
                        </tbody>
                    </table>
                </div>
                <div class="card-footer text-muted small">
                    <?= $this->escape(__('Eventos de IA registram hashes, status, provider e usuário quando disponível; payload bruto e PII ficam fora da auditoria.', 'glpiintegaglpi')); ?>
                </div>
            </div>
        </div>
    </div>
</div>
