<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi\Tests;

use PHPUnit\Framework\TestCase;

final class PHPUnitConfigurationTest extends TestCase
{
    private function pluginPath(string $relative): string
    {
        return dirname(__DIR__) . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $relative);
    }

    public function testPhpUnitXmlUsesIsolatedBootstrapAndTestsDirectory(): void
    {
        $xml = file_get_contents($this->pluginPath('phpunit.xml'));

        self::assertIsString($xml);
        self::assertStringContainsString('bootstrap="tests/bootstrap.php"', $xml);
        self::assertStringContainsString('<directory suffix="Test.php">tests</directory>', $xml);
        self::assertStringNotContainsString('src/Service', $xml);
        self::assertStringNotContainsString('inc/includes.php', $xml);
    }

    public function testComposerAddsOnlyDevTestSurface(): void
    {
        $json = json_decode((string) file_get_contents($this->pluginPath('composer.json')), true);

        self::assertIsArray($json);
        self::assertArrayHasKey('require-dev', $json);
        self::assertSame('^9.6', $json['require-dev']['phpunit/phpunit'] ?? null);
        self::assertArrayNotHasKey('phpunit/phpunit', $json['require'] ?? []);
        self::assertSame('phpunit -c phpunit.xml', $json['scripts']['test'] ?? null);
    }
}
