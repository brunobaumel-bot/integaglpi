<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi;

use CommonDBTM;

/**
 * Parent menu group: Configuração.
 *
 * Keeps the existing configuration URLs and exposes the final operational
 * hierarchy directly in the GLPI sidebar.
 */
final class ConfiguracaoGroupMenu extends CommonDBTM
{
    public static $rightname = Plugin::RIGHT_NAME;

    public static function getTypeName($nb = 0): string
    {
        return __('Configuração', 'glpiintegaglpi');
    }

    public static function getMenuName($nb = 0): string
    {
        return __('Configuração', 'glpiintegaglpi');
    }

    public static function getIcon(): string
    {
        return 'ti ti-settings';
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
            'whatsapp' => [
                'title' => __('WhatsApp', 'glpiintegaglpi'),
                'page'  => Plugin::getQueueAdminUrl(),
                'icon'  => 'ti ti-brand-whatsapp',
            ],
            'hub_mensagens' => [
                'title' => __('Hub de Mensagens', 'glpiintegaglpi'),
                'page'  => Plugin::getQueueAdminUrl() . '?tab=message_settings',
                'icon'  => 'ti ti-message-cog',
            ],
            'filas_roteamento' => [
                'title' => __('Rotas, Filas e Parâmetros', 'glpiintegaglpi'),
                'page'  => Plugin::getRoutingOptionsAdminUrl(),
                'icon'  => 'ti ti-route',
            ],
            'roteamento_seguro' => [
                'title' => __('Roteamento Seguro', 'glpiintegaglpi'),
                'page'  => Plugin::getRoutingSafetyUrl(),
                'icon'  => 'ti ti-route',
            ],
        ];
    }

    public static function canView(): bool
    {
        return Plugin::canRead() || Plugin::canUpdate();
    }
}
