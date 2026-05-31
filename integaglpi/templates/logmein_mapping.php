<?php

declare(strict_types=1);

use GlpiPlugin\Integaglpi\Plugin;

/** @var array{type:string,message:string}|null $flash */
/** @var list<array<string, mixed>> $mappings */
/** @var list<array<string, mixed>> $cachedGroups */
/** @var list<array{id:int,name:string}> $entityOptions */
/** @var list<array<string, mixed>> $hostPreview */
/** @var array<string, mixed>|null $lastSyncStatus */
/** @var array{groups_count:int,hosts_count:int,last_cache_update:string} $cacheSummary */
/** @var array<string, mixed> $inventoryQualityReport */
/** @var array<string, mixed> $healthSummary */
/** @var string $selectedGroupId */
/** @var bool $featureEnabled */

$csrfToken = Plugin::getCsrfToken();
$duplicatedTags = is_array($inventoryQualityReport['duplicated_tags'] ?? null) ? $inventoryQualityReport['duplicated_tags'] : [];
$groupsWithoutEntity = is_array($inventoryQualityReport['groups_without_entity'] ?? null) ? $inventoryQualityReport['groups_without_entity'] : [];

// Health summary helpers.
$hStatus        = (string) ($healthSummary['status'] ?? 'unavailable');
$hAlerts        = is_array($healthSummary['alerts'] ?? null) ? $healthSummary['alerts'] : [];
$hTagPct        = isset($healthSummary['tag_coverage_percent']) ? (int) $healthSummary['tag_coverage_percent'] : null;
$hCacheAge      = isset($healthSummary['cache_age_hours']) ? (float) $healthSummary['cache_age_hours'] : null;
$hLastSyncAt    = (string) ($healthSummary['last_sync_timestamp'] ?? '');
$hLastSyncSt    = (string) ($healthSummary['last_sync_status'] ?? '');
$hDurationMs    = isset($healthSummary['last_sync_duration_ms']) ? (int) $healthSummary['last_sync_duration_ms'] : null;
$hConsecFail    = (int) ($healthSummary['consecutive_failures'] ?? 0);
$hSyncError     = isset($healthSummary['last_sync_error']) ? (string) $healthSummary['last_sync_error'] : null;
$hStatusClass   = match($hStatus) {
    'ok'       => 'success',
    'warning'  => 'warning',
    'critical' => 'danger',
    default    => 'secondary',
};
?>

<div class="container-fluid">

    <?php
    /* ── Health summary card ───────────────────────────────────────────────── */
    ?>
    <div class="card mb-3 border-<?= htmlspecialchars($hStatusClass, ENT_QUOTES, 'UTF-8'); ?>">
        <div class="card-header d-flex align-items-center justify-content-between">
            <strong><?= __('Saúde do cache LogMeIn', 'glpiintegaglpi'); ?></strong>
            <span class="badge bg-<?= htmlspecialchars($hStatusClass, ENT_QUOTES, 'UTF-8'); ?>">
                <?= htmlspecialchars(strtoupper($hStatus !== '' ? $hStatus : 'unavailable'), ENT_QUOTES, 'UTF-8'); ?>
            </span>
        </div>
        <div class="card-body">

            <?php /* Visual alert banners — UI only, no WhatsApp/email/ticket. */ ?>

            <?php if (!empty($hAlerts['sync_failing'])) { ?>
                <div class="alert alert-danger d-flex align-items-center gap-2 py-2 mb-2">
                    <i class="ti ti-alert-triangle"></i>
                    <?= sprintf(
                        htmlspecialchars(__('Sync LogMeIn falhou %d vezes consecutivas. Verifique credenciais e conectividade.', 'glpiintegaglpi'), ENT_QUOTES, 'UTF-8'),
                        $hConsecFail
                    ); ?>
                    <?php if ($hSyncError !== null && $hSyncError !== '') { ?>
                        <code class="ms-2 small"><?= htmlspecialchars($hSyncError, ENT_QUOTES, 'UTF-8'); ?></code>
                    <?php } ?>
                </div>
            <?php } ?>

            <?php if (!empty($hAlerts['cache_stale'])) { ?>
                <?php $cacheAlertClass = ($hCacheAge !== null && $hCacheAge > 48.0) ? 'danger' : 'warning'; ?>
                <div class="alert alert-<?= $cacheAlertClass; ?> d-flex align-items-center gap-2 py-2 mb-2">
                    <i class="ti ti-clock-exclamation"></i>
                    <?= sprintf(
                        htmlspecialchars(__('Cache LogMeIn com %.1f horas de idade (limite aviso: 24 h, crítico: 48 h). Execute sync manual.', 'glpiintegaglpi'), ENT_QUOTES, 'UTF-8'),
                        (float) ($hCacheAge ?? 0)
                    ); ?>
                </div>
            <?php } ?>

            <?php if (!empty($hAlerts['low_tag_coverage'])) { ?>
                <div class="alert alert-warning d-flex align-items-center gap-2 py-2 mb-2">
                    <i class="ti ti-tag-off"></i>
                    <?= sprintf(
                        htmlspecialchars(__('Cobertura de etiquetas: %d%% (limiar mínimo: 85%%). Verifique etiquetas inválidas ou ausentes.', 'glpiintegaglpi'), ENT_QUOTES, 'UTF-8'),
                        (int) ($hTagPct ?? 0)
                    ); ?>
                </div>
            <?php } ?>

            <?php if (!empty($hAlerts['groups_without_entity'])) { ?>
                <div class="alert alert-warning d-flex align-items-center gap-2 py-2 mb-2">
                    <i class="ti ti-building-off"></i>
                    <?= htmlspecialchars(__('Há grupos LogMeIn sem entidade GLPI mapeada. Adicione mapeamentos abaixo.', 'glpiintegaglpi'), ENT_QUOTES, 'UTF-8'); ?>
                </div>
            <?php } ?>

            <?php /* Metric grid */ ?>
            <div class="row g-2">
                <?php
                $metrics = [
                    ['label' => 'Hosts no cache', 'value' => (int) ($healthSummary['total_hosts'] ?? 0), 'extra' => ''],
                    ['label' => 'Etiquetas válidas', 'value' => (int) ($healthSummary['tags_valid'] ?? 0), 'extra' => $hTagPct !== null ? " ({$hTagPct}%)" : ''],
                    ['label' => 'Etiquetas inválidas', 'value' => (int) ($healthSummary['tags_invalid'] ?? 0), 'extra' => ''],
                    ['label' => 'Hosts sem etiqueta', 'value' => (int) ($healthSummary['hosts_without_tag'] ?? 0), 'extra' => ''],
                    ['label' => 'Grupos sem entidade', 'value' => (int) ($healthSummary['groups_without_entity'] ?? 0), 'extra' => ''],
                    ['label' => 'Falhas consecutivas', 'value' => $hConsecFail, 'extra' => ''],
                ];
                if ($hCacheAge !== null) {
                    $metrics[] = ['label' => 'Idade do cache', 'value' => round($hCacheAge, 1) . 'h', 'extra' => ''];
                }
                if ($hDurationMs !== null) {
                    $metrics[] = ['label' => 'Duração último sync', 'value' => round($hDurationMs / 1000, 1) . 's', 'extra' => ''];
                }
                foreach ($metrics as $m): ?>
                    <div class="col-md-3 col-xl-2">
                        <div class="border rounded p-2 h-100">
                            <div class="text-muted small"><?= htmlspecialchars(__($m['label'], 'glpiintegaglpi'), ENT_QUOTES, 'UTF-8'); ?></div>
                            <strong><?= htmlspecialchars((string) $m['value'] . $m['extra'], ENT_QUOTES, 'UTF-8'); ?></strong>
                        </div>
                    </div>
                <?php endforeach; ?>
            </div>

            <?php if ($hLastSyncAt !== '' || $hLastSyncSt !== '') { ?>
                <div class="form-text mt-2">
                    <?= __('Último sync:', 'glpiintegaglpi'); ?>
                    <strong><?= htmlspecialchars($hLastSyncSt, ENT_QUOTES, 'UTF-8'); ?></strong>
                    <?php if ($hLastSyncAt !== '') { ?>
                        — <?= htmlspecialchars($hLastSyncAt, ENT_QUOTES, 'UTF-8'); ?>
                    <?php } ?>
                    | <?= __('Nenhum alerta gera WhatsApp, e-mail ou ticket automático.', 'glpiintegaglpi'); ?>
                </div>
            <?php } ?>
        </div>
    </div>

    <div class="card mb-3">
        <div class="card-header">
            <strong><?= __('Mapeamento LogMeIn read-only', 'glpiintegaglpi'); ?></strong>
        </div>
        <div class="card-body">
            <?php if ($flash !== null) { ?>
                <div class="alert alert-<?= htmlspecialchars($flash['type'], ENT_QUOTES, 'UTF-8'); ?>">
                    <?= htmlspecialchars($flash['message'], ENT_QUOTES, 'UTF-8'); ?>
                </div>
            <?php } ?>
            <p class="text-muted mb-2">
                <?= __('Mapeie grupos LogMeIn para entidades GLPI candidatas. O mapeamento gera sugestão e confiança; vínculo definitivo e memória de entidade exigem confirmação técnica.', 'glpiintegaglpi'); ?>
            </p>
            <div class="alert alert-info mb-0">
                <?= __('LogMeIn é somente leitura: esta tela não executa sessão remota, não envia comando ao endpoint e não altera inventário GLPI automaticamente.', 'glpiintegaglpi'); ?>
                <br>
                <?= __('Flag runtime vista pelo plugin:', 'glpiintegaglpi'); ?>
                <strong><?= $featureEnabled ? 'ON' : 'OFF'; ?></strong>
                <span class="text-muted">
                    <?= __('(produção deve permanecer OFF por padrão; HOMOLOGAÇÃO pode usar ON para smoke controlado)', 'glpiintegaglpi'); ?>
                </span>
                <br>
                <?= __('Cache local:', 'glpiintegaglpi'); ?>
                <strong><?= (int) $cacheSummary['groups_count']; ?></strong>
                <?= __('grupos', 'glpiintegaglpi'); ?> /
                <strong><?= (int) $cacheSummary['hosts_count']; ?></strong>
                <?= __('hosts', 'glpiintegaglpi'); ?>
                <?php if ($lastSyncStatus !== null) { ?>
                    <br>
                    <?= __('Última sincronização:', 'glpiintegaglpi'); ?>
                    <strong><?= htmlspecialchars((string) $lastSyncStatus['sync_status'], ENT_QUOTES, 'UTF-8'); ?></strong>
                    <?= sprintf(
                        __('(%d grupos, %d hosts)', 'glpiintegaglpi'),
                        (int) $lastSyncStatus['groups_imported'],
                        (int) $lastSyncStatus['hosts_imported']
                    ); ?>
                <?php } ?>
            </div>
            <form method="post" class="mt-3">
                <input type="hidden" name="_glpi_csrf_token" value="<?= htmlspecialchars($csrfToken, ENT_QUOTES, 'UTF-8'); ?>">
                <input type="hidden" name="action" value="sync_logmein">
                <button class="btn btn-outline-primary" type="submit">
                    <?= __('Sincronizar grupos do LogMeIn', 'glpiintegaglpi'); ?>
                </button>
                <span class="text-muted ms-2">
                    <?= __('A sincronização é somente leitura e usa cache local da migration 042.', 'glpiintegaglpi'); ?>
                </span>
            </form>
        </div>
    </div>

    <div class="card mb-3">
        <div class="card-header"><?= __('Qualidade cadastral LogMeIn', 'glpiintegaglpi'); ?></div>
        <div class="card-body">
            <div class="row g-3">
                <div class="col-md-3">
                    <div class="border rounded p-3 h-100">
                        <div class="text-muted small"><?= __('Hosts sem etiqueta', 'glpiintegaglpi'); ?></div>
                        <strong><?= (int) ($inventoryQualityReport['hosts_without_tag'] ?? 0); ?></strong>
                    </div>
                </div>
                <div class="col-md-3">
                    <div class="border rounded p-3 h-100">
                        <div class="text-muted small"><?= __('Etiquetas inválidas', 'glpiintegaglpi'); ?></div>
                        <strong><?= (int) ($inventoryQualityReport['invalid_tags'] ?? 0); ?></strong>
                    </div>
                </div>
                <div class="col-md-3">
                    <div class="border rounded p-3 h-100">
                        <div class="text-muted small"><?= __('Etiquetas duplicadas', 'glpiintegaglpi'); ?></div>
                        <strong><?= count($duplicatedTags); ?></strong>
                    </div>
                </div>
                <div class="col-md-3">
                    <div class="border rounded p-3 h-100">
                        <div class="text-muted small"><?= __('Grupos sem entidade', 'glpiintegaglpi'); ?></div>
                        <strong><?= count($groupsWithoutEntity); ?></strong>
                    </div>
                </div>
            </div>
            <div class="row g-3 mt-1">
                <div class="col-lg-6">
                    <div class="small text-muted mb-1"><?= __('Amostra de etiquetas duplicadas', 'glpiintegaglpi'); ?></div>
                    <?php if ($duplicatedTags === []) { ?>
                        <div class="text-muted small"><?= __('Nenhuma duplicidade válida encontrada no cache local.', 'glpiintegaglpi'); ?></div>
                    <?php } else { ?>
                        <ul class="small mb-0">
                            <?php foreach ($duplicatedTags as $tag) { ?>
                                <li>
                                    <?= htmlspecialchars((string) ($tag['equipment_tag'] ?? ''), ENT_QUOTES, 'UTF-8'); ?>
                                    — <?= (int) ($tag['hosts_count'] ?? 0); ?> <?= __('hosts', 'glpiintegaglpi'); ?>
                                </li>
                            <?php } ?>
                        </ul>
                    <?php } ?>
                </div>
                <div class="col-lg-6">
                    <div class="small text-muted mb-1"><?= __('Grupos sincronizados sem mapeamento ativo', 'glpiintegaglpi'); ?></div>
                    <?php if ($groupsWithoutEntity === []) { ?>
                        <div class="text-muted small"><?= __('Nenhum grupo pendente de entidade no cache local.', 'glpiintegaglpi'); ?></div>
                    <?php } else { ?>
                        <ul class="small mb-0">
                            <?php foreach ($groupsWithoutEntity as $group) { ?>
                                <li>
                                    <?= htmlspecialchars((string) ($group['logmein_group_name'] ?? ''), ENT_QUOTES, 'UTF-8'); ?>
                                    — <?= (int) ($group['hosts_count'] ?? 0); ?> <?= __('hosts', 'glpiintegaglpi'); ?>
                                </li>
                            <?php } ?>
                        </ul>
                    <?php } ?>
                </div>
            </div>
            <div class="form-text mt-2">
                <?= __('Relatórios são agregados/sanitizados e não medem produtividade nominal. Relatórios de sessão remota permanecem fora do escopo.', 'glpiintegaglpi'); ?>
            </div>
        </div>
    </div>

    <div class="row g-3">
        <div class="col-lg-5">
            <div class="card">
                <div class="card-header"><?= __('Novo mapeamento', 'glpiintegaglpi'); ?></div>
                <div class="card-body">
                    <form method="post">
                        <input type="hidden" name="_glpi_csrf_token" value="<?= htmlspecialchars($csrfToken, ENT_QUOTES, 'UTF-8'); ?>">
                        <input type="hidden" name="action" value="save_mapping">
                        <input type="hidden" id="logmein-group-name" name="logmein_group_name" value="">
                        <div class="mb-3">
                            <label class="form-label" for="logmein-group-id"><?= __('Grupo LogMeIn sincronizado', 'glpiintegaglpi'); ?></label>
                            <select class="form-select" id="logmein-group-id" name="logmein_group_external_id" required>
                                <option value=""><?= __('Selecione um grupo do cache local', 'glpiintegaglpi'); ?></option>
                                <?php foreach ($cachedGroups as $group) {
                                    $groupId = (string) $group['logmein_group_external_id'];
                                    $groupName = (string) $group['logmein_group_name'];
                                    ?>
                                    <option
                                        value="<?= htmlspecialchars($groupId, ENT_QUOTES, 'UTF-8'); ?>"
                                        data-group-name="<?= htmlspecialchars($groupName, ENT_QUOTES, 'UTF-8'); ?>"
                                        <?= $selectedGroupId === $groupId ? 'selected' : ''; ?>
                                    >
                                        <?= htmlspecialchars($groupName, ENT_QUOTES, 'UTF-8'); ?>
                                        <?= sprintf(__('(%d hosts)', 'glpiintegaglpi'), (int) $group['hosts_count']); ?>
                                    </option>
                                <?php } ?>
                            </select>
                            <?php if ($cachedGroups === []) { ?>
                                <div class="form-text">
                                    <?= __('Nenhum grupo em cache. Execute a sincronização após aplicar a migration 042 e configurar as credenciais no runtime seguro.', 'glpiintegaglpi'); ?>
                                </div>
                            <?php } ?>
                        </div>
                        <div class="mb-3">
                            <label class="form-label" for="logmein-entity-id"><?= __('Entidade GLPI candidata', 'glpiintegaglpi'); ?></label>
                            <input
                                class="form-control form-control-sm mb-2"
                                id="logmein-entity-filter"
                                type="search"
                                placeholder="<?= htmlspecialchars(__('Digite para buscar uma entidade GLPI', 'glpiintegaglpi'), ENT_QUOTES, 'UTF-8'); ?>"
                                autocomplete="off"
                                aria-label="<?= htmlspecialchars(__('Buscar entidade GLPI permitida', 'glpiintegaglpi'), ENT_QUOTES, 'UTF-8'); ?>"
                                data-entity-filter
                            >
                            <select class="form-select" id="logmein-entity-id" name="glpi_entity_id" required data-entity-select <?= $entityOptions === [] ? 'disabled' : ''; ?>>
                                <option value=""><?= __('Selecione uma entidade GLPI permitida', 'glpiintegaglpi'); ?></option>
                                <?php foreach ($entityOptions as $entity) {
                                    $entityId = (int) ($entity['id'] ?? 0);
                                    if ($entityId <= 0) {
                                        continue;
                                    }
                                    $entityName = (string) ($entity['name'] ?? ('#' . $entityId));
                                    ?>
                                    <option
                                        value="<?= $entityId; ?>"
                                        data-entity-name="<?= htmlspecialchars($entityName, ENT_QUOTES, 'UTF-8'); ?>"
                                    >
                                        <?= htmlspecialchars($entityName, ENT_QUOTES, 'UTF-8'); ?>
                                    </option>
                                <?php } ?>
                            </select>
                            <div class="form-text" id="logmein-entity-selection-hint">
                                <?= __('A lista usa somente entidades reais dentro do escopo GLPI da sessão atual.', 'glpiintegaglpi'); ?>
                            </div>
                            <?php if ($entityOptions === []) { ?>
                                <div class="form-text text-danger">
                                    <?= __('Nenhuma entidade GLPI permitida disponível para esta sessão.', 'glpiintegaglpi'); ?>
                                </div>
                            <?php } ?>
                        </div>
                        <div class="mb-3">
                            <label class="form-label" for="logmein-confidence"><?= __('Confiança', 'glpiintegaglpi'); ?></label>
                            <input class="form-control" id="logmein-confidence" name="confidence_score" type="number" min="0" max="100" value="80">
                        </div>
                        <button class="btn btn-primary" type="submit">
                            <?= __('Salvar sugestão de mapeamento', 'glpiintegaglpi'); ?>
                        </button>
                    </form>
                    <form method="get" class="mt-3">
                        <label class="form-label" for="logmein-preview-group"><?= __('Prévia de hosts do grupo', 'glpiintegaglpi'); ?></label>
                        <div class="input-group">
                            <select class="form-select" id="logmein-preview-group" name="group_external_id">
                                <option value=""><?= __('Selecionar para prévia', 'glpiintegaglpi'); ?></option>
                                <?php foreach ($cachedGroups as $group) {
                                    $groupId = (string) $group['logmein_group_external_id'];
                                    ?>
                                    <option value="<?= htmlspecialchars($groupId, ENT_QUOTES, 'UTF-8'); ?>" <?= $selectedGroupId === $groupId ? 'selected' : ''; ?>>
                                        <?= htmlspecialchars((string) $group['logmein_group_name'], ENT_QUOTES, 'UTF-8'); ?>
                                    </option>
                                <?php } ?>
                            </select>
                            <button class="btn btn-outline-secondary" type="submit">
                                <?= __('Visualizar', 'glpiintegaglpi'); ?>
                            </button>
                        </div>
                    </form>
                    <?php if ($hostPreview !== []) { ?>
                        <div class="table-responsive mt-3">
                            <table class="table table-sm">
                                <thead>
                                    <tr>
                                        <th><?= __('Host', 'glpiintegaglpi'); ?></th>
                                        <th><?= __('Etiqueta', 'glpiintegaglpi'); ?></th>
                                        <th><?= __('Status', 'glpiintegaglpi'); ?></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <?php foreach ($hostPreview as $host) { ?>
                                        <tr>
                                            <td><?= htmlspecialchars((string) $host['host_name'], ENT_QUOTES, 'UTF-8'); ?></td>
                                            <?php $previewTag = (string) $host['equipment_tag']; ?>
                                            <td>
                                                <?= preg_match('/^\d{4}$/', $previewTag) === 1
                                                    ? htmlspecialchars($previewTag, ENT_QUOTES, 'UTF-8')
                                                    : htmlspecialchars(__('sem etiqueta válida', 'glpiintegaglpi'), ENT_QUOTES, 'UTF-8'); ?>
                                            </td>
                                            <td><?= htmlspecialchars((string) $host['status'], ENT_QUOTES, 'UTF-8'); ?></td>
                                        </tr>
                                    <?php } ?>
                                </tbody>
                            </table>
                        </div>
                    <?php } ?>
                </div>
            </div>
        </div>
        <div class="col-lg-7">
            <div class="card">
                <div class="card-header"><?= __('Mapeamentos ativos e recentes', 'glpiintegaglpi'); ?></div>
                <div class="card-body">
                    <?php if ($mappings === []) { ?>
                        <div class="alert alert-light border mb-0">
                            <?= __('Nenhum mapeamento disponível ou migration 042 ainda não aplicada.', 'glpiintegaglpi'); ?>
                        </div>
                    <?php } else { ?>
                        <div class="table-responsive">
                            <table class="table table-sm align-middle">
                                <thead>
                                    <tr>
                                        <th><?= __('Grupo', 'glpiintegaglpi'); ?></th>
                                        <th><?= __('Entidade', 'glpiintegaglpi'); ?></th>
                                        <th><?= __('Confiança', 'glpiintegaglpi'); ?></th>
                                        <th><?= __('Status', 'glpiintegaglpi'); ?></th>
                                        <th><?= __('Ação', 'glpiintegaglpi'); ?></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <?php foreach ($mappings as $mapping) { ?>
                                        <tr>
                                            <td><?= htmlspecialchars((string) $mapping['logmein_group_name'], ENT_QUOTES, 'UTF-8'); ?></td>
                                            <td>
                                                <?php $entityLabel = trim((string) ($mapping['glpi_entity_label'] ?? '')); ?>
                                                <?= htmlspecialchars($entityLabel !== '' ? $entityLabel : ('#' . (int) $mapping['glpi_entity_id']), ENT_QUOTES, 'UTF-8'); ?>
                                            </td>
                                            <td><?= (int) $mapping['confidence_score']; ?>%</td>
                                            <td><?= !empty($mapping['is_active']) ? __('Ativo', 'glpiintegaglpi') : __('Inativo', 'glpiintegaglpi'); ?></td>
                                            <td>
                                                <?php if (!empty($mapping['is_active'])) { ?>
                                                    <form method="post" class="d-inline">
                                                        <input type="hidden" name="_glpi_csrf_token" value="<?= htmlspecialchars($csrfToken, ENT_QUOTES, 'UTF-8'); ?>">
                                                        <input type="hidden" name="action" value="disable_mapping">
                                                        <input type="hidden" name="mapping_id" value="<?= (int) $mapping['id']; ?>">
                                                        <button class="btn btn-sm btn-outline-secondary" type="submit">
                                                            <?= __('Desativar', 'glpiintegaglpi'); ?>
                                                        </button>
                                                    </form>
                                                <?php } ?>
                                            </td>
                                        </tr>
                                    <?php } ?>
                                </tbody>
                            </table>
                        </div>
                    <?php } ?>
                </div>
            </div>
        </div>
    </div>
</div>

<script>
document.addEventListener('DOMContentLoaded', function () {
    var groupSelect = document.getElementById('logmein-group-id');
    var groupNameInput = document.getElementById('logmein-group-name');
    var entityFilter = document.getElementById('logmein-entity-filter');
    var entitySelect = document.getElementById('logmein-entity-id');

    if (groupSelect && groupNameInput) {
        var syncGroupName = function () {
            var option = groupSelect.options[groupSelect.selectedIndex];
            groupNameInput.value = option ? (option.getAttribute('data-group-name') || '') : '';
        };
        groupSelect.addEventListener('change', syncGroupName);
        syncGroupName();
    }

    if (entityFilter && entitySelect) {
        entityFilter.addEventListener('input', function () {
            var query = String(entityFilter.value || '').toLowerCase().trim();
            Array.prototype.forEach.call(entitySelect.options, function (option) {
                var value = String(option.value || '');
                var label = String(option.textContent || '').toLowerCase();
                var name = String(option.getAttribute('data-entity-name') || '').toLowerCase();
                if (value === '') {
                    option.hidden = false;
                    return;
                }
                option.hidden = query !== '' && label.indexOf(query) === -1 && name.indexOf(query) === -1 && value.indexOf(query) === -1;
            });
        });
    }
});
</script>
