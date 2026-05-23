<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi\Renderer;

use GlpiPlugin\Integaglpi\Plugin;
use GlpiPlugin\Integaglpi\Service\NativeKnowledgeBaseService;
use Html;

final class NativeKnowledgeBaseRenderer
{
    public function __construct(private readonly NativeKnowledgeBaseService $service)
    {
    }

    /**
     * @param array<string, mixed> $query
     */
    public function render(array $query): void
    {
        $search = trim((string) ($query['q'] ?? ''));
        $articles = $this->service->searchVisibleArticles($search, 5);

        require PLUGIN_INTEGAGLPI_ROOT . '/templates/native_knowledge_base.php';
    }

    public function escape(string $value): string
    {
        return Html::cleanInputText($value);
    }

    public function getNativeKnowledgeBaseUrl(): string
    {
        return Plugin::getNativeKnowledgeBaseUrl();
    }
}
