<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi;

use CommonDBTM;

/**
 * Parent menu group: Gestão.
 *
 * Exposes management/admin entry points in the final sidebar hierarchy.
 */
final class GestaoGroupMenu extends CommonDBTM
{
    public static $rightname = Plugin::RIGHT_NAME;

    public static function getTypeName($nb = 0): string
    {
        return __('Gestão', 'glpiintegaglpi');
    }

    public static function getMenuName($nb = 0): string
    {
        return __('Gestão', 'glpiintegaglpi');
    }

    /**
     * @return array<string, mixed>
     */
    public static function getMenuContent(): array
    {
        return [
            'title'   => self::getMenuName(),
            'page'    => Plugin::getContractHoursUrl(),
            'icon'    => 'ti ti-briefcase',
            'options' => [
                'contratos_banco_horas'       => [
                    'title' => __('Contratos e Banco de Horas', 'glpiintegaglpi'),
                    'page'  => Plugin::getContractHoursUrl(),
                    'icon'  => 'ti ti-file-time',
                ],
                'entidades_memoria_contato'   => [
                    'title' => __('Entidades e Memória de Contato', 'glpiintegaglpi'),
                    'page'  => Plugin::getContactAgendaImportUrl(),
                    'icon'  => 'ti ti-address-book',
                ],
                'perfis_permissoes'           => [
                    'title' => __('Perfis e Permissões', 'glpiintegaglpi'),
                    'page'  => Plugin::getWebBasePath() . '/front/profile.form.php',
                    'icon'  => 'ti ti-user-shield',
                ],
                'auditoria'                   => [
                    'title' => __('Auditoria', 'glpiintegaglpi'),
                    'page'  => Plugin::getAuditUrl(),
                    'icon'  => 'ti ti-shield-search',
                ],
            ],
        ];
    }

    public static function canView(): bool
    {
        return Plugin::canContractRead()
            || Plugin::canServiceCatalogRead()
            || Plugin::canUpdate();
    }
}
