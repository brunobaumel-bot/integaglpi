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
                    'page'  => Plugin::getOnlineMonitorUrl() . '?view=supervisor',
                    'icon'  => 'ti ti-activity',
                ],
                'health_status'   => [
                    'title' => __('Health / Status de Serviços', 'glpiintegaglpi'),
                    'page'  => Plugin::getOperationalDiagnosticsUrl() . '?view=health',
                    'icon'  => 'ti ti-activity',
                ],
                'central_eventos' => [
                    'title' => __('Central de Eventos Operacionais', 'glpiintegaglpi'),
                    'page'  => Plugin::getAuditUrl() . '?view=events',
                    'icon'  => 'ti ti-shield-search',
                ],
                'observabilidade_whatsapp' => [
                    'title' => __('Observabilidade WhatsApp', 'glpiintegaglpi'),
                    'page'  => Plugin::getObservabilityUrl(),
                    'icon'  => 'ti ti-heartbeat',
                ],
                'diagnostico_operacional' => [
                    'title' => __('Diagnóstico Operacional', 'glpiintegaglpi'),
                    'page'  => Plugin::getOperationalDiagnosticsUrl() . '?view=diagnostics',
                    'icon'  => 'ti ti-stethoscope',
                ],
                'roteamento_seguro' => [
                    'title' => __('Roteamento Seguro', 'glpiintegaglpi'),
                    'page'  => Plugin::getRoutingSafetyUrl(),
                    'icon'  => 'ti ti-route',
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
