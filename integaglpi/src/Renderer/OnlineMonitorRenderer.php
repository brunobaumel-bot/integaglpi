<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi\Renderer;

use GlpiPlugin\Integaglpi\Plugin;
use GlpiPlugin\Integaglpi\Service\OnlineMonitorService;
use Html;

final class OnlineMonitorRenderer
{
    private OnlineMonitorService $service;

    public function __construct(OnlineMonitorService $service)
    {
        $this->service = $service;
    }

    /**
     * @param array<string, mixed> $query
     */
    public function render(array $query, int $userId, bool $supervisor): void
    {
        $data = $this->service->getPageData($query, $userId, $supervisor);
        $template = PLUGIN_INTEGAGLPI_ROOT . '/templates/online_monitor.php';

        require $template;
    }

    public function escape(string $value): string
    {
        return Html::cleanInputText($value);
    }

    public function getOnlineMonitorUrl(): string
    {
        return Plugin::getOnlineMonitorUrl();
    }

    public function getTicketUrl(int $ticketId): string
    {
        return Plugin::getTicketUrl($ticketId);
    }

    public function getTicketContextUrl(int $ticketId): string
    {
        return Plugin::getTicketUrl($ticketId) . '&forcetab=PluginIntegaglpiTicketRuntime$2';
    }

    /**
     * @param array<string, mixed> $filters
     */
    public function getPageUrl(array $filters, int $page): string
    {
        $query = $filters;
        $query['page'] = max(1, $page);

        return $this->getOnlineMonitorUrl() . '?' . http_build_query(array_filter(
            $query,
            static function ($value): bool {
                return $value !== '' && $value !== 0 && $value !== null && $value !== [];
            }
        ));
    }
}
