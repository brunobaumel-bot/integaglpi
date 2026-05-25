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
$upload = is_array($flash['upload'] ?? null) ? $flash['upload'] : null;
$exportPreview = is_array($flash['export_preview'] ?? null) ? $flash['export_preview'] : null;
$exportUpload = is_array($flash['export_upload'] ?? null) ? $flash['export_upload'] : null;
$exportOptions = is_array($data['export_options'] ?? null) ? $data['export_options'] : [];
$entities = is_array($exportOptions['entities'] ?? null) ? $exportOptions['entities'] : [];
$groups = is_array($exportOptions['groups'] ?? null) ? $exportOptions['groups'] : [];
$categories = is_array($exportOptions['categories'] ?? null) ? $exportOptions['categories'] : [];
$statuses = is_array($exportOptions['statuses'] ?? null) ? $exportOptions['statuses'] : [];
$summary = is_array($miningResult['summary'] ?? null) ? $miningResult['summary'] : [];
$patterns = is_array($miningResult['patterns'] ?? null) ? $miningResult['patterns'] : [];
$insights = is_array($miningResult['insights'] ?? null) ? $miningResult['insights'] : [];
$evidence = is_array($miningResult['evidence'] ?? null) ? $miningResult['evidence'] : [];
$previewRows = is_array($miningResult['preview_rows'] ?? null) ? $miningResult['preview_rows'] : [];
$csrf = GlpiPlugin\Integaglpi\Plugin::getCsrfToken();
$runId = trim((string) ($summary['run_id'] ?? $candidateResult['run_id'] ?? $data['selected_run_id'] ?? ''));
$retentionHours = max(1, (int) ceil(((int) ($data['jsonl_retention_seconds'] ?? 86400)) / 3600));
?>

<div class="container-fluid plugin-integaglpi-historical-mining">
    <div class="d-flex flex-wrap justify-content-between align-items-start gap-2 mb-3">
        <div>
            <h1 class="h3 mb-1"><?= $this->escape(__('Mineração Histórica', 'glpiintegaglpi')); ?></h1>
            <p class="text-muted mb-0">
                <?= $this->escape(__('P2/P3 por UI: JSONL sanitizado, dry-run obrigatório, execução manual e candidatos revisáveis.', 'glpiintegaglpi')); ?>
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
                            <input class="form-control" type="date" id="export_date_start" name="export_date_start">
                        </div>
                        <div class="col-md-6">
                            <label class="form-label" for="export_date_end"><?= $this->escape(__('Período fim', 'glpiintegaglpi')); ?></label>
                            <input class="form-control" type="date" id="export_date_end" name="export_date_end">
                        </div>
                        <div class="col-md-6">
                            <label class="form-label" for="entities_id"><?= $this->escape(__('Entidade', 'glpiintegaglpi')); ?></label>
                            <select class="form-select" id="entities_id" name="entities_id">
                                <option value="0"><?= $this->escape(__('Entidades permitidas', 'glpiintegaglpi')); ?></option>
                                <?php foreach ($entities as $entity) {
                                    if (!is_array($entity)) { continue; }
                                    ?>
                                    <option value="<?= (int) ($entity['id'] ?? 0); ?>"><?= $this->escape((string) ($entity['name'] ?? '')); ?></option>
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
                                    <option value="<?= (int) ($group['id'] ?? 0); ?>"><?= $this->escape((string) ($group['name'] ?? '')); ?></option>
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
                                    <option value="<?= (int) ($category['id'] ?? 0); ?>"><?= $this->escape((string) ($category['name'] ?? '')); ?></option>
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
                                    <option value="<?= (int) ($status['id'] ?? 0); ?>"><?= $this->escape((string) ($status['name'] ?? '')); ?></option>
                                <?php } ?>
                            </select>
                        </div>
                        <div class="col-md-6">
                            <label class="form-label" for="export_limit"><?= $this->escape(__('Limite de chamados', 'glpiintegaglpi')); ?></label>
                            <input class="form-control" type="number" id="export_limit" name="export_limit" min="1" max="1000" value="100">
                        </div>
                    </div>
                    <div class="form-check mt-3">
                        <input class="form-check-input" type="checkbox" id="closed_only" name="closed_only" value="1" checked>
                        <label class="form-check-label" for="closed_only"><?= $this->escape(__('Somente solucionados/fechados', 'glpiintegaglpi')); ?></label>
                    </div>
                    <div class="form-check">
                        <input class="form-check-input" type="checkbox" id="include_followups" name="include_followups" value="1">
                        <label class="form-check-label" for="include_followups"><?= $this->escape(__('Incluir followups sanitizados', 'glpiintegaglpi')); ?></label>
                    </div>
                    <div class="form-check">
                        <input class="form-check-input" type="checkbox" id="include_solution" name="include_solution" value="1" checked>
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
                <form method="post" action="<?= $this->escape($this->getHistoricalMiningUrl()); ?>" class="card mb-3">
                    <div class="card-header"><?= $this->escape(__('Dry-run com JSONL gerado', 'glpiintegaglpi')); ?></div>
                    <div class="card-body">
                        <input type="hidden" name="_glpi_csrf_token" value="<?= $this->escape($csrf); ?>">
                        <input type="hidden" name="action" value="validate_generated">
                        <input type="hidden" name="upload_id" value="<?= $this->escape((string) ($exportUpload['upload_id'] ?? '')); ?>">
                        <input type="hidden" name="max_rows" value="1000">
                        <p class="text-muted">
                            <?= $this->escape(__('O arquivo foi gerado em área temporária controlada e pode seguir para o dry-run P2.', 'glpiintegaglpi')); ?>
                        </p>
                        <button class="btn btn-outline-primary" type="submit">
                            <?= $this->escape(__('Usar arquivo gerado no dry-run P2', 'glpiintegaglpi')); ?>
                        </button>
                    </div>
                </form>
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
                    <button class="btn btn-primary" type="submit" <?= $upload === null ? 'disabled' : ''; ?>>
                        <?= $this->escape(__('Executar mineração', 'glpiintegaglpi')); ?>
                    </button>
                </div>
            </form>

            <form method="post" action="<?= $this->escape($this->getHistoricalMiningUrl()); ?>" class="card">
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
                    <?php } ?>
                </div>
            </div>

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
        </div>
    </div>
</div>
