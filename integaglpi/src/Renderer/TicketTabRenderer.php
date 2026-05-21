<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi\Renderer;

use GlpiPlugin\Integaglpi\Plugin;
use GlpiPlugin\Integaglpi\Service\TicketContextService;
use GlpiPlugin\Integaglpi\Service\TicketRuntimeService;
use GlpiPlugin\Integaglpi\Service\ManualTicketWhatsappService;
use GlpiPlugin\Integaglpi\Support\AssetRenderer;
use Html;

final class TicketTabRenderer
{
    private TicketContextService $ticketContextService;

    public function __construct(
        private readonly TicketRuntimeService $runtimeService,
        ?TicketContextService $ticketContextService = null
    ) {
        $this->ticketContextService = $ticketContextService ?? new TicketContextService();
    }

    public function getRuntimeService(): TicketRuntimeService
    {
        return $this->runtimeService;
    }

    public function render(\Ticket $ticket, string $view = 'conversations'): void
    {
        Plugin::requireRead();
        AssetRenderer::renderIntegaglpiJs();

        $tabView = $view === 'context' ? 'context' : 'conversations';
        $runtime = null;
        $messages = [];
        $queues = [];
        $context = null;
        $manualWhatsapp = null;
        $externalDbError = null;
        $isExternalConfigured = $this->runtimeService->isExternalConfigured();
        $connectionConfig = $this->runtimeService->getConnectionConfig();

        if ($isExternalConfigured) {
            try {
                $runtime = $this->runtimeService->getRuntimeByTicketId((int) $ticket->getID());
                $messages = $runtime !== null
                    ? $this->runtimeService->getMessagesForTicket((int) $ticket->getID())
                    : [];
                $queues = $this->runtimeService->getQueues();
                $context = $this->ticketContextService->getTicketContext($ticket);
                if ($runtime === null) {
                    $manualWhatsapp = (new ManualTicketWhatsappService())->getViewData($ticket);
                }
            } catch (\Throwable $exception) {
                error_log('[integaglpi][ticket_tab][external_db] ' . $exception->getMessage());
                $externalDbError = __(
                    'Não foi possível carregar a conversa WhatsApp agora. Verifique a conexão PostgreSQL externa.',
                    'glpiintegaglpi'
                );
            }
        }
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

        $template = PLUGIN_INTEGAGLPI_ROOT . '/templates/ticket_tab.php';

        require $template;
    }

    public function escape(string $value): string
    {
        return Html::cleanInputText($value);
    }

    public function getOperationLogUrlForTicket(int $ticketId): string
    {
        return Plugin::getOperationLogUrl() . '?' . http_build_query([
            'ticket_id' => max(0, $ticketId),
        ]);
    }

    public function getOperationLogPanelUrl(): string
    {
        return Plugin::getOperationLogUrl();
    }

    public function getAuditUrlForTicket(int $ticketId): string
    {
        return Plugin::getAuditUrl() . '?' . http_build_query([
            'ticket_id' => $ticketId,
        ]);
    }

    public function getAuditUrlForCorrelation(string $correlationId): string
    {
        return Plugin::getAuditUrl() . '?' . http_build_query([
            'correlation_id' => $correlationId,
        ]);
    }

    public function getOperationalHealthUrl(): string
    {
        return Plugin::getAuditUrl();
    }
}
