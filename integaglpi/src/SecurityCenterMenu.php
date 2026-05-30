<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi;

use CommonDBTM;
use GlpiPlugin\Integaglpi\Service\SecurityPermissionService;

/**
 * Sidebar entry for the Security Access Center.
 *
 * Phase: integaglpi_security_access_center_rbac_profiles_001_FIX2.
 *
 * The Central de Segurança is now reached as a child of the Gestão group menu
 * (see GestaoGroupMenu::getMenuContent). This class remains registered so:
 *   - GLPI can resolve the type for direct URL access to /front/security.center.php;
 *   - canView() centralises sidebar visibility against SecurityPermissionService;
 *   - getIcon() / getUrl() provide stable hooks for the parent group renderer.
 *
 * Returning a leaf-shape getMenuContent (no is_multi_entries) avoids the GLPI
 * dropdown machinery — this entry is a single page link, not an expandable
 * sector. The sidebar UX is now consistent with the other Gestão children.
 */
final class SecurityCenterMenu extends CommonDBTM
{
    public static $rightname = Plugin::RIGHT_NAME;

    public static function getTypeName($nb = 0): string
    {
        return __('Central de Segurança', 'glpiintegaglpi');
    }

    public static function getMenuName($nb = 0): string
    {
        return __('Central de Segurança', 'glpiintegaglpi');
    }

    public static function getIcon(): string
    {
        return 'ti ti-shield-lock';
    }

    /**
     * @return array<string, mixed>
     */
    public static function getMenuContent(): array
    {
        if (!self::canView()) {
            return [];
        }

        return [
            'title' => self::getMenuName(),
            'page'  => self::getUrl(),
            'icon'  => self::getIcon(),
        ];
    }

    public static function getUrl(): string
    {
        return Plugin::getWebBasePath() . '/front/security.center.php';
    }

    public static function canView(): bool
    {
        return SecurityPermissionService::canViewSecurityCenter();
    }
}
