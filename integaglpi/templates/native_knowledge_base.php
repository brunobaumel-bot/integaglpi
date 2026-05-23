<?php

declare(strict_types=1);

/** @var \GlpiPlugin\Integaglpi\Renderer\NativeKnowledgeBaseRenderer $this */
/** @var string $search */
/** @var array<int, array<string, mixed>> $articles */
?>

<div class="d-flex align-items-center justify-content-between gap-3 mb-3">
    <div>
        <h2 class="mb-1"><?= $this->escape(__('Base de Conhecimento GLPI', 'glpiintegaglpi')); ?></h2>
        <div class="text-muted">
            <?= $this->escape(__('Consulta read-only à Base de Conhecimento nativa do GLPI. Sem IA, RAG, embeddings ou envio ao cliente nesta fase.', 'glpiintegaglpi')); ?>
        </div>
    </div>
    <span class="badge bg-secondary"><?= $this->escape(__('Read-only', 'glpiintegaglpi')); ?></span>
</div>

<div class="card mb-3">
    <div class="card-header"><?= $this->escape(__('Busca simples', 'glpiintegaglpi')); ?></div>
    <div class="card-body">
        <form method="get" action="<?= $this->escape($this->getNativeKnowledgeBaseUrl()); ?>">
            <div class="row g-2 align-items-end">
                <div class="col-md-9">
                    <label class="form-label"><?= $this->escape(__('Texto', 'glpiintegaglpi')); ?></label>
                    <input class="form-control" type="search" name="q" value="<?= $this->escape($search); ?>" maxlength="120">
                </div>
                <div class="col-md-3">
                    <button type="submit" class="btn btn-primary w-100"><?= $this->escape(__('Buscar', 'glpiintegaglpi')); ?></button>
                </div>
            </div>
        </form>
    </div>
</div>

<div class="alert alert-info">
    <?= $this->escape(__('Fonte oficial: Base de Conhecimento GLPI. O IntegraGLPI apenas consulta artigos visíveis ao usuário logado e não escreve na base nativa.', 'glpiintegaglpi')); ?>
</div>

<?php if ($articles === []) : ?>
    <div class="alert alert-warning">
        <?= $this->escape(__('Nenhum artigo visível encontrado para esta busca.', 'glpiintegaglpi')); ?>
    </div>
<?php else : ?>
    <div class="list-group">
        <?php foreach ($articles as $article) : ?>
            <div class="list-group-item">
                <div class="d-flex justify-content-between gap-3">
                    <div>
                        <h3 class="h5 mb-1"><?= $this->escape((string) ($article['title'] ?? '')); ?></h3>
                        <div class="text-muted small mb-2">
                            <?= $this->escape((string) ($article['source_label'] ?? 'Base de Conhecimento GLPI')); ?>
                            <?php if (trim((string) ($article['category'] ?? '')) !== '') : ?>
                                · <?= $this->escape((string) ($article['category'] ?? '')); ?>
                            <?php endif; ?>
                        </div>
                        <p class="mb-2"><?= $this->escape((string) ($article['excerpt'] ?? '')); ?></p>
                        <div class="text-muted small">
                            <?= $this->escape((string) ($article['relevance_reason'] ?? 'Artigo visível ao usuário')); ?>
                        </div>
                    </div>
                    <div class="text-nowrap">
                        <a class="btn btn-outline-secondary btn-sm" href="<?= $this->escape((string) ($article['internal_url'] ?? '#')); ?>">
                            <?= $this->escape(__('Abrir no GLPI', 'glpiintegaglpi')); ?>
                        </a>
                    </div>
                </div>
            </div>
        <?php endforeach; ?>
    </div>
<?php endif; ?>
