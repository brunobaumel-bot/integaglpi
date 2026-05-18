<?php

declare(strict_types=1);

/** @var \GlpiPlugin\Integaglpi\Renderer\ConfigPageRenderer $this */
/** @var array<string, mixed> $connectionConfig */
/** @var bool $isConfigured */
/** @var string|null $externalDbError */

$configUrl = \GlpiPlugin\Integaglpi\Plugin::getQueueAdminUrl();
$integaglpiHealthProxyUrl = \GlpiPlugin\Integaglpi\Plugin::getWebBasePath() . '/front/health.proxy.php';
$configService = new \GlpiPlugin\Integaglpi\Service\PluginConfigService();
$routingOptionService = new \GlpiPlugin\Integaglpi\Service\RoutingOptionService($configService);
$externalDbError = isset($externalDbError) && is_string($externalDbError) ? $externalDbError : null;
$routingOptions = [];
if ($isConfigured && $externalDbError === null) {
    try {
        $routingOptions = $routingOptionService->getAll();
    } catch (\Throwable $exception) {
        error_log('[integaglpi][config][routing_options] ' . $exception->getMessage());
        $externalDbError = __('Não foi possível carregar filas/opções de roteamento. Revise a conexão PostgreSQL externa.', 'glpiintegaglpi');
    }
}
$messageConfig = $configService->getMessageConfig();
$messageCatalogGroups = $configService->getMessageCatalogGrouped();
$businessHoursConfig = $configService->getBusinessHoursConfig();
$messageCatalogAudit = $configService->getMessageCatalogAudit();
$localTemplates = $configService->getLocalTemplates();
$aiSupervisorEnabled = $configService->isAiSupervisorEnabled();
$activeTab = (string) ($_GET['tab'] ?? 'connection');
if (!in_array($activeTab, ['connection', 'queues', 'messages', 'templates', 'contact_profile', 'diagnostics'], true)) {
    $activeTab = 'connection';
}

$opsDiagnostics = null;
$opsDiagnosticsError = null;
if ($activeTab === 'diagnostics') {
    try {
        $diagnosticsClient = new \GlpiPlugin\Integaglpi\Service\IntegrationServiceClient($configService);
        $diagnosticsResponse = $diagnosticsClient->getDiagnostics();
        if (!empty($diagnosticsResponse['success']) && is_array($diagnosticsResponse['body'] ?? null)) {
            $opsDiagnostics = $diagnosticsResponse['body'];
        } else {
            $opsDiagnosticsError = __('Não foi possível carregar diagnóstico operacional agora.', 'glpiintegaglpi');
        }
    } catch (\Throwable $exception) {
        error_log('[integaglpi][diagnostics][error] ' . $exception->getMessage());
        $opsDiagnosticsError = __('Não foi possível carregar diagnóstico operacional agora.', 'glpiintegaglpi');
    }
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
    <li class="nav-item">
        <a class="nav-link <?= $activeTab === 'templates' ? 'active' : ''; ?>"
           href="<?= $this->escape($tabUrl('templates')); ?>">
            <?= $this->escape(__('Templates locais', 'glpiintegaglpi')); ?>
        </a>
    </li>
    <li class="nav-item">
        <a class="nav-link <?= $activeTab === 'contact_profile' ? 'active' : ''; ?>"
           href="<?= $this->escape($tabUrl('contact_profile')); ?>">
            <?= $this->escape(__('Recepção Inteligente', 'glpiintegaglpi')); ?>
        </a>
    </li>
    <li class="nav-item">
        <a class="nav-link <?= $activeTab === 'diagnostics' ? 'active' : ''; ?>"
           href="<?= $this->escape($tabUrl('diagnostics')); ?>">
            <?= $this->escape(__('Diagnóstico', 'glpiintegaglpi')); ?>
        </a>
    </li>
</ul>

<link rel="stylesheet" type="text/css" href="<?= $this->escape(\GlpiPlugin\Integaglpi\Plugin::getWebBasePath() . '/css/whatsapp.css'); ?>">

<?php if ($externalDbError !== null) { ?>
    <div class="alert alert-warning">
        <?= $this->escape($externalDbError); ?>
    </div>
<?php } ?>

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
                        <label class="form-label"><?= $this->escape(__('Integration-service URL', 'glpiintegaglpi')); ?></label>
                        <input
                            type="url"
                            name="integration_service_url"
                            class="form-control"
                            value="<?= $this->escape((string) ($connectionConfig['integration_service_url'] ?? 'http://127.0.0.1:3001')); ?>"
                            required
                        >
                        <small class="text-muted"><?= $this->escape(__('Base URL used by the plugin to call Node. Production normally uses http://127.0.0.1:3002.', 'glpiintegaglpi')); ?></small>
                    </div>
                    <div class="col-md-12">
                        <label class="form-label"><?= $this->escape(__('Integration service auth key', 'glpiintegaglpi')); ?></label>
                        <input type="password" name="integration_auth_key" class="form-control" value="" autocomplete="new-password" placeholder="<?= $this->escape(__('Leave blank to keep the current key. Must match Node .env INTEGRATION_SERVICE_API_KEY.', 'glpiintegaglpi')); ?>">
                        <small class="text-muted"><?= $this->escape(__('Bearer token sent to the Node integration-service for outbound WhatsApp messages.', 'glpiintegaglpi')); ?></small>
                    </div>
                    <div class="col-md-12">
                        <div class="form-check">
                            <input
                                class="form-check-input"
                                type="checkbox"
                                name="ai_supervisor_enabled"
                                value="1"
                                id="ai_supervisor_enabled"
                                <?= $aiSupervisorEnabled ? "checked='checked'" : ''; ?>
                            >
                            <label class="form-check-label" for="ai_supervisor_enabled">
                                <?= $this->escape(__('Habilitar IA Supervisora no GLPI', 'glpiintegaglpi')); ?>
                            </label>
                        </div>
                        <small class="text-muted">
                            <?= $this->escape(__('Controla apenas a UI PHP do supervisor. O Node também precisa estar habilitado no ambiente de TESTE. O padrão seguro é desligado.', 'glpiintegaglpi')); ?>
                        </small>
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
    <?php } elseif ($externalDbError !== null) { ?>
        <div class="alert alert-warning">
            <?= $this->escape(__('As filas e opções de roteamento serão exibidas após corrigir a conexão PostgreSQL externa.', 'glpiintegaglpi')); ?>
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
    <div class="alert alert-info">
        <?= $this->escape(__('Catálogo configurável de mensagens automáticas. O plugin não envia mensagens de teste e não consulta a API de templates da Meta.', 'glpiintegaglpi')); ?>
    </div>
    <?php if (!$isConfigured) { ?>
        <div class="alert alert-warning">
            <?= $this->escape(__('Configure a conexão PostgreSQL externa antes de editar o catálogo avançado.', 'glpiintegaglpi')); ?>
        </div>
    <?php } ?>
    <div class="card mb-3">
        <div class="card-header"><?= $this->escape(__('Horário Comercial', 'glpiintegaglpi')); ?></div>
        <div class="card-body">
            <form method="post" action="<?= $this->escape($configUrl); ?>?tab=messages">
                <?= \GlpiPlugin\Integaglpi\Plugin::renderCsrfToken(); ?>
                <div class="row g-3 align-items-end">
                    <div class="col-md-12">
                        <div class="form-check">
                            <input type="hidden" name="business_hours_enabled" value="0">
                            <input class="form-check-input" type="checkbox" name="business_hours_enabled" value="1" id="business_hours_enabled" <?= !empty($businessHoursConfig['business_hours_enabled']) ? "checked='checked'" : ''; ?>>
                            <label class="form-check-label" for="business_hours_enabled">
                                <?= $this->escape(__('Habilitar mensagem fora do horário comercial', 'glpiintegaglpi')); ?>
                            </label>
                        </div>
                    </div>
                    <div class="col-md-3">
                        <label class="form-label"><?= $this->escape(__('Timezone', 'glpiintegaglpi')); ?></label>
                        <input type="text" name="business_hours_timezone" class="form-control" value="<?= $this->escape((string) ($businessHoursConfig['timezone'] ?? 'America/Sao_Paulo')); ?>">
                    </div>
                    <div class="col-md-2">
                        <label class="form-label"><?= $this->escape(__('Seg-Sex início', 'glpiintegaglpi')); ?></label>
                        <input type="time" name="weekday_start_time" class="form-control" value="<?= $this->escape((string) ($businessHoursConfig['weekday_start_time'] ?? '08:00')); ?>" required>
                    </div>
                    <div class="col-md-2">
                        <label class="form-label"><?= $this->escape(__('Seg-Sex fim', 'glpiintegaglpi')); ?></label>
                        <input type="time" name="weekday_end_time" class="form-control" value="<?= $this->escape((string) ($businessHoursConfig['weekday_end_time'] ?? '18:00')); ?>" required>
                    </div>
                    <div class="col-md-2">
                        <label class="form-label"><?= $this->escape(__('Cooldown min.', 'glpiintegaglpi')); ?></label>
                        <input type="number" name="cooldown_minutes" class="form-control" min="1" max="1440" value="<?= (int) ($businessHoursConfig['cooldown_minutes'] ?? 60); ?>">
                    </div>
                    <div class="col-md-3">
                        <label class="form-label"><?= $this->escape(__('Feriado', 'glpiintegaglpi')); ?></label>
                        <select name="holiday_behavior" class="form-select">
                            <?php foreach (['normal', 'closed', 'custom'] as $holidayBehavior) { ?>
                                <option value="<?= $this->escape($holidayBehavior); ?>" <?= (string) ($businessHoursConfig['holiday_behavior'] ?? 'normal') === $holidayBehavior ? "selected='selected'" : ''; ?>>
                                    <?= $this->escape($holidayBehavior); ?>
                                </option>
                            <?php } ?>
                        </select>
                    </div>
                    <div class="col-md-3">
                        <div class="form-check mb-2">
                            <input type="hidden" name="saturday_enabled" value="0">
                            <input class="form-check-input" type="checkbox" name="saturday_enabled" value="1" id="saturday_enabled" <?= !empty($businessHoursConfig['saturday_enabled']) ? "checked='checked'" : ''; ?>>
                            <label class="form-check-label" for="saturday_enabled"><?= $this->escape(__('Sábado habilitado', 'glpiintegaglpi')); ?></label>
                        </div>
                        <div class="d-flex gap-2">
                            <input type="time" name="saturday_start_time" class="form-control" value="<?= $this->escape((string) ($businessHoursConfig['saturday_start_time'] ?? '')); ?>">
                            <input type="time" name="saturday_end_time" class="form-control" value="<?= $this->escape((string) ($businessHoursConfig['saturday_end_time'] ?? '')); ?>">
                        </div>
                    </div>
                    <div class="col-md-3">
                        <div class="form-check mb-2">
                            <input type="hidden" name="sunday_enabled" value="0">
                            <input class="form-check-input" type="checkbox" name="sunday_enabled" value="1" id="sunday_enabled" <?= !empty($businessHoursConfig['sunday_enabled']) ? "checked='checked'" : ''; ?>>
                            <label class="form-check-label" for="sunday_enabled"><?= $this->escape(__('Domingo habilitado', 'glpiintegaglpi')); ?></label>
                        </div>
                        <div class="d-flex gap-2">
                            <input type="time" name="sunday_start_time" class="form-control" value="<?= $this->escape((string) ($businessHoursConfig['sunday_start_time'] ?? '')); ?>">
                            <input type="time" name="sunday_end_time" class="form-control" value="<?= $this->escape((string) ($businessHoursConfig['sunday_end_time'] ?? '')); ?>">
                        </div>
                    </div>
                    <div class="col-md-6">
                        <small class="text-muted">
                            <?= $this->escape(__('Evento vinculado: outside_business_hours_message. Se a janela de 24h estiver fechada, o Node não envia texto livre sem template.', 'glpiintegaglpi')); ?>
                        </small>
                    </div>
                    <div class="col-md-12">
                        <button type="submit" name="save_business_hours" value="1" class="btn btn-primary">
                            <?= $this->escape(__('Salvar horário comercial', 'glpiintegaglpi')); ?>
                        </button>
                    </div>
                </div>
            </form>
        </div>
    </div>
    <?php foreach ($messageCatalogGroups as $groupName => $messages) { ?>
        <div class="card mb-3">
            <div class="card-header"><?= $this->escape((string) $groupName); ?></div>
            <div class="card-body">
                <?php foreach ($messages as $message) { ?>
                    <?php $eventKey = (string) ($message['event_key'] ?? ''); ?>
                    <form method="post" action="<?= $this->escape($configUrl); ?>?tab=messages" class="border rounded p-3 mb-3 js-integaglpi-message-catalog-form">
                        <?= \GlpiPlugin\Integaglpi\Plugin::renderCsrfToken(); ?>
                        <input type="hidden" name="event_key" value="<?= $this->escape($eventKey); ?>">
                        <div class="d-flex justify-content-between gap-2 align-items-start">
                            <div>
                                <code><?= $this->escape($eventKey); ?></code>
                                <div class="small text-muted"><?= $this->escape((string) ($message['description'] ?? '')); ?></div>
                            </div>
                            <div class="form-check">
                                <input type="hidden" name="is_active" value="0">
                                <input class="form-check-input" type="checkbox" name="is_active" value="1" id="msg_active_<?= $this->escape($eventKey); ?>" <?= !empty($message['is_active']) ? "checked='checked'" : ''; ?>>
                                <label class="form-check-label" for="msg_active_<?= $this->escape($eventKey); ?>"><?= $this->escape(__('Ativa', 'glpiintegaglpi')); ?></label>
                            </div>
                        </div>
                        <div class="row g-3 mt-1">
                            <div class="col-md-8">
                                <label class="form-label"><?= $this->escape(__('Texto customizado', 'glpiintegaglpi')); ?></label>
                                <textarea name="custom_text" class="form-control js-message-preview-source" rows="3" placeholder="<?= $this->escape((string) ($message['default_text'] ?? '')); ?>"><?= $this->escape((string) ($message['custom_text'] ?? '')); ?></textarea>
                                <small class="text-muted"><?= $this->escape(__('Default seguro:', 'glpiintegaglpi')); ?> <?= $this->escape((string) ($message['default_text'] ?? '')); ?></small>
                            </div>
                            <div class="col-md-4">
                                <label class="form-label"><?= $this->escape(__('Tipo de envio', 'glpiintegaglpi')); ?></label>
                                <select name="send_type" class="form-select">
                                    <?php foreach (['text', 'interactive_buttons', 'interactive_list', 'template', 'internal_only'] as $sendType) { ?>
                                        <option value="<?= $this->escape($sendType); ?>" <?= (string) ($message['send_type'] ?? 'text') === $sendType ? "selected='selected'" : ''; ?>>
                                            <?= $this->escape($sendType); ?>
                                        </option>
                                    <?php } ?>
                                </select>
                                <label class="form-label mt-2"><?= $this->escape(__('Template local associado', 'glpiintegaglpi')); ?></label>
                                <input type="text" name="template_name" class="form-control" value="<?= $this->escape((string) ($message['template_name'] ?? '')); ?>" placeholder="nome_template_meta">
                            </div>
                            <div class="col-md-4">
                                <label class="form-label"><?= $this->escape(__('Idioma', 'glpiintegaglpi')); ?></label>
                                <input type="text" name="language" class="form-control" value="<?= $this->escape((string) ($message['language'] ?? 'pt_BR')); ?>">
                            </div>
                            <div class="col-md-4">
                                <div class="form-check mt-4">
                                    <input type="hidden" name="expects_response" value="0">
                                    <input class="form-check-input" type="checkbox" name="expects_response" value="1" id="msg_response_<?= $this->escape($eventKey); ?>" <?= !empty($message['expects_response']) ? "checked='checked'" : ''; ?>>
                                    <label class="form-check-label" for="msg_response_<?= $this->escape($eventKey); ?>"><?= $this->escape(__('Espera resposta', 'glpiintegaglpi')); ?></label>
                                </div>
                            </div>
                            <div class="col-md-4">
                                <label class="form-label"><?= $this->escape(__('Fallback', 'glpiintegaglpi')); ?></label>
                                <input type="text" name="fallback_text" class="form-control" value="<?= $this->escape((string) ($message['fallback_text'] ?? '')); ?>">
                            </div>
                            <div class="col-md-6">
                                <label class="form-label"><?= $this->escape(__('Botões JSON', 'glpiintegaglpi')); ?></label>
                                <textarea name="buttons_json" class="form-control font-monospace" rows="3"><?= $this->escape((string) ($message['buttons_json'] ?? '[]')); ?></textarea>
                            </div>
                            <div class="col-md-6">
                                <label class="form-label"><?= $this->escape(__('Lista JSON', 'glpiintegaglpi')); ?></label>
                                <textarea name="list_options_json" class="form-control font-monospace" rows="3"><?= $this->escape((string) ($message['list_options_json'] ?? '[]')); ?></textarea>
                            </div>
                            <div class="col-md-8">
                                <div class="alert alert-secondary py-2 mb-0">
                                    <strong><?= $this->escape(__('Preview:', 'glpiintegaglpi')); ?></strong>
                                    <span class="js-message-preview"><?= $this->escape((string) (($message['custom_text'] ?? '') ?: ($message['default_text'] ?? ''))); ?></span>
                                </div>
                            </div>
                            <div class="col-md-4 text-end">
                                <button type="submit" name="save_message_catalog" value="1" class="btn btn-primary">
                                    <?= $this->escape(__('Salvar evento', 'glpiintegaglpi')); ?>
                                </button>
                            </div>
                        </div>
                    </form>
                <?php } ?>
            </div>
        </div>
    <?php } ?>
    <div class="card mb-3">
        <div class="card-header"><?= $this->escape(__('Histórico recente do catálogo', 'glpiintegaglpi')); ?></div>
        <div class="table-responsive">
            <table class="table table-sm mb-0">
                <thead><tr><th>event_key</th><th>action</th><th>changed_by</th><th>changed_at</th></tr></thead>
                <tbody>
                <?php foreach ($messageCatalogAudit as $auditRow) { ?>
                    <tr>
                        <td><code><?= $this->escape((string) ($auditRow['event_key'] ?? '')); ?></code></td>
                        <td><?= $this->escape((string) ($auditRow['action'] ?? '')); ?></td>
                        <td><?= (int) ($auditRow['changed_by'] ?? 0); ?></td>
                        <td><?= $this->escape((string) ($auditRow['changed_at'] ?? '')); ?></td>
                    </tr>
                <?php } ?>
                <?php if ($messageCatalogAudit === []) { ?>
                    <tr><td colspan="4" class="text-muted"><?= $this->escape(__('Sem alterações recentes.', 'glpiintegaglpi')); ?></td></tr>
                <?php } ?>
                </tbody>
            </table>
        </div>
    </div>
<?php } ?>

<?php if ($activeTab === 'templates') { ?>
    <div class="alert alert-info">
        <?= $this->escape(__('Catálogo local/manual de templates aprovados na Meta. Esta tela não consulta a API da Meta, não armazena token e não envia templates automaticamente.', 'glpiintegaglpi')); ?>
    </div>
    <div class="card mb-3">
        <div class="card-header"><?= $this->escape(__('Novo template local', 'glpiintegaglpi')); ?></div>
        <div class="card-body">
            <form method="post" action="<?= $this->escape($configUrl); ?>?tab=templates">
                <?= \GlpiPlugin\Integaglpi\Plugin::renderCsrfToken(); ?>
                <input type="hidden" name="template_id" value="">
                <div class="row g-3">
                    <div class="col-md-4">
                        <label class="form-label"><?= $this->escape(__('Nome exato na Meta', 'glpiintegaglpi')); ?></label>
                        <input type="text" name="template_name" class="form-control" required>
                    </div>
                    <div class="col-md-2">
                        <label class="form-label"><?= $this->escape(__('Idioma', 'glpiintegaglpi')); ?></label>
                        <input type="text" name="template_language" class="form-control" placeholder="pt_BR" required>
                    </div>
                    <div class="col-md-3">
                        <label class="form-label"><?= $this->escape(__('Categoria', 'glpiintegaglpi')); ?></label>
                        <input type="text" name="template_category" class="form-control" placeholder="utility">
                    </div>
                    <div class="col-md-3 d-flex align-items-end">
                        <div class="form-check mb-2">
                            <input class="form-check-input" type="checkbox" name="template_is_active" value="1" checked>
                            <label class="form-check-label"><?= $this->escape(__('Ativo', 'glpiintegaglpi')); ?></label>
                        </div>
                    </div>
                    <div class="col-md-12">
                        <label class="form-label"><?= $this->escape(__('Corpo / preview', 'glpiintegaglpi')); ?></label>
                        <textarea name="template_body" class="form-control" rows="4" required></textarea>
                    </div>
                    <div class="col-md-12">
                        <button type="submit" name="save_local_template" value="1" class="btn btn-primary">
                            <?= $this->escape(__('Salvar template local', 'glpiintegaglpi')); ?>
                        </button>
                    </div>
                </div>
            </form>
        </div>
    </div>

    <?php if ($localTemplates === []) { ?>
        <div class="alert alert-secondary">
            <?= $this->escape(__('Nenhum template local cadastrado.', 'glpiintegaglpi')); ?>
        </div>
    <?php } ?>

    <?php foreach ($localTemplates as $template) { ?>
        <div class="card mb-3">
            <div class="card-header d-flex justify-content-between align-items-center">
                <span>
                    <code><?= $this->escape((string) $template['name']); ?></code>
                    <?= $this->escape((string) $template['language']); ?>
                </span>
                <span class="badge <?= !empty($template['is_active']) ? 'bg-success' : 'bg-secondary'; ?>">
                    <?= $this->escape(!empty($template['is_active']) ? __('Ativo', 'glpiintegaglpi') : __('Inativo', 'glpiintegaglpi')); ?>
                </span>
            </div>
            <div class="card-body">
                <form method="post" action="<?= $this->escape($configUrl); ?>?tab=templates">
                    <?= \GlpiPlugin\Integaglpi\Plugin::renderCsrfToken(); ?>
                    <input type="hidden" name="template_id" value="<?= $this->escape((string) $template['id']); ?>">
                    <div class="row g-3">
                        <div class="col-md-4">
                            <label class="form-label"><?= $this->escape(__('Nome exato na Meta', 'glpiintegaglpi')); ?></label>
                            <input type="text" name="template_name" class="form-control" value="<?= $this->escape((string) $template['name']); ?>" required>
                        </div>
                        <div class="col-md-2">
                            <label class="form-label"><?= $this->escape(__('Idioma', 'glpiintegaglpi')); ?></label>
                            <input type="text" name="template_language" class="form-control" value="<?= $this->escape((string) $template['language']); ?>" required>
                        </div>
                        <div class="col-md-3">
                            <label class="form-label"><?= $this->escape(__('Categoria', 'glpiintegaglpi')); ?></label>
                            <input type="text" name="template_category" class="form-control" value="<?= $this->escape((string) $template['category']); ?>">
                        </div>
                        <div class="col-md-3 d-flex align-items-end">
                            <div class="form-check mb-2">
                                <input class="form-check-input" type="checkbox" name="template_is_active" value="1" <?= !empty($template['is_active']) ? "checked='checked'" : ''; ?>>
                                <label class="form-check-label"><?= $this->escape(__('Ativo', 'glpiintegaglpi')); ?></label>
                            </div>
                        </div>
                        <div class="col-md-12">
                            <label class="form-label"><?= $this->escape(__('Corpo / preview', 'glpiintegaglpi')); ?></label>
                            <textarea name="template_body" class="form-control" rows="4" required><?= $this->escape((string) $template['body']); ?></textarea>
                        </div>
                        <div class="col-md-12 d-flex gap-2">
                            <button type="submit" name="save_local_template" value="1" class="btn btn-primary">
                                <?= $this->escape(__('Salvar', 'glpiintegaglpi')); ?>
                            </button>
                            <?php if (!empty($template['is_active'])) { ?>
                                <button type="submit" name="disable_local_template" value="1" class="btn btn-outline-secondary">
                                    <?= $this->escape(__('Desativar', 'glpiintegaglpi')); ?>
                                </button>
                            <?php } else { ?>
                                <button type="submit" name="enable_local_template" value="1" class="btn btn-outline-success">
                                    <?= $this->escape(__('Ativar', 'glpiintegaglpi')); ?>
                                </button>
                            <?php } ?>
                        </div>
                    </div>
                </form>
            </div>
        </div>
    <?php } ?>
<?php } ?>

<?php if ($activeTab === 'contact_profile') {
    $contactProfileConfigService = new \GlpiPlugin\Integaglpi\Service\ContactProfileConfigService();
    $contactProfileConfig = $contactProfileConfigService->getConfig();
    $cpBoolLabels = [
        'contact_profile_collection_enabled' => __('Habilitar coleta de perfil do contato', 'glpiintegaglpi'),
        'contact_profile_require_name'       => __('Solicitar nome do contato', 'glpiintegaglpi'),
        'contact_profile_require_company'    => __('Solicitar empresa do contato', 'glpiintegaglpi'),
        'contact_profile_require_equipment'  => __('Solicitar equipamento/sistema afetado', 'glpiintegaglpi'),
        'contact_profile_require_summary'    => __('Solicitar resumo do problema', 'glpiintegaglpi'),
        'contact_profile_confirmation_enabled' => __('Exibir confirmação ao final da coleta', 'glpiintegaglpi'),
        'contact_profile_use_buttons'        => __('Usar botões interativos (quando disponível)', 'glpiintegaglpi'),
        'ticket_title_enrichment_enabled'    => __('Enriquecer título do ticket com dados coletados', 'glpiintegaglpi'),
    ];
    $cpPromptLabels = [
        'contact_profile_prompt_name'      => __('Pergunta: nome do contato', 'glpiintegaglpi'),
        'contact_profile_prompt_company'   => __('Pergunta: empresa do contato', 'glpiintegaglpi'),
        'contact_profile_prompt_equipment' => __('Pergunta: equipamento/sistema', 'glpiintegaglpi'),
        'contact_profile_prompt_summary'   => __('Pergunta: resumo do problema', 'glpiintegaglpi'),
        'contact_profile_confirm_message'  => __('Mensagem de confirmação final', 'glpiintegaglpi'),
    ];
    $cpPromptMode = (string) ($contactProfileConfig['contact_profile_prompt_mode'] ?? 'hybrid');
    if (!in_array($cpPromptMode, ['hybrid', 'single_message', 'step_by_step'], true)) {
        $cpPromptMode = 'hybrid';
    }
    $entityResolutionMode = (string) ($contactProfileConfig['entity_resolution_mode'] ?? 'defer_until_known');
    if ($entityResolutionMode !== 'defer_until_known') {
        $entityResolutionMode = 'defer_until_known';
    }
    ?>
    <div class="card mb-3">
        <div class="card-header"><?= $this->escape(__('Recepção Inteligente', 'glpiintegaglpi')); ?></div>
        <div class="card-body">
            <p class="text-muted small mb-3">
                <?= $this->escape(__('Configure a coleta automática de dados do contato antes de abrir o ticket. Todos os recursos estão desabilitados por padrão.', 'glpiintegaglpi')); ?>
            </p>
            <form method="post" action="<?= $this->escape($configUrl); ?>?tab=contact_profile">
                <?= \GlpiPlugin\Integaglpi\Plugin::renderCsrfToken(); ?>

                <h6 class="mb-2"><?= $this->escape(__('Funcionalidades', 'glpiintegaglpi')); ?></h6>
                <div class="row g-2 mb-4">
                    <?php foreach ($cpBoolLabels as $field => $label) { ?>
                        <div class="col-md-6">
                            <div class="form-check">
                                <input
                                    class="form-check-input"
                                    type="checkbox"
                                    name="<?= $this->escape($field); ?>"
                                    value="1"
                                    id="cp_<?= $this->escape($field); ?>"
                                    <?= !empty($contactProfileConfig[$field]) ? "checked='checked'" : ''; ?>
                                >
                                <label class="form-check-label" for="cp_<?= $this->escape($field); ?>">
                                    <?= $this->escape($label); ?>
                                </label>
                            </div>
                        </div>
                    <?php } ?>
                </div>

                <div class="mb-4">
                    <label class="form-label" for="cp_entity_resolution_mode">
                        <?= $this->escape(__('Resolução de entidade', 'glpiintegaglpi')); ?>
                    </label>
                    <select class="form-select" name="entity_resolution_mode" id="cp_entity_resolution_mode">
                        <option value="defer_until_known" <?= $entityResolutionMode === 'defer_until_known' ? "selected='selected'" : ''; ?>>
                            <?= $this->escape(__('Aguardar seleção manual da entidade', 'glpiintegaglpi')); ?>
                        </option>
                    </select>
                    <small class="text-muted">
                        <?= $this->escape(__('Contatos com memória ativa usam a entidade lembrada; os demais aguardam seleção manual na Central.', 'glpiintegaglpi')); ?>
                    </small>
                </div>

                <div class="mb-4">
                    <label class="form-label" for="cp_contact_profile_prompt_mode">
                        <?= $this->escape(__('Modo de pergunta', 'glpiintegaglpi')); ?>
                    </label>
                    <select class="form-select" name="contact_profile_prompt_mode" id="cp_contact_profile_prompt_mode">
                        <option value="step_by_step" selected="selected">
                            <?= $this->escape(__('Passo a passo', 'glpiintegaglpi')); ?>
                        </option>
                    </select>
                    <small class="text-muted">
                        <?= $this->escape(__('Nesta fase, o runtime usa perguntas passo a passo com botões quando disponíveis.', 'glpiintegaglpi')); ?>
                    </small>
                </div>

                <h6 class="mb-2"><?= $this->escape(__('Mensagens de coleta', 'glpiintegaglpi')); ?></h6>
                <div class="row g-3 mb-3">
                    <?php foreach ($cpPromptLabels as $field => $label) { ?>
                        <div class="col-md-12">
                            <label class="form-label" for="cp_prompt_<?= $this->escape($field); ?>">
                                <?= $this->escape($label); ?>
                            </label>
                            <textarea
                                class="form-control"
                                name="<?= $this->escape($field); ?>"
                                id="cp_prompt_<?= $this->escape($field); ?>"
                                rows="2"
                            ><?= $this->escape((string) ($contactProfileConfig[$field] ?? '')); ?></textarea>
                        </div>
                    <?php } ?>
                </div>

                <div class="alert alert-info">
                    <?= $this->escape(__('Campos de texto vazios serão substituídos pelo texto padrão ao salvar.', 'glpiintegaglpi')); ?>
                </div>

                <button type="submit" name="save_contact_profile" value="1" class="btn btn-primary">
                    <?= $this->escape(__('Salvar Recepção Inteligente', 'glpiintegaglpi')); ?>
                </button>
            </form>
        </div>
    </div>
<?php } ?>

<?php if ($activeTab === 'diagnostics') { ?>
    <div class="alert alert-info">
        <?= $this->escape(__('Diagnóstico somente leitura. Esta tela consulta apenas o integration-service e não executa comandos de servidor.', 'glpiintegaglpi')); ?>
    </div>
    <?php if ($opsDiagnosticsError !== null) { ?>
        <div class="alert alert-warning">
            <?= $this->escape($opsDiagnosticsError); ?>
        </div>
    <?php } elseif (is_array($opsDiagnostics)) { ?>
        <?php
        $postgres = is_array($opsDiagnostics['postgres'] ?? null) ? $opsDiagnostics['postgres'] : [];
        $glpiApi = is_array($opsDiagnostics['glpi_api'] ?? null) ? $opsDiagnostics['glpi_api'] : [];
        $meta = is_array($opsDiagnostics['meta'] ?? null) ? $opsDiagnostics['meta'] : [];
        $ai = is_array($opsDiagnostics['ai_supervisor'] ?? null) ? $opsDiagnostics['ai_supervisor'] : [];
        $schema = is_array($opsDiagnostics['schema'] ?? null) ? $opsDiagnostics['schema'] : [];
        $attempts = is_array($opsDiagnostics['entity_selection_attempts'] ?? null) ? $opsDiagnostics['entity_selection_attempts'] : [];
        $deliveryCounts = is_array($opsDiagnostics['delivery_status_counts'] ?? null) ? $opsDiagnostics['delivery_status_counts'] : [];
        ?>
        <div class="row g-3 mb-3">
            <div class="col-md-3">
                <div class="card h-100"><div class="card-body">
                    <div class="text-muted small"><?= $this->escape(__('Node/PostgreSQL', 'glpiintegaglpi')); ?></div>
                    <span class="badge <?= !empty($postgres['ok']) ? 'bg-success' : 'bg-danger'; ?>">
                        <?= $this->escape(!empty($postgres['ok']) ? __('OK', 'glpiintegaglpi') : __('Falha', 'glpiintegaglpi')); ?>
                    </span>
                    <?php if (isset($postgres['latency_ms'])) { ?>
                        <div class="small text-muted mt-2"><?= (int) $postgres['latency_ms']; ?> ms</div>
                    <?php } ?>
                </div></div>
            </div>
            <div class="col-md-3">
                <div class="card h-100"><div class="card-body">
                    <div class="text-muted small"><?= $this->escape(__('GLPI API', 'glpiintegaglpi')); ?></div>
                    <span class="badge <?= !empty($glpiApi['ok']) ? 'bg-success' : 'bg-warning text-dark'; ?>">
                        <?= $this->escape(!empty($glpiApi['ok']) ? __('OK', 'glpiintegaglpi') : __('Atenção', 'glpiintegaglpi')); ?>
                    </span>
                    <?php if (isset($glpiApi['latency_ms'])) { ?>
                        <div class="small text-muted mt-2"><?= (int) $glpiApi['latency_ms']; ?> ms</div>
                    <?php } ?>
                </div></div>
            </div>
            <div class="col-md-3">
                <div class="card h-100"><div class="card-body">
                    <div class="text-muted small"><?= $this->escape(__('Meta guard', 'glpiintegaglpi')); ?></div>
                    <div class="small"><?= $this->escape(__('Allowlist ID', 'glpiintegaglpi')); ?>: <?= !empty($meta['allowed_phone_number_ids_configured']) ? 'OK' : '-'; ?></div>
                    <div class="small"><?= $this->escape(__('Display phone', 'glpiintegaglpi')); ?>: <?= !empty($meta['allowed_display_phone_numbers_configured']) ? 'OK' : '-'; ?></div>
                </div></div>
            </div>
            <div class="col-md-3">
                <div class="card h-100"><div class="card-body">
                    <div class="text-muted small"><?= $this->escape(__('IA/Ollama', 'glpiintegaglpi')); ?></div>
                    <div class="small"><?= $this->escape(__('Habilitada', 'glpiintegaglpi')); ?>: <?= !empty($ai['enabled']) ? 'SIM' : 'NÃO'; ?></div>
                    <div class="small"><?= $this->escape(__('Dry-run', 'glpiintegaglpi')); ?>: <?= !empty($ai['dry_run']) ? 'SIM' : 'NÃO'; ?></div>
                </div></div>
            </div>
        </div>
        <div class="card mb-3">
            <div class="card-header"><?= $this->escape(__('Schema essencial', 'glpiintegaglpi')); ?></div>
            <div class="card-body d-flex flex-wrap gap-2">
                <?php foreach ($schema as $key => $value) { ?>
                    <span class="badge <?= !empty($value) ? 'bg-success' : 'bg-warning text-dark'; ?>">
                        <?= $this->escape((string) $key); ?>: <?= !empty($value) ? 'OK' : 'PENDENTE'; ?>
                    </span>
                <?php } ?>
            </div>
        </div>
        <div class="card mb-3">
            <div class="card-header"><?= $this->escape(__('Últimas tentativas de entidade', 'glpiintegaglpi')); ?></div>
            <div class="table-responsive">
                <table class="table table-sm mb-0">
                    <thead><tr><th>conversation_id</th><th>status</th><th>entity</th><th>ticket</th><th>erro</th><th>updated_at</th></tr></thead>
                    <tbody>
                    <?php foreach ($attempts as $attempt) { ?>
                        <?php $attempt = is_array($attempt) ? $attempt : []; ?>
                        <tr>
                            <td><code><?= $this->escape((string) ($attempt['conversation_id'] ?? '')); ?></code></td>
                            <td><?= $this->escape((string) ($attempt['display_status'] ?? $attempt['status'] ?? '')); ?></td>
                            <td><?= (int) ($attempt['glpi_entity_id'] ?? 0); ?></td>
                            <td><?= (int) ($attempt['glpi_ticket_id'] ?? 0); ?></td>
                            <td><?= $this->escape((string) ($attempt['error_message_sanitized'] ?? '')); ?></td>
                            <td><?= $this->escape((string) ($attempt['updated_at'] ?? '')); ?></td>
                        </tr>
                    <?php } ?>
                    <?php if ($attempts === []) { ?>
                        <tr><td colspan="6" class="text-muted"><?= $this->escape(__('Sem tentativas recentes.', 'glpiintegaglpi')); ?></td></tr>
                    <?php } ?>
                    </tbody>
                </table>
            </div>
        </div>
        <div class="card mb-3">
            <div class="card-header"><?= $this->escape(__('Delivery status agregado', 'glpiintegaglpi')); ?></div>
            <div class="card-body d-flex flex-wrap gap-2">
                <?php foreach ($deliveryCounts as $item) { ?>
                    <?php $item = is_array($item) ? $item : []; ?>
                    <span class="badge bg-secondary">
                        <?= $this->escape((string) ($item['status'] ?? 'unknown')); ?>:
                        <?= (int) ($item['total'] ?? 0); ?>
                    </span>
                <?php } ?>
                <?php if ($deliveryCounts === []) { ?>
                    <span class="text-muted"><?= $this->escape(__('Sem eventos agregados.', 'glpiintegaglpi')); ?></span>
                <?php } ?>
            </div>
        </div>
    <?php } ?>
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
