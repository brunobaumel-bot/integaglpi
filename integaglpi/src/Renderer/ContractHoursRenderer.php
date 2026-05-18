<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi\Renderer;

use GlpiPlugin\Integaglpi\Plugin;
use GlpiPlugin\Integaglpi\Service\ContractHoursService;
use Html;

final class ContractHoursRenderer
{
    public function __construct(private readonly ContractHoursService $service)
    {
    }

    /**
     * @param array<string, mixed> $query
     * @param array{type: string, message: string}|null $flash
     */
    public function render(array $query, ?array $flash = null): void
    {
        $data = $this->service->getPageData($query, $flash);
        $template = PLUGIN_INTEGAGLPI_ROOT . '/templates/contracts_hours.php';

        require $template;
    }

    public function escape(string $value): string
    {
        return Html::cleanInputText($value);
    }

    public function getContractHoursUrl(): string
    {
        return Plugin::getContractHoursUrl();
    }

    public function getSupervisorBackofficeUrl(): string
    {
        return Plugin::getSupervisorBackofficeUrl();
    }

    public function getTicketUrl(int $ticketId): string
    {
        return Plugin::getTicketUrl($ticketId);
    }

    public function canUpdate(): bool
    {
        try {
            if (method_exists(Plugin::class, 'canContractUpdate')) {
                return (bool) Plugin::canContractUpdate();
            }

            $rightName = defined(Plugin::class . '::RIGHT_NAME')
                ? (string) constant(Plugin::class . '::RIGHT_NAME')
                : 'plugin_integaglpi';
            $updateRight = defined('UPDATE') ? (int) constant('UPDATE') : 2;

            return class_exists('\\Session')
                ? (bool) \Session::haveRight($rightName, $updateRight)
                : false;
        } catch (\Throwable $exception) {
            error_log('[integaglpi][contracts-hours][permission] ' . $exception->getMessage());
            return false;
        }
    }

    public function renderCsrfToken(): string
    {
        return Plugin::renderCsrfToken();
    }

    /**
     * @param array<string, mixed> $filters
     */
    public function getPageUrl(array $filters, int $page): string
    {
        $query = $filters;
        $query['page'] = $page;

        return $this->getContractHoursUrl() . '?' . http_build_query($this->cleanQuery($query));
    }

    /**
     * @param array<string, mixed> $filters
     */
    public function getAdjustmentPageUrl(array $filters, int $page): string
    {
        $query = $filters;
        $query['adjustment_page'] = $page;

        return $this->getContractHoursUrl() . '?' . http_build_query($this->cleanQuery($query));
    }

    /**
     * @param array<string, mixed> $filters
     */
    public function getEditUrl(array $filters, int $contractId): string
    {
        $query = $filters;
        $query['edit_contract_id'] = $contractId;

        return $this->getContractHoursUrl() . '?' . http_build_query($this->cleanQuery($query));
    }

    /**
     * @param array<string, mixed> $query
     * @return array<string, mixed>
     */
    private function cleanQuery(array $query): array
    {
        return array_filter(
            $query,
            static fn (mixed $value): bool => $value !== '' && $value !== 0 && $value !== [] && $value !== null
        );
    }
}
