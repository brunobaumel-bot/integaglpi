<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi;

use CommonDBTM;
use GlpiPlugin\Integaglpi\Service\SecurityPermissionService;

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

    public static function getMenuContent(): array
    {
        return [
            'title' => self::getMenuName(),
            'page' => self::getUrl(),
            'icon' => 'ti ti-shield-lock',
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
