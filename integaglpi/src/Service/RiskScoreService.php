<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi\Service;

use GlpiPlugin\Integaglpi\External\ExternalDatabase;
use PDO;
use Throwable;

final class RiskScoreService
{
    private ?PDO $pdo = null;

    public function __construct(private readonly PluginConfigService $pluginConfigService)
    {
    }

    /**
     * @return array<string, mixed>|null
     */
    public function getLatestScore(?string $conversationId, int $ticketId): ?array
    {
        if (!$this->pluginConfigService->isConfigured() || !$this->tableExists('glpi_plugin_integaglpi_risk_scores')) {
            return null;
        }

        $statement = $this->getConnection()->prepare(
            "
            SELECT
                score_id,
                conversation_id,
                glpi_ticket_id,
                model_version,
                reopen_risk,
                dissatisfaction_risk,
                abandonment_risk,
                risk_score,
                confidence_score,
                reasons_json,
                suggested_human_action,
                signals_used_json,
                data_quality_warnings_json,
                created_at,
                updated_at
            FROM glpi_plugin_integaglpi_risk_scores
            WHERE (:conversation_id <> '' AND conversation_id = :conversation_id)
               OR (:ticket_id > 0 AND glpi_ticket_id = :ticket_id)
            ORDER BY updated_at DESC, created_at DESC
            LIMIT 1
            "
        );
        $statement->bindValue(':conversation_id', trim((string) $conversationId));
        $statement->bindValue(':ticket_id', $ticketId, PDO::PARAM_INT);
        $statement->execute();
        $row = $statement->fetch(PDO::FETCH_ASSOC);

        return is_array($row) ? $this->decorateScore($row) : null;
    }

    /**
     * @return array<string, mixed>
     */
    public function getDashboardSummary(int $days = 30): array
    {
        if (!$this->pluginConfigService->isConfigured() || !$this->tableExists('glpi_plugin_integaglpi_risk_scores')) {
            return [
                'available' => false,
                'total' => 0,
                'high' => 0,
                'medium' => 0,
                'low' => 0,
                'unknown' => 0,
            ];
        }

        $days = max(1, min($days, 30));
        $statement = $this->getConnection()->prepare(
            "
            SELECT
                COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE risk_score >= 70)::int AS high,
                COUNT(*) FILTER (WHERE risk_score >= 40 AND risk_score < 70)::int AS medium,
                COUNT(*) FILTER (WHERE risk_score < 40 AND reopen_risk <> 'unknown' AND dissatisfaction_risk <> 'unknown' AND abandonment_risk <> 'unknown')::int AS low,
                COUNT(*) FILTER (WHERE reopen_risk = 'unknown' OR dissatisfaction_risk = 'unknown' OR abandonment_risk = 'unknown')::int AS unknown
            FROM glpi_plugin_integaglpi_risk_scores
            WHERE created_at >= NOW() - (:days || ' days')::interval
            "
        );
        $statement->bindValue(':days', (string) $days);
        $statement->execute();
        $row = $statement->fetch(PDO::FETCH_ASSOC) ?: [];

        return [
            'available' => true,
            'total' => (int) ($row['total'] ?? 0),
            'high' => (int) ($row['high'] ?? 0),
            'medium' => (int) ($row['medium'] ?? 0),
            'low' => (int) ($row['low'] ?? 0),
            'unknown' => (int) ($row['unknown'] ?? 0),
        ];
    }

    /**
     * @param array<string, mixed> $post
     * @return array{type: string, message: string}
     */
    public function recordFeedback(array $post, int $userId): array
    {
        if (!$this->pluginConfigService->isConfigured()) {
            return ['type' => 'danger', 'message' => __('Integração não configurada.', 'glpiintegaglpi')];
        }

        $scoreId = trim((string) ($post['score_id'] ?? ''));
        $rating = trim((string) ($post['feedback_rating'] ?? ''));
        $notes = $this->sanitizeText((string) ($post['feedback_notes'] ?? ''), 500);
        if (!preg_match('/^[a-f0-9]{16,64}$/', $scoreId) || !in_array($rating, ['useful', 'incorrect', 'unsure'], true)) {
            return ['type' => 'danger', 'message' => __('Feedback de risco inválido.', 'glpiintegaglpi')];
        }

        $connection = $this->getConnection();
        $statement = $connection->prepare(
            "
            INSERT INTO glpi_plugin_integaglpi_risk_score_feedback (
                score_id,
                glpi_user_id,
                feedback_rating,
                feedback_notes_sanitized,
                created_at
            )
            VALUES (:score_id, :user_id, :rating, :notes, NOW())
            "
        );
        $statement->bindValue(':score_id', $scoreId);
        $statement->bindValue(':user_id', $userId, PDO::PARAM_INT);
        $statement->bindValue(':rating', $rating);
        $statement->bindValue(':notes', $notes !== '' ? $notes : null);
        $statement->execute();

        $this->auditFeedback($scoreId, $rating, $userId, $notes !== '');

        return ['type' => 'success', 'message' => __('Feedback do indicador de risco salvo.', 'glpiintegaglpi')];
    }

    /**
     * @param array<string, mixed> $row
     * @return array<string, mixed>
     */
    private function decorateScore(array $row): array
    {
        return [
            'score_id' => (string) ($row['score_id'] ?? ''),
            'conversation_id' => (string) ($row['conversation_id'] ?? ''),
            'glpi_ticket_id' => (int) ($row['glpi_ticket_id'] ?? 0),
            'model_version' => (string) ($row['model_version'] ?? ''),
            'reopen_risk' => (string) ($row['reopen_risk'] ?? 'unknown'),
            'dissatisfaction_risk' => (string) ($row['dissatisfaction_risk'] ?? 'unknown'),
            'abandonment_risk' => (string) ($row['abandonment_risk'] ?? 'unknown'),
            'risk_score' => (int) ($row['risk_score'] ?? 0),
            'confidence_score' => (int) ($row['confidence_score'] ?? 0),
            'reasons' => $this->jsonList($row['reasons_json'] ?? null),
            'suggested_human_action' => $this->sanitizeText((string) ($row['suggested_human_action'] ?? ''), 500),
            'signals_used' => $this->jsonList($row['signals_used_json'] ?? null),
            'data_quality_warnings' => $this->jsonList($row['data_quality_warnings_json'] ?? null),
            'created_at' => (string) ($row['created_at'] ?? ''),
            'updated_at' => (string) ($row['updated_at'] ?? ''),
        ];
    }

    /**
     * @return list<string>
     */
    private function jsonList(mixed $value): array
    {
        if (is_string($value) && $value !== '') {
            $decoded = json_decode($value, true);
        } else {
            $decoded = $value;
        }
        if (!is_array($decoded)) {
            return [];
        }

        $items = [];
        foreach ($decoded as $item) {
            $text = $this->sanitizeText((string) $item, 220);
            if ($text !== '') {
                $items[] = $text;
            }
        }

        return array_slice($items, 0, 8);
    }

    private function sanitizeText(string $value, int $limit): string
    {
        $value = html_entity_decode(strip_tags($value), ENT_QUOTES | ENT_HTML5, 'UTF-8');
        $value = preg_replace('/[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}/i', '[email]', $value) ?? '';
        $value = preg_replace('/\b(?:\+?\d[\d .()\-]{7,}\d)\b/', '[telefone]', $value) ?? '';
        $value = preg_replace('/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b|\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/', '[documento]', $value) ?? '';
        $value = preg_replace('/(password|token|bearer|api_key|app_secret|secret)\s*[:=]\s*[^,\s]+/i', '$1=[redacted]', $value) ?? '';
        $value = trim(preg_replace('/\s+/', ' ', $value) ?? '');

        return mb_substr($value, 0, $limit);
    }

    private function auditFeedback(string $scoreId, string $rating, int $userId, bool $hasNotes): void
    {
        try {
            if (!$this->tableExists('glpi_plugin_integaglpi_audit_events')) {
                return;
            }

            $statement = $this->getConnection()->prepare(
                "
                INSERT INTO glpi_plugin_integaglpi_audit_events (
                    correlation_id,
                    event_type,
                    status,
                    severity,
                    source,
                    payload_json,
                    created_at
                )
                VALUES (:correlation_id, 'RISK_SCORE_FEEDBACK_RECORDED', 'success', 'info', 'RiskScoreService', :payload::jsonb, NOW())
                "
            );
            $statement->bindValue(':correlation_id', 'risk_score_feedback:' . $scoreId);
            $statement->bindValue(':payload', json_encode([
                'score_id' => $scoreId,
                'feedback_rating' => $rating,
                'glpi_user_id' => $userId,
                'notes_present' => $hasNotes,
            ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
            $statement->execute();
        } catch (Throwable $exception) {
            error_log('[integaglpi][risk_score][feedback_audit] ' . $this->sanitizeText($exception->getMessage(), 180));
        }
    }

    private function tableExists(string $table): bool
    {
        $statement = $this->getConnection()->prepare(
            "
            SELECT 1
            FROM information_schema.tables
            WHERE table_schema = current_schema()
              AND table_name = :table_name
            LIMIT 1
            "
        );
        $statement->bindValue(':table_name', $table);
        $statement->execute();

        return (bool) $statement->fetchColumn();
    }

    private function getConnection(): PDO
    {
        if (!$this->pdo instanceof PDO) {
            $this->pdo = ExternalDatabase::getConnection($this->pluginConfigService->getConnectionConfig());
        }

        return $this->pdo;
    }
}
