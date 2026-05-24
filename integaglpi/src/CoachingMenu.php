<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi;

use CommonDBTM;

final class CoachingMenu extends CommonDBTM
{
    public static $rightname = Plugin::RIGHT_NAME;

    public static function getTypeName($nb = 0): string
    {
        return __('Coaching e Onboarding IA', 'glpiintegaglpi');
    }

    public static function getMenuName($nb = 0): string
    {
        return __('Coaching e Onboarding IA', 'glpiintegaglpi');
    }

    /**
     * @return array<string, mixed>
     */
    public static function getMenuContent(): array
    {
        return [
            'title' => self::getMenuName(),
            'page' => Plugin::getCoachingUrl(),
            'icon' => 'ti ti-school',
        ];
    }

    public static function canView(): bool
    {
        return Plugin::canCoachingRead();
    }
}
