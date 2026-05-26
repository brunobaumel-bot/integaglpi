<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi\Service;

use GlpiPlugin\Integaglpi\External\ExternalDatabase;
use GlpiPlugin\Integaglpi\Plugin;
use RuntimeException;
use Throwable;

final class AiSecretVaultService
{
    private const TABLE = 'glpi_plugin_integaglpi_ai_secret_vault';
    private const ALLOWED_PROVIDERS = ['openai', 'anthropic', 'gemini', 'deepseek', 'xai'];
    private const CIPHER = 'aes-256-gcm';

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
                  WHERE is_active = TRUE'
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

        return in_array($provider, self::ALLOWED_PROVIDERS, true) ? $provider : '';
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
