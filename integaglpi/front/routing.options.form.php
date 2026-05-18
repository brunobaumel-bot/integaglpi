<?php

declare(strict_types=1);

use GlpiPlugin\Integaglpi\Plugin;
use GlpiPlugin\Integaglpi\Queue;
use GlpiPlugin\Integaglpi\Service\PluginConfigService;
use GlpiPlugin\Integaglpi\Service\QueueService;
use GlpiPlugin\Integaglpi\Service\RoutingOptionService;
use GlpiPlugin\Integaglpi\Support\AssetRenderer;

include '../../../inc/includes.php';

error_log('[integaglpi][routing_option][REQUEST] method=' . ($_SERVER['REQUEST_METHOD'] ?? '') . ' uri=' . ($_SERVER['REQUEST_URI'] ?? ''));

Session::checkLoginUser();
Plugin::requireUpdate();

$pluginConfigService  = new PluginConfigService();
$queueService         = new QueueService($pluginConfigService);
$routingOptionService = new RoutingOptionService($pluginConfigService);
$redirectId           = 0;

// ── POST ──────────────────────────────────────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    try {
        if (isset($_POST['save_routing_option'])) {
            $redirectId = $routingOptionService->save($_POST);
            Session::addMessageAfterRedirect(__('Routing option saved successfully.', 'glpiintegaglpi'));
        } elseif (isset($_POST['delete_routing_option']) && !empty($_POST['id'])) {
            $routingOptionService->delete((int) $_POST['id']);
            Session::addMessageAfterRedirect(__('Routing option deleted.', 'glpiintegaglpi'));
        }
    } catch (Throwable $exception) {
        error_log('[integaglpi][routing_option][error] ' . $exception->getMessage());
        error_log($exception->getTraceAsString());
        Session::addMessageAfterRedirect($exception->getMessage(), false, ERROR);
        if (!empty($_POST['id'])) {
            $redirectId = (int) $_POST['id'];
        }
    }

    Html::redirect(Plugin::getRoutingOptionsAdminUrl() . ($redirectId > 0 ? '?id=' . $redirectId : ''));
}

// ── GET ───────────────────────────────────────────────────────────────────────
$isConfigured = $pluginConfigService->isConfigured();
$options      = [];
$queues       = [];
$externalDbError = null;

if ($isConfigured) {
    try {
        $options = $routingOptionService->getAll();
        $queues = $queueService->getQueues();
    } catch (Throwable $exception) {
        error_log('[integaglpi][routing_option][external_db] ' . $exception->getMessage());
        $externalDbError = __(
            'Não foi possível carregar opções de roteamento. Revise a conexão PostgreSQL externa.',
            'glpiintegaglpi'
        );
    }
}

$editing = null;
if (!empty($_GET['id']) && $externalDbError === null) {
    try {
        $editing = $routingOptionService->getById((int) $_GET['id']);
    } catch (Throwable $exception) {
        error_log('[integaglpi][routing_option][external_db_edit] ' . $exception->getMessage());
        $externalDbError = __(
            'Não foi possível carregar a opção selecionada. Revise a conexão PostgreSQL externa.',
            'glpiintegaglpi'
        );
    }
}

Html::header(__('WhatsApp — Routing options', 'glpiintegaglpi'), $_SERVER['PHP_SELF'], 'plugins', Queue::class);
AssetRenderer::renderIntegaglpiJs();

require PLUGIN_INTEGAGLPI_ROOT . '/templates/routing_options.php';

Html::footer();
