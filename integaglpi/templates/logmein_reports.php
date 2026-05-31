<?php

declare(strict_types=1);

use GlpiPlugin\Integaglpi\Plugin;

/** @var array<string, mixed> $report */
/** @var array{type:string,message:string}|null $flash */
/** @var string $csrfToken */

$filters = is_array($report['filters'] ?? null) ? $report['filters'] : [];
$entities = is_array($report['entity_options'] ?? null) ? $report['entity_options'] : [];
$kpis = is_array($report['kpis'] ?? null) ? $report['kpis'] : [];
$quality = is_array($report['quality'] ?? null) ? $report['quality'] : [];
$contracts = is_array($report['contracts'] ?? null) ? $report['contracts'] : [];
$rows = is_array($report['rows'] ?? null) ? $report['rows'] : [];
$pagination = is_array($report['pagination'] ?? null) ? $report['pagination'] : [];
$errors = is_array($report['errors'] ?? null) ? $report['errors'] : [];
$duplicatedTags = is_array($quality['duplicated_tags'] ?? null) ? $quality['duplicated_tags'] : [];
$groupsWithoutEntity = is_array($quality['groups_without_entity'] ?? null) ? $quality['groups_without_entity'] : [];

$escape = static fn (mixed $value): string => htmlspecialchars((string) $value, ENT_QUOTES, 'UTF-8');
$url = Plugin::getWebBasePath() . '/front/logmein.reports.php';
$query = [
    'entity_id' => (int) ($filters['entity_id'] ?? 0),
    'date_from' => (string) ($filters['date_from'] ?? ''),
    'date_to' => (string) ($filters['date_to'] ?? ''),
    'group_external_id' => (string) ($filters['group_external_id'] ?? ''),
    'report_type' => (string) ($filters['report_type'] ?? 'summary'),
    'limit' => (int) ($filters['limit'] ?? 25),
];
$pageUrl = static function (int $page) use ($url, $query): string {
    return $url . '?' . http_build_query(array_merge($query, ['page' => max(1, $page)]));
};
?>

<div class="container-fluid">
    <div class="d-flex align-items-center justify-content-between gap-3 mb-3">
        <div>
            <h2 class="mb-1"><?= $escape(__('Relatórios LogMeIn read-only', 'glpiintegaglpi')); ?></h2>
            <div class="text-muted">
                <?= $escape(__('Relatórios agregados por entidade/período. Sem ranking nominal de técnicos, sem sessão remota e sem mutação automática no GLPI.', 'glpiintegaglpi')); ?>
            </div>
        </div>
        <span class="badge bg-secondary"><?= $escape(__('Janela máxima: 31 dias', 'glpiintegaglpi')); ?></span>
    </div>

    <?php if ($flash !== null) { ?>
        <div class="alert alert-<?= $escape($flash['type'] ?? 'info'); ?>">
            <?= $escape($flash['message'] ?? ''); ?>
        </div>
    <?php } ?>

    <div class="alert alert-info">
        <?= $escape(__('Fonte: cache local LogMeIn, mapeamento grupo→entidade e contratos/horas já existentes. Exportações são CSV sanitizado e auditadas.', 'glpiintegaglpi')); ?>
    </div>

    <div class="card mb-3">
        <div class="card-header"><?= $escape(__('Filtros obrigatórios', 'glpiintegaglpi')); ?></div>
        <div class="card-body">
            <form method="get" action="<?= $escape($url); ?>">
                <div class="row g-3">
                    <div class="col-md-3">
                        <label class="form-label" for="logmein-report-entity"><?= $escape(__('Entidade', 'glpiintegaglpi')); ?></label>
                        <select class="form-select" id="logmein-report-entity" name="entity_id" required>
                            <option value="0"><?= $escape(__('Selecione uma entidade', 'glpiintegaglpi')); ?></option>
                            <?php foreach ($entities as $entity) {
                                $entityId = (int) ($entity['id'] ?? 0);
                                if ($entityId <= 0) {
                                    continue;
                                }
                                ?>
                                <option value="<?= $entityId; ?>" <?= ((int) ($filters['entity_id'] ?? 0) === $entityId) ? 'selected' : ''; ?>>
                                    <?= $escape($entity['name'] ?? ('#' . $entityId)); ?>
                                </option>
                            <?php } ?>
                        </select>
                    </div>
                    <div class="col-md-2">
                        <label class="form-label" for="logmein-report-from"><?= $escape(__('De', 'glpiintegaglpi')); ?></label>
                        <input class="form-control" id="logmein-report-from" type="date" name="date_from" value="<?= $escape($filters['date_from'] ?? ''); ?>" required>
                    </div>
                    <div class="col-md-2">
                        <label class="form-label" for="logmein-report-to"><?= $escape(__('Até', 'glpiintegaglpi')); ?></label>
                        <input class="form-control" id="logmein-report-to" type="date" name="date_to" value="<?= $escape($filters['date_to'] ?? ''); ?>" required>
                    </div>
                    <div class="col-md-2">
                        <label class="form-label" for="logmein-report-type"><?= $escape(__('Tipo', 'glpiintegaglpi')); ?></label>
                        <select class="form-select" id="logmein-report-type" name="report_type">
                            <?php foreach (['summary' => 'Resumo', 'quality' => 'Qualidade cadastral', 'contracts' => 'Contratos/horas', 'ticket_evidence' => 'Evidências'] as $value => $label) { ?>
                                <option value="<?= $escape($value); ?>" <?= ((string) ($filters['report_type'] ?? '') === $value) ? 'selected' : ''; ?>>
                                    <?= $escape(__($label, 'glpiintegaglpi')); ?>
                                </option>
                            <?php } ?>
                        </select>
                    </div>
                    <div class="col-md-1">
                        <label class="form-label" for="logmein-report-limit"><?= $escape(__('Limite', 'glpiintegaglpi')); ?></label>
                        <select class="form-select" id="logmein-report-limit" name="limit">
                            <?php foreach ([10, 25, 50] as $limit) { ?>
                                <option value="<?= $limit; ?>" <?= ((int) ($filters['limit'] ?? 25) === $limit) ? 'selected' : ''; ?>><?= $limit; ?></option>
                            <?php } ?>
                        </select>
                    </div>
                    <div class="col-md-2 d-flex align-items-end gap-2">
                        <button class="btn btn-primary" type="submit"><?= $escape(__('Aplicar', 'glpiintegaglpi')); ?></button>
                        <a class="btn btn-outline-secondary" href="<?= $escape($url); ?>"><?= $escape(__('Limpar', 'glpiintegaglpi')); ?></a>
                    </div>
                </div>
            </form>

            <?php if ((string) ($report['status'] ?? '') === 'available') { ?>
                <form method="post" action="<?= $escape($url); ?>" class="mt-3">
                    <input type="hidden" name="_glpi_csrf_token" value="<?= $escape($csrfToken); ?>">
                    <input type="hidden" name="action" value="export_csv">
                    <?php foreach ($query as $key => $value) { ?>
                        <input type="hidden" name="<?= $escape($key); ?>" value="<?= $escape($value); ?>">
                    <?php } ?>
                    <button class="btn btn-outline-primary" type="submit">
                        <?= $escape(__('Exportar CSV sanitizado', 'glpiintegaglpi')); ?>
                    </button>
                    <span class="text-muted ms-2"><?= $escape(__('Exporta no máximo 50 linhas da consulta atual e gera auditoria.', 'glpiintegaglpi')); ?></span>
                </form>
            <?php } ?>
        </div>
    </div>

    <?php foreach ($errors as $error) { ?>
        <div class="alert alert-warning"><?= $escape($error); ?></div>
    <?php } ?>

    <?php if ((string) ($report['status'] ?? '') === 'available') { ?>
        <div class="row g-3 mb-3">
            <?php foreach ([
                'hosts_total' => 'Hosts no período',
                'groups_total' => 'Grupos',
                'hosts_without_tag' => 'Hosts sem etiqueta',
                'invalid_tags' => 'Etiquetas inválidas',
                'duplicated_tags' => 'Etiquetas duplicadas',
                'linked_tickets' => 'Tickets vinculados',
                'hosts_without_ticket' => 'Equipamentos sem ticket',
                'divergences' => 'Divergências entidade',
                'entities_without_group' => 'Entidade sem grupo',
            ] as $key => $label) { ?>
                <div class="col-md-3 col-xl-2">
                    <div class="border rounded p-3 h-100">
                        <div class="text-muted small"><?= $escape(__($label, 'glpiintegaglpi')); ?></div>
                        <strong><?= (int) ($kpis[$key] ?? 0); ?></strong>
                    </div>
                </div>
            <?php } ?>
        </div>

        <div class="card mb-3">
            <div class="card-header"><?= $escape(__('Contratos e banco de horas', 'glpiintegaglpi')); ?></div>
            <div class="card-body">
                <div class="row g-3">
                    <div class="col-md-3"><strong><?= number_format((float) ($contracts['allocated_hours'] ?? 0), 2, ',', '.'); ?>h</strong><div class="text-muted small"><?= $escape(__('Horas contratadas', 'glpiintegaglpi')); ?></div></div>
                    <div class="col-md-3"><strong><?= number_format((float) ($contracts['consumed_hours'] ?? 0), 2, ',', '.'); ?>h</strong><div class="text-muted small"><?= $escape(__('Horas consumidas auditadas', 'glpiintegaglpi')); ?></div></div>
                    <div class="col-md-3"><strong><?= number_format((float) ($contracts['balance_hours'] ?? 0), 2, ',', '.'); ?>h</strong><div class="text-muted small"><?= $escape(__('Saldo informativo', 'glpiintegaglpi')); ?></div></div>
                    <div class="col-md-3"><strong><?= (int) ($contracts['contract_rows'] ?? 0); ?></strong><div class="text-muted small"><?= $escape(__('Contratos ativos', 'glpiintegaglpi')); ?></div></div>
                </div>
                <div class="form-text mt-2">
                    <?= $escape(__('Comparação consultiva: não fatura automaticamente e não bloqueia atendimento.', 'glpiintegaglpi')); ?>
                </div>
            </div>
        </div>

        <div class="row g-3 mb-3">
            <div class="col-lg-6">
                <div class="card h-100">
                    <div class="card-header"><?= $escape(__('Etiquetas duplicadas', 'glpiintegaglpi')); ?></div>
                    <div class="card-body">
                        <?php if ($duplicatedTags === []) { ?>
                            <div class="text-muted"><?= $escape(__('Nenhuma duplicidade encontrada no filtro atual.', 'glpiintegaglpi')); ?></div>
                        <?php } else { ?>
                            <ul class="mb-0">
                                <?php foreach ($duplicatedTags as $tag) { ?>
                                    <li><?= $escape($tag['equipment_tag'] ?? ''); ?> — <?= (int) ($tag['hosts_count'] ?? 0); ?> <?= $escape(__('hosts', 'glpiintegaglpi')); ?></li>
                                <?php } ?>
                            </ul>
                        <?php } ?>
                    </div>
                </div>
            </div>
            <div class="col-lg-6">
                <div class="card h-100">
                    <div class="card-header"><?= $escape(__('Grupos sem entidade', 'glpiintegaglpi')); ?></div>
                    <div class="card-body">
                        <?php if ($groupsWithoutEntity === []) { ?>
                            <div class="text-muted"><?= $escape(__('Nenhum grupo sem mapeamento ativo no cache local.', 'glpiintegaglpi')); ?></div>
                        <?php } else { ?>
                            <ul class="mb-0">
                                <?php foreach ($groupsWithoutEntity as $group) { ?>
                                    <li><?= $escape($group['group_name'] ?? ''); ?> — <?= (int) ($group['hosts_count'] ?? 0); ?> <?= $escape(__('hosts', 'glpiintegaglpi')); ?></li>
                                <?php } ?>
                            </ul>
                        <?php } ?>
                    </div>
                </div>
            </div>
        </div>

        <div class="card">
            <div class="card-header d-flex justify-content-between">
                <span><?= $escape(__('Evidências operacionais read-only', 'glpiintegaglpi')); ?></span>
                <span class="text-muted small"><?= (int) ($pagination['total'] ?? 0); ?> <?= $escape(__('registro(s)', 'glpiintegaglpi')); ?></span>
            </div>
            <div class="card-body p-0">
                <?php if ($rows === []) { ?>
                    <div class="p-3 text-muted"><?= $escape(__('Sem evidências para os filtros selecionados.', 'glpiintegaglpi')); ?></div>
                <?php } else { ?>
                    <div class="table-responsive">
                        <table class="table table-sm table-hover mb-0">
                            <thead class="table-light">
                                <tr>
                                    <th><?= $escape(__('Host', 'glpiintegaglpi')); ?></th>
                                    <th><?= $escape(__('Grupo', 'glpiintegaglpi')); ?></th>
                                    <th><?= $escape(__('Etiqueta', 'glpiintegaglpi')); ?></th>
                                    <th><?= $escape(__('Status', 'glpiintegaglpi')); ?></th>
                                    <th><?= $escape(__('Ticket', 'glpiintegaglpi')); ?></th>
                                    <th><?= $escape(__('Última evidência', 'glpiintegaglpi')); ?></th>
                                    <th><?= $escape(__('Origem', 'glpiintegaglpi')); ?></th>
                                </tr>
                            </thead>
                            <tbody>
                                <?php foreach ($rows as $row) {
                                    $ticketId = (int) ($row['ticket_id'] ?? 0);
                                    ?>
                                    <tr>
                                        <td><?= $escape($row['host_name'] ?? ''); ?></td>
                                        <td><?= $escape($row['group_name'] ?? ''); ?></td>
                                        <td><?= $escape(($row['equipment_tag'] ?? '') !== '' ? $row['equipment_tag'] : ($row['tag_status'] ?? 'missing')); ?></td>
                                        <td><?= $escape($row['status'] ?? 'unknown'); ?></td>
                                        <td>
                                            <?php if ($ticketId > 0) { ?>
                                                <a href="<?= $escape(Plugin::getTicketUrl($ticketId)); ?>" target="_blank" rel="noopener noreferrer">#<?= $ticketId; ?></a>
                                            <?php } else { ?>
                                                -
                                            <?php } ?>
                                        </td>
                                        <td><?= $escape($row['last_evidence_at'] ?? ''); ?></td>
                                        <td><?= $escape($row['evidence_source'] ?? 'logmein_cache_readonly'); ?></td>
                                    </tr>
                                <?php } ?>
                            </tbody>
                        </table>
                    </div>
                <?php } ?>
            </div>
            <div class="card-footer d-flex justify-content-between">
                <?php if (!empty($pagination['has_previous'])) { ?>
                    <a href="<?= $escape($pageUrl(((int) ($pagination['page'] ?? 1)) - 1)); ?>">&laquo; <?= $escape(__('Anterior', 'glpiintegaglpi')); ?></a>
                <?php } else { ?>
                    <span></span>
                <?php } ?>
                <?php if (!empty($pagination['has_next'])) { ?>
                    <a href="<?= $escape($pageUrl(((int) ($pagination['page'] ?? 1)) + 1)); ?>"><?= $escape(__('Próxima', 'glpiintegaglpi')); ?> &raquo;</a>
                <?php } ?>
            </div>
        </div>
    <?php } ?>
</div>
