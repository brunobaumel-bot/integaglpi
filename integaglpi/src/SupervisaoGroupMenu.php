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

        $menu = [
            'title'            => self::getMenuName(),
            'is_multi_entries' => true,
            'central_supervisor' => [
                'title' => __('Central do Supervisor', 'glpiintegaglpi'),
                'page'  => Plugin::getWebBasePath() . '/front/supervisor.command.php',
                'icon'  => 'ti ti-layout-dashboard',
            ],
        ];

        // R3 (closure ressalvas V9): o item do Hub usa o MESMO guard da página
        // (CentralHubMenu::canView() == canSupervisorRead). Antes o item ficava
        // visível para perfis que a página depois bloqueava.
        if (CentralHubMenu::canView()) {
            $menu['central_hub'] = [
                'title' => __('Hub Operacional', 'glpiintegaglpi'),
                'page'  => Plugin::getWebBasePath() . '/front/central_hub.php',
                'icon'  => 'ti ti-layout-grid',
            ];
        }

        return $menu;
    }

    public static function canView(): bool
    {
        return Plugin::canOnlineMonitorRead()
            || Plugin::canQualityDashboardRead()
            || Plugin::canSupervisorRead();
    }
}
