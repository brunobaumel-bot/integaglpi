<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi\Service;

use RuntimeException;

final class IntegrationServiceClient
{
    private const PATH_OUTBOUND = '/internal/glpi/messages/outbound';
    private const PATH_TICKET_SOLVED = '/internal/glpi/notifications/ticket-solved';
    private const TIMEOUT_SECONDS   = 5;

    public function __construct(private readonly ?PluginConfigService $pluginConfigService = null)
    {
    }

    /**
     * Sends an outbound message via the integration-service (Node.js).
     * PHP never talks to Meta directly — only Node does.
     *
     * @param array<string, mixed> $payload
     * @return array{status: int, body: array<string, mixed>, success: bool}
     */
    public function sendOutbound(array $payload): array
    {
        return $this->postJson($this->endpoint(self::PATH_OUTBOUND), $payload, 'outbound');
    }

    /**
     * Sends a solved-ticket notification request to Node. Node decides whether
     * Meta interactive buttons are available and falls back to text if needed.
     *
     * @param array<string, mixed> $payload
     * @return array{status: int, body: array<string, mixed>, success: bool}
     */
    public function sendTicketSolvedNotification(array $payload): array
    {
        return $this->postJson($this->endpoint(self::PATH_TICKET_SOLVED), $payload, 'notification][ticket_solved');
    }

    /**
     * @param array<string, mixed> $payload
     * @return array{status: int, body: array<string, mixed>, success: bool}
     */
    private function postJson(string $endpoint, array $payload, string $logContext): array
    {
        error_log('[integaglpi][' . $logContext . '][REQUEST] endpoint=' . $endpoint
            . ' keys=' . json_encode(array_keys($payload), JSON_UNESCAPED_UNICODE));

        $json = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        if ($json === false) {
            throw new RuntimeException('[integaglpi][' . $logContext . '] json_encode failed: ' . json_last_error_msg());
        }

        $ch = curl_init($endpoint);
        if ($ch === false) {
            throw new RuntimeException('[integaglpi][' . $logContext . '] curl_init failed');
        }

        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => self::TIMEOUT_SECONDS,
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => $json,
            CURLOPT_HTTPHEADER     => [
                'Content-Type: application/json',
                'Authorization: Bearer ' . $this->getAuthKey(),
            ],
        ]);

        error_log('[integaglpi][' . $logContext . '][SEND] conversation_id=' . ($payload['conversation_id'] ?? '')
            . ' ticket_id=' . ($payload['ticket_id'] ?? '')
            . ' idempotency_key=' . ($payload['idempotency_key'] ?? ''));

        $raw    = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlError = curl_error($ch);
        curl_close($ch);

        if ($raw === false || $curlError !== '') {
            error_log('[integaglpi][' . $logContext . '][ERROR] curl_error=' . $curlError);
            throw new RuntimeException('[integaglpi][' . $logContext . '] curl error: ' . $curlError);
        }

        $body = json_decode((string) $raw, true);
        if (!is_array($body)) {
            $body = [
                'message' => __('Resposta inesperada não JSON do integration-service.', 'glpiintegaglpi'),
                'raw_excerpt' => substr((string) $raw, 0, 200),
            ];
        }

        $success = $status >= 200 && $status < 300;

        if (!$success) {
            if ($status === 401) {
                $body['message'] = __('integration-service retornou HTTP 401: verifique URL e chave.', 'glpiintegaglpi');
            } elseif (!isset($body['message'])) {
                $body['message'] = sprintf(__('integration-service retornou HTTP %d.', 'glpiintegaglpi'), $status);
            }

            error_log('[integaglpi][' . $logContext . '][ERROR] http_status=' . $status . ' body_excerpt=' . substr((string) $raw, 0, 500));
        }

        return [
            'status'  => $status,
            'body'    => $body,
            'success' => $success,
        ];
    }

    /**
     * Resolution order for the integration-service auth key:
     *   1. Plugin configuration column `integration_auth_key` (preferred — admin manages via UI).
     *   2. Process environment `INTEGRATION_SERVICE_API_KEY` (matches Node `.env`, eases migration
     *      from the previous hardcoded constant — operator just needs the same value already in `.env`).
     *
     * The hardcoded constant `super_chave_forte_*` was removed in Phase 7.4C. Operators upgrading
     * from earlier installs must set the value via the config form OR ensure the PHP-FPM/LSWS
     * environment exposes `INTEGRATION_SERVICE_API_KEY` (already present in `.env`). When neither is
     * available, sendOutbound() raises a RuntimeException instead of silently sending an empty
     * Bearer header to Node.
     */
    private function getAuthKey(): string
    {
        $configService = $this->pluginConfigService ?? new PluginConfigService();
        $configured = trim($configService->getIntegrationAuthKey());
        if ($configured !== '') {
            return $configured;
        }

        $envKey = trim((string) getenv('INTEGRATION_SERVICE_API_KEY'));
        if ($envKey !== '') {
            return $envKey;
        }

        throw new RuntimeException(
            '[integaglpi][outbound] integration auth key is not configured. '
            . 'Set it in the plugin configuration page (integration_auth_key) '
            . 'or expose INTEGRATION_SERVICE_API_KEY to the PHP environment.'
        );
    }

    private function endpoint(string $path): string
    {
        $configService = $this->pluginConfigService ?? new PluginConfigService();

        return rtrim($configService->getIntegrationServiceUrl(), '/') . $path;
    }
}
