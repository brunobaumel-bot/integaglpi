<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi;

use CommonDBTM;

final class RoutingOptionsMenu extends CommonDBTM
{
    public static $rightname = Plugin::RIGHT_NAME;

    public static function getTypeName($nb = 0): string
    {
        return __('Filas e Roteamento', 'glpiintegaglpi');
    }

    public static function getMenuName($nb = 0): string
    {
        return __('Filas e Roteamento', 'glpiintegaglpi');
    }

    /**
     * @return array<string, mixed>
     */
    public static function getMenuContent(): array
    {
        return [
            'title' => self::getMenuName(),
            'page'  => Plugin::getRoutingOptionsAdminUrl(),
            'icon'  => 'ti ti-route',
        ];
    }

    public static function canView(): bool
    {
        return Plugin::canUpdate();
    }
}
