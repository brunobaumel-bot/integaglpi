<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi;

use CommonDBTM;

/**
 * Parent menu group: Supervisão.
 *
 * Exposes supervisory views and parameters in the final sidebar hierarchy.
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
                'command_center' => [
                    'title' => __('Dashboard Geral do Supervisor', 'glpiintegaglpi'),
                    'page'  => Plugin::getWebBasePath() . '/front/supervisor.command.php',
                    'icon'  => 'ti ti-layout-dashboard',
                ],
                'backoffice_supervisor'  => [
                    'title' => __('Backoffice Supervisor', 'glpiintegaglpi'),
                    'page'  => Plugin::getSupervisorBackofficeUrl(),
                    'icon'  => 'ti ti-users',
                ],
                'dashboard_qualidade'    => [
                    'title' => __('Dashboard de Qualidade', 'glpiintegaglpi'),
                    'page'  => Plugin::getQualityDashboardUrl(),
                    'icon'  => 'ti ti-dashboard',
                ],
                'sla_qualidade'          => [
                    'title' => __('SLA e Qualidade / métricas, aging, filas', 'glpiintegaglpi'),
                    'page'  => Plugin::getQualityDashboardUrl() . '?view=sla',
                    'icon'  => 'ti ti-dashboard',
                ],
                'relatorios_operacionais' => [
                    'title' => __('Relatórios Operacionais', 'glpiintegaglpi'),
                    'page'  => Plugin::getSupervisorBackofficeUrl() . '?view=reports',
                    'icon'  => 'ti ti-chart-bar',
                ],
                'alertas_ia'             => [
                    'title' => __('Alertas IA / configuração', 'glpiintegaglpi'),
                    'page'  => Plugin::getOnlineMonitorUrl() . '?tab=ai_alerts',
                    'icon'  => 'ti ti-alert-triangle',
                ],
                'inatividade_autoclose'  => [
                    'title' => __('Inatividade e Autoclose / parâmetros', 'glpiintegaglpi'),
                    'page'  => Plugin::getQueueAdminUrl() . '?tab=message_settings&section=avisos_inatividade',
                    'icon'  => 'ti ti-clock-pause',
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
