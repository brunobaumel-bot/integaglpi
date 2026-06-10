<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi\Service;

use GlpiPlugin\Integaglpi\External\ExternalDatabase;
use GlpiPlugin\Integaglpi\Plugin;
use RuntimeException;
use Throwable;

final class AiCloudProviderException extends RuntimeException
{
    /** @var array<string, mixed> */
    private array $diagnostics;

    /**
     * @param array<string, mixed> $diagnostics
     */
    public function __construct(string $errorType, array $diagnostics = [])
    {
        parent::__construct($errorType);
        $this->diagnostics = $diagnostics;
    }

    /**
     * @return array<string, mixed>
     */
    public function diagnostics(): array
    {
        return $this->diagnostics;
    }
}

final class AiSecretVaultService
{
    private const TABLE = 'glpi_plugin_integaglpi_ai_secret_vault';
    private const ALLOWED_PROVIDERS = ['openai', 'anthropic', 'gemini', 'deepseek', 'xai'];
    private const PROVIDER_ALIASES = [
        'google' => 'gemini',
        'google_gemini' => 'gemini',
    ];
    private const CIPHER = 'aes-256-gcm';
    private const SYNTHETIC_PROMPT = 'Responda apenas OK em JSON: {"ok":true}';
    private const DEFAULT_TEST_MODELS = [
        'openai' => 'gpt-4o-mini',
        'anthropic' => 'claude-3-5-haiku-20241022',
        'gemini' => 'gemini-2.5-flash',
        'deepseek' => 'deepseek-chat',
        'xai' => 'grok-3-mini',
    ];

    private PluginConfigService $pluginConfigService;

    public function __construct(PluginConfigService $pluginConfigService)
    {
        $this->pluginConfigService = $pluginConfigService;
    }

    /**
     * @return array<string, mixed>
     */
    public function status(): array
    {
        $providers = [];
        foreach (self::ALLOWED_PROVIDERS as $provider) {
            $providers[$provider] = [
                'provider' => $provider,
                'configured' => false,
                'fingerprint' => '',
                'label' => '',
                'last_tested_at' => '',
                'last_test_status' => 'not_tested',
                'last_error_type' => 'not_tested',
            ];
        }

        $status = [
            'table_available' => $this->tableExists(),
            'master_key_configured' => $this->masterKey() !== null,
            'locked' => false,
            'providers' => $providers,
        ];
        $status['locked'] = !$status['table_available'] || !$status['master_key_configured'];

        if (!$status['table_available']) {
            return $status;
        }

        try {
            $stmt = ExternalDatabase::getConnection($this->pluginConfigService->getConnectionConfig())->query(
                'SELECT provider, secret_fingerprint, label, last_tested_at, last_test_status
                   FROM public.' . self::TABLE . '
                  WHERE is_active = TRUE
                  ORDER BY updated_at ASC'
            );
            if ($stmt === false) {
                return $status;
            }

            while (($row = $stmt->fetch(\PDO::FETCH_ASSOC)) !== false) {
                if (!is_array($row)) {
                    continue;
                }
                $provider = $this->normalizeProvider($row['provider'] ?? '');
                if ($provider === '') {
                    continue;
                }
                $status['providers'][$provider] = [
                    'provider' => $provider,
                    'configured' => true,
                    'fingerprint' => $this->maskFingerprint((string) ($row['secret_fingerprint'] ?? '')),
                    'label' => $this->sanitizeLabel((string) ($row['label'] ?? '')),
                    'last_tested_at' => (string) ($row['last_tested_at'] ?? ''),
                    'last_test_status' => (string) ($row['last_test_status'] ?? 'not_tested'),
                    'last_error_type' => $this->statusToErrorType((string) ($row['last_test_status'] ?? 'not_tested')),
                ];
            }
        } catch (Throwable $exception) {
            error_log('[integaglpi][ai_secret_vault][status] ' . $this->sanitizeLog($exception->getMessage()));
        }

        return $status;
    }

    public function storeSecret(string $provider, string $secret, string $label, int $userId): void
    {
        $provider = $this->normalizeProvider($provider);
        if ($provider === '') {
            throw new RuntimeException(__('Provider cloud inválido para Secret Vault.', 'glpiintegaglpi'));
        }
        $secret = trim($secret);
        if ($secret === '' || strlen($secret) < 12 || strlen($secret) > 4096) {
            throw new RuntimeException(__('Informe uma API key válida para armazenar no cofre.', 'glpiintegaglpi'));
        }
        if (!$this->tableExists()) {
            throw new RuntimeException(__('Secret Vault indisponível. Execute a migration 039 em TESTE.', 'glpiintegaglpi'));
        }

        $masterKey = $this->masterKey();
        if ($masterKey === null) {
            throw new RuntimeException(__('Secret Vault bloqueado: configure INTEGAGLPI_AI_VAULT_MASTER_KEY no ambiente/ops.', 'glpiintegaglpi'));
        }

        $encrypted = $this->encryptSecret($secret, $masterKey);
        $fingerprint = hash('sha256', $provider . ':' . $secret);
        $safeLabel = $this->sanitizeLabel($label);
        $pdo = ExternalDatabase::getConnection($this->pluginConfigService->getConnectionConfig());
        $pdo->beginTransaction();
        try {
            $deactivate = $pdo->prepare(
                'UPDATE public.' . self::TABLE . '
                    SET is_active = FALSE,
                        updated_by = :updated_by,
                        updated_at = NOW()
                  WHERE provider = :provider
                    AND is_active = TRUE'
            );
            $deactivate->execute([
                ':provider' => $provider,
                ':updated_by' => max(0, $userId),
            ]);

            $insert = $pdo->prepare(
                'INSERT INTO public.' . self::TABLE . ' (
                    provider,
                    encrypted_secret,
                    secret_fingerprint,
                    label,
                    is_active,
                    created_by,
                    created_at,
                    updated_by,
                    updated_at,
                    last_test_status
                ) VALUES (
                    :provider,
                    :encrypted_secret,
                    :secret_fingerprint,
                    :label,
                    TRUE,
                    :created_by,
                    NOW(),
                    :updated_by,
                    NOW(),
                    :last_test_status
                )'
            );
            $insert->execute([
                ':provider' => $provider,
                ':encrypted_secret' => $encrypted,
                ':secret_fingerprint' => $fingerprint,
                ':label' => $safeLabel,
                ':created_by' => max(0, $userId),
                ':updated_by' => max(0, $userId),
                ':last_test_status' => 'not_tested',
            ]);
            $pdo->commit();
        } catch (Throwable $exception) {
            $pdo->rollBack();
            throw $exception;
        }
    }

    public function configuredFor(string $provider): bool
    {
        $status = $this->status();
        $providers = is_array($status['providers'] ?? null) ? $status['providers'] : [];
        $provider = $this->normalizeProvider($provider);
        $row = is_array($providers[$provider] ?? null) ? $providers[$provider] : [];

        return !empty($row['configured']);
    }

    /**
     * @return array{provider: string, model: string, status: string, error_type: string, elapsed_ms: int, response_hash: string}
     */
    public function testProvider(string $provider, string $model, int $userId): array
    {
        $provider = $this->normalizeProvider($provider);
        if ($provider === '') {
            throw new RuntimeException('provider_not_allowed');
        }
        if (!$this->tableExists()) {
            throw new RuntimeException('secret_vault_table_missing');
        }
        $masterKey = $this->masterKey();
        if ($masterKey === null) {
            throw new RuntimeException('secret_vault_locked');
        }

        $row = $this->activeSecretRow($provider);
        if ($row === []) {
            throw new RuntimeException('secret_not_configured');
        }

        $secret = $this->decryptSecret((string) ($row['encrypted_secret'] ?? ''), $masterKey);
        $model = $this->normalizeModel($model);
        if ($model === '') {
            $model = (string) (self::DEFAULT_TEST_MODELS[$provider] ?? '');
        }
        if ($model === '') {
            throw new RuntimeException('model_not_configured');
        }

        $result = $this->callSyntheticProvider($provider, $model, $secret);
        $this->updateProviderTestStatus((int) ($row['id'] ?? 0), $result['status'], $userId);

        return [
            'provider' => $provider,
            'model' => $model,
            'status' => $result['status'],
            'error_type' => $result['error_type'],
            'elapsed_ms' => $result['elapsed_ms'],
            'response_hash' => $result['response_hash'],
        ];
    }

    /**
     * Runs an explicit, operator-triggered cloud completion with a sanitized
     * payload prepared by the caller. This method never logs prompt/response
     * bodies and never returns the secret.
     *
     * @return array{provider: string, model: string, status: string, error_type: string, elapsed_ms: int, http_status: int, response_hash: string, response_text: string}
     */
    public function completeProvider(string $provider, string $model, string $prompt, int $timeoutMs = 30000, int $maxTokens = 900): array
    {
        $provider = $this->normalizeProvider($provider);
        if ($provider === '') {
            throw new AiCloudProviderException('provider_not_allowed', $this->cloudProviderDiagnostics('', $model, 'provider_not_allowed'));
        }
        if (!$this->tableExists()) {
            throw new AiCloudProviderException('secret_vault_table_missing', $this->cloudProviderDiagnostics($provider, $model, 'secret_vault_table_missing'));
        }
        $masterKey = $this->masterKey();
        if ($masterKey === null) {
            throw new AiCloudProviderException('secret_vault_locked', $this->cloudProviderDiagnostics($provider, $model, 'secret_vault_locked'));
        }

        $row = $this->activeSecretRow($provider);
        if ($row === []) {
            throw new AiCloudProviderException('cloud_provider_missing_secret', $this->cloudProviderDiagnostics($provider, $model, 'cloud_provider_missing_secret'));
        }

        $model = $this->normalizeModel($model);
        if ($model === '') {
            throw new AiCloudProviderException('cloud_provider_model_not_allowed', $this->cloudProviderDiagnostics($provider, '', 'cloud_provider_model_not_allowed'));
        }
        $prompt = trim($prompt);
        if ($prompt === '' || strlen($prompt) > 12000) {
            throw new AiCloudProviderException('cloud_provider_payload_too_large', $this->cloudProviderDiagnostics($provider, $model, 'cloud_provider_payload_too_large'));
        }

        try {
            $secret = $this->decryptSecret((string) ($row['encrypted_secret'] ?? ''), $masterKey);
        } catch (RuntimeException $decryptError) {
            // D10: chave mestra mudou ou payload corrompido — o segredo precisa ser
            // regravado pelo operador. Nunca expõe valor/cifra; diagnóstico tipado.
            throw new AiCloudProviderException(
                'secret_decrypt_failed',
                $this->cloudProviderDiagnostics($provider, $model, 'secret_decrypt_failed')
            );
        }
        $result = $this->callCompletionProvider(
            $provider,
            $model,
            $secret,
            $prompt,
            max(5000, min(60000, $timeoutMs)),
            max(64, min(1600, $maxTokens))
        );
        if ((string) ($result['status'] ?? '') !== 'success') {
            $errorType = (string) ($result['error_type'] ?? 'cloud_provider_unreachable');
            throw new AiCloudProviderException($errorType, [
                'provider' => $provider,
                'model' => $model,
                'error_type' => $errorType,
                'elapsed_ms' => (int) ($result['elapsed_ms'] ?? 0),
                'http_status' => (int) ($result['http_status'] ?? 0),
                'response_hash' => (string) ($result['response_hash'] ?? ''),
                'error_hash' => (string) ($result['error_hash'] ?? hash('sha256', $provider . ':' . $model . ':' . $errorType)),
            ]);
        }

        return [
            'provider' => $provider,
            'model' => $model,
            'status' => (string) $result['status'],
            'error_type' => (string) $result['error_type'],
            'elapsed_ms' => (int) $result['elapsed_ms'],
            'http_status' => (int) ($result['http_status'] ?? 0),
            'response_hash' => (string) $result['response_hash'],
            'response_text' => (string) $result['response_text'],
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function activeSecretRow(string $provider): array
    {
        $legacyProvider = $this->legacyProviderFor($provider);
        $stmt = ExternalDatabase::getConnection($this->pluginConfigService->getConnectionConfig())->prepare(
            'SELECT id, encrypted_secret
               FROM public.' . self::TABLE . '
              WHERE (provider = :provider OR (:legacy_provider <> \'\' AND provider = :legacy_provider))
                AND is_active = TRUE
              ORDER BY updated_at DESC
              LIMIT 1'
        );
        $stmt->execute([
            ':provider' => $provider,
            ':legacy_provider' => $legacyProvider,
        ]);
        $row = $stmt->fetch(\PDO::FETCH_ASSOC);

        return is_array($row) ? $row : [];
    }

    /**
     * @return array{status: string, error_type: string, elapsed_ms: int, response_hash: string}
     */
    private function callSyntheticProvider(string $provider, string $model, string $secret): array
    {
        if (!function_exists('curl_init')) {
            return [
                'status' => 'failed',
                'error_type' => 'curl_unavailable',
                'elapsed_ms' => 0,
                'response_hash' => '',
            ];
        }

        $request = $this->syntheticProviderRequest($provider, $model, $secret);
        $startedAt = microtime(true);
        $handle = curl_init((string) $request['url']);
        if ($handle === false) {
            return [
                'status' => 'failed',
                'error_type' => 'curl_init_failed',
                'elapsed_ms' => 0,
                'response_hash' => '',
            ];
        }

        curl_setopt_array($handle, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => (string) $request['body'],
            CURLOPT_HTTPHEADER => $request['headers'],
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CONNECTTIMEOUT_MS => 2000,
            CURLOPT_TIMEOUT_MS => 10000,
        ]);
        $raw = curl_exec($handle);
        $httpStatus = (int) curl_getinfo($handle, CURLINFO_HTTP_CODE);
        $curlErrNo = (int) curl_errno($handle);
        curl_close($handle);
        $elapsedMs = (int) round((microtime(true) - $startedAt) * 1000);

        if ($curlErrNo === CURLE_OPERATION_TIMEDOUT) {
            return [
                'status' => 'timeout',
                'error_type' => 'timeout',
                'elapsed_ms' => $elapsedMs,
                'response_hash' => '',
            ];
        }
        if ($curlErrNo !== 0) {
            return [
                'status' => 'failed',
                'error_type' => 'provider_unreachable',
                'elapsed_ms' => $elapsedMs,
                'response_hash' => '',
            ];
        }
        if (!is_string($raw) || $raw === '') {
            return [
                'status' => 'failed',
                'error_type' => 'provider_unreachable',
                'elapsed_ms' => $elapsedMs,
                'response_hash' => '',
            ];
        }
        if ($httpStatus === 401 || $httpStatus === 403) {
            return [
                'status' => 'unauthorized',
                'error_type' => 'unauthorized',
                'elapsed_ms' => $elapsedMs,
                'response_hash' => hash('sha256', $this->sanitizeProviderRawForHash($raw)),
            ];
        }
        if ($httpStatus < 200 || $httpStatus >= 300) {
            $errorType = $this->providerErrorType($provider, $raw, $httpStatus);
            $status = in_array($errorType, ['unauthorized', 'timeout', 'invalid_response'], true)
                ? $errorType
                : 'failed';

            return [
                'status' => $status,
                'error_type' => $errorType,
                'elapsed_ms' => $elapsedMs,
                'response_hash' => hash('sha256', $this->sanitizeProviderRawForHash($raw)),
            ];
        }

        $responseText = $this->extractSyntheticResponseText($provider, $raw);
        $rawResponseHash = hash('sha256', $this->sanitizeProviderRawForHash($raw));
        if (trim($responseText) === '') {
            return [
                'status' => 'invalid_response',
                'error_type' => 'invalid_response',
                'elapsed_ms' => $elapsedMs,
                'response_hash' => $rawResponseHash,
            ];
        }
        $responseHash = hash('sha256', $this->normalizeSyntheticResponseText($responseText));
        if (!$this->syntheticResponseOk($responseText)) {
            return [
                'status' => 'invalid_response',
                'error_type' => 'invalid_response',
                'elapsed_ms' => $elapsedMs,
                'response_hash' => $rawResponseHash,
            ];
        }

        return [
            'status' => 'success',
            'error_type' => 'none',
            'elapsed_ms' => $elapsedMs,
            'response_hash' => $responseHash,
        ];
    }

    /**
     * @return array{status: string, error_type: string, elapsed_ms: int, http_status: int, response_hash: string, error_hash: string, response_text: string}
     */
    private function callCompletionProvider(string $provider, string $model, string $secret, string $prompt, int $timeoutMs, int $maxTokens): array
    {
        if (!function_exists('curl_init')) {
            return $this->cloudCompletionFailure('failed', 'cloud_provider_unreachable', 0, 0);
        }

        $request = $this->providerCompletionRequest($provider, $model, $secret, $prompt, $maxTokens);
        $startedAt = microtime(true);
        $handle = curl_init((string) $request['url']);
        if ($handle === false) {
            return $this->cloudCompletionFailure('failed', 'cloud_provider_unreachable', 0, 0);
        }

        curl_setopt_array($handle, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => (string) $request['body'],
            CURLOPT_HTTPHEADER => $request['headers'],
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CONNECTTIMEOUT_MS => 2500,
            CURLOPT_TIMEOUT_MS => $timeoutMs,
        ]);
        $raw = curl_exec($handle);
        $httpStatus = (int) curl_getinfo($handle, CURLINFO_HTTP_CODE);
        $curlErrNo = (int) curl_errno($handle);
        curl_close($handle);
        $elapsedMs = (int) round((microtime(true) - $startedAt) * 1000);

        if ($curlErrNo === CURLE_OPERATION_TIMEDOUT) {
            return $this->cloudCompletionFailure('timeout', 'cloud_provider_timeout', $elapsedMs, $httpStatus);
        }
        if ($curlErrNo !== 0) {
            return $this->cloudCompletionFailure('failed', 'cloud_provider_unreachable', $elapsedMs, $httpStatus);
        }
        if (!is_string($raw) || $raw === '') {
            return $this->cloudCompletionFailure('failed', 'cloud_provider_unreachable', $elapsedMs, $httpStatus);
        }
        if ($httpStatus < 200 || $httpStatus >= 300) {
            $errorType = $this->providerCompletionErrorType($provider, $raw, $httpStatus);
            $status = $errorType === 'cloud_provider_timeout' ? 'timeout' : ($errorType === 'cloud_provider_http_401' || $errorType === 'cloud_provider_http_403' ? 'unauthorized' : 'failed');

            return $this->cloudCompletionFailure($status, $errorType, $elapsedMs, $httpStatus, $raw);
        }

        $responseText = trim($this->extractSyntheticResponseText($provider, $raw));
        if ($responseText === '') {
            return $this->cloudCompletionFailure('invalid_response', 'cloud_provider_invalid_response', $elapsedMs, $httpStatus, $raw);
        }

        return [
            'status' => 'success',
            'error_type' => 'none',
            'elapsed_ms' => $elapsedMs,
            'http_status' => $httpStatus,
            'response_hash' => hash('sha256', $this->sanitizeProviderRawForHash($responseText)),
            'error_hash' => '',
            'response_text' => mb_substr($responseText, 0, 8000, 'UTF-8'),
        ];
    }

    /**
     * @return array{status: string, error_type: string, elapsed_ms: int, http_status: int, response_hash: string, error_hash: string, response_text: string}
     */
    private function cloudCompletionFailure(string $status, string $errorType, int $elapsedMs, int $httpStatus, string $raw = ''): array
    {
        $responseHash = $raw !== '' ? hash('sha256', $this->sanitizeProviderRawForHash($raw)) : '';

        return [
            'status' => $status,
            'error_type' => $errorType,
            'elapsed_ms' => $elapsedMs,
            'http_status' => $httpStatus,
            'response_hash' => $responseHash,
            'error_hash' => $responseHash !== '' ? $responseHash : hash('sha256', $errorType . ':' . (string) $httpStatus),
            'response_text' => '',
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function cloudProviderDiagnostics(string $provider, string $model, string $errorType): array
    {
        return [
            'provider' => $this->normalizeProvider($provider),
            'model' => $this->normalizeModel($model),
            'error_type' => $errorType,
            'elapsed_ms' => 0,
            'http_status' => 0,
            'response_hash' => '',
            'error_hash' => hash('sha256', $provider . ':' . $model . ':' . $errorType),
        ];
    }

    /**
     * @return array{url: string, headers: list<string>, body: string}
     */
    private function providerCompletionRequest(string $provider, string $model, string $secret, string $prompt, int $maxTokens): array
    {
        if ($provider === 'anthropic') {
            return [
                'url' => 'https://api.anthropic.com/v1/messages',
                'headers' => [
                    'Content-Type: application/json',
                    'x-api-key: ' . $secret,
                    'anthropic-version: 2023-06-01',
                ],
                'body' => json_encode([
                    'model' => $model,
                    'max_tokens' => $maxTokens,
                    'temperature' => 0.1,
                    'messages' => [
                        ['role' => 'user', 'content' => $prompt],
                    ],
                ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?: '{}',
            ];
        }

        if ($provider === 'gemini') {
            return [
                'url' => 'https://generativelanguage.googleapis.com/v1beta/models/' . rawurlencode($model) . ':generateContent',
                'headers' => [
                    'Content-Type: application/json',
                    'x-goog-api-key: ' . $secret,
                ],
                'body' => json_encode([
                    'contents' => [
                        ['parts' => [['text' => $prompt]]],
                    ],
                    'generationConfig' => [
                        'temperature' => 0.1,
                        'maxOutputTokens' => $maxTokens,
                    ],
                ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?: '{}',
            ];
        }

        $baseUrl = [
            'openai' => 'https://api.openai.com/v1',
            'deepseek' => 'https://api.deepseek.com',
            'xai' => 'https://api.x.ai/v1',
        ][$provider] ?? '';

        return [
            'url' => rtrim($baseUrl, '/') . '/chat/completions',
            'headers' => [
                'Content-Type: application/json',
                'Authorization: Bearer ' . $secret,
            ],
            'body' => json_encode([
                'model' => $model,
                'temperature' => 0.1,
                'max_tokens' => $maxTokens,
                'messages' => [
                    ['role' => 'user', 'content' => $prompt],
                ],
            ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?: '{}',
        ];
    }

    /**
     * @return array{url: string, headers: list<string>, body: string}
     */
    private function syntheticProviderRequest(string $provider, string $model, string $secret): array
    {
        if ($provider === 'anthropic') {
            return [
                'url' => 'https://api.anthropic.com/v1/messages',
                'headers' => [
                    'Content-Type: application/json',
                    'x-api-key: ' . $secret,
                    'anthropic-version: 2023-06-01',
                ],
                'body' => json_encode([
                    'model' => $model,
                    'max_tokens' => 32,
                    'temperature' => 0,
                    'messages' => [
                        ['role' => 'user', 'content' => self::SYNTHETIC_PROMPT],
                    ],
                ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?: '{}',
            ];
        }

        if ($provider === 'gemini') {
            return [
                'url' => 'https://generativelanguage.googleapis.com/v1beta/models/' . rawurlencode($model) . ':generateContent',
                'headers' => [
                    'Content-Type: application/json',
                    'x-goog-api-key: ' . $secret,
                ],
                'body' => json_encode([
                    'contents' => [
                        ['parts' => [['text' => self::SYNTHETIC_PROMPT]]],
                    ],
                    'generationConfig' => [
                        'temperature' => 0,
                        'maxOutputTokens' => 32,
                        'responseMimeType' => 'application/json',
                    ],
                ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?: '{}',
            ];
        }

        $baseUrl = [
            'openai' => 'https://api.openai.com/v1',
            'deepseek' => 'https://api.deepseek.com',
            'xai' => 'https://api.x.ai/v1',
        ][$provider] ?? '';

        return [
            'url' => rtrim($baseUrl, '/') . '/chat/completions',
            'headers' => [
                'Content-Type: application/json',
                'Authorization: Bearer ' . $secret,
            ],
            'body' => json_encode([
                'model' => $model,
                'temperature' => 0,
                'max_tokens' => 32,
                'messages' => [
                    ['role' => 'user', 'content' => self::SYNTHETIC_PROMPT],
                ],
            ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?: '{}',
        ];
    }

    private function extractSyntheticResponseText(string $provider, string $raw): string
    {
        $decoded = json_decode($raw, true);
        if (!is_array($decoded)) {
            return '';
        }

        if ($provider === 'anthropic') {
            $content = '';
            if (is_array($decoded['content'] ?? null)) {
                foreach ($decoded['content'] as $part) {
                    if (!is_array($part)) {
                        continue;
                    }
                    $type = strtolower(trim((string) ($part['type'] ?? 'text')));
                    if ($type !== 'text') {
                        continue;
                    }
                    $text = $part['text'] ?? '';
                    if (is_string($text) && trim($text) !== '') {
                        $content .= "\n" . $text;
                    }
                }
            }

            return is_string($content) ? $content : '';
        }
        if ($provider === 'gemini') {
            $content = '';
            $parts = $decoded['candidates'][0]['content']['parts'] ?? [];
            if (is_array($parts)) {
                foreach ($parts as $part) {
                    if (!is_array($part)) {
                        continue;
                    }
                    $text = $part['text'] ?? '';
                    if (is_string($text) && trim($text) !== '') {
                        $content .= "\n" . $text;
                    }
                }
            }

            return is_string($content) ? $content : '';
        }

        $content = $decoded['choices'][0]['message']['content'] ?? '';

        return is_string($content) ? $content : '';
    }

    private function syntheticResponseOk(string $responseText): bool
    {
        $responseText = $this->normalizeSyntheticResponseText($responseText);
        if ($responseText === '') {
            return false;
        }
        if (strlen($responseText) > 120) {
            return false;
        }

        $decoded = json_decode($responseText, true);
        if (is_array($decoded) && ($decoded['ok'] ?? null) === true) {
            return true;
        }

        return strtolower($responseText) === 'ok';
    }

    private function normalizeSyntheticResponseText(string $responseText): string
    {
        $responseText = trim($responseText);
        $responseText = preg_replace('/^```(?:json)?\s*/i', '', $responseText) ?? $responseText;
        $responseText = preg_replace('/\s*```$/', '', $responseText) ?? $responseText;

        return trim($responseText);
    }

    private function updateProviderTestStatus(int $id, string $status, int $userId): void
    {
        if ($id <= 0) {
            return;
        }

        $allowed = ['success', 'failed', 'timeout', 'invalid_response', 'unauthorized'];
        if (!in_array($status, $allowed, true)) {
            $status = 'failed';
        }

        $stmt = ExternalDatabase::getConnection($this->pluginConfigService->getConnectionConfig())->prepare(
            'UPDATE public.' . self::TABLE . '
                SET last_test_status = :status,
                    last_tested_at = NOW(),
                    updated_by = :updated_by,
                    updated_at = NOW()
              WHERE id = :id'
        );
        $stmt->execute([
            ':status' => $status,
            ':updated_by' => max(0, $userId),
            ':id' => $id,
        ]);
    }

    private function encryptSecret(string $secret, string $masterKey): string
    {
        if (!function_exists('openssl_encrypt')) {
            throw new RuntimeException(__('OpenSSL indisponível para Secret Vault.', 'glpiintegaglpi'));
        }
        $iv = random_bytes(12);
        $tag = '';
        $ciphertext = openssl_encrypt($secret, self::CIPHER, $masterKey, OPENSSL_RAW_DATA, $iv, $tag);
        if (!is_string($ciphertext) || $tag === '') {
            throw new RuntimeException(__('Falha ao criptografar segredo no Secret Vault.', 'glpiintegaglpi'));
        }

        return json_encode([
            'v' => 1,
            'cipher' => self::CIPHER,
            'iv' => base64_encode($iv),
            'tag' => base64_encode($tag),
            'data' => base64_encode($ciphertext),
        ], JSON_UNESCAPED_SLASHES) ?: '';
    }

    private function decryptSecret(string $encrypted, string $masterKey): string
    {
        if (!function_exists('openssl_decrypt')) {
            throw new RuntimeException('openssl_unavailable');
        }

        $decoded = json_decode($encrypted, true);
        if (!is_array($decoded)) {
            throw new RuntimeException('secret_payload_invalid');
        }

        $iv = base64_decode((string) ($decoded['iv'] ?? ''), true);
        $tag = base64_decode((string) ($decoded['tag'] ?? ''), true);
        $ciphertext = base64_decode((string) ($decoded['data'] ?? ''), true);
        if (!is_string($iv) || !is_string($tag) || !is_string($ciphertext)) {
            throw new RuntimeException('secret_payload_invalid');
        }

        $secret = openssl_decrypt($ciphertext, self::CIPHER, $masterKey, OPENSSL_RAW_DATA, $iv, $tag);
        if (!is_string($secret) || trim($secret) === '') {
            throw new RuntimeException('secret_decrypt_failed');
        }

        return trim($secret);
    }

    private function masterKey(): ?string
    {
        $value = Plugin::getRuntimeConfigValue('INTEGAGLPI_AI_VAULT_MASTER_KEY');
        if ($value === '') {
            return null;
        }

        return hash('sha256', $value, true);
    }

    private function tableExists(): bool
    {
        if (!$this->pluginConfigService->isConfigured()) {
            return false;
        }

        try {
            $stmt = ExternalDatabase::getConnection($this->pluginConfigService->getConnectionConfig())->prepare('SELECT to_regclass(:table_name)');
            $stmt->execute([':table_name' => 'public.' . self::TABLE]);

            return (string) ($stmt->fetchColumn() ?: '') !== '';
        } catch (Throwable $exception) {
            error_log('[integaglpi][ai_secret_vault][table] ' . $this->sanitizeLog($exception->getMessage()));

            return false;
        }
    }

    private function normalizeProvider($value): string
    {
        $provider = strtolower(trim((string) $value));
        if (isset(self::PROVIDER_ALIASES[$provider])) {
            $provider = self::PROVIDER_ALIASES[$provider];
        }

        return in_array($provider, self::ALLOWED_PROVIDERS, true) ? $provider : '';
    }

    private function legacyProviderFor(string $provider): string
    {
        if ($provider === 'gemini') {
            return 'google';
        }

        return '';
    }

    private function statusToErrorType(string $status): string
    {
        $status = strtolower(trim($status));
        if (in_array($status, ['success', 'not_tested', 'blocked'], true)) {
            return $status;
        }
        if (in_array($status, ['timeout', 'invalid_response', 'unauthorized'], true)) {
            return $status;
        }

        return 'failed';
    }

    private function providerErrorType(string $provider, string $raw, int $httpStatus): string
    {
        $decoded = json_decode($raw, true);
        $type = '';
        if (is_array($decoded)) {
            if ($provider === 'anthropic') {
                $type = (string) ($decoded['error']['type'] ?? '');
            } elseif ($provider === 'gemini') {
                $type = (string) ($decoded['error']['status'] ?? $decoded['error']['code'] ?? '');
            } else {
                $type = (string) ($decoded['error']['type'] ?? $decoded['error']['code'] ?? '');
            }
        }

        $type = strtolower(trim($type));
        if (in_array($type, ['authentication_error', 'permission_error', 'unauthorized', 'unauthenticated', 'permission_denied'], true)) {
            return 'unauthorized';
        }
        if (in_array($type, ['not_found_error', 'not_found'], true)) {
            return 'model_not_found';
        }
        if (in_array($type, ['invalid_request_error', 'invalid_argument'], true)) {
            return 'invalid_request';
        }
        if (in_array($type, ['timeout', 'deadline_exceeded'], true)) {
            return 'timeout';
        }
        if (in_array($type, ['rate_limit_error', 'resource_exhausted'], true)) {
            return 'rate_limited';
        }
        if (in_array($type, ['overloaded_error', 'unavailable'], true)) {
            return 'provider_unavailable';
        }
        if ($httpStatus === 400 || $httpStatus === 404) {
            return $httpStatus === 404 ? 'model_not_found' : 'invalid_request';
        }
        if ($httpStatus === 408 || $httpStatus === 504) {
            return 'timeout';
        }

        return 'provider_http_' . $httpStatus;
    }

    private function providerCompletionErrorType(string $provider, string $raw, int $httpStatus): string
    {
        if ($httpStatus === 400) {
            return 'cloud_provider_http_400';
        }
        if ($httpStatus === 401) {
            return 'cloud_provider_http_401';
        }
        if ($httpStatus === 403) {
            return 'cloud_provider_http_403';
        }
        if ($httpStatus === 429) {
            return 'cloud_provider_http_429';
        }
        if ($httpStatus === 408 || $httpStatus === 504) {
            return 'cloud_provider_timeout';
        }

        $typed = $this->providerErrorType($provider, $raw, $httpStatus);
        if (in_array($typed, ['model_not_found', 'invalid_request'], true)) {
            return 'cloud_provider_model_not_allowed';
        }
        if ($typed === 'timeout') {
            return 'cloud_provider_timeout';
        }
        if ($typed === 'rate_limited') {
            return 'cloud_provider_http_429';
        }
        if ($typed === 'unauthorized') {
            return $httpStatus === 403 ? 'cloud_provider_http_403' : 'cloud_provider_http_401';
        }

        return 'cloud_provider_http_' . (string) $httpStatus;
    }

    private function sanitizeProviderRawForHash(string $raw): string
    {
        $raw = preg_replace('/(api[_-]?key|token|secret|password|bearer|x-goog-api-key)\s*["\']?\s*[:=]\s*["\']?[^"\',\s}]+/i', '$1=[redacted]', $raw) ?? '';

        return substr($raw, 0, 20000);
    }

    private function normalizeModel(string $value): string
    {
        $value = trim($value);
        if ($value === '' || strlen($value) > 120) {
            return '';
        }

        return preg_match('/^[A-Za-z0-9_.:\/-]+$/', $value) === 1 ? $value : '';
    }

    private function sanitizeLabel(string $value): string
    {
        $value = trim(strip_tags($value));
        $value = preg_replace('/(password|senha|token|secret|bearer|api_key)\s*[:=]\s*\S+/i', '$1=[redacted]', $value) ?? '';

        return substr($value, 0, 120);
    }

    private function maskFingerprint(string $fingerprint): string
    {
        $fingerprint = preg_replace('/[^a-f0-9]/i', '', $fingerprint) ?? '';
        if (strlen($fingerprint) < 12) {
            return '';
        }

        return substr($fingerprint, 0, 8) . '...' . substr($fingerprint, -4);
    }

    private function sanitizeLog(string $message): string
    {
        $message = preg_replace('/(password|senha|token|secret|bearer|api_key)\s*[:=]\s*\S+/i', '$1=[redacted]', $message) ?? '';

        return substr($message, 0, 180);
    }
}
