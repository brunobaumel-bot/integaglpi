<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi\Service;

use GlpiPlugin\Integaglpi\Plugin;
use Throwable;

/**
 * CentralHubViewService — F3 Central Hub Operacional
 *
 * PHP proxy between the GLPI front controller and the Node integration-service
 * endpoint GET /internal/glpi/central-hub.
 *
 * Safety invariants (F3 contract — ABSOLUTE):
 *   - Read-only: no INSERT / UPDATE / DELETE.
 *   - Bearer-gated: passes INTEGRATION_SERVICE_API_KEY as Authorization header.
 *   - Allowlisted response: only safe fields from the Node response are exposed
 *     to the template. No raw token, no IP, no phone, no credential.
 *   - Timeout: max 8 s curl connect + transfer to avoid hanging the GLPI page.
 *   - CENTRAL_HUB_ENABLED=false: feature_flag_enabled=false comes from Node;
 *     template renders a "desabilitado" badge when this is false.
 *   - On any error (curl, JSON, HTTP 4xx/5xx): returns a safe error payload
 *     so the template can render a degraded state without crashing.
 *
 * Phase: integaglpi_v9_central_hub_001 — F3_9
 */
final class CentralHubViewService
{
    private const CURL_TIMEOUT_S = 8;
    private const CURL_CONNECT_TIMEOUT_S = 3;

    public function __construct(private readonly PluginConfigService $pluginConfigService)
    {
    }

    /**
     * Fetch the Central Hub snapshot from the Node integration-service.
     *
     * @return array<string, mixed> Safe allowlisted payload for the template.
     */
    public function getHubSnapshot(): array
    {
        $nodeUrl = rtrim($this->pluginConfigService->getIntegrationServiceUrl(), '/')
            . '/internal/glpi/central-hub';
        $apiKey = $this->pluginConfigService->getIntegrationAuthKey();

        $ch = curl_init($nodeUrl);
        if ($ch === false) {
            return $this->errorPayload('curl_init_failed');
        }

        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_TIMEOUT        => self::CURL_TIMEOUT_S,
            CURLOPT_CONNECTTIMEOUT => self::CURL_CONNECT_TIMEOUT_S,
            CURLOPT_HTTPGET        => true,
            CURLOPT_USERAGENT      => 'GLPI-Integaglpi-CentralHub/1.0',
            CURLOPT_HTTPHEADER     => [
                'Authorization: Bearer ' . $apiKey,
                'Accept: application/json',
            ],
        ]);

        $raw   = curl_exec($ch);
        $errno = curl_errno($ch);
        $http  = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if ($raw === false || $errno !== 0) {
            return $this->errorPayload('integration_unreachable');
        }

        $body = json_decode((string) $raw, true);
        if (!is_array($body)) {
            return $this->errorPayload('invalid_json');
        }

        if ($http >= 400) {
            return $this->errorPayload('upstream_error_' . $http);
        }

        return $this->allowlist($body);
    }

    // ── Private ──────────────────────────────────────────────────────────────

    /**
     * Allowlist fields from the Node response.
     * Never passes raw tokens, credentials, IPs, MACs, phones.
     *
     * @param array<string, mixed> $body
     * @return array<string, mixed>
     */
    private function allowlist(array $body): array
    {
        $safe = [
            'ok'                   => true,
            'schema_version'       => (string) ($body['schema_version'] ?? '1.0'),
            'phase'                => (string) ($body['phase'] ?? ''),
            'generated_at'         => (string) ($body['generated_at'] ?? ''),
            'feature_flag_enabled' => (bool) ($body['feature_flag_enabled'] ?? false),
            'readonly_note'        => (string) ($body['readonly_note'] ?? ''),
            'cards'                => [],
        ];

        $cards = $body['cards'] ?? [];
        if (!is_array($cards)) {
            $cards = [];
        }

        $safe['cards']['saude_hml']  = $this->allowlistCardSaude($cards['saude_hml'] ?? []);
        $safe['cards']['smart_help'] = $this->allowlistCardSmartHelp($cards['smart_help'] ?? []);
        $safe['cards']['kb_quality'] = $this->allowlistCardKbQuality($cards['kb_quality'] ?? []);
        $safe['cards']['logmein']    = $this->allowlistCardLogmein($cards['logmein'] ?? []);
        $safe['cards']['alarmes']    = $this->allowlistCardAlarmes($cards['alarmes'] ?? []);

        return $safe;
    }

    /**
     * @param mixed $raw
     * @return array<string, mixed>
     */
    private function allowlistCard(mixed $raw): array
    {
        if (!is_array($raw)) {
            return ['ok' => false, 'data' => null, 'error' => 'missing_card', 'latency_ms' => 0];
        }
        return [
            'ok'         => (bool) ($raw['ok'] ?? false),
            'error'      => is_string($raw['error'] ?? null) ? (string) $raw['error'] : null,
            'latency_ms' => (int) ($raw['latency_ms'] ?? 0),
        ];
    }

    /**
     * @param mixed $raw
     * @return array<string, mixed>
     */
    private function allowlistCardSaude(mixed $raw): array
    {
        $base = $this->allowlistCard($raw);
        $data = is_array($raw) && is_array($raw['data'] ?? null) ? $raw['data'] : null;

        if ($data !== null) {
            $base['data'] = [
                'postgres_ok'      => (bool) ($data['postgres_ok'] ?? false),
                'postgres_latency' => isset($data['postgres_latency_ms']) ? (int) $data['postgres_latency_ms'] : null,
                'redis_ok'         => (bool) ($data['redis_ok'] ?? false),
                'redis_status'     => (string) ($data['redis_status'] ?? 'unknown'),
                'ollama_configured'=> (bool) ($data['ollama_configured'] ?? false),
                'ollama_provider'  => (string) ($data['ollama_provider'] ?? 'disabled'),
                'uptime_seconds'   => (int) ($data['uptime_seconds'] ?? 0),
                'workers_ai'       => (bool) ($data['workers_ai_enabled'] ?? false),
                'meta_configured'  => (bool) ($data['meta_configured'] ?? false),
                'glpi_configured'  => (bool) ($data['glpi_configured'] ?? false),
            ];
        } else {
            $base['data'] = null;
        }

        return $base;
    }

    /**
     * @param mixed $raw
     * @return array<string, mixed>
     */
    private function allowlistCardSmartHelp(mixed $raw): array
    {
        $base = $this->allowlistCard($raw);
        $data = is_array($raw) && is_array($raw['data'] ?? null) ? $raw['data'] : null;

        if ($data !== null) {
            $base['data'] = [
                'ai_supervisor_enabled'  => (bool) ($data['ai_supervisor_enabled'] ?? false),
                'ai_supervisor_provider' => (string) ($data['ai_supervisor_provider'] ?? 'disabled'),
                'ai_supervisor_model'    => is_string($data['ai_supervisor_model'] ?? null)
                    ? (string) $data['ai_supervisor_model'] : null,
                'copilot_enabled'        => (bool) ($data['copilot_enabled'] ?? false),
                'copilot_provider'       => (string) ($data['copilot_provider'] ?? 'disabled'),
                'cloud_enabled'          => false, // Always false per F3 safety invariant
                'pii_guard_note'         => (string) ($data['pii_guard_note'] ?? ''),
            ];
        } else {
            $base['data'] = null;
        }

        return $base;
    }

    /**
     * @param mixed $raw
     * @return array<string, mixed>
     */
    private function allowlistCardKbQuality(mixed $raw): array
    {
        $base = $this->allowlistCard($raw);
        $data = is_array($raw) && is_array($raw['data'] ?? null) ? $raw['data'] : null;

        if ($data !== null) {
            $topGaps = [];
            if (is_array($data['top_gap_categories'] ?? null)) {
                foreach ((array) $data['top_gap_categories'] as $cat) {
                    if (is_string($cat)) {
                        $topGaps[] = htmlspecialchars($cat, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
                    }
                }
            }

            $base['data'] = [
                'golden_set_total'       => (int) ($data['golden_set_total_queries'] ?? 0),
                'product_detection_rate' => isset($data['product_detection_rate_baseline'])
                    ? (float) $data['product_detection_rate_baseline'] : null,
                'tier_coverage_rate'     => isset($data['tier_coverage_rate_baseline'])
                    ? (float) $data['tier_coverage_rate_baseline'] : null,
                'total_votes'            => (int) ($data['total_votes_period'] ?? 0),
                'helpful_ratio'          => isset($data['overall_helpful_ratio'])
                    ? (float) $data['overall_helpful_ratio'] : null,
                'articles_with_votes'    => (int) ($data['articles_with_votes'] ?? 0),
                'top_gap_categories'     => $topGaps,
                'period_days'            => (int) ($data['period_days'] ?? 30),
            ];
        } else {
            $base['data'] = null;
        }

        return $base;
    }

    /**
     * @param mixed $raw
     * @return array<string, mixed>
     */
    private function allowlistCardLogmein(mixed $raw): array
    {
        $base = $this->allowlistCard($raw);
        $data = is_array($raw) && is_array($raw['data'] ?? null) ? $raw['data'] : null;

        if ($data !== null) {
            $alarmTypes = [];
            if (is_array($data['alarm_types_monitored'] ?? null)) {
                foreach ((array) $data['alarm_types_monitored'] as $t) {
                    if (is_string($t)) {
                        $alarmTypes[] = htmlspecialchars($t, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
                    }
                }
            }

            $base['data'] = [
                'total_hosts'              => (int) ($data['total_hosts'] ?? 0),
                'hosts_without_tag'        => (int) ($data['hosts_without_tag'] ?? 0),
                'groups_without_entity'    => (int) ($data['groups_without_entity'] ?? 0),
                'last_sync_status'         => is_string($data['last_sync_status'] ?? null)
                    ? (string) $data['last_sync_status'] : null,
                'last_sync_at'             => is_string($data['last_sync_at'] ?? null)
                    ? (string) $data['last_sync_at'] : null,
                'cache_age_hours'          => isset($data['cache_age_hours'])
                    ? (float) $data['cache_age_hours'] : null,
                'enabled_rules'            => (int) ($data['enabled_rules'] ?? 0),
                'alarm_types_monitored'    => $alarmTypes,
            ];
        } else {
            $base['data'] = null;
        }

        return $base;
    }

    /**
     * @param mixed $raw
     * @return array<string, mixed>
     */
    private function allowlistCardAlarmes(mixed $raw): array
    {
        $base = $this->allowlistCard($raw);
        $data = is_array($raw) && is_array($raw['data'] ?? null) ? $raw['data'] : null;

        if ($data !== null) {
            $byType = is_array($data['by_result_type'] ?? null) ? $data['by_result_type'] : [];
            $recentTypes = [];
            if (is_array($data['recent_alarm_types'] ?? null)) {
                foreach ((array) $data['recent_alarm_types'] as $t) {
                    if (is_string($t)) {
                        $recentTypes[] = htmlspecialchars($t, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
                    }
                }
            }

            $base['data'] = [
                'period_days'          => (int) ($data['period_days'] ?? 7),
                'total_events'         => (int) ($data['total_events'] ?? 0),
                'fired'                => (int) ($byType['fired'] ?? 0),
                'suppressed_cooldown'  => (int) ($byType['suppressed_cooldown'] ?? 0),
                'suppressed_dedupe'    => (int) ($byType['suppressed_dedupe'] ?? 0),
                'ticket_created'       => (int) ($byType['ticket_created'] ?? 0),
                'dry_run'              => (int) ($byType['dry_run'] ?? 0),
                'recent_alarm_types'   => $recentTypes,
            ];
        } else {
            $base['data'] = null;
        }

        return $base;
    }

    /**
     * @return array<string, mixed>
     */
    private function errorPayload(string $reason): array
    {
        return [
            'ok'                   => false,
            'error'                => $reason,
            'feature_flag_enabled' => false,
            'schema_version'       => '1.0',
            'phase'                => 'integaglpi_v9_central_hub_001',
            'generated_at'         => '',
            'readonly_note'        => '',
            'cards'                => [],
        ];
    }
}
