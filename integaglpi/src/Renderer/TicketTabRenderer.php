<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi\Renderer;

use GlpiPlugin\Integaglpi\Plugin;
use GlpiPlugin\Integaglpi\Service\TicketRuntimeService;
use GlpiPlugin\Integaglpi\Support\AssetRenderer;
use Html;

final class TicketTabRenderer
{
    public function __construct(private readonly TicketRuntimeService $runtimeService)
    {
    }

    public function getRuntimeService(): TicketRuntimeService
    {
        return $this->runtimeService;
    }

    public function render(\Ticket $ticket): void
    {
        Plugin::requireRead();
        AssetRenderer::renderIntegaglpiJs();

        $runtime = $this->runtimeService->getRuntimeByTicketId((int) $ticket->getID());
        $messages = $this->runtimeService->getMessagesForTicket((int) $ticket->getID());
        $queues = $this->runtimeService->getQueues();
        error_log('[integaglpi][queue][transfer_options] total=' . count($queues) . ' items=' . json_encode(
            array_map(
                static fn (array $q): array => [
                    'id' => (int) ($q['id'] ?? 0),
                    'name' => (string) ($q['name'] ?? ''),
                    'is_active' => (bool) ($q['is_active'] ?? false),
                ],
                $queues
            ),
            JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES
        ));
        $isExternalConfigured = $this->runtimeService->isExternalConfigured();
        $connectionConfig = $this->runtimeService->getConnectionConfig();

        $template = PLUGIN_INTEGAGLPI_ROOT . '/templates/ticket_tab.php';

        require $template;
    }

    public function escape(string $value): string
    {
        return Html::cleanInputText($value);
    }
}
