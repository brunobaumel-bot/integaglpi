<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi;

use CommonDBTM;

final class AttendanceCenterModelBMenu extends CommonDBTM
{
    public static $rightname = Plugin::RIGHT_NAME;

    public static function getTypeName($nb = 0): string
    {
        return __('Central B — Inbox', 'glpiintegaglpi');
    }

    public static function getMenuName($nb = 0): string
    {
        return __('Central B — Inbox', 'glpiintegaglpi');
    }

    /**
     * @return array<string, mixed>
     */
    public static function getMenuContent(): array
    {
        return [
            'title' => self::getMenuName(),
            'page'  => Plugin::getWebBasePath() . '/front/central_model_b.php',
            'icon'  => 'ti ti-message-2',
        ];
    }

    public static function canView(): bool
    {
        return Plugin::canRead();
    }
}
