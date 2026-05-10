<?php

declare(strict_types=1);

use GlpiPlugin\Integaglpi\Plugin;
use GlpiPlugin\Integaglpi\Queue;
use GlpiPlugin\Integaglpi\Renderer\ConfigPageRenderer;
use GlpiPlugin\Integaglpi\Service\PluginConfigService;
use GlpiPlugin\Integaglpi\Service\QueueService;
use GlpiPlugin\Integaglpi\Service\RoutingOptionService;

include '../../../inc/includes.php';

error_log('[integaglpi][config][REQUEST] method=' . ($_SERVER['REQUEST_METHOD'] ?? '') . ' uri=' . ($_SERVER['REQUEST_URI'] ?? '') . ' post_keys=' . json_encode(array_keys($_POST ?? []), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

Session::checkLoginUser();

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    Session::checkRight(Plugin::RIGHT_NAME, UPDATE);
} else {
    Session::checkRight(Plugin::RIGHT_NAME, READ);
}

$pluginConfigService = new PluginConfigService();
$queueService = new QueueService($pluginConfigService);
$routingOptionService = new RoutingOptionService($pluginConfigService);

if (
    ($_SERVER['REQUEST_METHOD'] ?? '') === 'GET'
    && (string) ($_GET['debug_get'] ?? '') === '1'
) {
    error_log('[integaglpi][config][DEBUG_GET_BLOCKED] ' . json_encode([
        'action' => (string) ($_GET['action'] ?? ''),
        'get_keys' => array_keys($_GET),
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
    Session::addMessageAfterRedirect(__('GET write actions are disabled for security.', 'glpiintegaglpi'), false, ERROR);
    Html::redirect(Plugin::getQueueAdminUrl());
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (!Plugin::isCsrfValid($_POST)) {
        error_log('[integaglpi][config][csrf] rejected POST without valid CSRF token');
        Session::addMessageAfterRedirect(
            __('Token de segurança inválido. Recarregue a página e tente novamente.', 'glpiintegaglpi'),
            false,
            ERROR
        );
        Html::redirect(Plugin::getQueueAdminUrl());
    }

    $redirectUrl = Plugin::getQueueAdminUrl();

    try {
        if (isset($_POST['save_connection'])) {
            $pluginConfigService->saveConnectionConfig($_POST);
            Session::addMessageAfterRedirect(__('External PostgreSQL connection saved successfully.', 'glpiintegaglpi'));
            $redirectUrl .= '?tab=connection';
        } elseif (isset($_POST['save_routing_option'])) {
            $routingOptionService->save($_POST);
            Session::addMessageAfterRedirect(__('Routing option saved successfully.', 'glpiintegaglpi'));
            $redirectUrl .= '?tab=queues';
        } elseif (isset($_POST['disable_routing_option']) && !empty($_POST['id'])) {
            $routingOptionService->delete((int) $_POST['id']);
            Session::addMessageAfterRedirect(__('Routing option disabled.', 'glpiintegaglpi'));
            $redirectUrl .= '?tab=queues';
        } elseif (isset($_POST['save_messages'])) {
            $pluginConfigService->saveMessageConfig($_POST);
            Session::addMessageAfterRedirect(__('Attendance messages saved successfully.', 'glpiintegaglpi'));
            $redirectUrl .= '?tab=messages';
        } else {
            throw new RuntimeException(__('Configuration form submission was not recognized.', 'glpiintegaglpi'));
        }
    } catch (Throwable $exception) {
        error_log('[integaglpi][config][error] ' . $exception->getMessage());
        error_log($exception->getTraceAsString());
        Session::addMessageAfterRedirect($exception->getMessage(), false, ERROR);

        if (isset($_POST['save_routing_option']) || isset($_POST['disable_routing_option'])) {
            $redirectUrl = Plugin::getQueueAdminUrl() . '?tab=queues';
        } elseif (isset($_POST['save_messages'])) {
            $redirectUrl = Plugin::getQueueAdminUrl() . '?tab=messages';
        }
    }

    Html::redirect($redirectUrl);
}

Html::header(__('WhatsApp plugin configuration', 'glpiintegaglpi'), $_SERVER['PHP_SELF'], 'plugins', Queue::class);
(new ConfigPageRenderer($queueService, $pluginConfigService))->render();
Html::footer();
