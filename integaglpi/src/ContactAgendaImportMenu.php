<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi;

use CommonDBTM;

final class ContactAgendaImportMenu extends CommonDBTM
{
    public static $rightname = Plugin::RIGHT_NAME;

    public static function getTypeName($nb = 0): string
    {
        return _n('Contact agenda import', 'Contact agenda imports', $nb, 'glpiintegaglpi');
    }

    public static function getMenuName($nb = 0): string
    {
        return __('Importar agenda', 'glpiintegaglpi');
    }

    /**
     * @return array<string, mixed>
     */
    public static function getMenuContent(): array
    {
        return [
            'title' => self::getMenuName(),
            'page'  => Plugin::getContactAgendaImportUrl(),
            'icon'  => 'ti ti-address-book',
        ];
    }

    public static function canCreate(): bool
    {
        return Plugin::canUpdate();
    }

    public static function canView(): bool
    {
        return Plugin::canUpdate();
    }
}
