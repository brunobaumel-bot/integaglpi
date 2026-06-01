<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi;

use CommonDBTM;

/**
 * Sidebar leaf menu entry: Saúde Técnica IntegraGLPI.
 *
 * Phase: integaglpi_technical_runtime_dashboard_unification_001.
 * Registered as a child of MonitoramentoGroupMenu. Reachable also directly at
 * /front/technical.health.php for bookmark / direct-link access.
 */
final class TechnicalHealthMenu extends CommonDBTM
{
    public static $rightname = Plugin::RIGHT_NAME;

    public static function getTypeName($nb = 0): string
    {
        return __('Saúde Técnica IntegraGLPI', 'glpiintegaglpi');
    }

    public static function getMenuName($nb = 0): string
    {
        return __('Saúde Técnica IntegraGLPI', 'glpiintegaglpi');
    }

    public static function getIcon(): string
    {
        return 'ti ti-dashboard';
    }

    public static function getUrl(): string
    {
        return Plugin::getTechnicalHealthUrl();
    }

    public static function canView(): bool
    {
        return Plugin::canOperationalDiagnosticsRead()
            || Plugin::canObservabilityRead()
            || Plugin::canAuditRead();
    }
}
