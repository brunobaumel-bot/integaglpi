<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi;

use CommonDBTM;

final class Queue extends CommonDBTM
{
    public static $rightname = Plugin::RIGHT_NAME;

    public static function getTypeName($nb = 0): string
    {
        return _n('WhatsApp queue', 'WhatsApp queues', $nb, 'glpiintegaglpi');
    }

    public static function getMenuName($nb = 0): string
    {
        return __('WhatsApp', 'glpiintegaglpi');
    }

    /**
     * @return array<string, mixed>
     */
    public static function getMenuContent(): array
    {
        return [
            'title' => self::getMenuName(),
            'page'  => Plugin::getQueueAdminUrl(),
            'icon'  => 'ti ti-brand-whatsapp',
        ];
    }

    public static function canCreate(): bool
    {
        return Plugin::canUpdate();
    }

    public static function canView(): bool
    {
        return Plugin::canUpdate();
    }
}

