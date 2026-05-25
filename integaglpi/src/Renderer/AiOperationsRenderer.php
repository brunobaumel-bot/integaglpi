<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi\Renderer;

use GlpiPlugin\Integaglpi\Plugin;

final class AiOperationsRenderer
{
    /**
     * @param array<string, mixed> $data
     */
    public function render(array $data): void
    {
        include __DIR__ . '/../../templates/ai_operations.php';
    }

    /**
     * @param array<string, mixed> $data
     */
    public function renderAiConfig(array $data): void
    {
        include __DIR__ . '/../../templates/ai_config.php';
    }

    public function escape(string $value): string
    {
        return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    }

    public function getAiConfigUrl(): string
    {
        return Plugin::getAiConfigUrl();
    }
}
