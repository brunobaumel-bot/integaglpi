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
                'central_whatsapp'   => [
                    'title' => __('Central WhatsApp / Monitor Online', 'glpiintegaglpi'),
                    'page'  => Plugin::getWebBasePath() . '/front/central.php',
                    'icon'  => 'ti ti-headset',
                ],
                'conversas_whatsapp' => [
                    'title' => __('Conversas WhatsApp / aba do ticket', 'glpiintegaglpi'),
                    'page'  => Plugin::getWebBasePath() . '/front/central.php',
                    'icon'  => 'ti ti-messages',
                ],
                'hub_mensagens'      => [
                    'title' => __('Hub de Mensagens', 'glpiintegaglpi'),
                    'page'  => Plugin::getQueueAdminUrl() . '?tab=message_settings',
                    'icon'  => 'ti ti-message-cog',
                ],
            ],
        ];
    }

    public static function canView(): bool
    {
        return Plugin::canRead() || Plugin::canUpdate();
    }
}
