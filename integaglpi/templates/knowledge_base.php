<?php

declare(strict_types=1);

/** @var \GlpiPlugin\Integaglpi\Renderer\KnowledgeBaseRenderer $this */
/** @var array<string, mixed> $data */

$filters = is_array($data['filters'] ?? null) ? $data['filters'] : [];
$flash = is_array($data['flash'] ?? null) ? $data['flash'] : null;
$error = trim((string) ($data['error'] ?? ''));
$articles = is_array($data['articles'] ?? null) ? $data['articles'] : [];
$viewArticle = is_array($data['view_article'] ?? null) ? $data['view_article'] : [];
$editArticle = is_array($data['edit_article'] ?? null) ? $data['edit_article'] : [];
$versions = is_array($data['versions'] ?? null) ? $data['versions'] : [];
$articleTypes = is_array($data['article_types'] ?? null) ? $data['article_types'] : [];
$statuses = is_array($data['statuses'] ?? null) ? $data['statuses'] : [];
$canUpdate = $this->canUpdate();
$total = (int) ($data['total'] ?? 0);
$pages = max(1, (int) ($data['pages'] ?? 1));
$currentPage = max(1, (int) ($filters['page'] ?? 1));

$typeLabels = [
    'procedimento_tecnico' => __('Procedimento técnico', 'glpiintegaglpi'),
    'solucao_comum' => __('Solução comum', 'glpiintegaglpi'),
    'resposta_padrao' => __('Resposta padrão', 'glpiintegaglpi'),
    'diagnostico_conhecido' => __('Diagnóstico conhecido', 'glpiintegaglpi'),
    'faq_interno' => __('FAQ interno', 'glpiintegaglpi'),
    'alerta_operacional' => __('Alerta operacional', 'glpiintegaglpi'),
];
$statusLabels = [
    'draft' => __('Rascunho', 'glpiintegaglpi'),
    'active' => __('Publicado', 'glpiintegaglpi'),
    'archived' => __('Arquivado', 'glpiintegaglpi'),
];
$statusBadges = [
    'draft' => 'secondary',
    'active' => 'success',
    'archived' => 'dark',
];
$articleForm = [
    'id' => (int) ($editArticle['id'] ?? 0),
    'title' => (string) ($editArticle['title'] ?? ''),
    'content_text' => (string) ($editArticle['content_text'] ?? ''),
    'article_type' => (string) ($editArticle['article_type'] ?? 'procedimento_tecnico'),
    'category' => (string) ($editArticle['category'] ?? ''),
    'service_catalog_id' => (int) ($editArticle['service_catalog_id'] ?? 0),
    'routing_queue_id' => (int) ($editArticle['routing_queue_id'] ?? 0),
    'tags' => implode(', ', json_decode((string) ($editArticle['tags'] ?? '[]'), true) ?: []),
    'is_sensitive' => (bool) ($editArticle['is_sensitive'] ?? false),
];
?>

<div class="d-flex align-items-center justify-content-between gap-3 mb-3">
    <div>
        <h2 class="mb-1"><?= $this->escape(__('Base de Conhecimento', 'glpiintegaglpi')); ?></h2>
        <div class="text-muted">
            <?= $this->escape(__('Artigos internos versionados para consulta humana. Sem RAG, embeddings, IA ou envio ao cliente nesta fase.', 'glpiintegaglpi')); ?>
        </div>
    </div>
    <span class="badge bg-secondary"><?= $this->escape(__('Read-only para operação', 'glpiintegaglpi')); ?></span>
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
        <form method="get" action="<?= $this->escape($this->getKnowledgeBaseUrl()); ?>">
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
                    <label class="form-label"><?= $this->escape(__('Tag', 'glpiintegaglpi')); ?></label>
                    <input class="form-control" type="text" name="tag" value="<?= $this->escape((string) ($filters['tag'] ?? '')); ?>" maxlength="40">
                </div>
                <div class="col-md-1">
                    <label class="form-label"><?= $this->escape(__('Sensível', 'glpiintegaglpi')); ?></label>
                    <select class="form-select" name="sensitive">
                        <option value=""></option>
                        <option value="yes" <?= ((string) ($filters['sensitive'] ?? '') === 'yes') ? 'selected' : ''; ?>><?= $this->escape(__('Sim', 'glpiintegaglpi')); ?></option>
                        <option value="no" <?= ((string) ($filters['sensitive'] ?? '') === 'no') ? 'selected' : ''; ?>><?= $this->escape(__('Não', 'glpiintegaglpi')); ?></option>
                    </select>
                </div>
                <div class="col-12 d-flex align-items-end gap-2">
                    <button type="submit" class="btn btn-primary"><?= $this->escape(__('Buscar', 'glpiintegaglpi')); ?></button>
                    <a class="btn btn-outline-secondary" href="<?= $this->escape($this->getKnowledgeBaseUrl()); ?>">
                        <?= $this->escape(__('Limpar', 'glpiintegaglpi')); ?>
                    </a>
                </div>
            </div>
        </form>
    </div>
</div>

<?php if ($canUpdate && $error === '') : ?>
    <div class="card mb-3">
        <div class="card-header">
            <?= $articleForm['id'] > 0
                ? $this->escape(__('Editar artigo', 'glpiintegaglpi'))
                : $this->escape(__('Novo artigo', 'glpiintegaglpi')); ?>
        </div>
        <div class="card-body">
            <form method="post" action="<?= $this->escape($this->getKnowledgeBaseUrl()); ?>">
                <?= $this->renderCsrfToken(); ?>
                <input type="hidden" name="action" value="save_article">
                <input type="hidden" name="article_id" value="<?= (int) $articleForm['id']; ?>">
                <div class="row g-3">
                    <div class="col-md-6">
                        <label class="form-label"><?= $this->escape(__('Título', 'glpiintegaglpi')); ?></label>
                        <input class="form-control" type="text" name="title" required maxlength="200" value="<?= $this->escape($articleForm['title']); ?>">
                    </div>
                    <div class="col-md-3">
                        <label class="form-label"><?= $this->escape(__('Tipo', 'glpiintegaglpi')); ?></label>
                        <select class="form-select" name="article_type" required>
                            <?php foreach ($articleTypes as $type) : ?>
                                <option value="<?= $this->escape((string) $type); ?>" <?= $articleForm['article_type'] === (string) $type ? 'selected' : ''; ?>>
                                    <?= $this->escape($typeLabels[(string) $type] ?? (string) $type); ?>
                                </option>
                            <?php endforeach; ?>
                        </select>
                    </div>
                    <div class="col-md-3">
                        <label class="form-label"><?= $this->escape(__('Categoria', 'glpiintegaglpi')); ?></label>
                        <input class="form-control" type="text" name="category" maxlength="80" value="<?= $this->escape($articleForm['category']); ?>">
                    </div>
                    <div class="col-md-3">
                        <label class="form-label"><?= $this->escape(__('Serviço ID', 'glpiintegaglpi')); ?></label>
                        <input class="form-control" type="number" min="1" name="service_catalog_id" value="<?= $articleForm['service_catalog_id'] > 0 ? (int) $articleForm['service_catalog_id'] : ''; ?>">
                    </div>
                    <div class="col-md-3">
                        <label class="form-label"><?= $this->escape(__('Fila ID', 'glpiintegaglpi')); ?></label>
                        <input class="form-control" type="number" min="1" name="routing_queue_id" value="<?= $articleForm['routing_queue_id'] > 0 ? (int) $articleForm['routing_queue_id'] : ''; ?>">
                    </div>
                    <div class="col-md-4">
                        <label class="form-label"><?= $this->escape(__('Tags', 'glpiintegaglpi')); ?></label>
                        <input class="form-control" type="text" name="tags" maxlength="400" value="<?= $this->escape($articleForm['tags']); ?>" placeholder="servico, fila, risco">
                    </div>
                    <div class="col-md-2 d-flex align-items-end">
                        <label class="form-check">
                            <input type="hidden" name="is_sensitive" value="0">
                            <input class="form-check-input" type="checkbox" name="is_sensitive" value="1" <?= $articleForm['is_sensitive'] ? 'checked' : ''; ?>>
                            <span class="form-check-label"><?= $this->escape(__('Sensível', 'glpiintegaglpi')); ?></span>
                        </label>
                    </div>
                    <div class="col-12">
                        <label class="form-label"><?= $this->escape(__('Conteúdo', 'glpiintegaglpi')); ?></label>
                        <textarea class="form-control font-monospace" name="content_text" rows="10" maxlength="20000" required><?= $this->escape($articleForm['content_text']); ?></textarea>
                        <div class="form-text">
                            <?= $this->escape(__('Texto é exibido escapado. Não informe senhas, tokens, Bearer, app_secret, api_key ou chaves privadas.', 'glpiintegaglpi')); ?>
                        </div>
                    </div>
                    <div class="col-12">
                        <label class="form-label"><?= $this->escape(__('Motivo da alteração', 'glpiintegaglpi')); ?></label>
                        <input class="form-control" type="text" name="change_reason" maxlength="500">
                    </div>
                    <div class="col-12 d-flex gap-2">
                        <button type="submit" class="btn btn-primary"><?= $this->escape(__('Salvar rascunho/versionar', 'glpiintegaglpi')); ?></button>
                        <?php if ($articleForm['id'] > 0) : ?>
                            <a class="btn btn-outline-secondary" href="<?= $this->escape($this->getKnowledgeBaseUrl()); ?>">
                                <?= $this->escape(__('Cancelar edição', 'glpiintegaglpi')); ?>
                            </a>
                        <?php endif; ?>
                    </div>
                </div>
            </form>
        </div>
    </div>
<?php endif; ?>

<?php if ($viewArticle !== []) : ?>
    <?php
    $viewStatus = (string) ($viewArticle['status'] ?? 'draft');
    $viewType = (string) ($viewArticle['article_type'] ?? '');
    $viewTags = json_decode((string) ($viewArticle['tags'] ?? '[]'), true) ?: [];
    ?>
    <div class="card mb-3">
        <div class="card-header d-flex align-items-center justify-content-between">
            <span><?= $this->escape((string) ($viewArticle['title'] ?? '')); ?></span>
            <span class="badge bg-<?= $this->escape($statusBadges[$viewStatus] ?? 'secondary'); ?>">
                <?= $this->escape($statusLabels[$viewStatus] ?? $viewStatus); ?>
            </span>
        </div>
        <div class="card-body">
            <?php if ((bool) ($viewArticle['is_sensitive'] ?? false)) : ?>
                <div class="alert alert-warning">
                    <?= $this->escape(__('Conteúdo marcado como sensível. Revise permissões e evite exposição desnecessária.', 'glpiintegaglpi')); ?>
                </div>
            <?php endif; ?>
            <div class="mb-2 text-muted">
                <?= $this->escape($typeLabels[$viewType] ?? $viewType); ?>
                · v<?= (int) ($viewArticle['version'] ?? 1); ?>
                · <?= $this->escape((string) ($viewArticle['updated_at'] ?? '')); ?>
            </div>
            <div class="mb-3">
                <?php foreach ($viewTags as $tag) : ?>
                    <span class="badge bg-light text-dark border"><?= $this->escape((string) $tag); ?></span>
                <?php endforeach; ?>
            </div>
            <div class="border rounded p-3 bg-light">
                <?= $this->renderContent((string) ($viewArticle['content_text'] ?? '')); ?>
            </div>
        </div>
    </div>

    <div class="card mb-3">
        <div class="card-header"><?= $this->escape(__('Histórico de versões', 'glpiintegaglpi')); ?></div>
        <div class="card-body p-0">
            <?php if ($versions === []) : ?>
                <div class="p-3 text-muted"><?= $this->escape(__('Nenhuma versão registrada.', 'glpiintegaglpi')); ?></div>
            <?php else : ?>
                <div class="table-responsive">
                    <table class="table table-sm mb-0">
                        <thead class="table-light">
                            <tr>
                                <th><?= $this->escape(__('Versão', 'glpiintegaglpi')); ?></th>
                                <th><?= $this->escape(__('Status', 'glpiintegaglpi')); ?></th>
                                <th><?= $this->escape(__('Alterado por', 'glpiintegaglpi')); ?></th>
                                <th><?= $this->escape(__('Criado em', 'glpiintegaglpi')); ?></th>
                                <th><?= $this->escape(__('Motivo', 'glpiintegaglpi')); ?></th>
                            </tr>
                        </thead>
                        <tbody>
                            <?php foreach ($versions as $version) : ?>
                                <tr>
                                    <td><?= (int) ($version['version'] ?? 0); ?></td>
                                    <td><?= $this->escape($statusLabels[(string) ($version['status'] ?? '')] ?? (string) ($version['status'] ?? '')); ?></td>
                                    <td><?= (int) ($version['changed_by_glpi_user_id'] ?? 0); ?></td>
                                    <td><?= $this->escape((string) ($version['created_at'] ?? '')); ?></td>
                                    <td><?= $this->escape((string) ($version['change_reason'] ?? '')); ?></td>
                                </tr>
                            <?php endforeach; ?>
                        </tbody>
                    </table>
                </div>
            <?php endif; ?>
        </div>
    </div>
<?php endif; ?>

<div class="card">
    <div class="card-header d-flex align-items-center justify-content-between">
        <span><?= $this->escape(__('Artigos', 'glpiintegaglpi')); ?></span>
        <span class="text-muted small"><?= $total; ?> <?= $this->escape(__('registro(s)', 'glpiintegaglpi')); ?></span>
    </div>
    <div class="card-body p-0">
        <?php if ($articles === []) : ?>
            <div class="p-3 text-muted"><?= $this->escape(__('Nenhum artigo encontrado.', 'glpiintegaglpi')); ?></div>
        <?php else : ?>
            <div class="table-responsive">
                <table class="table table-sm table-hover mb-0">
                    <thead class="table-light">
                        <tr>
                            <th><?= $this->escape(__('Título', 'glpiintegaglpi')); ?></th>
                            <th><?= $this->escape(__('Tipo/Tags', 'glpiintegaglpi')); ?></th>
                            <th><?= $this->escape(__('Status', 'glpiintegaglpi')); ?></th>
                            <th><?= $this->escape(__('Versão', 'glpiintegaglpi')); ?></th>
                            <th><?= $this->escape(__('Atualizado', 'glpiintegaglpi')); ?></th>
                            <th><?= $this->escape(__('Ações', 'glpiintegaglpi')); ?></th>
                        </tr>
                    </thead>
                    <tbody>
                        <?php foreach ($articles as $article) : ?>
                            <?php
                            $articleId = (int) ($article['id'] ?? 0);
                            $status = (string) ($article['status'] ?? 'draft');
                            $type = (string) ($article['article_type'] ?? '');
                            $tags = json_decode((string) ($article['tags'] ?? '[]'), true) ?: [];
                            ?>
                            <tr>
                                <td>
                                    <div class="fw-bold"><?= $this->escape((string) ($article['title'] ?? '-')); ?></div>
                                    <?php if ((bool) ($article['is_sensitive'] ?? false)) : ?>
                                        <span class="badge bg-warning text-dark"><?= $this->escape(__('Sensível', 'glpiintegaglpi')); ?></span>
                                    <?php endif; ?>
                                    <div class="small text-muted"><?= $this->escape((string) ($article['category'] ?? '')); ?></div>
                                </td>
                                <td>
                                    <div><?= $this->escape($typeLabels[$type] ?? $type); ?></div>
                                    <div>
                                        <?php foreach ($tags as $tag) : ?>
                                            <span class="badge bg-light text-dark border"><?= $this->escape((string) $tag); ?></span>
                                        <?php endforeach; ?>
                                    </div>
                                </td>
                                <td>
                                    <span class="badge bg-<?= $this->escape($statusBadges[$status] ?? 'secondary'); ?>">
                                        <?= $this->escape($statusLabels[$status] ?? $status); ?>
                                    </span>
                                </td>
                                <td><?= (int) ($article['version'] ?? 1); ?></td>
                                <td><?= $this->escape((string) ($article['updated_at'] ?? '')); ?></td>
                                <td>
                                    <a class="small me-2" href="<?= $this->escape($this->getViewUrl($filters, $articleId)); ?>">
                                        <?= $this->escape(__('Ver', 'glpiintegaglpi')); ?>
                                    </a>
                                    <?php if ($canUpdate) : ?>
                                        <a class="small me-2" href="<?= $this->escape($this->getEditUrl($filters, $articleId)); ?>">
                                            <?= $this->escape(__('Editar', 'glpiintegaglpi')); ?>
                                        </a>
                                        <?php if ($status !== 'active') : ?>
                                            <form method="post" action="<?= $this->escape($this->getKnowledgeBaseUrl()); ?>" class="d-inline">
                                                <?= $this->renderCsrfToken(); ?>
                                                <input type="hidden" name="article_id" value="<?= $articleId; ?>">
                                                <input type="hidden" name="action" value="publish_article">
                                                <button type="submit" class="btn btn-link btn-sm p-0 me-2"><?= $this->escape(__('Publicar', 'glpiintegaglpi')); ?></button>
                                            </form>
                                        <?php endif; ?>
                                        <?php if ($status !== 'archived') : ?>
                                            <form method="post" action="<?= $this->escape($this->getKnowledgeBaseUrl()); ?>" class="d-inline">
                                                <?= $this->renderCsrfToken(); ?>
                                                <input type="hidden" name="article_id" value="<?= $articleId; ?>">
                                                <input type="hidden" name="action" value="archive_article">
                                                <button type="submit" class="btn btn-link btn-sm p-0"><?= $this->escape(__('Arquivar', 'glpiintegaglpi')); ?></button>
                                            </form>
                                        <?php endif; ?>
                                    <?php endif; ?>
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
            <a class="btn btn-outline-secondary btn-sm <?= $currentPage <= 1 ? 'disabled' : ''; ?>" href="<?= $this->escape($this->getKnowledgeBaseUrl() . '?' . http_build_query($prevQuery)); ?>">
                <?= $this->escape(__('Anterior', 'glpiintegaglpi')); ?>
            </a>
            <a class="btn btn-outline-secondary btn-sm <?= $currentPage >= $pages ? 'disabled' : ''; ?>" href="<?= $this->escape($this->getKnowledgeBaseUrl() . '?' . http_build_query($nextQuery)); ?>">
                <?= $this->escape(__('Próxima', 'glpiintegaglpi')); ?>
            </a>
        </div>
    </div>
</div>
