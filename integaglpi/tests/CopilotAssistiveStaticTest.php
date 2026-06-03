<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi\Tests;

use PHPUnit\Framework\TestCase;

final class CopilotAssistiveStaticTest extends TestCase
{
    private function pluginPath(string $relative): string
    {
        return dirname(__DIR__) . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $relative);
    }

    public function testCopilotEndpointRequiresCsrfAndNeverSendsAutomatically(): void
    {
        $endpoint = (string) file_get_contents($this->pluginPath('front/copilot.draft.php'));

        self::assertStringContainsString('Session::checkLoginUser()', $endpoint);
        self::assertStringContainsString('Plugin::isCsrfValid($_POST)', $endpoint);
        self::assertStringContainsString('TicketContextService', $endpoint);
        self::assertStringContainsString('CopilotDraftClient', $endpoint);
        self::assertStringNotContainsString('sendOutbound(', $endpoint);
        self::assertStringNotContainsString('ticket.status', strtolower($endpoint));
        self::assertStringContainsString('Copiloto temporariamente indisponível. Tente novamente em breve.', $endpoint);
    }

    public function testCopilotClientUsesShortTimeoutAndRuntimeConfigWithoutSecrets(): void
    {
        $client = (string) file_get_contents($this->pluginPath('src/Service/CopilotDraftClient.php'));

        // Transport timeout (synchronous job-create / status-poll calls) stays short.
        self::assertStringContainsString('private const COPILOT_DRAFT_TIMEOUT_MS = 8000', $client);
        self::assertStringContainsString('private const COPILOT_DRAFT_CONNECT_TIMEOUT_MS = 3000', $client);
        // Generation budget (model thinking time for the async job) honors DB/env config
        // (AI_SUPERVISOR_TIMEOUT_SECONDS) instead of being clamped to the transport timeout.
        self::assertStringContainsString('private const COPILOT_GENERATION_TIMEOUT_MS = 120000', $client);
        self::assertStringContainsString("'timeout_ms'", $client);
        self::assertStringContainsString('), 5000, self::COPILOT_GENERATION_TIMEOUT_MS, self::COPILOT_GENERATION_TIMEOUT_MS)', $client);
        self::assertStringContainsString("'no_auto_send' => true", $client);
        self::assertStringContainsString('$this->sanitizeLog($exception->getMessage())', $client);
        self::assertStringNotContainsString('COPILOT_PROMPT', $client);
    }

    public function testTicketTabShowsExplicitSourceAndManualOnlyDraftActions(): void
    {
        $template = (string) file_get_contents($this->pluginPath('templates/ticket_tab.php'));

        self::assertStringContainsString('Fonte explícita aparecerá aqui', $template);
        self::assertStringContainsString('Fonte: ', $template);
        self::assertStringContainsString('js-integaglpi-copilot-copy', $template);
        self::assertStringContainsString('js-integaglpi-copilot-use', $template);
        self::assertStringContainsString('Revise antes de enviar. Nenhuma mensagem é enviada automaticamente.', $template);
        self::assertStringNotContainsString('copilotDraft.value); fetch(endpoint', $template);
    }
}
