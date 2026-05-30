<?php

declare(strict_types=1);

use GlpiPlugin\Integaglpi\Plugin;
use GlpiPlugin\Integaglpi\Service\SecurityAuditService;
use GlpiPlugin\Integaglpi\Service\SecurityPermissionService;

include '../../../inc/includes.php';

Session::checkLoginUser();

/**
 * Phase: integaglpi_security_access_center_rbac_profiles_001_FIX1.
 *
 * Backend enforcement:
 *  - GET  → requires canViewSecurityCenter (view_security_center OR
 *           isSecurityAdmin → admin/super-admin).
 *  - POST → requires canManageSecurityCenter (= isSecurityAdmin) and CSRF.
 *
 * Two POST actions are supported, both auditable:
 *  - action=save_matrix   → persists ROLE_MATRIX overrides via Config::setConfigurationValues
 *                           and emits SECURITY_PERMISSION_CHANGED per added/removed right.
 *  - action=review_matrix → noop_v1, only emits SECURITY_MATRIX_SAVE_ATTEMPTED with
 *                           result=noop_v1 (registro de revisão sem alterar matriz).
 */
$method = strtoupper(trim((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET')));

if ($method === 'GET' && !SecurityPermissionService::canViewSecurityCenter()) {
    SecurityAuditService::logAccessDenied(
        SecurityPermissionService::RIGHT_VIEW_SECURITY_CENTER,
        ['endpoint' => 'security.center.php', 'method' => 'GET']
    );
    Html::displayRightError();
}

if ($method === 'POST') {
    if (!Plugin::isCsrfValid($_POST)) {
        SecurityAuditService::logMatrixSaveAttempted('csrf_invalid', ['endpoint' => 'security.center.php']);
        http_response_code(403);
        Html::displayErrorAndDie(__('Token de segurança inválido.', 'glpiintegaglpi'));
    }

    $gate = SecurityPermissionService::requirePermissionOrDeny(
        SecurityPermissionService::RIGHT_MANAGE_SECURITY_CENTER,
        ['endpoint' => 'security.center.php', 'method' => 'POST']
    );
    if (!$gate['ok']) {
        SecurityAuditService::logMatrixSaveAttempted('forbidden', ['endpoint' => 'security.center.php']);
        http_response_code(403);
        Html::displayErrorAndDie($gate['message']);
    }

    $postedAction = trim((string) ($_POST['action'] ?? ''));
    if ($postedAction === 'save_matrix') {
        $raw = $_POST['matrix'] ?? [];
        $proposed = [];
        if (is_array($raw)) {
            foreach ([
                SecurityPermissionService::ROLE_TECNICO,
                SecurityPermissionService::ROLE_SUPERVISAO,
                SecurityPermissionService::ROLE_DIRECAO,
            ] as $role) {
                $rights = $raw[$role] ?? [];
                $proposed[$role] = is_array($rights)
                    ? array_values(array_filter(
                        array_map(static fn ($v): string => is_string($v) ? trim($v) : '', $rights),
                        static fn (string $v): bool => $v !== ''
                    ))
                    : [];
            }
        }

        try {
            $diff = SecurityPermissionService::saveMatrixOverrides($proposed);
            foreach ($diff as $role => $changes) {
                foreach (($changes['added'] ?? []) as $rightAdded) {
                    SecurityAuditService::logPermissionChanged($rightAdded, null, $role, [
                        'change'   => 'granted',
                        'endpoint' => 'security.center.php',
                    ]);
                }
                foreach (($changes['removed'] ?? []) as $rightRemoved) {
                    SecurityAuditService::logPermissionChanged($rightRemoved, $role, null, [
                        'change'   => 'revoked',
                        'endpoint' => 'security.center.php',
                    ]);
                }
            }
            SecurityAuditService::logMatrixSaveAttempted('saved', [
                'endpoint' => 'security.center.php',
                'roles_changed' => array_keys(array_filter($diff, static fn (array $d): bool => $d['added'] !== [] || $d['removed'] !== [])),
            ]);
            Session::addMessageAfterRedirect(
                __('Matriz de permissões atualizada com sucesso.', 'glpiintegaglpi')
            );
        } catch (\Throwable $exception) {
            error_log('[integaglpi][security_center][save_failed] ' . $exception->getMessage());
            SecurityAuditService::logMatrixSaveAttempted('save_failed', [
                'endpoint' => 'security.center.php',
                'error' => $exception->getMessage(),
            ]);
            Session::addMessageAfterRedirect(
                __('Falha ao salvar a matriz. Verifique o log e tente novamente.', 'glpiintegaglpi'),
                false,
                ERROR
            );
        }

        Html::redirect($_SERVER['PHP_SELF']);
    }

    if ($postedAction === 'review_matrix') {
        SecurityAuditService::logMatrixSaveAttempted('noop_v1', ['endpoint' => 'security.center.php']);
        Session::addMessageAfterRedirect(
            __('Revisão da matriz registrada para auditoria (sem alteração de permissões).', 'glpiintegaglpi')
        );
        Html::redirect($_SERVER['PHP_SELF']);
    }

    SecurityAuditService::logMatrixSaveAttempted('invalid_action', [
        'endpoint' => 'security.center.php',
        'action' => $postedAction,
    ]);
    http_response_code(400);
    Html::displayErrorAndDie(__('Ação inválida para a Central de Segurança.', 'glpiintegaglpi'));
}

// ── GET render ──
Html::header(
    __('Central de Segurança', 'glpiintegaglpi'),
    $_SERVER['PHP_SELF'],
    'plugins',
    \GlpiPlugin\Integaglpi\SecurityCenterMenu::class
);

SecurityAuditService::logMatrixViewed();

$currentRole     = SecurityPermissionService::resolveCurrentRole();
$isSecurityAdmin = SecurityPermissionService::isSecurityAdmin();
$canManage       = SecurityPermissionService::canManageSecurityCenter();
$matrix          = SecurityPermissionService::getEffectiveMatrix();
$denied          = SecurityPermissionService::getRoleDenied();
$allRights       = SecurityPermissionService::getAllRights();
sort($allRights);

include __DIR__ . '/../templates/security_center.php';

Html::footer();
