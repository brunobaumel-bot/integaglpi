<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi;

use CommonDBTM;

final class ServiceCatalogMenu extends CommonDBTM
{
    public static $rightname = Plugin::RIGHT_NAME;

    public static function getTypeName($nb = 0): string
    {
        return __('Catálogo de Serviços', 'glpiintegaglpi');
    }

    public static function getMenuName($nb = 0): string
    {
        return __('Catálogo de Serviços', 'glpiintegaglpi');
    }

    /**
     * @return array<string, mixed>
     */
    public static function getMenuContent(): array
    {
        return [
            'title' => self::getMenuName(),
            'page' => Plugin::getServiceCatalogUrl(),
            'icon' => 'ti ti-list-check',
        ];
    }

    /**
     * Returns false to hide from the plugin sidebar.
     *
     * NOTE (integaglpi_plugin_logmein_menu_reorganization_001):
     *   GLPI-native Service Catalog (Forms, ITILCategories) is the single source
     *   of truth. This plugin's Service Catalog page remains accessible via direct
     *   URL (/front/service.catalog.php) and internal read-only bridges used by
     *   triage routing are preserved. It is no longer shown in the sidebar as a
     *   main operational CRUD entry.
     *   Data, routes and internal audit references are fully preserved.
     */
    public static function canView(): bool
    {
        return false;
    }
}
