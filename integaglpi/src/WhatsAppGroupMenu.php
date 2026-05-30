<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi;

use CommonDBTM;

/**
 * Parent menu group: WhatsApp / Central.
 *
 * Exposes the operational WhatsApp entry points in the final sidebar order.
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

    public static function getIcon(): string
    {
        return 'ti ti-brand-whatsapp';
    }

    /**
     * @return array<string, mixed>
     */
    public static function getMenuContent(): array
    {
        if (!self::canView()) {
            return [];
        }

        return [
            'title'            => self::getMenuName(),
            'is_multi_entries' => true,
            'whatsapp'         => [
                'title' => __('WhatsApp', 'glpiintegaglpi'),
                'page'  => Plugin::getQueueAdminUrl(),
                'icon'  => 'ti ti-brand-whatsapp',
            ],
            'central_whatsapp' => [
                'title' => __('Central de Atendimento', 'glpiintegaglpi'),
                'page'  => Plugin::getWebBasePath() . '/front/central.php',
                'icon'  => 'ti ti-headset',
            ],
            'monitor_online_whatsapp' => [
                'title' => __('Monitor Online WhatsApp', 'glpiintegaglpi'),
                'page'  => Plugin::getOnlineMonitorUrl(),
                'icon'  => 'ti ti-activity',
            ],
            'hub_mensagens'    => [
                'title' => __('Hub de Mensagens', 'glpiintegaglpi'),
                'page'  => Plugin::getQueueAdminUrl() . '?tab=message_settings',
                'icon'  => 'ti ti-message-cog',
            ],
        ];
    }

    public static function canView(): bool
    {
        return Plugin::canRead() || Plugin::canUpdate();
    }
}
