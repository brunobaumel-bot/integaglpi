<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi;

use CommonDBTM;

final class SupervisorBackofficeMenu extends CommonDBTM
{
    public static $rightname = Plugin::RIGHT_NAME;

    public static function getTypeName($nb = 0): string
    {
        return __('Backoffice Supervisor', 'glpiintegaglpi');
    }

    public static function getMenuName($nb = 0): string
    {
        return __('Backoffice Supervisor', 'glpiintegaglpi');
    }

    /**
     * @return array<string, mixed>
     */
    public static function getMenuContent(): array
    {
        return [
            'title' => self::getMenuName(),
            'page'  => Plugin::getSupervisorBackofficeUrl(),
            'icon'  => 'ti ti-chart-bar',
        ];
    }

    public static function canView(): bool
    {
        return Plugin::canSupervisorRead();
    }
}
