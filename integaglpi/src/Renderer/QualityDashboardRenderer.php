<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi\Renderer;

use GlpiPlugin\Integaglpi\Plugin;
use GlpiPlugin\Integaglpi\Service\QualityDashboardService;
use Html;

final class QualityDashboardRenderer
{
    public function __construct(private readonly QualityDashboardService $service)
    {
    }

    /**
     * @param array<string, mixed> $query
     */
    public function render(array $query): void
    {
        $data = $this->service->getDashboardData($query);
        $template = PLUGIN_INTEGAGLPI_ROOT . '/templates/quality_dashboard.php';

        require $template;
    }

    public function escape(string $value): string
    {
        return Html::cleanInputText($value);
    }

    public function getQualityDashboardUrl(): string
    {
        return Plugin::getQualityDashboardUrl();
    }

    public function getConsoleUrl(array $filters): string
    {
        return $this->service->getConsoleDrillDownUrl($filters);
    }

    public function getTicketUrl(int $ticketId): string
    {
        return Plugin::getTicketUrl($ticketId);
    }

    public function getKbCandidateUrl(int $candidateId = 0): string
    {
        $url = Plugin::getKbCandidatesUrl();
        if ($candidateId > 0) {
            $url .= '?' . http_build_query(['view_id' => $candidateId]);
        }

        return $url;
    }

    /**
     * @param array<string, mixed> $filters
     */
    public function getPageUrl(array $filters, int $page): string
    {
        $filters['page'] = $page;

        return $this->getQualityDashboardUrl() . '?' . http_build_query(array_filter(
            $filters,
            static fn (mixed $value): bool => $value !== '' && $value !== 0 && $value !== null
        ));
    }
}
