<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi\Tests;

use PHPUnit\Framework\TestCase;

final class TicketReplyWindowGuardStaticTest extends TestCase
{
    private function pluginPath(string $relative): string
    {
        return dirname(__DIR__) . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $relative);
    }

    public function testTicketReplyShowsFriendlyWindowClosedError(): void
    {
        $source = (string) file_get_contents($this->pluginPath('front/ticket.whatsapp.reply.php'));

        self::assertStringContainsString('WINDOW_24H_CLOSED_TEMPLATE_REQUIRED', $source);
        self::assertStringContainsString('A janela de 24h está fechada', $source);
        self::assertStringContainsString('Use um template aprovado', $source);
    }

    public function testTicketReplyShowsFriendlyUncontrolledTemplateError(): void
    {
        $source = (string) file_get_contents($this->pluginPath('front/ticket.whatsapp.reply.php'));

        self::assertStringContainsString('TEMPLATE_NOT_ALLOWED', $source);
        self::assertStringContainsString('Template não permitido para envio manual', $source);
        self::assertStringContainsString('fluxo controlado', $source);
    }
}
