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

    /**
     * @return array<string, mixed>
     */
    public static function getMenuContent(): array
    {
        return [
            'title'   => self::getMenuName(),
            'page'    => Plugin::getAiConfigUrl(),
            'icon'    => 'ti ti-brain',
            'options' => [
                'console_ia'          => [
                    'title' => __('Console IA / status, configuração, diagnóstico', 'glpiintegaglpi'),
                    'page'  => Plugin::getAiConfigUrl(),
                    'icon'  => 'ti ti-brain',
                ],
                'copiloto'            => [
                    'title' => __('Copiloto / dentro do chamado', 'glpiintegaglpi'),
                    'page'  => Plugin::getCoachingUrl(),
                    'icon'  => 'ti ti-school',
                ],
                'mineracao_historica' => [
                    'title' => __('Mineração Histórica', 'glpiintegaglpi'),
                    'page'  => Plugin::getHistoricalMiningUrl(),
                    'icon'  => 'ti ti-pick',
                ],
                'candidatos_kb'       => [
                    'title' => __('Candidatos KB', 'glpiintegaglpi'),
                    'page'  => Plugin::getKbCandidatesUrl(),
                    'icon'  => 'ti ti-brain',
                ],
                'pesquisa_externa'    => [
                    'title' => __('Pesquisa Externa', 'glpiintegaglpi'),
                    'page'  => Plugin::getExternalResearchUrl(),
                    'icon'  => 'ti ti-world-search',
                ],
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
