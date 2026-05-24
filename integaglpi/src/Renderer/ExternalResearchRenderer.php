<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi\Renderer;

use GlpiPlugin\Integaglpi\Plugin;

final class ExternalResearchRenderer
{
    /**
     * @param array<string, mixed> $data
     */
    public function render(array $data): void
    {
        include __DIR__ . '/../../templates/external_research.php';
    }

    public function escape(string $value): string
    {
        return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    }

    public function getExternalResearchUrl(): string
    {
        return Plugin::getExternalResearchUrl();
    }
}
