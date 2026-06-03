<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi\Service;

use DateInterval;
use DateTimeImmutable;
use DateTimeZone;
use GlpiPlugin\Integaglpi\Plugin;
use Throwable;

/**
 * Read-only aggregator for the Supervisor Command Center MVP.
 *
 * It delegates to existing services and never mutates tickets, messages,
 * integrations or external systems. Each source is isolated so one degraded
 * module does not break the dashboard.
 */
final class SupervisorCommandCenterService
{
    private const ACTION_QUEUE_LIMIT = 12;
    private const ONLINE_LIMIT = 20;

    public function __construct(private readonly PluginConfigService $pluginConfigService)
    {
    }

    /**
     * @param array<string, mixed> $query
     * @return array<string, mixed>
     */
    public function getDashboardData(array $query): array
    {
        $filters = $this->normalizeFilters($query);
        $sourceErrors = [];

        $supervisor = $this->loadSource('supervisor_backoffice', function () use ($filters): array {
            return (new SupervisorBackofficeService($this->pluginConfigService))->getDashboardData([
                'date_from' => $filters['date_from'],
                'date_to' => $filters['date_to'],
                'entity_id' => $filters['entity_id'],
                'queue_id' => $filters['queue_id'],
                'status' => $filters['status'],
                'agent_id' => $filters['technician_id'],
                'limit' => self::ACTION_QUEUE_LIMIT,
                'page' => 1,
            ]);
        }, $sourceErrors);

        $quality = $this->loadSource('quality_dashboard', function () use ($filters): array {
            return (new QualityDashboardService($this->pluginConfigService))->getDashboardData([
                'date_from' => $filters['date_from'],
                'date_to' => $filters['date_to'],
                'entity_id' => $filters['entity_id'],
                'queue_id' => $filters['queue_id'],
                'technician_id' => $filters['technician_id'],
                'status' => $filters['status'],
                'limit' => 10,
                'page' => 1,
            ]);
        }, $sourceErrors);

        $online = $this->loadSource('online_monitor', function () use ($filters): array {
            return (new OnlineMonitorService($this->pluginConfigService))->getPageData([
                'view' => 'all',
                'entity_id' => $filters['entity_id'],
                'queue_id' => $filters['queue_id'],
                'technician_id' => $filters['technician_id'],
                'conversation_status' => $filters['status'],
                'limit' => self::ONLINE_LIMIT,
                'page' => 1,
            ], Plugin::getCurrentUserId(), true);
        }, $sourceErrors);

        $aiAlerts = $this->loadSource('ai_online_alerts', function () use ($filters): array {
            if ($filters['risk'] !== '' && $filters['risk'] !== 'ai') {
                return ['visible' => true, 'rows' => [], 'high_open_count' => 0, 'open_count' => 0, 'error' => ''];
            }

            return (new AiOnlineAlertService($this->pluginConfigService))->getSupervisorSummary([
                'date_from' => $filters['date_from'],
                'date_to' => $filters['date_to'],
                'entity_id' => $filters['entity_id'],
                'queue_id' => $filters['queue_id'],
                'technician_id' => $filters['technician_id'],
                'ai_alert_status' => 'open',
                'ai_alert_limit' => self::ACTION_QUEUE_LIMIT,
            ], true);
        }, $sourceErrors);

        $technical = $this->loadSource('technical_health', function (): array {
            if (!class_exists(TechnicalHealthDashboardService::class)) {
                return ['available' => false, 'error' => __('Saúde Técnica ainda não está disponível.', 'glpiintegaglpi')];
            }

            return (new TechnicalHealthDashboardService())->getSnapshot();
        }, $sourceErrors);

        $kpis = $this->buildKpis($supervisor, $quality, $online, $technical, $aiAlerts);
        $actionQueue = $this->buildActionQueue($supervisor, $aiAlerts);
        $teamManagement = $this->buildTeamManagement($supervisor, $actionQueue);
        $clientEntityRisk = $this->buildClientEntityRisk($actionQueue);
        $qualityAi = $this->buildQualityAi($supervisor, $online, $quality, $actionQueue, $aiAlerts);

        return [
            'generated_at' => gmdate('c'),
            'filters' => $filters,
            'kpis' => $kpis,
            'action_queue' => $actionQueue,
            'team_management' => $teamManagement,
            'client_entity_risk' => $clientEntityRisk,
            'quality_ai' => $qualityAi,
            'technical_footer' => $this->buildTechnicalFooter($technical),
            'drilldowns' => $this->buildDrilldowns(),
            'source_errors' => $sourceErrors,
            'entity_scope_label' => (string) ($supervisor['entity_scope_label'] ?? $quality['entity_scope_label'] ?? ''),
            'cache_strategy' => __('MVP com consultas limitadas e tolerância a falha parcial; cache dedicado fica como melhoria futura.', 'glpiintegaglpi'),
            'read_only' => true,
            'no_mutation' => true,
            'no_comparative_technician_metrics' => true,
        ];
    }

    /**
     * @param array<string, mixed> $query
     * @return array<string, mixed>
     */
    private function normalizeFilters(array $query): array
    {
        $timezone = new DateTimeZone(date_default_timezone_get() ?: 'America/Sao_Paulo');
        $today = new DateTimeImmutable('today', $timezone);
        $period = (int) ($query['period'] ?? 7);
        if (!in_array($period, [1, 7, 15, 30, 90], true)) {
            $period = 7;
        }

        $dateFrom = $today->sub(new DateInterval('P' . max(0, $period - 1) . 'D'));
        $status = $this->allowToken((string) ($query['status'] ?? ''), ['', 'open', 'closed', 'awaiting_queue_selection', 'awaiting_entity_selection']);
        $risk = $this->allowToken((string) ($query['risk'] ?? ''), ['', 'sla', 'inactivity', 'csat', 'ai', 'queue', 'integration']);

        return [
            'period' => $period,
            'date_from' => $dateFrom->format('Y-m-d'),
            'date_to' => $today->format('Y-m-d'),
            'entity_id' => max(0, (int) ($query['entity_id'] ?? 0)),
            'queue_id' => max(0, (int) ($query['queue_id'] ?? 0)),
            'technician_id' => max(0, (int) ($query['technician_id'] ?? 0)),
            'status' => $status,
            'risk' => $risk,
        ];
    }

    /**
     * @param callable(): array<string, mixed> $loader
     * @param array<int, array<string, string>> $sourceErrors
     * @return array<string, mixed>
     */
    private function loadSource(string $source, callable $loader, array &$sourceErrors): array
    {
        try {
            $data = $loader();
            if (trim((string) ($data['error'] ?? '')) !== '') {
                $sourceErrors[] = [
                    'source' => $source,
                    'message' => $this->safeMessage((string) $data['error']),
                ];
            }

            return $data;
        } catch (Throwable $exception) {
            error_log('[integaglpi][supervisor_command_center][' . $source . '] ' . $this->safeMessage($exception->getMessage()));
            $sourceErrors[] = [
                'source' => $source,
                'message' => __('Fonte temporariamente indisponível.', 'glpiintegaglpi'),
            ];

            return [
                'available' => false,
                'error' => __('Fonte temporariamente indisponível.', 'glpiintegaglpi'),
            ];
        }
    }

    /**
     * @param array<string, mixed> $supervisor
     * @param array<string, mixed> $quality
     * @param array<string, mixed> $online
     * @param array<string, mixed> $technical
     * @param array<string, mixed> $aiAlerts
     * @return list<array<string, mixed>>
     */
    private function buildKpis(array $supervisor, array $quality, array $online, array $technical, array $aiAlerts): array
    {
        $supervisorKpis = is_array($supervisor['kpis'] ?? null) ? $supervisor['kpis'] : [];
        $qualityKpis = is_array($quality['kpis'] ?? null) ? $quality['kpis'] : [];
        $actionRows = is_array($supervisor['review_rows'] ?? null) ? $supervisor['review_rows'] : [];

        $slaRisk = $this->firstInt($qualityKpis, ['sla_risk', 'sla_at_risk', 'risk_sla', 'violated_sla']);
        $highAiAlerts = $this->intValue($aiAlerts['high_open_count'] ?? 0);
        $openAiAlerts = $this->intValue($aiAlerts['open_count'] ?? 0);
        $unassigned = $this->countRowsMatching($actionRows, static function (array $row): bool {
            return (int) ($row['assigned_user_id'] ?? 0) <= 0;
        });
        $newUnclaimed = $this->countRowsMatching($actionRows, static function (array $row): bool {
            return (int) ($row['assigned_user_id'] ?? 0) <= 0
                && in_array((string) ($row['conversation_status'] ?? ''), ['open', 'awaiting_entity_selection', 'awaiting_queue_selection'], true);
        });
        $reopened = $this->firstInt($supervisorKpis, ['reopened_tickets', 'reopen_tickets', 'reopened']);

        return [
            $this->kpi('open_tickets', __('Chamados abertos', 'glpiintegaglpi'), $this->intValue($supervisorKpis['open_tickets'] ?? 0), 'primary', Plugin::getSupervisorBackofficeUrl(), __('Total dentro do escopo e período filtrado.', 'glpiintegaglpi')),
            $this->kpi('new_unclaimed', __('Novos sem assumir', 'glpiintegaglpi'), $newUnclaimed, $newUnclaimed > 0 ? 'warning' : 'success', Plugin::getSupervisorBackofficeUrl() . '?status=open', __('Atendimentos ativos sem responsável na amostra operacional.', 'glpiintegaglpi')),
            $this->kpi('unassigned', __('Sem responsável', 'glpiintegaglpi'), $unassigned, $unassigned > 0 ? 'warning' : 'success', Plugin::getOnlineMonitorUrl() . '?view=all', __('Conversas que precisam de dono operacional.', 'glpiintegaglpi')),
            $this->kpi('sla_risk', __('SLA em risco', 'glpiintegaglpi'), $slaRisk, $slaRisk > 0 ? 'danger' : 'success', Plugin::getQualityDashboardUrl() . '?sla=risk', __('0 indica nenhum SLA em risco conhecido ou fonte sem dado.', 'glpiintegaglpi')),
            $this->kpi('critical_inactivity', __('Inatividade crítica', 'glpiintegaglpi'), $this->intValue($supervisorKpis['inactivity_attention_tickets'] ?? 0), 'warning', Plugin::getSupervisorBackofficeUrl() . '?quality=inactivity_failed', __('Atendimentos parados que exigem ação humana.', 'glpiintegaglpi')),
            $this->kpi('reopened', __('Reabertos', 'glpiintegaglpi'), $reopened, $reopened > 0 ? 'warning' : 'success', Plugin::getQualityDashboardUrl(), __('Reincidência operacional quando disponível na fonte.', 'glpiintegaglpi')),
            $this->kpi('csat', __('CSAT insatisfeito', 'glpiintegaglpi'), $this->intValue($supervisorKpis['dissatisfied_tickets'] ?? 0), 'danger', Plugin::getQualityDashboardUrl() . '?csat=dissatisfied', __('Tickets com experiência negativa sinalizada.', 'glpiintegaglpi')),
            $this->kpi('ai_alerts', __('Alertas IA críticos', 'glpiintegaglpi'), $highAiAlerts, $highAiAlerts > 0 ? 'danger' : 'success', Plugin::getOnlineMonitorUrl() . '?tab=ai_alerts', sprintf(__('Alertas abertos: %d. Priorize possíveis frustrações e pedidos de supervisor.', 'glpiintegaglpi'), $openAiAlerts)),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function kpi(string $key, string $label, int $value, string $tone, string $url, string $hint): array
    {
        return [
            'key' => $key,
            'label' => $label,
            'value' => $value,
            'tone' => $tone,
            'url' => $url,
            'hint' => $hint,
        ];
    }

    /**
     * @param array<string, mixed> $supervisor
     * @param array<string, mixed> $aiAlerts
     * @return list<array<string, mixed>>
     */
    private function buildActionQueue(array $supervisor, array $aiAlerts): array
    {
        $rows = is_array($supervisor['review_rows'] ?? null) ? $supervisor['review_rows'] : [];
        $supervisorQueue = [];

        foreach (array_slice($rows, 0, self::ACTION_QUEUE_LIMIT) as $row) {
            if (!is_array($row)) {
                continue;
            }

            $ticketId = $this->intValue($row['glpi_ticket_id'] ?? 0);
            $reasons = is_array($row['review_reasons'] ?? null) ? $row['review_reasons'] : [];
            $reasonText = implode('; ', array_map('strval', $reasons));
            $supervisorQueue[] = [
                'ticket_id' => $ticketId,
                'ticket_url' => $ticketId > 0 ? Plugin::getTicketUrl($ticketId) : '',
                'context_url' => $ticketId > 0 ? Plugin::getTicketUrl($ticketId) . '&forcetab=PluginIntegaglpiTicketRuntime$2' : '',
                'entity' => $this->truncate((string) ($row['glpi_entity_name'] ?? $row['memory_entity_name'] ?? '-'), 80),
                'queue' => $this->truncate((string) ($row['queue_name'] ?? '-'), 60),
                'technician' => $this->truncate((string) ($row['assigned_user_name'] ?? __('Sem técnico', 'glpiintegaglpi')), 60),
                'status' => $this->truncate((string) ($row['conversation_status'] ?? $row['runtime_status'] ?? '-'), 40),
                'sla_remaining' => $this->truncate((string) ($row['sla_remaining'] ?? $row['sla_status'] ?? '-'), 40),
                'age_label' => $this->buildAgeLabel($row),
                'last_interaction' => $this->truncate((string) ($row['last_message_at'] ?? $row['conversation_updated_at'] ?? $row['updated_at'] ?? '-'), 60),
                'priority' => $this->priorityFromReasons($reasonText),
                'reason' => $this->truncate($reasonText, 140),
                'suggested_action' => $this->suggestAction($reasons),
                'phone_masked' => $this->truncate((string) ($row['phone_masked'] ?? ''), 32),
            ];
        }

        $highAiQueue = [];
        $mediumAiQueue = [];
        $alertRows = is_array($aiAlerts['rows'] ?? null) ? $aiAlerts['rows'] : [];
        foreach ($alertRows as $alert) {
            if (!is_array($alert)) {
                continue;
            }
            $item = $this->buildAiAlertAction($alert);
            if ((string) ($alert['severity'] ?? '') === 'high') {
                $highAiQueue[] = $item;
            } else {
                $mediumAiQueue[] = $item;
            }
        }

        return array_slice(array_merge($highAiQueue, $supervisorQueue, $mediumAiQueue), 0, self::ACTION_QUEUE_LIMIT);
    }

    /**
     * @param array<string, mixed> $alert
     * @return array<string, mixed>
     */
    private function buildAiAlertAction(array $alert): array
    {
        $ticketId = $this->intValue($alert['glpi_ticket_id'] ?? 0);
        $severity = (string) ($alert['severity'] ?? 'medium');
        $alertType = (string) ($alert['alert_type'] ?? '');
        $monitorUrl = Plugin::getOnlineMonitorUrl() . '?tab=ai_alerts&ai_alert_status=open';
        if ($alertType !== '') {
            $monitorUrl .= '&ai_alert_type=' . rawurlencode($alertType);
        }

        return [
            'source' => 'ai_online_alert',
            'ticket_id' => $ticketId,
            'ticket_url' => $ticketId > 0 ? Plugin::getTicketUrl($ticketId) : '',
            'context_url' => $ticketId > 0 ? Plugin::getTicketUrl($ticketId) . '&forcetab=PluginIntegaglpiTicketRuntime$2' : '',
            'monitor_url' => $monitorUrl,
            'monitor_label' => __('Monitor Online / Detalhes', 'glpiintegaglpi'),
            'entity' => ((int) ($alert['entity_id'] ?? 0) > 0) ? sprintf(__('Entidade #%d', 'glpiintegaglpi'), (int) $alert['entity_id']) : '-',
            'queue' => ((int) ($alert['queue_id'] ?? 0) > 0) ? sprintf(__('Fila #%d', 'glpiintegaglpi'), (int) $alert['queue_id']) : '-',
            'technician' => ((int) ($alert['technician_id'] ?? 0) > 0) ? sprintf(__('Técnico #%d', 'glpiintegaglpi'), (int) $alert['technician_id']) : __('Sem técnico', 'glpiintegaglpi'),
            'status' => $this->truncate((string) ($alert['status'] ?? 'open'), 40),
            'sla_remaining' => $this->truncate($severity, 40),
            'age_label' => __('Alerta IA aberto', 'glpiintegaglpi'),
            'last_interaction' => $this->truncate((string) ($alert['created_at'] ?? $alert['updated_at'] ?? '-'), 60),
            'priority' => $severity === 'high' ? 'critical' : 'warning',
            'reason' => $this->truncate('IA: ' . $this->aiAlertLabel($alertType), 140),
            'evidence' => $this->truncate((string) ($alert['evidence_summary_sanitized'] ?? ''), 180),
            'suggested_action' => $this->truncate((string) ($alert['recommended_human_action'] ?? __('Revisar alerta IA e orientar ação humana.', 'glpiintegaglpi')), 180),
            'phone_masked' => '',
        ];
    }

    /**
     * @param array<string, mixed> $technical
     * @return list<array<string, string>>
     */
    private function buildTechnicalFooter(array $technical): array
    {
        $node = is_array($technical['node'] ?? null) ? $technical['node'] : [];
        $ai = is_array($technical['ai'] ?? null) ? $technical['ai'] : [];

        return [
            $this->integration('technical_health', 'Saúde Técnica', $this->isTechnicalDegraded($technical) ? 'degraded' : 'ok', Plugin::getTechnicalHealthUrl()),
            $this->integration('whatsapp_meta', 'WhatsApp / Meta', $this->statusFromNodePart($node['meta'] ?? null), Plugin::getTechnicalHealthUrl()),
            $this->integration('integration_service', 'Node integration-service', ($node['ok'] ?? false) ? 'ok' : 'degraded', Plugin::getTechnicalHealthUrl()),
            $this->integration('ai', 'IA / Copiloto', !empty($ai['available']) ? 'ok' : 'degraded', Plugin::getAiConfigUrl()),
            $this->integration('logmein_readonly', 'LogMeIn read-only', 'ok', Plugin::getLogmeinReportsUrl()),
            [
                'key' => 'logmein_reconciliation',
                'label' => 'LogMeIn Reconciliation',
                'status' => 'off',
                'detail' => __('OFF: provider GoTo/LogMeIn ainda bloqueado por HTTP 500. Sem botão de sync neste dashboard.', 'glpiintegaglpi'),
                'url' => Plugin::getLogmeinReconciliationUrl(),
            ],
        ];
    }

    /**
     * @param array<string, mixed> $supervisor
     * @param list<array<string, mixed>> $actionQueue
     * @return array<string, mixed>
     */
    private function buildTeamManagement(array $supervisor, array $actionQueue): array
    {
        $queues = is_array($supervisor['queues'] ?? null) ? $supervisor['queues'] : [];

        return [
            'queue_load' => $this->aggregateBy($actionQueue, 'queue', 'queue'),
            'assignee_load' => $this->aggregateBy($actionQueue, 'technician', 'technician'),
            'risk_by_assignee' => $this->aggregateRiskBy($actionQueue, 'technician'),
            'unassigned_tickets' => $this->countRowsMatching($actionQueue, static function (array $row): bool {
                return trim((string) ($row['technician'] ?? '')) === __('Sem técnico', 'glpiintegaglpi');
            }),
            'aging_by_queue' => $this->buildAgingByQueue($queues, $actionQueue),
            'note' => __('Distribuição operacional de carga, sem comparação punitiva entre técnicos.', 'glpiintegaglpi'),
        ];
    }

    /**
     * @param list<array<string, mixed>> $actionQueue
     * @return array<string, mixed>
     */
    private function buildClientEntityRisk(array $actionQueue): array
    {
        return [
            'entities_with_open_tickets' => $this->aggregateBy($actionQueue, 'entity', 'entity'),
            'entities_with_sla_risk' => $this->aggregateRiskBy($actionQueue, 'entity', 'sla'),
            'entities_with_csat_risk' => $this->aggregateRiskBy($actionQueue, 'entity', 'csat'),
            'contracts_attention' => [
                'count' => 0,
                'url' => Plugin::getContractHoursUrl(),
                'label' => __('Ver contratos e banco de horas', 'glpiintegaglpi'),
            ],
        ];
    }

    /**
     * @param array<string, mixed> $supervisor
     * @param array<string, mixed> $online
     * @param array<string, mixed> $quality
     * @param list<array<string, mixed>> $actionQueue
     * @param array<string, mixed> $aiAlerts
     * @return array<string, mixed>
     */
    private function buildQualityAi(array $supervisor, array $online, array $quality, array $actionQueue, array $aiAlerts): array
    {
        $supervisorKpis = is_array($supervisor['kpis'] ?? null) ? $supervisor['kpis'] : [];
        $qualityKpis = is_array($quality['kpis'] ?? null) ? $quality['kpis'] : [];

        return [
            'critical_ai_alerts' => $this->intValue($aiAlerts['high_open_count'] ?? 0),
            'open_ai_alerts' => $this->intValue($aiAlerts['open_count'] ?? 0),
            'bad_csat' => $this->intValue($supervisorKpis['dissatisfied_tickets'] ?? 0),
            'reopened' => $this->firstInt($supervisorKpis, ['reopened_tickets', 'reopen_tickets', 'reopened']),
            'frustration_risk' => $this->countRowsMatching($actionQueue, static function (array $row): bool {
                $reason = strtolower((string) ($row['reason'] ?? ''));
                return str_contains($reason, 'csat') || str_contains($reason, 'frustra');
            }),
            'supervisor_review_candidates' => $this->intValue($supervisorKpis['supervisor_review_tickets'] ?? 0),
            'sla_risk' => $this->firstInt($qualityKpis, ['sla_risk', 'sla_at_risk', 'risk_sla', 'violated_sla']),
            'quality_url' => Plugin::getQualityDashboardUrl(),
            'ai_alerts_url' => Plugin::getOnlineMonitorUrl() . '?tab=ai_alerts',
        ];
    }

    /**
     * @return array<string, string>
     */
    private function integration(string $key, string $label, string $status, string $url): array
    {
        return [
            'key' => $key,
            'label' => $label,
            'status' => $status,
            'detail' => $status === 'ok' ? __('Operacional', 'glpiintegaglpi') : __('Verificar detalhes técnicos', 'glpiintegaglpi'),
            'url' => $url,
        ];
    }

    /**
     * @return list<array<string, string>>
     */
    private function buildDrilldowns(): array
    {
        return [
            ['label' => __('Backoffice Supervisor', 'glpiintegaglpi'), 'url' => Plugin::getSupervisorBackofficeUrl(), 'hint' => __('Revisões e tickets em acompanhamento', 'glpiintegaglpi')],
            ['label' => __('Dashboard de Qualidade', 'glpiintegaglpi'), 'url' => Plugin::getQualityDashboardUrl(), 'hint' => __('CSAT, SLA, delivery e qualidade', 'glpiintegaglpi')],
            ['label' => __('SLA / Qualidade', 'glpiintegaglpi'), 'url' => Plugin::getQualityDashboardUrl() . '?sla=risk', 'hint' => __('Drill-down para atendimentos com SLA em risco', 'glpiintegaglpi')],
            ['label' => __('Inatividade / Autoclose', 'glpiintegaglpi'), 'url' => Plugin::getQualityDashboardUrl() . '?inactivity=autoclose_done', 'hint' => __('Drill-down para encerramentos e timers de inatividade', 'glpiintegaglpi')],
            ['label' => __('Monitor Online', 'glpiintegaglpi'), 'url' => Plugin::getOnlineMonitorUrl() . '?view=all', 'hint' => __('Conversas e filas atuais', 'glpiintegaglpi')],
            ['label' => __('Alertas IA', 'glpiintegaglpi'), 'url' => Plugin::getOnlineMonitorUrl() . '?tab=ai_alerts', 'hint' => __('Alertas pendentes de revisão humana', 'glpiintegaglpi')],
            ['label' => __('Relatórios Operacionais', 'glpiintegaglpi'), 'url' => Plugin::getSupervisorBackofficeUrl() . '?view=reports', 'hint' => __('Relatórios existentes sem nova extração', 'glpiintegaglpi')],
            ['label' => __('Contratos e Banco de Horas', 'glpiintegaglpi'), 'url' => Plugin::getContractHoursUrl(), 'hint' => __('Consumo e contratos já cadastrados', 'glpiintegaglpi')],
            ['label' => __('LogMeIn read-only', 'glpiintegaglpi'), 'url' => Plugin::getLogmeinReportsUrl(), 'hint' => __('Relatórios locais e mapeamentos seguros', 'glpiintegaglpi')],
            ['label' => __('Saúde Técnica', 'glpiintegaglpi'), 'url' => Plugin::getTechnicalHealthUrl(), 'hint' => __('Diagnóstico técnico consolidado', 'glpiintegaglpi')],
        ];
    }

    /**
     * @param array<int, string> $reasons
     */
    private function suggestAction(array $reasons): string
    {
        $text = strtolower(implode(' ', array_map('strval', $reasons)));
        if (str_contains($text, 'csat')) {
            return __('Revisar experiência do cliente e orientar follow-up humano.', 'glpiintegaglpi');
        }
        if (str_contains($text, 'inatividade')) {
            return __('Verificar fila e destravar atendimento parado.', 'glpiintegaglpi');
        }
        if (str_contains($text, 'sla')) {
            return __('Checar SLA antes de vencer e redistribuir se necessário.', 'glpiintegaglpi');
        }
        if (str_contains($text, 'ia') || str_contains($text, 'frustra')) {
            return __('Revisar conversa por risco de frustração.', 'glpiintegaglpi');
        }
        if (str_contains($text, 'erro')) {
            return __('Abrir diagnóstico operacional antes de nova ação.', 'glpiintegaglpi');
        }

        return __('Avaliar contexto e priorizar ação humana.', 'glpiintegaglpi');
    }

    private function aiAlertLabel(string $alertType): string
    {
        return [
            'possible_frustration' => __('possível frustração', 'glpiintegaglpi'),
            'supervisor_requested' => __('supervisor solicitado', 'glpiintegaglpi'),
            'long_inactivity_risk' => __('risco de inatividade', 'glpiintegaglpi'),
            'high_risk_reopen' => __('risco de reabertura', 'glpiintegaglpi'),
            'no_responsible_technician' => __('sem técnico responsável', 'glpiintegaglpi'),
            'queue_accumulation' => __('acúmulo de fila', 'glpiintegaglpi'),
            'long_waiting_client' => __('cliente aguardando há muito tempo', 'glpiintegaglpi'),
        ][$alertType] ?? ($alertType !== '' ? $alertType : __('alerta operacional', 'glpiintegaglpi'));
    }

    /**
     * @param array<string, mixed> $supervisor
     */
    private function countQueuePressure(array $supervisor): int
    {
        $queues = is_array($supervisor['queues'] ?? null) ? $supervisor['queues'] : [];
        $count = 0;
        foreach ($queues as $queue) {
            if (!is_array($queue)) {
                continue;
            }
            if ($this->intValue($queue['open_tickets'] ?? $queue['total_open'] ?? 0) >= 10) {
                $count++;
            }
        }

        return $count;
    }

    /**
     * @param list<array<string, mixed>> $rows
     * @param callable(array<string, mixed>): bool $predicate
     */
    private function countRowsMatching(array $rows, callable $predicate): int
    {
        $count = 0;
        foreach ($rows as $row) {
            if (is_array($row) && $predicate($row)) {
                $count++;
            }
        }

        return $count;
    }

    /**
     * @param list<array<string, mixed>> $rows
     * @return list<array<string, mixed>>
     */
    private function aggregateBy(array $rows, string $field, string $labelKey): array
    {
        $bucket = [];
        foreach ($rows as $row) {
            if (!is_array($row)) {
                continue;
            }
            $label = trim((string) ($row[$field] ?? ''));
            if ($label === '') {
                $label = __('Não informado', 'glpiintegaglpi');
            }
            if (!isset($bucket[$label])) {
                $bucket[$label] = [
                    $labelKey => $label,
                    'count' => 0,
                    'critical' => 0,
                    'warning' => 0,
                ];
            }
            $bucket[$label]['count']++;
            $priority = (string) ($row['priority'] ?? '');
            if ($priority === 'critical') {
                $bucket[$label]['critical']++;
            } elseif ($priority === 'warning') {
                $bucket[$label]['warning']++;
            }
        }

        usort($bucket, static fn (array $a, array $b): int => ($b['count'] <=> $a['count']));

        return array_slice(array_values($bucket), 0, 8);
    }

    /**
     * @param list<array<string, mixed>> $rows
     * @return list<array<string, mixed>>
     */
    private function aggregateRiskBy(array $rows, string $field, string $contains = ''): array
    {
        $filtered = array_values(array_filter($rows, static function (array $row) use ($contains): bool {
            if ($contains === '') {
                return (string) ($row['priority'] ?? '') !== 'normal';
            }

            return str_contains(strtolower((string) ($row['reason'] ?? '')), $contains);
        }));

        return $this->aggregateBy($filtered, $field, $field);
    }

    /**
     * @param list<array<string, mixed>> $queues
     * @param list<array<string, mixed>> $actionQueue
     * @return list<array<string, mixed>>
     */
    private function buildAgingByQueue(array $queues, array $actionQueue): array
    {
        $aging = [];
        foreach ($queues as $queue) {
            if (!is_array($queue)) {
                continue;
            }
            $name = trim((string) ($queue['name'] ?? $queue['queue_name'] ?? ''));
            if ($name === '') {
                continue;
            }
            $aging[] = [
                'queue' => $this->truncate($name, 60),
                'count' => $this->intValue($queue['open_tickets'] ?? $queue['total_open'] ?? 0),
                'aging_label' => $this->truncate((string) ($queue['max_age'] ?? $queue['oldest_ticket_age'] ?? '-'), 40),
            ];
        }

        if ($aging !== []) {
            return array_slice($aging, 0, 8);
        }

        return $this->aggregateBy($actionQueue, 'queue', 'queue');
    }

    /**
     * @param array<string, mixed> $row
     */
    private function buildAgeLabel(array $row): string
    {
        foreach (['ticket_age', 'age_label', 'stalled_time', 'waiting_since', 'created_at'] as $field) {
            $value = trim((string) ($row[$field] ?? ''));
            if ($value !== '') {
                return $this->truncate($value, 48);
            }
        }

        return '-';
    }

    private function priorityFromReasons(string $reasons): string
    {
        $text = strtolower($reasons);
        if (str_contains($text, 'erro') || str_contains($text, 'sla') || str_contains($text, 'csat')) {
            return 'critical';
        }
        if (str_contains($text, 'inatividade') || str_contains($text, 'supervisor') || str_contains($text, 'ia')) {
            return 'warning';
        }

        return 'normal';
    }

    /**
     * @param array<string, mixed> $values
     * @param list<string> $keys
     */
    private function firstInt(array $values, array $keys): int
    {
        foreach ($keys as $key) {
            if (array_key_exists($key, $values)) {
                return $this->intValue($values[$key]);
            }
        }

        return 0;
    }

    private function intValue(mixed $value): int
    {
        return max(0, (int) $value);
    }

    private function isTechnicalDegraded(array $technical): bool
    {
        $light = strtolower((string) ($technical['traffic_light'] ?? ''));
        if ($light !== '') {
            return !in_array($light, ['ok', 'green', 'healthy'], true);
        }

        return !empty($technical['error']);
    }

    private function statusFromNodePart(mixed $part): string
    {
        if (!is_array($part)) {
            return 'degraded';
        }

        $ok = $part['ok'] ?? $part['healthy'] ?? $part['available'] ?? null;
        if ($ok === true || $ok === 'ok' || $ok === 'healthy') {
            return 'ok';
        }

        return 'degraded';
    }

    /**
     * @param list<string> $allowed
     */
    private function allowToken(string $value, array $allowed): string
    {
        $value = preg_replace('/[^a-z0-9_:-]+/i', '', strtolower(trim($value))) ?? '';

        return in_array($value, $allowed, true) ? $value : '';
    }

    private function truncate(string $value, int $max): string
    {
        $value = trim($value);
        if ($value === '') {
            return '';
        }

        return mb_strlen($value) > $max ? mb_substr($value, 0, max(0, $max - 1)) . '…' : $value;
    }

    private function safeMessage(string $message): string
    {
        return $message === ''
            ? __('Fonte temporariamente indisponível.', 'glpiintegaglpi')
            : __('Detalhe técnico omitido por segurança.', 'glpiintegaglpi');
    }
}
