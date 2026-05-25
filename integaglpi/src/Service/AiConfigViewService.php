<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi\Service;

use GlpiPlugin\Integaglpi\Plugin;
use Throwable;

final class AiConfigViewService
{
    private PluginConfigService $pluginConfigService;

    public function __construct(PluginConfigService $pluginConfigService)
    {
        $this->pluginConfigService = $pluginConfigService;
    }

    /**
     * @return array<string, mixed>
     */
    public function getPageData(): array
    {
        $diagnostics = null;
        $diagnosticsError = '';
        try {
            $response = (new IntegrationServiceClient($this->pluginConfigService))->getDiagnostics();
            if (!empty($response['success']) && is_array($response['body'] ?? null)) {
                $diagnostics = $response['body'];
            } else {
                $diagnosticsError = __('Integration-service não retornou diagnóstico agora.', 'glpiintegaglpi');
            }
        } catch (Throwable $exception) {
            error_log('[integaglpi][ai_config][diagnostics] ' . $this->sanitizeLog($exception->getMessage()));
            $diagnosticsError = __('Não foi possível consultar o integration-service agora.', 'glpiintegaglpi');
        }

        $aiSupervisor = is_array($diagnostics['ai_supervisor'] ?? null) ? $diagnostics['ai_supervisor'] : [];
        $integrationUrl = $this->pluginConfigService->getIntegrationServiceUrl();

        return [
            'diagnostics_error' => $diagnosticsError,
            'ai_supervisor' => [
                'enabled' => $aiSupervisor['enabled'] ?? Plugin::isAiSupervisorEnabled(),
                'provider' => (string) ($aiSupervisor['provider'] ?? $this->runtimeValue('AI_SUPERVISOR_PROVIDER', 'não verificado')),
                'model' => $this->runtimeValue('AI_SUPERVISOR_MODEL', 'não verificado'),
                'timeout_seconds' => $this->runtimeValue('AI_SUPERVISOR_TIMEOUT_SECONDS', 'não verificado'),
                'max_messages' => $this->runtimeValue('AI_SUPERVISOR_MAX_MESSAGES', 'não verificado'),
                'max_chars' => $this->runtimeValue('AI_SUPERVISOR_MAX_CHARS', 'não verificado'),
                'dry_run' => $aiSupervisor['dry_run'] ?? $this->runtimeValue('AI_SUPERVISOR_DRY_RUN', 'true'),
                'base_url' => $this->maskUrl($this->runtimeValue('AI_SUPERVISOR_BASE_URL', 'não verificado')),
                'base_url_configured' => $aiSupervisor['base_url_configured'] ?? null,
            ],
            'copilot' => [
                'enabled' => Plugin::isAiSupervisorEnabled(),
                'provider' => $this->runtimeValue('COPILOT_PROVIDER', $this->runtimeValue('AI_SUPERVISOR_PROVIDER', 'disabled')),
                'dry_run' => $this->runtimeValue('COPILOT_DRY_RUN', $this->runtimeValue('AI_SUPERVISOR_DRY_RUN', 'true')),
            ],
            'cloud_pilot' => [
                'cloud_enabled' => $this->runtimeValue('AI_PILOT_CLOUD_ENABLED', 'false'),
                'embeddings_enabled' => $this->runtimeValue('AI_PILOT_EMBEDDINGS_ENABLED', 'false'),
                'provider' => $this->runtimeValue('AI_PILOT_PROVIDER', 'disabled'),
                'dpo_approved' => $this->runtimeValue('AI_PILOT_DPO_APPROVED', 'false'),
                'director_approved' => $this->runtimeValue('AI_PILOT_DIRECTOR_APPROVED', 'false'),
                'admin_opt_in' => $this->runtimeValue('AI_PILOT_ADMIN_OPT_IN', 'false'),
                'incident_ack' => $this->runtimeValue('AI_PILOT_INCIDENT_ACK', 'false'),
            ],
            'integration_service' => [
                'url_masked' => $this->maskUrl($integrationUrl),
                'configured' => $this->pluginConfigService->isConfigured(),
            ],
        ];
    }

    private function runtimeValue(string $key, string $fallback): string
    {
        $value = Plugin::getRuntimeConfigValue($key);

        return $value !== '' ? $value : $fallback;
    }

    private function maskUrl(string $url): string
    {
        $url = trim($url);
        if ($url === '' || $url === 'não verificado') {
            return $url;
        }

        $parts = parse_url($url);
        if (!is_array($parts) || empty($parts['host'])) {
            return '[url mascarada]';
        }

        $scheme = isset($parts['scheme']) ? (string) $parts['scheme'] : 'http';
        $host = (string) $parts['host'];
        $port = isset($parts['port']) ? ':****' : '';

        return $scheme . '://' . $host . $port;
    }

    private function sanitizeLog(string $message): string
    {
        $message = preg_replace('/(password|senha|token|secret|bearer|api_key)\s*[:=]\s*\S+/i', '$1=[redacted]', $message) ?? '';

        return substr($message, 0, 180);
    }
}
