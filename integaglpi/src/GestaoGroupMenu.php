<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi;

use CommonDBTM;
use GlpiPlugin\Integaglpi\Service\SecurityPermissionService;

/**
 * Parent menu group: Gestão.
 *
 * Exposes management/admin entry points in the final sidebar hierarchy.
 *
 * Phase: integaglpi_security_access_center_rbac_profiles_001_FIX2.
 * The Central de Segurança lives here as a child entry — it is the canonical
 * UI for the IntegraGLPI RBAC matrix. The legacy "Perfis e Permissões" entry
 * is kept only as a clearly-labelled bootstrap pointer to the GLPI-native
 * Read/Update right used as access gate.
 *
 * NOTE (integaglpi_plugin_logmein_menu_reorganization_001):
 *   Contratos e Horas / Catálogo de Serviços foram removidos deste menu pois
 *   Contratos e Catálogo/Categorias/Forms NATIVOS do GLPI são a fonte oficial.
 *   O plugin não deve manter CRUD paralelo operacional para essas entidades.
 *   As rotas /front/contracts.hours.php e /front/service.catalog.php permanecem
 *   acessíveis via URL direta para Admin, mas não aparecem no menu principal.
 *   Itens LogMeIn foram movidos para LogmeinGroupMenu (grupo dedicado).
 *   Importar Agenda e Central de Segurança permanecem aqui.
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

        $children = [];

        // NOTE: Contratos/Banco de Horas e Catálogo de Serviços foram removidos
        // do menu principal (integaglpi_plugin_logmein_menu_reorganization_001).
        // GLPI nativo é SSOT — as rotas /front/contracts.hours.php e
        // /front/service.catalog.php continuam acessíveis por URL para Admin.

        $children['importar_agenda'] = [
            'title' => __('Importar agenda', 'glpiintegaglpi'),
            'page'  => Plugin::getContactAgendaImportUrl(),
            'icon'  => 'ti ti-address-book',
        ];

        // FIX2: Central de Segurança como filho da Gestão — interface canônica
        // de gestão da matriz RBAC (Técnico/Supervisão/Direção). Visível só
        // para quem passa canViewSecurityCenter().
        if (SecurityPermissionService::canViewSecurityCenter()) {
            $children['central_seguranca'] = [
                'title' => __('Central de Segurança', 'glpiintegaglpi'),
                'page'  => Plugin::getWebBasePath() . '/front/security.center.php',
                'icon'  => 'ti ti-shield-lock',
            ];
        }

        // Entrada legacy mantida só como ponteiro para o bootstrap GLPI
        // (Ler/Atualizar). A matriz granular vive na Central de Segurança.
        $children['perfis_permissoes_bootstrap'] = [
            'title' => __('Perfis GLPI — bootstrap Ler/Atualizar', 'glpiintegaglpi'),
            'page'  => Plugin::getWebBasePath() . '/front/profile.form.php',
            'icon'  => 'ti ti-user-shield',
        ];

        return array_merge([
            'title'            => self::getMenuName(),
            'is_multi_entries' => true,
        ], $children);
    }

    public static function canView(): bool
    {
        return Plugin::canUpdate()
            || SecurityPermissionService::canViewSecurityCenter();
    }
}
