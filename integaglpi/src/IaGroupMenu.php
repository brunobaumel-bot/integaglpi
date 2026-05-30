<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi;

use CommonDBTM;

/**
 * Parent menu group: IA.
 */
final class IaGroupMenu extends CommonDBTM
{
    public static $rightname = Plugin::RIGHT_NAME;

    public static function getTypeName($nb = 0): string
    {
        return __('IA', 'glpiintegaglpi');
    }

    public static function getMenuName($nb = 0): string
    {
        return __('IA', 'glpiintegaglpi');
    }

    public static function getIcon(): string
    {
        return 'ti ti-brain';
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
                'console_ia'          => [
                    'title' => __('IA & Conhecimento', 'glpiintegaglpi'),
                    'page'  => Plugin::getAiOperationsUrl(),
                    'icon'  => 'ti ti-brain',
                ],
                'copiloto'            => [
                    'title' => __('Coaching e Onboarding IA', 'glpiintegaglpi'),
                    'page'  => Plugin::getCoachingUrl(),
                    'icon'  => 'ti ti-school',
                ],
                'base_conhecimento'   => [
                    'title' => __('Base de Conhecimento GLPI', 'glpiintegaglpi'),
                    'page'  => Plugin::getNativeKnowledgeBaseUrl(),
                    'icon'  => 'ti ti-book',
                ],
                'candidatos_kb'       => [
                    'title' => __('Candidatos de KB por IA', 'glpiintegaglpi'),
                    'page'  => Plugin::getKbCandidatesUrl(),
                    'icon'  => 'ti ti-brain',
                ],
                'pesquisa_externa'    => [
                    'title' => __('Pesquisa Externa Controlada', 'glpiintegaglpi'),
                    'page'  => Plugin::getExternalResearchUrl(),
                    'icon'  => 'ti ti-world-search',
                ],
                'mineracao_historica' => [
                    'title' => __('Mineração Histórica', 'glpiintegaglpi'),
                    'page'  => Plugin::getHistoricalMiningUrl(),
                    'icon'  => 'ti ti-pick',
                ],
                'configuracao_ia'     => [
                    'title' => __('Configuração IA', 'glpiintegaglpi'),
                    'page'  => Plugin::getAiConfigUrl(),
                    'icon'  => 'ti ti-settings',
                ],
        ];
    }

    public static function canView(): bool
    {
        return Plugin::canAiOperationsRead()
            || Plugin::canCoachingRead()
            || Plugin::canKnowledgeBaseRead()
            || Plugin::canSupervisorRead()
            || Plugin::canExternalResearchRead();
    }
}
