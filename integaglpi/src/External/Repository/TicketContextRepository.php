<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi\External\Repository;

use PDO;

final class TicketContextRepository
{
    public function __construct(private readonly PDO $pdo)
    {
    }

    /**
     * Returns at most two rows to detect whether multiple conversations exist without a COUNT.
     *
     * @return list<array<string, mixed>>
     */
    public function findRecentConversationsByTicketId(int $ticketId): array
    {
        $statement = $this->pdo->prepare(
            <<<SQL
            SELECT
                c.id AS conversation_id,
                c.contact_id,
                c.phone_e164,
                c.glpi_ticket_id,
                c.status AS conversation_status,
                c.last_message_at,
                c.created_at AS conversation_created_at,
                c.updated_at AS conversation_updated_at,
                ct.name AS contact_name,
                rt.queue_id,
                rt.assigned_user_id,
                rt.assigned_group_id,
                rt.status AS runtime_status,
                rt.claimed_at,
                rt.transferred_at,
                rt.closed_at,
                rt.created_at AS runtime_created_at,
                rt.updated_at AS runtime_updated_at,
                q.name AS queue_name,
                to_jsonb(cps) AS profile_snapshot_json,
                cem.glpi_entity_id AS memory_entity_id,
                cem.glpi_entity_name AS memory_entity_name,
                cp.email_address,
                cp.email_status,
                cp.glpi_user_id,
                cp.glpi_user_link_status,
                cp.glpi_user_link_source,
                cp.glpi_user_created_by_integaglpi
            FROM glpi_plugin_integaglpi_conversations c
            LEFT JOIN glpi_plugin_integaglpi_contacts ct
                ON ct.id = c.contact_id
            LEFT JOIN glpi_plugin_integaglpi_conversation_runtime rt
                ON rt.conversation_id = c.id
            LEFT JOIN glpi_plugin_integaglpi_queues q
                ON q.id = COALESCE(rt.queue_id, c.queue_id)
            LEFT JOIN glpi_plugin_integaglpi_conversation_profile_snapshot cps
                ON cps.conversation_id = c.id
            LEFT JOIN glpi_plugin_integaglpi_contact_entity_memory cem
                ON cem.phone_e164 = c.phone_e164
                AND cem.is_active = TRUE
            LEFT JOIN glpi_plugin_integaglpi_contact_profile cp
                ON cp.phone_e164 = c.phone_e164
                AND cp.is_active = TRUE
            WHERE c.glpi_ticket_id = :ticket_id
            ORDER BY c.updated_at DESC NULLS LAST, c.last_message_at DESC NULLS LAST
            LIMIT 2
            SQL
        );
        $statement->bindValue(':ticket_id', $ticketId, PDO::PARAM_INT);
        $statement->execute();
        $rows = $statement->fetchAll();

        return is_array($rows) ? $rows : [];
    }

    /**
     * @return array<string, mixed>|null
     */
    public function findLatestCsatByTicketId(int $ticketId): ?array
    {
        if (!$this->hasCsatColumns()) {
            return null;
        }

        $statement = $this->pdo->prepare(
            <<<SQL
            SELECT
                action,
                status,
                csat_rating,
                supervisor_review_required,
                updated_at
            FROM glpi_plugin_integaglpi_solution_actions
            WHERE ticket_id = :ticket_id
              AND csat_rating IS NOT NULL
            ORDER BY updated_at DESC
            LIMIT 1
            SQL
        );
        $statement->bindValue(':ticket_id', $ticketId, PDO::PARAM_INT);
        $statement->execute();
        $row = $statement->fetch();

        return is_array($row) ? $row : null;
    }

    /**
     * @return array<string, mixed>|null
     */
    public function findLatestAiQualityAnalysisByTicketId(int $ticketId): ?array
    {
        if (!$this->hasAiQualityAnalysesTable()) {
            return null;
        }

        $statement = $this->pdo->prepare(
            <<<SQL
            SELECT
                id,
                conversation_id,
                glpi_ticket_id,
                analysis_version,
                provider,
                model,
                status,
                classification_resolution,
                sentiment,
                flags,
                summary,
                recommendation,
                supervisor_feedback,
                feedback_notes,
                created_by,
                created_at,
                updated_at
            FROM glpi_plugin_integaglpi_ai_quality_analyses
            WHERE glpi_ticket_id = :ticket_id
            ORDER BY created_at DESC, id DESC
            LIMIT 1
            SQL
        );
        $statement->bindValue(':ticket_id', $ticketId, PDO::PARAM_INT);
        $statement->execute();
        $row = $statement->fetch();

        return is_array($row) ? $row : null;
    }

    /**
     * @return array<string, mixed>|null
     */
    public function findLastMessageByDirection(string $conversationId, string $direction): ?array
    {
        $statement = $this->pdo->prepare(
            <<<SQL
            SELECT
                id,
                message_id,
                direction,
                message_type,
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
              AND direction = :direction
            ORDER BY created_at DESC, id DESC
            LIMIT 1
            SQL
        );
        $statement->execute([
            ':conversation_id' => $conversationId,
            ':direction' => $direction,
        ]);
        $row = $statement->fetch();

        return is_array($row) ? $row : null;
    }

    /**
     * @return array<string, mixed>|null
     */
    public function findRecentOutboundFailure(string $conversationId): ?array
    {
        $statement = $this->pdo->prepare(
            <<<SQL
            SELECT
                id,
                message_id,
                direction,
                message_type,
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
              AND direction = 'outbound'
              AND created_at >= NOW() - INTERVAL '24 hours'
              AND (
                processing_status = 'failed'
                OR glpi_sync_status IN ('failed', 'error')
                OR delivery_status = 'failed'
              )
            ORDER BY created_at DESC, id DESC
            LIMIT 1
            SQL
        );
        $statement->execute([
            ':conversation_id' => $conversationId,
        ]);
        $row = $statement->fetch();

        return is_array($row) ? $row : null;
    }

    /**
     * @return list<array<string, mixed>>
     */
    public function findRecentConversationAuditEvents(string $conversationId, int $limit = 5): array
    {
        $safeLimit = max(1, min(5, $limit));
        $statement = $this->pdo->prepare(
            <<<SQL
            SELECT
                id,
                created_at,
                correlation_id,
                event_type,
                status,
                severity,
                source,
                error_message
            FROM glpi_plugin_integaglpi_audit_events
            WHERE conversation_id = :conversation_id
            ORDER BY created_at DESC
            LIMIT :limit
            SQL
        );
        $statement->bindValue(':conversation_id', $conversationId);
        $statement->bindValue(':limit', $safeLimit, PDO::PARAM_INT);
        $statement->execute();
        $rows = $statement->fetchAll();

        return is_array($rows) ? $rows : [];
    }

    public function findLatestCorrelationId(int $ticketId, string $conversationId): string
    {
        $statement = $this->pdo->prepare(
            <<<SQL
            SELECT correlation_id
            FROM glpi_plugin_integaglpi_audit_events
            WHERE (
                conversation_id = :conversation_id
                OR ticket_id = :ticket_id
            )
              AND correlation_id IS NOT NULL
              AND correlation_id <> ''
            ORDER BY created_at DESC
            LIMIT 1
            SQL
        );
        $statement->bindValue(':ticket_id', $ticketId, PDO::PARAM_INT);
        $statement->bindValue(':conversation_id', $conversationId);
        $statement->execute();

        return trim((string) $statement->fetchColumn());
    }

    /**
     * @return array<string, mixed>|null
     */
    public function findOpenDeadLetter(int $ticketId, string $conversationId): ?array
    {
        if (!$this->hasDeadLetterTable()) {
            return null;
        }

        $statement = $this->pdo->prepare(
            <<<SQL
            SELECT
                id,
                created_at,
                operation_type,
                failure_type,
                retry_count,
                status
            FROM glpi_plugin_integaglpi_dead_letter
            WHERE status = 'open'
              AND (
                ticket_id = :ticket_id
                OR conversation_id = :conversation_id
              )
            ORDER BY created_at DESC
            LIMIT 1
            SQL
        );
        $statement->bindValue(':ticket_id', $ticketId, PDO::PARAM_INT);
        $statement->bindValue(':conversation_id', $conversationId);
        $statement->execute();
        $row = $statement->fetch();

        return is_array($row) ? $row : null;
    }

    private function hasDeadLetterTable(): bool
    {
        $statement = $this->pdo->prepare("SELECT to_regclass('public.glpi_plugin_integaglpi_dead_letter') IS NOT NULL");
        $statement->execute();

        return (bool) $statement->fetchColumn();
    }

    private function hasCsatColumns(): bool
    {
        $statement = $this->pdo->prepare(
            "SELECT EXISTS (
                SELECT 1
                FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'glpi_plugin_integaglpi_solution_actions'
                  AND column_name = 'csat_rating'
            )"
        );
        $statement->execute();

        return (bool) $statement->fetchColumn();
    }

    private function hasAiQualityAnalysesTable(): bool
    {
        $statement = $this->pdo->prepare("SELECT to_regclass('public.glpi_plugin_integaglpi_ai_quality_analyses') IS NOT NULL");
        $statement->execute();

        return (bool) $statement->fetchColumn();
    }
}
