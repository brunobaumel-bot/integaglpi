<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi;

use CommonDBTM;

/**
 * Parent menu group: WhatsApp / Central.
 *
 * Aggregates Queue (WhatsApp admin) and AttendanceCenterMenu as GLPI submenu
 * options so the sidebar shows one collapsible entry instead of two flat items.
 *
 * FIX2: integaglpi_ops_console_claim_ui_messaging_stabilization_001_FIX2.
 */
final class WhatsAppGroupMenu extends CommonDBTM
{
    public static $rightname = Plugin::RIGHT_NAME;

    public static function getTypeName($nb = 0): string
    {
        return __('WhatsApp / Central', 'glpiintegaglpi');
    }

    public static function getMenuName($nb = 0): string
    {
        return __('WhatsApp / Central', 'glpiintegaglpi');
    }

    /**
     * @return array<string, mixed>
     */
    public static function getMenuContent(): array
    {
        return [
            'title'   => self::getMenuName(),
            'page'    => Plugin::getWebBasePath() . '/front/central.php',
            'icon'    => 'ti ti-brand-whatsapp',
            'options' => [
                'queue'   => [
                    'title' => Queue::getMenuName(),
                    'page'  => Plugin::getQueueAdminUrl(),
                    'icon'  => 'ti ti-brand-whatsapp',
                ],
                'central' => [
                    'title' => AttendanceCenterMenu::getMenuName(),
                    'page'  => Plugin::getWebBasePath() . '/front/central.php',
                    'icon'  => 'ti ti-headset',
                ],
            ],
        ];
    }

    public static function canView(): bool
    {
        return Plugin::canRead() || Plugin::canUpdate();
    }
}
