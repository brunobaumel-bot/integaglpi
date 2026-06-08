<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi\Service;

use PDO;
use PDOException;
use RuntimeException;
use Throwable;

/**
 * Imports KB candidate bundles from the enriched JSON format
 * (schema_version: integaglpi.kb_bundle.v1.1).
 *
 * Safety contracts:
 * - status is always set to 'candidate' — never 'approved', never published
 * - publicados_na_kb is always 0 (no GLPI KnowbaseItem created here)
 * - revisao_humana is always true (reflected in return value)
 * - idempotent: ON CONFLICT (candidate_key) DO NOTHING
 * - never writes to MariaDB / GLPI core
 * - never sends WhatsApp
 * - never calls any publish/approve method
 *
 * PHASE: integaglpi_kb_candidates_enriched_import_001
 */
final class KbCandidateImportService
{
    private const CANDIDATES_TABLE = 'glpi_plugin_integaglpi_kb_candidates';
    private const BUNDLE_SCHEMA    = 'integaglpi.kb_bundle.v1.1';
    private const IMPORT_STATUS    = 'candidate';      // never approved/suggested here
    private const MAX_TITLE_LEN    = 250;
    private const MAX_CATEGORY_LEN = 120;
    private const MAX_CONTENT_LEN  = 65535;

    /** Map review.confidence → confidence_score integer */
    private const CONFIDENCE_MAP = [
        'high'   => 80,
        'medium' => 60,
        'low'    => 40,
    ];

    /** Map taxonomy category path → article_type slug */
    private const CATEGORY_TYPE_MAP = [
        'Backup'         => 'procedimento_tecnico',
        'Infraestrutura' => 'procedimento_tecnico',
        'Rede'           => 'procedimento_tecnico',
        'Network'        => 'procedimento_tecnico',
        'Cloud'          => 'solucao_comum',
        'Sistema'        => 'solucao_comum',
        'Email'          => 'solucao_comum',
        'Contratos'      => 'faq_interno',
        'Segurança'      => 'alerta_operacional',
        'Operação'       => 'checklist_diagnostico',
        'Banco de Dados' => 'procedimento_tecnico',
    ];

    private PDO $pdo;

    public function __construct(PDO $pdo)
    {
        $this->pdo = $pdo;
    }

    /**
     * Import a bundle file.
     *
     * @return array{
     *   ok: bool,
     *   total_lido: int,
     *   candidatos_importados: int,
     *   candidatos_skipped: int,
     *   publicados_na_kb: int,
     *   status: string,
     *   revisao_humana: bool,
     *   errors: list<string>,
     *   imported_keys: list<string>
     * }
     */
    public function importFromFile(string $filePath): array
    {
        $result = [
            'ok'                    => false,
            'total_lido'            => 0,
            'candidatos_importados' => 0,
            'candidatos_skipped'    => 0,
            'publicados_na_kb'      => 0,   // ALWAYS 0 — no auto-publish
            'status'                => self::IMPORT_STATUS,
            'revisao_humana'        => true, // ALWAYS true
            'errors'                => [],
            'imported_keys'         => [],
        ];

        if (!is_file($filePath) || !is_readable($filePath)) {
            $result['errors'][] = 'Arquivo não encontrado ou sem permissão de leitura: ' . $filePath;
            return $result;
        }

        $raw = file_get_contents($filePath);
        if ($raw === false) {
            $result['errors'][] = 'Falha ao ler arquivo: ' . $filePath;
            return $result;
        }

        $bundle = json_decode($raw, true);
        if (!is_array($bundle)) {
            $result['errors'][] = 'JSON inválido: ' . json_last_error_msg();
            return $result;
        }

        // Validate bundle schema
        $schemaVersion = (string) ($bundle['schema_version'] ?? '');
        if ($schemaVersion !== self::BUNDLE_SCHEMA) {
            $result['errors'][] = sprintf(
                'Schema não suportado: "%s". Esperado: "%s".',
                $schemaVersion,
                self::BUNDLE_SCHEMA
            );
            return $result;
        }

        // Validate bundle rules
        $rules = $bundle['rules'] ?? [];
        if (($rules['default_publish_to_customer'] ?? true) !== false) {
            $result['errors'][] = 'Bundle inválido: default_publish_to_customer deve ser false.';
            return $result;
        }
        if (($rules['human_approval_required'] ?? false) !== true) {
            $result['errors'][] = 'Bundle inválido: human_approval_required deve ser true.';
            return $result;
        }

        $articles = $bundle['articles'] ?? [];
        if (!is_array($articles) || count($articles) === 0) {
            $result['errors'][] = 'Bundle sem artigos.';
            return $result;
        }

        $result['total_lido'] = count($articles);

        if (!$this->tableExists(self::CANDIDATES_TABLE)) {
            $result['errors'][] = 'Tabela ' . self::CANDIDATES_TABLE . ' não encontrada. Execute migration 030.';
            return $result;
        }

        foreach ($articles as $idx => $article) {
            try {
                $inserted = $this->importArticle($article, $idx);
                if ($inserted) {
                    $result['candidatos_importados']++;
                    $result['imported_keys'][] = (string) ($article['id'] ?? '');
                } else {
                    $result['candidatos_skipped']++; // candidate_key already exists
                }
            } catch (Throwable $e) {
                $result['errors'][] = sprintf(
                    '[idx=%d id=%s] %s',
                    $idx,
                    (string) ($article['id'] ?? '?'),
                    $e->getMessage()
                );
            }
        }

        // publicados_na_kb is ALWAYS 0 — we never create KnowbaseItems here
        $result['publicados_na_kb'] = 0;
        $result['ok'] = count($result['errors']) === 0 || $result['candidatos_importados'] > 0;

        return $result;
    }

    /**
     * Insert a single article. Returns true if inserted, false if skipped (duplicate key).
     *
     * @param array<string, mixed> $article
     */
    private function importArticle(array $article, int $idx): bool
    {
        $candidateKey = $this->cleanStr($article['id'] ?? '', 200);
        if ($candidateKey === '') {
            throw new RuntimeException('Campo "id" ausente ou vazio no artigo idx=' . $idx);
        }

        $source  = is_array($article['source'] ?? null)     ? $article['source']              : [];
        $review  = is_array($article['review'] ?? null)     ? $article['review']              : [];
        $tax     = is_array($article['taxonomy'] ?? null)   ? $article['taxonomy']            : [];
        $content = is_array($article['content'] ?? null)    ? $article['content']             : [];
        $safety  = is_array($article['safety'] ?? null)     ? $article['safety']              : [];
        $glpi    = is_array($article['glpi_import_candidate'] ?? null) ? $article['glpi_import_candidate'] : [];

        // Safety gate: block if PII or credentials flagged
        if (($safety['contains_pii'] ?? false) === true) {
            throw new RuntimeException('Artigo contém PII declarado (id=' . $candidateKey . '). Bloco de segurança.');
        }
        if (($safety['contains_credentials'] ?? false) === true) {
            throw new RuntimeException('Artigo contém credenciais declaradas (id=' . $candidateKey . '). Bloco de segurança.');
        }
        // Validate: publish_to_customer must be false per article
        $visibility = is_array($article['visibility'] ?? null) ? $article['visibility'] : [];
        if (($visibility['publish_to_customer'] ?? true) !== false) {
            throw new RuntimeException('publish_to_customer=true no artigo id=' . $candidateKey . '. Bloco de segurança.');
        }

        $inputHash       = $this->cleanStr($source['original_payload_hash_sha256'] ?? '', 64);
        $title           = $this->cleanStr($content['title'] ?? ($glpi['name'] ?? ''), self::MAX_TITLE_LEN);
        $contentMarkdown = $this->cleanStr($glpi['answer_markdown'] ?? '', self::MAX_CONTENT_LEN);
        $problemPattern  = $this->cleanStr($content['problem'] ?? '', 500);
        $summary         = $this->cleanStr($content['summary'] ?? '', 1000);
        $categoryRaw     = $this->cleanStr($tax['category'] ?? '', self::MAX_CATEGORY_LEN);
        $articleType     = $this->mapArticleType($tax);
        $tags            = is_array($tax['tags'] ?? null) ? $tax['tags'] : [];
        $symptoms        = is_array($content['symptoms'] ?? null) ? $content['symptoms'] : [];
        $causes          = is_array($content['likely_causes'] ?? null) ? $content['likely_causes'] : [];
        $procedure       = is_array($content['resolution_steps'] ?? null) ? $content['resolution_steps'] : [];
        $checklist       = is_array($content['initial_checks'] ?? null) ? $content['initial_checks'] : [];
        $confidence      = self::CONFIDENCE_MAP[$review['confidence'] ?? ''] ?? 60;

        if ($title === '') {
            throw new RuntimeException('Título ausente (id=' . $candidateKey . ')');
        }

        $sql = '
            INSERT INTO public.' . self::CANDIDATES_TABLE . ' (
                candidate_key,
                input_hash,
                status,
                article_type,
                title,
                content_markdown,
                problem_pattern,
                symptoms_json,
                probable_cause,
                recommended_procedure_json,
                checklist_json,
                tags_json,
                category_suggestion,
                evidence_summary_sanitized,
                confidence_score,
                possible_duplicate,
                source_pattern_ids_json,
                source_insight_ids_json,
                created_by_glpi_user_id
            ) VALUES (
                :candidate_key,
                :input_hash,
                :status,
                :article_type,
                :title,
                :content_markdown,
                :problem_pattern,
                CAST(:symptoms_json AS jsonb),
                :probable_cause,
                CAST(:recommended_procedure_json AS jsonb),
                CAST(:checklist_json AS jsonb),
                CAST(:tags_json AS jsonb),
                :category_suggestion,
                :evidence_summary_sanitized,
                :confidence_score,
                false,
                \'[]\',
                CAST(:source_insight_ids_json AS jsonb),
                0
            )
            ON CONFLICT (candidate_key) DO NOTHING
        ';

        $stmt = $this->pdo->prepare($sql);
        $stmt->bindValue(':candidate_key',             $candidateKey,              PDO::PARAM_STR);
        $stmt->bindValue(':input_hash',                $inputHash ?: null,         $inputHash ? PDO::PARAM_STR : PDO::PARAM_NULL);
        $stmt->bindValue(':status',                    self::IMPORT_STATUS,        PDO::PARAM_STR);
        $stmt->bindValue(':article_type',              $articleType,               PDO::PARAM_STR);
        $stmt->bindValue(':title',                     $title,                     PDO::PARAM_STR);
        $stmt->bindValue(':content_markdown',          $contentMarkdown,           PDO::PARAM_STR);
        $stmt->bindValue(':problem_pattern',           $problemPattern ?: null,    $problemPattern ? PDO::PARAM_STR : PDO::PARAM_NULL);
        $stmt->bindValue(':symptoms_json',             json_encode($symptoms, JSON_UNESCAPED_UNICODE), PDO::PARAM_STR);
        $stmt->bindValue(':probable_cause',            implode(' | ', $causes) ?: null, $causes ? PDO::PARAM_STR : PDO::PARAM_NULL);
        $stmt->bindValue(':recommended_procedure_json', json_encode($procedure, JSON_UNESCAPED_UNICODE), PDO::PARAM_STR);
        $stmt->bindValue(':checklist_json',            json_encode($checklist, JSON_UNESCAPED_UNICODE), PDO::PARAM_STR);
        $stmt->bindValue(':tags_json',                 json_encode($tags, JSON_UNESCAPED_UNICODE),     PDO::PARAM_STR);
        $stmt->bindValue(':category_suggestion',       $categoryRaw ?: null,       $categoryRaw ? PDO::PARAM_STR : PDO::PARAM_NULL);
        $stmt->bindValue(':evidence_summary_sanitized', $summary ?: null,          $summary ? PDO::PARAM_STR : PDO::PARAM_NULL);
        $stmt->bindValue(':confidence_score',          $confidence,                PDO::PARAM_INT);
        $stmt->bindValue(':source_insight_ids_json',
            json_encode(['source_index' => $source['source_index'] ?? null, 'external_id' => $article['external_id'] ?? null]),
            PDO::PARAM_STR
        );

        $stmt->execute();

        // rowCount() = 0 means ON CONFLICT DO NOTHING triggered (duplicate)
        return $stmt->rowCount() > 0;
    }

    /**
     * Map taxonomy.category_path[0] → article_type slug.
     *
     * @param array<string, mixed> $taxonomy
     */
    private function mapArticleType(array $taxonomy): string
    {
        $path = $taxonomy['category_path'] ?? [];
        $root = is_array($path) && isset($path[0]) ? (string) $path[0] : '';

        foreach (self::CATEGORY_TYPE_MAP as $prefix => $type) {
            if (stripos($root, $prefix) !== false) {
                return $type;
            }
        }

        return 'solucao_comum'; // safe default
    }

    private function tableExists(string $table): bool
    {
        $stmt = $this->pdo->prepare(
            'SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = :t LIMIT 1'
        );
        $stmt->execute([':t' => $table]);
        return (bool) $stmt->fetchColumn();
    }

    private function cleanStr(mixed $v, int $maxLen): string
    {
        $s = trim((string) ($v ?? ''));
        $s = (string) preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/', '', $s);
        return mb_substr($s, 0, $maxLen, 'UTF-8');
    }
}
