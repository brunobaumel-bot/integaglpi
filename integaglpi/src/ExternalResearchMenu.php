<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi;

use CommonDBTM;

final class ExternalResearchMenu extends CommonDBTM
{
    public static $rightname = Plugin::EXTERNAL_RESEARCH_RIGHT_NAME;

    public static function getTypeName($nb = 0): string
    {
        return __('Pesquisa Externa Controlada', 'glpiintegaglpi');
    }

    public static function getMenuName($nb = 0): string
    {
        return __('Pesquisa Externa Controlada', 'glpiintegaglpi');
    }

    /**
     * @return array<string, mixed>
     */
    public static function getMenuContent(): array
    {
        return [
            'title' => self::getMenuName(),
            'page' => Plugin::getExternalResearchUrl(),
            'icon' => 'ti ti-world-search',
        ];
    }

    public static function canView(): bool
    {
        return Plugin::canExternalResearchRead();
    }
}
