<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi;

use CommonDBTM;

final class AttendanceCenterMenu extends CommonDBTM
{
    public static $rightname = Plugin::RIGHT_NAME;

    public static function getTypeName($nb = 0): string
    {
        return __('Central de Atendimento', 'glpiintegaglpi');
    }

    public static function getMenuName($nb = 0): string
    {
        return __('Central de Atendimento', 'glpiintegaglpi');
    }

    /**
     * @return array<string, mixed>
     */
    public static function getMenuContent(): array
    {
        return [
            'title' => self::getMenuName(),
            'page'  => Plugin::getWebBasePath() . '/front/central.php',
            'icon'  => 'ti ti-headset',
        ];
    }

    public static function canView(): bool
    {
        return Plugin::canRead();
    }
}
