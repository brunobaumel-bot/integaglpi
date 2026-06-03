<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi\Service;

use GlpiPlugin\Integaglpi\External\ExternalDatabase;
use PDO;
use Throwable;

final class AiOnlineAlertService
{
    private const DEFAULT_LIMIT = 25;
    private const MAX_LIMIT = 50;
    private const ALLOWED_FEEDBACK = [
        'useful',
        'false_positive',
        'not_applicable',
        'real_risk',
        'dismiss',
        'silence_24h',
    ];

    private PluginConfigService $pluginConfigService;

    public function __construct(PluginConfigService $pluginConfigService)
    {
        $this->pluginConfigService = $pluginConfigService;
    }

    /**
     * @param array<string, mixed> $query
     * @return array<string, mixed>
     */
    public function getPanelData(array $query, bool $supervisor): array
    {
        if (!$supervisor) {
            return [
                'visible' => false,
                'rows' => [],
                'filters' => [],
                'options' => $this->options(),
                'error' => '',
            ];
        }

        $filters = $this->normalizeFilters($query);
        if (!$this->pluginConfigService->isConfigured()) {
            return $this->emptyPanel($filters, __('PostgreSQL externo ainda não está configurado.', 'glpiintegaglpi'));
        }

        try {
            $pdo = ExternalDatabase::getConnection($this->pluginConfigService->getConnectionConfig());
            if (!$this->tableExists($pdo, 'glpi_plugin_integaglpi_ai_online_alerts')) {
                return $this->emptyPanel($filters, __('Tabela de alertas de IA ainda não foi criada.', 'glpiintegaglpi'));
            }

            return [
                'visible' => true,
                'rows' => $this->loadAlerts($pdo, $filters),
                'filters' => $filters,
                'options' => $this->options(),
                'error' => '',
            ];
        } catch (Throwable $exception) {
            error_log('[integaglpi][ai_online_alerts][list] ' . $this->sanitizeLog($exception->getMessage()));

            return $this->emptyPanel($filters, __('Não foi possível carregar alertas de IA agora.', 'glpiintegaglpi'));
        }
    }

    /**
     * Compact read-only summary for the Supervisor Command Center.
     *
     * @param array<string, mixed> $query
     * @return array<string, mixed>
     */
    public function getSupervisorSummary(array $query, bool $supervisor): array
    {
        if (!$supervisor) {
            return [
                'visible' => false,
                'rows' => [],
                'high_open_count' => 0,
                'open_count' => 0,
                'error' => '',
            ];
        }

        $filters = $this->normalizeFilters($query);
        $filters['status'] = 'open';
        $filters['severity'] = '';
        $filters['limit'] = min(12, (int) $filters['limit']);
        if (!$this->pluginConfigService->isConfigured()) {
            return [
                'visible' => true,
                'rows' => [],
                'high_open_count' => 0,
                'open_count' => 0,
                'error' => __('PostgreSQL externo ainda não está configurado.', 'glpiintegaglpi'),
            ];
        }

        try {
            $pdo = ExternalDatabase::getConnection($this->pluginConfigService->getConnectionConfig());
            if (!$this->tableExists($pdo, 'glpi_plugin_integaglpi_ai_online_alerts')) {
                return [
                    'visible' => true,
                    'rows' => [],
                    'high_open_count' => 0,
                    'open_count' => 0,
                    'error' => __('Tabela de alertas de IA ainda não foi criada.', 'glpiintegaglpi'),
                ];
            }

            $openFilters = $filters;
            $openFilters['severity'] = '';
            $highFilters = $filters;
            $highFilters['severity'] = 'high';

            return [
                'visible' => true,
                'rows' => $this->loadAlerts($pdo, $filters),
                'high_open_count' => $this->countAlerts($pdo, $highFilters),
                'open_count' => $this->countAlerts($pdo, $openFilters),
                'error' => '',
            ];
        } catch (Throwable $exception) {
            error_log('[integaglpi][ai_online_alerts][supervisor_summary] ' . $this->sanitizeLog($exception->getMessage()));

            return [
                'visible' => true,
                'rows' => [],
                'high_open_count' => 0,
                'open_count' => 0,
                'error' => __('Não foi possível carregar alertas de IA agora.', 'glpiintegaglpi'),
            ];
        }
    }

    /**
     * @param array<string, mixed> $post
     * @return array<string, mixed>
     */
    public function handleFeedback(array $post, int $userId): array
    {
        $alertId = $this->safeId((string) ($post['alert_id'] ?? ''));
        $feedback = $this->safeToken((string) ($post['feedback_value'] ?? ''));
        $notes = $this->sanitizeText((string) ($post['feedback_notes'] ?? ''), 500);
        if ($alertId === '' || !in_array($feedback, self::ALLOWED_FEEDBACK, true)) {
            return ['ok' => false, 'message' => __('Feedback inválido.', 'glpiintegaglpi')];
        }
        if (!$this->pluginConfigService->isConfigured()) {
            return ['ok' => false, 'message' => __('PostgreSQL externo ainda não está configurado.', 'glpiintegaglpi')];
        }

        try {
            $pdo = ExternalDatabase::getConnection($this->pluginConfigService->getConnectionConfig());
            if (!$this->tableExists($pdo, 'glpi_plugin_integaglpi_ai_online_alerts')) {
                return ['ok' => false, 'message' => __('Tabela de alertas de IA ainda não foi criada.', 'glpiintegaglpi')];
            }

            $status = $this->statusForFeedback($feedback);
            $dismissedUntilSql = $feedback === 'silence_24h' ? "NOW() + INTERVAL '24 hours'" : 'NULL';
            $statement = $pdo->prepare(
                "UPDATE public.glpi_plugin_integaglpi_ai_online_alerts
                    SET status = :status,
                        dismissed_until = {$dismissedUntilSql},
                        reviewed_by = :reviewed_by,
                        reviewed_at = NOW(),
                        feedback_value = :feedback_value,
                        feedback_notes_sanitized = :feedback_notes,
                        updated_at = NOW()
                  WHERE alert_id = :alert_id
                  RETURNING alert_id, conversation_id, glpi_ticket_id, alert_type, severity"
            );
            $statement->execute([
                ':status' => $status,
                ':reviewed_by' => $userId,
                ':feedback_value' => $feedback,
                ':feedback_notes' => $notes !== '' ? $notes : null,
                ':alert_id' => $alertId,
            ]);
            $row = $statement->fetch(PDO::FETCH_ASSOC);
            if (!is_array($row)) {
                return ['ok' => false, 'message' => __('Alerta não encontrado.', 'glpiintegaglpi')];
            }

            $this->audit($pdo, $this->eventForFeedback($feedback), $status === 'false_positive' ? 'ignored' : 'success', [
                'alert_id' => (string) ($row['alert_id'] ?? ''),
                'conversation_id' => (string) ($row['conversation_id'] ?? ''),
                'glpi_ticket_id' => (int) ($row['glpi_ticket_id'] ?? 0),
                'alert_type' => (string) ($row['alert_type'] ?? ''),
                'severity' => (string) ($row['severity'] ?? ''),
                'feedback_value' => $feedback,
                'user_id' => $userId,
            ]);
            $this->audit($pdo, 'AI_ONLINE_ALERT_FEEDBACK', 'success', [
                'alert_id' => (string) ($row['alert_id'] ?? ''),
                'conversation_id' => (string) ($row['conversation_id'] ?? ''),
                'glpi_ticket_id' => (int) ($row['glpi_ticket_id'] ?? 0),
                'alert_type' => (string) ($row['alert_type'] ?? ''),
                'feedback_value' => $feedback,
                'user_id' => $userId,
            ]);

            return ['ok' => true, 'message' => __('Feedback registrado. Nenhum ticket foi alterado.', 'glpiintegaglpi')];
        } catch (Throwable $exception) {
            error_log('[integaglpi][ai_online_alerts][feedback] ' . $this->sanitizeLog($exception->getMessage()));

            return ['ok' => false, 'message' => __('Não foi possível registrar o feedback agora.', 'glpiintegaglpi')];
        }
    }

    /**
     * @param list<string> $conversationIds
     * @return array<string, int>
     */
    public function loadOpenBadgeCounts(array $conversationIds, bool $supervisor): array
    {
        if (!$supervisor || $conversationIds === [] || !$this->pluginConfigService->isConfigured()) {
            return [];
        }

        try {
            $pdo = ExternalDatabase::getConnection($this->pluginConfigService->getConnectionConfig());
            if (!$this->tableExists($pdo, 'glpi_plugin_integaglpi_ai_online_alerts')) {
                return [];
            }
            $conversationIds = array_values(array_unique(array_filter(array_map([$this, 'safeId'], $conversationIds))));
            if ($conversationIds === []) {
                return [];
            }
            $placeholders = [];
            $params = [];
            foreach ($conversationIds as $index => $conversationId) {
                $placeholder = ':conversation_' . $index;
                $placeholders[] = $placeholder;
                $params[$placeholder] = $conversationId;
            }
            $statement = $pdo->prepare(
                'SELECT conversation_id, COUNT(*)::int AS count
                   FROM public.glpi_plugin_integaglpi_ai_online_alerts
                  WHERE status = :status
                    AND (dismissed_until IS NULL OR dismissed_until <= NOW())
                    AND conversation_id IN (' . implode(', ', $placeholders) . ')
                  GROUP BY conversation_id'
            );
            $statement->bindValue(':status', 'open', PDO::PARAM_STR);
            foreach ($params as $key => $value) {
                $statement->bindValue($key, $value, PDO::PARAM_STR);
            }
            $statement->execute();

            $counts = [];
            while (($row = $statement->fetch(PDO::FETCH_ASSOC)) !== false) {
                $counts[(string) ($row['conversation_id'] ?? '')] = (int) ($row['count'] ?? 0);
            }

            return $counts;
        } catch (Throwable $exception) {
            error_log('[integaglpi][ai_online_alerts][badge] ' . $this->sanitizeLog($exception->getMessage()));

            return [];
        }
    }

    /**
     * @param array<string, mixed> $filters
     * @return list<array<string, mixed>>
     */
    private function loadAlerts(PDO $pdo, array $filters): array
    {
        [$where, $params] = $this->buildAlertWhere($filters);

        $statement = $pdo->prepare(
            'SELECT
                alert_id,
                conversation_id,
                glpi_ticket_id,
                queue_id,
                technician_id,
                entity_id,
                alert_type,
                severity,
                confidence_score,
                evidence_summary_sanitized,
                recommended_human_action,
                source_signals_json,
                status,
                created_at,
                updated_at
               FROM public.glpi_plugin_integaglpi_ai_online_alerts
              WHERE ' . implode(' AND ', $where) . '
                AND (dismissed_until IS NULL OR dismissed_until <= NOW())
              ORDER BY
                CASE severity WHEN \'high\' THEN 1 WHEN \'medium\' THEN 2 ELSE 3 END,
                created_at DESC
              LIMIT :limit'
        );
        foreach ($params as $key => $definition) {
            $statement->bindValue($key, $definition['value'], $definition['type']);
        }
        $statement->bindValue(':limit', (int) $filters['limit'], PDO::PARAM_INT);
        $statement->execute();

        $rows = [];
        while (($row = $statement->fetch(PDO::FETCH_ASSOC)) !== false) {
            $signals = [];
            $rawSignals = $row['source_signals_json'] ?? null;
            if (is_string($rawSignals) && trim($rawSignals) !== '') {
                $decoded = json_decode($rawSignals, true);
                $signals = is_array($decoded) ? $decoded : [];
            } elseif (is_array($rawSignals)) {
                $signals = $rawSignals;
            }

            $rows[] = [
                'alert_id' => (string) ($row['alert_id'] ?? ''),
                'conversation_id' => (string) ($row['conversation_id'] ?? ''),
                'glpi_ticket_id' => (int) ($row['glpi_ticket_id'] ?? 0),
                'queue_id' => (int) ($row['queue_id'] ?? 0),
                'technician_id' => (int) ($row['technician_id'] ?? 0),
                'entity_id' => (int) ($row['entity_id'] ?? 0),
                'alert_type' => $this->sanitizeText((string) ($row['alert_type'] ?? ''), 80),
                'severity' => $this->sanitizeText((string) ($row['severity'] ?? ''), 20),
                'confidence_score' => (int) ($row['confidence_score'] ?? 0),
                'evidence_summary_sanitized' => $this->sanitizeText((string) ($row['evidence_summary_sanitized'] ?? ''), 700),
                'recommended_human_action' => $this->sanitizeText((string) ($row['recommended_human_action'] ?? ''), 500),
                'source_signals_json' => $this->sanitizeSignals($signals),
                'status' => $this->sanitizeText((string) ($row['status'] ?? ''), 30),
                'created_at' => (string) ($row['created_at'] ?? ''),
                'updated_at' => (string) ($row['updated_at'] ?? ''),
            ];
        }

        return $rows;
    }

    /**
     * @param array<string, mixed> $filters
     */
    private function countAlerts(PDO $pdo, array $filters): int
    {
        [$where, $params] = $this->buildAlertWhere($filters);
        $statement = $pdo->prepare(
            'SELECT COUNT(*)::int
               FROM public.glpi_plugin_integaglpi_ai_online_alerts
              WHERE ' . implode(' AND ', $where) . '
                AND (dismissed_until IS NULL OR dismissed_until <= NOW())'
        );
        foreach ($params as $key => $definition) {
            $statement->bindValue($key, $definition['value'], $definition['type']);
        }
        $statement->execute();

        return max(0, (int) $statement->fetchColumn());
    }

    /**
     * @param array<string, mixed> $filters
     * @return array{0: list<string>, 1: array<string, array{value: mixed, type: int}>}
     */
    private function buildAlertWhere(array $filters): array
    {
        $where = ["status = :status"];
        $params = [
            ':status' => ['value' => (string) ($filters['status'] ?? 'open'), 'type' => PDO::PARAM_STR],
        ];
        foreach (['severity', 'alert_type'] as $field) {
            $value = (string) ($filters[$field] ?? '');
            if ($value !== '') {
                $where[] = $field . ' = :' . $field;
                $params[':' . $field] = ['value' => $value, 'type' => PDO::PARAM_STR];
            }
        }
        foreach (['queue_id', 'entity_id', 'technician_id'] as $field) {
            $value = (int) ($filters[$field] ?? 0);
            if ($value > 0) {
                $where[] = $field . ' = :' . $field;
                $params[':' . $field] = ['value' => $value, 'type' => PDO::PARAM_INT];
            }
        }
        $dateFrom = trim((string) ($filters['date_from'] ?? ''));
        if ($dateFrom !== '') {
            $where[] = 'created_at >= :date_from';
            $params[':date_from'] = ['value' => $dateFrom . ' 00:00:00', 'type' => PDO::PARAM_STR];
        }
        $dateTo = trim((string) ($filters['date_to'] ?? ''));
        if ($dateTo !== '') {
            $where[] = 'created_at <= :date_to';
            $params[':date_to'] = ['value' => $dateTo . ' 23:59:59', 'type' => PDO::PARAM_STR];
        }

        return [$where, $params];
    }

    /**
     * @param array<string, mixed> $query
     * @return array<string, mixed>
     */
    private function normalizeFilters(array $query): array
    {
        $status = $this->safeToken((string) ($query['ai_alert_status'] ?? 'open'));
        if (!in_array($status, ['open', 'reviewed', 'dismissed', 'false_positive', 'resolved'], true)) {
            $status = 'open';
        }
        $severity = $this->safeToken((string) ($query['ai_alert_severity'] ?? ''));
        if (!in_array($severity, ['', 'low', 'medium', 'high'], true)) {
            $severity = '';
        }
        $type = $this->safeToken((string) ($query['ai_alert_type'] ?? ''));
        if (!in_array($type, array_merge([''], array_keys($this->alertTypeLabels())), true)) {
            $type = '';
        }
        $limit = (int) ($query['ai_alert_limit'] ?? self::DEFAULT_LIMIT);

        return [
            'status' => $status,
            'severity' => $severity,
            'alert_type' => $type,
            'queue_id' => max(0, (int) ($query['ai_alert_queue_id'] ?? $query['queue_id'] ?? 0)),
            'entity_id' => max(0, (int) ($query['ai_alert_entity_id'] ?? $query['entity_id'] ?? 0)),
            'technician_id' => max(0, (int) ($query['ai_alert_technician_id'] ?? $query['technician_id'] ?? 0)),
            'date_from' => $this->safeDate((string) ($query['ai_alert_date_from'] ?? $query['date_from'] ?? '')),
            'date_to' => $this->safeDate((string) ($query['ai_alert_date_to'] ?? $query['date_to'] ?? '')),
            'limit' => max(1, min(self::MAX_LIMIT, $limit > 0 ? $limit : self::DEFAULT_LIMIT)),
        ];
    }

    /**
     * @param array<string, mixed> $filters
     * @return array<string, mixed>
     */
    private function emptyPanel(array $filters, string $error): array
    {
        return [
            'visible' => true,
            'rows' => [],
            'filters' => $filters,
            'options' => $this->options(),
            'error' => $error,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function options(): array
    {
        return [
            'alert_types' => $this->alertTypeLabels(),
            'severities' => [
                '' => __('Todas', 'glpiintegaglpi'),
                'high' => __('Alta', 'glpiintegaglpi'),
                'medium' => __('Média', 'glpiintegaglpi'),
                'low' => __('Baixa', 'glpiintegaglpi'),
            ],
            'statuses' => [
                'open' => __('Abertos', 'glpiintegaglpi'),
                'reviewed' => __('Revisados', 'glpiintegaglpi'),
                'dismissed' => __('Descartados', 'glpiintegaglpi'),
                'false_positive' => __('Falso positivo', 'glpiintegaglpi'),
                'resolved' => __('Resolvidos', 'glpiintegaglpi'),
            ],
        ];
    }

    /**
     * @return array<string, string>
     */
    private function alertTypeLabels(): array
    {
        return [
            'long_waiting_client' => __('Cliente aguardando há muito tempo', 'glpiintegaglpi'),
            'high_risk_reopen' => __('Risco de reabertura', 'glpiintegaglpi'),
            'possible_frustration' => __('Possível frustração', 'glpiintegaglpi'),
            'supervisor_requested' => __('Supervisor solicitado', 'glpiintegaglpi'),
            'long_inactivity_risk' => __('Risco por inatividade', 'glpiintegaglpi'),
            'queue_accumulation' => __('Acúmulo de fila', 'glpiintegaglpi'),
            'no_responsible_technician' => __('Sem técnico responsável', 'glpiintegaglpi'),
        ];
    }

    private function statusForFeedback(string $feedback): string
    {
        if ($feedback === 'false_positive') {
            return 'false_positive';
        }
        if ($feedback === 'dismiss' || $feedback === 'silence_24h') {
            return 'dismissed';
        }

        return 'reviewed';
    }

    private function eventForFeedback(string $feedback): string
    {
        if ($feedback === 'false_positive') {
            return 'AI_ONLINE_ALERT_FALSE_POSITIVE';
        }
        if ($feedback === 'dismiss' || $feedback === 'silence_24h') {
            return 'AI_ONLINE_ALERT_DISMISSED';
        }

        return 'AI_ONLINE_ALERT_REVIEWED';
    }

    private function tableExists(PDO $pdo, string $table): bool
    {
        $statement = $pdo->prepare("SELECT to_regclass(:table_name)");
        $statement->execute([':table_name' => 'public.' . $table]);

        return (bool) $statement->fetchColumn();
    }

    /**
     * @param array<string, mixed> $payload
     */
    private function audit(PDO $pdo, string $eventType, string $status, array $payload): void
    {
        try {
            if (!$this->tableExists($pdo, 'glpi_plugin_integaglpi_audit_events')) {
                return;
            }
            $statement = $pdo->prepare(
                "INSERT INTO public.glpi_plugin_integaglpi_audit_events (
                    correlation_id,
                    ticket_id,
                    conversation_id,
                    message_id,
                    direction,
                    event_type,
                    status,
                    severity,
                    source,
                    payload_json,
                    created_at
                ) VALUES (
                    :correlation_id,
                    :ticket_id,
                    :conversation_id,
                    NULL,
                    NULL,
                    :event_type,
                    :status,
                    :severity,
                    'AiOnlineAlertService',
                    CAST(:payload AS jsonb),
                    NOW()
                )"
            );
            $statement->execute([
                ':correlation_id' => 'ai_online_alert:' . bin2hex(random_bytes(8)),
                ':ticket_id' => (int) ($payload['glpi_ticket_id'] ?? 0) ?: null,
                ':conversation_id' => (string) ($payload['conversation_id'] ?? ''),
                ':event_type' => $eventType,
                ':status' => $status,
                ':severity' => $status === 'ignored' ? 'warning' : 'info',
                ':payload' => json_encode($this->sanitizeSignals($payload), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?: '{}',
            ]);
        } catch (Throwable $exception) {
            error_log('[integaglpi][ai_online_alerts][audit] ' . $this->sanitizeLog($exception->getMessage()));
        }
    }

    /**
     * @param array<string, mixed> $signals
     * @return array<string, mixed>
     */
    private function sanitizeSignals(array $signals): array
    {
        unset($signals['prompt'], $signals['raw_prompt'], $signals['raw_payload'], $signals['token'], $signals['secret'], $signals['password'], $signals['api_key'], $signals['bearer']);

        foreach ($signals as $key => $value) {
            if (is_string($value)) {
                $signals[$key] = $this->sanitizeText($value, 220);
            }
        }

        return $signals;
    }

    private function sanitizeText(string $value, int $limit): string
    {
        $value = html_entity_decode(strip_tags($value), ENT_QUOTES | ENT_HTML5, 'UTF-8');
        $value = preg_replace('/[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}/i', '[email]', $value) ?? '';
        $value = preg_replace('/\b(?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?\d{4,5}[\s.\-]?\d{4}\b/', '[telefone]', $value) ?? '';
        $value = preg_replace('/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b|\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/', '[documento]', $value) ?? '';
        $value = preg_replace('/(password|senha|token|secret|bearer|api[_-]?key)\s*[:=]\s*\S+/i', '$1=[redacted]', $value) ?? '';
        $value = preg_replace('/[[:cntrl:]]+/', ' ', $value) ?? '';
        $value = trim((string) preg_replace('/\s+/', ' ', $value));

        return function_exists('mb_substr') ? mb_substr($value, 0, $limit, 'UTF-8') : substr($value, 0, $limit);
    }

    private function safeToken(string $value): string
    {
        $value = strtolower(trim($value));

        return preg_match('/^[a-z0-9_-]{1,80}$/', $value) === 1 ? $value : '';
    }

    private function safeDate(string $value): string
    {
        $value = trim($value);

        return preg_match('/^\d{4}-\d{2}-\d{2}$/', $value) === 1 ? $value : '';
    }

    private function safeId(string $value): string
    {
        $value = trim($value);

        return preg_match('/^[A-Za-z0-9_.:-]{1,120}$/', $value) === 1 ? $value : '';
    }

    private function sanitizeLog(string $message): string
    {
        $message = preg_replace('/(password|senha|token|secret|bearer|api[_-]?key)\s*[:=]\s*\S+/i', '$1=[redacted]', $message) ?? '';
        $message = preg_replace('/[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}/i', '[email]', $message) ?? '';
        $message = preg_replace('/\b(?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?\d{4,5}[\s.\-]?\d{4}\b/', '[telefone]', $message) ?? '';

        return substr($message, 0, 220);
    }
}
