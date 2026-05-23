<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi;

use CommonDBTM;

final class KnowledgeBaseMenu extends CommonDBTM
{
    public static $rightname = Plugin::RIGHT_NAME;

    public static function getTypeName($nb = 0): string
    {
        return __('Base de Conhecimento GLPI', 'glpiintegaglpi');
    }

    public static function getMenuName($nb = 0): string
    {
        return __('Base de Conhecimento GLPI', 'glpiintegaglpi');
    }

    /**
     * @return array<string, mixed>
     */
    public static function getMenuContent(): array
    {
        return [
            'title' => self::getMenuName(),
            'page' => Plugin::getNativeKnowledgeBaseUrl(),
            'icon' => 'ti ti-book',
        ];
    }

    public static function canView(): bool
    {
        return Plugin::canKnowledgeBaseRead();
    }
}
