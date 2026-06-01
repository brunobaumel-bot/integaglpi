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

        $technical = $this->loadSource('technical_health', function (): array {
            if (!class_exists(TechnicalHealthDashboardService::class)) {
                return ['available' => false, 'error' => __('Saúde Técnica ainda não está disponível.', 'glpiintegaglpi')];
            }

            return (new TechnicalHealthDashboardService())->getSnapshot();
        }, $sourceErrors);

        $kpis = $this->buildKpis($supervisor, $quality, $online, $technical);
        $actionQueue = $this->buildActionQueue($supervisor);

        return [
            'generated_at' => gmdate('c'),
            'filters' => $filters,
            'kpis' => $kpis,
            'action_queue' => $actionQueue,
            'integration_status' => $this->buildIntegrationStatus($technical),
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
     * @return list<array<string, mixed>>
     */
    private function buildKpis(array $supervisor, array $quality, array $online, array $technical): array
    {
        $supervisorKpis = is_array($supervisor['kpis'] ?? null) ? $supervisor['kpis'] : [];
        $qualityKpis = is_array($quality['kpis'] ?? null) ? $quality['kpis'] : [];
        $onlineKpis = is_array($online['kpis'] ?? null) ? $online['kpis'] : [];

        $integrationDegraded = $this->isTechnicalDegraded($technical) ? 1 : 0;
        $slaRisk = $this->firstInt($qualityKpis, ['sla_risk', 'sla_at_risk', 'risk_sla', 'violated_sla']);
        $aiAlerts = $this->firstInt($onlineKpis, ['ai_alerts', 'unreviewed_ai_alerts', 'supervisor_alerts']);

        return [
            $this->kpi('open_tickets', __('Chamados abertos', 'glpiintegaglpi'), $this->intValue($supervisorKpis['open_tickets'] ?? 0), 'primary', Plugin::getSupervisorBackofficeUrl()),
            $this->kpi('sla_risk', __('SLA em risco', 'glpiintegaglpi'), $slaRisk, $slaRisk > 0 ? 'warning' : 'success', Plugin::getQualityDashboardUrl() . '?sla=risk'),
            $this->kpi('critical_inactivity', __('Inatividade crítica', 'glpiintegaglpi'), $this->intValue($supervisorKpis['inactivity_attention_tickets'] ?? 0), 'warning', Plugin::getSupervisorBackofficeUrl() . '?quality=inactivity_failed'),
            $this->kpi('csat_reopen', __('CSAT/reabertura', 'glpiintegaglpi'), $this->intValue($supervisorKpis['dissatisfied_tickets'] ?? 0), 'danger', Plugin::getQualityDashboardUrl() . '?csat=dissatisfied'),
            $this->kpi('ai_alerts', __('Alertas IA pendentes', 'glpiintegaglpi'), $aiAlerts, $aiAlerts > 0 ? 'warning' : 'success', Plugin::getOnlineMonitorUrl() . '?tab=ai_alerts'),
            $this->kpi('queue_pressure', __('Filas sob pressão', 'glpiintegaglpi'), $this->countQueuePressure($supervisor), 'warning', Plugin::getOnlineMonitorUrl() . '?view=all'),
            $this->kpi('contracts_attention', __('Contratos/horas em atenção', 'glpiintegaglpi'), 0, 'secondary', Plugin::getContractHoursUrl()),
            $this->kpi('integrations_degraded', __('Integrações degradadas', 'glpiintegaglpi'), $integrationDegraded, $integrationDegraded > 0 ? 'danger' : 'success', Plugin::getTechnicalHealthUrl()),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function kpi(string $key, string $label, int $value, string $tone, string $url): array
    {
        return [
            'key' => $key,
            'label' => $label,
            'value' => $value,
            'tone' => $tone,
            'url' => $url,
        ];
    }

    /**
     * @param array<string, mixed> $supervisor
     * @return list<array<string, mixed>>
     */
    private function buildActionQueue(array $supervisor): array
    {
        $rows = is_array($supervisor['review_rows'] ?? null) ? $supervisor['review_rows'] : [];
        $queue = [];

        foreach (array_slice($rows, 0, self::ACTION_QUEUE_LIMIT) as $row) {
            if (!is_array($row)) {
                continue;
            }

            $ticketId = $this->intValue($row['glpi_ticket_id'] ?? 0);
            $reasons = is_array($row['review_reasons'] ?? null) ? $row['review_reasons'] : [];
            $queue[] = [
                'ticket_id' => $ticketId,
                'ticket_url' => $ticketId > 0 ? Plugin::getTicketUrl($ticketId) : '',
                'context_url' => $ticketId > 0 ? Plugin::getTicketUrl($ticketId) . '&forcetab=PluginIntegaglpiTicketRuntime$2' : '',
                'entity' => $this->truncate((string) ($row['glpi_entity_name'] ?? $row['memory_entity_name'] ?? '-'), 80),
                'queue' => $this->truncate((string) ($row['queue_name'] ?? '-'), 60),
                'technician' => $this->truncate((string) ($row['assigned_user_name'] ?? __('Sem técnico', 'glpiintegaglpi')), 60),
                'status' => $this->truncate((string) ($row['conversation_status'] ?? $row['runtime_status'] ?? '-'), 40),
                'sla_remaining' => $this->truncate((string) ($row['sla_remaining'] ?? $row['sla_status'] ?? '-'), 40),
                'reason' => $this->truncate(implode('; ', array_map('strval', $reasons)), 140),
                'suggested_action' => $this->suggestAction($reasons),
                'phone_masked' => $this->truncate((string) ($row['phone_masked'] ?? ''), 32),
            ];
        }

        return $queue;
    }

    /**
     * @param array<string, mixed> $technical
     * @return list<array<string, string>>
     */
    private function buildIntegrationStatus(array $technical): array
    {
        $node = is_array($technical['node'] ?? null) ? $technical['node'] : [];
        $ai = is_array($technical['ai'] ?? null) ? $technical['ai'] : [];

        return [
            $this->integration('whatsapp_meta', 'WhatsApp / Meta', $this->statusFromNodePart($node['meta'] ?? null), Plugin::getTechnicalHealthUrl()),
            $this->integration('integration_service', 'Node integration-service', ($node['ok'] ?? false) ? 'ok' : 'degraded', Plugin::getTechnicalHealthUrl()),
            $this->integration('postgres', 'PostgreSQL externo', $this->statusFromNodePart($node['postgres'] ?? null), Plugin::getTechnicalHealthUrl()),
            $this->integration('redis', 'Redis', $this->statusFromNodePart($node['redis'] ?? null), Plugin::getTechnicalHealthUrl()),
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
        if (str_contains($text, 'erro')) {
            return __('Abrir diagnóstico operacional antes de nova ação.', 'glpiintegaglpi');
        }

        return __('Avaliar contexto e priorizar ação humana.', 'glpiintegaglpi');
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
