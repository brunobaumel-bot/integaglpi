<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi\Renderer;

use GlpiPlugin\Integaglpi\Plugin;
use GlpiPlugin\Integaglpi\Service\SupervisorBackofficeService;
use Html;

final class SupervisorBackofficeRenderer
{
    public function __construct(private readonly SupervisorBackofficeService $service)
    {
    }

    /**
     * @param array<string, mixed> $query
     */
    public function render(array $query): void
    {
        $data = $this->service->getDashboardData($query);
        $template = PLUGIN_INTEGAGLPI_ROOT . '/templates/supervisor_backoffice.php';

        require $template;
    }

    public function escape(string $value): string
    {
        return Html::cleanInputText($value);
    }

    public function getSupervisorBackofficeUrl(): string
    {
        return Plugin::getSupervisorBackofficeUrl();
    }

    public function getContractHoursUrl(): string
    {
        return Plugin::getContractHoursUrl();
    }

    public function getAiQualityUrl(): string
    {
        return Plugin::getAiQualityUrl();
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
        $query['page'] = $page;

        return $this->getSupervisorBackofficeUrl() . '?' . http_build_query(
            array_filter(
                $query,
                static fn (mixed $value): bool => $value !== '' && $value !== 0 && $value !== []
            )
        );
    }
}
