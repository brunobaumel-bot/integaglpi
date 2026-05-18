<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi\External\Repository;

use PDO;

final class MessageRepository
{
    private const MAX_LIMIT = 50;

    public function __construct(private readonly PDO $pdo)
    {
    }

    /**
     * @return list<array<string, mixed>>
     */
    public function findByConversationId(string $conversationId, int $limit = self::MAX_LIMIT): array
    {
        $safeLimit = $this->normalizeLimit($limit);
        $statement = $this->pdo->prepare(
            <<<SQL
            SELECT *
            FROM (
                SELECT
                    id,
                    conversation_id,
                    message_id,
                    direction,
                    sender_phone,
                    recipient_phone,
                    message_type,
                    message_text,
                    processing_status,
                    glpi_sync_status,
                    meta_message_id,
                    delivery_status,
                    delivery_status_updated_at,
                    meta_error_code,
                    meta_error_message_sanitized,
                    created_at,
                    updated_at
                FROM glpi_plugin_integaglpi_messages
                WHERE conversation_id = :conversation_id
                ORDER BY created_at DESC, id DESC
                LIMIT :limit
            ) recent
            ORDER BY created_at ASC, id ASC
            SQL
        );
        $statement->bindValue(':conversation_id', $conversationId);
        $statement->bindValue(':limit', $safeLimit, PDO::PARAM_INT);
        $statement->execute();

        $rows = $statement->fetchAll();

        return is_array($rows) ? $rows : [];
    }

    /**
     * @return list<array<string, mixed>>
     */
    public function findNewerByConversationId(
        string $conversationId,
        ?string $afterCreatedAt,
        ?string $afterId,
        int $limit
    ): array {
        if ($afterCreatedAt === null || trim($afterCreatedAt) === '') {
            return $this->findByConversationId($conversationId, $limit);
        }

        $where = ['conversation_id = :conversation_id'];
        $params = [
            ':conversation_id' => $conversationId,
        ];

        $where[] = '(created_at > :after_created_at OR (created_at = :after_created_at AND id > :after_id))';
        $params[':after_created_at'] = $afterCreatedAt;
        $params[':after_id'] = $afterId !== null && trim($afterId) !== '' ? $afterId : '';

        $statement = $this->pdo->prepare(
            sprintf(
                <<<SQL
                SELECT
                    id,
                    conversation_id,
                    message_id,
                    direction,
                    sender_phone,
                    recipient_phone,
                    message_type,
                    message_text,
                    processing_status,
                    glpi_sync_status,
                    meta_message_id,
                    delivery_status,
                    delivery_status_updated_at,
                    meta_error_code,
                    meta_error_message_sanitized,
                    created_at,
                    updated_at
                FROM glpi_plugin_integaglpi_messages
                WHERE %s
                ORDER BY created_at ASC, id ASC
                LIMIT :limit
                SQL,
                implode(' AND ', $where)
            )
        );

        foreach ($params as $key => $value) {
            $statement->bindValue($key, $value);
        }
        $statement->bindValue(':limit', $this->normalizeLimit($limit), PDO::PARAM_INT);
        $statement->execute();

        $rows = $statement->fetchAll();

        return is_array($rows) ? $rows : [];
    }

    private function normalizeLimit(int $limit): int
    {
        return max(1, min(self::MAX_LIMIT, $limit));
    }
}
