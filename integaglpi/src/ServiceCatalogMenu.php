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

    public static function canView(): bool
    {
        return Plugin::canServiceCatalogRead();
    }
}
