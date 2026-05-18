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
        $externalDbError = null;
        $queues = [];
        try {
            $queues = $this->queueService->getQueues();
        } catch (\Throwable $exception) {
            error_log('[integaglpi][config][external_db] ' . $exception->getMessage());
            $externalDbError = __(
                'Não foi possível conectar ao PostgreSQL externo. Revise e salve a conexão abaixo.',
                'glpiintegaglpi'
            );
        }
        error_log('[integaglpi][queue][list] config_page_total=' . count($queues));
        $queueUsers = [];
        $queueGroups = [];
        if ($selectedQueue !== null && $externalDbError === null) {
            try {
                $queueUsers = $this->queueService->getQueueUsers((int) $selectedQueue['id']);
                $queueGroups = $this->queueService->getQueueGroups((int) $selectedQueue['id']);
            } catch (\Throwable $exception) {
                error_log('[integaglpi][config][external_db_queue_details] ' . $exception->getMessage());
                $externalDbError = __(
                    'Não foi possível carregar os detalhes da fila. Revise a conexão PostgreSQL externa.',
                    'glpiintegaglpi'
                );
            }
        }
        $template = PLUGIN_INTEGAGLPI_ROOT . '/templates/config.php';

        require $template;
    }

    public function escape(string $value): string
    {
        return Html::cleanInputText($value);
    }
}
