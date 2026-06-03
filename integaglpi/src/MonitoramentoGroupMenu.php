<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi;

use CommonDBTM;

/**
 * Parent menu group: Monitoramento.
 *
 * The sidebar exposes one consolidated operational entry. The detailed legacy
 * routes remain reachable from the hub page as drill-down links.
 */
final class MonitoramentoGroupMenu extends CommonDBTM
{
    public static $rightname = Plugin::RIGHT_NAME;

    public static function getTypeName($nb = 0): string
    {
        return __('Monitoramento', 'glpiintegaglpi');
    }

    public static function getMenuName($nb = 0): string
    {
        return __('Monitoramento', 'glpiintegaglpi');
    }

    public static function getIcon(): string
    {
        return 'ti ti-heartbeat';
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
            'monitoramento_operacional' => [
                'title' => __('Monitoramento Operacional', 'glpiintegaglpi'),
                'page'  => Plugin::getTechnicalHealthUrl(),
                'icon'  => 'ti ti-dashboard',
            ],
        ];
    }

    public static function canView(): bool
    {
        return Plugin::canQualityDashboardRead()
            || Plugin::canOnlineMonitorRead()
            || Plugin::canObservabilityRead()
            || Plugin::canOperationalDiagnosticsRead()
            || Plugin::canAuditRead();
    }
}
