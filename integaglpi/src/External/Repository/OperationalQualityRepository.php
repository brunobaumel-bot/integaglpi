<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi\External\Repository;

use PDO;

final class OperationalQualityRepository
{
    private const RECENT_FAILURE_WINDOW_SQL = "NOW() - INTERVAL '24 hours'";
    private const WARNING_ACTIVITY_WINDOW_SQL = "NOW() - INTERVAL '4 hours'";
    private const CRITICAL_ACTIVITY_WINDOW_SQL = "NOW() - INTERVAL '24 hours'";

    public function __construct(private readonly PDO $pdo)
    {
    }

    /**
     * Returns a bounded global risk list using conversations as the primary source.
     * It deliberately avoids payload_json and avoids one query per ticket.
     *
     * @return list<array<string, mixed>>
     */
    public function findGlobalRiskCandidates(int $limit): array
    {
        $safeLimit = max(1, min(60, $limit));
        $recentFailureWindowSql = self::RECENT_FAILURE_WINDOW_SQL;
        $warningActivityWindowSql = self::WARNING_ACTIVITY_WINDOW_SQL;
        $criticalActivityWindowSql = self::CRITICAL_ACTIVITY_WINDOW_SQL;
        $deadLetterSelect = 'FALSE';
        $deadLetterWhere = 'FALSE';

        if ($this->hasDeadLetterTable()) {
            $deadLetterSelect = <<<SQL
                EXISTS (
                    SELECT 1
                    FROM glpi_plugin_integaglpi_dead_letter dl
                    WHERE dl.status = 'open'
                      AND (
                        dl.conversation_id = c.id
                        OR dl.ticket_id = c.glpi_ticket_id
                      )
                    LIMIT 1
                )
            SQL;
            $deadLetterWhere = $deadLetterSelect;
        }

        $outboundFailureExists = <<<SQL
            EXISTS (
                SELECT 1
                FROM glpi_plugin_integaglpi_messages m
                WHERE m.conversation_id = c.id
                  AND m.direction = 'outbound'
                  AND m.created_at >= {$recentFailureWindowSql}
                  AND (
                    m.processing_status = 'failed'
                    OR m.glpi_sync_status IN ('failed', 'error')
                  )
                LIMIT 1
            )
        SQL;

        $statement = $this->pdo->prepare(
            <<<SQL
            SELECT
                c.id AS conversation_id,
                c.glpi_ticket_id,
                c.status AS conversation_status,
                c.last_message_at,
                c.updated_at AS conversation_updated_at,
                rt.status AS runtime_status,
                {$deadLetterSelect} AS has_dead_letter_open,
                {$outboundFailureExists} AS has_outbound_failed
            FROM glpi_plugin_integaglpi_conversations c
            LEFT JOIN glpi_plugin_integaglpi_conversation_runtime rt
                ON rt.conversation_id = c.id
            WHERE c.glpi_ticket_id IS NOT NULL
              AND c.status IN ('open', 'awaiting_queue_selection', 'closed')
              AND (
                c.last_message_at <= {$warningActivityWindowSql}
                OR (
                    c.status = 'awaiting_queue_selection'
                    AND c.last_message_at <= {$criticalActivityWindowSql}
                )
                OR {$deadLetterWhere}
                OR {$outboundFailureExists}
              )
            ORDER BY
                CASE
                    WHEN {$deadLetterSelect} THEN 0
                    WHEN {$outboundFailureExists} THEN 0
                    WHEN c.last_message_at <= {$criticalActivityWindowSql} THEN 1
                    ELSE 2
                END,
                c.last_message_at ASC NULLS FIRST,
                c.updated_at ASC NULLS FIRST
            LIMIT :limit
            SQL
        );
        $statement->bindValue(':limit', $safeLimit, PDO::PARAM_INT);
        $statement->execute();
        $rows = $statement->fetchAll();

        return is_array($rows) ? $rows : [];
    }

    /**
     * Recent conversations linked to a GLPI ticket (bounded second pass).
     * Used so estado ticket pode ser carregado via GLPI para inconsistências mesmo sem vácuo óbvio.
     *
     * @return list<array<string, mixed>>
     */
    public function findRecentTicketLinkedForRisk(int $limit): array
    {
        $safeLimit = max(1, min(25, $limit));
        $recentFailureWindowSql = self::RECENT_FAILURE_WINDOW_SQL;
        $deadLetterSelect = 'FALSE';
        if ($this->hasDeadLetterTable()) {
            $deadLetterSelect = <<<SQL
                EXISTS (
                    SELECT 1
                    FROM glpi_plugin_integaglpi_dead_letter dl
                    WHERE dl.status = 'open'
                      AND (
                        dl.conversation_id = c.id
                        OR dl.ticket_id = c.glpi_ticket_id
                      )
                    LIMIT 1
                )
            SQL;
        }

        $outboundFailureExists = <<<SQL
            EXISTS (
                SELECT 1
                FROM glpi_plugin_integaglpi_messages m
                WHERE m.conversation_id = c.id
                  AND m.direction = 'outbound'
                  AND m.created_at >= {$recentFailureWindowSql}
                  AND (
                    m.processing_status = 'failed'
                    OR m.glpi_sync_status IN ('failed', 'error')
                  )
                LIMIT 1
            )
        SQL;

        $statement = $this->pdo->prepare(
            <<<SQL
            SELECT
                c.id AS conversation_id,
                c.glpi_ticket_id,
                c.status AS conversation_status,
                c.last_message_at,
                c.updated_at AS conversation_updated_at,
                rt.status AS runtime_status,
                {$deadLetterSelect} AS has_dead_letter_open,
                {$outboundFailureExists} AS has_outbound_failed
            FROM glpi_plugin_integaglpi_conversations c
            LEFT JOIN glpi_plugin_integaglpi_conversation_runtime rt
                ON rt.conversation_id = c.id
            WHERE c.glpi_ticket_id IS NOT NULL
              AND c.status IN ('open', 'awaiting_queue_selection', 'closed')
            ORDER BY c.updated_at DESC NULLS LAST
            LIMIT :limit
            SQL
        );
        $statement->bindValue(':limit', $safeLimit, PDO::PARAM_INT);
        $statement->execute();
        $rows = $statement->fetchAll();

        return is_array($rows) ? $rows : [];
    }

    public function hasDeadLetterTable(): bool
    {
        $statement = $this->pdo->prepare("SELECT to_regclass('public.glpi_plugin_integaglpi_dead_letter') IS NOT NULL");
        $statement->execute();

        return (bool) $statement->fetchColumn();
    }
}
