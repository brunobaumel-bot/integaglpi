<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi;

use CommonDBTM;

/**
 * Parent menu group: Monitoramento / Qualidade.
 *
 * Aggregates QualityDashboardMenu, ObservabilityMenu,
 * OperationalDiagnosticsMenu, OperationLogMenu, and RoutingSafetyMenu as GLPI
 * submenu options so the sidebar shows one collapsible entry instead of five
 * flat items.
 *
 * FIX2: integaglpi_ops_console_claim_ui_messaging_stabilization_001_FIX2.
 */
final class MonitoramentoGroupMenu extends CommonDBTM
{
    public static $rightname = Plugin::RIGHT_NAME;

    public static function getTypeName($nb = 0): string
    {
        return __('Monitoramento / Qualidade', 'glpiintegaglpi');
    }

    public static function getMenuName($nb = 0): string
    {
        return __('Monitoramento / Qualidade', 'glpiintegaglpi');
    }

    /**
     * @return array<string, mixed>
     */
    public static function getMenuContent(): array
    {
        return [
            'title'   => self::getMenuName(),
            'page'    => Plugin::getQualityDashboardUrl(),
            'icon'    => 'ti ti-heartbeat',
            'options' => [
                'quality'       => [
                    'title' => QualityDashboardMenu::getMenuName(),
                    'page'  => Plugin::getQualityDashboardUrl(),
                    'icon'  => 'ti ti-dashboard',
                ],
                'observability' => [
                    'title' => ObservabilityMenu::getMenuName(),
                    'page'  => Plugin::getObservabilityUrl(),
                    'icon'  => 'ti ti-heartbeat',
                ],
                'diagnostics'   => [
                    'title' => OperationalDiagnosticsMenu::getMenuName(),
                    'page'  => Plugin::getOperationalDiagnosticsUrl(),
                    'icon'  => 'ti ti-activity',
                ],
                'audit'         => [
                    'title' => OperationLogMenu::getMenuName(),
                    'page'  => Plugin::getAuditUrl(),
                    'icon'  => 'ti ti-shield-search',
                ],
                'routing'       => [
                    'title' => RoutingSafetyMenu::getMenuName(),
                    'page'  => Plugin::getRoutingSafetyUrl(),
                    'icon'  => 'ti ti-route',
                ],
            ],
        ];
    }

    public static function canView(): bool
    {
        return Plugin::canQualityDashboardRead()
            || Plugin::canObservabilityRead()
            || Plugin::canOperationalDiagnosticsRead()
            || Plugin::canAuditRead();
    }
}
