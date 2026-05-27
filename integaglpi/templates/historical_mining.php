<?php

declare(strict_types=1);

/**
 * @var GlpiPlugin\Integaglpi\Renderer\HistoricalMiningRenderer $this
 * @var array<string, mixed> $data
 */

$flash = is_array($data['flash'] ?? null) ? $data['flash'] : null;
$configured = (bool) ($data['configured'] ?? false);
$miningResult = is_array($flash['mining_result'] ?? null) ? $flash['mining_result'] : null;
$candidateResult = is_array($flash['candidate_result'] ?? null) ? $flash['candidate_result'] : null;
$aiReviewPreview = is_array($flash['ai_review_preview'] ?? null) ? $flash['ai_review_preview'] : null;
$aiReviewResult = is_array($flash['ai_review_result'] ?? null) ? $flash['ai_review_result'] : null;
$upload = is_array($flash['upload'] ?? null) ? $flash['upload'] : null;
$exportPreview = is_array($flash['export_preview'] ?? null) ? $flash['export_preview'] : null;
$exportUpload = is_array($flash['export_upload'] ?? null) ? $flash['export_upload'] : null;
$exportOptions = is_array($data['export_options'] ?? null) ? $data['export_options'] : [];
$recentP4CandidateRuns = is_array($data['recent_p4_candidate_runs'] ?? null) ? $data['recent_p4_candidate_runs'] : [];
$eligibleP4Statuses = is_array($data['p4_eligible_candidate_statuses'] ?? null) ? $data['p4_eligible_candidate_statuses'] : [];
$aiProviderCatalog = is_array($data['ai_provider_catalog'] ?? null) ? $data['ai_provider_catalog'] : [];
$localProvider = is_array($aiProviderCatalog['local_ollama_available'] ?? null) ? $aiProviderCatalog['local_ollama_available'] : [];
$readyCloudProviders = is_array($aiProviderCatalog['cloud_ready_providers'] ?? null) ? $aiProviderCatalog['cloud_ready_providers'] : [];
$blockedCloudProviders = is_array($aiProviderCatalog['cloud_blocked_providers'] ?? null) ? $aiProviderCatalog['cloud_blocked_providers'] : [];
$p4DefaultProvider = is_array($aiProviderCatalog['p4_default'] ?? null) ? $aiProviderCatalog['p4_default'] : ['provider' => 'ollama', 'model' => ''];
$previewProviderSelection = is_array($aiReviewPreview['provider_selection'] ?? null) ? $aiReviewPreview['provider_selection'] : [];
$resultP4Provider = trim((string) ($aiReviewResult['provider'] ?? ''));
$resultP4Model = trim((string) ($aiReviewResult['model'] ?? ''));
$postedP4Provider = trim((string) ($_POST['ai_provider'] ?? $_POST['ai_review_provider'] ?? ''));
$postedP4Model = trim((string) ($_POST['ai_model'] ?? $_POST['ai_review_model'] ?? ''));
if (strtolower($postedP4Provider) === 'grok') {
    $postedP4Provider = 'xai';
}
$selectedP4Provider = trim((string) ($postedP4Provider !== '' ? $postedP4Provider : ($previewProviderSelection['provider'] ?? ($resultP4Provider !== '' ? $resultP4Provider : ($p4DefaultProvider['provider'] ?? 'ollama')))));
$selectedP4Model = trim((string) ($postedP4Model !== '' ? $postedP4Model : ($previewProviderSelection['model'] ?? ($resultP4Model !== '' ? $resultP4Model : ($p4DefaultProvider['model'] ?? '')))));
$entities = is_array($exportOptions['entities'] ?? null) ? $exportOptions['entities'] : [];
$groups = is_array($exportOptions['groups'] ?? null) ? $exportOptions['groups'] : [];
$categories = is_array($exportOptions['categories'] ?? null) ? $exportOptions['categories'] : [];
$statuses = is_array($exportOptions['statuses'] ?? null) ? $exportOptions['statuses'] : [];
$summary = is_array($miningResult['summary'] ?? null) ? $miningResult['summary'] : [];
$patterns = is_array($miningResult['patterns'] ?? null) ? $miningResult['patterns'] : [];
$insights = is_array($miningResult['insights'] ?? null) ? $miningResult['insights'] : [];
$evidence = is_array($miningResult['evidence'] ?? null) ? $miningResult['evidence'] : [];
$previewRows = is_array($miningResult['preview_rows'] ?? null) ? $miningResult['preview_rows'] : [];
$rejectionReasons = is_array($miningResult['rejection_reasons'] ?? null) ? $miningResult['rejection_reasons'] : [];
$rejectionExamples = is_array($miningResult['rejection_examples'] ?? null) ? $miningResult['rejection_examples'] : [];
$nextAction = trim((string) ($miningResult['next_action'] ?? ''));
$csrf = GlpiPlugin\Integaglpi\Plugin::getCsrfToken();
$runId = trim((string) ($summary['run_id'] ?? $candidateResult['run_id'] ?? $data['selected_run_id'] ?? ''));
$retentionHours = max(1, (int) ceil(((int) ($data['jsonl_retention_seconds'] ?? 86400)) / 3600));
$exportFilters = is_array($exportPreview['filters'] ?? null) ? $exportPreview['filters'] : [];
$exportDateStart = (string) ($exportFilters['date_start'] ?? '');
$exportDateEnd = (string) ($exportFilters['date_end'] ?? '');
$selectedEntityId = (int) ($exportFilters['entities_id'] ?? 0);
$selectedGroupId = (int) ($exportFilters['groups_id'] ?? 0);
$selectedCategoryId = (int) ($exportFilters['itilcategories_id'] ?? 0);
$selectedStatus = (string) ($exportFilters['status'] ?? '');
$selectedLimit = (int) ($exportFilters['limit'] ?? 100);
$selectedClosedOnly = $exportFilters === [] ? true : (bool) ($exportFilters['closed_only'] ?? false);
$selectedIncludeFollowups = (bool) ($exportFilters['include_followups'] ?? false);
$selectedIncludeSolution = $exportFilters === [] ? true : (bool) ($exportFilters['include_solution'] ?? false);
$rowsProcessed = (int) ($summary['rows_processed'] ?? 0);
$dryRunReady = $upload !== null
    && !empty($upload['dry_run_ready'])
    && trim((string) ($upload['dry_run_token'] ?? '')) !== ''
    && $rowsProcessed > 0;
$aiReviewEnabled = (bool) ($data['p4_ai_review_enabled'] ?? $aiReviewPreview['enabled'] ?? false);
$aiReviewFeatureFlag = (string) ($data['p4_ai_review_feature_flag'] ?? 'AI_KB_CANDIDATE_REVIEW_ENABLED');
$selectedP4CandidateCount = null;
$selectedP4EligibleCount = null;
foreach ($recentP4CandidateRuns as $recentRun) {
    if (!is_array($recentRun)) {
        continue;
    }
    if ($runId !== '' && (string) ($recentRun['run_id'] ?? '') === $runId) {
        $selectedP4CandidateCount = (int) ($recentRun['candidate_count'] ?? 0);
        $selectedP4EligibleCount = (int) ($recentRun['eligible_count'] ?? 0);
        break;
    }
}
$p4KnownSelectedWithoutEligibleCandidates = $selectedP4CandidateCount !== null && $selectedP4EligibleCount !== null && $selectedP4EligibleCount <= 0;
?>

<div class="container-fluid plugin-integaglpi-historical-mining">
    <div class="d-flex flex-wrap justify-content-between align-items-start gap-2 mb-3">
        <div>
            <h1 class="h3 mb-1"><?= $this->escape(__('Mineração Histórica', 'glpiintegaglpi')); ?></h1>
            <p class="text-muted mb-0">
                <?= $this->escape(__('P1 exporta JSONL sanitizado, P2 minera sem IA, P3 gera candidatos determinísticos e P4 revisa candidatos com IA somente quando habilitado.', 'glpiintegaglpi')); ?>
            </p>
        </div>
        <span class="badge bg-secondary"><?= $this->escape(__('offline / read-only GLPI', 'glpiintegaglpi')); ?></span>
    </div>

    <div class="alert alert-warning">
        <?= $this->escape(__('Não envie histórico bruto, anexos, mídia, tokens, senhas, telefones, e-mails ou CPF/CNPJ. A KB nativa não é publicada automaticamente.', 'glpiintegaglpi')); ?>
        <?= $this->escape(sprintf(__('JSONL gerado fica em área temporária controlada por até %d horas.', 'glpiintegaglpi'), $retentionHours)); ?>
    </div>

    <?php if (!$configured) { ?>
        <div class="alert alert-danger">
            <?= $this->escape(__('Configure o PostgreSQL externo antes de executar mineração histórica.', 'glpiintegaglpi')); ?>
        </div>
    <?php } ?>

    <?php if ($flash !== null) { ?>
        <div class="alert alert-<?= $this->escape((string) ($flash['type'] ?? 'info')); ?>">
            <?= $this->escape((string) ($flash['message'] ?? '')); ?>
        </div>
    <?php } ?>

    <div class="row g-3">
        <div class="col-lg-5">
            <form method="post" action="<?= $this->escape($this->getHistoricalMiningUrl()); ?>" class="card mb-3">
                <div class="card-header"><?= $this->escape(__('Gerar JSONL a partir do GLPI', 'glpiintegaglpi')); ?></div>
                <div class="card-body">
                    <input type="hidden" name="_glpi_csrf_token" value="<?= $this->escape($csrf); ?>">
                    <div class="row g-2">
                        <div class="col-md-6">
                            <label class="form-label" for="export_date_start"><?= $this->escape(__('Período início', 'glpiintegaglpi')); ?></label>
                            <input class="form-control" type="date" id="export_date_start" name="export_date_start" value="<?= $this->escape($exportDateStart); ?>">
                        </div>
                        <div class="col-md-6">
                            <label class="form-label" for="export_date_end"><?= $this->escape(__('Período fim', 'glpiintegaglpi')); ?></label>
                            <input class="form-control" type="date" id="export_date_end" name="export_date_end" value="<?= $this->escape($exportDateEnd); ?>">
                        </div>
                        <div class="col-md-6">
                            <label class="form-label" for="entities_id"><?= $this->escape(__('Entidade', 'glpiintegaglpi')); ?></label>
                            <select class="form-select" id="entities_id" name="entities_id">
                                <option value="0"><?= $this->escape(__('Entidades permitidas', 'glpiintegaglpi')); ?></option>
                                <?php foreach ($entities as $entity) {
                                    if (!is_array($entity)) { continue; }
                                    ?>
                                    <?php $entityId = (int) ($entity['id'] ?? 0); ?>
                                    <option value="<?= $entityId; ?>"<?= $entityId === $selectedEntityId ? ' selected' : ''; ?>><?= $this->escape((string) ($entity['name'] ?? '')); ?></option>
                                <?php } ?>
                            </select>
                        </div>
                        <div class="col-md-6">
                            <label class="form-label" for="groups_id"><?= $this->escape(__('Fila/grupo', 'glpiintegaglpi')); ?></label>
                            <select class="form-select" id="groups_id" name="groups_id">
                                <option value="0"><?= $this->escape(__('Todos', 'glpiintegaglpi')); ?></option>
                                <?php foreach ($groups as $group) {
                                    if (!is_array($group)) { continue; }
                                    ?>
                                    <?php $groupId = (int) ($group['id'] ?? 0); ?>
                                    <option value="<?= $groupId; ?>"<?= $groupId === $selectedGroupId ? ' selected' : ''; ?>><?= $this->escape((string) ($group['name'] ?? '')); ?></option>
                                <?php } ?>
                            </select>
                        </div>
                        <div class="col-md-6">
                            <label class="form-label" for="itilcategories_id"><?= $this->escape(__('Categoria', 'glpiintegaglpi')); ?></label>
                            <select class="form-select" id="itilcategories_id" name="itilcategories_id">
                                <option value="0"><?= $this->escape(__('Todas', 'glpiintegaglpi')); ?></option>
                                <?php foreach ($categories as $category) {
                                    if (!is_array($category)) { continue; }
                                    ?>
                                    <?php $categoryId = (int) ($category['id'] ?? 0); ?>
                                    <option value="<?= $categoryId; ?>"<?= $categoryId === $selectedCategoryId ? ' selected' : ''; ?>><?= $this->escape((string) ($category['name'] ?? '')); ?></option>
                                <?php } ?>
                            </select>
                        </div>
                        <div class="col-md-6">
                            <label class="form-label" for="ticket_status"><?= $this->escape(__('Status', 'glpiintegaglpi')); ?></label>
                            <select class="form-select" id="ticket_status" name="ticket_status">
                                <option value=""><?= $this->escape(__('Todos permitidos', 'glpiintegaglpi')); ?></option>
                                <?php foreach ($statuses as $status) {
                                    if (!is_array($status)) { continue; }
                                    ?>
                                    <?php $statusId = (string) ((int) ($status['id'] ?? 0)); ?>
                                    <option value="<?= $this->escape($statusId); ?>"<?= $statusId === $selectedStatus ? ' selected' : ''; ?>><?= $this->escape((string) ($status['name'] ?? '')); ?></option>
                                <?php } ?>
                            </select>
                        </div>
                        <div class="col-md-6">
                            <label class="form-label" for="export_limit"><?= $this->escape(__('Limite de chamados', 'glpiintegaglpi')); ?></label>
                            <input class="form-control" type="number" id="export_limit" name="export_limit" min="1" max="1000" value="<?= max(1, min(1000, $selectedLimit)); ?>">
                        </div>
                    </div>
                    <div class="form-check mt-3">
                        <input class="form-check-input" type="checkbox" id="closed_only" name="closed_only" value="1"<?= $selectedClosedOnly ? ' checked' : ''; ?>>
                        <label class="form-check-label" for="closed_only"><?= $this->escape(__('Somente solucionados/fechados', 'glpiintegaglpi')); ?></label>
                    </div>
                    <div class="form-check">
                        <input class="form-check-input" type="checkbox" id="include_followups" name="include_followups" value="1"<?= $selectedIncludeFollowups ? ' checked' : ''; ?>>
                        <label class="form-check-label" for="include_followups"><?= $this->escape(__('Incluir followups sanitizados', 'glpiintegaglpi')); ?></label>
                    </div>
                    <div class="form-check">
                        <input class="form-check-input" type="checkbox" id="include_solution" name="include_solution" value="1"<?= $selectedIncludeSolution ? ' checked' : ''; ?>>
                        <label class="form-check-label" for="include_solution"><?= $this->escape(__('Incluir solução sanitizada', 'glpiintegaglpi')); ?></label>
                    </div>
                    <div class="d-flex flex-wrap gap-2 mt-3">
                        <button class="btn btn-outline-primary" type="submit" name="action" value="preview_glpi_export">
                            <?= $this->escape(__('Pré-visualizar exportação', 'glpiintegaglpi')); ?>
                        </button>
                        <?php if ($exportPreview !== null && (int) ($exportPreview['total_exportable'] ?? 0) > 0) { ?>
                            <input type="hidden" name="export_preview_token" value="<?= $this->escape((string) ($exportPreview['preview_token'] ?? '')); ?>">
                            <?php $filters = is_array($exportPreview['filters'] ?? null) ? $exportPreview['filters'] : []; ?>
                            <?php foreach ($filters as $filterKey => $filterValue) { ?>
                                <input type="hidden" name="<?= $this->escape((string) $filterKey); ?>" value="<?= $this->escape(is_bool($filterValue) ? ($filterValue ? '1' : '0') : (string) $filterValue); ?>">
                            <?php } ?>
                            <button class="btn btn-success" type="submit" name="action" value="generate_glpi_jsonl">
                                <?= $this->escape(__('Gerar arquivo JSONL sanitizado', 'glpiintegaglpi')); ?>
                            </button>
                        <?php } ?>
                    </div>
                    <small class="text-muted d-block mt-2">
                        <?= $this->escape(__('Leitura read-only do GLPI. Anexos, mídia, PII e segredos são removidos ou bloqueados.', 'glpiintegaglpi')); ?>
                    </small>
                </div>
            </form>

            <?php if ($exportUpload !== null) { ?>
                <?php
                $fileId = (string) ($exportUpload['file_id'] ?? $exportUpload['upload_id'] ?? '');
                $expiresAt = (int) ($exportUpload['expires_at'] ?? 0);
                $expiresLabel = $expiresAt > 0 ? date('Y-m-d H:i:s', $expiresAt) : __('não informado', 'glpiintegaglpi');
                ?>
                <div class="card mb-3">
                    <div class="card-header"><?= $this->escape(__('Arquivo JSONL gerado', 'glpiintegaglpi')); ?></div>
                    <div class="card-body">
                        <p class="text-muted">
                            <?= $this->escape(__('Arquivo salvo em área temporária protegida; não fica público.', 'glpiintegaglpi')); ?>
                        </p>
                        <dl class="row small mb-3">
                            <dt class="col-sm-4"><?= $this->escape(__('Status', 'glpiintegaglpi')); ?></dt>
                            <dd class="col-sm-8"><?= $this->escape(__('Pronto para download manual e dry-run P2', 'glpiintegaglpi')); ?></dd>
                            <dt class="col-sm-4"><?= $this->escape(__('file_id', 'glpiintegaglpi')); ?></dt>
                            <dd class="col-sm-8"><code><?= $this->escape($fileId); ?></code></dd>
                            <dt class="col-sm-4"><?= $this->escape(__('Nome lógico', 'glpiintegaglpi')); ?></dt>
                            <dd class="col-sm-8"><?= $this->escape((string) ($exportUpload['filename'] ?? 'glpi-history.jsonl')); ?></dd>
                            <dt class="col-sm-4"><?= $this->escape(__('Linhas exportadas', 'glpiintegaglpi')); ?></dt>
                            <dd class="col-sm-8"><?= (int) ($exportUpload['line_count'] ?? 0); ?></dd>
                            <dt class="col-sm-4"><?= $this->escape(__('sha256', 'glpiintegaglpi')); ?></dt>
                            <dd class="col-sm-8"><code><?= $this->escape((string) ($exportUpload['content_hash'] ?? '')); ?></code></dd>
                            <dt class="col-sm-4"><?= $this->escape(__('expires_at', 'glpiintegaglpi')); ?></dt>
                            <dd class="col-sm-8"><?= $this->escape((string) $expiresLabel); ?></dd>
                        </dl>
                        <div class="d-flex flex-wrap gap-2">
                            <form method="post" action="<?= $this->escape($this->getHistoricalMiningUrl()); ?>">
                                <input type="hidden" name="_glpi_csrf_token" value="<?= $this->escape($csrf); ?>">
                                <input type="hidden" name="action" value="download_generated">
                                <input type="hidden" name="upload_id" value="<?= $this->escape((string) ($exportUpload['upload_id'] ?? '')); ?>">
                                <button class="btn btn-outline-secondary" type="submit">
                                    <?= $this->escape(__('Baixar JSONL sanitizado', 'glpiintegaglpi')); ?>
                                </button>
                            </form>
                            <form method="post" action="<?= $this->escape($this->getHistoricalMiningUrl()); ?>">
                                <input type="hidden" name="_glpi_csrf_token" value="<?= $this->escape($csrf); ?>">
                                <input type="hidden" name="action" value="validate_generated">
                                <input type="hidden" name="upload_id" value="<?= $this->escape((string) ($exportUpload['upload_id'] ?? '')); ?>">
                                <input type="hidden" name="max_rows" value="1000">
                                <button class="btn btn-outline-primary" type="submit">
                                    <?= $this->escape(__('Executar dry-run P2 com este arquivo', 'glpiintegaglpi')); ?>
                                </button>
                            </form>
                        </div>
                    </div>
                </div>
            <?php } ?>

            <form method="post" enctype="multipart/form-data" action="<?= $this->escape($this->getHistoricalMiningUrl()); ?>" class="card mb-3">
                <div class="card-header"><?= $this->escape(__('Upload JSONL e dry-run', 'glpiintegaglpi')); ?></div>
                <div class="card-body">
                    <input type="hidden" name="_glpi_csrf_token" value="<?= $this->escape($csrf); ?>">
                    <input type="hidden" name="action" value="validate_upload">
                    <div class="mb-3">
                        <label class="form-label" for="history_jsonl"><?= $this->escape(__('Arquivo JSONL sanitizado', 'glpiintegaglpi')); ?></label>
                        <input class="form-control" type="file" id="history_jsonl" name="history_jsonl" accept=".jsonl" required>
                        <small class="text-muted"><?= $this->escape(__('Limite UI: 5 MB e 5.000 linhas processadas por execução.', 'glpiintegaglpi')); ?></small>
                    </div>
                    <div class="row g-2">
                        <div class="col-md-6">
                            <label class="form-label" for="window_start"><?= $this->escape(__('Janela início', 'glpiintegaglpi')); ?></label>
                            <input class="form-control" type="date" id="window_start" name="window_start">
                        </div>
                        <div class="col-md-6">
                            <label class="form-label" for="window_end"><?= $this->escape(__('Janela fim', 'glpiintegaglpi')); ?></label>
                            <input class="form-control" type="date" id="window_end" name="window_end">
                        </div>
                        <div class="col-md-6">
                            <label class="form-label" for="max_rows"><?= $this->escape(__('Máximo de linhas', 'glpiintegaglpi')); ?></label>
                            <input class="form-control" type="number" id="max_rows" name="max_rows" min="1" max="5000" value="1000">
                        </div>
                    </div>
                    <button class="btn btn-outline-primary mt-3" type="submit">
                        <?= $this->escape(__('Dry-run mineração', 'glpiintegaglpi')); ?>
                    </button>
                </div>
            </form>

            <form method="post" action="<?= $this->escape($this->getHistoricalMiningUrl()); ?>" class="card mb-3">
                <div class="card-header"><?= $this->escape(__('2. Execução real P2', 'glpiintegaglpi')); ?></div>
                <div class="card-body">
                    <input type="hidden" name="_glpi_csrf_token" value="<?= $this->escape($csrf); ?>">
                    <input type="hidden" name="action" value="execute_mining">
                    <input type="hidden" name="upload_id" value="<?= $this->escape((string) ($upload['upload_id'] ?? '')); ?>">
                    <input type="hidden" name="dry_run_token" value="<?= $this->escape((string) ($upload['dry_run_token'] ?? '')); ?>">
                    <input type="hidden" name="window_start" value="<?= $this->escape((string) ($upload['window_start'] ?? '')); ?>">
                    <input type="hidden" name="window_end" value="<?= $this->escape((string) ($upload['window_end'] ?? '')); ?>">
                    <input type="hidden" name="max_rows" value="<?= (int) ($upload['max_rows'] ?? 1000); ?>">
                    <p class="text-muted">
                        <?= $this->escape(__('Disponível somente após dry-run OK do mesmo upload. O Node reprocessa o conteúdo e valida o token antes de persistir.', 'glpiintegaglpi')); ?>
                    </p>
                    <?php if ($upload !== null && !$dryRunReady) { ?>
                        <div class="alert alert-warning">
                            <?= $this->escape(__('Execução real bloqueada: o dry-run não encontrou linhas processáveis ou o token do arquivo não está válido.', 'glpiintegaglpi')); ?>
                        </div>
                    <?php } ?>
                    <button class="btn btn-primary" type="submit" <?= !$dryRunReady ? 'disabled' : ''; ?>>
                        <?= $this->escape(__('Executar mineração', 'glpiintegaglpi')); ?>
                    </button>
                </div>
            </form>

            <form method="post" action="<?= $this->escape($this->getHistoricalMiningUrl()); ?>" class="card mb-3">
                <div class="card-header"><?= $this->escape(__('3. Gerar candidatos P3', 'glpiintegaglpi')); ?></div>
                <div class="card-body">
                    <input type="hidden" name="_glpi_csrf_token" value="<?= $this->escape($csrf); ?>">
                    <input type="hidden" name="action" value="generate_candidates">
                    <label class="form-label" for="run_id"><?= $this->escape(__('run_id', 'glpiintegaglpi')); ?></label>
                    <input class="form-control" type="text" id="run_id" name="run_id" value="<?= $this->escape($runId); ?>" required>
                    <div class="row g-2 mt-1">
                        <div class="col-md-6">
                            <label class="form-label" for="max_candidates"><?= $this->escape(__('Máx. candidatos', 'glpiintegaglpi')); ?></label>
                            <input class="form-control" type="number" id="max_candidates" name="max_candidates" min="1" max="50" value="20">
                        </div>
                        <div class="col-md-6">
                            <label class="form-label" for="min_confidence"><?= $this->escape(__('Confiança mínima', 'glpiintegaglpi')); ?></label>
                            <input class="form-control" type="number" id="min_confidence" name="min_confidence" min="1" max="100" value="65">
                        </div>
                    </div>
                    <div class="d-flex flex-wrap gap-2 mt-3">
                        <button class="btn btn-outline-success" type="submit">
                            <?= $this->escape(__('Gerar candidatos de KB', 'glpiintegaglpi')); ?>
                        </button>
                        <a class="btn btn-outline-secondary" href="<?= $this->escape($this->getKbCandidatesUrl()); ?>">
                            <?= $this->escape(__('Abrir candidatos de KB', 'glpiintegaglpi')); ?>
                        </a>
                    </div>
                    <small class="text-muted d-block mt-2">
                        <?= $this->escape(__('Candidatos ficam para revisão humana. Nenhuma publicação automática ocorre.', 'glpiintegaglpi')); ?>
                    </small>
                </div>
            </form>

            <form method="post" action="<?= $this->escape($this->getHistoricalMiningUrl()); ?>" class="card">
                <div class="card-header"><?= $this->escape(__('4. Revisão IA opcional P4', 'glpiintegaglpi')); ?></div>
                <div class="card-body">
                    <input type="hidden" name="_glpi_csrf_token" value="<?= $this->escape($csrf); ?>">
                    <input type="hidden" name="p4_preview_payload_hash" value="<?= $this->escape((string) ($aiReviewPreview['payload_hash'] ?? '')); ?>">
                    <label class="form-label" for="ai_review_run_id"><?= $this->escape(__('run_id com candidatos P3', 'glpiintegaglpi')); ?></label>
                    <input class="form-control" type="text" id="ai_review_run_id" name="run_id" value="<?= $this->escape($runId); ?>" list="ai_review_run_id_options" placeholder="<?= $this->escape(__('Cole o run_id ou escolha um candidato recente abaixo', 'glpiintegaglpi')); ?>">
                    <datalist id="ai_review_run_id_options">
                        <?php foreach ($recentP4CandidateRuns as $recentRun) {
                            if (!is_array($recentRun)) { continue; }
                            $recentRunId = (string) ($recentRun['run_id'] ?? '');
                            if ($recentRunId === '') { continue; }
                            ?>
                            <option value="<?= $this->escape($recentRunId); ?>">
                                <?= $this->escape(sprintf(
                                    '%d elegíveis / %d candidatos · %s',
                                    (int) ($recentRun['eligible_count'] ?? 0),
                                    (int) ($recentRun['candidate_count'] ?? 0),
                                    (string) ($recentRun['status_list'] ?? '')
                                )); ?>
                            </option>
                        <?php } ?>
                    </datalist>
                    <div class="row g-2 mt-1">
                        <div class="col-md-6">
                            <label class="form-label" for="ai_review_max_candidates"><?= $this->escape(__('Máx. candidatos para preview', 'glpiintegaglpi')); ?></label>
                            <input class="form-control" type="number" id="ai_review_max_candidates" name="max_candidates" min="1" max="10" value="5">
                        </div>
                    </div>
                    <?php if ($recentP4CandidateRuns !== []) { ?>
                        <div class="border rounded p-2 mt-3">
                            <div class="small text-muted mb-2">
                                <?= $this->escape(__('Últimos run_id/input_hash com candidatos P3 persistidos', 'glpiintegaglpi')); ?>
                            </div>
                            <?php foreach ($recentP4CandidateRuns as $recentRun) {
                                if (!is_array($recentRun)) { continue; }
                                $recentRunId = (string) ($recentRun['run_id'] ?? '');
                                if ($recentRunId === '') { continue; }
                                $candidateCount = (int) ($recentRun['candidate_count'] ?? 0);
                                $eligibleCount = (int) ($recentRun['eligible_count'] ?? 0);
                                ?>
                                <div class="d-flex flex-wrap align-items-center justify-content-between gap-2 border-top py-2">
                                    <div>
                                        <code><?= $this->escape($recentRunId); ?></code>
                                        <div class="text-muted small">
                                            <?= $this->escape(sprintf(
                                                __('%d candidatos · %d elegíveis · status: %s', 'glpiintegaglpi'),
                                                $candidateCount,
                                                $eligibleCount,
                                                (string) ($recentRun['status_list'] ?? '')
                                            )); ?>
                                        </div>
                                    </div>
                                    <?php if ($eligibleCount > 0) { ?>
                                        <a class="btn btn-sm btn-outline-secondary" href="<?= $this->escape($this->getHistoricalMiningUrl() . '?run_id=' . rawurlencode($recentRunId) . '#ai_review_run_id'); ?>">
                                            <?= $this->escape(__('Usar este run_id', 'glpiintegaglpi')); ?>
                                        </a>
                                    <?php } else { ?>
                                        <span class="badge bg-warning text-dark"><?= $this->escape(__('sem candidato elegível para P4', 'glpiintegaglpi')); ?></span>
                                    <?php } ?>
                                </div>
                            <?php } ?>
                        </div>
                    <?php } else { ?>
                        <div class="alert alert-warning mt-3 mb-0">
                            <?= $this->escape(__('Nenhum candidato P3 encontrado ainda. Gere candidatos P3 antes de executar P4.', 'glpiintegaglpi')); ?>
                        </div>
                    <?php } ?>
                    <div class="alert alert-info mt-3 mb-3">
                        <?= $this->escape(__('P4 usa apenas candidatos P3 sanitizados e persistidos. Nunca envia histórico bruto, anexos, PII ou publica KB automaticamente.', 'glpiintegaglpi')); ?>
                        <?php if ($eligibleP4Statuses !== []) { ?>
                            <br>
                            <?= $this->escape(__('Status elegíveis para P4:', 'glpiintegaglpi')); ?>
                            <code><?= $this->escape(implode(', ', array_map('strval', $eligibleP4Statuses))); ?></code>
                        <?php } ?>
                    </div>
                    <?php if ($p4KnownSelectedWithoutEligibleCandidates) { ?>
                        <div class="alert alert-warning">
                            <?= $this->escape(__('Este run_id possui candidatos P3, mas nenhum está em status elegível para P4.', 'glpiintegaglpi')); ?>
                        </div>
                    <?php } ?>
                    <div class="row g-2 mt-3 mb-3">
                        <div class="col-md-6">
                            <label class="form-label" for="ai_review_provider"><?= $this->escape(__('Provider IA P4', 'glpiintegaglpi')); ?></label>
                            <select class="form-select" id="ai_review_provider" name="ai_provider">
                                <?php $localReady = !empty($localProvider['ready']); ?>
                                <option value="ollama" data-source="local" <?= $selectedP4Provider === 'ollama' ? 'selected' : ''; ?> <?= $localReady ? '' : 'disabled'; ?>>
                                    <?= $this->escape(__('Ollama local', 'glpiintegaglpi')); ?>
                                    <?= $localReady ? '' : ' - ' . $this->escape((string) ($localProvider['blocked_reason'] ?? 'local_model_not_configured')); ?>
                                </option>
                                <?php foreach ($readyCloudProviders as $provider) {
                                    if (!is_array($provider)) { continue; }
                                    $providerId = (string) ($provider['id'] ?? '');
                                    if ($providerId === '') { continue; }
                                    ?>
                                    <option value="<?= $this->escape($providerId); ?>" data-source="cloud" <?= $selectedP4Provider === $providerId ? 'selected' : ''; ?>>
                                        <?= $this->escape((string) ($provider['name'] ?? $providerId)); ?>
                                    </option>
                                <?php } ?>
                                <?php foreach ($blockedCloudProviders as $provider) {
                                    if (!is_array($provider)) { continue; }
                                    $providerId = (string) ($provider['id'] ?? '');
                                    if ($providerId === '') { continue; }
                                    ?>
                                    <option value="<?= $this->escape($providerId); ?>" data-source="cloud" disabled>
                                        <?= $this->escape((string) ($provider['name'] ?? $providerId) . ' - bloqueado: ' . (string) ($provider['blocked_reason'] ?? 'provider_not_ready')); ?>
                                    </option>
                                <?php } ?>
                            </select>
                            <input type="hidden" id="ai_review_provider_alias" name="ai_review_provider" value="<?= $this->escape($selectedP4Provider); ?>">
                        </div>
                        <div class="col-md-6">
                            <label class="form-label" for="ai_review_model"><?= $this->escape(__('Modelo IA P4', 'glpiintegaglpi')); ?></label>
                            <select class="form-select" id="ai_review_model" name="ai_model">
                                <?php $localModels = is_array($localProvider['models'] ?? null) ? array_map('strval', $localProvider['models']) : []; ?>
                                <?php if ($localModels !== []) { ?>
                                    <optgroup label="<?= $this->escape(__('Ollama local', 'glpiintegaglpi')); ?>">
                                        <?php foreach ($localModels as $modelOption) { ?>
                                            <option value="<?= $this->escape($modelOption); ?>" data-provider="ollama" <?= $selectedP4Model === $modelOption ? 'selected' : ''; ?>><?= $this->escape($modelOption); ?></option>
                                        <?php } ?>
                                    </optgroup>
                                <?php } elseif ($selectedP4Model !== '') { ?>
                                    <option value="<?= $this->escape($selectedP4Model); ?>" data-provider="<?= $this->escape($selectedP4Provider); ?>" selected><?= $this->escape($selectedP4Model); ?></option>
                                <?php } ?>
                                <?php foreach (array_merge($readyCloudProviders, $blockedCloudProviders) as $provider) {
                                    if (!is_array($provider)) { continue; }
                                    $providerId = (string) ($provider['id'] ?? '');
                                    $models = is_array($provider['models'] ?? null) ? array_map('strval', $provider['models']) : [];
                                    if ($models === []) { continue; }
                                    ?>
                                    <optgroup label="<?= $this->escape((string) ($provider['name'] ?? $provider['id'] ?? 'cloud')); ?>">
                                        <?php foreach ($models as $modelOption) { ?>
                                            <option value="<?= $this->escape($modelOption); ?>" data-provider="<?= $this->escape($providerId); ?>" <?= $selectedP4Model === $modelOption ? 'selected' : ''; ?>><?= $this->escape($modelOption); ?></option>
                                        <?php } ?>
                                    </optgroup>
                                <?php } ?>
                                <?php if ($selectedP4Model === '') { ?>
                                    <option value="" selected><?= $this->escape(__('sem modelo selecionado', 'glpiintegaglpi')); ?></option>
                                <?php } ?>
                            </select>
                            <input type="hidden" id="ai_review_model_alias" name="ai_review_model" value="<?= $this->escape($selectedP4Model); ?>">
                            <div class="form-text">
                                <?= $this->escape(__('Default local-first. Cloud só executa se provider estiver pronto, payload P4 sanitizado e last_test_status=success.', 'glpiintegaglpi')); ?>
                            </div>
                        </div>
                    </div>
                    <?php if ($selectedP4Provider !== '' && $selectedP4Provider !== 'ollama') { ?>
                        <div class="small text-info mt-2">
                            <?= $this->escape(sprintf(
                                __('Provider selecionado para P4: %s / %s / cloud', 'glpiintegaglpi'),
                                $selectedP4Provider,
                                $selectedP4Model !== '' ? $selectedP4Model : __('sem modelo', 'glpiintegaglpi')
                            )); ?>
                        </div>
                    <?php } ?>
                    <div class="d-flex flex-wrap gap-2 mt-2">
                        <button class="btn btn-outline-primary" type="submit" name="action" value="preview_ai_candidate_review" <?= $p4KnownSelectedWithoutEligibleCandidates ? 'disabled' : ''; ?>>
                            <?= $this->escape(__('Pré-visualizar payload P4', 'glpiintegaglpi')); ?>
                        </button>
                        <button class="btn btn-outline-secondary" type="submit" name="action" value="execute_ai_candidate_review" <?= (!$aiReviewEnabled || $p4KnownSelectedWithoutEligibleCandidates) ? 'disabled' : ''; ?>>
                            <?= $this->escape(__('Executar revisão IA', 'glpiintegaglpi')); ?>
                        </button>
                    </div>
                    <?php if (!$aiReviewEnabled) { ?>
                        <small class="text-muted d-block mt-2">
                            <?= $this->escape(__('Revisão IA de candidatos está desabilitada. Você ainda pode revisar manualmente.', 'glpiintegaglpi')); ?>
                        </small>
                    <?php } ?>
                </div>
            </form>
        </div>

        <div class="col-lg-7">
            <?php if ($exportPreview !== null) { ?>
                <div class="card mb-3">
                    <div class="card-header"><?= $this->escape(__('Preview da exportação GLPI', 'glpiintegaglpi')); ?></div>
                    <div class="card-body">
                        <div class="row g-2 mb-3">
                            <?php foreach ([
                                'total_found' => __('Total encontrado', 'glpiintegaglpi'),
                                'total_exportable' => __('Total exportável', 'glpiintegaglpi'),
                                'rows_rejected' => __('Linhas rejeitadas', 'glpiintegaglpi'),
                                'residual_sensitive_rows' => __('Bloqueios por dado sensível residual', 'glpiintegaglpi'),
                            ] as $key => $label) { ?>
                                <div class="col-md-3">
                                    <div class="border rounded p-2 h-100">
                                        <div class="text-muted small"><?= $this->escape((string) $label); ?></div>
                                        <strong><?= (int) ($exportPreview[$key] ?? 0); ?></strong>
                                    </div>
                                </div>
                            <?php } ?>
                        </div>

                        <?php $fieldsSanitized = is_array($exportPreview['fields_sanitized'] ?? null) ? $exportPreview['fields_sanitized'] : []; ?>
                        <?php $fieldsRemoved = is_array($exportPreview['fields_removed'] ?? null) ? $exportPreview['fields_removed'] : []; ?>
                        <div class="mb-3">
                            <div class="text-muted small"><?= $this->escape(__('Campos removidos/sanitizados', 'glpiintegaglpi')); ?></div>
                            <code><?= $this->escape(implode(', ', array_merge($fieldsRemoved, $fieldsSanitized))); ?></code>
                        </div>

                        <?php $sampleJsonl = is_array($exportPreview['sample_jsonl'] ?? null) ? $exportPreview['sample_jsonl'] : []; ?>
                        <?php if ($sampleJsonl === []) { ?>
                            <p class="text-muted mb-0"><?= $this->escape(__('Nenhuma amostra exportável para esses filtros.', 'glpiintegaglpi')); ?></p>
                        <?php } else { ?>
                            <div class="small text-muted mb-2"><?= $this->escape(__('Amostra JSONL sanitizada', 'glpiintegaglpi')); ?></div>
                            <?php foreach ($sampleJsonl as $line) { ?>
                                <pre class="bg-light border rounded p-2 small text-break"><?= $this->escape((string) $line); ?></pre>
                            <?php } ?>
                        <?php } ?>
                    </div>
                </div>
            <?php } ?>

            <div class="card mb-3">
                <div class="card-header"><?= $this->escape(__('Resumo da mineração', 'glpiintegaglpi')); ?></div>
                <div class="card-body">
                    <?php if ($summary === []) { ?>
                        <p class="text-muted mb-0"><?= $this->escape(__('Nenhum dry-run executado nesta sessão.', 'glpiintegaglpi')); ?></p>
                    <?php } else { ?>
                        <div class="row g-2">
                            <?php foreach ($summary as $key => $value) { ?>
                                <div class="col-md-4">
                                    <div class="border rounded p-2 h-100">
                                        <div class="text-muted small"><?= $this->escape((string) $key); ?></div>
                                        <strong><?= $this->escape(is_bool($value) ? ($value ? 'true' : 'false') : (string) $value); ?></strong>
                                    </div>
                                </div>
                            <?php } ?>
                        </div>
                        <?php if ($nextAction !== '') { ?>
                            <div class="alert alert-info mt-3 mb-0">
                                <strong><?= $this->escape(__('Próxima ação', 'glpiintegaglpi')); ?>:</strong>
                                <?= $this->escape($nextAction); ?>
                            </div>
                        <?php } elseif ($rowsProcessed <= 0) { ?>
                            <div class="alert alert-warning mt-3 mb-0">
                                <?= $this->escape(__('Nenhuma linha processável foi encontrada. Revise o JSONL, os filtros e os motivos de rejeição antes de executar P2.', 'glpiintegaglpi')); ?>
                            </div>
                        <?php } ?>
                    <?php } ?>
                </div>
            </div>

            <?php if ($rejectionReasons !== [] || $rejectionExamples !== []) { ?>
                <div class="card mb-3">
                    <div class="card-header"><?= $this->escape(__('Diagnóstico de rejeições do dry-run', 'glpiintegaglpi')); ?></div>
                    <div class="card-body">
                        <?php if ($rejectionReasons !== []) { ?>
                            <div class="row g-2 mb-3">
                                <?php foreach (array_slice($rejectionReasons, 0, 6) as $reason) {
                                    if (!is_array($reason)) { continue; }
                                    ?>
                                    <div class="col-md-4">
                                        <div class="border rounded p-2 h-100">
                                            <div class="text-muted small"><?= $this->escape((string) ($reason['reason'] ?? 'unknown_error')); ?></div>
                                            <strong><?= (int) ($reason['count'] ?? 0); ?></strong>
                                        </div>
                                    </div>
                                <?php } ?>
                            </div>
                        <?php } ?>
                        <?php if ($rejectionExamples !== []) { ?>
                            <div class="small text-muted mb-2"><?= $this->escape(__('Até 5 exemplos anonimizados', 'glpiintegaglpi')); ?></div>
                            <?php foreach (array_slice($rejectionExamples, 0, 5) as $example) {
                                if (!is_array($example)) { continue; }
                                ?>
                                <div class="border rounded p-2 mb-2">
                                    <code><?= $this->escape(__('linha', 'glpiintegaglpi') . ' ' . (string) ($example['line'] ?? '0')); ?></code>
                                    · <?= $this->escape((string) ($example['reason'] ?? 'unknown_error')); ?>
                                    <?php if (!empty($example['field'])) { ?>
                                        · <span class="text-muted"><?= $this->escape((string) ($example['field'] ?? '')); ?></span>
                                    <?php } ?>
                                    <?php if (!empty($example['excerpt'])) { ?>
                                        <div><?= $this->escape((string) ($example['excerpt'] ?? '')); ?></div>
                                    <?php } ?>
                                </div>
                            <?php } ?>
                        <?php } ?>
                    </div>
                </div>
            <?php } ?>

            <?php if ($previewRows !== []) { ?>
                <div class="card mb-3">
                    <div class="card-header"><?= $this->escape(__('Preview sanitizado', 'glpiintegaglpi')); ?></div>
                    <div class="card-body">
                        <?php foreach ($previewRows as $row) {
                            if (!is_array($row)) {
                                continue;
                            }
                            ?>
                            <div class="border rounded p-2 mb-2">
                                <code><?= $this->escape((string) ($row['ticket_id_hash'] ?? '')); ?></code>
                                <div><?= $this->escape((string) ($row['excerpt'] ?? '')); ?></div>
                            </div>
                        <?php } ?>
                    </div>
                </div>
            <?php } ?>

            <div class="row g-3">
                <div class="col-xl-6">
                    <div class="card h-100">
                        <div class="card-header"><?= $this->escape(__('Patterns', 'glpiintegaglpi')); ?></div>
                        <div class="card-body">
                            <?php if ($patterns === []) { ?>
                                <p class="text-muted mb-0"><?= $this->escape(__('Sem patterns nesta execução.', 'glpiintegaglpi')); ?></p>
                            <?php } else { ?>
                                <ul class="mb-0">
                                    <?php foreach ($patterns as $pattern) {
                                        if (!is_array($pattern)) {
                                            continue;
                                        }
                                        ?>
                                        <li>
                                            <strong><?= $this->escape((string) ($pattern['patternType'] ?? $pattern['pattern_type'] ?? '')); ?></strong>
                                            · <?= $this->escape((string) ($pattern['category'] ?? '')); ?>
                                            · <?= $this->escape((string) ($pattern['severity'] ?? '')); ?>
                                            · <?= (int) ($pattern['frequencyAbs'] ?? $pattern['frequency_abs'] ?? 0); ?>
                                        </li>
                                    <?php } ?>
                                </ul>
                            <?php } ?>
                        </div>
                    </div>
                </div>

                <div class="col-xl-6">
                    <div class="card h-100">
                        <div class="card-header"><?= $this->escape(__('Insights', 'glpiintegaglpi')); ?></div>
                        <div class="card-body">
                            <?php if ($insights === []) { ?>
                                <p class="text-muted mb-0"><?= $this->escape(__('Sem insights nesta execução.', 'glpiintegaglpi')); ?></p>
                            <?php } else { ?>
                                <ul class="mb-0">
                                    <?php foreach ($insights as $insight) {
                                        if (!is_array($insight)) {
                                            continue;
                                        }
                                        ?>
                                        <li>
                                            <strong><?= $this->escape((string) ($insight['title'] ?? '')); ?></strong>
                                            <div class="text-muted small">
                                                <?= $this->escape((string) ($insight['insightType'] ?? $insight['insight_type'] ?? '')); ?>
                                                · <?= $this->escape((string) ($insight['priority'] ?? '')); ?>
                                                · <?= $this->escape((string) ($insight['confidenceScore'] ?? $insight['confidence_score'] ?? 0)); ?>%
                                            </div>
                                        </li>
                                    <?php } ?>
                                </ul>
                            <?php } ?>
                        </div>
                    </div>
                </div>
            </div>

            <div class="card mt-3">
                <div class="card-header"><?= $this->escape(__('Evidence anonimizadas', 'glpiintegaglpi')); ?></div>
                <div class="card-body">
                    <?php if ($evidence === []) { ?>
                        <p class="text-muted mb-0"><?= $this->escape(__('Sem evidence nesta execução.', 'glpiintegaglpi')); ?></p>
                    <?php } else { ?>
                        <?php foreach ($evidence as $item) {
                            if (!is_array($item)) {
                                continue;
                            }
                            ?>
                            <div class="border rounded p-2 mb-2">
                                <code><?= $this->escape((string) ($item['ticketIdHash'] ?? $item['ticket_id_hash'] ?? '')); ?></code>
                                <div><?= $this->escape((string) ($item['anonymizedExcerpt'] ?? $item['anonymized_excerpt'] ?? '')); ?></div>
                            </div>
                        <?php } ?>
                    <?php } ?>
                </div>
            </div>

            <?php if ($candidateResult !== null) { ?>
                <div class="card mt-3">
                    <div class="card-header"><?= $this->escape(__('Resultado P3', 'glpiintegaglpi')); ?></div>
                    <div class="card-body">
                        <div class="row g-2 mb-3">
                            <?php foreach ($candidateResult as $key => $value) {
                                if (is_array($value)) {
                                    continue;
                                }
                                ?>
                                <div class="col-md-4">
                                    <div class="border rounded p-2 h-100">
                                        <div class="text-muted small"><?= $this->escape((string) $key); ?></div>
                                        <strong><?= $this->escape(is_bool($value) ? ($value ? 'true' : 'false') : (string) $value); ?></strong>
                                    </div>
                                </div>
                            <?php } ?>
                        </div>
                        <?php $candidates = is_array($candidateResult['candidates'] ?? null) ? $candidateResult['candidates'] : []; ?>
                        <?php foreach ($candidates as $candidate) {
                            if (!is_array($candidate)) {
                                continue;
                            }
                            ?>
                            <div class="border rounded p-2 mb-2">
                                <strong><?= $this->escape((string) ($candidate['title'] ?? '')); ?></strong>
                                <div class="text-muted small">
                                    <?= $this->escape((string) ($candidate['status'] ?? '')); ?>
                                    · <?= $this->escape((string) ($candidate['article_type'] ?? '')); ?>
                                    · <?= $this->escape((string) ($candidate['confidence_score'] ?? 0)); ?>%
                                </div>
                            </div>
                        <?php } ?>
                    </div>
                </div>
            <?php } ?>

            <?php if ($aiReviewPreview !== null) { ?>
                <div class="card mt-3">
                    <div class="card-header"><?= $this->escape(__('Preview P4 - payload sanitizado para revisão IA', 'glpiintegaglpi')); ?></div>
                    <div class="card-body">
                        <div class="alert alert-<?= !empty($aiReviewPreview['enabled']) ? 'info' : 'warning'; ?>">
                            <?= $this->escape((string) ($aiReviewPreview['next_action'] ?? __('Revisão humana permanece obrigatória.', 'glpiintegaglpi'))); ?>
                        </div>
                        <dl class="row small mb-3">
                            <dt class="col-sm-4"><?= $this->escape(__('run_id', 'glpiintegaglpi')); ?></dt>
                            <dd class="col-sm-8"><code><?= $this->escape((string) ($aiReviewPreview['run_id'] ?? '')); ?></code></dd>
                            <dt class="col-sm-4"><?= $this->escape(__('feature flag', 'glpiintegaglpi')); ?></dt>
                            <dd class="col-sm-8"><code><?= $this->escape((string) ($aiReviewPreview['feature_flag'] ?? $aiReviewFeatureFlag)); ?></code></dd>
                            <dt class="col-sm-4"><?= $this->escape(__('payload_hash', 'glpiintegaglpi')); ?></dt>
                            <dd class="col-sm-8"><code><?= $this->escape((string) ($aiReviewPreview['payload_hash'] ?? '')); ?></code></dd>
                            <?php $previewProvider = is_array($aiReviewPreview['provider_selection'] ?? null) ? $aiReviewPreview['provider_selection'] : []; ?>
                            <dt class="col-sm-4"><?= $this->escape(__('provider/modelo', 'glpiintegaglpi')); ?></dt>
                            <dd class="col-sm-8">
                                <code><?= $this->escape((string) ($previewProvider['provider'] ?? 'ollama')); ?></code>
                                /
                                <code><?= $this->escape((string) ($previewProvider['model'] ?? '')); ?></code>
                                <?php if (empty($previewProvider['ready'])) { ?>
                                    <span class="badge bg-warning text-dark"><?= $this->escape((string) ($previewProvider['blocked_reason'] ?? 'provider_not_ready')); ?></span>
                                <?php } ?>
                            </dd>
                        </dl>
                        <?php $aiCandidates = is_array($aiReviewPreview['candidates'] ?? null) ? $aiReviewPreview['candidates'] : []; ?>
                        <?php foreach ($aiCandidates as $candidate) {
                            if (!is_array($candidate)) {
                                continue;
                            }
                            ?>
                            <div class="border rounded p-2 mb-2">
                                <strong><?= $this->escape((string) ($candidate['kb_title_suggested'] ?? '')); ?></strong>
                                <div class="text-muted small">
                                    <?= $this->escape((string) ($candidate['suggested_type'] ?? '')); ?>
                                    · <?= $this->escape((string) ($candidate['status'] ?? '')); ?>
                                    · <?= (int) ($candidate['confidence'] ?? 0); ?>%
                                </div>
                                <div><?= $this->escape((string) ($candidate['kb_problem_summary'] ?? '')); ?></div>
                                <?php $steps = is_array($candidate['kb_resolution_steps'] ?? null) ? $candidate['kb_resolution_steps'] : []; ?>
                                <?php if ($steps !== []) { ?>
                                    <ol class="mb-0 mt-2">
                                        <?php foreach (array_slice($steps, 0, 4) as $step) { ?>
                                            <li><?= $this->escape((string) $step); ?></li>
                                        <?php } ?>
                                    </ol>
                                <?php } ?>
                            </div>
                        <?php } ?>
                        <?php
                        $previewProviderReady = !empty($previewProvider['ready']);
                        $previewRunId = (string) ($aiReviewPreview['run_id'] ?? '');
                        $previewMaxCandidates = (int) ($aiReviewPreview['max_candidates'] ?? 5);
                        $previewProviderId = (string) ($previewProvider['provider'] ?? 'ollama');
                        $previewModel = (string) ($previewProvider['model'] ?? '');
                        ?>
                        <form method="post" action="<?= $this->escape($this->getHistoricalMiningUrl()); ?>" class="border rounded p-2 mt-3">
                            <input type="hidden" name="_glpi_csrf_token" value="<?= $this->escape($csrf); ?>">
                            <input type="hidden" name="action" value="execute_ai_candidate_review">
                            <input type="hidden" name="run_id" value="<?= $this->escape($previewRunId); ?>">
                            <input type="hidden" name="max_candidates" value="<?= $previewMaxCandidates; ?>">
                            <input type="hidden" name="ai_provider" value="<?= $this->escape($previewProviderId); ?>">
                            <input type="hidden" name="ai_model" value="<?= $this->escape($previewModel); ?>">
                            <input type="hidden" name="ai_review_provider" value="<?= $this->escape($previewProviderId); ?>">
                            <input type="hidden" name="ai_review_model" value="<?= $this->escape($previewModel); ?>">
                            <input type="hidden" name="p4_preview_payload_hash" value="<?= $this->escape((string) ($aiReviewPreview['payload_hash'] ?? '')); ?>">
                            <div class="d-flex flex-wrap align-items-center justify-content-between gap-2">
                                <div class="small">
                                    <?= $this->escape(__('Execução confirmará a seleção do preview:', 'glpiintegaglpi')); ?>
                                    <code><?= $this->escape($previewProviderId); ?></code>
                                    /
                                    <code><?= $this->escape($previewModel); ?></code>
                                </div>
                                <button class="btn btn-outline-secondary btn-sm" type="submit" <?= (!$aiReviewEnabled || !$previewProviderReady || $previewRunId === '') ? 'disabled' : ''; ?>>
                                    <?php
                                    $btnProviderLabel = ($previewProviderId !== '' && $previewProviderId !== 'ollama')
                                        ? ' ' . $previewProviderId . ($previewModel !== '' ? ' / ' . $previewModel : '')
                                        : '';
                                    ?>
                                    <?= $this->escape(__('Executar revisão IA com este provider/modelo', 'glpiintegaglpi') . $btnProviderLabel); ?>
                                </button>
                            </div>
                            <?php if (!$previewProviderReady) { ?>
                                <div class="text-warning small mt-2">
                                    <?= $this->escape(__('Provider/modelo do preview não está pronto:', 'glpiintegaglpi')); ?>
                                    <code><?= $this->escape((string) ($previewProvider['blocked_reason'] ?? 'provider_not_ready')); ?></code>
                                </div>
                            <?php } ?>
                        </form>
                    </div>
                </div>
            <?php } ?>

            <?php if ($aiReviewResult !== null) { ?>
                <div class="card mt-3">
                    <div class="card-header"><?= $this->escape(__('Resultado P4', 'glpiintegaglpi')); ?></div>
                    <div class="card-body">
                        <div class="alert alert-warning">
                            <?= $this->escape(__('Nenhuma publicação automática foi executada. Revise candidatos manualmente.', 'glpiintegaglpi')); ?>
                            <code><?= $this->escape((string) ($aiReviewResult['status'] ?? '')); ?></code>
                        </div>
                        <dl class="row small mb-3">
                            <dt class="col-sm-4"><?= $this->escape(__('run_id', 'glpiintegaglpi')); ?></dt>
                            <dd class="col-sm-8"><code><?= $this->escape((string) ($aiReviewResult['run_id'] ?? '')); ?></code></dd>
                            <dt class="col-sm-4"><?= $this->escape(__('provider', 'glpiintegaglpi')); ?></dt>
                            <dd class="col-sm-8"><?= $this->escape((string) ($aiReviewResult['provider'] ?? '')); ?></dd>
                            <dt class="col-sm-4"><?= $this->escape(__('model', 'glpiintegaglpi')); ?></dt>
                            <dd class="col-sm-8"><?= $this->escape((string) ($aiReviewResult['model'] ?? '')); ?></dd>
                            <dt class="col-sm-4"><?= $this->escape(__('source', 'glpiintegaglpi')); ?></dt>
                            <dd class="col-sm-8"><?= $this->escape((string) ($aiReviewResult['source'] ?? '')); ?></dd>
                            <dt class="col-sm-4"><?= $this->escape(__('selection_origin', 'glpiintegaglpi')); ?></dt>
                            <dd class="col-sm-8"><?= $this->escape((string) ($aiReviewResult['selection_origin'] ?? '')); ?></dd>
                            <?php if (!empty($aiReviewResult['error_type'])) { ?>
                                <dt class="col-sm-4"><?= $this->escape(__('error_type', 'glpiintegaglpi')); ?></dt>
                                <dd class="col-sm-8"><code><?= $this->escape((string) ($aiReviewResult['error_type'] ?? '')); ?></code></dd>
                            <?php } ?>
                            <?php if (array_key_exists('http_status', $aiReviewResult)) { ?>
                                <dt class="col-sm-4"><?= $this->escape(__('http_status', 'glpiintegaglpi')); ?></dt>
                                <dd class="col-sm-8"><?= (int) ($aiReviewResult['http_status'] ?? 0); ?></dd>
                            <?php } ?>
                            <?php if (array_key_exists('elapsed_ms', $aiReviewResult)) { ?>
                                <dt class="col-sm-4"><?= $this->escape(__('elapsed_ms', 'glpiintegaglpi')); ?></dt>
                                <dd class="col-sm-8"><?= (int) ($aiReviewResult['elapsed_ms'] ?? 0); ?></dd>
                            <?php } ?>
                            <dt class="col-sm-4"><?= $this->escape(__('payload_hash', 'glpiintegaglpi')); ?></dt>
                            <dd class="col-sm-8"><code><?= $this->escape((string) ($aiReviewResult['payload_hash'] ?? '')); ?></code></dd>
                            <?php if (!empty($aiReviewResult['response_hash'])) { ?>
                                <dt class="col-sm-4"><?= $this->escape(__('response_hash', 'glpiintegaglpi')); ?></dt>
                                <dd class="col-sm-8"><code><?= $this->escape((string) ($aiReviewResult['response_hash'] ?? '')); ?></code></dd>
                            <?php } ?>
                            <dt class="col-sm-4"><?= $this->escape(__('suggestion_hash', 'glpiintegaglpi')); ?></dt>
                            <dd class="col-sm-8"><code><?= $this->escape((string) ($aiReviewResult['suggestion_hash'] ?? '')); ?></code></dd>
                            <dt class="col-sm-4"><?= $this->escape(__('Revisões persistidas', 'glpiintegaglpi')); ?></dt>
                            <dd class="col-sm-8"><?= (int) ($aiReviewResult['persisted_reviews'] ?? 0); ?></dd>
                        </dl>
                        <?php $aiSuggestions = is_array($aiReviewResult['suggestions'] ?? null) ? $aiReviewResult['suggestions'] : []; ?>
                        <?php if ($aiSuggestions !== []) { ?>
                            <?php foreach ($aiSuggestions as $suggestion) {
                                if (!is_array($suggestion)) {
                                    continue;
                                }
                                $belowThreshold = !empty($suggestion['confidence_below_threshold']);
                                ?>
                                <div class="border rounded p-2 mb-2">
                                    <div class="d-flex flex-wrap justify-content-between gap-2">
                                        <strong><?= $this->escape((string) ($suggestion['kb_title_suggested'] ?? '')); ?></strong>
                                        <span class="badge <?= $belowThreshold ? 'bg-warning text-dark' : 'bg-info'; ?>">
                                            <?= $this->escape((string) ($suggestion['recommended_action'] ?? '')); ?>
                                            · <?= (int) ($suggestion['confidence'] ?? 0); ?>%
                                        </span>
                                    </div>
                                    <div class="text-muted small">
                                        <?= $this->escape(__('revisão humana obrigatória', 'glpiintegaglpi')); ?>
                                        · <code><?= $this->escape((string) ($suggestion['candidate_key'] ?? '')); ?></code>
                                    </div>
                                    <?php if ($belowThreshold) { ?>
                                        <div class="alert alert-warning py-2 my-2">
                                            <?= $this->escape(__('Confiança abaixo do limite. Use apenas como insumo para revisão humana.', 'glpiintegaglpi')); ?>
                                        </div>
                                    <?php } ?>
                                    <?php if (!empty($suggestion['kb_title_before']) && (string) $suggestion['kb_title_before'] !== (string) ($suggestion['kb_title_suggested'] ?? '')) { ?>
                                        <div class="small text-muted">
                                            <?= $this->escape(__('Antes', 'glpiintegaglpi')); ?>:
                                            <?= $this->escape((string) ($suggestion['kb_title_before'] ?? '')); ?>
                                        </div>
                                    <?php } ?>
                                    <p class="mb-2"><?= $this->escape((string) ($suggestion['kb_problem_summary'] ?? '')); ?></p>
                                    <?php $suggestedSteps = is_array($suggestion['kb_resolution_steps'] ?? null) ? $suggestion['kb_resolution_steps'] : []; ?>
                                    <?php if ($suggestedSteps !== []) { ?>
                                        <ol class="mb-2">
                                            <?php foreach (array_slice($suggestedSteps, 0, 6) as $step) { ?>
                                                <li><?= $this->escape((string) $step); ?></li>
                                            <?php } ?>
                                        </ol>
                                    <?php } ?>
                                    <?php if (!empty($suggestion['reason'])) { ?>
                                        <div><strong><?= $this->escape(__('Justificativa', 'glpiintegaglpi')); ?>:</strong> <?= $this->escape((string) ($suggestion['reason'] ?? '')); ?></div>
                                    <?php } ?>
                                    <?php foreach ([
                                        'risks' => __('Riscos', 'glpiintegaglpi'),
                                        'missing_information' => __('Informações faltantes', 'glpiintegaglpi'),
                                        'evidence_used' => __('Evidências usadas', 'glpiintegaglpi'),
                                    ] as $listKey => $listLabel) { ?>
                                        <?php $listItems = is_array($suggestion[$listKey] ?? null) ? $suggestion[$listKey] : []; ?>
                                        <?php if ($listItems !== []) { ?>
                                            <div class="small mt-1">
                                                <strong><?= $this->escape((string) $listLabel); ?>:</strong>
                                                <?= $this->escape(implode(' · ', array_map('strval', $listItems))); ?>
                                            </div>
                                        <?php } ?>
                                    <?php } ?>
                                </div>
                            <?php } ?>
                        <?php } ?>
                    </div>
                </div>
            <?php } ?>
        </div>
    </div>
</div>

<script>
(function () {
    var provider = document.getElementById('ai_review_provider');
    var model = document.getElementById('ai_review_model');
    var providerAlias = document.getElementById('ai_review_provider_alias');
    var modelAlias = document.getElementById('ai_review_model_alias');
    if (!provider || !model) {
        return;
    }
    function syncP4Model() {
        var selectedProvider = provider.value || 'ollama';
        var currentModel = model.value || '';
        var currentOption = model.options[model.selectedIndex] || null;
        if (!currentOption || currentOption.getAttribute('data-provider') !== selectedProvider) {
            for (var index = 0; index < model.options.length; index += 1) {
                var option = model.options[index];
                if (option.getAttribute('data-provider') === selectedProvider) {
                    model.selectedIndex = index;
                    currentModel = option.value || '';
                    break;
                }
            }
        }
        if (providerAlias) {
            providerAlias.value = selectedProvider;
        }
        if (modelAlias) {
            modelAlias.value = currentModel;
        }
    }
    provider.addEventListener('change', syncP4Model);
    model.addEventListener('change', syncP4Model);
    syncP4Model();
}());
</script>
