<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi\Service;

use GlpiPlugin\Integaglpi\Plugin;
use RuntimeException;
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
    public function getPageData(?array $flash = null): array
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

        $cloudPilot = [
            'cloud_enabled' => $this->runtimeValue('AI_PILOT_CLOUD_ENABLED', 'false'),
            'embeddings_enabled' => $this->runtimeValue('AI_PILOT_EMBEDDINGS_ENABLED', 'false'),
            'provider' => $this->runtimeValue('AI_PILOT_PROVIDER', 'disabled'),
            'dpo_approved' => $this->runtimeValue('AI_PILOT_DPO_APPROVED', 'false'),
            'director_approved' => $this->runtimeValue('AI_PILOT_DIRECTOR_APPROVED', 'false'),
            'admin_opt_in' => $this->runtimeValue('AI_PILOT_ADMIN_OPT_IN', 'false'),
            'incident_ack' => $this->runtimeValue('AI_PILOT_INCIDENT_ACK', 'false'),
            'monthly_budget_limit' => $this->runtimeValue('AI_PILOT_MONTHLY_BUDGET_LIMIT', '0'),
            'environment' => $this->runtimeValue('AI_PILOT_ENVIRONMENT', $this->runtimeValue('APP_ENV', 'unknown')),
        ];

        $aiSupervisor = [
            'enabled' => $aiSupervisor['enabled'] ?? Plugin::isAiSupervisorEnabled(),
            'provider' => (string) ($aiSupervisor['provider'] ?? $this->runtimeValue('AI_SUPERVISOR_PROVIDER', 'não verificado')),
            'model' => $this->runtimeValue('AI_SUPERVISOR_MODEL', 'não verificado'),
            'timeout_seconds' => $this->runtimeValue('AI_SUPERVISOR_TIMEOUT_SECONDS', 'não verificado'),
            'max_messages' => $this->runtimeValue('AI_SUPERVISOR_MAX_MESSAGES', 'não verificado'),
            'max_chars' => $this->runtimeValue('AI_SUPERVISOR_MAX_CHARS', 'não verificado'),
            'dry_run' => $aiSupervisor['dry_run'] ?? $this->runtimeValue('AI_SUPERVISOR_DRY_RUN', 'true'),
            'base_url' => $this->maskUrl($this->runtimeValue('AI_SUPERVISOR_BASE_URL', 'não verificado')),
            'base_url_configured' => $aiSupervisor['base_url_configured'] ?? null,
        ];

        return [
            'flash' => $flash,
            'diagnostics_error' => $diagnosticsError,
            'environment' => $this->detectEnvironment($cloudPilot),
            'risk_alerts' => $this->riskAlerts($aiSupervisor, $cloudPilot),
            'editable_safe_fields' => ['ai_supervisor_enabled'],
            'pending_safe_fields' => ['provider', 'model', 'timeout_seconds', 'max_messages', 'max_chars', 'dry_run'],
            'ai_supervisor' => $aiSupervisor,
            'copilot' => [
                'enabled' => Plugin::isAiSupervisorEnabled(),
                'provider' => $this->runtimeValue('COPILOT_PROVIDER', $this->runtimeValue('AI_SUPERVISOR_PROVIDER', 'disabled')),
                'dry_run' => $this->runtimeValue('COPILOT_DRY_RUN', $this->runtimeValue('AI_SUPERVISOR_DRY_RUN', 'true')),
            ],
            'cloud_pilot' => $cloudPilot + [
                'gates_ok' => $this->cloudGatesOk($cloudPilot),
                'missing_gates' => $this->missingCloudGates($cloudPilot),
            ],
            'integration_service' => [
                'url_masked' => $this->maskUrl($integrationUrl),
                'configured' => $this->pluginConfigService->isConfigured(),
            ],
        ];
    }

    /**
     * @param array<string, mixed> $post
     * @return array<string, mixed>
     */
    public function handlePost(array $post, int $userId): array
    {
        $action = trim((string) ($post['action'] ?? ''));
        try {
            if ($action === 'save_safe_config') {
                $config = $this->pluginConfigService->getConnectionConfig();
                if (!$this->pluginConfigService->isConfigured()) {
                    throw new RuntimeException(__('Configure a conexão do plugin antes de salvar flags seguras.', 'glpiintegaglpi'));
                }
                $config['ai_supervisor_enabled'] = !empty($post['ai_supervisor_enabled']) ? 1 : 0;
                $config['db_password'] = '';
                $config['integration_auth_key'] = '';
                $this->pluginConfigService->saveConnectionConfig($config);

                return [
                    'type' => 'success',
                    'message' => __('Configuração segura salva. Campos sensíveis e .env não foram alterados.', 'glpiintegaglpi'),
                ];
            }

            if ($action === 'request_cloud_enable') {
                $data = $this->getPageData();
                $pilot = is_array($data['cloud_pilot'] ?? null) ? $data['cloud_pilot'] : [];
                $missing = is_array($pilot['missing_gates'] ?? null) ? $pilot['missing_gates'] : [];
                if ($missing !== []) {
                    return [
                        'type' => 'danger',
                        'message' => sprintf(
                            __('Cloud bloqueada. Gates pendentes: %s.', 'glpiintegaglpi'),
                            implode(', ', $missing)
                        ),
                    ];
                }

                return [
                    'type' => 'warning',
                    'message' => __('Gates aparentam OK, mas esta UI não edita .env nem habilita cloud. Solicite alteração operacional manual.', 'glpiintegaglpi'),
                ];
            }

            return ['type' => 'danger', 'message' => __('Ação inválida.', 'glpiintegaglpi')];
        } catch (Throwable $exception) {
            error_log('[integaglpi][ai_config][post] ' . $this->sanitizeLog($exception->getMessage()));

            return [
                'type' => 'danger',
                'message' => mb_substr($this->sanitizeLog($exception->getMessage()), 0, 220, 'UTF-8'),
            ];
        }
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

    /**
     * @param array<string, mixed> $cloudPilot
     */
    private function detectEnvironment(array $cloudPilot): string
    {
        $value = strtolower(trim((string) ($cloudPilot['environment'] ?? 'unknown')));
        if (in_array($value, ['test', 'teste'], true)) {
            return 'TESTE';
        }
        if (in_array($value, ['homologation', 'homologacao', 'homologação', 'staging'], true)) {
            return 'HOMOLOGAÇÃO';
        }
        if (in_array($value, ['production', 'prod', 'produção', 'producao'], true)) {
            return 'PRODUÇÃO';
        }

        return 'desconhecido';
    }

    /**
     * @param array<string, mixed> $aiSupervisor
     * @param array<string, mixed> $cloudPilot
     * @return list<string>
     */
    private function riskAlerts(array $aiSupervisor, array $cloudPilot): array
    {
        $alerts = [];
        if ($this->truthy($aiSupervisor['enabled'] ?? false)) {
            $alerts[] = 'AI_SUPERVISOR_ENABLED=true';
        }
        if (!$this->truthy($aiSupervisor['dry_run'] ?? true)) {
            $alerts[] = 'AI_SUPERVISOR_DRY_RUN=false';
        }
        if ($this->truthy($cloudPilot['cloud_enabled'] ?? false)) {
            $alerts[] = 'AI_PILOT_CLOUD_ENABLED=true';
        }
        if ($this->truthy($cloudPilot['embeddings_enabled'] ?? false)) {
            $alerts[] = 'AI_PILOT_EMBEDDINGS_ENABLED=true';
        }

        return $alerts;
    }

    /**
     * @param array<string, mixed> $pilot
     */
    private function cloudGatesOk(array $pilot): bool
    {
        return $this->missingCloudGates($pilot) === [];
    }

    /**
     * @param array<string, mixed> $pilot
     * @return list<string>
     */
    private function missingCloudGates(array $pilot): array
    {
        $missing = [];
        foreach ([
            'dpo_approved' => 'DPO/LGPD',
            'director_approved' => 'direção',
            'admin_opt_in' => 'admin opt-in',
            'incident_ack' => 'incident ack',
        ] as $key => $label) {
            if (!$this->truthy($pilot[$key] ?? false)) {
                $missing[] = $label;
            }
        }
        if ((float) ($pilot['monthly_budget_limit'] ?? 0) <= 0) {
            $missing[] = 'budget';
        }

        return $missing;
    }

    private function truthy($value): bool
    {
        if (is_bool($value)) {
            return $value;
        }

        return in_array(strtolower(trim((string) $value)), ['1', 'true', 'yes', 'on'], true);
    }

    private function sanitizeLog(string $message): string
    {
        $message = preg_replace('/(password|senha|token|secret|bearer|api_key)\s*[:=]\s*\S+/i', '$1=[redacted]', $message) ?? '';

        return substr($message, 0, 180);
    }
}
