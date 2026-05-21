<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi\Service;

use GlpiPlugin\Integaglpi\External\ExternalDatabase;
use PDO;
use RuntimeException;

final class AttachmentRetentionService
{
    private ?PDO $pdo = null;

    public function __construct(private readonly PluginConfigService $pluginConfigService)
    {
    }

    public function softDelete(string $messageId, int $userId): void
    {
        $row = $this->findAttachmentMessage($messageId);
        if ($row === null) {
            throw new RuntimeException(__('Attachment message not found.', 'glpiintegaglpi'));
        }

        $statement = $this->connection()->prepare(
            <<<SQL
            UPDATE glpi_plugin_integaglpi_messages
            SET
                is_deleted = TRUE,
                deleted_at = NOW(),
                deleted_by_user_id = :user_id,
                attachment_status = 'deleted',
                updated_at = NOW()
            WHERE message_id = :message_id
            SQL
        );
        $statement->bindValue(':user_id', $userId, PDO::PARAM_INT);
        $statement->bindValue(':message_id', $messageId, PDO::PARAM_STR);
        $statement->execute();

        $this->audit('ATTACHMENT_SOFT_DELETED', $row, $userId, 'success');
    }

    public function restore(string $messageId, int $userId): void
    {
        $row = $this->findAttachmentMessage($messageId);
        if ($row === null) {
            throw new RuntimeException(__('Attachment message not found.', 'glpiintegaglpi'));
        }

        $nextStatus = $this->statusFromMediaInfo($row);
        $statement = $this->connection()->prepare(
            <<<SQL
            UPDATE glpi_plugin_integaglpi_messages
            SET
                is_deleted = FALSE,
                deleted_at = NULL,
                deleted_by_user_id = NULL,
                attachment_status = :attachment_status,
                updated_at = NOW()
            WHERE message_id = :message_id
            SQL
        );
        $statement->bindValue(':attachment_status', $nextStatus, PDO::PARAM_STR);
        $statement->bindValue(':message_id', $messageId, PDO::PARAM_STR);
        $statement->execute();

        $row['attachment_status'] = $nextStatus;
        $this->audit('ATTACHMENT_RESTORED', $row, $userId, 'success');
    }

    /**
     * @return array<string, mixed>|null
     */
    private function findAttachmentMessage(string $messageId): ?array
    {
        $statement = $this->connection()->prepare(
            <<<SQL
            SELECT
                id,
                conversation_id,
                message_id,
                media_info,
                attachment_hash,
                attachment_status,
                attachment_blocked_reason,
                attachment_mime_detected,
                attachment_extension,
                attachment_size_bytes,
                attachment_filename_sanitized,
                is_deleted
            FROM glpi_plugin_integaglpi_messages
            WHERE message_id = :message_id
              AND (
                media_info IS NOT NULL
                OR attachment_hash IS NOT NULL
                OR attachment_status <> 'received'
              )
            LIMIT 1
            SQL
        );
        $statement->bindValue(':message_id', $messageId, PDO::PARAM_STR);
        $statement->execute();
        $row = $statement->fetch();

        return is_array($row) ? $row : null;
    }

    /**
     * @param array<string, mixed> $row
     */
    private function statusFromMediaInfo(array $row): string
    {
        $mediaInfo = $row['media_info'] ?? null;
        if (is_string($mediaInfo)) {
            $decoded = json_decode($mediaInfo, true);
            $mediaInfo = is_array($decoded) ? $decoded : [];
        }
        if (!is_array($mediaInfo)) {
            $mediaInfo = [];
        }

        $status = trim((string) ($mediaInfo['attachment_status'] ?? $mediaInfo['status'] ?? $row['attachment_status'] ?? 'synced'));
        if (in_array($status, ['received', 'validated', 'blocked', 'synced', 'failed'], true)) {
            return $status;
        }

        if ($status === 'error' || $status === 'uploaded_unlinked') {
            return 'failed';
        }

        return 'synced';
    }

    /**
     * @param array<string, mixed> $row
     */
    private function audit(string $eventType, array $row, int $userId, string $status): void
    {
        try {
            $statement = $this->connection()->prepare(
                <<<SQL
                INSERT INTO glpi_plugin_integaglpi_audit_events (
                    correlation_id,
                    conversation_id,
                    message_id,
                    direction,
                    event_type,
                    status,
                    severity,
                    source,
                    payload_json,
                    created_at
                ) VALUES (
                    :correlation_id,
                    :conversation_id,
                    :message_id,
                    :direction,
                    :event_type,
                    :status,
                    'info',
                    'PluginAttachmentRetention',
                    :payload_json::jsonb,
                    NOW()
                )
                SQL
            );
            $messageId = (string) ($row['message_id'] ?? '');
            $statement->bindValue(':correlation_id', 'attachment_retention:' . $messageId, PDO::PARAM_STR);
            $statement->bindValue(':conversation_id', (string) ($row['conversation_id'] ?? ''), PDO::PARAM_STR);
            $statement->bindValue(':message_id', $messageId, PDO::PARAM_STR);
            $statement->bindValue(':direction', null, PDO::PARAM_NULL);
            $statement->bindValue(':event_type', $eventType, PDO::PARAM_STR);
            $statement->bindValue(':status', $status, PDO::PARAM_STR);
            $statement->bindValue(':payload_json', json_encode([
                'user_id' => $userId,
                'filename_sanitized' => (string) ($row['attachment_filename_sanitized'] ?? ''),
                'mime_detected' => (string) ($row['attachment_mime_detected'] ?? ''),
                'extension' => (string) ($row['attachment_extension'] ?? ''),
                'size_bytes' => is_numeric($row['attachment_size_bytes'] ?? null) ? (int) $row['attachment_size_bytes'] : null,
                'hash' => (string) ($row['attachment_hash'] ?? ''),
                'status' => (string) ($row['attachment_status'] ?? ''),
                'reason' => (string) ($row['attachment_blocked_reason'] ?? ''),
            ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE), PDO::PARAM_STR);
            $statement->execute();
        } catch (\Throwable $exception) {
            error_log('[integaglpi][attachment-retention][audit_failed] ' . $exception->getMessage());
        }
    }

    private function connection(): PDO
    {
        if ($this->pdo === null) {
            $this->pdo = ExternalDatabase::getConnection($this->pluginConfigService->getConnectionConfig());
        }

        return $this->pdo;
    }
}
