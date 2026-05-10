<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi\Service;

use GlpiPlugin\Integaglpi\External\ExternalDatabase;
use PDO;
use Throwable;

final class NotificationSuppressionService
{
    private const STATUS_PROCESSING = 2;
    private const STATUS_CLOSED = 6;
    private const RECENT_WINDOW_SECONDS = 30;

    private PluginConfigService $pluginConfigService;

    private ?PDO $pdo = null;

    public function __construct(?PluginConfigService $pluginConfigService = null)
    {
        $this->pluginConfigService = $pluginConfigService ?? new PluginConfigService();
    }

    public function shouldSuppressTicketStatusNotification(
        int $ticketId,
        int $newStatus,
        ?int $actorUserId = null
    ): bool {
        if ($ticketId <= 0) {
            return false;
        }

        if ($newStatus !== self::STATUS_PROCESSING) {
            return false;
        }

        if (!$this->hasRecentSuccessfulSolutionAction($ticketId, 'reopen')) {
            return false;
        }

        $this->log('notification_suppressed_node_reopen', [
            'ticket_id' => $ticketId,
            'new_status' => $newStatus,
            'actor_user_id' => $actorUserId,
            'reason' => 'recent_solution_reopen_action',
        ]);

        return true;
    }

    public function logClosedNotificationDecision(int $ticketId, ?int $actorUserId = null): void
    {
        if ($ticketId <= 0) {
            return;
        }

        if ($this->hasRecentSuccessfulSolutionAction($ticketId, 'approve')) {
            $this->log('notification_allowed_node_closed', [
                'ticket_id' => $ticketId,
                'new_status' => self::STATUS_CLOSED,
                'actor_user_id' => $actorUserId,
                'reason' => 'approve_flow_uses_php_closed_notification',
            ]);

            return;
        }

        $this->log('notification_allowed_human_status_change', [
            'ticket_id' => $ticketId,
            'new_status' => self::STATUS_CLOSED,
            'actor_user_id' => $actorUserId,
            'reason' => 'no_recent_node_approve_action',
        ]);
    }

    private function hasRecentSuccessfulSolutionAction(int $ticketId, string $action): bool
    {
        if (!$this->pluginConfigService->isConfigured()) {
            return false;
        }

        try {
            $statement = $this->getPdo()->prepare(
                <<<'SQL'
                SELECT status
                FROM glpi_plugin_integaglpi_solution_actions
                WHERE ticket_id = :ticket_id
                  AND action = :action
                  AND status = 'success'
                  AND updated_at > NOW() - INTERVAL '30 seconds'
                ORDER BY updated_at DESC
                LIMIT 1
                SQL
            );
            $statement->execute([
                ':ticket_id' => $ticketId,
                ':action' => $action,
            ]);

            return $statement->fetch(PDO::FETCH_ASSOC) !== false;
        } catch (Throwable $exception) {
            $this->log('solution_actions_lookup_failed_fail_open', [
                'ticket_id' => $ticketId,
                'action' => $action,
                'window_seconds' => self::RECENT_WINDOW_SECONDS,
                'message' => $exception->getMessage(),
            ]);

            return false;
        }
    }

    private function getPdo(): PDO
    {
        if ($this->pdo instanceof PDO) {
            return $this->pdo;
        }

        $this->pdo = ExternalDatabase::getConnection($this->pluginConfigService->getConnectionConfig());

        return $this->pdo;
    }

    /**
     * @param array<string, mixed> $context
     */
    private function log(string $event, array $context): void
    {
        error_log('[integaglpi][notification][' . $event . '] ' . json_encode(
            $context,
            JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES
        ));
    }
}
