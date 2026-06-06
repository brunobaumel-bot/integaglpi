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

    public function testDirecaoHasPluginGovernanceRights(): void
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
            'RIGHT_SELECT_ENTITY',
            'RIGHT_OVERRIDE_ENTITY_MEMORY',
            'RIGHT_MANAGE_SECURITY_CENTER',
        ] as $right) {
            self::assertMatchesRegularExpression('/ROLE_DIRECAO\s*=>\s*\[[^\]]*' . $right . '/s', $svc);
        }
        self::assertDoesNotMatchRegularExpression(
            '/ROLE_DENIED\s*=\s*\[[\s\S]+ROLE_DIRECAO\s*=>\s*\[[^\]]*RIGHT_MANAGE_SECURITY_CENTER/s',
            $svc
        );
        self::assertMatchesRegularExpression(
            '/ROLE_DENIED\s*=\s*\[[\s\S]+ROLE_DIRECAO\s*=>\s*\[[^\]]*RIGHT_VIEW_UNMASKED_PII/s',
            $svc
        );
        self::assertMatchesRegularExpression(
            '/ROLE_DENIED\s*=\s*\[[\s\S]+ROLE_DIRECAO\s*=>\s*\[[^\]]*RIGHT_MANAGE_AI_SECRETS/s',
            $svc
        );
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

    public function testEntitySelectionAndOverrideAreAuditedByRole(): void
    {
        $action = $this->read('front/central.action.php');
        $audit = $this->read('src/Service/SecurityAuditService.php');

        // crc32($conversationId) must not appear — it can return negatives and is
        // inconsistent with the sha256-based hashing used by the other entity events.
        self::assertStringNotContainsString('crc32($conversationId)', $action);
        // logEntityOverride must accept string $conversationId (consistent with the
        // other entity audit helpers that hash it with sha256 internally).
        self::assertMatchesRegularExpression('/function logEntityOverride\(string \$conversationId/', $audit);

        self::assertStringContainsString("'confirm_entity' => SecurityPermissionService::RIGHT_SELECT_ENTITY", $action);
        self::assertStringContainsString("'update_entity' => SecurityPermissionService::RIGHT_OVERRIDE_ENTITY_MEMORY", $action);
        self::assertStringContainsString('logEntitySelectedFirstContact', $action);
        self::assertStringContainsString('logEntityOverrideDeniedByRole', $action);
        self::assertStringContainsString('logEntityOverrideApproved', $action);

        foreach ([
            'PROFILE_ROLE_MAPPING_CREATED',
            'PROFILE_ROLE_MAPPING_UPDATED',
            'PROFILE_ROLE_MAPPING_DISABLED',
            'ENTITY_SELECTED_FIRST_CONTACT',
            'ENTITY_OVERRIDE_DENIED_BY_ROLE',
            'ENTITY_OVERRIDE_APPROVED',
        ] as $eventName) {
            self::assertStringContainsString($eventName, $audit);
        }
        self::assertStringContainsString('bootstrap_first_direcao', $audit);
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
        ] as $relative) {
            self::assertStringContainsString('requirePermissionOrDeny', $this->read($relative), $relative);
        }

        $securityCenter = $this->read('front/security.center.php');
        self::assertStringContainsString('canViewSecurityCenter', $securityCenter);
        self::assertStringContainsString('canManageProfileRoleMappings', $securityCenter);
        self::assertStringContainsString('hasRight(SecurityPermissionService::RIGHT_MANAGE_SECURITY_CENTER)', $securityCenter);
    }

    public function testSecurityCenterMenuRegistered(): void
    {
        $setup = $this->read('setup.php');
        self::assertStringContainsString('SecurityCenterMenu', $setup);
        // FIX2: SecurityCenterMenu is reachable as a child of Gestão, not a
        // standalone top-level MENU_TOADD key. registerClass remains so direct
        // URL access and GLPI type resolution still work.
        self::assertStringContainsString('registerClass(SecurityCenterMenu::class)', $setup);
        self::assertStringNotContainsString("'plugin_integaglpi_security_center' => [", $setup);
    }

    // ── FIX1: separation between security_admin and operational role ────────

    public function testSecurityAdminSeparatedFromOperationalRole(): void
    {
        $svc = $this->read('src/Service/SecurityPermissionService.php');
        // isSecurityAdmin() is a first-class method.
        self::assertStringContainsString('public static function isSecurityAdmin', $svc);
        // canManageSecurityCenter() is role-mapping driven; bootstrap is only
        // handled explicitly by security.center.php for save_profile_roles.
        self::assertStringContainsString('canBootstrapFirstDirecaoMapping', $svc);
        self::assertMatchesRegularExpression('/canManageSecurityCenter[\s\S]+return self::hasRight\(self::RIGHT_MANAGE_SECURITY_CENTER\);/s', $svc);
        self::assertMatchesRegularExpression('/canManageProfileRoleMappings[\s\S]+return self::hasRight\(self::RIGHT_MANAGE_SECURITY_CENTER\);/s', $svc);
        self::assertDoesNotMatchRegularExpression('/requirePermissionOrDeny[\s\S]+canManageSecurityCenter\(\)/s', $svc);
    }

    public function testIsSecurityAdminAcceptsNativeGlpiAdminSignals(): void
    {
        $svc = $this->read('src/Service/SecurityPermissionService.php');
        // Strong native signals: config UPDATE / user UPDATE / profile UPDATE.
        self::assertStringContainsString("['config', UPDATE]", $svc);
        self::assertStringContainsString("['user', UPDATE]", $svc);
        self::assertStringContainsString("['profile', UPDATE]", $svc);
        self::assertStringNotContainsString('$adminNames', $svc);
        self::assertStringNotContainsString('super-admin', $svc);
        // No hardcoded user_id / profile_id.
        self::assertDoesNotMatchRegularExpression('/profile_id\s*===?\s*\d/', $svc);
        self::assertDoesNotMatchRegularExpression('/profiles_id\s*===?\s*\d/', $svc);
        self::assertDoesNotMatchRegularExpression('/getLoginUserID\(\)\s*===?\s*\d/', $svc);
    }

    public function testOnlyDirecaoCanManageSecurityCenterAfterBootstrap(): void
    {
        $svc = $this->read('src/Service/SecurityPermissionService.php');
        // Técnico / Supervisão are explicitly denied manage_security_center.
        foreach ([
            'ROLE_TECNICO',
            'ROLE_SUPERVISAO',
        ] as $role) {
            self::assertMatchesRegularExpression(
                '/' . $role . '\s*=>\s*\[[^\]]*RIGHT_MANAGE_SECURITY_CENTER/s',
                $svc,
                $role . ' must be in ROLE_DENIED for RIGHT_MANAGE_SECURITY_CENTER'
            );
        }
        self::assertMatchesRegularExpression('/ROLE_DIRECAO\s*=>\s*\[[^\]]*RIGHT_MANAGE_SECURITY_CENTER/s', $svc);
    }

    public function testTecnicoCanOnlySelectInitialEntity(): void
    {
        $svc = $this->read('src/Service/SecurityPermissionService.php');
        self::assertMatchesRegularExpression('/ROLE_TECNICO\s*=>\s*\[[^\]]*RIGHT_SELECT_ENTITY/s', $svc);
        self::assertMatchesRegularExpression(
            '/ROLE_DENIED\s*=\s*\[[\s\S]+ROLE_TECNICO\s*=>\s*\[[^\]]*RIGHT_OVERRIDE_ENTITY_MEMORY/s',
            $svc
        );
    }

    // ── FIX1: matrix persistence via GLPI Config ────────────────────────────

    public function testMatrixPersistenceUsesGlpiConfigWithoutDdl(): void
    {
        $svc = $this->read('src/Service/SecurityPermissionService.php');
        self::assertStringContainsString("CONFIG_CONTEXT  = 'plugin:integaglpi'", $svc);
        self::assertStringContainsString("CONFIG_KEY      = 'security_matrix_overrides'", $svc);
        self::assertStringContainsString("PROFILE_ROLE_MAPPING_CONFIG_KEY = 'security_profile_role_mapping'", $svc);
        self::assertStringContainsString('Config::getConfigurationValues', $svc);
        self::assertStringContainsString('use GlpiPlugin\\Integaglpi\\Support\\Db;', $svc);
        self::assertStringContainsString('loadConfigValue', $svc);
        self::assertStringContainsString('persistConfigValue', $svc);
        self::assertStringContainsString("'SELECT' => ['value']", $svc);
        self::assertStringContainsString("'FROM' => 'glpi_configs'", $svc);
        self::assertStringContainsString("Db::update('glpi_configs'", $svc);
        self::assertStringContainsString("Db::insert('glpi_configs'", $svc);
        self::assertStringNotContainsString('Config::setConfigurationValues', $svc);
        self::assertStringContainsString('getEffectiveMatrix', $svc);
        self::assertStringContainsString('saveMatrixOverrides', $svc);
        self::assertStringContainsString('loadMatrixOverrides', $svc);
        // No DDL/runtime schema mutation.
        self::assertStringNotContainsString('CREATE TABLE', $svc);
        self::assertStringNotContainsString('ALTER TABLE', $svc);
        self::assertStringNotContainsString('CREATE INDEX', $svc);
        self::assertStringNotContainsString('ensureSchema', $svc);
    }

    public function testProfileRoleMappingDoesNotUseProfileNames(): void
    {
        $svc = $this->read('src/Service/SecurityPermissionService.php');
        self::assertStringContainsString('loadProfileRoleMappings', $svc);
        self::assertStringContainsString('saveProfileRoleMappings', $svc);
        self::assertStringContainsString('getCurrentProfileIds', $svc);
        self::assertStringContainsString('ROLE_PRIORITY', $svc);
        self::assertStringContainsString('TECNICO    => 10', $svc);
        self::assertStringContainsString('SUPERVISAO => 20', $svc);
        self::assertStringContainsString('DIRECAO    => 30', $svc);
        self::assertStringNotContainsString("strpos(\$profileName", $svc);
        self::assertStringNotContainsString('coordenador', $svc);
    }

    public function testRoleDeniedNeverRelaxableViaSavedMatrix(): void
    {
        $svc = $this->read('src/Service/SecurityPermissionService.php');
        // saveMatrixOverrides filters out anything in ROLE_DENIED[$role].
        self::assertMatchesRegularExpression(
            '/saveMatrixOverrides[\s\S]+ROLE_DENIED\[\$role\]/s',
            $svc
        );
        // getEffectiveMatrix also filters ROLE_DENIED when applying overrides.
        self::assertMatchesRegularExpression(
            '/getEffectiveMatrix[\s\S]+ROLE_DENIED\[\$role\]/s',
            $svc
        );
    }

    // ── FIX1: editable matrix UI ────────────────────────────────────────────

    public function testSecurityCenterTemplateRendersEditableForm(): void
    {
        $template = $this->read('templates/security_center.php');
        self::assertStringContainsString('Mapeamento de perfis GLPI para papéis do plugin', $template);
        self::assertStringContainsString('js-integaglpi-security-matrix-form', $template);
        self::assertStringContainsString('js-integaglpi-security-matrix-table', $template);
        self::assertStringContainsString('js-integaglpi-profile-role-mapping-form', $template);
        self::assertStringContainsString('name="profile_roles[', $template);
        self::assertStringContainsString('value="save_profile_roles"', $template);
        self::assertStringContainsString('<button type="submit" name="action" value="save_profile_roles"', $template);
        self::assertStringContainsString('Nenhum perfil Direção foi configurado. Como Super-Admin GLPI, você pode definir o primeiro perfil Direção.', $template);
        self::assertStringContainsString('A matriz granular fica bloqueada até existir pelo menos um perfil Direção configurado.', $template);
        self::assertStringContainsString('js-integaglpi-perm-checkbox', $template);
        self::assertStringContainsString("name=\"matrix[", $template);
        self::assertStringContainsString('Plugin::renderCsrfToken()', $template);
        // Both buttons present.
        self::assertStringContainsString("name=\"action\" value=\"save_matrix\"", $template);
        self::assertStringContainsString("value=\"review_matrix\"", $template);
        // Security admin badge separated from operational role label.
        self::assertStringContainsString('isSecurityAdmin', $template);
        self::assertStringContainsString('Direção · Segurança', $template);
        self::assertStringContainsString('Bootstrap inicial', $template);
        // Read-only fallback for non-admin viewers.
        self::assertStringContainsString('disabled', $template);
    }

    public function testSecurityCenterControllerHandlesSaveAndReview(): void
    {
        $controller = $this->read('front/security.center.php');
        self::assertStringContainsString("\$postedAction === 'save_matrix'", $controller);
        self::assertStringContainsString("\$postedAction === 'review_matrix'", $controller);
        self::assertStringContainsString("\$postedAction === 'save_profile_roles'", $controller);
        self::assertStringContainsString('saveMatrixOverrides', $controller);
        self::assertStringContainsString('saveProfileRoleMappings', $controller);
        self::assertStringContainsString('canManageProfileRoleMappings', $controller);
        self::assertStringContainsString('canBootstrapFirstDirecaoMapping', $controller);
        self::assertStringContainsString('$canManageProfileRoles = SecurityPermissionService::canManageProfileRoleMappings()', $controller);
        self::assertStringContainsString('$bootstrapAllowed = SecurityPermissionService::canBootstrapFirstDirecaoMapping()', $controller);
        self::assertStringContainsString('!$canManageProfileRoles && !$bootstrapAllowed', $controller);
        self::assertStringContainsString('$bootstrapAllowed && !$canManageProfileRoles', $controller);
        self::assertStringContainsString('$wasBootstrapFirstDirecao = $bootstrapAllowed && !$canManageProfileRoles', $controller);
        self::assertStringContainsString('bootstrap_requires_direcao_only', $controller);
        self::assertStringContainsString('No bootstrap inicial, selecione pelo menos um perfil GLPI como Direção.', $controller);
        self::assertStringContainsString('Somente Direção pode gerenciar permissões do plugin.', $controller);
        self::assertStringContainsString('Apenas o papel Direção pode alterar a matriz granular.', $controller);
        self::assertStringContainsString('logPermissionChanged', $controller);
        self::assertStringContainsString('logProfileRoleMappingChanged', $controller);
        self::assertStringContainsString("logMatrixSaveAttempted('saved'", $controller);
        self::assertStringContainsString("logMatrixSaveAttempted('noop_v1'", $controller);
        self::assertStringContainsString('isCsrfValid', $controller);
        self::assertStringContainsString('RIGHT_MANAGE_SECURITY_CENTER', $controller);
        // The controller uses the effective matrix (defaults + overrides), not raw ROLE_MATRIX.
        self::assertStringContainsString('getEffectiveMatrix', $controller);
    }

    public function testProfileFormPointsToSecurityCenter(): void
    {
        $form = $this->read('front/profile.form.php');
        self::assertStringContainsString('/front/security.center.php', $form);
        self::assertStringContainsString('Central de Segurança', $form);
        self::assertStringContainsString('As permissões granulares são geridas na Central de Segurança', $form);
    }

    public function testSecurityCenterMenuFollowsGlpiSidebarConvention(): void
    {
        $menu = $this->read('src/SecurityCenterMenu.php');
        self::assertStringContainsString('public static function getIcon()', $menu);
        // canView gates visibility — entry is hidden for unauthorised sessions.
        self::assertStringContainsString('if (!self::canView())', $menu);
        self::assertStringContainsString('SecurityPermissionService::canViewSecurityCenter', $menu);
        // FIX2: SecurityCenterMenu is now a leaf reached via Gestão; no longer
        // declares its own expandable dropdown (is_multi_entries / options).
        self::assertStringNotContainsString("'is_multi_entries' => true", $menu);
        self::assertStringNotContainsString("'options'          => [", $menu);
    }

    // ── FIX2: Central de Segurança lives under Gestão ───────────────────────

    public function testSecurityCenterIsChildOfGestaoGroupMenu(): void
    {
        $gestao = $this->read('src/GestaoGroupMenu.php');
        // Child entry must exist with the canonical key + URL + icon.
        self::assertStringContainsString("'central_seguranca'", $gestao);
        self::assertStringContainsString("/front/security.center.php", $gestao);
        self::assertStringContainsString("'ti ti-shield-lock'", $gestao);
        // Visibility gated by SecurityPermissionService — no hard-coded role check.
        self::assertStringContainsString('SecurityPermissionService::canViewSecurityCenter', $gestao);
        // canView() also exposes the security entry to admins even when
        // contract/catalog rights are missing.
        self::assertMatchesRegularExpression(
            '/canView\(\)[\s\S]+canViewSecurityCenter\(\)/s',
            $gestao
        );
    }

    public function testLegacyProfilePermissionMenuFramedAsBootstrap(): void
    {
        $gestao = $this->read('src/GestaoGroupMenu.php');
        // FIX2: the legacy "Perfis e Permissões" entry is renamed and reframed
        // so operators no longer mistake it for granular RBAC management.
        self::assertStringContainsString('Perfis GLPI — bootstrap Ler/Atualizar', $gestao);
        self::assertStringContainsString("'perfis_permissoes_bootstrap'", $gestao);
        self::assertStringNotContainsString("'perfis_permissoes'           => [", $gestao);
    }

    public function testCentralTemplateExplainsHybridModelAndBootstrap(): void
    {
        $template = $this->read('templates/security_center.php');
        // "Como funciona" section explaining the hybrid GLPI + plugin model.
        self::assertStringContainsString('Como funciona', $template);
        self::assertStringContainsString('GLPI nativo:', $template);
        self::assertStringContainsString('IntegraGLPI granular:', $template);
        self::assertStringContainsString('Backend enforcement:', $template);
        self::assertStringContainsString('ROLE_DENIED:', $template);
        // "Bootstrap GLPI" section with link to /front/profile.form.php.
        self::assertStringContainsString('Bootstrap GLPI (Ler / Atualizar)', $template);
        self::assertStringContainsString('/front/profile.form.php', $template);
    }

    public function testProfileFormCardHeaderFramedAsBootstrap(): void
    {
        $form = $this->read('front/profile.form.php');
        // FIX2: card header explicitly labels this screen as bootstrap, not
        // granular RBAC management.
        self::assertStringContainsString('Bootstrap GLPI — PluginIntegaglpi (Ler / Atualizar)', $form);
        self::assertStringContainsString('alert-warning', $form);
    }
}
