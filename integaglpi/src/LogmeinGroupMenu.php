<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi;

use CommonDBTM;
use GlpiPlugin\Integaglpi\Service\SecurityPermissionService;

/**
 * Parent menu group: LogMeIn Central.
 *
 * Aggregates all LogMeIn-related administration pages into a dedicated
 * sidebar group. GLPI-native Contracts and Service Catalog remain the
 * single source of truth for their respective domains — this group only
 * exposes operational and monitoring features specific to LogMeIn Central
 * integration.
 *
 * Items:
 *   - Mapeamento Grupo → Entidade (logmein.mapping.php)
 *   - Mapeamento de Campos / Field Mapping (logmein.fieldmapping.php)
 *   - Regras de Alarmes (logmein.alarm.php)
 *   - Conciliação de Acessos Remotos (logmein.reconciliation.php)
 *   - Relatórios LogMeIn (logmein.reports.php)
 *
 * FORBIDDEN: Never exposes CompanyID, PSK, API tokens or any credential.
 * PHASE: integaglpi_plugin_logmein_menu_reorganization_001
 */
final class LogmeinGroupMenu extends CommonDBTM
{
    public static $rightname = Plugin::RIGHT_NAME;

    public static function getTypeName($nb = 0): string
    {
        return __('LogMeIn Central', 'glpiintegaglpi');
    }

    public static function getMenuName($nb = 0): string
    {
        return __('LogMeIn Central', 'glpiintegaglpi');
    }

    public static function getIcon(): string
    {
        return 'ti ti-devices-pc';
    }

    /**
     * @return array<string, mixed>
     */
    public static function getMenuContent(): array
    {
        if (!self::canView()) {
            return [];
        }

        $children = [];

        // Mapeamento de grupos LogMeIn → entidades GLPI
        if (SecurityPermissionService::hasRight(SecurityPermissionService::RIGHT_MANAGE_LOGMEIN_MAPPING)) {
            $children['logmein_mapping'] = [
                'title' => __('Mapeamento Grupos → Entidades', 'glpiintegaglpi'),
                'page'  => Plugin::getWebBasePath() . '/front/logmein.mapping.php',
                'icon'  => 'ti ti-sitemap',
            ];
        }

        // Field Mapping (campo por campo LogMeIn → GLPI)
        if (Plugin::canRead()) {
            $children['logmein_fieldmapping'] = [
                'title' => __('Mapeamento de Campos', 'glpiintegaglpi'),
                'page'  => Plugin::getWebBasePath() . '/front/logmein.fieldmapping.php',
                'icon'  => 'ti ti-arrows-exchange',
            ];
        }

        // Regras de Alarmes + auto-ticket controlado
        if (Plugin::canRead()) {
            $children['logmein_alarm'] = [
                'title' => __('Regras de Alarmes', 'glpiintegaglpi'),
                'page'  => Plugin::getWebBasePath() . '/front/logmein.alarm.php',
                'icon'  => 'ti ti-bell-ringing',
            ];
        }

        // Conciliação de Acessos Remotos
        if (SecurityPermissionService::hasRight(SecurityPermissionService::RIGHT_MANAGE_LOGMEIN_RECONCILIATION)) {
            $children['logmein_reconciliation'] = [
                'title' => __('Conciliação de Acessos', 'glpiintegaglpi'),
                'page'  => Plugin::getLogmeinReconciliationUrl(),
                'icon'  => 'ti ti-link',
            ];
        }

        // Relatórios operacionais LogMeIn (read-only)
        if (
            SecurityPermissionService::hasRight(SecurityPermissionService::RIGHT_VIEW_CONTRACTS_READONLY)
            || SecurityPermissionService::hasRight(SecurityPermissionService::RIGHT_EXPORT_OPERATIONAL_REPORTS)
            || SecurityPermissionService::hasRight(SecurityPermissionService::RIGHT_MANAGE_LOGMEIN_MAPPING)
        ) {
            $children['logmein_reports'] = [
                'title' => __('Relatórios LogMeIn', 'glpiintegaglpi'),
                'page'  => Plugin::getLogmeinReportsUrl(),
                'icon'  => 'ti ti-report-analytics',
            ];
        }

        if ($children === []) {
            return [];
        }

        return array_merge([
            'title'            => self::getMenuName(),
            'is_multi_entries' => true,
        ], $children);
    }

    public static function canView(): bool
    {
        return Plugin::canRead()
            || SecurityPermissionService::hasRight(SecurityPermissionService::RIGHT_MANAGE_LOGMEIN_MAPPING)
            || SecurityPermissionService::hasRight(SecurityPermissionService::RIGHT_MANAGE_LOGMEIN_RECONCILIATION)
            || SecurityPermissionService::hasRight(SecurityPermissionService::RIGHT_VIEW_CONTRACTS_READONLY)
            || SecurityPermissionService::hasRight(SecurityPermissionService::RIGHT_EXPORT_OPERATIONAL_REPORTS);
    }
}
