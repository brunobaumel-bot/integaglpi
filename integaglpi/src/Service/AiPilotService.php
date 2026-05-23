<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi\Service;

use GlpiPlugin\Integaglpi\Plugin;
use RuntimeException;

final class AiPilotService
{
    private const PATH_STATUS = '/internal/glpi/ai-pilot/status';
    private const PATH_TEST = '/internal/glpi/ai-pilot/test';

    public function __construct(private readonly ?PluginConfigService $pluginConfigService = null)
    {
    }

    /**
     * @return array<string, mixed>
     */
    public function getStatus(): array
    {
        try {
            $response = $this->request('GET', self::PATH_STATUS);
            return [
                'success' => $response['success'],
                'status_code' => $response['status'],
                'body' => $response['body'],
            ];
        } catch (\Throwable $exception) {
            error_log('[integaglpi][ai_pilot][status] ' . $this->sanitizeText($exception->getMessage(), 180));
            return [
                'success' => false,
                'status_code' => 0,
                'body' => [
                    'message' => __('Status indisponível. Verifique o integration-service.', 'glpiintegaglpi'),
                ],
            ];
        }
    }

    /**
     * @return array<string, mixed>
     */
    public function runSyntheticTest(string $payload, int $userId): array
    {
        $payload = $this->sanitizeText($payload, 2000);
        if ($payload === '') {
            return [
                'success' => false,
                'status_code' => 400,
                'body' => ['message' => __('Informe um payload sintético.', 'glpiintegaglpi')],
            ];
        }

        try {
            $response = $this->request('POST', self::PATH_TEST, [
                'payload' => $payload,
                'glpi_user_id' => $userId,
            ]);
            return [
                'success' => $response['success'],
                'status_code' => $response['status'],
                'body' => $response['body'],
            ];
        } catch (\Throwable $exception) {
            error_log('[integaglpi][ai_pilot][test] ' . $this->sanitizeText($exception->getMessage(), 180));
            return [
                'success' => false,
                'status_code' => 500,
                'body' => ['message' => __('Teste do piloto indisponível.', 'glpiintegaglpi')],
            ];
        }
    }

    /**
     * @param array<string, mixed>|null $payload
     * @return array{status: int, body: array<string, mixed>, success: bool}
     */
    private function request(string $method, string $path, ?array $payload = null): array
    {
        $endpoint = $this->endpoint($path);
        $ch = curl_init($endpoint);
        if ($ch === false) {
            throw new RuntimeException('[integaglpi][ai_pilot] curl_init failed');
        }

        $headers = [
            'Authorization: Bearer ' . $this->getAuthKey(),
            'Accept: application/json',
        ];
        $options = [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 20,
            CURLOPT_HTTPHEADER => $headers,
        ];

        if ($method === 'POST') {
            $json = json_encode($payload ?? [], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
            if ($json === false) {
                throw new RuntimeException('[integaglpi][ai_pilot] json_encode failed');
            }
            $options[CURLOPT_POST] = true;
            $options[CURLOPT_POSTFIELDS] = $json;
            $headers[] = 'Content-Type: application/json';
            $options[CURLOPT_HTTPHEADER] = $headers;
        }

        curl_setopt_array($ch, $options);
        $raw = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlError = curl_error($ch);
        curl_close($ch);

        if ($raw === false || $curlError !== '') {
            throw new RuntimeException('[integaglpi][ai_pilot] curl error: ' . $curlError);
        }

        $body = json_decode((string) $raw, true);
        if (!is_array($body)) {
            $body = ['message' => __('Resposta inesperada do integration-service.', 'glpiintegaglpi')];
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

        throw new RuntimeException('[integaglpi][ai_pilot] integration auth key is not configured.');
    }

    private function endpoint(string $path): string
    {
        $configService = $this->pluginConfigService ?? new PluginConfigService();

        return rtrim($configService->getIntegrationServiceUrl(), '/') . $path;
    }

    private function sanitizeText(string $value, int $limit): string
    {
        $value = strip_tags($value);
        $value = preg_replace('/(password|senha|token|bearer|api_key|app_secret|secret)\s*[:=]\s*\S+/i', '$1=[redacted]', $value) ?? '';
        $value = preg_replace('/[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}/i', '[email]', $value) ?? '';
        $value = trim(preg_replace('/\s+/', ' ', $value) ?? '');

        return mb_substr($value, 0, $limit);
    }
}
