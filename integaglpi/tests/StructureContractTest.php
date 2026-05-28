<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi\Tests;

use PHPUnit\Framework\TestCase;

final class StructureContractTest extends TestCase
{
    private function pluginPath(string $relative): string
    {
        return dirname(__DIR__) . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $relative);
    }

    public function testBootstrapCanAutoloadPluginClassesWithoutVendor(): void
    {
        self::assertTrue(class_exists(\GlpiPlugin\Integaglpi\Plugin::class));
        self::assertTrue(class_exists(\GlpiPlugin\Integaglpi\Renderer\ExternalResearchRenderer::class));
        self::assertTrue(class_exists(\GlpiPlugin\Integaglpi\Renderer\HistoricalMiningRenderer::class));
    }

    public function testFrozenOperationalFilesWereNotMoved(): void
    {
        foreach ([
            'src/Service/IntegrationService' . 'Client.php',
            'src/Service/AttendanceCenter' . 'Service.php',
            'src/Service/HistoricalMiningUi' . 'Service.php',
            'src/Service/TicketContext' . 'Service.php',
            'src/Service/OperationalDiagnostics' . 'Service.php',
        ] as $relative) {
            self::assertFileExists($this->pluginPath($relative));
        }
    }
}
