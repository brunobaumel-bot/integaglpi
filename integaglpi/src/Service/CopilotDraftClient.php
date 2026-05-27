<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi\Service;

use GlpiPlugin\Integaglpi\External\ExternalDatabase;
use GlpiPlugin\Integaglpi\Plugin;
use RuntimeException;
use Throwable;

final class CopilotDraftClient
{
    private const PATH_COPILOT_DRAFT = '/internal/glpi/copilot/draft';
    private const COPILOT_DRAFT_TIMEOUT_MS = 8000;
    private const COPILOT_DRAFT_CONNECT_TIMEOUT_MS = 3000;
    private const AI_SETTINGS_CONTEXT = 'ai_settings';
    private const AI_SETTINGS_TABLE = 'glpi_plugin_integaglpi_configs';

    private ?PluginConfigService $pluginConfigService;

    public function __construct(?PluginConfigService $pluginConfigService = null)
    {
        $this->pluginConfigService = $pluginConfigService;
    }

    /**
     * @param array<string, mixed> $payload
     * @return array{status: int, body: array<string, mixed>, success: bool}
     */
    public function post(array $payload): array
    {
        if ((string) ($payload['action'] ?? '') === 'generate' && !isset($payload['runtime_config'])) {
            $payload['runtime_config'] = $this->effectiveCopilotRuntimeConfig();
        }

        return $this->postJson($this->endpoint(self::PATH_COPILOT_DRAFT), $payload);
    }

    /**
     * @param array<string, mixed> $payload
     * @return array{status: int, body: array<string, mixed>, success: bool}
     */
    public function createDraftJob(array $payload): array
    {
        $payload['action'] = 'generate_async';
        if (!isset($payload['runtime_config'])) {
            $payload['runtime_config'] = $this->effectiveCopilotRuntimeConfig();
        }

        return $this->postJson($this->endpoint(self::PATH_COPILOT_DRAFT), $payload);
    }

    /**
     * @param array<string, mixed> $payload
     * @return array{status: int, body: array<string, mixed>, success: bool}
     */
    public function getDraftJobStatus(array $payload): array
    {
        $payload['action'] = 'status';

        return $this->postJson($this->endpoint(self::PATH_COPILOT_DRAFT), $payload);
    }

    /**
     * @param array<string, mixed> $payload
     * @return array{status: int, body: array<string, mixed>, success: bool}
     */
    private function postJson(string $endpoint, array $payload): array
    {
        $json = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        if ($json === false) {
            throw new RuntimeException('[integaglpi][copilot] json_encode failed: ' . json_last_error_msg());
        }

        $ch = curl_init($endpoint);
        if ($ch === false) {
            throw new RuntimeException('[integaglpi][copilot] curl_init failed');
        }

        $requestId = bin2hex(random_bytes(8));
        $startedAt = microtime(true);
        $payloadSize = strlen($json);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER    => true,
            CURLOPT_TIMEOUT_MS        => self::COPILOT_DRAFT_TIMEOUT_MS,
            CURLOPT_CONNECTTIMEOUT_MS => self::COPILOT_DRAFT_CONNECT_TIMEOUT_MS,
            CURLOPT_POST              => true,
            CURLOPT_POSTFIELDS        => $json,
            CURLOPT_HTTPHEADER        => [
                'Content-Type: application/json',
                'Authorization: Bearer ' . $this->getAuthKey(),
            ],
        ]);

        $raw = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlErrNo = (int) curl_errno($ch);
        $curlError = curl_error($ch);
        curl_close($ch);
        $elapsedMs = (int) round((microtime(true) - $startedAt) * 1000);

        if ($raw === false || $curlError !== '') {
            $errorType = $curlErrNo === CURLE_OPERATION_TIMEDOUT ? 'timeout' : 'transport';
            $this->logRequest($requestId, $elapsedMs, $payloadSize, 0, $errorType);
            if ($errorType === 'timeout') {
                throw new RuntimeException('COPILOT_TIMEOUT');
            }

            throw new RuntimeException('[integaglpi][copilot] curl error: ' . $curlError);
        }

        $body = json_decode((string) $raw, true);
        if (!is_array($body)) {
            $body = [
                'message' => __('Resposta inesperada do integration-service.', 'glpiintegaglpi'),
            ];
        }

        if ($status < 200 || $status >= 300) {
            $this->logRequest($requestId, $elapsedMs, $payloadSize, $status, 'http_error');
        }

        return [
            'status' => $status,
            'body' => $body,
            'success' => $status >= 200 && $status < 300,
        ];
    }

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

        throw new RuntimeException('[integaglpi][copilot] integration auth key is not configured.');
    }

    private function endpoint(string $path): string
    {
        $configService = $this->pluginConfigService ?? new PluginConfigService();

        return rtrim($configService->getIntegrationServiceUrl(), '/') . $path;
    }

    private function logRequest(string $requestId, int $elapsedMs, int $payloadSize, int $status, string $errorType): void
    {
        error_log(sprintf(
            '[integaglpi][copilot][request] request_id=%s elapsed_ms=%d payload_size=%d timeout_ms=%d provider_mode=internal status=%d error_type=%s',
            $requestId,
            $elapsedMs,
            $payloadSize,
            self::COPILOT_DRAFT_TIMEOUT_MS,
            $status,
            preg_replace('/[^a-z0-9_:-]/i', '', $errorType) ?: 'unknown'
        ));
    }

    /**
     * @return array<string, mixed>
     */
    private function effectiveCopilotRuntimeConfig(): array
    {
        $supervisorTimeout = (int) $this->runtimeValue('AI_SUPERVISOR_TIMEOUT_SECONDS', '90');
        $provider = $this->normalizeProvider($this->aiSettingValue(
            'copilot_provider',
            $this->runtimeValue('COPILOT_PROVIDER', $this->runtimeValue('AI_SUPERVISOR_PROVIDER', 'disabled'))
        ));

        return [
            'enabled' => $this->truthy($this->aiSettingValue(
                'copilot_enabled',
                $this->runtimeValue('COPILOT_ENABLED', $this->runtimeValue('AI_SUPERVISOR_ENABLED', 'false'))
            )),
            'provider' => $provider,
            'model' => $this->normalizeSafeText($this->aiSettingValue(
                'copilot_model',
                $this->runtimeValue('AI_SUPERVISOR_MODEL', '')
            ), 120),
            'dry_run' => $this->truthy($this->aiSettingValue(
                'copilot_dry_run',
                $this->runtimeValue('COPILOT_DRY_RUN', $this->runtimeValue('AI_SUPERVISOR_DRY_RUN', 'true'))
            )),
            'max_chars' => $this->boundedInteger($this->aiSettingValue(
                'copilot_max_context_chars',
                $this->runtimeValue('AI_SUPERVISOR_MAX_CHARS', '6000')
            ), 1000, 12000, 6000),
            'timeout_ms' => $this->boundedInteger($this->aiSettingValue(
                'copilot_timeout_ms',
                (string) max(15000, $supervisorTimeout * 1000)
            ), 15000, 120000, self::COPILOT_DRAFT_TIMEOUT_MS),
            'source' => 'ai_settings_or_env',
            'no_auto_send' => true,
        ];
    }

    private function aiSettingValue(string $column, string $fallback): string
    {
        if (!preg_match('/^[a-z0-9_]+$/', $column)) {
            return trim($fallback);
        }

        $configService = $this->pluginConfigService ?? new PluginConfigService();
        if (!$configService->isConfigured()) {
            return trim($fallback);
        }

        try {
            $pdo = ExternalDatabase::getConnection($configService->getConnectionConfig());
            $exists = $pdo->prepare(
                'SELECT 1 FROM information_schema.columns
                  WHERE table_schema = current_schema()
                    AND table_name = :table
                    AND column_name = :column
                  LIMIT 1'
            );
            $exists->execute([
                ':table' => self::AI_SETTINGS_TABLE,
                ':column' => $column,
            ]);
            if (!$exists->fetchColumn()) {
                return trim($fallback);
            }

            $stmt = $pdo->prepare(
                'SELECT "' . $column . '" FROM public.' . self::AI_SETTINGS_TABLE . ' WHERE context = :context LIMIT 1'
            );
            $stmt->execute([':context' => self::AI_SETTINGS_CONTEXT]);
            $value = $stmt->fetchColumn();

            return $value === false || $value === null || trim((string) $value) === '' ? trim($fallback) : trim((string) $value);
        } catch (Throwable $exception) {
            error_log('[integaglpi][copilot][runtime_config] ' . $this->sanitizeLog($exception->getMessage()));

            return trim($fallback);
        }
    }

    private function runtimeValue(string $key, string $fallback): string
    {
        $value = Plugin::getRuntimeConfigValue($key);

        return $value !== '' ? $value : $fallback;
    }

    private function normalizeProvider(string $value): string
    {
        $provider = strtolower(trim($value));
        if ($provider === 'local') {
            return 'ollama';
        }

        return $provider === 'ollama' ? 'ollama' : 'disabled';
    }

    private function normalizeSafeText(string $value, int $limit): string
    {
        $value = trim(strip_tags($value));
        $value = preg_replace('/(password|senha|token|secret|bearer|api_key)\s*[:=]\s*\S+/i', '$1=[redacted]', $value) ?? '';
        $value = preg_replace('/[^A-Za-z0-9_.:\/-]+/', '', $value) ?? '';

        return substr($value, 0, $limit);
    }

    private function boundedInteger(string $value, int $min, int $max, int $default): int
    {
        $integer = (int) $value;
        if ($integer < $min || $integer > $max) {
            return $default;
        }

        return $integer;
    }

    private function truthy(string $value): bool
    {
        return in_array(strtolower(trim($value)), ['1', 'true', 'yes', 'on'], true);
    }

    private function sanitizeLog(string $message): string
    {
        $message = preg_replace('/(password|senha|token|secret|bearer|api_key)\s*[:=]\s*\S+/i', '$1=[redacted]', $message) ?? '';

        return mb_substr($message, 0, 220, 'UTF-8');
    }
}
