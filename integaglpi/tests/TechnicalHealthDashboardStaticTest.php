<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi\Tests;

use PHPUnit\Framework\TestCase;

/**
 * Static safety tests for the Technical Health Dashboard.
 *
 * Phase: integaglpi_technical_runtime_dashboard_unification_001.
 *
 * Verifies the dashboard is read-only, has no mutation actions, no secret
 * exposure, no raw_payload, and is properly gated by RBAC.
 */
final class TechnicalHealthDashboardStaticTest extends TestCase
{
    private function pluginPath(string $relative): string
    {
        return dirname(__DIR__) . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $relative);
    }

    private function read(string $relative): string
    {
        return (string) file_get_contents($this->pluginPath($relative));
    }

    // ── File existence ────────────────────────────────────────────────────────

    public function testDashboardFilesExist(): void
    {
        self::assertFileExists($this->pluginPath('src/TechnicalHealthMenu.php'));
        self::assertFileExists($this->pluginPath('src/Service/TechnicalHealthDashboardService.php'));
        self::assertFileExists($this->pluginPath('front/technical.health.php'));
        self::assertFileExists($this->pluginPath('templates/technical_health.php'));
    }

    // ── Menu registration ─────────────────────────────────────────────────────

    public function testTemplateContainsNoVisibleBladeLikeComments(): void
    {
        $template = $this->read('templates/technical_health.php');
        // {{-- ... --}} markers are Blade syntax; they render verbatim in plain PHP templates.
        self::assertStringNotContainsString('{{--', $template, 'Template must not contain {{-- ... --}} markers that render in HTML output');
        self::assertStringNotContainsString('--}}', $template, 'Template must not contain {{-- ... --}} markers that render in HTML output');
    }

    public function testMenuRegisteredInSetup(): void
    {
        $setup = $this->read('setup.php');
        self::assertStringContainsString('TechnicalHealthMenu', $setup);
        self::assertStringContainsString('registerClass(TechnicalHealthMenu::class)', $setup);
    }

    public function testMenuChildInMonitoramentoGroupMenu(): void
    {
        $menu = $this->read('src/MonitoramentoGroupMenu.php');
        self::assertStringContainsString("'monitoramento_operacional'", $menu);
        self::assertStringContainsString('Monitoramento Operacional', $menu);
        self::assertStringContainsString('getTechnicalHealthUrl()', $menu);
        foreach ([
            'Observabilidade WhatsApp',
            'Diagnóstico Operacional',
            'Auditoria Operacional',
            'Health / Status de Serviços',
            'Central de Eventos Operacionais',
        ] as $oldSidebarLabel) {
            self::assertStringNotContainsString($oldSidebarLabel, $menu, $oldSidebarLabel . ' must remain a drill-down, not a sidebar child.');
        }
    }

    public function testTechnicalHealthUrlInPlugin(): void
    {
        $plugin = $this->read('src/Plugin.php');
        self::assertStringContainsString('getTechnicalHealthUrl', $plugin);
        self::assertStringContainsString('technical.health.php', $plugin);
    }

    // ── RBAC ─────────────────────────────────────────────────────────────────

    public function testFrontControllerChecksPermissions(): void
    {
        $front = $this->read('front/technical.health.php');
        self::assertStringContainsString('Session::checkLoginUser();', $front);
        self::assertStringContainsString('canOperationalDiagnosticsRead', $front);
        self::assertStringContainsString('canObservabilityRead', $front);
        self::assertStringContainsString('canAuditRead', $front);
        self::assertStringContainsString('Html::displayRightError()', $front);
    }

    public function testMenuClassDelegatesToPluginCanMethods(): void
    {
        $menu = $this->read('src/TechnicalHealthMenu.php');
        self::assertStringContainsString('canView()', $menu);
        self::assertStringContainsString('canOperationalDiagnosticsRead', $menu);
        self::assertStringContainsString('canObservabilityRead', $menu);
        self::assertStringContainsString('canAuditRead', $menu);
    }

    // ── Read-only enforcement ─────────────────────────────────────────────────

    public function testTemplateHasNoBadge(): void
    {
        $template = $this->read('templates/technical_health.php');
        // Badge read-only must be present.
        self::assertStringContainsString('read-only', $template);
        // Disclaimer: no mutation, no retry.
        self::assertStringContainsString('Sem retry', $template);
        self::assertStringContainsString('Sem ação mutável', $template);
        // Recommendations section must declare no button.
        self::assertStringContainsString('nenhuma ação é executada', $template);
    }

    public function testForbiddenTermsAbsentFromTemplate(): void
    {
        $template = $this->read('templates/technical_health.php');
        // raw_payload / shell / migration must never appear.
        foreach (['shell_exec', 'raw_payload', 'payload_json', 'migration'] as $term) {
            self::assertStringNotContainsString($term, $template, "Template must not contain '{$term}'");
        }
        // "retry"/"reprocess"/"resend"/"restart" may only appear as *prohibited*
        // text (e.g. "Sem retry"). They must NEVER appear as a button/action label.
        self::assertDoesNotMatchRegularExpression('/<button[^>]*>.*?retry.*?<\/button>/si', $template);
        self::assertDoesNotMatchRegularExpression('/<button[^>]*>.*?reprocess.*?<\/button>/si', $template);
        self::assertDoesNotMatchRegularExpression('/<button[^>]*>.*?resend.*?<\/button>/si', $template);
        self::assertDoesNotMatchRegularExpression('/<button[^>]*>.*?restart.*?<\/button>/si', $template);
    }

    public function testForbiddenTermsAbsentFromService(): void
    {
        $svc = $this->read('src/Service/TechnicalHealthDashboardService.php');
        // Service actively redacts raw_payload via unset — verify the unset is present.
        self::assertStringContainsString("unset(\$row['raw_payload']", $svc);
        // No shell / exec primitives.
        foreach (['shell_exec', 'passthru', 'system(', 'popen('] as $term) {
            self::assertStringNotContainsString($term, $svc, "Service must not contain '{$term}'");
        }
    }

    public function testServiceSanitizesCredentialsInErrorMessages(): void
    {
        $svc = $this->read('src/Service/TechnicalHealthDashboardService.php');
        // sanitizeMessage must redact common credential patterns.
        self::assertStringContainsString('sanitizeMessage', $svc);
        self::assertStringContainsString('[redacted]', $svc);
        // The sanitization regex must cover psk, token, bearer, secret, api_key.
        // We verify the regex pattern itself is present — the word "psk" legitimately
        // appears in the regex and in the "check PSK" recommendation, which is correct.
        self::assertMatchesRegularExpression('/bearer.*token.*secret.*password.*psk/is', $svc);
        // Must not expose any connection string helper (raw DB/HTTP config).
        self::assertStringNotContainsString('getConnectionConfig', $svc);
        // Hardcoded credential values must never appear (e.g. psk=somevalue).
        self::assertDoesNotMatchRegularExpression('/psk\s*[:=]\s*[\'"][^\'"\s]{4,}/i', $svc);
    }

    // ── No mutation actions ───────────────────────────────────────────────────

    public function testTemplateHasNoMutationButtons(): void
    {
        $template = $this->read('templates/technical_health.php');
        // Drill-down links are anchor tags (OK). No submit/form for mutations.
        self::assertStringNotContainsString('<form method="post"', $template);
        self::assertStringNotContainsString('<input type="submit"', $template);
        // No dangerous action text on any button.
        $mutationPatterns = ['Reiniciar', 'Reprocessar', 'Reenviar', 'Executar', 'Limpar Redis'];
        foreach ($mutationPatterns as $text) {
            self::assertStringNotContainsString($text, $template, "Template must not contain mutation button: '{$text}'");
        }
    }

    // ── Drill-down links ──────────────────────────────────────────────────────

    public function testTemplateHasDrillDownLinks(): void
    {
        $template = $this->read('templates/technical_health.php');
        self::assertStringContainsString('getObservabilityUrl()', $template);
        self::assertStringContainsString('getOperationalDiagnosticsUrl()', $template);
        self::assertStringContainsString('getAuditUrl()', $template);
        self::assertStringContainsString('Áreas consolidadas:', $template);
        self::assertStringContainsString('Monitoramento Operacional', $template);
        self::assertStringContainsString('WhatsApp / Meta', $template);
        self::assertStringContainsString('Auditoria', $template);
        self::assertStringContainsString('Eventos', $template);
        self::assertStringContainsString('$urls[\'auditoria\']', $template);
        self::assertStringContainsString('$urls[\'events\']', $template);
        self::assertStringContainsString("Plugin::getAuditUrl() . '?view=events'", $template);
        self::assertStringContainsString('Diagnóstico / Readiness', $template);
        self::assertStringContainsString('Health / Runtime', $template);
        self::assertStringContainsString('config.form.php?tab=diagnostics', $template);
        self::assertStringContainsString('ai.config.php', $template);
        // All links via $escape() to prevent XSS.
        self::assertStringContainsString('$escape($urls[', $template);
    }

    // ── Events window ─────────────────────────────────────────────────────────

    public function testServiceEnforcesEventsWindowAndLimit(): void
    {
        $svc = $this->read('src/Service/TechnicalHealthDashboardService.php');
        self::assertStringContainsString('EVENTS_WINDOW_HOURS', $svc);
        self::assertStringContainsString('EVENTS_LIMIT', $svc);
        // Window must be 24h, limit must be 50 or less.
        self::assertMatchesRegularExpression('/EVENTS_WINDOW_HOURS\s*=\s*24/', $svc);
        self::assertMatchesRegularExpression('/EVENTS_LIMIT\s*=\s*50/', $svc);
    }

    // ── Node change absent ────────────────────────────────────────────────────

    public function testNoIntegrationServiceFileChanged(): void
    {
        // This is a static structural test: the dashboard service must only use
        // existing integration-service client methods and not introduce new endpoints.
        $svc = $this->read('src/Service/TechnicalHealthDashboardService.php');
        // getDiagnostics() is called directly via IntegrationServiceClient.
        self::assertStringContainsString('getDiagnostics()', $svc);
        // Observability is accessed via ObservabilityService->getDashboardData(), which
        // internally calls IntegrationServiceClient->getObservability(). The dashboard
        // service delegates to ObservabilityService — not to the client directly.
        self::assertStringContainsString('ObservabilityService', $svc);
        self::assertStringContainsString('getDashboardData(', $svc);
        // Must NOT call any new endpoint not already in the allowlist.
        self::assertStringNotContainsString('postJson(', $svc);
        self::assertStringNotContainsString('syncLogmein', $svc);
        self::assertStringNotContainsString('sendOutbound', $svc);
        // Must NOT call IntegrationServiceClient->getObservability() directly
        // (that would bypass the caching/error-handling in ObservabilityService).
        self::assertDoesNotMatchRegularExpression('/integrationClient\s*->\s*getObservability\s*\(/', $svc);
    }
}
