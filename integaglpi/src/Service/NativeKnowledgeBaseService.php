<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi\Service;

use GlpiPlugin\Integaglpi\Plugin;
use Session;

final class NativeKnowledgeBaseService
{
    private const FINAL_LIMIT = 5;
    private const CANDIDATE_LIMIT = 50;
    private const EXCERPT_LIMIT = 800;

    /**
     * @return array<int, array<string, mixed>>
     */
    public function searchVisibleArticles(string $query = '', int $limit = self::FINAL_LIMIT): array
    {
        $query = $this->normalizeSearchText($query);
        $limit = max(1, min(self::FINAL_LIMIT, $limit));

        $articles = [];
        foreach ($this->fetchCandidateRows(self::CANDIDATE_LIMIT) as $row) {
            $article = $this->buildVisibleArticle($row, $query);
            if ($article === null) {
                continue;
            }

            $articles[] = $article;
            if (count($articles) >= $limit) {
                break;
            }
        }

        return $articles;
    }

    /**
     * @return array<string, mixed>|null
     */
    public function getVisibleArticle(int $id): ?array
    {
        if ($id <= 0 || !$this->nativeKnowledgeBaseAvailable()) {
            return null;
        }

        global $DB;
        $criteria = [
            'FROM' => 'glpi_knowbaseitems',
            'WHERE' => ['id' => $id],
            'LIMIT' => 1,
        ];

        if ($this->fieldExists('glpi_knowbaseitems', 'is_deleted')) {
            $criteria['WHERE']['is_deleted'] = 0;
        }

        foreach ($DB->request($criteria) as $row) {
            return $this->buildVisibleArticle((array) $row, '');
        }

        return null;
    }

    /**
     * @param array<string, mixed> $context
     * @return array<int, array<string, mixed>>
     */
    public function buildRelatedArticlesContext(array $context, int $limit = self::FINAL_LIMIT): array
    {
        $terms = [];
        foreach (['ticket_name', 'ticket_title', 'summary', 'last_message', 'queue_name', 'service_name'] as $key) {
            $value = trim((string) ($context[$key] ?? ''));
            if ($value !== '') {
                $terms[] = $value;
            }
        }

        return $this->searchVisibleArticles(implode(' ', $terms), $limit);
    }

    public function sanitizeArticleHtml(string $html): string
    {
        $clean = preg_replace('/<\s*(script|iframe|style)\b[^>]*>.*?<\s*\/\s*\1\s*>/is', ' ', $html) ?? $html;
        $clean = preg_replace('/<\s*img\b[^>]*(?:src\s*=\s*["\']?\s*data:image\/[^>]+)?[^>]*>/is', ' ', $clean) ?? $clean;
        $clean = preg_replace('/https?:\/\/\S*(?:access_token|token|bearer|signature|app_secret)\S*/i', '[link removido]', $clean) ?? $clean;
        $clean = html_entity_decode(strip_tags($clean), ENT_QUOTES | ENT_HTML5, 'UTF-8');
        $clean = preg_replace('/\s+/u', ' ', $clean) ?? $clean;

        return $this->truncate(trim($clean), self::EXCERPT_LIMIT);
    }

    public function getNativeArticleUrl(int $id): string
    {
        global $CFG_GLPI;

        return rtrim((string) ($CFG_GLPI['root_doc'] ?? ''), '/') . '/front/knowbaseitem.form.php?' . http_build_query([
            'id' => max(0, $id),
        ]);
    }

    private function nativeKnowledgeBaseAvailable(): bool
    {
        return class_exists('\KnowbaseItem') && $this->tableExists('glpi_knowbaseitems');
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    private function fetchCandidateRows(int $limit): array
    {
        if (!$this->nativeKnowledgeBaseAvailable()) {
            return [];
        }

        global $DB;
        $fields = ['id'];
        foreach (['name', 'answer', 'knowbaseitemcategories_id', 'entities_id', 'is_recursive'] as $field) {
            if ($this->fieldExists('glpi_knowbaseitems', $field)) {
                $fields[] = $field;
            }
        }

        $criteria = [
            'SELECT' => $fields,
            'FROM' => 'glpi_knowbaseitems',
            'LIMIT' => max(1, min(self::CANDIDATE_LIMIT, $limit)),
            'ORDER' => 'id DESC',
        ];

        if ($this->fieldExists('glpi_knowbaseitems', 'is_deleted')) {
            $criteria['WHERE'] = ['is_deleted' => 0];
        }

        $rows = [];
        foreach ($DB->request($criteria) as $row) {
            $rows[] = (array) $row;
        }

        return $rows;
    }

    /**
     * @param array<string, mixed> $row
     * @return array<string, mixed>|null
     */
    private function buildVisibleArticle(array $row, string $query): ?array
    {
        $id = (int) ($row['id'] ?? 0);
        if ($id <= 0 || !$this->canViewArticle($id, $row)) {
            return null;
        }

        $title = $this->sanitizeArticleHtml((string) ($row['name'] ?? ''));
        $excerpt = $this->sanitizeArticleHtml((string) ($row['answer'] ?? ''));
        $category = $this->getCategoryName((int) ($row['knowbaseitemcategories_id'] ?? 0));

        if (!$this->matchesSearch([$title, $excerpt, $category], $query)) {
            return null;
        }

        return [
            'article_id' => $id,
            'title' => $title !== '' ? $title : sprintf('Artigo #%d', $id),
            'category' => $category,
            'excerpt' => $excerpt,
            'internal_url' => $this->getNativeArticleUrl($id),
            'source_label' => 'Base de Conhecimento GLPI',
            'relevance_reason' => $query !== '' ? 'Correspondência textual simples' : 'Artigo recente visível ao usuário',
        ];
    }

    /**
     * @param array<string, mixed> $row
     */
    private function canViewArticle(int $id, array $row): bool
    {
        if (!$this->isEntityVisible($row)) {
            return false;
        }

        if (class_exists('\KnowbaseItem')) {
            $item = new \KnowbaseItem();
            if (method_exists($item, 'getFromDB') && !$item->getFromDB($id)) {
                return false;
            }

            if (method_exists($item, 'can')) {
                return (bool) $item->can($id, READ);
            }

            if (method_exists($item, 'canViewItem')) {
                return (bool) $item->canViewItem();
            }
        }

        return Plugin::canKnowledgeBaseRead()
            && class_exists('\Session')
            && (!method_exists(Session::class, 'haveRight') || Session::haveRight('knowbase', READ));
    }

    /**
     * @param array<string, mixed> $row
     */
    private function isEntityVisible(array $row): bool
    {
        if (!array_key_exists('entities_id', $row)) {
            return true;
        }

        $entityId = (int) ($row['entities_id'] ?? 0);
        $recursive = (int) ($row['is_recursive'] ?? 0) === 1;
        if ($entityId <= 0) {
            return true;
        }

        return !method_exists(Session::class, 'haveAccessToEntity')
            || Session::haveAccessToEntity($entityId, $recursive);
    }

    private function getCategoryName(int $categoryId): string
    {
        if ($categoryId <= 0 || !$this->tableExists('glpi_knowbaseitemcategories')) {
            return '';
        }

        global $DB;
        foreach ($DB->request([
            'SELECT' => ['name'],
            'FROM' => 'glpi_knowbaseitemcategories',
            'WHERE' => ['id' => $categoryId],
            'LIMIT' => 1,
        ]) as $row) {
            return $this->sanitizeArticleHtml((string) ($row['name'] ?? ''));
        }

        return '';
    }

    /**
     * @param array<int, string> $haystacks
     */
    private function matchesSearch(array $haystacks, string $query): bool
    {
        if ($query === '') {
            return true;
        }

        $normalizedQuery = mb_strtolower($query, 'UTF-8');
        foreach ($haystacks as $haystack) {
            if (str_contains(mb_strtolower($haystack, 'UTF-8'), $normalizedQuery)) {
                return true;
            }
        }

        return false;
    }

    private function normalizeSearchText(string $value): string
    {
        $value = $this->sanitizeArticleHtml($value);

        return $this->truncate($value, 120);
    }

    private function truncate(string $value, int $limit): string
    {
        if (mb_strlen($value, 'UTF-8') <= $limit) {
            return $value;
        }

        return rtrim(mb_substr($value, 0, max(0, $limit - 1), 'UTF-8')) . '…';
    }

    private function tableExists(string $table): bool
    {
        global $DB;

        return isset($DB)
            && is_object($DB)
            && method_exists($DB, 'tableExists')
            && (bool) $DB->tableExists($table);
    }

    private function fieldExists(string $table, string $field): bool
    {
        global $DB;

        return isset($DB)
            && is_object($DB)
            && method_exists($DB, 'fieldExists')
            && (bool) $DB->fieldExists($table, $field);
    }
}
