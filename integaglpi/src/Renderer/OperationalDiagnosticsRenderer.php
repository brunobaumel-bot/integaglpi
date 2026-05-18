<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi\Renderer;

use GlpiPlugin\Integaglpi\Service\OperationalDiagnosticsService;
use Html;

final class OperationalDiagnosticsRenderer
{
    public function __construct(private readonly OperationalDiagnosticsService $service)
    {
    }

    public function render(): void
    {
        $data = $this->service->getDiagnostics();
        $template = PLUGIN_INTEGAGLPI_ROOT . '/templates/operational_diagnostics.php';

        require $template;
    }

    public function escape(string $value): string
    {
        return Html::cleanInputText($value);
    }
}
