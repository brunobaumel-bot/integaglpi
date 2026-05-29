<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi;

use CommonDBTM;

/**
 * Parent menu group: Monitoramento.
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

    /**
     * @return array<string, mixed>
     */
    public static function getMenuContent(): array
    {
        return [
            'title'   => self::getMenuName(),
            'page'    => Plugin::getOnlineMonitorUrl(),
            'icon'    => 'ti ti-heartbeat',
            'options' => [
                'monitor_online'  => [
                    'title' => __('Monitor Online / visão do supervisor', 'glpiintegaglpi'),
                    'page'  => Plugin::getOnlineMonitorUrl(),
                    'icon'  => 'ti ti-activity',
                ],
                'health_status'   => [
                    'title' => __('Health / Status de Serviços', 'glpiintegaglpi'),
                    'page'  => Plugin::getOperationalDiagnosticsUrl(),
                    'icon'  => 'ti ti-activity',
                ],
                'central_eventos' => [
                    'title' => __('Central de Eventos Operacionais / futura V6', 'glpiintegaglpi'),
                    'page'  => Plugin::getAuditUrl(),
                    'icon'  => 'ti ti-shield-search',
                ],
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
