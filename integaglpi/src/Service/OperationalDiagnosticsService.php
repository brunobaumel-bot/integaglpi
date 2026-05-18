<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi\Service;

use GlpiPlugin\Integaglpi\Plugin;

final class OperationalDiagnosticsService
{
    public function __construct(
        private readonly RuntimeGuardService $runtimeGuardService = new RuntimeGuardService(),
        private readonly IntegrationServiceClient $integrationServiceClient = new IntegrationServiceClient(new PluginConfigService())
    ) {
    }

    /**
     * @return array<string, mixed>
     */
    public function getDiagnostics(): array
    {
        $localManifest = $this->runtimeGuardService->getLocalManifestStatus();
        $nodeDiagnostics = null;
        $nodeError = null;

        try {
            $response = $this->integrationServiceClient->getDiagnostics();
            if (($response['success'] ?? false) === true && is_array($response['body'] ?? null)) {
                $nodeDiagnostics = $response['body'];
            } else {
                $nodeError = [
                    'category' => 'external_api',
                    'message' => sprintf('integration-service retornou HTTP %d.', (int) ($response['status'] ?? 0)),
                ];
            }
        } catch (\Throwable $exception) {
            $nodeError = [
                'category' => $this->classifyThrowable($exception),
                'message' => $this->sanitizeMessage($exception->getMessage()),
            ];
        }

        $comparison = $this->runtimeGuardService->compareWithNode($nodeDiagnostics);

        return [
            'plugin' => [
                'version' => defined('PLUGIN_INTEGAGLPI_VERSION') ? (string) PLUGIN_INTEGAGLPI_VERSION : 'unknown',
                'build_id' => (string) ($localManifest['build_id'] ?? ''),
                'package_id' => (string) ($localManifest['package_id'] ?? ''),
                'manifest_status' => (string) ($localManifest['status'] ?? 'package_incomplete'),
            ],
            'local_manifest' => $localManifest,
            'node' => [
                'available' => $nodeDiagnostics !== null,
                'error' => $nodeError,
                'diagnostics' => $nodeDiagnostics,
            ],
            'runtime_consistency' => $comparison,
            'diagnostic_categories' => RuntimeGuardService::DIAGNOSTIC_CATEGORIES,
            'opcache' => [
                'loaded' => extension_loaded('Zend OPcache'),
                'enabled_hint' => (string) ini_get('opcache.enable'),
                'readiness_hint' => __('Após pacote manual no cloud, reinicie PHP-FPM/LSWS ou invalide OPcache conforme o playbook.', 'glpiintegaglpi'),
            ],
            'read_only' => true,
            'admin_diagnostic_enabled' => Plugin::canSupervisorRead(),
        ];
    }

    private function classifyThrowable(\Throwable $exception): string
    {
        $message = strtolower($exception->getMessage());
        if (str_contains($message, 'timeout') || str_contains($message, 'timed out')) {
            return 'timeout';
        }
        if (str_contains($message, 'permission') || str_contains($message, '403')) {
            return 'permission';
        }
        if (str_contains($message, 'schema') || str_contains($message, 'column') || str_contains($message, 'table')) {
            return 'schema';
        }
        if (str_contains($message, 'curl') || str_contains($message, 'connection')) {
            return 'connection';
        }

        return 'external_api';
    }

    private function sanitizeMessage(string $message): string
    {
        $message = preg_replace('/Bearer\s+[A-Za-z0-9._~+\/=-]+/i', 'Bearer [masked]', $message) ?? $message;
        $message = preg_replace('/(token|password|secret|api[_-]?key)=([^&\s]+)/i', '$1=[masked]', $message) ?? $message;
        $message = preg_replace('/https?:\/\/([^:@\/\s]+):([^@\/\s]+)@/i', 'https://[masked]@', $message) ?? $message;

        return substr($message, 0, 220);
    }
}
