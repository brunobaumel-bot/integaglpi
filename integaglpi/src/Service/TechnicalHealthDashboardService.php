<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi\Service;

use GlpiPlugin\Integaglpi\Plugin;
use Throwable;

/**
 * Lightweight orchestrator for the unified Technical Health dashboard.
 *
 * Phase: integaglpi_technical_runtime_dashboard_unification_001.
 *
 * This service does NOT own any data. It delegates to the existing services and
 * returns a consolidated snapshot for the read-only dashboard template.
 *
 * Security contract:
 * - Never exposes tokens, bearer headers, PSK, app secrets or connection strings.
 * - Never exposes raw_payload, full message bodies or PII.
 * - All calls are read-only; no mutations, no retries, no reprocessing.
 * - Each source is wrapped in a try/catch; partial failure returns safe placeholder.
 */
final class TechnicalHealthDashboardService
{
    /** Maximum age of audit events to include (seconds). Avoids full-table scans. */
    private const EVENTS_WINDOW_HOURS = 24;

    /** Hard row limit for event lists. */
    private const EVENTS_LIMIT = 50;

    /** HTTP timeout when calling integration-service. */
    private const NODE_TIMEOUT_SECONDS = 5;

    public function __construct(
        private readonly PluginConfigService $pluginConfigService = new PluginConfigService(),
        private readonly IntegrationServiceClient $integrationClient = new IntegrationServiceClient(new PluginConfigService()),
        private readonly OperationalDiagnosticsService $diagnosticsService = new OperationalDiagnosticsService(),
        private readonly OperationalAuditService $auditService = new OperationalAuditService(),
        private readonly ObservabilityService $observabilityService = new ObservabilityService(new PluginConfigService()),
        private readonly AiConfigViewService $aiConfigService = new AiConfigViewService(new PluginConfigService()),
    ) {
    }

    /**
     * Build the consolidated snapshot for the dashboard.
     *
     * @return array<string, mixed>
     */
    public function getSnapshot(): array
    {
        $generatedAt = gmdate('c');

        // ── 1. Node diagnostics ────────────────────────────────────────────
        $nodeDiagnostics = $this->safeNodeDiagnostics();

        // ── 2. Observability (health cards from Node) ──────────────────────
        $observability = $this->safeObservability();

        // ── 3. Operational diagnostics (runtime readiness) ────────────────
        $operationalDiagnostics = $this->safeOperationalDiagnostics();

        // ── 4. Operational audit (health + events) ────────────────────────
        $auditData = $this->safeAuditData();

        // ── 5. AI/Ollama summary ───────────────────────────────────────────
        $aiSummary = $this->safeAiSummary();

        // ── 6. Compute top-level traffic light ────────────────────────────
        $trafficLight = $this->computeTrafficLight($nodeDiagnostics, $observability, $auditData);

        // ── 7. Manual recommendations ─────────────────────────────────────
        $recommendations = $this->buildRecommendations($auditData, $observability, $operationalDiagnostics);

        // ── 8. Critical feature flags (V8 observability) ──────────────────
        $featureFlags = $this->safeFeatureFlags($nodeDiagnostics);

        // ── 9. Critical migrations status (044/045) ───────────────────────
        $migrations = $this->safeMigrations();

        return [
            'generated_at'           => $generatedAt,
            'plugin_version'         => defined('PLUGIN_INTEGAGLPI_VERSION') ? (string) PLUGIN_INTEGAGLPI_VERSION : 'unknown',
            'environment'            => $this->detectEnvironment(),
            'traffic_light'          => $trafficLight,
            'node'                   => $nodeDiagnostics,
            'observability'          => $observability,
            'operational_diagnostics'=> $operationalDiagnostics,
            'audit'                  => $auditData,
            'ai'                     => $aiSummary,
            'recommendations'        => $recommendations,
            'feature_flags'          => $featureFlags,
            'migrations'             => $migrations,
            'events_window_hours'    => self::EVENTS_WINDOW_HOURS,
            'events_limit'           => self::EVENTS_LIMIT,
            'is_configured'          => $this->pluginConfigService->isConfigured(),
            'read_only'              => true,
        ];
    }

    /**
     * Critical feature flags for the read-only dashboard. NEVER returns secrets,
     * tokens or full sensitive URLs. Each flag carries an explicit source so the
     * operator knows whether the value is authoritative or "not exposed" (the Node
     * env flags are not surfaced by the diagnostics endpoint and must NOT be
     * fabricated). This method does not call LogMeIn, cloud or mutate anything.
     *
     * @param array<string, mixed> $nodeDiagnostics
     * @return list<array{key:string,label:string,value:string,status:string,source:string}>
     */
    private function safeFeatureFlags(array $nodeDiagnostics): array
    {
        $flags = [];

        // Environment (TESTE/HOMOLOGACAO/PRODUCAO) — derived from the GLPI base URL.
        $env = $this->detectEnvironment();
        $flags[] = [
            'key'    => 'ENVIRONMENT',
            'label'  => __('Ambiente', 'glpiintegaglpi'),
            'value'  => $env,
            'status' => $env === 'producao' ? 'warning' : 'ok',
            'source' => 'glpi_base_url',
        ];

        // AI_SUPERVISOR_ENABLED — authoritative from the plugin config (no secret).
        $aiOn = $this->pluginConfigService->isAiSupervisorEnabled();
        $flags[] = [
            'key'    => 'AI_SUPERVISOR_ENABLED',
            'label'  => __('Supervisor de IA habilitado', 'glpiintegaglpi'),
            'value'  => $aiOn ? 'true' : 'false',
            'status' => 'ok',
            'source' => 'plugin_config',
        ];

        // integration-service endpoint — host only, never the full URL/credentials.
        $flags[] = [
            'key'    => 'INTEGRATION_SERVICE_HOST',
            'label'  => __('Host do integration-service', 'glpiintegaglpi'),
            'value'  => $this->redactUrlToHost($this->pluginConfigService->getIntegrationServiceUrl()),
            'status' => ($nodeDiagnostics['available'] ?? false) ? 'ok' : 'critical',
            'source' => 'plugin_config',
        ];

        // Meta/Webhook configured — boolean only, from the Node readiness payload.
        $metaConfigured = (bool) ($nodeDiagnostics['meta']['configured']
            ?? $nodeDiagnostics['readiness']['meta_configured']
            ?? false);
        $flags[] = [
            'key'    => 'META_WEBHOOK_CONFIGURED',
            'label'  => __('Meta/Webhook configurado', 'glpiintegaglpi'),
            'value'  => $metaConfigured ? 'true' : 'false',
            'status' => $metaConfigured ? 'ok' : 'warning',
            'source' => 'node_diagnostics',
        ];

        // Node env flags that the diagnostics endpoint does NOT expose. We surface
        // them as "not exposed" instead of guessing a value — honesty over fiction.
        foreach ([
            ['OUTBOUND_SEND_MODE', __('Modo de envio outbound', 'glpiintegaglpi')],
            ['EXTERNAL_RESEARCH_CLOUD_ENABLED', __('Pesquisa externa (nuvem) habilitada', 'glpiintegaglpi')],
            ['LOGMEIN_INTEGRATION_ENABLED', __('Integração LogMeIn habilitada', 'glpiintegaglpi')],
            ['GLPI_KB_SEARCH_URL', __('URL de busca KB (host)', 'glpiintegaglpi')],
        ] as [$key, $label]) {
            $nodeValue = $nodeDiagnostics[$key] ?? ($nodeDiagnostics['feature_flags'][$key] ?? null);
            $hasValue = is_scalar($nodeValue) && (string) $nodeValue !== '';
            $value = $hasValue
                ? ($key === 'GLPI_KB_SEARCH_URL' ? $this->redactUrlToHost((string) $nodeValue) : (string) $nodeValue)
                : __('não exposto pelo diagnóstico', 'glpiintegaglpi');
            $flags[] = [
                'key'    => $key,
                'label'  => $label,
                'value'  => $value,
                'status' => $hasValue ? 'ok' : 'unknown',
                'source' => $hasValue ? 'node_diagnostics' : 'unavailable',
            ];
        }

        return $flags;
    }

    /**
     * Read-only status of the critical schema migrations (044/045). File-check only,
     * mirroring SmartHelpService::migration044SchemaStatus — never queries or mutates
     * any database.
     *
     * @return list<array{key:string,label:string,ok:bool,mode:string,missing:list<string>}>
     */
    private function safeMigrations(): array
    {
        $migrations = [];

        // 044 — reuse the existing, committed file-check gate.
        try {
            $status044 = SmartHelpService::migration044SchemaStatus();
            $migrations[] = [
                'key'     => '044_ai_kb_ecosystem_reengineered',
                'label'   => __('Migration 044 — Ecossistema IA/KB', 'glpiintegaglpi'),
                'ok'      => (bool) ($status044['ok'] ?? false),
                'mode'    => (string) ($status044['mode'] ?? 'file_check_only_no_db_mutation'),
                'missing' => array_values(array_filter(
                    (array) ($status044['missing'] ?? []),
                    static fn ($v): bool => is_string($v)
                )),
            ];
        } catch (Throwable $e) {
            $migrations[] = [
                'key' => '044_ai_kb_ecosystem_reengineered',
                'label' => __('Migration 044 — Ecossistema IA/KB', 'glpiintegaglpi'),
                'ok' => false,
                'mode' => 'file_check_error',
                'missing' => [],
            ];
        }

        // 045 — performance/LGPD indexes. Same file-token check, no DB access.
        $migrations[] = $this->fileTokenMigrationStatus(
            '045_performance_scale_lgpd_indexes.sql',
            '045_performance_scale_lgpd_indexes',
            __('Migration 045 — Índices de performance/LGPD', 'glpiintegaglpi'),
            ['CREATE INDEX', 'idx_']
        );

        return $migrations;
    }

    /**
     * Generic committed-file token check for a migration (no DB access, read-only).
     *
     * @param list<string> $requiredTokens
     * @return array{key:string,label:string,ok:bool,mode:string,missing:list<string>}
     */
    private function fileTokenMigrationStatus(string $fileName, string $key, string $label, array $requiredTokens): array
    {
        $path = dirname(__DIR__, 3) . DIRECTORY_SEPARATOR
            . 'integration-service' . DIRECTORY_SEPARATOR
            . 'schema-migrations' . DIRECTORY_SEPARATOR
            . $fileName;

        $missing = $requiredTokens;
        if (is_readable($path)) {
            $sql = (string) file_get_contents($path);
            $missing = [];
            foreach ($requiredTokens as $token) {
                if (stripos($sql, $token) === false) {
                    $missing[] = $token;
                }
            }
        }

        return [
            'key'     => $key,
            'label'   => $label,
            'ok'      => $missing === [],
            'mode'    => 'file_check_only_no_db_mutation',
            'missing' => $missing,
        ];
    }

    /**
     * Reduce a URL to scheme+host(+port) only — drops path, query, credentials so no
     * token or sensitive path is ever shown. Returns '—' when empty/unparseable.
     */
    private function redactUrlToHost(string $url): string
    {
        $url = trim($url);
        if ($url === '') {
            return '—';
        }
        $parts = parse_url($url);
        if ($parts === false || empty($parts['host'])) {
            // Not a parseable URL: never echo it raw (could embed a token).
            return '[redacted]';
        }
        $scheme = isset($parts['scheme']) ? $parts['scheme'] . '://' : '';
        $host = (string) $parts['host'];
        $port = isset($parts['port']) ? ':' . (int) $parts['port'] : '';

        return $scheme . $host . $port;
    }

    // ── Private helpers ──────────────────────────────────────────────────────

    /** @return array<string, mixed> */
    private function safeNodeDiagnostics(): array
    {
        try {
            $response = $this->integrationClient->getDiagnostics();
            if (($response['success'] ?? false) && is_array($response['body'] ?? null)) {
                $body = $response['body'];
                return [
                    'available' => true,
                    'ok'        => (bool) ($body['ok'] ?? false),
                    'postgres'  => $this->safeSubKey($body, 'postgres'),
                    'redis'     => $this->safeSubKey($body, 'redis'),
                    'glpi_api'  => $this->safeSubKey($body, 'glpi_api'),
                    'meta'      => $this->safeSubKey($body, 'meta'),
                    'readiness' => $this->safeSubKey($body, 'readiness'),
                    'ai_runtime_config_summary' => $this->safeSubKey($body, 'ai_runtime_config_summary'),
                    'uptime_seconds' => is_int($body['uptime_seconds'] ?? null) ? $body['uptime_seconds'] : null,
                    'version'   => is_string($body['version'] ?? null) ? $body['version'] : null,
                    'error'     => null,
                ];
            }
            return $this->nodeUnavailable('integration-service returned non-success');
        } catch (Throwable $e) {
            return $this->nodeUnavailable($this->sanitizeMessage($e->getMessage()));
        }
    }

    /** @return array<string, mixed> */
    private function safeObservability(): array
    {
        try {
            $data = $this->observabilityService->getDashboardData([
                'limit'     => (string) self::EVENTS_LIMIT,
                'hours'     => (string) self::EVENTS_WINDOW_HOURS,
            ]);
            return [
                'available' => ($data['error'] ?? '') === '',
                'health'    => $this->safeSubKey($data, 'health'),
                'cards'     => $this->safeSubKey($data, 'cards'),
                'latest'    => $this->safeSubKey($data, 'latest'),
                'safety'    => $this->safeSubKey($data, 'safety'),
                'error'     => (string) ($data['error'] ?? ''),
            ];
        } catch (Throwable $e) {
            return [
                'available' => false,
                'health'    => [],
                'cards'     => [],
                'latest'    => [],
                'safety'    => [],
                'error'     => $this->sanitizeMessage($e->getMessage()),
            ];
        }
    }

    /** @return array<string, mixed> */
    private function safeOperationalDiagnostics(): array
    {
        try {
            $data = $this->diagnosticsService->getDiagnostics();
            return [
                'available'          => true,
                'plugin'             => $this->safeSubKey($data, 'plugin'),
                'runtime_consistency'=> $this->safeSubKey($data, 'runtime_consistency'),
                'local_manifest'     => $this->safeSubKey($data, 'local_manifest'),
                'opcache'            => $this->safeSubKey($data, 'opcache'),
                'error'              => null,
            ];
        } catch (Throwable $e) {
            return [
                'available'          => false,
                'plugin'             => [],
                'runtime_consistency'=> [],
                'local_manifest'     => [],
                'opcache'            => [],
                'error'              => $this->sanitizeMessage($e->getMessage()),
            ];
        }
    }

    /** @return array<string, mixed> */
    private function safeAuditData(): array
    {
        try {
            $data = $this->auditService->getAuditData([
                'limit'       => (string) self::EVENTS_LIMIT,
                'hours'       => (string) self::EVENTS_WINDOW_HOURS,
            ]);
            // Redact any raw_payload field before returning to dashboard.
            $health = $this->safeSubKey($data, 'health');
            $events = $this->redactEventPayloads($this->safeSubKey($data, 'audit_rows'));
            // Apply the same redaction to dead-letter rows — they may carry raw_payload
            // or other sensitive fields from the original message processing pipeline.
            $deadLetter = $this->redactEventPayloads($this->safeSubKey($data, 'dead_letter_rows'));
            return [
                'available'           => ($data['error'] ?? null) === null,
                'health'              => $health,
                'events'              => $events,
                'dead_letter_rows'    => $deadLetter,
                'dead_letter_available' => (bool) ($data['dead_letter_available'] ?? false),
                'error'               => $data['error'] ?? null,
            ];
        } catch (Throwable $e) {
            return [
                'available'           => false,
                'health'              => [],
                'events'              => [],
                'dead_letter_rows'    => [],
                'dead_letter_available' => false,
                'error'               => $this->sanitizeMessage($e->getMessage()),
            ];
        }
    }

    /** @return array<string, mixed> */
    private function safeAiSummary(): array
    {
        try {
            $data = $this->aiConfigService->getPageData();
            $settings = is_array($data['settings'] ?? null) ? $data['settings'] : [];
            $status   = is_array($data['status'] ?? null) ? $data['status'] : [];
            // Only return safe non-secret fields.
            return [
                'available'              => true,
                'supervisor_enabled'     => (bool) ($settings['ai_supervisor_enabled'] ?? false),
                'supervisor_provider'    => (string) ($settings['ai_supervisor_provider'] ?? 'disabled'),
                'supervisor_model'       => (string) ($settings['ai_supervisor_model'] ?? ''),
                'supervisor_dry_run'     => (bool) ($settings['ai_supervisor_dry_run'] ?? true),
                'supervisor_timeout_sec' => (int) ($settings['ai_supervisor_timeout_seconds'] ?? 0),
                'copilot_enabled'        => (bool) ($settings['copilot_enabled'] ?? false),
                'copilot_provider'       => (string) ($settings['copilot_provider'] ?? 'disabled'),
                'copilot_dry_run'        => (bool) ($settings['copilot_dry_run'] ?? true),
                'last_supervisor_status' => (string) ($status['supervisor_status'] ?? ''),
                'last_copilot_status'    => (string) ($status['copilot_status'] ?? ''),
                'circuit_breaker'        => is_array($status['circuit_breaker'] ?? null) ? $status['circuit_breaker'] : [],
                'error'                  => null,
            ];
        } catch (Throwable $e) {
            return [
                'available' => false,
                'error'     => $this->sanitizeMessage($e->getMessage()),
            ];
        }
    }

    /**
     * Compute the overall traffic light from consolidated sources.
     *
     * @param array<string, mixed> $node
     * @param array<string, mixed> $obs
     * @param array<string, mixed> $audit
     * @return array{status:string, label:string, reason:string}
     */
    private function computeTrafficLight(array $node, array $obs, array $audit): array
    {
        $isCritical = false;
        $isWarning  = false;
        $reasons    = [];

        // Node unavailable or unhealthy.
        if (!($node['available'] ?? false)) {
            $isCritical = true;
            $reasons[]  = __('integration-service indisponível.', 'glpiintegaglpi');
        } elseif (!($node['ok'] ?? false)) {
            $isWarning = true;
            $reasons[] = __('integration-service em atenção.', 'glpiintegaglpi');
        }

        // Observability cards.
        foreach ((array) ($obs['cards'] ?? []) as $card) {
            $s = strtolower((string) ($card['status'] ?? ''));
            if ($s === 'critical') {
                $isCritical = true;
                $reasons[]  = (string) ($card['label'] ?? 'card crítico');
            } elseif ($s === 'warning') {
                $isWarning = true;
                $reasons[] = (string) ($card['label'] ?? 'card atenção');
            }
        }

        // Audit health.
        $auditHealth = (array) ($audit['health'] ?? []);
        $auditStatus = strtolower((string) ($auditHealth['status'] ?? ''));
        if ($auditStatus === 'critical') {
            $isCritical = true;
            $reasons[] = (string) ($auditHealth['reason'] ?? 'auditoria crítica');
        } elseif ($auditStatus === 'warning') {
            $isWarning = true;
            $reasons[] = (string) ($auditHealth['reason'] ?? 'auditoria em atenção');
        }

        $status = $isCritical ? 'critical' : ($isWarning ? 'warning' : 'ok');
        $labels = [
            'critical' => __('Crítico', 'glpiintegaglpi'),
            'warning'  => __('Atenção', 'glpiintegaglpi'),
            'ok'       => __('OK', 'glpiintegaglpi'),
        ];

        return [
            'status' => $status,
            'label'  => $labels[$status],
            'reason' => implode(' | ', array_slice($reasons, 0, 3)),
        ];
    }

    /**
     * Build human-readable manual action recommendations (text only, no buttons).
     *
     * @param array<string, mixed> $audit
     * @param array<string, mixed> $obs
     * @param array<string, mixed> $diagn
     * @return list<string>
     */
    private function buildRecommendations(array $audit, array $obs, array $diagn): array
    {
        $recs = [];

        if (!empty($audit['dead_letter_available'])) {
            $recs[] = __('Dead-letter aberto — abrir Central de Eventos para revisão manual.', 'glpiintegaglpi');
        }

        $manifestStatus = (string) ($diagn['local_manifest']['status'] ?? '');
        if (in_array($manifestStatus, ['package_incomplete', 'missing', ''], true)) {
            $recs[] = __('Manifest ausente ou incompleto — conferir pacote de deploy e build_id.', 'glpiintegaglpi');
        }

        $rtConsistency = (string) ($diagn['runtime_consistency']['status'] ?? 'ok');
        if ($rtConsistency !== 'ok') {
            $recs[] = __('Inconsistência runtime plugin ↔ Node — conferir package_id e versão.', 'glpiintegaglpi');
        }

        // Check heartbeat age from audit health indicators.
        foreach ((array) ($audit['health']['indicators'] ?? []) as $ind) {
            if (($ind['key'] ?? '') === 'heartbeat' && in_array($ind['status'] ?? '', ['warning', 'critical'], true)) {
                $recs[] = __('Heartbeat antigo — verificar worker de inatividade/autoclose.', 'glpiintegaglpi');
                break;
            }
        }

        // Check delivery failed count.
        foreach ((array) ($audit['health']['indicators'] ?? []) as $ind) {
            if (($ind['key'] ?? '') === 'delivery_failed' && in_array($ind['status'] ?? '', ['warning', 'critical'], true)) {
                $recs[] = __('Falhas de entrega recentes — verificar Meta API errors e configuração de número.', 'glpiintegaglpi');
                break;
            }
        }

        // Node unavailable.
        if (!($obs['available'] ?? false)) {
            $recs[] = __('integration-service indisponível — verificar container Node, porta e PSK.', 'glpiintegaglpi');
        }

        if ($recs === []) {
            $recs[] = __('Sem ações urgentes identificadas. Continue o monitoramento periódico.', 'glpiintegaglpi');
        }

        return $recs;
    }

    private function detectEnvironment(): string
    {
        global $CFG_GLPI;
        $url = (string) ($CFG_GLPI['url_base'] ?? '');
        if (str_contains($url, 'homol') || str_contains($url, 'hom.') || str_contains($url, ':8080')) {
            return 'homologacao';
        }
        if (str_contains($url, 'localhost') || str_contains($url, '127.0.0.1')) {
            return 'local';
        }
        return 'producao';
    }

    /**
     * Remove raw_payload from event rows before sending to template.
     *
     * @param array<mixed> $rows
     * @return array<mixed>
     */
    private function redactEventPayloads(array $rows): array
    {
        return array_map(static function (mixed $row): mixed {
            if (!is_array($row)) {
                return $row;
            }
            unset($row['raw_payload'], $row['payload_json'], $row['body'], $row['raw_body']);
            return $row;
        }, $rows);
    }

    /** @return array<string, mixed> */
    private function nodeUnavailable(string $reason): array
    {
        return [
            'available' => false,
            'ok'        => false,
            'postgres'  => [],
            'redis'     => [],
            'glpi_api'  => [],
            'meta'      => [],
            'readiness' => [],
            'ai_runtime_config_summary' => [],
            'uptime_seconds' => null,
            'version'   => null,
            'error'     => $reason,
        ];
    }

    /**
     * Safely extract a sub-key that must be an array, returning [] on any mismatch.
     *
     * @param array<string, mixed> $data
     * @return array<mixed>
     */
    private function safeSubKey(array $data, string $key): array
    {
        $value = $data[$key] ?? [];
        return is_array($value) ? $value : [];
    }

    private function sanitizeMessage(string $message): string
    {
        // Strip any credential-like fragment before logging to UI.
        return (string) preg_replace(
            '/(bearer|token|secret|password|authorization|psk|app_token|api_key)\s*[:=]\s*\S+/i',
            '$1=[redacted]',
            mb_substr(strip_tags($message), 0, 240, 'UTF-8')
        );
    }
}
