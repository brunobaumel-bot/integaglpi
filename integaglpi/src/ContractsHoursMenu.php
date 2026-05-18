<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi;

use CommonDBTM;

final class ContractsHoursMenu extends CommonDBTM
{
    public static $rightname = Plugin::RIGHT_NAME;

    public static function getTypeName($nb = 0): string
    {
        return __('Contratos e Horas', 'glpiintegaglpi');
    }

    public static function getMenuName($nb = 0): string
    {
        return __('Contratos e Horas', 'glpiintegaglpi');
    }

    /**
     * @return array<string, mixed>
     */
    public static function getMenuContent(): array
    {
        return [
            'title' => self::getMenuName(),
            'page' => Plugin::getContractHoursUrl(),
            'icon' => 'ti ti-file-time',
        ];
    }

    public static function canView(): bool
    {
        return Plugin::canContractRead();
    }
}
