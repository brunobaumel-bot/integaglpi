<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi;

use CommonDBTM;

final class QualityDashboardMenu extends CommonDBTM
{
    public static $rightname = Plugin::RIGHT_NAME;

    public static function getTypeName($nb = 0): string
    {
        return __('Dashboard de Qualidade', 'glpiintegaglpi');
    }

    public static function getMenuName($nb = 0): string
    {
        return __('Dashboard de Qualidade', 'glpiintegaglpi');
    }

    /**
     * @return array<string, mixed>
     */
    public static function getMenuContent(): array
    {
        return [
            'title' => self::getMenuName(),
            'page'  => Plugin::getQualityDashboardUrl(),
            'icon'  => 'ti ti-dashboard',
        ];
    }

    public static function canView(): bool
    {
        return Plugin::canQualityDashboardRead();
    }
}
