<?php

declare(strict_types=1);

/** @var \GlpiPlugin\Integaglpi\Renderer\ConfigPageRenderer $this */
/** @var array<string, mixed> $connectionConfig */
/** @var bool $isConfigured */

$configUrl = \GlpiPlugin\Integaglpi\Plugin::getQueueAdminUrl();
$integaglpiHealthProxyUrl = \GlpiPlugin\Integaglpi\Plugin::getWebBasePath() . '/front/health.proxy.php';
$configService = new \GlpiPlugin\Integaglpi\Service\PluginConfigService();
$routingOptionService = new \GlpiPlugin\Integaglpi\Service\RoutingOptionService($configService);
$routingOptions = $isConfigured ? $routingOptionService->getAll() : [];
$messageConfig = $configService->getMessageConfig();
$activeTab = (string) ($_GET['tab'] ?? 'connection');
if (!in_array($activeTab, ['connection', 'queues', 'messages'], true)) {
    $activeTab = 'connection';
}

$tabUrl = static fn (string $tab): string => $configUrl . '?tab=' . rawurlencode($tab);
?>

<ul class="nav nav-tabs mb-3">
    <li class="nav-item">
        <a class="nav-link <?= $activeTab === 'connection' ? 'active' : ''; ?>"
           href="<?= $this->escape($tabUrl('connection')); ?>">
            <?= $this->escape(__('Conexão', 'glpiintegaglpi')); ?>
        </a>
    </li>
    <li class="nav-item">
        <a class="nav-link <?= $activeTab === 'queues' ? 'active' : ''; ?>"
           href="<?= $this->escape($tabUrl('queues')); ?>">
            <?= $this->escape(__('Filas', 'glpiintegaglpi')); ?>
        </a>
    </li>
    <li class="nav-item">
        <a class="nav-link <?= $activeTab === 'messages' ? 'active' : ''; ?>"
           href="<?= $this->escape($tabUrl('messages')); ?>">
            <?= $this->escape(__('Mensagens', 'glpiintegaglpi')); ?>
        </a>
    </li>
</ul>

<link rel="stylesheet" type="text/css" href="<?= $this->escape(\GlpiPlugin\Integaglpi\Plugin::getWebBasePath() . '/css/whatsapp.css'); ?>">

<?php if ($activeTab === 'connection') { ?>
    <div class="mb-3 d-flex flex-wrap align-items-center gap-2">
        <span class="text-muted small"><?= $this->escape(__('Node integration service', 'glpiintegaglpi')); ?>:</span>
        <span class="badge bg-secondary itg-iw-int-health-badge" data-state="loading">
            <?= $this->escape(__('Verificando...', 'glpiintegaglpi')); ?>
        </span>
    </div>
    <div class="card mb-3">
        <div class="card-header"><?= $this->escape(__('External PostgreSQL connection', 'glpiintegaglpi')); ?></div>
        <div class="card-body">
            <form method="post" action="<?= $this->escape($configUrl); ?>">
                <?= \GlpiPlugin\Integaglpi\Plugin::renderCsrfToken(); ?>
                <div class="row g-3">
                    <div class="col-md-4">
                        <label class="form-label"><?= $this->escape(__('Host', 'glpiintegaglpi')); ?></label>
                        <input type="text" name="db_host" class="form-control" value="<?= $this->escape((string) ($connectionConfig['db_host'] ?? '')); ?>" required>
                    </div>
                    <div class="col-md-2">
                        <label class="form-label"><?= $this->escape(__('Port', 'glpiintegaglpi')); ?></label>
                        <input type="number" name="db_port" class="form-control" value="<?= (int) ($connectionConfig['db_port'] ?? 5432); ?>" required>
                    </div>
                    <div class="col-md-3">
                        <label class="form-label"><?= $this->escape(__('Database', 'glpiintegaglpi')); ?></label>
                        <input type="text" name="db_name" class="form-control" value="<?= $this->escape((string) ($connectionConfig['db_name'] ?? '')); ?>" required>
                    </div>
                    <div class="col-md-3">
                        <label class="form-label"><?= $this->escape(__('User', 'glpiintegaglpi')); ?></label>
                        <input type="text" name="db_user" class="form-control" value="<?= $this->escape((string) ($connectionConfig['db_user'] ?? '')); ?>" required>
                    </div>
                    <div class="col-md-4">
                        <label class="form-label"><?= $this->escape(__('Password', 'glpiintegaglpi')); ?></label>
                        <input type="password" name="db_password" class="form-control" value="" placeholder="<?= $this->escape(__('Leave blank to keep the current password.', 'glpiintegaglpi')); ?>">
                    </div>
                    <div class="col-md-12">
                        <label class="form-label"><?= $this->escape(__('Integration service auth key', 'glpiintegaglpi')); ?></label>
                        <input type="password" name="integration_auth_key" class="form-control" value="" autocomplete="new-password" placeholder="<?= $this->escape(__('Leave blank to keep the current key. Must match Node .env INTEGRATION_SERVICE_API_KEY.', 'glpiintegaglpi')); ?>">
                        <small class="text-muted"><?= $this->escape(__('Bearer token sent to the Node integration-service for outbound WhatsApp messages.', 'glpiintegaglpi')); ?></small>
                    </div>
                    <div class="col-md-3">
                        <label class="form-label"><?= $this->escape(__('SSL mode', 'glpiintegaglpi')); ?></label>
                        <select name="db_sslmode" class="form-select">
                            <?php foreach (['disable', 'prefer', 'require'] as $sslMode) { ?>
                                <option value="<?= $this->escape($sslMode); ?>" <?= (string) ($connectionConfig['db_sslmode'] ?? 'prefer') === $sslMode ? "selected='selected'" : ''; ?>>
                                    <?= $this->escape($sslMode); ?>
                                </option>
                            <?php } ?>
                        </select>
                    </div>
                    <div class="col-md-5 d-flex align-items-end">
                        <button type="submit" name="save_connection" class="btn btn-primary">
                            <?= $this->escape(__('Save connection', 'glpiintegaglpi')); ?>
                        </button>
                        <span class="ms-3 badge <?= $isConfigured ? 'bg-success' : 'bg-secondary'; ?>">
                            <?= $this->escape($isConfigured ? __('Configured', 'glpiintegaglpi') : __('Not configured', 'glpiintegaglpi')); ?>
                        </span>
                    </div>
                </div>
            </form>
        </div>
    </div>
<?php } ?>

<?php if ($activeTab === 'queues') { ?>
    <?php if (!$isConfigured) { ?>
        <div class="alert alert-info">
            <?= $this->escape(__('Configure the external PostgreSQL connection before managing routing options.', 'glpiintegaglpi')); ?>
        </div>
    <?php } else { ?>
        <div class="card mb-3">
            <div class="card-header"><?= $this->escape(__('Nova fila / opção de roteamento', 'glpiintegaglpi')); ?></div>
            <div class="card-body">
                <form method="post" action="<?= $this->escape($configUrl); ?>?tab=queues">
                    <?= \GlpiPlugin\Integaglpi\Plugin::renderCsrfToken(); ?>
                    <input type="hidden" name="id" value="0">
                    <input type="hidden" name="queue_id" value="0">
                    <input type="hidden" name="glpi_user_id" value="0">
                    <input type="hidden" name="confirmation_message" value="">
                    <div class="row g-3 align-items-end">
                        <div class="col-md-3">
                            <label class="form-label"><?= $this->escape(__('Option key', 'glpiintegaglpi')); ?></label>
                            <input type="text" name="option_key" class="form-control" pattern="^[a-z0-9_]+$" required>
                        </div>
                        <div class="col-md-3">
                            <label class="form-label"><?= $this->escape(__('Label', 'glpiintegaglpi')); ?></label>
                            <input type="text" name="label" class="form-control" required>
                        </div>
                        <div class="col-md-3">
                            <label class="form-label"><?= $this->escape(__('GLPI group', 'glpiintegaglpi')); ?></label>
                            <?php Group::dropdown([
                                'name' => 'glpi_group_id',
                                'value' => 0,
                                'display_emptychoice' => true,
                            ]); ?>
                        </div>
                        <div class="col-md-1">
                            <label class="form-label"><?= $this->escape(__('Order', 'glpiintegaglpi')); ?></label>
                            <input type="number" name="sort_order" class="form-control" min="0" value="0">
                        </div>
                        <div class="col-md-2">
                            <div class="form-check mb-2">
                                <input class="form-check-input" type="checkbox" name="is_active" value="1" checked>
                                <label class="form-check-label"><?= $this->escape(__('Active', 'glpiintegaglpi')); ?></label>
                            </div>
                            <button type="submit" name="save_routing_option" value="1" class="btn btn-primary w-100">
                                <?= $this->escape(__('Salvar', 'glpiintegaglpi')); ?>
                            </button>
                        </div>
                    </div>
                </form>
            </div>
        </div>

        <?php foreach ($routingOptions as $option) { ?>
            <div class="card mb-3">
                <div class="card-header d-flex justify-content-between align-items-center">
                    <span>
                        <code><?= $this->escape((string) ($option['option_key'] ?? '')); ?></code>
                        <?= $this->escape((string) ($option['label'] ?? '')); ?>
                    </span>
                    <span class="badge <?= !empty($option['is_active']) ? 'bg-success' : 'bg-secondary'; ?>">
                        <?= $this->escape(!empty($option['is_active']) ? __('Active', 'glpiintegaglpi') : __('Inactive', 'glpiintegaglpi')); ?>
                    </span>
                </div>
                <div class="card-body">
                    <form method="post" action="<?= $this->escape($configUrl); ?>?tab=queues">
                        <?= \GlpiPlugin\Integaglpi\Plugin::renderCsrfToken(); ?>
                        <input type="hidden" name="id" value="<?= (int) ($option['id'] ?? 0); ?>">
                        <input type="hidden" name="queue_id" value="<?= (int) ($option['queue_id'] ?? 0); ?>">
                        <input type="hidden" name="glpi_user_id" value="<?= (int) ($option['glpi_user_id'] ?? 0); ?>">
                        <input type="hidden" name="confirmation_message" value="<?= $this->escape((string) ($option['confirmation_message'] ?? '')); ?>">
                        <div class="row g-3 align-items-end">
                            <div class="col-md-3">
                                <label class="form-label"><?= $this->escape(__('Option key', 'glpiintegaglpi')); ?></label>
                                <input
                                    type="text"
                                    name="option_key"
                                    class="form-control"
                                    pattern="^[a-z0-9_]+$"
                                    value="<?= $this->escape((string) ($option['option_key'] ?? '')); ?>"
                                    required
                                >
                            </div>
                            <div class="col-md-3">
                                <label class="form-label"><?= $this->escape(__('Label', 'glpiintegaglpi')); ?></label>
                                <input type="text" name="label" class="form-control" value="<?= $this->escape((string) ($option['label'] ?? '')); ?>" required>
                            </div>
                            <div class="col-md-3">
                                <label class="form-label"><?= $this->escape(__('GLPI group', 'glpiintegaglpi')); ?></label>
                                <?php Group::dropdown([
                                    'name' => 'glpi_group_id',
                                    'value' => (int) ($option['glpi_group_id'] ?? 0),
                                    'display_emptychoice' => true,
                                ]); ?>
                            </div>
                            <div class="col-md-1">
                                <label class="form-label"><?= $this->escape(__('Order', 'glpiintegaglpi')); ?></label>
                                <input type="number" name="sort_order" class="form-control" min="0" value="<?= (int) ($option['sort_order'] ?? 0); ?>">
                            </div>
                            <div class="col-md-2">
                                <div class="form-check mb-2">
                                    <input class="form-check-input" type="checkbox" name="is_active" value="1" <?= !empty($option['is_active']) ? "checked='checked'" : ''; ?>>
                                    <label class="form-check-label"><?= $this->escape(__('Active', 'glpiintegaglpi')); ?></label>
                                </div>
                                <div class="d-flex gap-2">
                                    <button type="submit" name="save_routing_option" value="1" class="btn btn-primary">
                                        <?= $this->escape(__('Salvar', 'glpiintegaglpi')); ?>
                                    </button>
                                    <button type="submit" name="disable_routing_option" value="1" class="btn btn-outline-secondary">
                                        <?= $this->escape(__('Desativar', 'glpiintegaglpi')); ?>
                                    </button>
                                </div>
                            </div>
                        </div>
                    </form>
                </div>
            </div>
        <?php } ?>

        <?php if ($routingOptions === []) { ?>
            <div class="alert alert-info">
                <?= $this->escape(__('No routing options configured yet.', 'glpiintegaglpi')); ?>
            </div>
        <?php } ?>
    <?php } ?>
<?php } ?>

<?php if ($activeTab === 'messages') { ?>
    <div class="card mb-3">
        <div class="card-header"><?= $this->escape(__('Mensagens do atendimento', 'glpiintegaglpi')); ?></div>
        <div class="card-body">
            <form method="post" action="<?= $this->escape($configUrl); ?>?tab=messages">
                <?= \GlpiPlugin\Integaglpi\Plugin::renderCsrfToken(); ?>
                <div class="mb-3">
                    <label class="form-label"><?= $this->escape(__('Mensagem de boas-vindas', 'glpiintegaglpi')); ?></label>
                    <textarea name="welcome_message" class="form-control" rows="3"><?= $this->escape($messageConfig['welcome_message']); ?></textarea>
                </div>
                <div class="mb-3">
                    <label class="form-label"><?= $this->escape(__('Mensagem do menu', 'glpiintegaglpi')); ?></label>
                    <textarea name="menu_message" class="form-control" rows="3"><?= $this->escape($messageConfig['menu_message']); ?></textarea>
                </div>
                <div class="mb-3">
                    <label class="form-label"><?= $this->escape(__('Mensagem de opção inválida', 'glpiintegaglpi')); ?></label>
                    <textarea name="invalid_option_message" class="form-control" rows="3"><?= $this->escape($messageConfig['invalid_option_message']); ?></textarea>
                </div>
                <div class="mb-3">
                    <label class="form-label"><?= $this->escape(__('Mensagem de mídia inválida', 'glpiintegaglpi')); ?></label>
                    <textarea name="invalid_media_message" class="form-control" rows="3"><?= $this->escape($messageConfig['invalid_media_message']); ?></textarea>
                </div>
                <div class="mb-3">
                    <label class="form-label"><?= $this->escape(__('Mensagem de fila selecionada', 'glpiintegaglpi')); ?></label>
                    <textarea name="queue_selected_message" class="form-control" rows="3"><?= $this->escape($messageConfig['queue_selected_message']); ?></textarea>
                </div>
                <div class="mb-3">
                    <label class="form-label"><?= $this->escape(__('Mensagem fora do horário', 'glpiintegaglpi')); ?></label>
                    <textarea name="after_hours_message" class="form-control" rows="3"><?= $this->escape($messageConfig['after_hours_message']); ?></textarea>
                </div>
                <div class="mb-3">
                    <label class="form-label"><?= $this->escape(__('Mensagem de conversa encerrada', 'glpiintegaglpi')); ?></label>
                    <textarea name="conversation_closed_message" class="form-control" rows="3"><?= $this->escape($messageConfig['conversation_closed_message']); ?></textarea>
                </div>
                <div class="mb-3">
                    <label class="form-label"><?= $this->escape(__('Mensagem de fallback de erro', 'glpiintegaglpi')); ?></label>
                    <textarea name="error_fallback_message" class="form-control" rows="3"><?= $this->escape($messageConfig['error_fallback_message']); ?></textarea>
                </div>
                <div class="alert alert-info">
                    <?= $this->escape(__('Campos vazios são salvos com o texto padrão seguro.', 'glpiintegaglpi')); ?>
                </div>
                <button type="submit" name="save_messages" value="1" class="btn btn-primary">
                    <?= $this->escape(__('Salvar mensagens', 'glpiintegaglpi')); ?>
                </button>
            </form>
        </div>
    </div>
<?php } ?>

<?php if ($activeTab === 'connection') { ?>
    <script>
    (function () {
        const proxyUrl = <?= json_encode($integaglpiHealthProxyUrl, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE); ?>;
        const badge = document.querySelector('.itg-iw-int-health-badge');
        if (!badge) {
            return;
        }
        const online = <?= json_encode((string) __('Online', 'glpiintegaglpi'), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE); ?>;
        const offline = <?= json_encode((string) __('Offline', 'glpiintegaglpi'), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE); ?>;
        fetch(proxyUrl, { credentials: 'same-origin', headers: { 'Accept': 'application/json' } })
            .then(function (r) {
                return r.text().then(function (t) {
                    var b = null;
                    try {
                        b = t ? JSON.parse(t) : null;
                    } catch (e) {
                        b = null;
                    }
                    return b;
                });
            })
            .then(function (d) {
                if (d && d.ok === true) {
                    badge.className = 'badge bg-success itg-iw-int-health-badge';
                    badge.textContent = online;
                } else {
                    badge.className = 'badge bg-danger itg-iw-int-health-badge';
                    badge.textContent = offline;
                }
            })
            .catch(function () {
                badge.className = 'badge bg-danger itg-iw-int-health-badge';
                badge.textContent = offline;
            });
    })();
    </script>
<?php } ?>
