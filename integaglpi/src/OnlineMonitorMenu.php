<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi;

use CommonDBTM;

final class OnlineMonitorMenu extends CommonDBTM
{
    public static $rightname = Plugin::RIGHT_NAME;

    public static function getTypeName($nb = 0): string
    {
        return __('Monitor Online WhatsApp', 'glpiintegaglpi');
    }

    public static function getMenuName($nb = 0): string
    {
        return __('Monitor Online WhatsApp', 'glpiintegaglpi');
    }

    /**
     * @return array<string, mixed>
     */
    public static function getMenuContent(): array
    {
        return [
            'title' => self::getMenuName(),
            'page' => Plugin::getOnlineMonitorUrl(),
            'icon' => 'ti ti-activity',
        ];
    }

    public static function canView(): bool
    {
        return Plugin::canOnlineMonitorRead();
    }
}
