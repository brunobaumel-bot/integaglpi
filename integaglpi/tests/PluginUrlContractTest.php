<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi\Tests;

use GlpiPlugin\Integaglpi\Plugin;
use PHPUnit\Framework\TestCase;

final class PluginUrlContractTest extends TestCase
{
    protected function setUp(): void
    {
        $GLOBALS['CFG_GLPI'] = ['root_doc' => '/glpi/'];
    }

    public function testPluginNameAndBasePathAreStable(): void
    {
        self::assertSame('GLPI WhatsApp', Plugin::getName());
        self::assertSame('/glpi/plugins/integaglpi', Plugin::getWebBasePath());
    }

    public function testOperationalUrlsAreBuiltInsidePluginFront(): void
    {
        self::assertSame('/glpi/plugins/integaglpi/front/ticket.whatsapp.action.php', Plugin::getTicketActionUrl());
        self::assertSame('/glpi/plugins/integaglpi/front/online.monitor.php', Plugin::getOnlineMonitorUrl());
        self::assertSame('/glpi/plugins/integaglpi/front/ai.config.php', Plugin::getAiConfigUrl());
    }
}
