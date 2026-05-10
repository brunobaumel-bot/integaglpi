<?php

declare(strict_types=1);

/**
 * @var list<array<string, mixed>>      $options       All routing options
 * @var list<array<string, mixed>>      $queues        Active queues for dropdown
 * @var array<string, mixed>|null       $editing       Option being edited (null = new)
 * @var bool                            $isConfigured  External DB is configured
 */

$adminUrl  = \GlpiPlugin\Integaglpi\Plugin::getRoutingOptionsAdminUrl();
$configUrl = \GlpiPlugin\Integaglpi\Plugin::getQueueAdminUrl();

$esc = static fn (string $v): string => Html::cleanInputText($v);
?>

<div class="d-flex align-items-center gap-3 mb-3">
    <a href="<?= $esc($configUrl); ?>" class="btn btn-sm btn-outline-secondary">
        &larr; <?= __('Back to configuration', 'glpiintegaglpi'); ?>
    </a>
    <h2 class="mb-0"><?= __('Routing options', 'glpiintegaglpi'); ?></h2>
</div>

<?php if (!$isConfigured): ?>
<div class="alert alert-warning">
    <?= __('External PostgreSQL connection not configured. Configure it first.', 'glpiintegaglpi'); ?>
</div>
<?php else: ?>

<?php
// ── Form (add / edit) ─────────────────────────────────────────────────────────
$formId    = $editing !== null ? (int) $editing['id'] : 0;
$formTitle = $formId > 0 ? __('Edit routing option', 'glpiintegaglpi') : __('New routing option', 'glpiintegaglpi');
?>
<div class="card mb-4">
    <div class="card-header d-flex justify-content-between align-items-center">
        <span><?= $esc($formTitle); ?></span>
        <?php if ($formId > 0): ?>
            <a href="<?= $esc($adminUrl); ?>" class="btn btn-sm btn-outline-secondary">
                <?= __('New option', 'glpiintegaglpi'); ?>
            </a>
        <?php endif; ?>
    </div>
    <div class="card-body">
        <form method="post" action="<?= $esc($adminUrl); ?>">
            <?= \GlpiPlugin\Integaglpi\Plugin::renderCsrfToken(); ?>
            <input type="hidden" name="id" value="<?= $formId; ?>">

            <div class="row g-3">
                <!-- option_key -->
                <div class="col-md-4">
                    <label class="form-label fw-semibold">
                        <?= __('Option key', 'glpiintegaglpi'); ?> <span class="text-danger">*</span>
                    </label>
                    <input type="text" name="option_key" class="form-control"
                        value="<?= $esc((string) ($editing['option_key'] ?? '')); ?>"
                        placeholder="ex: human_agent" required>
                    <div class="form-text"><?= __('Unique slug sent to the integration service.', 'glpiintegaglpi'); ?></div>
                </div>

                <!-- label -->
                <div class="col-md-5">
                    <label class="form-label fw-semibold">
                        <?= __('Label (shown to client)', 'glpiintegaglpi'); ?> <span class="text-danger">*</span>
                    </label>
                    <input type="text" name="label" class="form-control"
                        value="<?= $esc((string) ($editing['label'] ?? '')); ?>"
                        placeholder="ex: Falar com atendente" required>
                </div>

                <!-- sort_order -->
                <div class="col-md-3">
                    <label class="form-label fw-semibold"><?= __('Sort order', 'glpiintegaglpi'); ?></label>
                    <input type="number" name="sort_order" class="form-control" min="0"
                        value="<?= (int) ($editing['sort_order'] ?? 0); ?>">
                </div>

                <!-- queue_id -->
                <div class="col-md-4">
                    <label class="form-label fw-semibold"><?= __('Destination queue', 'glpiintegaglpi'); ?></label>
                    <select name="queue_id" class="form-select">
                        <option value="0"><?= __('— none —', 'glpiintegaglpi'); ?></option>
                        <?php foreach ($queues as $q): ?>
                            <?php $selected = ((int) ($editing['queue_id'] ?? 0) === (int) $q['id']) ? 'selected' : ''; ?>
                            <option value="<?= (int) $q['id']; ?>" <?= $selected; ?>>
                                <?= $esc((string) ($q['name'] ?? '')); ?>
                            </option>
                        <?php endforeach; ?>
                    </select>
                </div>

                <!-- glpi_group_id -->
                <div class="col-md-4">
                    <label class="form-label fw-semibold"><?= __('GLPI Group ID (optional)', 'glpiintegaglpi'); ?></label>
                    <input type="number" name="glpi_group_id" class="form-control" min="0"
                        value="<?= (int) ($editing['glpi_group_id'] ?? 0) ?: ''; ?>"
                        placeholder="<?= __('Leave blank for none', 'glpiintegaglpi'); ?>">
                </div>

                <!-- glpi_user_id -->
                <div class="col-md-4">
                    <label class="form-label fw-semibold"><?= __('GLPI User ID (optional)', 'glpiintegaglpi'); ?></label>
                    <input type="number" name="glpi_user_id" class="form-control" min="0"
                        value="<?= (int) ($editing['glpi_user_id'] ?? 0) ?: ''; ?>"
                        placeholder="<?= __('Leave blank for none', 'glpiintegaglpi'); ?>">
                </div>

                <!-- confirmation_message -->
                <div class="col-12">
                    <label class="form-label fw-semibold"><?= __('Confirmation message (optional)', 'glpiintegaglpi'); ?></label>
                    <textarea name="confirmation_message" class="form-control" rows="2"
                        placeholder="<?= __('Sent to the client after selection.', 'glpiintegaglpi'); ?>"><?= $esc((string) ($editing['confirmation_message'] ?? '')); ?></textarea>
                </div>

                <!-- is_active -->
                <div class="col-12">
                    <div class="form-check">
                        <input type="checkbox" name="is_active" value="1" id="ro_is_active" class="form-check-input"
                            <?= !empty($editing['is_active']) ? 'checked' : ($formId === 0 ? 'checked' : ''); ?>>
                        <label class="form-check-label" for="ro_is_active">
                            <?= __('Active', 'glpiintegaglpi'); ?>
                        </label>
                    </div>
                </div>
            </div>

            <div class="mt-3 d-flex gap-2">
                <button type="submit" name="save_routing_option" value="1" class="btn btn-primary">
                    <?= $formId > 0 ? __('Update', 'glpiintegaglpi') : __('Create', 'glpiintegaglpi'); ?>
                </button>
                <?php if ($formId > 0): ?>
                    <a href="<?= $esc($adminUrl); ?>" class="btn btn-outline-secondary">
                        <?= __('Cancel', 'glpiintegaglpi'); ?>
                    </a>
                <?php endif; ?>
            </div>
        </form>
    </div>
</div>

<?php // ── List ────────────────────────────────────────────────────────────────── ?>
<div class="card">
    <div class="card-header"><?= __('Configured routing options', 'glpiintegaglpi'); ?></div>
    <div class="card-body p-0">
        <?php if (empty($options)): ?>
            <p class="p-3 mb-0 text-muted"><?= __('No routing options configured yet.', 'glpiintegaglpi'); ?></p>
        <?php else: ?>
        <table class="table table-hover mb-0">
            <thead class="table-light">
                <tr>
                    <th><?= __('Order', 'glpiintegaglpi'); ?></th>
                    <th><?= __('Key', 'glpiintegaglpi'); ?></th>
                    <th><?= __('Label', 'glpiintegaglpi'); ?></th>
                    <th><?= __('Queue', 'glpiintegaglpi'); ?></th>
                    <th><?= __('Group ID', 'glpiintegaglpi'); ?></th>
                    <th><?= __('User ID', 'glpiintegaglpi'); ?></th>
                    <th><?= __('Active', 'glpiintegaglpi'); ?></th>
                    <th><?= __('Actions', 'glpiintegaglpi'); ?></th>
                </tr>
            </thead>
            <tbody>
            <?php foreach ($options as $opt): ?>
                <tr class="<?= $opt['is_active'] ? '' : 'text-muted'; ?>">
                    <td><?= (int) $opt['sort_order']; ?></td>
                    <td><code><?= $esc((string) ($opt['option_key'] ?? '')); ?></code></td>
                    <td><?= $esc((string) ($opt['label'] ?? '')); ?></td>
                    <td><?= $esc((string) ($opt['queue_name'] ?? '—')); ?></td>
                    <td><?= $opt['glpi_group_id'] !== null ? (int) $opt['glpi_group_id'] : '—'; ?></td>
                    <td><?= $opt['glpi_user_id']  !== null ? (int) $opt['glpi_user_id']  : '—'; ?></td>
                    <td>
                        <?php if ($opt['is_active']): ?>
                            <span class="badge bg-success"><?= __('Yes', 'glpiintegaglpi'); ?></span>
                        <?php else: ?>
                            <span class="badge bg-secondary"><?= __('No', 'glpiintegaglpi'); ?></span>
                        <?php endif; ?>
                    </td>
                    <td class="d-flex gap-1">
                        <a href="<?= $esc($adminUrl . '?id=' . (int) $opt['id']); ?>"
                           class="btn btn-sm btn-outline-primary">
                            <?= __('Edit', 'glpiintegaglpi'); ?>
                        </a>
                        <form method="post" action="<?= $esc($adminUrl); ?>"
                              onsubmit="return confirm('<?= __('Delete this routing option?', 'glpiintegaglpi'); ?>');">
                            <?= \GlpiPlugin\Integaglpi\Plugin::renderCsrfToken(); ?>
                            <input type="hidden" name="id" value="<?= (int) $opt['id']; ?>">
                            <button type="submit" name="delete_routing_option" value="1"
                                    class="btn btn-sm btn-outline-danger">
                                <?= __('Delete', 'glpiintegaglpi'); ?>
                            </button>
                        </form>
                    </td>
                </tr>
            <?php endforeach; ?>
            </tbody>
        </table>
        <?php endif; ?>
    </div>
</div>

<?php endif; ?>
