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

    public static function getIcon(): string
    {
        return 'ti ti-briefcase';
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
                'contratos_banco_horas'       => [
                    'title' => __('Contratos e Horas / Banco de Horas', 'glpiintegaglpi'),
                    'page'  => Plugin::getContractHoursUrl(),
                    'icon'  => 'ti ti-file-time',
                ],
                'catalogo_servicos'           => [
                    'title' => __('Catálogo de Serviços', 'glpiintegaglpi'),
                    'page'  => Plugin::getServiceCatalogUrl(),
                    'icon'  => 'ti ti-list-check',
                ],
                'importar_agenda'             => [
                    'title' => __('Importar agenda', 'glpiintegaglpi'),
                    'page'  => Plugin::getContactAgendaImportUrl(),
                    'icon'  => 'ti ti-address-book',
                ],
                'perfis_permissoes'           => [
                    'title' => __('Perfis e Permissões', 'glpiintegaglpi'),
                    'page'  => Plugin::getWebBasePath() . '/front/profile.form.php',
                    'icon'  => 'ti ti-user-shield',
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
