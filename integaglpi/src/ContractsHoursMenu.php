<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi;

use CommonDBTM;

final class ContractsHoursMenu extends CommonDBTM
{
    public static $rightname = Plugin::RIGHT_NAME;

    public static function getTypeName($nb = 0): string
    {
        return __('Contratos e Horas', 'glpiintegaglpi');
    }

    public static function getMenuName($nb = 0): string
    {
        return __('Contratos e Horas', 'glpiintegaglpi');
    }

    /**
     * @return array<string, mixed>
     */
    public static function getMenuContent(): array
    {
        return [
            'title' => self::getMenuName(),
            'page' => Plugin::getContractHoursUrl(),
            'icon' => 'ti ti-file-time',
        ];
    }

    /**
     * Returns false to hide from the plugin sidebar.
     *
     * NOTE (integaglpi_plugin_logmein_menu_reorganization_001):
     *   GLPI-native Contracts are the single source of truth.
     *   This plugin's Contracts/Hours page remains accessible via direct URL
     *   (/front/contracts.hours.php) for Admin use but is no longer shown in
     *   the sidebar as a main operational CRUD entry.
     *   Data, routes and internal audit references are fully preserved.
     */
    public static function canView(): bool
    {
        return false;
    }
}
