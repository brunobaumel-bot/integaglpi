<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi;

use CommonDBTM;

final class AiOperationsMenu extends CommonDBTM
{
    public static $rightname = Plugin::RIGHT_NAME;

    public static function getTypeName($nb = 0): string
    {
        return __('IA & Conhecimento', 'glpiintegaglpi');
    }

    public static function getMenuName($nb = 0): string
    {
        return __('IA & Conhecimento', 'glpiintegaglpi');
    }

    /**
     * @return array<string, mixed>
     */
    public static function getMenuContent(): array
    {
        return [
            'title' => self::getMenuName(),
            'page' => Plugin::getAiOperationsUrl(),
            'icon' => 'ti ti-brain',
        ];
    }

    public static function canView(): bool
    {
        return Plugin::canAiOperationsRead();
    }
}
