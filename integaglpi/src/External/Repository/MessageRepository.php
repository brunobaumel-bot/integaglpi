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
                    raw_payload,
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

        return is_array($rows) ? $this->decorateReplyContext($rows) : [];
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
                    raw_payload,
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

        return is_array($rows) ? $this->decorateReplyContext($rows) : [];
    }

    /**
     * @param list<array<string, mixed>> $rows
     * @return list<array<string, mixed>>
     */
    private function decorateReplyContext(array $rows): array
    {
        foreach ($rows as &$row) {
            $contextMessageId = $this->extractReplyContextMessageId($row);
            unset($row['raw_payload']);

            if ($contextMessageId === null) {
                continue;
            }

            $currentText = trim((string) ($row['message_text'] ?? ''));
            if (strncmp($currentText, 'Em resposta a:', strlen('Em resposta a:')) === 0) {
                continue;
            }

            $preview = $this->findMessagePreviewByMessageId($contextMessageId);
            $reference = $preview !== null
                ? $this->truncateReplyPreview($preview)
                : sprintf('mensagem WhatsApp %s', $contextMessageId);
            $body = $currentText !== ''
                ? $currentText
                : sprintf('[%s]', (string) ($row['message_type'] ?? 'message'));

            $row['message_text'] = sprintf("Em resposta a: %s\n\n%s", $reference, $body);
        }
        unset($row);

        return $rows;
    }

    /**
     * @param array<string, mixed> $row
     */
    private function extractReplyContextMessageId(array $row): ?string
    {
        $rawPayload = $row['raw_payload'] ?? null;
        if (is_string($rawPayload)) {
            $decoded = json_decode($rawPayload, true);
            $rawPayload = is_array($decoded) ? $decoded : null;
        }

        if (!is_array($rawPayload)) {
            return null;
        }

        $currentMessageId = trim((string) ($row['message_id'] ?? ''));
        foreach (($rawPayload['entry'] ?? []) as $entry) {
            if (!is_array($entry)) {
                continue;
            }
            foreach (($entry['changes'] ?? []) as $change) {
                if (!is_array($change)) {
                    continue;
                }
                $value = $change['value'] ?? null;
                if (!is_array($value)) {
                    continue;
                }
                $messages = $value['messages'] ?? null;
                if (!is_array($messages)) {
                    continue;
                }
                foreach ($messages as $message) {
                    if (!is_array($message)) {
                        continue;
                    }
                    $messageId = trim((string) ($message['id'] ?? ''));
                    if ($currentMessageId !== '' && $messageId !== $currentMessageId) {
                        continue;
                    }
                    $context = $message['context'] ?? null;
                    if (!is_array($context)) {
                        continue;
                    }
                    $contextId = trim((string) ($context['id'] ?? ''));
                    return $contextId !== '' ? $contextId : null;
                }
            }
        }

        return null;
    }

    private function findMessagePreviewByMessageId(string $messageId): ?string
    {
        $statement = $this->pdo->prepare(
            <<<SQL
            SELECT message_text
            FROM glpi_plugin_integaglpi_messages
            WHERE message_id = :message_id
            LIMIT 1
            SQL
        );
        $statement->execute([':message_id' => $messageId]);
        $value = $statement->fetchColumn();
        $text = is_string($value) ? trim($value) : '';

        return $text !== '' ? $text : null;
    }

    private function truncateReplyPreview(string $value): string
    {
        $normalized = trim((string) preg_replace('/\s+/', ' ', $value));
        if (function_exists('mb_strlen') && function_exists('mb_substr')) {
            return mb_strlen($normalized) <= 180
                ? $normalized
                : rtrim(mb_substr($normalized, 0, 177)) . '...';
        }

        return strlen($normalized) <= 180
            ? $normalized
            : rtrim(substr($normalized, 0, 177)) . '...';
    }

    private function normalizeLimit(int $limit): int
    {
        return max(1, min(self::MAX_LIMIT, $limit));
    }
}
