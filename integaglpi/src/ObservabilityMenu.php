<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi;

use CommonDBTM;

final class ObservabilityMenu extends CommonDBTM
{
    public static $rightname = Plugin::RIGHT_NAME;

    public static function getTypeName($nb = 0): string
    {
        return __('Observabilidade WhatsApp', 'glpiintegaglpi');
    }

    public static function getMenuName($nb = 0): string
    {
        return __('Observabilidade WhatsApp', 'glpiintegaglpi');
    }

    /**
     * @return array<string, mixed>
     */
    public static function getMenuContent(): array
    {
        return [
            'title' => self::getMenuName(),
            'page' => Plugin::getObservabilityUrl(),
            'icon' => 'ti ti-heartbeat',
        ];
    }

    public static function canView(): bool
    {
        return Plugin::canObservabilityRead();
    }
}
