<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi\Tests;

use PHPUnit\Framework\TestCase;

final class StaticSafetyTest extends TestCase
{
    private function pluginPath(string $relative): string
    {
        return dirname(__DIR__) . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $relative);
    }

    /**
     * @return list<string>
     */
    private function testFiles(): array
    {
        $files = glob($this->pluginPath('tests/*.php')) ?: [];
        sort($files);

        return $files;
    }

    public function testBootstrapDoesNotLoadRealGlpi(): void
    {
        $bootstrap = (string) file_get_contents($this->pluginPath('tests/bootstrap.php'));

        self::assertStringNotContainsString('inc/' . 'includes.php', $bootstrap);
        self::assertStringNotContainsString('session_' . 'start', $bootstrap);
        self::assertStringNotContainsString('GLPI_ROOT', $bootstrap);
    }

    public function testTestsDoNotCallRealDatabaseHttpOrWhatsapp(): void
    {
        $contents = '';
        foreach ($this->testFiles() as $file) {
            $contents .= "\n" . (string) file_get_contents($file);
        }

        $forbidden = [
            '$DB->' . 'query',
            '$DB->' . 'request',
            'curl_' . 'exec',
            'file_get_contents(' . "'http",
            'file_get_contents(' . '"http',
            'send' . 'Outbound',
            'Meta' . 'Client',
            'send' . 'WhatsApp',
        ];

        foreach ($forbidden as $needle) {
            self::assertStringNotContainsString($needle, $contents);
        }
    }

    public function testTestsDoNotReferenceFrozenOperationalServices(): void
    {
        $contents = '';
        foreach ($this->testFiles() as $file) {
            $contents .= "\n" . (string) file_get_contents($file);
        }

        foreach ([
            'IntegrationService' . 'Client.php',
            'AttendanceCenter' . 'Service.php',
            'HistoricalMiningUi' . 'Service.php',
            'TicketContext' . 'Service.php',
            'OperationalDiagnostics' . 'Service.php',
        ] as $forbiddenFile) {
            self::assertStringNotContainsString($forbiddenFile, $contents);
        }
    }
}
