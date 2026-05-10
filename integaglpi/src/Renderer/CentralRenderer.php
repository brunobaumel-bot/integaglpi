<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi\Renderer;

use GlpiPlugin\Integaglpi\Plugin;
use GlpiPlugin\Integaglpi\Service\AttendanceCenterService;
use Html;

final class CentralRenderer
{
    public function __construct(private readonly AttendanceCenterService $attendanceCenterService)
    {
    }

    /**
     * @param array<string, mixed> $query
     */
    public function render(array $query): void
    {
        $data = $this->attendanceCenterService->getCentralData($query);
        $template = PLUGIN_INTEGAGLPI_ROOT . '/templates/central.php';

        require $template;
    }

    public function escape(string $value): string
    {
        return Html::cleanInputText($value);
    }

    public function getCentralUrl(): string
    {
        return Plugin::getWebBasePath() . '/front/central.php';
    }

    public function getCentralActionUrl(): string
    {
        return Plugin::getWebBasePath() . '/front/central.action.php';
    }

    public function getCentralRefreshUrl(): string
    {
        return Plugin::getWebBasePath() . '/front/central.refresh.php';
    }

    public function getCentralMessagesUrl(): string
    {
        return Plugin::getWebBasePath() . '/front/central.messages.php';
    }

    public function getCsrfToken(): string
    {
        return Plugin::getCsrfToken();
    }

    public function getCurrentUserId(): int
    {
        return Plugin::getCurrentUserId();
    }

    public function getTicketUrl(int $ticketId): string
    {
        return $this->getTicketUrlBase() . $ticketId;
    }

    public function getTicketUrlBase(): string
    {
        global $CFG_GLPI;

        return rtrim((string) ($CFG_GLPI['root_doc'] ?? ''), '/') . '/front/ticket.form.php?id=';
    }

    /**
     * @param array<string, mixed> $filters
     */
    public function getPageUrl(array $filters, int $page, int $limit): string
    {
        $query = [
            'status' => (string) ($filters['status'] ?? ''),
            'queue_id' => (int) ($filters['queue_id'] ?? 0),
            'search' => (string) ($filters['search'] ?? ''),
            'page' => $page,
            'limit' => $limit,
        ];

        return $this->getCentralUrl() . '?' . http_build_query(array_filter(
            $query,
            static fn (mixed $value): bool => $value !== '' && $value !== 0
        ));
    }
}
