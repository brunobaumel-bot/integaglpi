<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi;

use CommonDBTM;

final class AttendanceCenterModelAMenu extends CommonDBTM
{
    public static $rightname = Plugin::RIGHT_NAME;

    public static function getTypeName($nb = 0): string
    {
        return __('Central A — Workspace', 'glpiintegaglpi');
    }

    public static function getMenuName($nb = 0): string
    {
        return __('Central A — Workspace', 'glpiintegaglpi');
    }

    /**
     * @return array<string, mixed>
     */
    public static function getMenuContent(): array
    {
        return [
            'title' => self::getMenuName(),
            'page'  => Plugin::getWebBasePath() . '/front/central_model_a.php',
            'icon'  => 'ti ti-layout-columns',
        ];
    }

    public static function canView(): bool
    {
        return Plugin::canRead();
    }
}
