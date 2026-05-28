<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi\Tests;

use PHPUnit\Framework\TestCase;

final class BootstrapIsolationTest extends TestCase
{
    public function testBootstrapDefinesOnlyIsolatedPluginEnvironment(): void
    {
        self::assertTrue(defined('INTEGAGLPI_PHPUNIT_BOOTSTRAPPED'));
        self::assertSame('integaglpi', PLUGIN_INTEGAGLPI_NAME);
        self::assertArrayHasKey('root_doc', $GLOBALS['CFG_GLPI']);
        self::assertFalse(defined('GLPI_ROOT'));
        self::assertArrayNotHasKey('DB', $GLOBALS);
    }

    public function testGlpiStubsExistWithoutStartingRealSession(): void
    {
        self::assertTrue(class_exists(\Session::class, false));
        self::assertTrue(class_exists(\Html::class, false));
        self::assertTrue(class_exists(\CommonDBTM::class, false));
        self::assertSame(1, \Session::getLoginUserID());
        self::assertSame('test-csrf-token', \Session::getNewCSRFToken());
    }
}
