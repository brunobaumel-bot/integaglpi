<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi\Service;

use GlpiPlugin\Integaglpi\External\ExternalDatabase;
use PDO;
use Session;
use Throwable;

final class SecurityAuditService
{
    public const EVENT_PERMISSION_CHANGED    = 'SECURITY_PERMISSION_CHANGED';
    public const EVENT_ACCESS_DENIED         = 'SECURITY_ACCESS_DENIED';
    public const EVENT_REPORT_EXPORTED       = 'SECURITY_REPORT_EXPORTED';
    public const EVENT_ENTITY_OVERRIDE       = 'SECURITY_ENTITY_OVERRIDE';
    public const EVENT_ADMIN_CLOSE           = 'SECURITY_ADMIN_CLOSE';
    public const EVENT_PII_UNMASKED_VIEW     = 'SECURITY_PII_UNMASKED_VIEW';
    public const EVENT_MATRIX_VIEWED         = 'SECURITY_MATRIX_VIEWED';
    public const EVENT_MATRIX_SAVE_ATTEMPTED = 'SECURITY_MATRIX_SAVE_ATTEMPTED';
    public const EVENT_LOGMEIN_CONTEXT_VIEWED = 'LOGMEIN_CONTEXT_VIEWED';
    public const EVENT_LOGMEIN_MAPPING_CREATED = 'LOGMEIN_MAPPING_CREATED';
    public const EVENT_LOGMEIN_MAPPING_UPDATED = 'LOGMEIN_MAPPING_UPDATED';
    public const EVENT_LOGMEIN_MAPPING_DISABLED = 'LOGMEIN_MAPPING_DISABLED';
    public const EVENT_LOGMEIN_CUSTOMFIELD_READ = 'LOGMEIN_CUSTOMFIELD_READ';
    public const EVENT_LOGMEIN_REPORT_GENERATED = 'LOGMEIN_REPORT_GENERATED';
    public const EVENT_LOGMEIN_REPORT_VIEWED = 'LOGMEIN_REPORT_VIEWED';
    public const EVENT_LOGMEIN_REPORT_EXPORTED = 'LOGMEIN_REPORT_EXPORTED';
    public const EVENT_LOGMEIN_SESSION_EVIDENCE_VIEWED = 'LOGMEIN_SESSION_EVIDENCE_VIEWED';
    public const EVENT_LOGMEIN_SYNC_STARTED = 'LOGMEIN_SYNC_STARTED';
    public const EVENT_LOGMEIN_SYNC_FAILED = 'LOGMEIN_SYNC_FAILED';
    public const EVENT_LOGMEIN_SYNC_COMPLETED = 'LOGMEIN_SYNC_COMPLETED';
    public const EVENT_PERMISSION_REVIEW_COMPLETED = 'PERMISSION_REVIEW_COMPLETED';
    public const EVENT_RELEASE_CHECKLIST_APPROVED = 'RELEASE_CHECKLIST_APPROVED';
    public const EVENT_RUNBOOK_REVIEWED = 'RUNBOOK_REVIEWED';
    // V7 — remote-access reconciliation events.
    public const EVENT_LOGMEIN_SESSION_SYNC_STARTED = 'LOGMEIN_SESSION_SYNC_STARTED';
    public const EVENT_LOGMEIN_SESSION_SYNC_COMPLETED = 'LOGMEIN_SESSION_SYNC_COMPLETED';
    public const EVENT_LOGMEIN_SESSION_SYNC_FAILED = 'LOGMEIN_SESSION_SYNC_FAILED';
    public const EVENT_LOGMEIN_SESSION_MATCHED = 'LOGMEIN_SESSION_MATCHED';
    public const EVENT_LOGMEIN_SESSION_REGULARIZATION_CREATED = 'LOGMEIN_SESSION_REGULARIZATION_CREATED';
    public const EVENT_LOGMEIN_SESSION_REGULARIZATION_RESOLVED = 'LOGMEIN_SESSION_REGULARIZATION_RESOLVED';
    public const EVENT_SECURITY_LOGMEIN_RECONCILIATION_ACTION = 'SECURITY_LOGMEIN_RECONCILIATION_ACTION';

    private const FORBIDDEN_CONTEXT_KEYS = [
        'token',
        'app_token',
        'bearer',
        'authorization',
        'password',
        'secret',
        'api_key',
        'session_id',
        'session_token',
        'raw_payload',
        'raw_prompt',
        'prompt',
        'message_text',
        'message_body',
        'full_phone',
        'phone_e164',
        'email',
    ];

    public static function logAccessDenied(string $right, array $context = []): void
    {
        self::log(self::EVENT_ACCESS_DENIED, [
            'right' => $right,
            'context' => self::sanitize($context),
        ]);
    }

    public static function logPermissionChanged(string $right, ?string $previousRole, ?string $newRole, array $context = []): void
    {
        self::log(self::EVENT_PERMISSION_CHANGED, [
            'right' => $right,
            'previous_role' => $previousRole,
            'new_role' => $newRole,
            'context' => self::sanitize($context),
        ]);
    }

    public static function logReportExported(string $reportType, array $context = []): void
    {
        self::log(self::EVENT_REPORT_EXPORTED, [
            'report_type' => $reportType,
            'context' => self::sanitize($context),
        ]);
    }

    public static function logEntityOverride(int $conversationId, int $previousEntityId, int $newEntityId, string $reason): void
    {
        self::log(self::EVENT_ENTITY_OVERRIDE, [
            'conversation_id' => $conversationId,
            'previous_entity_id' => $previousEntityId,
            'new_entity_id' => $newEntityId,
            'reason' => self::truncateReason($reason),
        ]);
    }

    public static function logAdminClose(string $conversationId, string $reason): void
    {
        self::log(self::EVENT_ADMIN_CLOSE, [
            'conversation_id' => $conversationId,
            'reason' => self::truncateReason($reason),
        ]);
    }

    public static function logPiiUnmaskedView(string $targetType, string $targetIdHash): void
    {
        self::log(self::EVENT_PII_UNMASKED_VIEW, [
            'target_type' => $targetType,
            'target_id_hash' => $targetIdHash,
        ]);
    }

    public static function logMatrixViewed(): void
    {
        self::log(self::EVENT_MATRIX_VIEWED, []);
    }

    public static function logMatrixSaveAttempted(string $result, array $context = []): void
    {
        self::log(self::EVENT_MATRIX_SAVE_ATTEMPTED, [
            'result' => $result,
            'context' => self::sanitize($context),
        ]);
    }

    public static function logLogmeinContextViewed(int $ticketId, array $context = []): void
    {
        self::log(self::EVENT_LOGMEIN_CONTEXT_VIEWED, [
            'ticket_id' => $ticketId,
            'read_only' => true,
            'context' => self::sanitize($context),
        ]);
    }

    public static function logLogmeinMappingChanged(string $eventType, array $context = []): void
    {
        if (!in_array($eventType, [
            self::EVENT_LOGMEIN_MAPPING_CREATED,
            self::EVENT_LOGMEIN_MAPPING_UPDATED,
            self::EVENT_LOGMEIN_MAPPING_DISABLED,
        ], true)) {
            $eventType = self::EVENT_LOGMEIN_MAPPING_UPDATED;
        }

        self::log($eventType, [
            'read_only_context_only' => true,
            'confirmation_required_for_memory_write' => true,
            'context' => self::sanitize($context),
        ]);
    }

    public static function logLogmeinReportGenerated(string $reportType, array $context = []): void
    {
        self::log(self::EVENT_LOGMEIN_REPORT_GENERATED, [
            'report_type' => $reportType,
            'read_only' => true,
            'context' => self::sanitize($context),
        ]);
    }

    public static function logLogmeinReportViewed(string $reportType, array $context = []): void
    {
        self::log(self::EVENT_LOGMEIN_REPORT_VIEWED, [
            'report_type' => $reportType,
            'read_only' => true,
            'context' => self::sanitize($context),
        ]);
    }

    public static function logLogmeinReportExported(string $reportType, array $context = []): void
    {
        self::log(self::EVENT_LOGMEIN_REPORT_EXPORTED, [
            'report_type' => $reportType,
            'read_only' => true,
            'context' => self::sanitize($context),
        ]);
        self::logReportExported($reportType, array_merge($context, ['source' => 'logmein_readonly']));
    }

    public static function logLogmeinEvidenceViewed(int $ticketId, array $context = []): void
    {
        self::log(self::EVENT_LOGMEIN_SESSION_EVIDENCE_VIEWED, [
            'ticket_id' => $ticketId,
            'read_only' => true,
            'context' => self::sanitize($context),
        ]);
    }

    private static function sanitize(array $context): array
    {
        $clean = [];
        foreach ($context as $key => $value) {
            $lowerKey = strtolower((string) $key);
            if (in_array($lowerKey, self::FORBIDDEN_CONTEXT_KEYS, true)) {
                continue;
            }
            if (is_array($value)) {
                $clean[$key] = self::sanitize($value);
            } elseif (is_scalar($value) || $value === null) {
                $clean[$key] = $value;
            }
        }

        return $clean;
    }

    private static function truncateReason(string $reason): string
    {
        $clean = trim((string) preg_replace('/\s+/', ' ', $reason));
        if (strlen($clean) > 240) {
            $clean = substr($clean, 0, 240);
        }

        return $clean;
    }

    private static function log(string $eventType, array $payload): void
    {
        $userId = 0;
        $profileId = 0;
        try {
            $userId = (int) Session::getLoginUserID();
            $profileId = (int) ($_SESSION['glpiactiveprofile']['id'] ?? 0);
        } catch (Throwable) {
            // Continue with anonymous audit context.
        }

        $record = [
            'event_type' => $eventType,
            'user_id' => $userId,
            'profile_id' => $profileId,
            'occurred_at' => gmdate('c'),
            'source' => 'integaglpi_security_center',
            'payload' => $payload,
        ];

        error_log('[integaglpi][security_audit] ' . json_encode($record, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

        try {
            $configService = new PluginConfigService();
            if (!$configService->isConfigured()) {
                return;
            }
            $pdo = ExternalDatabase::getConnection($configService->getConnectionConfig());
            if (!self::auditTableExists($pdo)) {
                return;
            }
            self::insertAuditEvent($pdo, $eventType, $userId, $profileId, $payload);
        } catch (Throwable $exception) {
            error_log('[integaglpi][security_audit][persist_failed] ' . $exception->getMessage());
        }
    }

    /**
     * V7: log a reconciliation UI action (resolve, link ticket, create task, ignore).
     *
     * @param array<string, mixed> $context
     */
    public static function logReconciliationAction(string $action, int $queueItemId, array $context = []): void
    {
        self::log(self::EVENT_SECURITY_LOGMEIN_RECONCILIATION_ACTION, [
            'action' => $action,
            'queue_item_id' => $queueItemId,
            'read_only' => false,  // operator is taking an action
            'remote_execution' => false,
            'context' => self::sanitize($context),
        ]);
    }

    /**
     * V7: log when a task is created in GLPI after human confirmation.
     *
     * @param array<string, mixed> $context
     */
    public static function logGlpiTaskCreated(int $ticketId, int $taskId, array $context = []): void
    {
        self::log(self::EVENT_LOGMEIN_SESSION_REGULARIZATION_RESOLVED, [
            'ticket_id' => $ticketId,
            'task_id' => $taskId,
            'remote_execution' => false,
            'context' => self::sanitize($context),
        ]);
    }

    private static function auditTableExists(PDO $pdo): bool
    {
        $stmt = $pdo->query("SELECT to_regclass('glpi_plugin_integaglpi_audit_events') IS NOT NULL");
        if ($stmt === false) {
            return false;
        }

        return (bool) $stmt->fetchColumn();
    }

    private static function insertAuditEvent(PDO $pdo, string $eventType, int $userId, int $profileId, array $payload): void
    {
        $stmt = $pdo->prepare(
            "INSERT INTO glpi_plugin_integaglpi_audit_events
                (event_type, glpi_user_id, payload, created_at)
             VALUES (:event_type, :user_id, CAST(:payload AS JSONB), NOW())
             ON CONFLICT DO NOTHING"
        );
        $stmt->execute([
            ':event_type' => $eventType,
            ':user_id' => $userId > 0 ? $userId : null,
            ':payload' => json_encode([
                'profile_id' => $profileId,
                'source' => 'integaglpi_security_center',
                'data' => $payload,
            ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
        ]);
    }
}
