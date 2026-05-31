<?php

declare(strict_types=1);

use GlpiPlugin\Integaglpi\Plugin;

/** @var array{type:string,message:string}|null $flash */
/** @var list<array<string, mixed>> $mappings */
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
                <?= __('Feature flag LOGMEIN_INTEGRATION_ENABLED permanece OFF por padrão. Esta tela não executa sessão remota, não envia comando ao endpoint e não altera inventário GLPI automaticamente.', 'glpiintegaglpi'); ?>
                <br>
                <?= __('Estado atual da flag:', 'glpiintegaglpi'); ?>
                <strong><?= $featureEnabled ? 'ON' : 'OFF'; ?></strong>
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
                        <div class="mb-3">
                            <label class="form-label" for="logmein-group-id"><?= __('ID externo do grupo LogMeIn', 'glpiintegaglpi'); ?></label>
                            <input class="form-control" id="logmein-group-id" name="logmein_group_external_id" maxlength="160" required>
                        </div>
                        <div class="mb-3">
                            <label class="form-label" for="logmein-group-name"><?= __('Nome do grupo LogMeIn', 'glpiintegaglpi'); ?></label>
                            <input class="form-control" id="logmein-group-name" name="logmein_group_name" maxlength="160" required>
                        </div>
                        <div class="mb-3">
                            <label class="form-label" for="logmein-entity-id"><?= __('Entidade GLPI candidata', 'glpiintegaglpi'); ?></label>
                            <input class="form-control" id="logmein-entity-id" name="glpi_entity_id" type="number" min="1" step="1" required>
                        </div>
                        <div class="mb-3">
                            <label class="form-label" for="logmein-confidence"><?= __('Confiança', 'glpiintegaglpi'); ?></label>
                            <input class="form-control" id="logmein-confidence" name="confidence_score" type="number" min="0" max="100" value="80">
                        </div>
                        <button class="btn btn-primary" type="submit">
                            <?= __('Salvar sugestão de mapeamento', 'glpiintegaglpi'); ?>
                        </button>
                    </form>
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
                                            <td>#<?= (int) $mapping['glpi_entity_id']; ?></td>
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
