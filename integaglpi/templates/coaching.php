<?php

declare(strict_types=1);

/**
 * @var GlpiPlugin\Integaglpi\Renderer\CoachingRenderer $this
 * @var array<string, mixed> $data
 */

$filters = is_array($data['filters'] ?? null) ? $data['filters'] : [];
$summary = is_array($data['summary'] ?? null) ? $data['summary'] : [];
$recommendations = is_array($data['recommendations'] ?? null) ? $data['recommendations'] : [];
$pagination = is_array($data['pagination'] ?? null) ? $data['pagination'] : [];
$csrf = GlpiPlugin\Integaglpi\Plugin::getCsrfToken();

$typeLabels = [
    '' => __('Todos', 'glpiintegaglpi'),
    'onboarding_plan' => __('Plano de onboarding', 'glpiintegaglpi'),
    'training_path' => __('Trilha de estudo', 'glpiintegaglpi'),
    'kb_study_suggestion' => __('Estudo de KB', 'glpiintegaglpi'),
    'communication_skill' => __('Comunicação', 'glpiintegaglpi'),
    'coaching_session_tip' => __('Coaching', 'glpiintegaglpi'),
    'kb_review_recommendation' => __('Revisão de KB', 'glpiintegaglpi'),
    'process_improvement' => __('Processo', 'glpiintegaglpi'),
    'data_quality_warning' => __('Qualidade dos dados', 'glpiintegaglpi'),
];
$statusLabels = [
    '' => __('Todos', 'glpiintegaglpi'),
    'active' => __('Ativas', 'glpiintegaglpi'),
    'dismissed' => __('Descartadas', 'glpiintegaglpi'),
    'archived' => __('Arquivadas', 'glpiintegaglpi'),
];
$scopeLabels = [
    '' => __('Todos', 'glpiintegaglpi'),
    'team' => __('Equipe', 'glpiintegaglpi'),
    'queue' => __('Fila', 'glpiintegaglpi'),
    'category' => __('Categoria', 'glpiintegaglpi'),
    'technician_private' => __('Técnico privado', 'glpiintegaglpi'),
    'entity' => __('Entidade', 'glpiintegaglpi'),
];
?>

<div class="container-fluid plugin-integaglpi-coaching">
    <div class="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-3">
        <div>
            <h1 class="h3 mb-1"><?php echo $this->escape(__('Coaching e Onboarding IA', 'glpiintegaglpi')); ?></h1>
            <p class="text-muted mb-0">
                <?php echo $this->escape(__('Visao agregada para melhoria continua, trilhas de estudo e curadoria humana.', 'glpiintegaglpi')); ?>
            </p>
        </div>
        <a class="btn btn-outline-secondary" href="<?php echo $this->escape($this->getKbCandidatesUrl()); ?>">
            <?php echo $this->escape(__('Abrir candidatos de KB', 'glpiintegaglpi')); ?>
        </a>
    </div>

    <div class="alert alert-warning" role="alert">
        <?php echo $this->escape(__('Indicadores de IA para coaching e melhoria contínua. Não usar como avaliação disciplinar automática. Sem ranking.', 'glpiintegaglpi')); ?>
    </div>

    <?php if ((string) ($data['error'] ?? '') !== '') { ?>
        <div class="alert alert-info" role="alert">
            <?php echo $this->escape((string) $data['error']); ?>
        </div>
    <?php } ?>

    <form method="get" action="<?php echo $this->escape($this->getCoachingUrl()); ?>" class="card mb-3">
        <div class="card-body">
            <div class="row g-2">
                <div class="col-sm-6 col-lg-2">
                    <label class="form-label" for="date_from"><?php echo $this->escape(__('Inicio', 'glpiintegaglpi')); ?></label>
                    <input class="form-control" type="date" id="date_from" name="date_from" value="<?php echo $this->escape((string) ($filters['date_from'] ?? '')); ?>">
                </div>
                <div class="col-sm-6 col-lg-2">
                    <label class="form-label" for="date_to"><?php echo $this->escape(__('Fim', 'glpiintegaglpi')); ?></label>
                    <input class="form-control" type="date" id="date_to" name="date_to" value="<?php echo $this->escape((string) ($filters['date_to'] ?? '')); ?>">
                </div>
                <div class="col-sm-6 col-lg-2">
                    <label class="form-label" for="status"><?php echo $this->escape(__('Status', 'glpiintegaglpi')); ?></label>
                    <select class="form-select" id="status" name="status">
                        <?php foreach ($statusLabels as $value => $label) { ?>
                            <option value="<?php echo $this->escape($value); ?>" <?php echo (string) ($filters['status'] ?? '') === $value ? 'selected' : ''; ?>>
                                <?php echo $this->escape($label); ?>
                            </option>
                        <?php } ?>
                    </select>
                </div>
                <div class="col-sm-6 col-lg-2">
                    <label class="form-label" for="type"><?php echo $this->escape(__('Tipo', 'glpiintegaglpi')); ?></label>
                    <select class="form-select" id="type" name="type">
                        <?php foreach ($typeLabels as $value => $label) { ?>
                            <option value="<?php echo $this->escape($value); ?>" <?php echo (string) ($filters['type'] ?? '') === $value ? 'selected' : ''; ?>>
                                <?php echo $this->escape($label); ?>
                            </option>
                        <?php } ?>
                    </select>
                </div>
                <div class="col-sm-6 col-lg-2">
                    <label class="form-label" for="scope_type"><?php echo $this->escape(__('Escopo', 'glpiintegaglpi')); ?></label>
                    <select class="form-select" id="scope_type" name="scope_type">
                        <?php foreach ($scopeLabels as $value => $label) { ?>
                            <option value="<?php echo $this->escape($value); ?>" <?php echo (string) ($filters['scope_type'] ?? '') === $value ? 'selected' : ''; ?>>
                                <?php echo $this->escape($label); ?>
                            </option>
                        <?php } ?>
                    </select>
                </div>
                <div class="col-sm-6 col-lg-2">
                    <label class="form-label" for="entity_id"><?php echo $this->escape(__('Entidade', 'glpiintegaglpi')); ?></label>
                    <input class="form-control" type="number" min="0" id="entity_id" name="entity_id" value="<?php echo $this->escape((string) ($filters['entity_id'] ?? '0')); ?>">
                </div>
            </div>
            <div class="mt-3 d-flex gap-2">
                <button class="btn btn-primary" type="submit"><?php echo $this->escape(__('Filtrar', 'glpiintegaglpi')); ?></button>
                <a class="btn btn-outline-secondary" href="<?php echo $this->escape($this->getCoachingUrl()); ?>"><?php echo $this->escape(__('Limpar', 'glpiintegaglpi')); ?></a>
            </div>
        </div>
    </form>

    <div class="row g-3 mb-3">
        <?php
        $cards = [
            __('Recomendações', 'glpiintegaglpi') => (int) ($summary['total'] ?? 0),
            __('Ativas', 'glpiintegaglpi') => (int) ($summary['active'] ?? 0),
            __('Comunicação', 'glpiintegaglpi') => (int) ($summary['communication'] ?? 0),
            __('KB e curadoria', 'glpiintegaglpi') => (int) ($summary['kb'] ?? 0),
            __('Dados insuficientes', 'glpiintegaglpi') => (int) ($summary['data_quality'] ?? 0),
        ];
        foreach ($cards as $label => $value) { ?>
            <div class="col-sm-6 col-xl">
                <div class="card h-100">
                    <div class="card-body">
                        <div class="text-muted small"><?php echo $this->escape((string) $label); ?></div>
                        <div class="display-6"><?php echo $this->escape((string) $value); ?></div>
                    </div>
                </div>
            </div>
        <?php } ?>
    </div>

    <?php if ($recommendations === []) { ?>
        <div class="card">
            <div class="card-body text-muted">
                <?php echo $this->escape(__('Nenhuma recomendação ativa para os filtros atuais. A geração batch pode ser executada depois que houver dados agregados suficientes.', 'glpiintegaglpi')); ?>
            </div>
        </div>
    <?php } ?>

    <div class="row g-3">
        <?php foreach ($recommendations as $recommendation) {
            if (!is_array($recommendation)) {
                continue;
            }
            $plan = is_array($recommendation['onboarding_plan'] ?? null) ? $recommendation['onboarding_plan'] : [];
            $kbArticles = is_array($recommendation['kb_articles'] ?? null) ? $recommendation['kb_articles'] : [];
            $actions = is_array($recommendation['suggested_actions'] ?? null) ? $recommendation['suggested_actions'] : [];
            ?>
            <div class="col-12">
                <div class="card">
                    <div class="card-header d-flex flex-wrap justify-content-between gap-2">
                        <div>
                            <strong><?php echo $this->escape((string) ($recommendation['title'] ?? '')); ?></strong>
                            <div class="text-muted small">
                                <?php echo $this->escape((string) ($typeLabels[(string) ($recommendation['recommendation_type'] ?? '')] ?? $recommendation['recommendation_type'] ?? '')); ?>
                                · <?php echo $this->escape((string) ($scopeLabels[(string) ($recommendation['scope_type'] ?? '')] ?? $recommendation['scope_type'] ?? '')); ?>
                                · <?php echo $this->escape(__('Confiança', 'glpiintegaglpi')); ?> <?php echo $this->escape((string) ($recommendation['confidence_score'] ?? 0)); ?>%
                            </div>
                        </div>
                        <span class="badge bg-secondary"><?php echo $this->escape((string) ($recommendation['status'] ?? '')); ?></span>
                    </div>
                    <div class="card-body">
                        <p><?php echo $this->escape((string) ($recommendation['summary'] ?? '')); ?></p>
                        <p class="text-muted"><?php echo $this->escape((string) ($recommendation['explanation'] ?? '')); ?></p>

                        <?php if ($actions !== []) { ?>
                            <h3 class="h6"><?php echo $this->escape(__('Ações humanas sugeridas', 'glpiintegaglpi')); ?></h3>
                            <ul>
                                <?php foreach ($actions as $action) { ?>
                                    <li><?php echo $this->escape((string) $action); ?></li>
                                <?php } ?>
                            </ul>
                        <?php } ?>

                        <h3 class="h6"><?php echo $this->escape(__('Plano 7/15/30 dias', 'glpiintegaglpi')); ?></h3>
                        <div class="row g-2">
                            <?php foreach (['day7' => '7 dias', 'day15' => '15 dias', 'day30' => '30 dias'] as $key => $label) { ?>
                                <div class="col-md-4">
                                    <div class="border rounded p-2 h-100">
                                        <strong><?php echo $this->escape($label); ?></strong>
                                        <ul class="mb-0">
                                            <?php foreach ((array) ($plan[$key] ?? []) as $item) { ?>
                                                <li><?php echo $this->escape((string) $item); ?></li>
                                            <?php } ?>
                                        </ul>
                                    </div>
                                </div>
                            <?php } ?>
                        </div>

                        <?php if ($kbArticles !== []) { ?>
                            <h3 class="h6 mt-3"><?php echo $this->escape(__('Artigos KB sugeridos', 'glpiintegaglpi')); ?></h3>
                            <ul>
                                <?php foreach ($kbArticles as $article) {
                                    if (!is_array($article)) {
                                        continue;
                                    }
                                    $url = (string) ($article['internal_url'] ?? '');
                                    ?>
                                    <li>
                                        <?php if ($url !== '') { ?>
                                            <a href="<?php echo $this->escape($url); ?>"><?php echo $this->escape((string) ($article['title'] ?? '')); ?></a>
                                        <?php } else { ?>
                                            <?php echo $this->escape((string) ($article['title'] ?? '')); ?>
                                        <?php } ?>
                                        <span class="text-muted"><?php echo $this->escape((string) ($article['category'] ?? '')); ?></span>
                                    </li>
                                <?php } ?>
                            </ul>
                        <?php } ?>

                        <textarea class="form-control mt-3" rows="5" readonly><?php
                            echo $this->escape(implode("\n", array_merge(
                                (array) ($plan['day7'] ?? []),
                                (array) ($plan['day15'] ?? []),
                                (array) ($plan['day30'] ?? [])
                            )));
                        ?></textarea>
                    </div>
                    <div class="card-footer d-flex flex-wrap gap-2">
                        <form method="post" action="<?php echo $this->escape($this->getCoachingUrl()); ?>" class="d-flex flex-wrap gap-2 align-items-center">
                            <input type="hidden" name="_glpi_csrf_token" value="<?php echo $this->escape($csrf); ?>">
                            <input type="hidden" name="action" value="feedback">
                            <input type="hidden" name="recommendation_id" value="<?php echo $this->escape((string) ($recommendation['recommendation_id'] ?? '')); ?>">
                            <select class="form-select form-select-sm" name="rating" aria-label="<?php echo $this->escape(__('Feedback', 'glpiintegaglpi')); ?>">
                                <option value="useful"><?php echo $this->escape(__('Útil', 'glpiintegaglpi')); ?></option>
                                <option value="not_useful"><?php echo $this->escape(__('Não útil', 'glpiintegaglpi')); ?></option>
                                <option value="not_applicable"><?php echo $this->escape(__('Não aplicável', 'glpiintegaglpi')); ?></option>
                            </select>
                            <input class="form-control form-control-sm" type="text" name="notes" maxlength="500" placeholder="<?php echo $this->escape(__('Comentário opcional', 'glpiintegaglpi')); ?>">
                            <button class="btn btn-sm btn-outline-primary" type="submit"><?php echo $this->escape(__('Salvar feedback', 'glpiintegaglpi')); ?></button>
                        </form>
                        <?php if ((string) ($recommendation['status'] ?? '') === 'active') { ?>
                            <form method="post" action="<?php echo $this->escape($this->getCoachingUrl()); ?>">
                                <input type="hidden" name="_glpi_csrf_token" value="<?php echo $this->escape($csrf); ?>">
                                <input type="hidden" name="action" value="dismiss">
                                <input type="hidden" name="recommendation_id" value="<?php echo $this->escape((string) ($recommendation['recommendation_id'] ?? '')); ?>">
                                <button class="btn btn-sm btn-outline-secondary" type="submit"><?php echo $this->escape(__('Descartar recomendação', 'glpiintegaglpi')); ?></button>
                            </form>
                        <?php } ?>
                    </div>
                </div>
            </div>
        <?php } ?>
    </div>

    <div class="mt-3 text-muted small">
        <?php
        echo $this->escape(sprintf(
            __('Página %d de %d. Período máximo aplicado: 90 dias.', 'glpiintegaglpi'),
            (int) ($pagination['page'] ?? 1),
            (int) ($pagination['total_pages'] ?? 1)
        ));
        ?>
    </div>
</div>
