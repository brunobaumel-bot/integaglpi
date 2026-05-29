<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi;

use CommonDBTM;

/**
 * Parent menu group: Gestão.
 *
 * Aggregates ContractsHoursMenu, ServiceCatalogMenu, and
 * ContactAgendaImportMenu as GLPI submenu options so the sidebar shows one
 * collapsible entry instead of three flat items.
 *
 * FIX2: integaglpi_ops_console_claim_ui_messaging_stabilization_001_FIX2.
 */
final class GestaoGroupMenu extends CommonDBTM
{
    public static $rightname = Plugin::RIGHT_NAME;

    public static function getTypeName($nb = 0): string
    {
        return __('Gestão', 'glpiintegaglpi');
    }

    public static function getMenuName($nb = 0): string
    {
        return __('Gestão', 'glpiintegaglpi');
    }

    /**
     * @return array<string, mixed>
     */
    public static function getMenuContent(): array
    {
        return [
            'title'   => self::getMenuName(),
            'page'    => Plugin::getContractHoursUrl(),
            'icon'    => 'ti ti-briefcase',
            'options' => [
                'contracts' => [
                    'title' => ContractsHoursMenu::getMenuName(),
                    'page'  => Plugin::getContractHoursUrl(),
                    'icon'  => 'ti ti-file-time',
                ],
                'catalog'   => [
                    'title' => ServiceCatalogMenu::getMenuName(),
                    'page'  => Plugin::getServiceCatalogUrl(),
                    'icon'  => 'ti ti-list-check',
                ],
                'contacts'  => [
                    'title' => ContactAgendaImportMenu::getMenuName(),
                    'page'  => Plugin::getContactAgendaImportUrl(),
                    'icon'  => 'ti ti-address-book',
                ],
            ],
        ];
    }

    public static function canView(): bool
    {
        return Plugin::canContractRead()
            || Plugin::canServiceCatalogRead()
            || Plugin::canUpdate();
    }
}
