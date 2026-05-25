<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi\Service;

use GlpiPlugin\Integaglpi\Plugin;
use RuntimeException;

final class IntegrationServiceClient
{
    private const PATH_OUTBOUND = '/internal/glpi/messages/outbound';
    private const PATH_TICKET_SOLVED = '/internal/glpi/notifications/ticket-solved';
    private const PATH_CONVERSATION_ENTITY = '/internal/glpi/conversations/%s/entity';
    private const PATH_CONVERSATION_SOFT_CLOSE = '/internal/glpi/conversations/%s/soft-close';
    private const PATH_DIAGNOSTICS = '/internal/glpi/diagnostics';
    private const PATH_QUALITY_DASHBOARD = '/internal/glpi/quality-dashboard';
    private const PATH_OBSERVABILITY = '/internal/glpi/observability';
    private const PATH_CONTACT_AGENDA_IMPORT_PREVIEW = '/internal/glpi/contact-agenda/import/preview';
    private const PATH_CONTACT_AGENDA_IMPORT_STATUS = '/internal/glpi/contact-agenda/import/%s';
    private const PATH_CONTACT_AGENDA_IMPORT_CONFIRM = '/internal/glpi/contact-agenda/import/%s/confirm';
    private const PATH_CONTACT_AGENDA_IMPORT_ROLLBACK = '/internal/glpi/contact-agenda/import/%s/rollback';
    private const PATH_MANUAL_TICKET_WHATSAPP_RESOLVE = '/internal/glpi/manual-ticket-whatsapp/%d/resolve';
    private const PATH_MANUAL_TICKET_WHATSAPP_START_TEMPLATE = '/internal/glpi/manual-ticket-whatsapp/%d/start-template';
    private const PATH_AI_QUALITY_ANALYZE = '/internal/glpi/ai-quality/analyze';
    private const PATH_AI_QUALITY_FEEDBACK = '/internal/glpi/ai-quality/feedback';
    private const PATH_HISTORICAL_MINING_PREVIEW = '/internal/glpi/historical-mining/preview';
    private const PATH_HISTORICAL_MINING_EXECUTE = '/internal/glpi/historical-mining/execute';
    private const PATH_KB_CANDIDATES_GENERATE = '/internal/glpi/kb-candidates/generate';
    private const TIMEOUT_SECONDS   = 5;
    private const ENTITY_SELECTION_TIMEOUT_SECONDS = 8;
    private const AI_QUALITY_ANALYZE_TIMEOUT_SECONDS = 75;

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
    public function confirmConversationEntity(string $conversationId, array $payload): array
    {
        $path = sprintf(self::PATH_CONVERSATION_ENTITY, rawurlencode($conversationId));

        return $this->postJson(
            $this->endpoint($path),
            $payload,
            'entity_selection',
            self::ENTITY_SELECTION_TIMEOUT_SECONDS
        );
    }

    /**
     * @return array{status: int, body: array<string, mixed>, success: bool}
     */
    public function getConversationEntityStatus(string $conversationId): array
    {
        $path = sprintf(self::PATH_CONVERSATION_ENTITY, rawurlencode($conversationId));

        return $this->getJson($this->endpoint($path), 'entity_selection][status', self::TIMEOUT_SECONDS);
    }

    /**
     * @param array<string, mixed> $payload
     * @return array{status: int, body: array<string, mixed>, success: bool}
     */
    public function softCloseConversation(string $conversationId, array $payload): array
    {
        $path = sprintf(self::PATH_CONVERSATION_SOFT_CLOSE, rawurlencode($conversationId));

        return $this->postJson($this->endpoint($path), $payload, 'conversation][soft_close');
    }

    /**
     * @param array<string, mixed> $payload
     * @return array{status: int, body: array<string, mixed>, success: bool}
     */
    public function requestAiQualityAnalysis(array $payload): array
    {
        return $this->postJson(
            $this->endpoint(self::PATH_AI_QUALITY_ANALYZE),
            $payload,
            'ai_quality][analyze',
            self::AI_QUALITY_ANALYZE_TIMEOUT_SECONDS
        );
    }

    /**
     * @param array<string, mixed> $payload
     * @return array{status: int, body: array<string, mixed>, success: bool}
     */
    public function submitAiQualityFeedback(array $payload): array
    {
        return $this->postJson($this->endpoint(self::PATH_AI_QUALITY_FEEDBACK), $payload, 'ai_quality][feedback');
    }

    /**
     * @return array{status: int, body: array<string, mixed>, success: bool}
     */
    public function getDiagnostics(): array
    {
        return $this->getJson($this->endpoint(self::PATH_DIAGNOSTICS), 'diagnostics', 5);
    }

    /**
     * @param array<string, mixed> $payload
     * @return array{status: int, body: array<string, mixed>, success: bool}
     */
    public function previewHistoricalMining(array $payload): array
    {
        return $this->postJson($this->endpoint(self::PATH_HISTORICAL_MINING_PREVIEW), $payload, 'historical_mining][preview', 30);
    }

    /**
     * @param array<string, mixed> $payload
     * @return array{status: int, body: array<string, mixed>, success: bool}
     */
    public function executeHistoricalMining(array $payload): array
    {
        return $this->postJson($this->endpoint(self::PATH_HISTORICAL_MINING_EXECUTE), $payload, 'historical_mining][execute', 60);
    }

    /**
     * @param array<string, mixed> $payload
     * @return array{status: int, body: array<string, mixed>, success: bool}
     */
    public function generateKbCandidatesFromHistory(array $payload): array
    {
        return $this->postJson($this->endpoint(self::PATH_KB_CANDIDATES_GENERATE), $payload, 'kb_candidates][generate', 60);
    }

    /**
     * @param array<string, mixed> $filters
     * @return array{status: int, body: array<string, mixed>, success: bool}
     */
    public function getQualityDashboard(array $filters): array
    {
        $query = http_build_query(array_filter(
            $filters,
            static fn (mixed $value): bool => $value !== null && $value !== '' && $value !== []
        ));
        $path = self::PATH_QUALITY_DASHBOARD . ($query !== '' ? '?' . $query : '');

        return $this->getJson($this->endpoint($path), 'quality_dashboard', 8);
    }

    /**
     * @param array<string, mixed> $filters
     * @return array{status: int, body: array<string, mixed>, success: bool}
     */
    public function getObservability(array $filters): array
    {
        $query = http_build_query(array_filter(
            $filters,
            static fn (mixed $value): bool => $value !== null && $value !== '' && $value !== []
        ));
        $path = self::PATH_OBSERVABILITY . ($query !== '' ? '?' . $query : '');

        return $this->getJson($this->endpoint($path), 'observability', 8);
    }

    /**
     * @param array<string, mixed> $payload
     * @return array{status: int, body: array<string, mixed>, success: bool}
     */
    public function previewContactAgendaImport(array $payload): array
    {
        return $this->postJson($this->endpoint(self::PATH_CONTACT_AGENDA_IMPORT_PREVIEW), $payload, 'contact_import][preview', 20);
    }

    /**
     * @param array<string, mixed> $payload
     * @return array{status: int, body: array<string, mixed>, success: bool}
     */
    public function confirmContactAgendaImport(string $batchId, array $payload): array
    {
        $path = sprintf(self::PATH_CONTACT_AGENDA_IMPORT_CONFIRM, rawurlencode($batchId));

        return $this->postJson($this->endpoint($path), $payload, 'contact_import][confirm', 60);
    }

    /**
     * @return array{status: int, body: array<string, mixed>, success: bool}
     */
    public function getContactAgendaImportStatus(string $batchId): array
    {
        $path = sprintf(self::PATH_CONTACT_AGENDA_IMPORT_STATUS, rawurlencode($batchId));

        return $this->getJson($this->endpoint($path), 'contact_import][status', 10);
    }

    /**
     * @param array<string, mixed> $payload
     * @return array{status: int, body: array<string, mixed>, success: bool}
     */
    public function rollbackContactAgendaImport(string $batchId, array $payload): array
    {
        $path = sprintf(self::PATH_CONTACT_AGENDA_IMPORT_ROLLBACK, rawurlencode($batchId));

        return $this->postJson($this->endpoint($path), $payload, 'contact_import][rollback', 60);
    }

    /**
     * @param array<string, mixed> $payload
     * @return array{status: int, body: array<string, mixed>, success: bool}
     */
    public function resolveManualTicketWhatsapp(int $ticketId, array $payload): array
    {
        $path = sprintf(self::PATH_MANUAL_TICKET_WHATSAPP_RESOLVE, $ticketId);

        return $this->postJson($this->endpoint($path), $payload, 'manual_ticket_whatsapp][resolve', 10);
    }

    /**
     * @param array<string, mixed> $payload
     * @return array{status: int, body: array<string, mixed>, success: bool}
     */
    public function startManualTicketWhatsappTemplate(int $ticketId, array $payload): array
    {
        $path = sprintf(self::PATH_MANUAL_TICKET_WHATSAPP_START_TEMPLATE, $ticketId);

        try {
            return $this->postJson($this->endpoint($path), $payload, 'manual_ticket_whatsapp][start_template', 20);
        } catch (RuntimeException $exception) {
            if (!$this->isCurlTimeout($exception)) {
                throw $exception;
            }

            error_log('[integaglpi][manual_ticket_whatsapp][start_template][TIMEOUT_PENDING] ticket_id=' . $ticketId
                . ' idempotency_key=' . ($payload['idempotency_key'] ?? ''));

            return [
                'status' => 202,
                'success' => true,
                'body' => [
                    'ok' => true,
                    'status' => 'processing',
                    'message' => __('Envio em processamento. Verifique a conversa em alguns segundos antes de tentar novamente.', 'glpiintegaglpi'),
                    'idempotency_key' => (string) ($payload['idempotency_key'] ?? ''),
                ],
            ];
        }
    }

    /**
     * @return array{status: int, body: array<string, mixed>, success: bool}
     */
    private function getJson(string $endpoint, string $logContext, int $timeoutSeconds): array
    {
        $ch = curl_init($endpoint);
        if ($ch === false) {
            throw new RuntimeException('[integaglpi][' . $logContext . '] curl_init failed');
        }

        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => $timeoutSeconds,
            CURLOPT_HTTPGET        => true,
            CURLOPT_HTTPHEADER     => [
                'Accept: application/json',
                'Authorization: Bearer ' . $this->getAuthKey(),
            ],
        ]);

        $raw    = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlError = curl_error($ch);
        curl_close($ch);

        if ($raw === false || $curlError !== '') {
            error_log('[integaglpi][' . $logContext . '][ERROR] curl_error=' . $curlError);
            if ($logContext === 'ai_quality][analyze' && $this->isTimeoutMessage($curlError)) {
                throw new RuntimeException(__('A análise IA demorou mais que o esperado. Tente novamente ou reduza o contexto.', 'glpiintegaglpi'));
            }

            throw new RuntimeException('[integaglpi][' . $logContext . '] curl error: ' . $curlError);
        }

        $body = json_decode((string) $raw, true);
        if (!is_array($body)) {
            $body = [
                'message' => __('Resposta inesperada não JSON do integration-service.', 'glpiintegaglpi'),
            ];
        }

        $success = $status >= 200 && $status < 300;

        return [
            'status'  => $status,
            'body'    => $body,
            'success' => $success,
        ];
    }

    /**
     * @param array<string, mixed> $payload
     * @return array{status: int, body: array<string, mixed>, success: bool}
     */
    private function postJson(string $endpoint, array $payload, string $logContext, ?int $timeoutSeconds = null): array
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
            CURLOPT_TIMEOUT        => $timeoutSeconds ?? self::TIMEOUT_SECONDS,
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
     *   1. Plugin configuration column `integration_auth_key` (preferred - admin manages via UI).
     *   2. Runtime config `INTEGRATION_SERVICE_API_KEY`: getenv(), PHP constant, CFG_GLPI plugin array
     *      or PLUGIN_INTEGAGLPI_CONFIG. This bridges PHP-FPM/LSWS environments where getenv() is not
     *      populated.
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

        $runtimeKey = Plugin::getRuntimeConfigValue('INTEGRATION_SERVICE_API_KEY');
        if ($runtimeKey !== '') {
            return $runtimeKey;
        }

        throw new RuntimeException(
            '[integaglpi][outbound] integration auth key is not configured. '
            . 'Set it in the plugin configuration page (integration_auth_key) '
            . 'or configure INTEGRATION_SERVICE_API_KEY in the PHP runtime config.'
        );
    }

    private function endpoint(string $path): string
    {
        $configService = $this->pluginConfigService ?? new PluginConfigService();

        return rtrim($configService->getIntegrationServiceUrl(), '/') . $path;
    }

    private function isCurlTimeout(RuntimeException $exception): bool
    {
        return $this->isTimeoutMessage($exception->getMessage());
    }

    private function isTimeoutMessage(string $message): bool
    {
        $message = strtolower($message);

        return strpos($message, 'timed out') !== false
            || strpos($message, 'timeout') !== false
            || strpos($message, 'operation timed out') !== false;
    }
}
