<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi\External\Repository;

use PDO;

final class NotificationRepository
{
    public function __construct(private readonly PDO $pdo)
    {
    }

    public function reserve(
        int $ticketId,
        string $conversationId,
        string $eventType,
        ?string $eventItemId,
        string $idempotencyKey
    ): bool {
        $statement = $this->pdo->prepare(
            <<<SQL
            INSERT INTO glpi_plugin_integaglpi_notifications (
                ticket_id,
                conversation_id,
                event_type,
                event_item_id,
                idempotency_key
            )
            VALUES (
                :ticket_id,
                :conversation_id,
                :event_type,
                :event_item_id,
                :idempotency_key
            )
            ON CONFLICT (idempotency_key) DO NOTHING
            SQL
        );
        $statement->execute([
            ':ticket_id' => $ticketId,
            ':conversation_id' => $conversationId,
            ':event_type' => $eventType,
            ':event_item_id' => $eventItemId,
            ':idempotency_key' => $idempotencyKey,
        ]);

        return $statement->rowCount() > 0;
    }

    public function markSent(string $idempotencyKey): void
    {
        $statement = $this->pdo->prepare(
            <<<SQL
            UPDATE glpi_plugin_integaglpi_notifications
            SET
                sent_at = NOW(),
                error_message = NULL
            WHERE idempotency_key = :idempotency_key
            SQL
        );
        $statement->execute([
            ':idempotency_key' => $idempotencyKey,
        ]);
    }

    public function markFailed(string $idempotencyKey, string $errorMessage): void
    {
        $statement = $this->pdo->prepare(
            <<<SQL
            UPDATE glpi_plugin_integaglpi_notifications
            SET error_message = :error_message
            WHERE idempotency_key = :idempotency_key
            SQL
        );
        if (function_exists('mb_substr')) {
            $errorMessage = mb_substr($errorMessage, 0, 1000);
        } else {
            $errorMessage = substr($errorMessage, 0, 1000);
        }

        $statement->execute([
            ':idempotency_key' => $idempotencyKey,
            ':error_message' => $errorMessage,
        ]);
    }
}
