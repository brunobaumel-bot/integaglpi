<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi\Renderer;

use GlpiPlugin\Integaglpi\Plugin;
use GlpiPlugin\Integaglpi\Service\AiOnlineAlertService;
use GlpiPlugin\Integaglpi\Service\OnlineMonitorService;
use Html;

final class OnlineMonitorRenderer
{
    private OnlineMonitorService $service;
    private ?AiOnlineAlertService $alertService;

    public function __construct(OnlineMonitorService $service, ?AiOnlineAlertService $alertService = null)
    {
        $this->service = $service;
        $this->alertService = $alertService;
    }

    /**
     * @param array<string, mixed> $query
     */
    public function render(array $query, int $userId, bool $supervisor): void
    {
        $data = $this->service->getPageData($query, $userId, $supervisor);
        $alertData = $this->alertService !== null
            ? $this->alertService->getPanelData($query, $supervisor)
            : ['visible' => false, 'rows' => [], 'filters' => [], 'options' => [], 'error' => ''];
        $alertBadgeCounts = [];
        if ($this->alertService !== null && $supervisor && is_array($data['rows'] ?? null)) {
            $conversationIds = [];
            foreach ($data['rows'] as $row) {
                if (is_array($row) && (string) ($row['conversation_id'] ?? '') !== '') {
                    $conversationIds[] = (string) $row['conversation_id'];
                }
            }
            $alertBadgeCounts = $this->alertService->loadOpenBadgeCounts($conversationIds, $supervisor);
        }
        $template = PLUGIN_INTEGAGLPI_ROOT . '/templates/online_monitor.php';

        require $template;
    }

    public function escape(string $value): string
    {
        return Html::cleanInputText($value);
    }

    public function getOnlineMonitorUrl(): string
    {
        return Plugin::getOnlineMonitorUrl();
    }

    public function getTicketUrl(int $ticketId): string
    {
        return Plugin::getTicketUrl($ticketId);
    }

    public function getTicketContextUrl(int $ticketId): string
    {
        return Plugin::getTicketUrl($ticketId) . '&forcetab=PluginIntegaglpiTicketRuntime$2';
    }

    /**
     * @param array<string, mixed> $filters
     */
    public function getPageUrl(array $filters, int $page): string
    {
        $query = $filters;
        $query['page'] = max(1, $page);

        return $this->getOnlineMonitorUrl() . '?' . http_build_query(array_filter(
            $query,
            static function ($value): bool {
                return $value !== '' && $value !== 0 && $value !== null && $value !== [];
            }
        ));
    }

    public function renderCsrfToken(): string
    {
        return Plugin::renderCsrfToken();
    }
}
