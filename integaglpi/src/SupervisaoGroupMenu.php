<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi;

use CommonDBTM;

/**
 * Parent menu group: Supervisão.
 *
 * Exposes one consolidated supervisory hub in the sidebar. Detailed legacy
 * routes remain available from the hub drill-downs and by direct URL.
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

    public static function getIcon(): string
    {
        return 'ti ti-chart-bar';
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
            'title'            => self::getMenuName(),
            'is_multi_entries' => true,
            'central_supervisor' => [
                'title' => __('Central do Supervisor', 'glpiintegaglpi'),
                'page'  => Plugin::getWebBasePath() . '/front/supervisor.command.php',
                'icon'  => 'ti ti-layout-dashboard',
            ],
        ];
    }

    public static function canView(): bool
    {
        return Plugin::canOnlineMonitorRead()
            || Plugin::canQualityDashboardRead()
            || Plugin::canSupervisorRead();
    }
}
