<?php

declare(strict_types=1);

/**
 * @var GlpiPlugin\Integaglpi\Renderer\AiOperationsRenderer $this
 * @var array<string, mixed> $data
 */

$links = is_array($data['links'] ?? null) ? $data['links'] : [];
?>

<div class="container-fluid plugin-integaglpi-ai-operations">
    <div class="d-flex flex-wrap justify-content-between align-items-start gap-2 mb-3">
        <div>
            <h1 class="h3 mb-1"><?= $this->escape(__('IA & Conhecimento', 'glpiintegaglpi')); ?></h1>
            <p class="text-muted mb-0">
                <?= $this->escape(__('Console operacional para configurar, monitorar e acionar fluxos IA/KBI com revisão humana.', 'glpiintegaglpi')); ?>
            </p>
        </div>
        <span class="badge bg-secondary"><?= $this->escape(__('sem ação automática', 'glpiintegaglpi')); ?></span>
    </div>

    <div class="alert alert-warning">
        <?= $this->escape(__('IA sugere, humano decide. Esta área não envia WhatsApp, não altera ticket e não publica artigo automaticamente.', 'glpiintegaglpi')); ?>
    </div>

    <div class="row g-3">
        <?php foreach ($links as $link) {
            if (!is_array($link)) {
                continue;
            }
            ?>
            <div class="col-md-6 col-xl-4">
                <div class="card h-100">
                    <div class="card-body d-flex flex-column">
                        <div class="d-flex justify-content-between align-items-start gap-2">
                            <h2 class="h5 mb-2"><?= $this->escape((string) ($link['title'] ?? '')); ?></h2>
                            <span class="badge bg-light text-dark border"><?= $this->escape((string) ($link['badge'] ?? '')); ?></span>
                        </div>
                        <p class="text-muted flex-grow-1"><?= $this->escape((string) ($link['description'] ?? '')); ?></p>
                        <a class="btn btn-outline-primary" href="<?= $this->escape((string) ($link['url'] ?? '#')); ?>">
                            <?= $this->escape(__('Abrir', 'glpiintegaglpi')); ?>
                        </a>
                    </div>
                </div>
            </div>
        <?php } ?>
    </div>
</div>
