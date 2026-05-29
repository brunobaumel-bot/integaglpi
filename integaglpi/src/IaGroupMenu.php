<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi;

use CommonDBTM;

/**
 * Parent menu group: IA & Conhecimento.
 *
 * Aggregates AiOperationsMenu, CoachingMenu, KnowledgeBaseMenu,
 * KbCandidatesMenu, and ExternalResearchMenu as GLPI submenu options so the
 * sidebar shows one collapsible entry instead of five flat items.
 *
 * FIX2: integaglpi_ops_console_claim_ui_messaging_stabilization_001_FIX2.
 */
final class IaGroupMenu extends CommonDBTM
{
    public static $rightname = Plugin::RIGHT_NAME;

    public static function getTypeName($nb = 0): string
    {
        return __('IA & Conhecimento', 'glpiintegaglpi');
    }

    public static function getMenuName($nb = 0): string
    {
        return __('IA & Conhecimento', 'glpiintegaglpi');
    }

    /**
     * @return array<string, mixed>
     */
    public static function getMenuContent(): array
    {
        return [
            'title'   => self::getMenuName(),
            'page'    => Plugin::getAiOperationsUrl(),
            'icon'    => 'ti ti-brain',
            'options' => [
                'ia_ops'       => [
                    'title' => AiOperationsMenu::getMenuName(),
                    'page'  => Plugin::getAiOperationsUrl(),
                    'icon'  => 'ti ti-brain',
                ],
                'coaching'     => [
                    'title' => CoachingMenu::getMenuName(),
                    'page'  => Plugin::getCoachingUrl(),
                    'icon'  => 'ti ti-school',
                ],
                'kb'           => [
                    'title' => KnowledgeBaseMenu::getMenuName(),
                    'page'  => Plugin::getNativeKnowledgeBaseUrl(),
                    'icon'  => 'ti ti-book',
                ],
                'kb_candidates' => [
                    'title' => KbCandidatesMenu::getMenuName(),
                    'page'  => Plugin::getKbCandidatesUrl(),
                    'icon'  => 'ti ti-brain',
                ],
                'research'     => [
                    'title' => ExternalResearchMenu::getMenuName(),
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
