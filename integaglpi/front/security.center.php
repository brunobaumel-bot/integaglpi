<?php

declare(strict_types=1);

use GlpiPlugin\Integaglpi\Plugin;
use GlpiPlugin\Integaglpi\SecurityCenterMenu;
use GlpiPlugin\Integaglpi\Service\SecurityAuditService;
use GlpiPlugin\Integaglpi\Service\SecurityPermissionService;

include '../../../inc/includes.php';

Session::checkLoginUser();

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

    SecurityAuditService::logMatrixSaveAttempted('noop_v1', ['endpoint' => 'security.center.php']);
    Session::addMessageAfterRedirect(
        __('A matriz de permissões foi registrada para auditoria. Persistência editável virá em versão futura.', 'glpiintegaglpi')
    );
    Html::redirect($_SERVER['PHP_SELF']);
}

Html::header(
    __('Central de Segurança', 'glpiintegaglpi'),
    $_SERVER['PHP_SELF'],
    'plugins',
    SecurityCenterMenu::class
);

SecurityAuditService::logMatrixViewed();

$currentRole = SecurityPermissionService::resolveCurrentRole();
$canManage = SecurityPermissionService::canManageSecurityCenter();
$matrix = SecurityPermissionService::getRoleMatrix();
$denied = SecurityPermissionService::getRoleDenied();
$allRights = SecurityPermissionService::getAllRights();
sort($allRights);

include __DIR__ . '/../templates/security_center.php';

Html::footer();
