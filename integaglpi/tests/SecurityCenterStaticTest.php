<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi\Tests;

use PHPUnit\Framework\TestCase;

final class SecurityCenterStaticTest extends TestCase
{
    private function pluginPath(string $relative): string
    {
        return dirname(__DIR__) . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $relative);
    }

    private function read(string $relative): string
    {
        return (string) file_get_contents($this->pluginPath($relative));
    }

    public function testSecurityCenterFilesExist(): void
    {
        self::assertFileExists($this->pluginPath('src/Service/SecurityPermissionService.php'));
        self::assertFileExists($this->pluginPath('src/Service/SecurityAuditService.php'));
        self::assertFileExists($this->pluginPath('src/SecurityCenterMenu.php'));
        self::assertFileExists($this->pluginPath('front/security.center.php'));
        self::assertFileExists($this->pluginPath('templates/security_center.php'));
    }

    public function testDirecaoOperationalActionsAreDenied(): void
    {
        $svc = $this->read('src/Service/SecurityPermissionService.php');
        foreach ([
            'RIGHT_REPLY_OWNED_TICKET',
            'RIGHT_REPLY_ANY_TICKET',
            'RIGHT_CLAIM_TICKET',
            'RIGHT_TRANSFER_TICKET',
            'RIGHT_SOLVE_TICKET',
            'RIGHT_SOLVE_OWNED_TICKET',
            'RIGHT_ADMINISTRATIVE_CLOSE',
            'RIGHT_MANAGE_SECURITY_CENTER',
        ] as $right) {
            self::assertMatchesRegularExpression('/ROLE_DIRECAO\s*=>\s*\[[^\]]*' . $right . '/s', $svc);
        }
    }

    public function testSupervisaoDoesNotManageSecurityCenter(): void
    {
        $svc = $this->read('src/Service/SecurityPermissionService.php');
        self::assertMatchesRegularExpression('/ROLE_SUPERVISAO\s*=>\s*\[[^\]]*RIGHT_MANAGE_SECURITY_CENTER/s', $svc);
        self::assertStringContainsString('canManageSecurityCenter', $svc);
    }

    public function testTicketWhatsappActionRequiresCsrfAndGranularActionMap(): void
    {
        $action = $this->read('front/ticket.whatsapp.action.php');
        self::assertStringContainsString('Plugin::isCsrfValid($_POST)', $action);
        self::assertStringContainsString('$actionRightMap = [', $action);
        self::assertStringContainsString("'claim' => SecurityPermissionService::RIGHT_CLAIM_TICKET", $action);
        self::assertStringContainsString("'transfer' => SecurityPermissionService::RIGHT_TRANSFER_TICKET", $action);
        self::assertStringContainsString("'close' => SecurityPermissionService::RIGHT_ADMINISTRATIVE_CLOSE", $action);
        self::assertStringContainsString('requirePermissionOrDeny', $action);
        self::assertStringNotContainsString('Plugin::requireCsrf($_POST);', $action);
        self::assertStringNotContainsString('// Plugin::requireCsrf($_POST);', $action);
    }

    public function testCentralActionKeepsSolveOwnedSeparateFromSolveAny(): void
    {
        $action = $this->read('front/central.action.php');
        self::assertStringContainsString("if (\$action === 'solve')", $action);
        self::assertStringContainsString('RIGHT_SOLVE_TICKET', $action);
        self::assertStringContainsString('RIGHT_SOLVE_OWNED_TICKET', $action);
        self::assertStringContainsString('hasRight(SecurityPermissionService::RIGHT_SOLVE_TICKET)', $action);
        self::assertStringContainsString('requirePermissionOrDeny($requiredRight', $action);
    }

    public function testSecurityAuditDoesNotRunRuntimeDdl(): void
    {
        $audit = $this->read('src/Service/SecurityAuditService.php');
        self::assertStringNotContainsString('ExternalSchemaManager', $audit);
        self::assertStringNotContainsString('ensureSchema', $audit);
        self::assertStringNotContainsString('CREATE TABLE', $audit);
        self::assertStringNotContainsString('ALTER TABLE', $audit);
        self::assertStringNotContainsString('CREATE INDEX', $audit);
        self::assertStringContainsString('auditTableExists', $audit);
        self::assertStringContainsString('error_log', $audit);
    }

    public function testSecurityAuditSanitizesSecretsAndPii(): void
    {
        $audit = $this->read('src/Service/SecurityAuditService.php');
        foreach ([
            'token',
            'app_token',
            'bearer',
            'authorization',
            'password',
            'secret',
            'api_key',
            'session_token',
            'raw_payload',
            'raw_prompt',
            'prompt',
            'phone_e164',
            'email',
        ] as $forbidden) {
            self::assertStringContainsString("'" . $forbidden . "'", $audit);
        }
    }

    public function testCriticalEndpointsHaveBackendGuards(): void
    {
        foreach ([
            'front/central.action.php',
            'front/ticket.whatsapp.reply.php',
            'front/ticket.whatsapp.action.php',
            'front/security.center.php',
        ] as $relative) {
            self::assertStringContainsString('requirePermissionOrDeny', $this->read($relative), $relative);
        }
    }

    public function testSecurityCenterMenuRegistered(): void
    {
        $setup = $this->read('setup.php');
        self::assertStringContainsString('SecurityCenterMenu', $setup);
        self::assertStringContainsString('plugin_integaglpi_security_center', $setup);
        self::assertStringContainsString('registerClass(SecurityCenterMenu::class)', $setup);
    }
}
