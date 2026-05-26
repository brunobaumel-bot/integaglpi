<?php

declare(strict_types=1);

/**
 * @var GlpiPlugin\Integaglpi\Renderer\ExternalResearchRenderer $this
 * @var array<string, mixed> $data
 */

$flash = is_array($data['flash'] ?? null) ? $data['flash'] : null;
$preview = is_array($flash['preview'] ?? null) ? $flash['preview'] : null;
$candidate = is_array($flash['candidate'] ?? null) ? $flash['candidate'] : null;
$researchResult = is_array($flash['research_result'] ?? null) ? $flash['research_result'] : null;
$catalog = is_array($data['catalog'] ?? null) ? $data['catalog'] : [];
$recentRequests = is_array($data['recent_requests'] ?? null) ? $data['recent_requests'] : [];
$recentCandidates = is_array($data['recent_candidates'] ?? null) ? $data['recent_candidates'] : [];
$internalContext = is_array($data['internal_context'] ?? null) ? $data['internal_context'] : ['query' => '', 'items' => [], 'message' => ''];
$aiProviderCatalog = is_array($data['ai_provider_catalog'] ?? null) ? $data['ai_provider_catalog'] : [];
$localProvider = is_array($aiProviderCatalog['local_ollama_available'] ?? null) ? $aiProviderCatalog['local_ollama_available'] : [];
$readyCloudProviders = is_array($aiProviderCatalog['cloud_ready_providers'] ?? null) ? $aiProviderCatalog['cloud_ready_providers'] : [];
$blockedCloudProviders = is_array($aiProviderCatalog['cloud_blocked_providers'] ?? null) ? $aiProviderCatalog['cloud_blocked_providers'] : [];
$defaultProviderSelection = is_array($aiProviderCatalog['external_research_default'] ?? null)
    ? $aiProviderCatalog['external_research_default']
    : ['provider' => 'disabled', 'model' => ''];
$previewProviderSelection = is_array($preview['provider_selection'] ?? null) ? $preview['provider_selection'] : [];
$selectedAiProvider = trim((string) ($_POST['ai_provider'] ?? $previewProviderSelection['provider'] ?? $defaultProviderSelection['provider'] ?? 'disabled'));
$selectedAiModel = trim((string) ($_POST['ai_model'] ?? $previewProviderSelection['model'] ?? $defaultProviderSelection['model'] ?? ''));
$error = trim((string) ($data['error'] ?? ''));
$csrf = GlpiPlugin\Integaglpi\Plugin::getCsrfToken();
$previewToken = is_array($preview) ? (string) ($preview['preview_token'] ?? '') : '';
$requestId = trim((string) ($flash['request_id'] ?? $candidate['request_id'] ?? $_POST['request_id'] ?? ''));
$prefillTechnicalSummary = (string) ($_POST['technical_summary'] ?? $_GET['q'] ?? '');
$hasTicketPrefill = trim((string) ($_GET['q'] ?? '')) !== '';
?>

<div class="container-fluid plugin-integaglpi-external-research">
    <div class="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-3">
        <div>
            <h1 class="h3 mb-1"><?php echo $this->escape(__('Pesquisa externa controlada', 'glpiintegaglpi')); ?></h1>
            <p class="text-muted mb-0">
                <?php echo $this->escape(__('Pesquisa manual com fontes cadastradas, citações, revisão humana e publicação manual na KB nativa.', 'glpiintegaglpi')); ?>
            </p>
        </div>
        <span class="badge bg-secondary"><?php echo $this->escape(__('manual / auditável / sem ação operacional', 'glpiintegaglpi')); ?></span>
    </div>

    <div class="alert alert-warning" role="alert">
        <?php echo $this->escape(__('LGPD/DPO: revise o Preview anonimizado antes de confirmar. Cloud fica desabilitada por padrão. Publicação manual. Não execute comandos/scripts sem validação técnica humana.', 'glpiintegaglpi')); ?>
    </div>

    <?php if ($error !== '') { ?>
        <div class="alert alert-info"><?php echo $this->escape($error); ?></div>
    <?php } ?>

    <?php if ($flash !== null) { ?>
        <div class="alert alert-<?php echo $this->escape((string) ($flash['type'] ?? 'info')); ?>">
            <?php echo $this->escape((string) ($flash['message'] ?? '')); ?>
        </div>

        <?php
        $previewSources = is_array($preview['validated_sources'] ?? null) ? $preview['validated_sources'] : [];
        $previewErrors = is_array($preview['source_errors'] ?? null) ? $preview['source_errors'] : [];
        $previewSanitized = is_array($preview['sanitized'] ?? null) ? $preview['sanitized'] : [];
        ?>
        <div class="card border-<?php echo $this->escape((string) ($flash['type'] ?? 'info')); ?> mb-3">
            <div class="card-header"><?php echo $this->escape(__('Resultado da ação', 'glpiintegaglpi')); ?></div>
            <div class="card-body">
                <dl class="row mb-0">
                    <dt class="col-sm-4"><?php echo $this->escape(__('Status', 'glpiintegaglpi')); ?></dt>
                    <dd class="col-sm-8"><?php echo $this->escape((string) ($flash['type'] ?? 'info')); ?></dd>
                    <dt class="col-sm-4"><?php echo $this->escape(__('Motivo / retorno', 'glpiintegaglpi')); ?></dt>
                    <dd class="col-sm-8"><?php echo $this->escape((string) ($flash['message'] ?? '')); ?></dd>
                    <?php if ($requestId !== '') { ?>
                        <dt class="col-sm-4"><?php echo $this->escape(__('Pesquisa', 'glpiintegaglpi')); ?></dt>
                        <dd class="col-sm-8"><code><?php echo $this->escape($requestId); ?></code></dd>
                    <?php } ?>
                    <?php if ($preview !== null) { ?>
                        <dt class="col-sm-4"><?php echo $this->escape(__('Fontes aceitas', 'glpiintegaglpi')); ?></dt>
                        <dd class="col-sm-8"><?php echo $this->escape((string) count($previewSources)); ?></dd>
                        <dt class="col-sm-4"><?php echo $this->escape(__('Fontes bloqueadas', 'glpiintegaglpi')); ?></dt>
                        <dd class="col-sm-8"><?php echo $this->escape((string) count($previewErrors)); ?></dd>
                        <dt class="col-sm-4"><?php echo $this->escape(__('PII/segredo detectado', 'glpiintegaglpi')); ?></dt>
                        <dd class="col-sm-8"><?php echo $this->escape(($previewSanitized['blocked'] ?? false) ? 'sim' : 'não'); ?></dd>
                        <?php $providerSelection = is_array($preview['provider_selection'] ?? null) ? $preview['provider_selection'] : []; ?>
                        <dt class="col-sm-4"><?php echo $this->escape(__('Provider/modelo selecionado', 'glpiintegaglpi')); ?></dt>
                        <dd class="col-sm-8">
                            <code><?php echo $this->escape((string) ($providerSelection['provider'] ?? 'disabled')); ?></code>
                            /
                            <code><?php echo $this->escape((string) ($providerSelection['model'] ?? '')); ?></code>
                            <?php if (empty($providerSelection['ready'])) { ?>
                                <span class="badge bg-warning text-dark"><?php echo $this->escape((string) ($providerSelection['blocked_reason'] ?? 'provider_not_ready')); ?></span>
                            <?php } ?>
                        </dd>
                    <?php } ?>
                    <?php if ($researchResult !== null) { ?>
                        <dt class="col-sm-4"><?php echo $this->escape(__('Confiança estimada', 'glpiintegaglpi')); ?></dt>
                        <dd class="col-sm-8"><?php echo $this->escape((string) ($researchResult['confidence_score'] ?? 0)); ?></dd>
                        <dt class="col-sm-4"><?php echo $this->escape(__('Origem IA', 'glpiintegaglpi')); ?></dt>
                        <dd class="col-sm-8">
                            <code><?php echo $this->escape((string) ($researchResult['source'] ?? 'external_research_manual_catalog')); ?></code>
                            · <code><?php echo $this->escape((string) ($researchResult['provider'] ?? 'disabled')); ?></code>
                            <?php if (trim((string) ($researchResult['model'] ?? '')) !== '') { ?>
                                / <code><?php echo $this->escape((string) ($researchResult['model'] ?? '')); ?></code>
                            <?php } ?>
                        </dd>
                    <?php } ?>
                    <dt class="col-sm-4"><?php echo $this->escape(__('Próximos passos', 'glpiintegaglpi')); ?></dt>
                    <dd class="col-sm-8">
                        <?php if ($preview === null) { ?>
                            <?php echo $this->escape(__('Preencha resumo e fontes permitidas, gere o preview e confirme manualmente.', 'glpiintegaglpi')); ?>
                        <?php } elseif (($flash['type'] ?? '') === 'success' && $requestId !== '' && $candidate === null) { ?>
                            <?php echo $this->escape(__('Pesquisa confirmada. Use “Gerar candidato revisável” se quiser criar um rascunho para revisão humana.', 'glpiintegaglpi')); ?>
                        <?php } elseif ($candidate !== null) { ?>
                            <?php echo $this->escape(__('Revise o Markdown e publique manualmente na KB nativa apenas se aprovado.', 'glpiintegaglpi')); ?>
                        <?php } else { ?>
                            <?php echo $this->escape(__('Corrija o resumo ou as fontes bloqueadas antes de confirmar.', 'glpiintegaglpi')); ?>
                        <?php } ?>
                    </dd>
                </dl>
            </div>
        </div>
    <?php } ?>

    <div class="row g-3">
        <div class="col-lg-7">
            <form method="post" action="<?php echo $this->escape($this->getExternalResearchUrl()); ?>" class="card mb-3">
                <div class="card-header"><?php echo $this->escape(__('Solicitação manual', 'glpiintegaglpi')); ?></div>
                <div class="card-body">
                    <input type="hidden" name="_glpi_csrf_token" value="<?php echo $this->escape($csrf); ?>">
                    <?php if ($previewToken !== '') { ?>
                        <input type="hidden" name="preview_token" value="<?php echo $this->escape($previewToken); ?>">
                    <?php } ?>
                    <?php if ($requestId !== '') { ?>
                        <input type="hidden" name="request_id" value="<?php echo $this->escape($requestId); ?>">
                    <?php } ?>
                    <label class="form-label" for="technical_summary"><?php echo $this->escape(__('Resumo técnico sem dados pessoais', 'glpiintegaglpi')); ?></label>
                    <textarea class="form-control" id="technical_summary" name="technical_summary" rows="6" maxlength="4000"><?php echo $this->escape($prefillTechnicalSummary); ?></textarea>
                    <?php if ($hasTicketPrefill) { ?>
                        <div class="alert alert-info py-2 mt-2">
                            <?php echo $this->escape(__('Resumo técnico sanitizado importado do chamado. Revise o preview antes de confirmar qualquer pesquisa externa.', 'glpiintegaglpi')); ?>
                        </div>
                    <?php } ?>
                    <div class="form-text">
                        <?php echo $this->escape(__('Não cole e-mail, telefone, CPF/CNPJ, tokens, senhas, IPs internos, anexos ou histórico completo.', 'glpiintegaglpi')); ?>
                    </div>

                    <div class="row g-2 mt-3">
                        <div class="col-md-6">
                            <label class="form-label" for="ai_provider"><?php echo $this->escape(__('Provider IA para pesquisa', 'glpiintegaglpi')); ?></label>
                            <select class="form-select" id="ai_provider" name="ai_provider">
                                <option value="disabled" <?php echo $selectedAiProvider === 'disabled' ? 'selected' : ''; ?>>
                                    <?php echo $this->escape(__('manual / sem provider IA', 'glpiintegaglpi')); ?>
                                </option>
                                <?php
                                $localReady = !empty($localProvider['ready']);
                                ?>
                                <option value="ollama" <?php echo $selectedAiProvider === 'ollama' ? 'selected' : ''; ?> <?php echo $localReady ? '' : 'disabled'; ?>>
                                    <?php echo $this->escape(__('Ollama local', 'glpiintegaglpi')); ?>
                                    <?php echo $localReady ? '' : ' - ' . $this->escape((string) ($localProvider['blocked_reason'] ?? 'local_model_not_configured')); ?>
                                </option>
                                <?php foreach ($readyCloudProviders as $provider) {
                                    if (!is_array($provider)) { continue; }
                                    $providerId = (string) ($provider['id'] ?? '');
                                    if ($providerId === '') { continue; }
                                    ?>
                                    <option value="<?php echo $this->escape($providerId); ?>" <?php echo $selectedAiProvider === $providerId ? 'selected' : ''; ?>>
                                        <?php echo $this->escape((string) ($provider['name'] ?? $providerId)); ?>
                                    </option>
                                <?php } ?>
                                <?php foreach ($blockedCloudProviders as $provider) {
                                    if (!is_array($provider)) { continue; }
                                    $providerId = (string) ($provider['id'] ?? '');
                                    if ($providerId === '') { continue; }
                                    ?>
                                    <option value="<?php echo $this->escape($providerId); ?>" disabled>
                                        <?php echo $this->escape((string) ($provider['name'] ?? $providerId) . ' - bloqueado: ' . (string) ($provider['blocked_reason'] ?? 'provider_not_ready')); ?>
                                    </option>
                                <?php } ?>
                            </select>
                        </div>
                        <div class="col-md-6">
                            <label class="form-label" for="ai_model"><?php echo $this->escape(__('Modelo IA', 'glpiintegaglpi')); ?></label>
                            <select class="form-select" id="ai_model" name="ai_model">
                                <?php $localModels = is_array($localProvider['models'] ?? null) ? array_map('strval', $localProvider['models']) : []; ?>
                                <?php if ($localModels !== []) { ?>
                                    <optgroup label="<?php echo $this->escape(__('Ollama local', 'glpiintegaglpi')); ?>">
                                        <?php foreach ($localModels as $modelOption) { ?>
                                            <option value="<?php echo $this->escape($modelOption); ?>" <?php echo $selectedAiModel === $modelOption ? 'selected' : ''; ?>><?php echo $this->escape($modelOption); ?></option>
                                        <?php } ?>
                                    </optgroup>
                                <?php } elseif ($selectedAiModel !== '') { ?>
                                    <option value="<?php echo $this->escape($selectedAiModel); ?>" selected><?php echo $this->escape($selectedAiModel); ?></option>
                                <?php } ?>
                                <?php foreach (array_merge($readyCloudProviders, $blockedCloudProviders) as $provider) {
                                    if (!is_array($provider)) { continue; }
                                    $models = is_array($provider['models'] ?? null) ? array_map('strval', $provider['models']) : [];
                                    if ($models === []) { continue; }
                                    ?>
                                    <optgroup label="<?php echo $this->escape((string) ($provider['name'] ?? $provider['id'] ?? 'cloud')); ?>">
                                        <?php foreach ($models as $modelOption) { ?>
                                            <option value="<?php echo $this->escape($modelOption); ?>" <?php echo $selectedAiModel === $modelOption ? 'selected' : ''; ?>><?php echo $this->escape($modelOption); ?></option>
                                        <?php } ?>
                                    </optgroup>
                                <?php } ?>
                                <?php if ($selectedAiModel === '') { ?>
                                    <option value="" selected><?php echo $this->escape(__('sem modelo selecionado', 'glpiintegaglpi')); ?></option>
                                <?php } ?>
                            </select>
                            <div class="form-text">
                                <?php echo $this->escape(__('Cloud só executa se provider estiver pronto, preview confirmado e PII guard OK. Gemini/Claude ficam bloqueados até last_test_status=success.', 'glpiintegaglpi')); ?>
                            </div>
                        </div>
                    </div>

                    <label class="form-label mt-3" for="source_urls"><?php echo $this->escape(__('Fontes permitidas avançadas/opcionais, uma URL por linha', 'glpiintegaglpi')); ?></label>
                    <textarea class="form-control" id="source_urls" name="source_urls" rows="4" maxlength="2500"><?php echo $this->escape((string) ($_POST['source_urls'] ?? '')); ?></textarea>
                    <div class="form-text">
                        <?php echo $this->escape(__('Use fontes oficiais allowlisted quando a pesquisa externa for confirmada. SourceValidator bloqueia fonte fora do catálogo.', 'glpiintegaglpi')); ?>
                    </div>

                    <div class="d-flex flex-wrap gap-2 mt-3">
                        <button class="btn btn-outline-primary" type="submit" name="action" value="preview">
                            <?php echo $this->escape(__('Gerar Preview anonimizado', 'glpiintegaglpi')); ?>
                        </button>
                        <button class="btn btn-primary" type="submit" name="action" value="confirm_research">
                            <?php echo $this->escape(__('Confirmar pesquisa', 'glpiintegaglpi')); ?>
                        </button>
                        <button class="btn btn-outline-success" type="submit" name="action" value="create_candidate">
                            <?php echo $this->escape(__('Gerar candidato revisável', 'glpiintegaglpi')); ?>
                        </button>
                        <button class="btn btn-outline-danger" type="submit" name="action" value="report_incident">
                            <?php echo $this->escape(__('Reportar incidente', 'glpiintegaglpi')); ?>
                        </button>
                    </div>
                </div>
            </form>

            <?php if ($preview !== null) { ?>
                <?php $sanitized = is_array($preview['sanitized'] ?? null) ? $preview['sanitized'] : []; ?>
                <div class="card mb-3">
                    <div class="card-header"><?php echo $this->escape(__('Preview anonimizado', 'glpiintegaglpi')); ?></div>
                    <div class="card-body">
                        <textarea class="form-control" rows="6" readonly><?php echo $this->escape((string) ($sanitized['text'] ?? '')); ?></textarea>
                        <dl class="row mt-3 mb-0">
                            <dt class="col-sm-4"><?php echo $this->escape(__('Payload hash', 'glpiintegaglpi')); ?></dt>
                            <dd class="col-sm-8"><code><?php echo $this->escape((string) ($sanitized['anonymized_payload_hash'] ?? '')); ?></code></dd>
                            <dt class="col-sm-4"><?php echo $this->escape(__('Bloqueado', 'glpiintegaglpi')); ?></dt>
                            <dd class="col-sm-8"><?php echo $this->escape(($sanitized['blocked'] ?? false) ? 'true' : 'false'); ?></dd>
                            <dt class="col-sm-4"><?php echo $this->escape(__('Sinais removidos', 'glpiintegaglpi')); ?></dt>
                            <dd class="col-sm-8"><?php echo $this->escape(implode(', ', (array) ($sanitized['detected_kinds'] ?? []))); ?></dd>
                        </dl>
                    </div>
                </div>

                <div class="card mb-3">
                    <div class="card-header"><?php echo $this->escape(__('Fontes e conflitos', 'glpiintegaglpi')); ?></div>
                    <div class="card-body">
                        <?php $validatedSources = is_array($preview['validated_sources'] ?? null) ? $preview['validated_sources'] : []; ?>
                        <?php $sourceErrors = is_array($preview['source_errors'] ?? null) ? $preview['source_errors'] : []; ?>
                        <?php if ($validatedSources === [] && $sourceErrors === []) { ?>
                            <p class="text-muted mb-0"><?php echo $this->escape(__('Nenhuma fonte informada.', 'glpiintegaglpi')); ?></p>
                        <?php } ?>
                        <?php if ($validatedSources !== []) { ?>
                            <ul>
                                <?php foreach ($validatedSources as $source) {
                                    if (!is_array($source)) {
                                        continue;
                                    }
                                    $catalogRow = is_array($source['catalog'] ?? null) ? $source['catalog'] : [];
                                    ?>
                                    <li>
                                        <a href="<?php echo $this->escape((string) ($source['url'] ?? '')); ?>"><?php echo $this->escape((string) ($catalogRow['name'] ?? $source['url'] ?? '')); ?></a>
                                        · <?php echo $this->escape((string) ($catalogRow['source_type'] ?? '')); ?>
                                        · <?php echo $this->escape(__('confiança', 'glpiintegaglpi')); ?> <?php echo $this->escape((string) ($source['confidence_score'] ?? 0)); ?>
                                    </li>
                                <?php } ?>
                            </ul>
                        <?php } ?>
                        <?php if ($sourceErrors !== []) { ?>
                            <div class="alert alert-danger">
                                <?php echo $this->escape(__('Fonte fora do catálogo bloqueada:', 'glpiintegaglpi')); ?>
                                <?php foreach ($sourceErrors as $errorRow) { ?>
                                    <div><code><?php echo $this->escape((string) ($errorRow['url'] ?? '')); ?></code></div>
                                <?php } ?>
                            </div>
                        <?php } ?>
                        <?php $conflicts = is_array($preview['source_conflicts'] ?? null) ? $preview['source_conflicts'] : []; ?>
                        <?php if ($conflicts !== []) { ?>
                            <div class="alert alert-warning">
                                <?php foreach ($conflicts as $conflict) { ?>
                                    <div><?php echo $this->escape((string) $conflict); ?></div>
                                <?php } ?>
                            </div>
                        <?php } ?>
                    </div>
                </div>
            <?php } ?>

            <?php if ($candidate !== null) { ?>
                <div class="card mb-3">
                    <div class="card-header"><?php echo $this->escape(__('Candidato gerado', 'glpiintegaglpi')); ?></div>
                    <div class="card-body">
                        <dl class="row">
                            <dt class="col-sm-4">Status</dt>
                            <dd class="col-sm-8"><?php echo $this->escape((string) ($candidate['status'] ?? '')); ?></dd>
                            <dt class="col-sm-4"><?php echo $this->escape(__('Confiança', 'glpiintegaglpi')); ?></dt>
                            <dd class="col-sm-8"><?php echo $this->escape((string) ($candidate['confidence_score'] ?? 0)); ?></dd>
                            <dt class="col-sm-4"><?php echo $this->escape(__('Última verificação', 'glpiintegaglpi')); ?></dt>
                            <dd class="col-sm-8"><?php echo $this->escape((string) ($candidate['last_verified_date'] ?? '')); ?></dd>
                            <dt class="col-sm-4"><?php echo $this->escape(__('Próxima revisão', 'glpiintegaglpi')); ?></dt>
                            <dd class="col-sm-8"><?php echo $this->escape((string) ($candidate['next_review_due'] ?? '')); ?></dd>
                        </dl>
                        <label class="form-label" for="candidate_markdown"><?php echo $this->escape(__('Markdown para copiar e publicar manualmente', 'glpiintegaglpi')); ?></label>
                        <textarea class="form-control" id="candidate_markdown" rows="10" readonly><?php echo $this->escape((string) ($candidate['content_markdown'] ?? '')); ?></textarea>
                        <div class="form-text">
                            <?php echo $this->escape(__('Publicação manual na Base de Conhecimento GLPI. Nenhuma escrita automática na KB nativa.', 'glpiintegaglpi')); ?>
                        </div>
                        <form method="post" action="<?php echo $this->escape($this->getExternalResearchUrl()); ?>" class="mt-3">
                            <input type="hidden" name="_glpi_csrf_token" value="<?php echo $this->escape($csrf); ?>">
                            <input type="hidden" name="action" value="copy_markdown">
                            <input type="hidden" name="request_id" value="<?php echo $this->escape((string) ($candidate['request_id'] ?? $flash['request_id'] ?? '')); ?>">
                            <input type="hidden" name="candidate_id" value="<?php echo $this->escape((string) ($candidate['candidate_id'] ?? '')); ?>">
                            <button class="btn btn-outline-secondary" type="submit">
                                <?php echo $this->escape(__('Registrar cópia do Markdown', 'glpiintegaglpi')); ?>
                            </button>
                        </form>
                    </div>
                </div>
            <?php } ?>
        </div>

        <div class="col-lg-5">
            <div class="card mb-3">
                <div class="card-header"><?php echo $this->escape(__('Catálogo de fontes permitidas', 'glpiintegaglpi')); ?></div>
                <div class="card-body">
                    <?php if ($catalog === []) { ?>
                        <p class="text-muted mb-0"><?php echo $this->escape(__('Catálogo indisponível ou migration pendente.', 'glpiintegaglpi')); ?></p>
                    <?php } else { ?>
                        <ul class="mb-0">
                            <?php foreach ($catalog as $source) {
                                if (!is_array($source)) {
                                    continue;
                                }
                                ?>
                                <li>
                                    <strong><?php echo $this->escape((string) ($source['name'] ?? '')); ?></strong>
                                    <span class="text-muted"><?php echo $this->escape((string) ($source['url_pattern'] ?? '')); ?></span>
                                </li>
                            <?php } ?>
                        </ul>
                    <?php } ?>
                </div>
            </div>

            <div class="card mb-3">
                <div class="card-header"><?php echo $this->escape(__('Conhecimento interno relacionado', 'glpiintegaglpi')); ?></div>
                <div class="card-body">
                    <?php
                    $internalItems = is_array($internalContext['items'] ?? null) ? $internalContext['items'] : [];
                    $internalMessage = trim((string) ($internalContext['message'] ?? ''));
                    ?>
                    <?php if ($internalMessage !== '') { ?>
                        <p class="text-muted mb-0"><?php echo $this->escape($internalMessage); ?></p>
                    <?php } else { ?>
                        <ul class="mb-0">
                            <?php foreach ($internalItems as $item) {
                                if (!is_array($item)) {
                                    continue;
                                }
                                $url = (string) ($item['internal_url'] ?? '');
                                ?>
                                <li class="mb-2">
                                    <strong><?php echo $this->escape((string) ($item['title'] ?? '')); ?></strong>
                                    <div class="text-muted small">
                                        <?php echo $this->escape((string) ($item['origin'] ?? '')); ?>
                                        · <?php echo $this->escape((string) ($item['type'] ?? '')); ?>
                                        · <?php echo $this->escape(__('confiança', 'glpiintegaglpi')); ?> <?php echo $this->escape((string) ($item['confidence'] ?? 0)); ?>
                                        <?php if ((string) ($item['status'] ?? '') !== '') { ?>
                                            · <?php echo $this->escape((string) $item['status']); ?>
                                        <?php } ?>
                                    </div>
                                    <?php if ($url !== '') { ?>
                                        <a class="small" href="<?php echo $this->escape($url); ?>"><?php echo $this->escape(__('Abrir referência interna', 'glpiintegaglpi')); ?></a>
                                    <?php } ?>
                                </li>
                            <?php } ?>
                        </ul>
                    <?php } ?>
                </div>
            </div>

            <div class="card mb-3">
                <div class="card-header"><?php echo $this->escape(__('Pesquisas recentes', 'glpiintegaglpi')); ?></div>
                <div class="card-body">
                    <?php if ($recentRequests === []) { ?>
                        <p class="text-muted mb-0"><?php echo $this->escape(__('Nenhuma pesquisa registrada ainda. Preencha resumo e fontes permitidas, gere preview e confirme a pesquisa.', 'glpiintegaglpi')); ?></p>
                    <?php } else { ?>
                        <ul class="mb-0">
                            <?php foreach ($recentRequests as $request) {
                                if (!is_array($request)) {
                                    continue;
                                }
                                ?>
                                <li>
                                    <code><?php echo $this->escape((string) ($request['request_id'] ?? '')); ?></code>
                                    · <?php echo $this->escape((string) ($request['status'] ?? '')); ?>
                                    · <?php echo $this->escape((string) ($request['created_at'] ?? '')); ?>
                                </li>
                            <?php } ?>
                        </ul>
                    <?php } ?>
                </div>
            </div>

            <div class="card">
                <div class="card-header"><?php echo $this->escape(__('Candidatos recentes', 'glpiintegaglpi')); ?></div>
                <div class="card-body">
                    <?php if ($recentCandidates === []) { ?>
                        <p class="text-muted mb-0"><?php echo $this->escape(__('Nenhum candidato externo criado ainda. Confirme uma pesquisa antes de gerar candidato revisável.', 'glpiintegaglpi')); ?></p>
                    <?php } else { ?>
                        <?php foreach ($recentCandidates as $recent) {
                            if (!is_array($recent)) {
                                continue;
                            }
                            ?>
                            <div class="border rounded p-2 mb-2">
                                <strong><?php echo $this->escape((string) ($recent['title'] ?? '')); ?></strong>
                                <div class="text-muted small">
                                    <?php echo $this->escape((string) ($recent['status'] ?? '')); ?>
                                    · <?php echo $this->escape(__('confiança', 'glpiintegaglpi')); ?> <?php echo $this->escape((string) ($recent['confidence_score'] ?? 0)); ?>
                                </div>
                                <textarea class="form-control mt-2" rows="4" readonly><?php echo $this->escape((string) ($recent['content_markdown'] ?? '')); ?></textarea>
                            </div>
                        <?php } ?>
                    <?php } ?>
                </div>
            </div>
        </div>
    </div>
</div>
