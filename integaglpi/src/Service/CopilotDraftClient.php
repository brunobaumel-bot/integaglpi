<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi\Service;

use GlpiPlugin\Integaglpi\Plugin;
use RuntimeException;

final class CopilotDraftClient
{
    private const PATH_COPILOT_DRAFT = '/internal/glpi/copilot/draft';

    public function __construct(private readonly ?PluginConfigService $pluginConfigService = null)
    {
    }

    /**
     * @param array<string, mixed> $payload
     * @return array{status: int, body: array<string, mixed>, success: bool}
     */
    public function post(array $payload): array
    {
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

        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => 35,
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => $json,
            CURLOPT_HTTPHEADER     => [
                'Content-Type: application/json',
                'Authorization: Bearer ' . $this->getAuthKey(),
            ],
        ]);

        $raw = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlError = curl_error($ch);
        curl_close($ch);

        if ($raw === false || $curlError !== '') {
            throw new RuntimeException('[integaglpi][copilot] curl error: ' . $curlError);
        }

        $body = json_decode((string) $raw, true);
        if (!is_array($body)) {
            $body = [
                'message' => __('Resposta inesperada do integration-service.', 'glpiintegaglpi'),
            ];
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
}
