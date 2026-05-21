<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi\Renderer;

use GlpiPlugin\Integaglpi\Plugin;
use GlpiPlugin\Integaglpi\Service\ObservabilityService;
use Html;

final class ObservabilityRenderer
{
    public function __construct(private readonly ObservabilityService $service)
    {
    }

    /**
     * @param array<string, mixed> $query
     */
    public function render(array $query): void
    {
        $data = $this->service->getDashboardData($query);
        $template = PLUGIN_INTEGAGLPI_ROOT . '/templates/observability.php';

        require $template;
    }

    public function escape(string $value): string
    {
        return Html::cleanInputText($value);
    }

    public function getObservabilityUrl(): string
    {
        return Plugin::getObservabilityUrl();
    }

    public function getTicketUrl(int $ticketId): string
    {
        return Plugin::getTicketUrl($ticketId);
    }

    /**
     * @param array<string, mixed> $filters
     */
    public function getPageUrl(array $filters, int $page): string
    {
        $filters['page'] = $page;

        return $this->getObservabilityUrl() . '?' . http_build_query(array_filter(
            $filters,
            static fn (mixed $value): bool => $value !== '' && $value !== 0 && $value !== null
        ));
    }
}
