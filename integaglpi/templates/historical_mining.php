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
$summary = is_array($miningResult['summary'] ?? null) ? $miningResult['summary'] : [];
$patterns = is_array($miningResult['patterns'] ?? null) ? $miningResult['patterns'] : [];
$insights = is_array($miningResult['insights'] ?? null) ? $miningResult['insights'] : [];
$evidence = is_array($miningResult['evidence'] ?? null) ? $miningResult['evidence'] : [];
$previewRows = is_array($miningResult['preview_rows'] ?? null) ? $miningResult['preview_rows'] : [];
$csrf = GlpiPlugin\Integaglpi\Plugin::getCsrfToken();
$runId = trim((string) ($summary['run_id'] ?? $candidateResult['run_id'] ?? $data['selected_run_id'] ?? ''));
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
            <form method="post" enctype="multipart/form-data" action="<?= $this->escape($this->getHistoricalMiningUrl()); ?>" class="card mb-3">
                <div class="card-header"><?= $this->escape(__('1. Upload e dry-run', 'glpiintegaglpi')); ?></div>
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
