<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi\Service;

use Throwable;

final class ObservabilityService
{
    private const DEFAULT_LIMIT = 20;

    public function __construct(private readonly PluginConfigService $pluginConfigService)
    {
    }

    /**
     * @param array<string, mixed> $query
     * @return array<string, mixed>
     */
    public function getDashboardData(array $query): array
    {
        $filters = $this->normalizeFilters($query);
        if (!$this->pluginConfigService->isConfigured()) {
            return $this->emptyData($filters, __('Integração não configurada.', 'glpiintegaglpi'));
        }

        try {
            $response = (new IntegrationServiceClient($this->pluginConfigService))->getObservability($filters);
        } catch (Throwable $exception) {
            error_log('[integaglpi][observability][error] ' . $this->sanitizeLogMessage($exception->getMessage()));

            return $this->emptyData($filters, __('Não foi possível carregar a Observabilidade agora.', 'glpiintegaglpi'));
        }

        $body = $response['body'];
        if (!$response['success']) {
            return $this->emptyData(
                $filters,
                (string) ($body['message'] ?? __('Falha ao carregar Observabilidade.', 'glpiintegaglpi'))
            );
        }

        return [
            'filters' => $filters,
            'health' => is_array($body['health'] ?? null) ? $body['health'] : [],
            'environment' => is_array($body['environment'] ?? null) ? $body['environment'] : [],
            'cards' => is_array($body['cards'] ?? null) ? $body['cards'] : [],
            'latest' => is_array($body['latest'] ?? null) ? $body['latest'] : [],
            'events' => is_array($body['events'] ?? null) ? $body['events'] : [],
            'pagination' => is_array($body['pagination'] ?? null) ? $body['pagination'] : [],
            'safety' => is_array($body['safety'] ?? null) ? $body['safety'] : [],
            'error' => '',
            'read_only' => (bool) ($body['read_only'] ?? true),
        ];
    }

    /**
     * @param array<string, mixed> $query
     * @return array<string, mixed>
     */
    private function normalizeFilters(array $query): array
    {
        $period = (int) ($query['period'] ?? 1);
        if (!in_array($period, [1, 7, 30], true)) {
            $period = 1;
        }

        return [
            'period' => $period,
            'severity' => $this->allow((string) ($query['severity'] ?? ''), ['', 'debug', 'info', 'warning', 'error', 'critical']),
            'event_type' => $this->normalizeString((string) ($query['event_type'] ?? ''), 80),
            'ticket_id' => max(0, (int) ($query['ticket_id'] ?? 0)),
            'phone' => $this->normalizeString((string) ($query['phone'] ?? ''), 20),
            'source' => $this->normalizeString((string) ($query['source'] ?? ''), 80),
            'page' => max(1, (int) ($query['page'] ?? 1)),
            'limit' => max(1, min((int) ($query['limit'] ?? self::DEFAULT_LIMIT), 50)),
        ];
    }

    /**
     * @param list<string> $allowed
     */
    private function allow(string $value, array $allowed): string
    {
        $value = trim($value);

        return in_array($value, $allowed, true) ? $value : '';
    }

    private function normalizeString(string $value, int $maxLength): string
    {
        $value = trim($value);
        if ($value === '') {
            return '';
        }

        return mb_substr(preg_replace('/[^\p{L}\p{N}_:+.\-@ ]/u', '', $value) ?? '', 0, $maxLength);
    }

    /**
     * @param array<string, mixed> $filters
     * @return array<string, mixed>
     */
    private function emptyData(array $filters, string $error): array
    {
        return [
            'filters' => $filters,
            'health' => [],
            'environment' => [],
            'cards' => [],
            'latest' => [],
            'events' => [],
            'pagination' => ['page' => 1, 'limit' => self::DEFAULT_LIMIT, 'total' => 0, 'total_pages' => 1],
            'safety' => ['read_only' => true],
            'error' => $error,
            'read_only' => true,
        ];
    }

    private function sanitizeLogMessage(string $message): string
    {
        $message = preg_replace('/(password|token|secret|authorization|bearer)\s*[:=]\s*[^,\s]+/i', '$1=[redacted]', $message) ?? '';

        return mb_substr($message, 0, 240);
    }
}
