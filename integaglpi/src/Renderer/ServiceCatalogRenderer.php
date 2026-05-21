<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi\Renderer;

use GlpiPlugin\Integaglpi\Plugin;
use GlpiPlugin\Integaglpi\Service\ServiceCatalogService;
use Html;

final class ServiceCatalogRenderer
{
    public function __construct(private readonly ServiceCatalogService $service)
    {
    }

    /**
     * @param array<string, mixed> $query
     * @param array{type: string, message: string, diagnostic?: string}|null $flash
     */
    public function render(array $query, ?array $flash = null): void
    {
        $data = $this->service->getPageData($query, $flash);
        require PLUGIN_INTEGAGLPI_ROOT . '/templates/service_catalog.php';
    }

    public function escape(string $value): string
    {
        return Html::cleanInputText($value);
    }

    public function renderCsrfToken(): string
    {
        return Plugin::renderCsrfToken();
    }

    public function canUpdate(): bool
    {
        return Plugin::canServiceCatalogUpdate();
    }

    public function getServiceCatalogUrl(): string
    {
        return Plugin::getServiceCatalogUrl();
    }

    /**
     * @param array<string, mixed> $filters
     */
    public function getEditUrl(array $filters, int $serviceId): string
    {
        $query = $filters;
        $query['edit_id'] = $serviceId;

        return $this->getServiceCatalogUrl() . '?' . http_build_query($this->cleanQuery($query));
    }

    /**
     * @param array<string, mixed> $query
     * @return array<string, mixed>
     */
    private function cleanQuery(array $query): array
    {
        return array_filter(
            $query,
            static fn (mixed $value): bool => $value !== '' && $value !== 0 && $value !== [] && $value !== null
        );
    }
}
