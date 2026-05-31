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
/** @var string $selectedGroupId */
/** @var bool $featureEnabled */

$csrfToken = Plugin::getCsrfToken();
?>

<div class="container-fluid">
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
                                            <td><?= htmlspecialchars((string) $host['equipment_tag'], ENT_QUOTES, 'UTF-8'); ?></td>
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
