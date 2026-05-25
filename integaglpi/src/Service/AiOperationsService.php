<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi\Service;

use GlpiPlugin\Integaglpi\Plugin;

final class AiOperationsService
{
    /**
     * @return array<string, mixed>
     */
    public function getHubData(): array
    {
        return [
            'links' => [
                [
                    'title' => __('Configuração IA', 'glpiintegaglpi'),
                    'description' => __('Status read-only de provider, modelo, timeouts e flags sem expor segredos.', 'glpiintegaglpi'),
                    'url' => Plugin::getAiConfigUrl(),
                    'badge' => __('read-only', 'glpiintegaglpi'),
                ],
                [
                    'title' => __('Mineração Histórica', 'glpiintegaglpi'),
                    'description' => __('Upload JSONL sanitizado, dry-run obrigatório, execução P2 e geração P3.', 'glpiintegaglpi'),
                    'url' => Plugin::getHistoricalMiningUrl(),
                    'badge' => __('manual', 'glpiintegaglpi'),
                ],
                [
                    'title' => __('Candidatos de KB', 'glpiintegaglpi'),
                    'description' => __('Revisão humana de candidatos. Publicação na KB nativa continua manual.', 'glpiintegaglpi'),
                    'url' => Plugin::getKbCandidatesUrl(),
                    'badge' => __('revisão', 'glpiintegaglpi'),
                ],
                [
                    'title' => __('Pesquisa Externa Controlada', 'glpiintegaglpi'),
                    'description' => __('Pesquisa manual com fontes allowlisted, preview anonimizado e citações.', 'glpiintegaglpi'),
                    'url' => Plugin::getExternalResearchUrl(),
                    'badge' => __('LGPD', 'glpiintegaglpi'),
                ],
                [
                    'title' => __('Dashboard de Qualidade', 'glpiintegaglpi'),
                    'description' => __('Indicadores agregados de CX e qualidade operacional sem ação automática.', 'glpiintegaglpi'),
                    'url' => Plugin::getQualityDashboardUrl(),
                    'badge' => __('insights', 'glpiintegaglpi'),
                ],
                [
                    'title' => __('Coaching', 'glpiintegaglpi'),
                    'description' => __('Recomendações construtivas e anti-punitivas para melhoria contínua.', 'glpiintegaglpi'),
                    'url' => Plugin::getCoachingUrl(),
                    'badge' => __('anti-punitivo', 'glpiintegaglpi'),
                ],
                [
                    'title' => __('Auditoria IA', 'glpiintegaglpi'),
                    'description' => __('Eventos de auditoria e operação do plugin.', 'glpiintegaglpi'),
                    'url' => Plugin::getAuditUrl(),
                    'badge' => __('auditável', 'glpiintegaglpi'),
                ],
            ],
        ];
    }
}
