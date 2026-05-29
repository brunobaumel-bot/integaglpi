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

    /**
     * @return array<string, mixed>
     */
    public static function getMenuContent(): array
    {
        $base = Plugin::getQueueAdminUrl();

        return [
            'title'   => self::getMenuName(),
            'page'    => $base . '?tab=message_settings',
            'icon'    => 'ti ti-settings',
            'options' => [
                'configuracoes_mensagens' => [
                    'title' => __('Configurações das Mensagens', 'glpiintegaglpi'),
                    'page'  => $base . '?tab=message_settings&section=mensagens',
                    'icon'  => 'ti ti-message-cog',
                ],
                'recepcao_inteligente'    => [
                    'title' => __('Recepção Inteligente', 'glpiintegaglpi'),
                    'page'  => $base . '?tab=message_settings&section=smart_reception',
                    'icon'  => 'ti ti-user-check',
                ],
                'avisos_inatividade'      => [
                    'title' => __('Avisos e Inatividade', 'glpiintegaglpi'),
                    'page'  => $base . '?tab=message_settings&section=avisos_inatividade',
                    'icon'  => 'ti ti-bell-ringing',
                ],
                'csat'                    => [
                    'title' => __('CSAT', 'glpiintegaglpi'),
                    'page'  => $base . '?tab=message_settings&section=mensagens',
                    'icon'  => 'ti ti-mood-check',
                ],
                'horario_comercial'       => [
                    'title' => __('Horário Comercial', 'glpiintegaglpi'),
                    'page'  => $base . '?tab=message_settings&section=horario_comercial',
                    'icon'  => 'ti ti-clock',
                ],
                'midia'                   => [
                    'title' => __('Mídia', 'glpiintegaglpi'),
                    'page'  => $base . '?tab=message_settings&section=mensagens',
                    'icon'  => 'ti ti-paperclip',
                ],
                'ticket_solucao'          => [
                    'title' => __('Ticket e Solução', 'glpiintegaglpi'),
                    'page'  => $base . '?tab=message_settings&section=mensagens',
                    'icon'  => 'ti ti-ticket',
                ],
                'templates_whatsapp'      => [
                    'title' => __('Templates WhatsApp', 'glpiintegaglpi'),
                    'page'  => $base . '?tab=templates',
                    'icon'  => 'ti ti-template',
                ],
                'configuracoes_gerais'    => [
                    'title' => __('Configurações Gerais do Plugin', 'glpiintegaglpi'),
                    'page'  => $base . '?tab=connection',
                    'icon'  => 'ti ti-adjustments',
                ],
            ],
        ];
    }

    public static function canView(): bool
    {
        return Plugin::canRead() || Plugin::canUpdate();
    }
}
