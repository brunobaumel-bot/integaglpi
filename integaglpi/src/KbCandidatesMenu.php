<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi;

use CommonDBTM;

final class KbCandidatesMenu extends CommonDBTM
{
    public static $rightname = Plugin::RIGHT_NAME;

    public static function getTypeName($nb = 0): string
    {
        return __('Candidatos de KB por IA', 'glpiintegaglpi');
    }

    public static function getMenuName($nb = 0): string
    {
        return __('Candidatos de KB por IA', 'glpiintegaglpi');
    }

    /**
     * @return array<string, mixed>
     */
    public static function getMenuContent(): array
    {
        return [
            'title' => self::getMenuName(),
            'page' => Plugin::getKbCandidatesUrl(),
            'icon' => 'ti ti-brain',
        ];
    }

    public static function canView(): bool
    {
        return Plugin::canSupervisorRead();
    }
}
