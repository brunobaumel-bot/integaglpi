<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi\Tests;

use GlpiPlugin\Integaglpi\Renderer\ExternalResearchRenderer;
use GlpiPlugin\Integaglpi\Renderer\HistoricalMiningRenderer;
use PHPUnit\Framework\TestCase;

final class RendererEscapeTest extends TestCase
{
    public function testExternalResearchRendererEscapesHtml(): void
    {
        $renderer = new ExternalResearchRenderer();

        self::assertSame('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;', $renderer->escape('<script>alert("x")</script>'));
    }

    public function testHistoricalMiningRendererEscapesHtml(): void
    {
        $renderer = new HistoricalMiningRenderer();

        self::assertSame('Tom &amp; Jerry', $renderer->escape('Tom & Jerry'));
    }
}
