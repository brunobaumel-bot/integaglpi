<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi\Renderer;

use GlpiPlugin\Integaglpi\Plugin;
use GlpiPlugin\Integaglpi\Service\KbCandidateService;
use Html;

final class KbCandidateRenderer
{
    public function __construct(private readonly KbCandidateService $service)
    {
    }

    /**
     * @param array<string, mixed> $query
     * @param array{type: string, message: string}|null $flash
     */
    public function render(array $query, ?array $flash = null): void
    {
        $data = $this->service->getPageData($query, $flash);
        require PLUGIN_INTEGAGLPI_ROOT . '/templates/kb_candidates.php';
    }

    public function escape(string $value): string
    {
        return Html::cleanInputText($value);
    }

    public function renderContent(string $value): string
    {
        return nl2br($this->escape($value), false);
    }

    public function renderCsrfToken(): string
    {
        return Plugin::renderCsrfToken();
    }

    public function getKbCandidatesUrl(): string
    {
        return Plugin::getKbCandidatesUrl();
    }

    /**
     * @param array<string, mixed> $filters
     */
    public function getViewUrl(array $filters, int $candidateId): string
    {
        $query = $filters;
        $query['view_id'] = $candidateId;

        return $this->getKbCandidatesUrl() . '?' . http_build_query($this->cleanQuery($query));
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
