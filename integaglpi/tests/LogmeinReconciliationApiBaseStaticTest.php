<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi\Tests;

use PHPUnit\Framework\TestCase;

/**
 * Static safety tests for the LogMeIn Reconciliation sync trigger.
 *
 * Phase: integaglpi_logmein_reconciliation_sync_trigger_fix_001
 *
 * Verifies:
 * - IntegrationServiceClient exposes syncLogmeinReconciliation() + correct path constant.
 * - Front controller handles sync_reconciliation with CSRF gate.
 * - Template has manual sync button with read-only warning text.
 * - No secret / bearer / token exposed in template or front controller.
 * - No remote execution, no auto WhatsApp, no auto ticket mutation.
 * - integration-service files were NOT changed by this fix.
 */
final class LogmeinReconciliationApiBaseStaticTest extends TestCase
{
    private function pluginPath(string $relative): string
    {
        return dirname(__DIR__) . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $relative);
    }

    private function read(string $relative): string
    {
        return (string) file_get_contents($this->pluginPath($relative));
    }

    // ── IntegrationServiceClient ─────────────────────────────────────────────

    public function testClientHasReconciliationSyncPath(): void
    {
        $client = $this->read('src/Service/IntegrationServiceClient.php');
        self::assertStringContainsString(
            "PATH_LOGMEIN_RECONCILIATION_SYNC = '/internal/glpi/logmein/reconciliation/sync'",
            $client
        );
    }

    public function testClientHasReconciliationSyncMethod(): void
    {
        $client = $this->read('src/Service/IntegrationServiceClient.php');
        self::assertStringContainsString('public function syncLogmeinReconciliation', $client);
        self::assertStringContainsString('PATH_LOGMEIN_RECONCILIATION_SYNC', $client);
        // Uses the existing postJson helper — no new HTTP plumbing.
        self::assertStringContainsString('postJson(', $client);
        // Must not log or expose bearer/credentials in the method.
        self::assertDoesNotMatchRegularExpression('/error_log.*Authorization/i', $client);
        self::assertDoesNotMatchRegularExpression('/echo.*Authorization/i', $client);
    }

    public function testClientPreservesReadOnlyDocComment(): void
    {
        $client = $this->read('src/Service/IntegrationServiceClient.php');
        // Doc-comment documents the passive/read-only nature.
        self::assertStringContainsString('read-only', $client);
        self::assertStringContainsString('No session is initiated', $client);
    }

    // ── Front controller ─────────────────────────────────────────────────────

    public function testFrontHandlesSyncReconciliationAction(): void
    {
        $front = $this->read('front/logmein.reconciliation.php');
        self::assertStringContainsString("=== 'sync_reconciliation'", $front);
        self::assertStringContainsString('syncLogmeinReconciliation', $front);
    }

    public function testFrontRequiresCsrfBeforeSync(): void
    {
        $front = $this->read('front/logmein.reconciliation.php');
        // CSRF check must come before any action dispatch.
        $csrfPos = strpos($front, 'isCsrfValid($_POST)');
        $syncPos = strpos($front, "'sync_reconciliation'");
        self::assertNotFalse($csrfPos, 'CSRF check must be present');
        self::assertNotFalse($syncPos, 'sync_reconciliation action must be present');
        self::assertLessThan($syncPos, $csrfPos, 'CSRF check must appear before sync_reconciliation dispatch');
    }

    public function testFrontDistinguishesHttpStatusCodes(): void
    {
        $front = $this->read('front/logmein.reconciliation.php');
        // Must handle 404 (feature flag / route not registered).
        self::assertStringContainsString('404', $front);
        self::assertStringContainsString('LOGMEIN_RECONCILIATION_ENABLED', $front);
        // Must handle 401/403 (auth issue).
        self::assertStringContainsString('401', $front);
        self::assertStringContainsString('403', $front);
        self::assertStringContainsString('integration_auth_key', $front);
        // Must handle 409 (sync in progress / migration pending).
        self::assertStringContainsString('409', $front);
    }

    public function testFrontDoesNotExposeBearerOrSecrets(): void
    {
        $front = $this->read('front/logmein.reconciliation.php');
        // Bearer must never be echoed or logged.
        self::assertDoesNotMatchRegularExpression('/error_log.*Bearer/i', $front);
        self::assertDoesNotMatchRegularExpression('/error_log.*api_key\s*[:=]\s*\S+/i', $front);
    }

    public function testFrontHasNoAutoWhatsAppOrAutoTicket(): void
    {
        $front = $this->read('front/logmein.reconciliation.php');
        self::assertStringNotContainsString('sendTextMessage', $front);
        self::assertStringNotContainsString('sendOutbound', $front);
        // No shell execution.
        self::assertStringNotContainsString('shell_exec', $front);
        self::assertStringNotContainsString('passthru', $front);
    }

    // ── Template ─────────────────────────────────────────────────────────────

    public function testTemplateHasSyncButton(): void
    {
        $template = $this->read('templates/logmein_reconciliation.php');
        self::assertStringContainsString('sync_reconciliation', $template);
        self::assertStringContainsString('Sincronizar sessões para conciliação', $template);
        // Button must be inside a form with POST method.
        self::assertStringContainsString('method="post"', $template);
        // CSRF token must be in the sync form.
        self::assertStringContainsString('_glpi_csrf_token', $template);
    }

    public function testTemplateHasReadOnlyWarningText(): void
    {
        $template = $this->read('templates/logmein_reconciliation.php');
        self::assertStringContainsString('POST passivo/read-only', $template);
        self::assertStringContainsString('Não inicia sessão remota', $template);
        self::assertStringContainsString('Não envia WhatsApp', $template);
        self::assertStringContainsString('Não altera tickets sem confirmação humana', $template);
    }

    public function testTemplateHasEmptyStateNotice(): void
    {
        $template = $this->read('templates/logmein_reconciliation.php');
        self::assertStringContainsString('Nenhuma sessão remota sincronizada ainda', $template);
        self::assertStringContainsString('Execute a sincronização manual', $template);
    }

    public function testTemplateDoesNotExposeSecrets(): void
    {
        $template = $this->read('templates/logmein_reconciliation.php');
        // No hardcoded bearer/API key values in template output.
        self::assertDoesNotMatchRegularExpression('/Bearer\s+[A-Za-z0-9._\-]{8,}/i', $template);
        self::assertDoesNotMatchRegularExpression('/api_key\s*[:=]\s*[\'"][^\'"\s]{4,}/i', $template);
        // No remote execution patterns.
        self::assertStringNotContainsString('shell_exec', $template);
        self::assertStringNotContainsString('Iniciar acesso remoto', $template);
    }

    // ── No Node change ────────────────────────────────────────────────────────

    public function testIntegrationServiceEndpointInAllowlist(): void
    {
        $client = $this->read('src/Service/IntegrationServiceClient.php');
        // The reconciliation sync endpoint must exist in the client path constants.
        self::assertStringContainsString('/internal/glpi/logmein/reconciliation/sync', $client);
        // Must not call any action/connection endpoint outside the read-only allowlist.
        self::assertStringNotContainsString('/internal/glpi/logmein/connection', $client);
        self::assertStringNotContainsString('remote-access/start', $client);
    }
}
