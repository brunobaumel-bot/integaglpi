<?php

declare(strict_types=1);

/** @var \GlpiPlugin\Integaglpi\Renderer\KbCandidateRenderer $this */
/** @var array<string, mixed> $data */

$filters = is_array($data['filters'] ?? null) ? $data['filters'] : [];
$flash = is_array($data['flash'] ?? null) ? $data['flash'] : null;
$error = trim((string) ($data['error'] ?? ''));
$candidates = is_array($data['candidates'] ?? null) ? $data['candidates'] : [];
$viewCandidate = is_array($data['view_candidate'] ?? null) ? $data['view_candidate'] : [];
$reviews = is_array($data['reviews'] ?? null) ? $data['reviews'] : [];
$statuses = is_array($data['statuses'] ?? null) ? $data['statuses'] : [];
$articleTypes = is_array($data['article_types'] ?? null) ? $data['article_types'] : [];
$total = (int) ($data['total'] ?? 0);
$pages = max(1, (int) ($data['pages'] ?? 1));
$currentPage = max(1, (int) ($filters['page'] ?? 1));

$statusLabels = [
    'suggested' => __('Sugerido', 'glpiintegaglpi'),
    'in_review' => __('Em revisão', 'glpiintegaglpi'),
    'approved' => __('Aprovado para uso manual', 'glpiintegaglpi'),
    'rejected' => __('Rejeitado', 'glpiintegaglpi'),
    'low_confidence' => __('Baixa confiança', 'glpiintegaglpi'),
    'possible_duplicate' => __('Possível duplicado', 'glpiintegaglpi'),
];
$statusBadges = [
    'suggested' => 'primary',
    'in_review' => 'warning',
    'approved' => 'success',
    'rejected' => 'dark',
    'low_confidence' => 'secondary',
    'possible_duplicate' => 'info',
];
$typeLabels = [
    'procedimento_tecnico' => __('Procedimento técnico', 'glpiintegaglpi'),
    'solucao_comum' => __('Solução comum', 'glpiintegaglpi'),
    'resposta_padrao_humanizada' => __('Resposta padrão humanizada', 'glpiintegaglpi'),
    'checklist_diagnostico' => __('Checklist de diagnóstico', 'glpiintegaglpi'),
    'faq_interno' => __('FAQ interno', 'glpiintegaglpi'),
    'alerta_operacional' => __('Alerta operacional', 'glpiintegaglpi'),
    'pergunta_inicial_recomendada' => __('Pergunta inicial recomendada', 'glpiintegaglpi'),
];
?>

<div class="d-flex align-items-center justify-content-between gap-3 mb-3">
    <div>
        <h2 class="mb-1"><?= $this->escape(__('Candidatos de KB por IA', 'glpiintegaglpi')); ?></h2>
        <div class="text-muted">
            <?= $this->escape(__('Candidatos gerados a partir de insights históricos sanitizados. Publicação na Base GLPI nativa continua manual e exige revisão humana.', 'glpiintegaglpi')); ?>
        </div>
    </div>
    <span class="badge bg-secondary"><?= $this->escape(__('Sem publicação automática', 'glpiintegaglpi')); ?></span>
</div>

<div class="alert alert-info">
    <?= $this->escape(__('Uso não punitivo: revise conteúdo, evidências anonimizadas e duplicidade antes de copiar Markdown para a Base de Conhecimento GLPI.', 'glpiintegaglpi')); ?>
</div>

<?php if ($flash !== null) : ?>
    <div class="alert alert-<?= $this->escape((string) ($flash['type'] ?? 'info')); ?>">
        <?= $this->escape((string) ($flash['message'] ?? '')); ?>
    </div>
<?php endif; ?>

<?php if ($error !== '') : ?>
    <div class="alert alert-warning"><?= $this->escape($error); ?></div>
<?php endif; ?>

<div class="card mb-3">
    <div class="card-header"><?= $this->escape(__('Busca e filtros', 'glpiintegaglpi')); ?></div>
    <div class="card-body">
        <form method="get" action="<?= $this->escape($this->getKbCandidatesUrl()); ?>">
            <div class="row g-3">
                <div class="col-md-4">
                    <label class="form-label"><?= $this->escape(__('Texto', 'glpiintegaglpi')); ?></label>
                    <input class="form-control" type="search" name="q" value="<?= $this->escape((string) ($filters['q'] ?? '')); ?>" maxlength="120">
                </div>
                <div class="col-md-2">
                    <label class="form-label"><?= $this->escape(__('Status', 'glpiintegaglpi')); ?></label>
                    <select class="form-select" name="status">
                        <option value=""><?= $this->escape(__('Todos', 'glpiintegaglpi')); ?></option>
                        <?php foreach ($statuses as $status) : ?>
                            <option value="<?= $this->escape((string) $status); ?>" <?= ((string) ($filters['status'] ?? '') === (string) $status) ? 'selected' : ''; ?>>
                                <?= $this->escape($statusLabels[(string) $status] ?? (string) $status); ?>
                            </option>
                        <?php endforeach; ?>
                    </select>
                </div>
                <div class="col-md-3">
                    <label class="form-label"><?= $this->escape(__('Tipo', 'glpiintegaglpi')); ?></label>
                    <select class="form-select" name="article_type">
                        <option value=""><?= $this->escape(__('Todos', 'glpiintegaglpi')); ?></option>
                        <?php foreach ($articleTypes as $type) : ?>
                            <option value="<?= $this->escape((string) $type); ?>" <?= ((string) ($filters['article_type'] ?? '') === (string) $type) ? 'selected' : ''; ?>>
                                <?= $this->escape($typeLabels[(string) $type] ?? (string) $type); ?>
                            </option>
                        <?php endforeach; ?>
                    </select>
                </div>
                <div class="col-md-2">
                    <label class="form-label"><?= $this->escape(__('Duplicidade', 'glpiintegaglpi')); ?></label>
                    <select class="form-select" name="duplicate">
                        <option value=""><?= $this->escape(__('Todos', 'glpiintegaglpi')); ?></option>
                        <option value="yes" <?= ((string) ($filters['duplicate'] ?? '') === 'yes') ? 'selected' : ''; ?>><?= $this->escape(__('Sim', 'glpiintegaglpi')); ?></option>
                        <option value="no" <?= ((string) ($filters['duplicate'] ?? '') === 'no') ? 'selected' : ''; ?>><?= $this->escape(__('Não', 'glpiintegaglpi')); ?></option>
                    </select>
                </div>
                <div class="col-md-1 d-flex align-items-end">
                    <button type="submit" class="btn btn-primary w-100"><?= $this->escape(__('Buscar', 'glpiintegaglpi')); ?></button>
                </div>
            </div>
        </form>
    </div>
</div>

<?php if ($viewCandidate !== []) : ?>
    <?php
    $candidateId = (int) ($viewCandidate['id'] ?? 0);
    $status = (string) ($viewCandidate['status'] ?? '');
    $type = (string) ($viewCandidate['article_type'] ?? '');
    $related = json_decode((string) ($viewCandidate['related_native_kb_json'] ?? '[]'), true) ?: [];
    $markdown = (string) ($viewCandidate['content_markdown'] ?? '');
    ?>
    <div class="card mb-3">
        <div class="card-header d-flex align-items-center justify-content-between">
            <span><?= $this->escape((string) ($viewCandidate['title'] ?? '')); ?></span>
            <span class="badge bg-<?= $this->escape($statusBadges[$status] ?? 'secondary'); ?>">
                <?= $this->escape($statusLabels[$status] ?? $status); ?>
            </span>
        </div>
        <div class="card-body">
            <div class="row g-3 mb-3">
                <div class="col-md-3">
                    <div class="text-muted small"><?= $this->escape(__('Tipo', 'glpiintegaglpi')); ?></div>
                    <?= $this->escape($typeLabels[$type] ?? $type); ?>
                </div>
                <div class="col-md-3">
                    <div class="text-muted small"><?= $this->escape(__('Confiança', 'glpiintegaglpi')); ?></div>
                    <?= (int) ($viewCandidate['confidence_score'] ?? 0); ?>%
                </div>
                <div class="col-md-3">
                    <div class="text-muted small"><?= $this->escape(__('Possível duplicado', 'glpiintegaglpi')); ?></div>
                    <?= (bool) ($viewCandidate['possible_duplicate'] ?? false) ? $this->escape(__('Sim', 'glpiintegaglpi')) : $this->escape(__('Não', 'glpiintegaglpi')); ?>
                </div>
                <div class="col-md-3">
                    <div class="text-muted small"><?= $this->escape(__('Categoria sugerida', 'glpiintegaglpi')); ?></div>
                    <?= $this->escape((string) ($viewCandidate['category_suggestion'] ?? '')); ?>
                </div>
            </div>

            <?php if ((string) ($viewCandidate['duplicate_reason'] ?? '') !== '') : ?>
                <div class="alert alert-warning">
                    <?= $this->escape((string) $viewCandidate['duplicate_reason']); ?>
                </div>
            <?php endif; ?>

            <h4><?= $this->escape(__('Markdown para cópia manual', 'glpiintegaglpi')); ?></h4>
            <textarea id="kb-candidate-markdown" class="form-control font-monospace mb-2" rows="16" readonly><?= $this->escape($markdown); ?></textarea>
            <div class="d-flex gap-2 mb-3">
                <button type="button" class="btn btn-outline-primary" data-copy-markdown>
                    <?= $this->escape(__('Copiar Markdown', 'glpiintegaglpi')); ?>
                </button>
                <form method="post" action="<?= $this->escape($this->getKbCandidatesUrl()); ?>" class="d-inline">
                    <?= $this->renderCsrfToken(); ?>
                    <input type="hidden" name="candidate_id" value="<?= $candidateId; ?>">
                    <input type="hidden" name="action" value="copy_markdown">
                    <button type="submit" class="btn btn-outline-secondary">
                        <?= $this->escape(__('Registrar cópia', 'glpiintegaglpi')); ?>
                    </button>
                </form>
            </div>

            <h4><?= $this->escape(__('Evidências anonimizadas', 'glpiintegaglpi')); ?></h4>
            <div class="border rounded p-3 bg-light mb-3">
                <?= $this->renderContent((string) ($viewCandidate['evidence_summary_sanitized'] ?? '')); ?>
            </div>

            <?php if ($related !== []) : ?>
                <h4><?= $this->escape(__('Artigos nativos relacionados', 'glpiintegaglpi')); ?></h4>
                <ul>
                    <?php foreach ($related as $article) : ?>
                        <?php if (!is_array($article)) { continue; } ?>
                        <li>
                            <a href="<?= $this->escape((string) ($article['internalUrl'] ?? $article['internal_url'] ?? '#')); ?>">
                                <?= $this->escape((string) ($article['title'] ?? '')); ?>
                            </a>
                            <span class="text-muted"><?= $this->escape((string) ($article['category'] ?? '')); ?></span>
                        </li>
                    <?php endforeach; ?>
                </ul>
            <?php endif; ?>

            <form method="post" action="<?= $this->escape($this->getKbCandidatesUrl()); ?>" class="border rounded p-3">
                <?= $this->renderCsrfToken(); ?>
                <input type="hidden" name="candidate_id" value="<?= $candidateId; ?>">
                <div class="mb-2">
                    <label class="form-label"><?= $this->escape(__('Nota de revisão', 'glpiintegaglpi')); ?></label>
                    <textarea class="form-control" name="review_notes" rows="3" maxlength="1000"><?= $this->escape((string) ($viewCandidate['review_notes'] ?? '')); ?></textarea>
                </div>
                <div class="d-flex flex-wrap gap-2">
                    <button type="submit" name="action" value="mark_in_review" class="btn btn-outline-warning"><?= $this->escape(__('Marcar em revisão', 'glpiintegaglpi')); ?></button>
                    <button type="submit" name="action" value="approve" class="btn btn-success"><?= $this->escape(__('Aprovar para uso manual', 'glpiintegaglpi')); ?></button>
                    <button type="submit" name="action" value="reject" class="btn btn-outline-dark"><?= $this->escape(__('Rejeitar', 'glpiintegaglpi')); ?></button>
                </div>
                <div class="form-text">
                    <?= $this->escape(__('Aprovar não publica na KB nativa; apenas registra revisão humana.', 'glpiintegaglpi')); ?>
                </div>
            </form>
        </div>
    </div>

    <div class="card mb-3">
        <div class="card-header"><?= $this->escape(__('Histórico de revisão', 'glpiintegaglpi')); ?></div>
        <div class="card-body p-0">
            <?php if ($reviews === []) : ?>
                <div class="p-3 text-muted"><?= $this->escape(__('Nenhuma revisão registrada.', 'glpiintegaglpi')); ?></div>
            <?php else : ?>
                <table class="table table-sm mb-0">
                    <thead class="table-light">
                        <tr>
                            <th><?= $this->escape(__('Ação', 'glpiintegaglpi')); ?></th>
                            <th><?= $this->escape(__('Revisor', 'glpiintegaglpi')); ?></th>
                            <th><?= $this->escape(__('Status', 'glpiintegaglpi')); ?></th>
                            <th><?= $this->escape(__('Criado em', 'glpiintegaglpi')); ?></th>
                            <th><?= $this->escape(__('Notas', 'glpiintegaglpi')); ?></th>
                        </tr>
                    </thead>
                    <tbody>
                        <?php foreach ($reviews as $review) : ?>
                            <tr>
                                <td><?= $this->escape((string) ($review['action'] ?? '')); ?></td>
                                <td><?= (int) ($review['reviewer_id'] ?? 0); ?></td>
                                <td><?= $this->escape((string) ($review['previous_status'] ?? '')); ?> → <?= $this->escape((string) ($review['new_status'] ?? '')); ?></td>
                                <td><?= $this->escape((string) ($review['created_at'] ?? '')); ?></td>
                                <td><?= $this->escape((string) ($review['notes'] ?? '')); ?></td>
                            </tr>
                        <?php endforeach; ?>
                    </tbody>
                </table>
            <?php endif; ?>
        </div>
    </div>
<?php endif; ?>

<div class="card">
    <div class="card-header d-flex align-items-center justify-content-between">
        <span><?= $this->escape(__('Candidatos', 'glpiintegaglpi')); ?></span>
        <span class="text-muted small"><?= $total; ?> <?= $this->escape(__('registro(s)', 'glpiintegaglpi')); ?></span>
    </div>
    <div class="card-body p-0">
        <?php if ($candidates === []) : ?>
            <div class="p-3 text-muted"><?= $this->escape(__('Nenhum candidato encontrado.', 'glpiintegaglpi')); ?></div>
        <?php else : ?>
            <div class="table-responsive">
                <table class="table table-sm table-hover mb-0">
                    <thead class="table-light">
                        <tr>
                            <th><?= $this->escape(__('Título', 'glpiintegaglpi')); ?></th>
                            <th><?= $this->escape(__('Tipo', 'glpiintegaglpi')); ?></th>
                            <th><?= $this->escape(__('Status', 'glpiintegaglpi')); ?></th>
                            <th><?= $this->escape(__('Confiança', 'glpiintegaglpi')); ?></th>
                            <th><?= $this->escape(__('Criado em', 'glpiintegaglpi')); ?></th>
                            <th><?= $this->escape(__('Ações', 'glpiintegaglpi')); ?></th>
                        </tr>
                    </thead>
                    <tbody>
                        <?php foreach ($candidates as $candidate) : ?>
                            <?php
                            $candidateId = (int) ($candidate['id'] ?? 0);
                            $status = (string) ($candidate['status'] ?? '');
                            $type = (string) ($candidate['article_type'] ?? '');
                            ?>
                            <tr>
                                <td>
                                    <div class="fw-bold"><?= $this->escape((string) ($candidate['title'] ?? '-')); ?></div>
                                    <?php if ((bool) ($candidate['possible_duplicate'] ?? false)) : ?>
                                        <span class="badge bg-info"><?= $this->escape(__('Possível duplicado', 'glpiintegaglpi')); ?></span>
                                    <?php endif; ?>
                                </td>
                                <td><?= $this->escape($typeLabels[$type] ?? $type); ?></td>
                                <td>
                                    <span class="badge bg-<?= $this->escape($statusBadges[$status] ?? 'secondary'); ?>">
                                        <?= $this->escape($statusLabels[$status] ?? $status); ?>
                                    </span>
                                </td>
                                <td><?= (int) ($candidate['confidence_score'] ?? 0); ?>%</td>
                                <td><?= $this->escape((string) ($candidate['created_at'] ?? '')); ?></td>
                                <td>
                                    <a class="small" href="<?= $this->escape($this->getViewUrl($filters, $candidateId)); ?>">
                                        <?= $this->escape(__('Ver/Revisar', 'glpiintegaglpi')); ?>
                                    </a>
                                </td>
                            </tr>
                        <?php endforeach; ?>
                    </tbody>
                </table>
            </div>
        <?php endif; ?>
    </div>
    <div class="card-footer d-flex justify-content-between align-items-center">
        <span class="text-muted small"><?= $this->escape(__('Página', 'glpiintegaglpi')); ?> <?= $currentPage; ?> / <?= $pages; ?></span>
        <div class="btn-group">
            <?php
            $prev = max(1, $currentPage - 1);
            $next = min($pages, $currentPage + 1);
            $prevQuery = array_merge($filters, ['page' => $prev]);
            $nextQuery = array_merge($filters, ['page' => $next]);
            ?>
            <a class="btn btn-outline-secondary btn-sm <?= $currentPage <= 1 ? 'disabled' : ''; ?>" href="<?= $this->escape($this->getKbCandidatesUrl() . '?' . http_build_query($prevQuery)); ?>">
                <?= $this->escape(__('Anterior', 'glpiintegaglpi')); ?>
            </a>
            <a class="btn btn-outline-secondary btn-sm <?= $currentPage >= $pages ? 'disabled' : ''; ?>" href="<?= $this->escape($this->getKbCandidatesUrl() . '?' . http_build_query($nextQuery)); ?>">
                <?= $this->escape(__('Próxima', 'glpiintegaglpi')); ?>
            </a>
        </div>
    </div>
</div>

<script>
document.querySelector('[data-copy-markdown]')?.addEventListener('click', async () => {
  const textarea = document.getElementById('kb-candidate-markdown');
  if (!(textarea instanceof HTMLTextAreaElement)) {
    return;
  }
  await navigator.clipboard.writeText(textarea.value);
});
</script>
