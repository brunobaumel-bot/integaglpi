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
                'saude_tecnica' => [
                    'title' => __('Saúde Técnica IntegraGLPI', 'glpiintegaglpi'),
                    'page'  => Plugin::getTechnicalHealthUrl(),
                    'icon'  => 'ti ti-dashboard',
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
                'auditoria_operacional' => [
                    'title' => __('Auditoria Operacional', 'glpiintegaglpi'),
                    'page'  => Plugin::getOperationLogUrl(),
                    'icon'  => 'ti ti-shield-search',
                ],
                'filas_roteamento' => [
                    'title' => __('Filas e Roteamento', 'glpiintegaglpi'),
                    'page'  => Plugin::getRoutingOptionsAdminUrl(),
                    'icon'  => 'ti ti-route',
                ],
                'roteamento_seguro' => [
                    'title' => __('Roteamento Seguro', 'glpiintegaglpi'),
                    'page'  => Plugin::getRoutingSafetyUrl(),
                    'icon'  => 'ti ti-route',
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
