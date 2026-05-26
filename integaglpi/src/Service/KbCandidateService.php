<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi\Service;

use GlpiPlugin\Integaglpi\External\ExternalDatabase;
use PDO;
use PDOStatement;
use RuntimeException;
use Throwable;

final class KbCandidateService
{
    private const CANDIDATES_TABLE = 'glpi_plugin_integaglpi_kb_candidates';
    private const REVIEWS_TABLE = 'glpi_plugin_integaglpi_kb_candidate_reviews';
    private const AUDIT_TABLE = 'glpi_plugin_integaglpi_audit_events';
    private const STATUSES = ['suggested', 'in_review', 'approved', 'rejected', 'low_confidence', 'possible_duplicate'];
    private const ARTICLE_TYPES = [
        'procedimento_tecnico',
        'solucao_comum',
        'resposta_padrao_humanizada',
        'checklist_diagnostico',
        'faq_interno',
        'alerta_operacional',
        'pergunta_inicial_recomendada',
    ];
    private const PAGE_SIZE_DEFAULT = 20;
    private const PAGE_SIZE_MAX = 50;

    private ?PDO $pdo = null;

    private PluginConfigService $pluginConfigService;

    public function __construct(PluginConfigService $pluginConfigService)
    {
        $this->pluginConfigService = $pluginConfigService;
    }

    /**
     * @param array<string, mixed> $query
     * @param array{type: string, message: string}|null $flash
     * @return array<string, mixed>
     */
    public function getPageData(array $query, ?array $flash = null): array
    {
        $filters = $this->normalizeFilters($query);
        $data = [
            'filters' => $filters,
            'flash' => $flash,
            'error' => '',
            'candidates' => [],
            'view_candidate' => null,
            'reviews' => [],
            'total' => 0,
            'pages' => 1,
            'statuses' => self::STATUSES,
            'article_types' => self::ARTICLE_TYPES,
        ];

        if (!$this->pluginConfigService->isConfigured()) {
            $data['error'] = __('PostgreSQL externo ainda não está configurado.', 'glpiintegaglpi');
            return $data;
        }

        try {
            if (!$this->tableExists(self::CANDIDATES_TABLE) || !$this->tableExists(self::REVIEWS_TABLE)) {
                $data['error'] = __('Tabelas de candidatos de KB ainda não existem. Execute a migration 030 em TESTE.', 'glpiintegaglpi');
                return $data;
            }

            $data['total'] = $this->countCandidates($filters);
            $data['pages'] = max(1, (int) ceil((int) $data['total'] / (int) $filters['limit']));
            $data['candidates'] = $this->findCandidates($filters);

            if ((int) $filters['view_id'] > 0) {
                $data['view_candidate'] = $this->findCandidateById((int) $filters['view_id']);
                $data['reviews'] = $this->findReviews((int) $filters['view_id']);
            }
        } catch (Throwable $exception) {
            error_log('[integaglpi][kb_candidates][load] ' . $exception->getMessage());
            $data['error'] = __('Falha ao carregar candidatos de KB. Verifique logs do servidor.', 'glpiintegaglpi');
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
            $action = trim((string) ($post['action'] ?? ''));
            switch ($action) {
                case 'mark_in_review':
                    return $this->reviewCandidate((int) ($post['candidate_id'] ?? 0), 'in_review', $userId, $post);
                case 'approve':
                    return $this->reviewCandidate((int) ($post['candidate_id'] ?? 0), 'approved', $userId, $post);
                case 'reject':
                    return $this->reviewCandidate((int) ($post['candidate_id'] ?? 0), 'rejected', $userId, $post);
                case 'copy_markdown':
                    return $this->recordCopyMarkdown((int) ($post['candidate_id'] ?? 0), $userId);
                default:
                    return ['type' => 'danger', 'message' => __('Ação inválida.', 'glpiintegaglpi')];
            }
        } catch (Throwable $exception) {
            error_log('[integaglpi][kb_candidates][post] user=' . $userId . ' ' . $exception->getMessage());

            return [
                'type' => 'danger',
                'message' => $exception instanceof RuntimeException
                    ? $exception->getMessage()
                    : __('Falha ao revisar candidato de KB.', 'glpiintegaglpi'),
            ];
        }
    }

    /**
     * Creates a KB candidate from a ticket solution text.
     * The candidate is stored with status 'suggested' and must be manually reviewed/published.
     * No automatic KB publish. No WhatsApp send. Human gate required.
     *
     * @return array{type: string, message: string}
     */
    public function createKbCandidateFromSolution(
        int $ticketId,
        string $solutionText,
        string $ticketTitle,
        int $userId
    ): array {
        if (!$this->pluginConfigService->isConfigured()) {
            return ['type' => 'danger', 'message' => __('PostgreSQL externo ainda não está configurado.', 'glpiintegaglpi')];
        }

        if ($ticketId <= 0) {
            return ['type' => 'danger', 'message' => __('ID de chamado inválido.', 'glpiintegaglpi')];
        }

        $cleanSolution = $this->cleanText($solutionText, 2000);
        if ($cleanSolution === '') {
            return ['type' => 'danger', 'message' => __('Texto da solução não pode ser vazio.', 'glpiintegaglpi')];
        }

        $cleanTitle = $this->cleanText($ticketTitle, 120);
        if ($cleanTitle === '') {
            $cleanTitle = __('Solução do chamado #', 'glpiintegaglpi') . $ticketId;
        }

        try {
            if (!$this->tableExists(self::CANDIDATES_TABLE) || !$this->tableExists(self::REVIEWS_TABLE)) {
                return ['type' => 'danger', 'message' => __('Tabelas de candidatos de KB ainda não existem. Execute a migration 030 em TESTE.', 'glpiintegaglpi')];
            }

            $candidateKey = 'solution:' . $ticketId . ':' . bin2hex(random_bytes(8));
            $inputHash = hash('sha256', 'ticket_solution:' . $ticketId . ':' . $cleanSolution);

            $pdo = $this->getPdo();
            $pdo->beginTransaction();
            try {
                $stmt = $pdo->prepare(
                    'INSERT INTO public.' . self::CANDIDATES_TABLE . ' (
                        candidate_key,
                        input_hash,
                        status,
                        article_type,
                        title,
                        content_markdown,
                        confidence_score,
                        created_by_glpi_user_id
                    ) VALUES (
                        :candidate_key,
                        :input_hash,
                        :status,
                        :article_type,
                        :title,
                        :content_markdown,
                        :confidence_score,
                        :created_by_glpi_user_id
                    ) RETURNING id'
                );
                $stmt->bindValue(':candidate_key', $candidateKey, PDO::PARAM_STR);
                $stmt->bindValue(':input_hash', $inputHash, PDO::PARAM_STR);
                $stmt->bindValue(':status', 'suggested', PDO::PARAM_STR);
                $stmt->bindValue(':article_type', 'solucao_comum', PDO::PARAM_STR);
                $stmt->bindValue(':title', $cleanTitle, PDO::PARAM_STR);
                $stmt->bindValue(':content_markdown', $cleanSolution, PDO::PARAM_STR);
                $stmt->bindValue(':confidence_score', 60, PDO::PARAM_INT);
                $stmt->bindValue(':created_by_glpi_user_id', $userId, PDO::PARAM_INT);
                $stmt->execute();

                $newId = (int) $stmt->fetchColumn();
                if ($newId <= 0) {
                    throw new RuntimeException(__('Falha ao criar candidato de KB: ID inválido retornado.', 'glpiintegaglpi'));
                }

                $creationNote = __('Candidato criado a partir da solução do chamado #', 'glpiintegaglpi') . $ticketId . '.';
                $this->insertReview($newId, 'edit_note', $userId, $creationNote, '', 'suggested');

                $candidate = $this->findCandidateById($newId);
                $this->audit('KB_CANDIDATE_CREATED_FROM_SOLUTION', $candidate, $userId);

                $pdo->commit();

                return ['type' => 'success', 'message' => __('Candidato KB criado. Nenhuma publicação automática foi executada. Acesse "Mineração Histórica" para revisar.', 'glpiintegaglpi')];
            } catch (Throwable $exceptionInner) {
                $pdo->rollBack();
                throw $exceptionInner;
            }
        } catch (Throwable $exception) {
            error_log('[integaglpi][kb_candidates][create_from_solution] ticket=' . $ticketId . ' user=' . $userId . ' ' . $exception->getMessage());

            return [
                'type' => 'danger',
                'message' => $exception instanceof RuntimeException
                    ? $exception->getMessage()
                    : __('Falha ao criar candidato de KB a partir da solução.', 'glpiintegaglpi'),
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
            'duplicate' => in_array((string) ($query['duplicate'] ?? ''), ['yes', 'no'], true) ? (string) $query['duplicate'] : '',
            'view_id' => max(0, (int) ($query['view_id'] ?? 0)),
            'page' => $page,
            'limit' => $limit,
            'offset' => ($page - 1) * $limit,
        ];
    }

    /**
     * @param array<string, mixed> $filters
     */
    private function countCandidates(array $filters): int
    {
        [$where, $params] = $this->buildWhere($filters);
        $sql = 'SELECT COUNT(*) FROM public.' . self::CANDIDATES_TABLE . ' c' . ($where === [] ? '' : ' WHERE ' . implode(' AND ', $where));
        $stmt = $this->getPdo()->prepare($sql);
        $this->bindParams($stmt, $params);
        $stmt->execute();

        return (int) $stmt->fetchColumn();
    }

    /**
     * @param array<string, mixed> $filters
     * @return list<array<string, mixed>>
     */
    private function findCandidates(array $filters): array
    {
        [$where, $params] = $this->buildWhere($filters);
        $sql = 'SELECT c.*
                  FROM public.' . self::CANDIDATES_TABLE . ' c'
            . ($where === [] ? '' : ' WHERE ' . implode(' AND ', $where))
            . ' ORDER BY c.created_at DESC, c.id DESC
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
    private function buildWhere(array $filters): array
    {
        $where = [];
        $params = [];
        if ((string) $filters['q'] !== '') {
            $where[] = '(c.title ILIKE :q OR c.problem_pattern ILIKE :q OR c.evidence_summary_sanitized ILIKE :q)';
            $params[':q'] = ['value' => '%' . (string) $filters['q'] . '%', 'type' => PDO::PARAM_STR];
        }
        if ((string) $filters['status'] !== '') {
            $where[] = 'c.status = :status';
            $params[':status'] = ['value' => (string) $filters['status'], 'type' => PDO::PARAM_STR];
        }
        if ((string) $filters['article_type'] !== '') {
            $where[] = 'c.article_type = :article_type';
            $params[':article_type'] = ['value' => (string) $filters['article_type'], 'type' => PDO::PARAM_STR];
        }
        if ((string) $filters['duplicate'] === 'yes') {
            $where[] = 'c.possible_duplicate = TRUE';
        } elseif ((string) $filters['duplicate'] === 'no') {
            $where[] = 'c.possible_duplicate = FALSE';
        }

        return [$where, $params];
    }

    /**
     * @return array<string, mixed>|null
     */
    private function findCandidateById(int $id): ?array
    {
        if ($id <= 0) {
            return null;
        }

        $stmt = $this->getPdo()->prepare('SELECT * FROM public.' . self::CANDIDATES_TABLE . ' WHERE id = :id LIMIT 1');
        $stmt->bindValue(':id', $id, PDO::PARAM_INT);
        $stmt->execute();
        $row = $stmt->fetch(PDO::FETCH_ASSOC);

        return is_array($row) ? $row : null;
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function findReviews(int $candidateId): array
    {
        if ($candidateId <= 0) {
            return [];
        }

        $stmt = $this->getPdo()->prepare(
            'SELECT * FROM public.' . self::REVIEWS_TABLE . '
             WHERE candidate_id = :candidate_id
             ORDER BY created_at DESC, id DESC
             LIMIT 50'
        );
        $stmt->bindValue(':candidate_id', $candidateId, PDO::PARAM_INT);
        $stmt->execute();

        return $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
    }

    /**
     * @param array<string, mixed> $post
     * @return array{type: string, message: string}
     */
    private function reviewCandidate(int $candidateId, string $newStatus, int $userId, array $post): array
    {
        if (!in_array($newStatus, ['in_review', 'approved', 'rejected'], true)) {
            throw new RuntimeException(__('Status de revisão inválido.', 'glpiintegaglpi'));
        }

        $candidate = $this->findCandidateById($candidateId);
        if ($candidate === null) {
            throw new RuntimeException(__('Candidato não encontrado.', 'glpiintegaglpi'));
        }

        $notes = $this->cleanText($post['review_notes'] ?? '', 1000);
        $previousStatus = (string) ($candidate['status'] ?? '');
        $pdo = $this->getPdo();
        $pdo->beginTransaction();
        try {
            $stmt = $pdo->prepare(
                'UPDATE public.' . self::CANDIDATES_TABLE . '
                 SET status = :status,
                     reviewed_by_glpi_user_id = :reviewer_id,
                     reviewed_at = NOW(),
                     review_notes = :review_notes,
                     updated_at = NOW()
                 WHERE id = :id'
            );
            $stmt->bindValue(':status', $newStatus, PDO::PARAM_STR);
            $stmt->bindValue(':reviewer_id', $userId, PDO::PARAM_INT);
            $this->bindNullableString($stmt, ':review_notes', $notes);
            $stmt->bindValue(':id', $candidateId, PDO::PARAM_INT);
            $stmt->execute();

            $this->insertReview($candidateId, $this->actionForStatus($newStatus), $userId, $notes, $previousStatus, $newStatus);
            $updated = $this->findCandidateById($candidateId);
            $this->audit($this->eventForStatus($newStatus), $updated, $userId);
            $pdo->commit();

            return ['type' => 'success', 'message' => __('Revisão registrada. Nenhuma publicação automática foi executada.', 'glpiintegaglpi')];
        } catch (Throwable $exception) {
            $pdo->rollBack();
            throw $exception;
        }
    }

    /**
     * @return array{type: string, message: string}
     */
    private function recordCopyMarkdown(int $candidateId, int $userId): array
    {
        $candidate = $this->findCandidateById($candidateId);
        if ($candidate === null) {
            throw new RuntimeException(__('Candidato não encontrado.', 'glpiintegaglpi'));
        }

        $this->insertReview($candidateId, 'copy_markdown', $userId, '', (string) ($candidate['status'] ?? ''), (string) ($candidate['status'] ?? ''));
        $this->audit('KB_CANDIDATE_MARKDOWN_COPIED', $candidate, $userId);

        return ['type' => 'success', 'message' => __('Cópia registrada. A publicação continua manual na Base GLPI nativa.', 'glpiintegaglpi')];
    }

    private function insertReview(int $candidateId, string $action, int $userId, string $notes, string $previousStatus, string $newStatus): void
    {
        $stmt = $this->getPdo()->prepare(
            'INSERT INTO public.' . self::REVIEWS_TABLE . '
              (candidate_id, action, reviewer_id, notes, previous_status, new_status)
             VALUES
              (:candidate_id, :action, :reviewer_id, :notes, :previous_status, :new_status)'
        );
        $stmt->bindValue(':candidate_id', $candidateId, PDO::PARAM_INT);
        $stmt->bindValue(':action', $action, PDO::PARAM_STR);
        $stmt->bindValue(':reviewer_id', $userId, PDO::PARAM_INT);
        $this->bindNullableString($stmt, ':notes', $notes);
        $this->bindNullableString($stmt, ':previous_status', $previousStatus);
        $this->bindNullableString($stmt, ':new_status', $newStatus);
        $stmt->execute();
    }

    /**
     * @param array<string, mixed>|null $candidate
     */
    private function audit(string $eventType, ?array $candidate, int $userId): void
    {
        if ($candidate === null || !$this->tableExists(self::AUDIT_TABLE)) {
            return;
        }

        $payload = [
            'candidate_id' => (int) ($candidate['id'] ?? 0),
            'status' => (string) ($candidate['status'] ?? ''),
            'article_type' => (string) ($candidate['article_type'] ?? ''),
            'confidence_score' => (int) ($candidate['confidence_score'] ?? 0),
            'possible_duplicate' => (bool) ($candidate['possible_duplicate'] ?? false),
            'source_pattern_ids' => json_decode((string) ($candidate['source_pattern_ids_json'] ?? '[]'), true) ?: [],
            'source_insight_ids' => json_decode((string) ($candidate['source_insight_ids_json'] ?? '[]'), true) ?: [],
            'reviewer_id' => $userId,
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
        $stmt->bindValue(':correlation_id', 'kb_candidate:' . (int) $candidate['id'], PDO::PARAM_STR);
        $stmt->bindValue(':event_type', $eventType, PDO::PARAM_STR);
        $stmt->bindValue(':status', 'success', PDO::PARAM_STR);
        $stmt->bindValue(':severity', 'info', PDO::PARAM_STR);
        $stmt->bindValue(':source', 'PluginKbCandidate', PDO::PARAM_STR);
        $stmt->bindValue(':payload_json', json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE), PDO::PARAM_STR);
        $stmt->execute();
    }

    private function actionForStatus(string $status): string
    {
        if ($status === 'approved') {
            return 'approve';
        }
        if ($status === 'rejected') {
            return 'reject';
        }

        return 'mark_in_review';
    }

    private function eventForStatus(string $status): string
    {
        if ($status === 'approved') {
            return 'KB_CANDIDATE_APPROVED';
        }
        if ($status === 'rejected') {
            return 'KB_CANDIDATE_REJECTED';
        }

        return 'KB_CANDIDATE_REVIEWED';
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
    private function normalizeOptionalAllowlist($value, array $allowlist): string
    {
        $normalized = strtolower(trim((string) $value));

        return in_array($normalized, $allowlist, true) ? $normalized : '';
    }

    private function cleanText($value, int $maxLength): string
    {
        $text = trim((string) $value);
        $text = (string) preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/', '', $text);

        return mb_substr($text, 0, $maxLength);
    }

    private function bindNullableString(PDOStatement $stmt, string $name, ?string $value): void
    {
        if ($value === null || $value === '') {
            $stmt->bindValue($name, null, PDO::PARAM_NULL);
            return;
        }
        $stmt->bindValue($name, $value, PDO::PARAM_STR);
    }
}
