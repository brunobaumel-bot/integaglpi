<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi\Service;

use GlpiPlugin\Integaglpi\External\ExternalDatabase;
use PDO;
use PDOStatement;
use RuntimeException;
use Throwable;

final class KnowledgeBaseService
{
    private const ARTICLES_TABLE = 'glpi_plugin_integaglpi_kb_articles';
    private const VERSIONS_TABLE = 'glpi_plugin_integaglpi_kb_article_versions';
    private const AUDIT_TABLE = 'glpi_plugin_integaglpi_audit_events';
    private const ARTICLE_TYPES = [
        'procedimento_tecnico',
        'solucao_comum',
        'resposta_padrao',
        'diagnostico_conhecido',
        'faq_interno',
        'alerta_operacional',
    ];
    private const STATUSES = ['draft', 'active', 'archived'];
    private const PAGE_SIZE_DEFAULT = 20;
    private const PAGE_SIZE_MAX = 50;
    private const TITLE_MAX_LENGTH = 200;
    private const CONTENT_MAX_LENGTH = 20000;
    private const TAG_MAX_COUNT = 20;
    private const TAG_MAX_LENGTH = 40;

    private ?PDO $pdo = null;

    public function __construct(private readonly PluginConfigService $pluginConfigService)
    {
    }

    /**
     * @param array<string, mixed> $query
     * @param array{type: string, message: string, diagnostic?: string}|null $flash
     * @return array<string, mixed>
     */
    public function getPageData(array $query, ?array $flash = null): array
    {
        $filters = $this->normalizeFilters($query);
        $data = [
            'filters' => $filters,
            'flash' => $flash,
            'error' => '',
            'articles' => [],
            'total' => 0,
            'pages' => 1,
            'view_article' => null,
            'edit_article' => null,
            'versions' => [],
            'article_types' => self::ARTICLE_TYPES,
            'statuses' => self::STATUSES,
        ];

        if (!$this->pluginConfigService->isConfigured()) {
            $data['error'] = __('PostgreSQL externo ainda não está configurado.', 'glpiintegaglpi');
            return $data;
        }

        try {
            if (!$this->tableExists(self::ARTICLES_TABLE) || !$this->tableExists(self::VERSIONS_TABLE)) {
                $data['error'] = __('Tabelas da Base de Conhecimento ainda não existem. Execute a migration em TESTE antes de homologar.', 'glpiintegaglpi');
                return $data;
            }

            $data['total'] = $this->countArticles($filters);
            $data['pages'] = max(1, (int) ceil((int) $data['total'] / (int) $filters['limit']));
            $data['articles'] = $this->findArticles($filters);

            if ((int) $filters['view_id'] > 0) {
                $data['view_article'] = $this->findArticleById((int) $filters['view_id']);
                $data['versions'] = $this->findVersions((int) $filters['view_id']);
            }
            if ((int) $filters['edit_id'] > 0) {
                $data['edit_article'] = $this->findArticleById((int) $filters['edit_id']);
            }
        } catch (Throwable $exception) {
            error_log('[integaglpi][kb][load] ' . $exception->getMessage());
            $data['error'] = __('Falha ao carregar Base de Conhecimento. Verifique logs do servidor.', 'glpiintegaglpi');
        }

        return $data;
    }

    /**
     * @param array<string, mixed> $post
     * @return array{type: string, message: string}
     */
    public function handlePost(array $post, int $userId): array
    {
        if (!$this->pluginConfigService->isConfigured()) {
            return ['type' => 'danger', 'message' => __('PostgreSQL externo ainda não está configurado.', 'glpiintegaglpi')];
        }

        try {
            return match (trim((string) ($post['action'] ?? ''))) {
                'save_article' => $this->saveArticle($post, $userId),
                'publish_article' => $this->changeStatus((int) ($post['article_id'] ?? 0), 'active', $userId, 'KB_ARTICLE_PUBLISHED'),
                'archive_article' => $this->changeStatus((int) ($post['article_id'] ?? 0), 'archived', $userId, 'KB_ARTICLE_ARCHIVED'),
                default => ['type' => 'danger', 'message' => __('Ação inválida.', 'glpiintegaglpi')],
            };
        } catch (Throwable $exception) {
            error_log('[integaglpi][kb][save] user=' . $userId . ' ' . $exception->getMessage());

            return [
                'type' => 'danger',
                'message' => $exception instanceof RuntimeException
                    ? $exception->getMessage()
                    : __('Falha ao salvar Base de Conhecimento.', 'glpiintegaglpi'),
            ];
        }
    }

    /**
     * @return array<string, mixed>
     */
    private function normalizeFilters(array $query): array
    {
        $limit = max(1, min(self::PAGE_SIZE_MAX, (int) ($query['limit'] ?? self::PAGE_SIZE_DEFAULT)));
        $page = max(1, (int) ($query['page'] ?? 1));

        return [
            'q' => $this->cleanText($query['q'] ?? '', 120),
            'status' => $this->normalizeOptionalAllowlist($query['status'] ?? '', self::STATUSES),
            'article_type' => $this->normalizeOptionalAllowlist($query['article_type'] ?? '', self::ARTICLE_TYPES),
            'tag' => $this->normalizeTag((string) ($query['tag'] ?? '')),
            'sensitive' => in_array((string) ($query['sensitive'] ?? ''), ['yes', 'no'], true) ? (string) $query['sensitive'] : '',
            'view_id' => max(0, (int) ($query['view_id'] ?? 0)),
            'edit_id' => max(0, (int) ($query['edit_id'] ?? 0)),
            'page' => $page,
            'limit' => $limit,
            'offset' => ($page - 1) * $limit,
        ];
    }

    /**
     * @param array<string, mixed> $filters
     */
    private function countArticles(array $filters): int
    {
        [$where, $params] = $this->buildArticleWhere($filters);
        $sql = 'SELECT COUNT(*) FROM public.' . self::ARTICLES_TABLE . ' a' . ($where === [] ? '' : ' WHERE ' . implode(' AND ', $where));
        $stmt = $this->getPdo()->prepare($sql);
        $this->bindParams($stmt, $params);
        $stmt->execute();

        return (int) $stmt->fetchColumn();
    }

    /**
     * @param array<string, mixed> $filters
     * @return list<array<string, mixed>>
     */
    private function findArticles(array $filters): array
    {
        [$where, $params] = $this->buildArticleWhere($filters);
        $sql = 'SELECT a.*
                  FROM public.' . self::ARTICLES_TABLE . ' a'
            . ($where === [] ? '' : ' WHERE ' . implode(' AND ', $where))
            . ' ORDER BY a.updated_at DESC, a.id DESC
                LIMIT :limit OFFSET :offset';
        $stmt = $this->getPdo()->prepare($sql);
        $this->bindParams($stmt, $params);
        $stmt->bindValue(':limit', (int) $filters['limit'], PDO::PARAM_INT);
        $stmt->bindValue(':offset', (int) $filters['offset'], PDO::PARAM_INT);
        $stmt->execute();

        return $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
    }

    /**
     * @param array<string, mixed> $filters
     * @return array{0: list<string>, 1: array<string, array{value: mixed, type: int}>}
     */
    private function buildArticleWhere(array $filters): array
    {
        $where = [];
        $params = [];
        if ((string) $filters['q'] !== '') {
            $where[] = '(a.title ILIKE :q OR a.content_text ILIKE :q)';
            $params[':q'] = ['value' => '%' . (string) $filters['q'] . '%', 'type' => PDO::PARAM_STR];
        }
        if ((string) $filters['status'] !== '') {
            $where[] = 'a.status = :status';
            $params[':status'] = ['value' => (string) $filters['status'], 'type' => PDO::PARAM_STR];
        }
        if ((string) $filters['article_type'] !== '') {
            $where[] = 'a.article_type = :article_type';
            $params[':article_type'] = ['value' => (string) $filters['article_type'], 'type' => PDO::PARAM_STR];
        }
        if ((string) $filters['tag'] !== '') {
            $where[] = 'a.tags @> CAST(:tag_filter AS jsonb)';
            $params[':tag_filter'] = [
                'value' => json_encode([(string) $filters['tag']], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
                'type' => PDO::PARAM_STR,
            ];
        }
        if ((string) $filters['sensitive'] === 'yes') {
            $where[] = 'a.is_sensitive = TRUE';
        } elseif ((string) $filters['sensitive'] === 'no') {
            $where[] = 'a.is_sensitive = FALSE';
        }

        return [$where, $params];
    }

    /**
     * @return array<string, mixed>|null
     */
    private function findArticleById(int $id): ?array
    {
        if ($id <= 0) {
            return null;
        }

        $stmt = $this->getPdo()->prepare('SELECT * FROM public.' . self::ARTICLES_TABLE . ' WHERE id = :id LIMIT 1');
        $stmt->bindValue(':id', $id, PDO::PARAM_INT);
        $stmt->execute();
        $row = $stmt->fetch(PDO::FETCH_ASSOC);

        return is_array($row) ? $row : null;
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function findVersions(int $articleId): array
    {
        if ($articleId <= 0) {
            return [];
        }

        $stmt = $this->getPdo()->prepare(
            'SELECT * FROM public.' . self::VERSIONS_TABLE . '
             WHERE article_id = :article_id
             ORDER BY version DESC, created_at DESC'
        );
        $stmt->bindValue(':article_id', $articleId, PDO::PARAM_INT);
        $stmt->execute();

        return $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
    }

    /**
     * @param array<string, mixed> $post
     * @return array{type: string, message: string}
     */
    private function saveArticle(array $post, int $userId): array
    {
        if (!$this->tableExists(self::ARTICLES_TABLE) || !$this->tableExists(self::VERSIONS_TABLE)) {
            throw new RuntimeException(__('Tabelas da Base de Conhecimento ainda não existem.', 'glpiintegaglpi'));
        }

        $id = max(0, (int) ($post['article_id'] ?? 0));
        $payload = $this->normalizeArticlePayload($post);

        $this->assertNoExplicitSecret($payload['title']);
        $this->assertNoExplicitSecret($payload['content_text']);

        $pdo = $this->getPdo();
        $pdo->beginTransaction();
        try {
            if ($id > 0) {
                $existing = $this->findArticleById($id);
                if ($existing === null) {
                    throw new RuntimeException(__('Artigo não encontrado.', 'glpiintegaglpi'));
                }
                $nextVersion = ((int) ($existing['version'] ?? 1)) + 1;
                $stmt = $pdo->prepare(
                    'UPDATE public.' . self::ARTICLES_TABLE . '
                     SET title = :title,
                         content_text = :content_text,
                         article_type = :article_type,
                         category = :category,
                         service_catalog_id = :service_catalog_id,
                         routing_queue_id = :routing_queue_id,
                         tags = CAST(:tags AS jsonb),
                         is_sensitive = :is_sensitive,
                         version = :version,
                         updated_by_glpi_user_id = :updated_by,
                         updated_at = NOW()
                     WHERE id = :id'
                );
                $this->bindArticlePayload($stmt, $payload);
                $stmt->bindValue(':version', $nextVersion, PDO::PARAM_INT);
                $stmt->bindValue(':updated_by', $userId, PDO::PARAM_INT);
                $stmt->bindValue(':id', $id, PDO::PARAM_INT);
                $stmt->execute();

                $article = $this->findArticleById($id);
                $this->insertVersion($article, $userId, $this->cleanText($post['change_reason'] ?? '', 500));
                $this->audit('KB_ARTICLE_UPDATED', $article, $userId);
                $this->audit('KB_ARTICLE_VERSION_CREATED', $article, $userId);
                $pdo->commit();

                return ['type' => 'success', 'message' => __('Artigo atualizado e versionado.', 'glpiintegaglpi')];
            }

            $stmt = $pdo->prepare(
                'INSERT INTO public.' . self::ARTICLES_TABLE . '
                  (title, content_text, article_type, status, category, service_catalog_id, routing_queue_id, tags, is_sensitive, created_by_glpi_user_id)
                 VALUES
                  (:title, :content_text, :article_type, :status, :category, :service_catalog_id, :routing_queue_id, CAST(:tags AS jsonb), :is_sensitive, :created_by)
                 RETURNING *'
            );
            $this->bindArticlePayload($stmt, $payload);
            $stmt->bindValue(':status', 'draft', PDO::PARAM_STR);
            $stmt->bindValue(':created_by', $userId, PDO::PARAM_INT);
            $stmt->execute();
            $article = $stmt->fetch(PDO::FETCH_ASSOC);
            if (!is_array($article)) {
                throw new RuntimeException(__('Falha ao criar artigo.', 'glpiintegaglpi'));
            }
            $this->insertVersion($article, $userId, $this->cleanText($post['change_reason'] ?? '', 500));
            $this->audit('KB_ARTICLE_CREATED', $article, $userId);
            $this->audit('KB_ARTICLE_VERSION_CREATED', $article, $userId);
            $pdo->commit();

            return ['type' => 'success', 'message' => __('Artigo criado como rascunho.', 'glpiintegaglpi')];
        } catch (Throwable $exception) {
            $pdo->rollBack();
            throw $exception;
        }
    }

    /**
     * @return array{type: string, message: string}
     */
    private function changeStatus(int $id, string $status, int $userId, string $eventType): array
    {
        if ($id <= 0 || !in_array($status, self::STATUSES, true)) {
            throw new RuntimeException(__('Artigo inválido.', 'glpiintegaglpi'));
        }

        $article = $this->findArticleById($id);
        if ($article === null) {
            throw new RuntimeException(__('Artigo não encontrado.', 'glpiintegaglpi'));
        }
        if ((string) ($article['status'] ?? '') === $status) {
            return ['type' => 'info', 'message' => __('Artigo já está neste status.', 'glpiintegaglpi')];
        }

        $nextVersion = ((int) ($article['version'] ?? 1)) + 1;
        $publishedBy = $status === 'active' ? ', published_by_glpi_user_id = :status_by, published_at = NOW()' : '';
        $archivedBy = $status === 'archived' ? ', archived_by_glpi_user_id = :status_by, archived_at = NOW()' : '';

        $pdo = $this->getPdo();
        $pdo->beginTransaction();
        try {
            $stmt = $pdo->prepare(
                'UPDATE public.' . self::ARTICLES_TABLE . '
                 SET status = :status,
                     version = :version,
                     updated_by_glpi_user_id = :updated_by,
                     updated_at = NOW()'
                . $publishedBy
                . $archivedBy
                . ' WHERE id = :id'
            );
            $stmt->bindValue(':status', $status, PDO::PARAM_STR);
            $stmt->bindValue(':version', $nextVersion, PDO::PARAM_INT);
            $stmt->bindValue(':updated_by', $userId, PDO::PARAM_INT);
            if ($publishedBy !== '' || $archivedBy !== '') {
                $stmt->bindValue(':status_by', $userId, PDO::PARAM_INT);
            }
            $stmt->bindValue(':id', $id, PDO::PARAM_INT);
            $stmt->execute();

            $updated = $this->findArticleById($id);
            $this->insertVersion($updated, $userId, $status === 'active' ? 'publish' : 'archive');
            $this->audit($eventType, $updated, $userId);
            $this->audit('KB_ARTICLE_VERSION_CREATED', $updated, $userId);
            $pdo->commit();

            return [
                'type' => 'success',
                'message' => $status === 'active'
                    ? __('Artigo publicado.', 'glpiintegaglpi')
                    : __('Artigo arquivado sem deleção física.', 'glpiintegaglpi'),
            ];
        } catch (Throwable $exception) {
            $pdo->rollBack();
            throw $exception;
        }
    }

    /**
     * @param array<string, mixed> $post
     * @return array<string, mixed>
     */
    private function normalizeArticlePayload(array $post): array
    {
        $title = $this->cleanText($post['title'] ?? '', self::TITLE_MAX_LENGTH);
        $content = $this->cleanText($post['content_text'] ?? '', self::CONTENT_MAX_LENGTH);
        $articleType = $this->normalizeRequiredAllowlist($post['article_type'] ?? '', self::ARTICLE_TYPES, __('Tipo de artigo inválido.', 'glpiintegaglpi'));

        if ($title === '') {
            throw new RuntimeException(__('Título é obrigatório.', 'glpiintegaglpi'));
        }
        if ($content === '') {
            throw new RuntimeException(__('Conteúdo é obrigatório.', 'glpiintegaglpi'));
        }

        return [
            'title' => $title,
            'content_text' => $content,
            'article_type' => $articleType,
            'category' => $this->cleanText($post['category'] ?? '', 80),
            'service_catalog_id' => max(0, (int) ($post['service_catalog_id'] ?? 0)) ?: null,
            'routing_queue_id' => max(0, (int) ($post['routing_queue_id'] ?? 0)) ?: null,
            'tags' => $this->normalizeTags($post['tags'] ?? ''),
            'is_sensitive' => !empty($post['is_sensitive']),
        ];
    }

    /**
     * @param array<string, mixed>|null $article
     */
    private function insertVersion(?array $article, int $userId, string $changeReason): void
    {
        if ($article === null) {
            throw new RuntimeException(__('Artigo não encontrado para versionamento.', 'glpiintegaglpi'));
        }

        $stmt = $this->getPdo()->prepare(
            'INSERT INTO public.' . self::VERSIONS_TABLE . '
              (article_id, version, title, content_text, article_type, status, tags_snapshot, is_sensitive, changed_by_glpi_user_id, change_reason)
             VALUES
              (:article_id, :version, :title, :content_text, :article_type, :status, CAST(:tags_snapshot AS jsonb), :is_sensitive, :changed_by, :change_reason)'
        );
        $stmt->bindValue(':article_id', (int) $article['id'], PDO::PARAM_INT);
        $stmt->bindValue(':version', (int) $article['version'], PDO::PARAM_INT);
        $stmt->bindValue(':title', (string) $article['title'], PDO::PARAM_STR);
        $stmt->bindValue(':content_text', (string) $article['content_text'], PDO::PARAM_STR);
        $stmt->bindValue(':article_type', (string) $article['article_type'], PDO::PARAM_STR);
        $stmt->bindValue(':status', (string) $article['status'], PDO::PARAM_STR);
        $stmt->bindValue(':tags_snapshot', (string) ($article['tags'] ?? '[]'), PDO::PARAM_STR);
        $stmt->bindValue(':is_sensitive', (bool) $article['is_sensitive'], PDO::PARAM_BOOL);
        $stmt->bindValue(':changed_by', $userId, PDO::PARAM_INT);
        $this->bindNullableString($stmt, ':change_reason', $changeReason);
        $stmt->execute();
    }

    /**
     * @param array<string, mixed>|null $article
     */
    private function audit(string $eventType, ?array $article, int $userId): void
    {
        if ($article === null || !$this->tableExists(self::AUDIT_TABLE)) {
            return;
        }

        $payload = [
            'article_id' => (int) ($article['id'] ?? 0),
            'title_truncated' => mb_substr((string) ($article['title'] ?? ''), 0, 80),
            'status' => (string) ($article['status'] ?? ''),
            'article_type' => (string) ($article['article_type'] ?? ''),
            'is_sensitive' => (bool) ($article['is_sensitive'] ?? false),
            'glpi_user_id' => $userId,
        ];

        $stmt = $this->getPdo()->prepare(
            'INSERT INTO public.' . self::AUDIT_TABLE . ' (
                correlation_id,
                ticket_id,
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
                NULL,
                NULL,
                NULL,
                NULL,
                :event_type,
                :status,
                :severity,
                :source,
                CAST(:payload_json AS jsonb),
                NOW()
            )'
        );
        $stmt->bindValue(':correlation_id', 'kb:' . (int) $article['id'], PDO::PARAM_STR);
        $stmt->bindValue(':event_type', $eventType, PDO::PARAM_STR);
        $stmt->bindValue(':status', 'success', PDO::PARAM_STR);
        $stmt->bindValue(':severity', 'info', PDO::PARAM_STR);
        $stmt->bindValue(':source', 'PluginKnowledgeBase', PDO::PARAM_STR);
        $stmt->bindValue(':payload_json', json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE), PDO::PARAM_STR);
        $stmt->execute();
    }

    /**
     * @param array<string, mixed> $payload
     */
    private function bindArticlePayload(PDOStatement $stmt, array $payload): void
    {
        $stmt->bindValue(':title', (string) $payload['title'], PDO::PARAM_STR);
        $stmt->bindValue(':content_text', (string) $payload['content_text'], PDO::PARAM_STR);
        $stmt->bindValue(':article_type', (string) $payload['article_type'], PDO::PARAM_STR);
        $this->bindNullableString($stmt, ':category', (string) $payload['category']);
        $this->bindNullableInt($stmt, ':service_catalog_id', $payload['service_catalog_id']);
        $this->bindNullableInt($stmt, ':routing_queue_id', $payload['routing_queue_id']);
        $stmt->bindValue(':tags', json_encode($payload['tags'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), PDO::PARAM_STR);
        $stmt->bindValue(':is_sensitive', (bool) $payload['is_sensitive'], PDO::PARAM_BOOL);
    }

    private function getPdo(): PDO
    {
        if ($this->pdo === null) {
            $this->pdo = ExternalDatabase::getConnection($this->pluginConfigService->getConnectionConfig());
        }

        return $this->pdo;
    }

    private function tableExists(string $table): bool
    {
        $stmt = $this->getPdo()->prepare(
            'SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = :table LIMIT 1'
        );
        $stmt->execute([':table' => $table]);

        return (bool) $stmt->fetchColumn();
    }

    /**
     * @param array<string, array{value: mixed, type: int}> $params
     */
    private function bindParams(PDOStatement $stmt, array $params): void
    {
        foreach ($params as $name => $param) {
            $stmt->bindValue($name, $param['value'], $param['type']);
        }
    }

    /**
     * @param list<string> $allowlist
     */
    private function normalizeOptionalAllowlist(mixed $value, array $allowlist): string
    {
        $normalized = strtolower(trim((string) $value));

        return in_array($normalized, $allowlist, true) ? $normalized : '';
    }

    /**
     * @param list<string> $allowlist
     */
    private function normalizeRequiredAllowlist(mixed $value, array $allowlist, string $message): string
    {
        $normalized = strtolower(trim((string) $value));
        if (!in_array($normalized, $allowlist, true)) {
            throw new RuntimeException($message);
        }

        return $normalized;
    }

    /**
     * @return list<string>
     */
    private function normalizeTags(mixed $value): array
    {
        $rawTags = is_array($value) ? $value : preg_split('/[,;\n]+/', (string) $value);
        $tags = [];
        foreach ($rawTags ?: [] as $tag) {
            $normalized = $this->normalizeTag((string) $tag);
            if ($normalized !== '') {
                $tags[] = $normalized;
            }
        }

        return array_slice(array_values(array_unique($tags)), 0, self::TAG_MAX_COUNT);
    }

    private function normalizeTag(string $value): string
    {
        $tag = strtolower(trim($value));
        $tag = (string) preg_replace('/[^a-z0-9_.-]+/', '-', $tag);
        $tag = trim($tag, '.-_');

        return substr($tag, 0, self::TAG_MAX_LENGTH);
    }

    private function cleanText(mixed $value, int $maxLength): string
    {
        $text = trim((string) $value);
        $text = (string) preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/', '', $text);

        return mb_substr($text, 0, $maxLength);
    }

    private function assertNoExplicitSecret(string $value): void
    {
        $patterns = [
            '/password\s*=/i',
            '/token\s*=/i',
            '/\bbearer\b/i',
            '/app_secret/i',
            '/api_key/i',
            '/chave\s+privada/i',
            '/BEGIN\s+PRIVATE\s+KEY/i',
        ];
        foreach ($patterns as $pattern) {
            if (preg_match($pattern, $value) === 1) {
                throw new RuntimeException(__('Conteúdo bloqueado: remova tokens, senhas, chaves ou segredos antes de salvar.', 'glpiintegaglpi'));
            }
        }
    }

    private function bindNullableString(PDOStatement $stmt, string $name, ?string $value): void
    {
        if ($value === null || $value === '') {
            $stmt->bindValue($name, null, PDO::PARAM_NULL);
            return;
        }
        $stmt->bindValue($name, $value, PDO::PARAM_STR);
    }

    private function bindNullableInt(PDOStatement $stmt, string $name, mixed $value): void
    {
        if ($value === null) {
            $stmt->bindValue($name, null, PDO::PARAM_NULL);
            return;
        }
        $stmt->bindValue($name, (int) $value, PDO::PARAM_INT);
    }
}
