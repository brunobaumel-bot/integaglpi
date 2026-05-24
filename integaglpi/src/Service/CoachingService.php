<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi\Service;

use DateInterval;
use DateTimeImmutable;
use DateTimeZone;
use GlpiPlugin\Integaglpi\External\ExternalDatabase;
use PDO;
use Throwable;

final class CoachingService
{
    private const DEFAULT_LIMIT = 20;
    private const MAX_RANGE_DAYS = 90;

    private ?PDO $pdo = null;

    public function __construct(private readonly PluginConfigService $pluginConfigService)
    {
    }

    /**
     * @param array<string, mixed> $query
     * @return array<string, mixed>
     */
    public function getDashboardData(array $query): array
    {
        $filters = $this->normalizeFilters($query);
        if (!$this->pluginConfigService->isConfigured() || !$this->tableExists('glpi_plugin_integaglpi_coaching_recommendations')) {
            return $this->emptyData($filters, __('Coaching ainda não materializado. Execute a geração batch antes do smoke.', 'glpiintegaglpi'));
        }

        $where = [
            "created_at >= CAST(:date_from AS date)",
            "created_at < (CAST(:date_to AS date) + INTERVAL '1 day')",
        ];
        $params = [
            ':date_from' => $filters['date_from'],
            ':date_to' => $filters['date_to'],
        ];

        if ($filters['status'] !== '') {
            $where[] = 'status = :status';
            $params[':status'] = $filters['status'];
        }
        if ($filters['type'] !== '') {
            $where[] = 'recommendation_type = :type';
            $params[':type'] = $filters['type'];
        }
        if ($filters['scope_type'] !== '') {
            $where[] = 'scope_type = :scope_type';
            $params[':scope_type'] = $filters['scope_type'];
        }
        if ((int) $filters['entity_id'] > 0) {
            if (!$this->canUseEntity((int) $filters['entity_id'])) {
                return $this->emptyData($filters, __('Entidade fora do escopo permitido da sessão GLPI.', 'glpiintegaglpi'));
            }
            $where[] = "scope_type = 'entity' AND scope_hash = :entity_scope_hash";
            $params[':entity_scope_hash'] = hash('sha256', 'entity:' . (int) $filters['entity_id']);
        }

        $whereSql = implode(' AND ', $where);
        $countStatement = $this->getConnection()->prepare(
            "SELECT COUNT(*)::int FROM glpi_plugin_integaglpi_coaching_recommendations WHERE {$whereSql}"
        );
        foreach ($params as $name => $value) {
            $countStatement->bindValue($name, $value);
        }
        $countStatement->execute();
        $total = (int) $countStatement->fetchColumn();

        $statement = $this->getConnection()->prepare(
            "
            SELECT
                recommendation_id,
                scope_type,
                recommendation_type,
                title,
                summary_sanitized,
                explanation_sanitized,
                suggested_actions_json,
                kb_articles_json,
                onboarding_plan_json,
                confidence_score,
                recommendation_version,
                status,
                created_at,
                updated_at
            FROM glpi_plugin_integaglpi_coaching_recommendations
            WHERE {$whereSql}
            ORDER BY confidence_score DESC, created_at DESC
            LIMIT :limit OFFSET :offset
            "
        );
        foreach ($params as $name => $value) {
            $statement->bindValue($name, $value);
        }
        $statement->bindValue(':limit', (int) $filters['limit'], PDO::PARAM_INT);
        $statement->bindValue(':offset', ((int) $filters['page'] - 1) * (int) $filters['limit'], PDO::PARAM_INT);
        $statement->execute();

        return [
            'filters' => $filters,
            'error' => '',
            'summary' => $this->loadSummary($filters),
            'recommendations' => array_map(fn (array $row): array => $this->decorateRecommendation($row), $statement->fetchAll(PDO::FETCH_ASSOC) ?: []),
            'pagination' => [
                'page' => (int) $filters['page'],
                'limit' => (int) $filters['limit'],
                'total' => $total,
                'total_pages' => max(1, (int) ceil($total / max(1, (int) $filters['limit']))),
            ],
        ];
    }

    /**
     * @param array<string, mixed> $post
     * @return array{type: string, message: string}
     */
    public function handlePost(array $post, int $userId): array
    {
        if (!$this->pluginConfigService->isConfigured() || !$this->tableExists('glpi_plugin_integaglpi_coaching_recommendations')) {
            return ['type' => 'danger', 'message' => __('Coaching ainda não está disponível.', 'glpiintegaglpi')];
        }

        $action = trim((string) ($post['action'] ?? ''));
        $recommendationId = trim((string) ($post['recommendation_id'] ?? ''));
        if (!preg_match('/^[a-f0-9]{16,64}$/', $recommendationId)) {
            return ['type' => 'danger', 'message' => __('Recomendação inválida.', 'glpiintegaglpi')];
        }

        if ($action === 'dismiss') {
            $statement = $this->getConnection()->prepare(
                "
                UPDATE glpi_plugin_integaglpi_coaching_recommendations
                   SET status = 'dismissed',
                       dismissed_by = :user_id,
                       dismissed_at = NOW(),
                       updated_at = NOW()
                 WHERE recommendation_id = :recommendation_id
                   AND status = 'active'
                "
            );
            $statement->bindValue(':user_id', $userId, PDO::PARAM_INT);
            $statement->bindValue(':recommendation_id', $recommendationId);
            $statement->execute();
            $this->audit('COACHING_RECOMMENDATION_DISMISSED', $recommendationId, $userId, ['status' => 'dismissed']);

            return ['type' => 'success', 'message' => __('Recomendação descartada do painel principal.', 'glpiintegaglpi')];
        }

        if ($action === 'feedback') {
            $rating = trim((string) ($post['rating'] ?? ''));
            if (!in_array($rating, ['useful', 'not_useful', 'not_applicable'], true)) {
                return ['type' => 'danger', 'message' => __('Feedback inválido.', 'glpiintegaglpi')];
            }
            $notes = $this->sanitizeText((string) ($post['notes'] ?? ''), 500);
            $statement = $this->getConnection()->prepare(
                "
                INSERT INTO glpi_plugin_integaglpi_coaching_feedback (
                    recommendation_id,
                    glpi_user_id,
                    rating,
                    notes_sanitized,
                    created_at
                )
                VALUES (:recommendation_id, :user_id, :rating, :notes, NOW())
                "
            );
            $statement->bindValue(':recommendation_id', $recommendationId);
            $statement->bindValue(':user_id', $userId, PDO::PARAM_INT);
            $statement->bindValue(':rating', $rating);
            $statement->bindValue(':notes', $notes !== '' ? $notes : null);
            $statement->execute();
            $this->audit('COACHING_FEEDBACK_RECORDED', $recommendationId, $userId, [
                'rating' => $rating,
                'notes_present' => $notes !== '',
            ]);

            return ['type' => 'success', 'message' => __('Feedback de coaching salvo.', 'glpiintegaglpi')];
        }

        return ['type' => 'danger', 'message' => __('Ação inválida.', 'glpiintegaglpi')];
    }

    /**
     * @param array<string, mixed> $query
     * @return array<string, mixed>
     */
    private function normalizeFilters(array $query): array
    {
        $timezone = new DateTimeZone(date_default_timezone_get() ?: 'America/Sao_Paulo');
        $today = new DateTimeImmutable('today', $timezone);
        $dateTo = $this->parseDate((string) ($query['date_to'] ?? ''), $today, $timezone);
        $dateFrom = $this->parseDate((string) ($query['date_from'] ?? ''), $dateTo->sub(new DateInterval('P29D')), $timezone);
        $maxFrom = $dateTo->sub(new DateInterval('P' . self::MAX_RANGE_DAYS . 'D'));
        if ($dateFrom < $maxFrom) {
            $dateFrom = $maxFrom;
        }
        if ($dateTo < $dateFrom) {
            $dateTo = $dateFrom;
        }

        return [
            'date_from' => $dateFrom->format('Y-m-d'),
            'date_to' => $dateTo->format('Y-m-d'),
            'status' => $this->allow((string) ($query['status'] ?? 'active'), ['active', 'dismissed', 'archived', '']),
            'type' => $this->allow((string) ($query['type'] ?? ''), [
                '',
                'onboarding_plan',
                'training_path',
                'kb_study_suggestion',
                'communication_skill',
                'coaching_session_tip',
                'kb_review_recommendation',
                'process_improvement',
                'data_quality_warning',
            ]),
            'scope_type' => $this->allow((string) ($query['scope_type'] ?? ''), ['', 'team', 'queue', 'category', 'technician_private', 'entity']),
            'entity_id' => max(0, (int) ($query['entity_id'] ?? 0)),
            'page' => max(1, (int) ($query['page'] ?? 1)),
            'limit' => max(1, min((int) ($query['limit'] ?? self::DEFAULT_LIMIT), self::DEFAULT_LIMIT)),
        ];
    }

    private function parseDate(string $value, DateTimeImmutable $fallback, DateTimeZone $timezone): DateTimeImmutable
    {
        $parsed = DateTimeImmutable::createFromFormat('Y-m-d', trim($value), $timezone);

        return $parsed instanceof DateTimeImmutable ? $parsed : $fallback;
    }

    /**
     * @param list<string> $allowed
     */
    private function allow(string $value, array $allowed): string
    {
        return in_array(trim($value), $allowed, true) ? trim($value) : '';
    }

    /**
     * @param array<string, mixed> $filters
     * @return array<string, mixed>
     */
    private function loadSummary(array $filters): array
    {
        $statement = $this->getConnection()->prepare(
            "
            SELECT
                COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE status = 'active')::int AS active,
                COUNT(*) FILTER (WHERE recommendation_type = 'communication_skill')::int AS communication,
                COUNT(*) FILTER (WHERE recommendation_type IN ('kb_study_suggestion', 'kb_review_recommendation'))::int AS kb,
                COUNT(*) FILTER (WHERE recommendation_type = 'data_quality_warning')::int AS data_quality
            FROM glpi_plugin_integaglpi_coaching_recommendations
            WHERE created_at >= CAST(:date_from AS date)
              AND created_at < (CAST(:date_to AS date) + INTERVAL '1 day')
            "
        );
        $statement->bindValue(':date_from', $filters['date_from']);
        $statement->bindValue(':date_to', $filters['date_to']);
        $statement->execute();
        $row = $statement->fetch(PDO::FETCH_ASSOC) ?: [];

        return [
            'total' => (int) ($row['total'] ?? 0),
            'active' => (int) ($row['active'] ?? 0),
            'communication' => (int) ($row['communication'] ?? 0),
            'kb' => (int) ($row['kb'] ?? 0),
            'data_quality' => (int) ($row['data_quality'] ?? 0),
        ];
    }

    /**
     * @param array<string, mixed> $row
     * @return array<string, mixed>
     */
    private function decorateRecommendation(array $row): array
    {
        return [
            'recommendation_id' => (string) ($row['recommendation_id'] ?? ''),
            'scope_type' => (string) ($row['scope_type'] ?? ''),
            'recommendation_type' => (string) ($row['recommendation_type'] ?? ''),
            'title' => $this->sanitizeText((string) ($row['title'] ?? ''), 180),
            'summary' => $this->sanitizeText((string) ($row['summary_sanitized'] ?? ''), 700),
            'explanation' => $this->sanitizeText((string) ($row['explanation_sanitized'] ?? ''), 900),
            'suggested_actions' => $this->jsonList($row['suggested_actions_json'] ?? null, 6),
            'kb_articles' => $this->jsonArticles($row['kb_articles_json'] ?? null),
            'onboarding_plan' => $this->jsonPlan($row['onboarding_plan_json'] ?? null),
            'confidence_score' => (int) ($row['confidence_score'] ?? 0),
            'recommendation_version' => (string) ($row['recommendation_version'] ?? ''),
            'status' => (string) ($row['status'] ?? ''),
            'created_at' => (string) ($row['created_at'] ?? ''),
            'updated_at' => (string) ($row['updated_at'] ?? ''),
        ];
    }

    /**
     * @return list<string>
     */
    private function jsonList(mixed $value, int $limit): array
    {
        $decoded = is_string($value) ? json_decode($value, true) : $value;
        if (!is_array($decoded)) {
            return [];
        }
        $items = [];
        foreach ($decoded as $item) {
            $text = $this->sanitizeText((string) $item, 240);
            if ($text !== '') {
                $items[] = $text;
            }
        }

        return array_slice($items, 0, $limit);
    }

    /**
     * @return list<array{title: string, category: string, internal_url: string}>
     */
    private function jsonArticles(mixed $value): array
    {
        $decoded = is_string($value) ? json_decode($value, true) : $value;
        if (!is_array($decoded)) {
            return [];
        }
        $items = [];
        foreach ($decoded as $article) {
            if (!is_array($article)) {
                continue;
            }
            $items[] = [
                'title' => $this->sanitizeText((string) ($article['title'] ?? ''), 160),
                'category' => $this->sanitizeText((string) ($article['category'] ?? ''), 100),
                'internal_url' => $this->sanitizeInternalUrl((string) ($article['internalUrl'] ?? $article['internal_url'] ?? '')),
            ];
        }

        return array_slice($items, 0, 5);
    }

    /**
     * @return array{day7: list<string>, day15: list<string>, day30: list<string>}
     */
    private function jsonPlan(mixed $value): array
    {
        $decoded = is_string($value) ? json_decode($value, true) : $value;
        if (!is_array($decoded)) {
            $decoded = [];
        }

        return [
            'day7' => $this->jsonList($decoded['day7'] ?? [], 6),
            'day15' => $this->jsonList($decoded['day15'] ?? [], 6),
            'day30' => $this->jsonList($decoded['day30'] ?? [], 6),
        ];
    }

    /**
     * @param array<string, mixed> $filters
     * @return array<string, mixed>
     */
    private function emptyData(array $filters, string $error): array
    {
        return [
            'filters' => $filters,
            'error' => $error,
            'summary' => ['total' => 0, 'active' => 0, 'communication' => 0, 'kb' => 0, 'data_quality' => 0],
            'recommendations' => [],
            'pagination' => ['page' => 1, 'limit' => self::DEFAULT_LIMIT, 'total' => 0, 'total_pages' => 1],
        ];
    }

    private function sanitizeText(string $value, int $limit): string
    {
        $value = html_entity_decode(strip_tags($value), ENT_QUOTES | ENT_HTML5, 'UTF-8');
        $value = preg_replace('/[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}/i', '[email]', $value) ?? '';
        $value = preg_replace('/\b(?:\+?\d[\d .()\-]{7,}\d)\b/', '[telefone]', $value) ?? '';
        $value = preg_replace('/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b|\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/', '[documento]', $value) ?? '';
        $value = preg_replace('/(password|senha|token|bearer|api_key|app_secret|secret)\s*[:=]\s*[^,\s]+/i', '$1=[redacted]', $value) ?? '';
        $value = trim(preg_replace('/\s+/', ' ', $value) ?? '');

        return mb_substr($value, 0, $limit);
    }

    private function sanitizeInternalUrl(string $value): string
    {
        $value = trim(html_entity_decode($value, ENT_QUOTES | ENT_HTML5, 'UTF-8'));
        if ($value === '' || preg_match('/[\x00-\x1F\x7F]/', $value)) {
            return '';
        }
        if (preg_match('#^(?:javascript|data|vbscript):#i', $value) || preg_match('#^https?://#i', $value)) {
            return '';
        }
        if (!str_starts_with($value, '/')) {
            return '';
        }

        $path = parse_url($value, PHP_URL_PATH);
        if (!is_string($path)) {
            return '';
        }

        foreach (['/front/knowbaseitem.form.php', '/plugins/integaglpi/'] as $prefix) {
            if ($path === $prefix || str_starts_with($path, $prefix)) {
                return $this->sanitizeText($value, 260);
            }
        }

        return '';
    }

    /**
     * @param array<string, mixed> $payload
     */
    private function audit(string $eventType, string $recommendationId, int $userId, array $payload): void
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
                VALUES (:correlation_id, :event_type, 'success', 'info', 'CoachingService', :payload::jsonb, NOW())
                "
            );
            $statement->bindValue(':correlation_id', 'coaching:' . $recommendationId);
            $statement->bindValue(':event_type', $eventType);
            $statement->bindValue(':payload', json_encode([
                'recommendation_id' => $recommendationId,
                'glpi_user_id' => $userId,
                ...$payload,
            ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
            $statement->execute();
        } catch (Throwable $exception) {
            error_log('[integaglpi][coaching][audit] ' . $this->sanitizeText($exception->getMessage(), 180));
        }
    }

    private function canUseEntity(int $entityId): bool
    {
        if ($entityId <= 0) {
            return false;
        }
        if (class_exists('\Session') && method_exists('\Session', 'haveAccessToEntity')) {
            return (bool) \Session::haveAccessToEntity($entityId);
        }

        $active = $_SESSION['glpiactiveentities'] ?? [];
        return is_array($active) && in_array($entityId, array_map('intval', $active), true);
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
