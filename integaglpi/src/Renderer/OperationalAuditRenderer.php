<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi\Renderer;

use GlpiPlugin\Integaglpi\Plugin;
use GlpiPlugin\Integaglpi\Service\AuditPayloadViewService;
use GlpiPlugin\Integaglpi\Service\OperationalAuditService;
use Html;

final class OperationalAuditRenderer
{
    private AuditPayloadViewService $payloadViewService;

    public function __construct(
        private readonly OperationalAuditService $auditService,
        ?AuditPayloadViewService $payloadViewService = null
    ) {
        $this->payloadViewService = $payloadViewService ?? new AuditPayloadViewService();
    }

    /**
     * @param array<string, mixed> $query
     */
    public function render(array $query): void
    {
        $data = $this->auditService->getAuditData($query);
        $template = PLUGIN_INTEGAGLPI_ROOT . '/templates/audit.php';

        require $template;
    }

    public function escape(string $value): string
    {
        return Html::cleanInputText($value);
    }

    public function getAuditUrl(): string
    {
        return Plugin::getAuditUrl();
    }

    public function getTicketUrl(int $ticketId): string
    {
        return Plugin::getTicketUrl($ticketId);
    }

    public function getAuditUrlForTicket(int $ticketId): string
    {
        return Plugin::getAuditUrl() . '?' . http_build_query([
            'ticket_id' => $ticketId,
        ]);
    }

    public function renderPayload(mixed $payload): string
    {
        return $this->payloadViewService->renderPayload($payload);
    }

    /**
     * @param array<string, mixed> $filters
     */
    public function getPageUrl(array $filters, int $page, int $limit): string
    {
        $query = $this->buildQuery($filters, $page, $limit);

        return $this->getAuditUrl() . '?' . http_build_query($query);
    }

    /**
     * @param array<string, mixed> $filters
     */
    public function getDetailUrl(array $filters, string $key, int $id, int $page, int $limit): string
    {
        $query = $this->buildQuery($filters, $page, $limit);
        $query[$key] = $id;

        return $this->getAuditUrl() . '?' . http_build_query($query);
    }

    /**
     * @param array<string, mixed> $filters
     */
    public function getHealthFilterUrl(array $filters): string
    {
        $query = array_merge(
            [
                'date_from' => (new \DateTimeImmutable('-24 hours'))->format('Y-m-d\TH:i'),
                'date_to' => (new \DateTimeImmutable('now'))->format('Y-m-d\TH:i'),
                'limit' => 50,
            ],
            $filters
        );

        return $this->getAuditUrl() . '?' . http_build_query(
            array_filter(
                $query,
                static fn (mixed $value): bool => $value !== '' && $value !== 0 && $value !== []
            )
        );
    }

    /**
     * @param array<string, mixed> $filters
     * @return array<string, mixed>
     */
    private function buildQuery(array $filters, int $page, int $limit): array
    {
        $query = [
            'ticket_id' => (int) ($filters['ticket_id'] ?? 0),
            'correlation_id' => (string) ($filters['correlation_id'] ?? ''),
            'conversation_id' => (string) ($filters['conversation_id'] ?? ''),
            'message_id' => (string) ($filters['message_id'] ?? ''),
            'event_type' => (string) ($filters['event_type'] ?? ''),
            'severity' => (string) ($filters['severity'] ?? ''),
            'status' => (string) ($filters['status'] ?? ''),
            'source' => (string) ($filters['source'] ?? ''),
            'only_errors' => !empty($filters['only_errors']) ? '1' : '',
            'date_from' => (string) ($filters['date_from'] ?? ''),
            'date_to' => (string) ($filters['date_to'] ?? ''),
            'page' => $page,
            'limit' => $limit,
        ];

        return array_filter(
            $query,
            static fn (mixed $value): bool => $value !== '' && $value !== 0
        );
    }
}
