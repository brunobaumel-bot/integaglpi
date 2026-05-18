<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi;

use CommonDBTM;

final class OperationLogMenu extends CommonDBTM
{
    public static $rightname = Plugin::RIGHT_NAME;

    public static function getTypeName($nb = 0): string
    {
        return __('Auditoria Operacional', 'glpiintegaglpi');
    }

    public static function getMenuName($nb = 0): string
    {
        return __('Auditoria Operacional', 'glpiintegaglpi');
    }

    /**
     * @return array<string, mixed>
     */
    public static function getMenuContent(): array
    {
        return [
            'title' => self::getMenuName(),
            'page'  => Plugin::getAuditUrl(),
            'icon'  => 'ti ti-shield-search',
        ];
    }

    public static function canView(): bool
    {
        return Plugin::canAuditRead();
    }
}
