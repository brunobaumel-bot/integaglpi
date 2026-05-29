<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi;

use CommonDBTM;

/**
 * Parent menu group: Supervisão.
 *
 * Aggregates OnlineMonitorMenu and SupervisorBackofficeMenu as GLPI submenu
 * options so the sidebar shows one collapsible entry instead of two flat items.
 *
 * FIX2: integaglpi_ops_console_claim_ui_messaging_stabilization_001_FIX2.
 */
final class SupervisaoGroupMenu extends CommonDBTM
{
    public static $rightname = Plugin::RIGHT_NAME;

    public static function getTypeName($nb = 0): string
    {
        return __('Supervisão', 'glpiintegaglpi');
    }

    public static function getMenuName($nb = 0): string
    {
        return __('Supervisão', 'glpiintegaglpi');
    }

    /**
     * @return array<string, mixed>
     */
    public static function getMenuContent(): array
    {
        return [
            'title'   => self::getMenuName(),
            'page'    => Plugin::getOnlineMonitorUrl(),
            'icon'    => 'ti ti-chart-bar',
            'options' => [
                'monitor'    => [
                    'title' => OnlineMonitorMenu::getMenuName(),
                    'page'  => Plugin::getOnlineMonitorUrl(),
                    'icon'  => 'ti ti-activity',
                ],
                'backoffice' => [
                    'title' => SupervisorBackofficeMenu::getMenuName(),
                    'page'  => Plugin::getSupervisorBackofficeUrl(),
                    'icon'  => 'ti ti-chart-bar',
                ],
            ],
        ];
    }

    public static function canView(): bool
    {
        return Plugin::canOnlineMonitorRead() || Plugin::canSupervisorRead();
    }
}
