<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi\Renderer;

use GlpiPlugin\Integaglpi\Plugin;
use GlpiPlugin\Integaglpi\Service\KnowledgeBaseService;
use Html;

final class KnowledgeBaseRenderer
{
    public function __construct(private readonly KnowledgeBaseService $service)
    {
    }

    /**
     * @param array<string, mixed> $query
     * @param array{type: string, message: string, diagnostic?: string}|null $flash
     */
    public function render(array $query, ?array $flash = null): void
    {
        $data = $this->service->getPageData($query, $flash);
        require PLUGIN_INTEGAGLPI_ROOT . '/templates/knowledge_base.php';
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

    public function canUpdate(): bool
    {
        return Plugin::canKnowledgeBaseUpdate();
    }

    public function getKnowledgeBaseUrl(): string
    {
        return Plugin::getKnowledgeBaseUrl();
    }

    /**
     * @param array<string, mixed> $filters
     */
    public function getViewUrl(array $filters, int $articleId): string
    {
        $query = $filters;
        $query['view_id'] = $articleId;
        unset($query['edit_id']);

        return $this->getKnowledgeBaseUrl() . '?' . http_build_query($this->cleanQuery($query));
    }

    /**
     * @param array<string, mixed> $filters
     */
    public function getEditUrl(array $filters, int $articleId): string
    {
        $query = $filters;
        $query['edit_id'] = $articleId;
        unset($query['view_id']);

        return $this->getKnowledgeBaseUrl() . '?' . http_build_query($this->cleanQuery($query));
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
