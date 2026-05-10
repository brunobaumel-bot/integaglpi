<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi\Renderer;

use GlpiPlugin\Integaglpi\Service\PluginConfigService;
use GlpiPlugin\Integaglpi\Service\QueueService;
use GlpiPlugin\Integaglpi\Support\AssetRenderer;
use Html;

final class ConfigPageRenderer
{
    public function __construct(
        private readonly QueueService $queueService,
        private readonly PluginConfigService $pluginConfigService
    ) {
    }

    /**
     * @param array<string, mixed>|null $selectedQueue
     */
    public function render(?array $selectedQueue = null): void
    {
        AssetRenderer::renderIntegaglpiJs();

        $connectionConfig = $this->pluginConfigService->getConnectionConfig();
        $isConfigured = $this->pluginConfigService->isConfigured();
        $queues = $this->queueService->getQueues();
        error_log('[integaglpi][queue][list] config_page_total=' . count($queues));
        $queueUsers = $selectedQueue !== null ? $this->queueService->getQueueUsers((int) $selectedQueue['id']) : [];
        $queueGroups = $selectedQueue !== null ? $this->queueService->getQueueGroups((int) $selectedQueue['id']) : [];
        $template = PLUGIN_INTEGAGLPI_ROOT . '/templates/config.php';

        require $template;
    }

    public function escape(string $value): string
    {
        return Html::cleanInputText($value);
    }
}
