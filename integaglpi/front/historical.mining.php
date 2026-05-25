<?php

declare(strict_types=1);

include '../../../inc/includes.php';

use GlpiPlugin\Integaglpi\AiOperationsMenu;
use GlpiPlugin\Integaglpi\Plugin;
use GlpiPlugin\Integaglpi\Renderer\HistoricalMiningRenderer;
use GlpiPlugin\Integaglpi\Service\HistoricalMiningUiService;
use GlpiPlugin\Integaglpi\Service\PluginConfigService;

Session::checkLoginUser();
Plugin::requireAiOperationsRead();

$service = new HistoricalMiningUiService(new PluginConfigService());
$flash = null;

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (!Plugin::isCsrfValid($_POST)) {
        $flash = [
            'type' => 'danger',
            'message' => __('Token CSRF inválido. Recarregue a página e tente novamente.', 'glpiintegaglpi'),
        ];
    } elseif (trim((string) ($_POST['action'] ?? '')) === 'download_generated') {
        try {
            $service->downloadGeneratedJsonl($_POST, Plugin::getCurrentUserId());
            exit;
        } catch (RuntimeException $exception) {
            $flash = [
                'type' => 'danger',
                'message' => $exception->getMessage(),
            ];
        } catch (Throwable $exception) {
            error_log('[integaglpi][historical_mining_download] ' . preg_replace('/[\r\n]+/', ' ', $exception->getMessage()));
            $flash = [
                'type' => 'danger',
                'message' => __('Não foi possível baixar o JSONL sanitizado.', 'glpiintegaglpi'),
            ];
        }
    } else {
        $flash = $service->handlePost($_POST, $_FILES, Plugin::getCurrentUserId());
    }
}

Html::header(__('Mineração Histórica', 'glpiintegaglpi'), $_SERVER['PHP_SELF'], 'plugins', AiOperationsMenu::class);

$renderer = new HistoricalMiningRenderer();
$renderer->render($service->getPageData($_GET, $flash));

Html::footer();
