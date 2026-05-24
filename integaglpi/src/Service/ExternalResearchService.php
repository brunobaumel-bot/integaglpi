<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi\Service;

use DateInterval;
use DateTimeImmutable;
use GlpiPlugin\Integaglpi\External\ExternalDatabase;
use PDO;
use Throwable;

final class ExternalResearchService
{
    private const SOURCE_TABLE = 'glpi_plugin_integaglpi_external_source_catalog';
    private const REQUEST_TABLE = 'glpi_plugin_integaglpi_external_research_requests';
    private const RESULT_TABLE = 'glpi_plugin_integaglpi_external_research_results';
    private const CANDIDATE_TABLE = 'glpi_plugin_integaglpi_external_research_candidates';
    private const REVIEW_TABLE = 'glpi_plugin_integaglpi_external_research_reviews';
    private const AUDIT_TABLE = 'glpi_plugin_integaglpi_audit_events';
    private const MAX_PROMPT_CHARS = 4000;
    private const MAX_SOURCES = 5;
    private const CONFIDENCE_THRESHOLD = 70;

    private ?PDO $pdo = null;

    public function __construct(private readonly PluginConfigService $pluginConfigService)
    {
    }

    /**
     * @param array<string, mixed> $query
     * @param array<string, mixed>|null $flash
     * @return array<string, mixed>
     */
    public function getPageData(array $query, ?array $flash = null): array
    {
        $data = [
            'flash' => $flash,
            'catalog' => [],
            'recent_requests' => [],
            'recent_candidates' => [],
            'error' => '',
        ];

        if (!$this->pluginConfigService->isConfigured()) {
            $data['error'] = __('PostgreSQL externo ainda não está configurado.', 'glpiintegaglpi');
            return $data;
        }

        try {
            if (!$this->tablesReady()) {
                $data['error'] = __('Tabelas da pesquisa externa ainda não existem. Execute a migration 036 em TESTE.', 'glpiintegaglpi');
                return $data;
            }

            $data['catalog'] = $this->loadCatalog();
            $data['recent_requests'] = $this->loadRecentRequests();
            $data['recent_candidates'] = $this->loadRecentCandidates();
        } catch (Throwable $exception) {
            error_log('[integaglpi][external_research][load] ' . $this->sanitizeText($exception->getMessage(), 180));
            $data['error'] = __('Falha ao carregar pesquisa externa controlada.', 'glpiintegaglpi');
        }

        return $data;
    }

    /**
     * @param array<string, mixed> $post
     * @return array<string, mixed>
     */
    public function handlePost(array $post, int $userId): array
    {
        if (!$this->pluginConfigService->isConfigured() || !$this->tablesReady()) {
            return ['type' => 'danger', 'message' => __('Pesquisa externa ainda não está disponível.', 'glpiintegaglpi')];
        }

        $action = trim((string) ($post['action'] ?? ''));
        try {
            return match ($action) {
                'preview' => $this->preview($post),
                'confirm_research' => $this->confirmResearch($post, $userId, false),
                'create_candidate' => $this->confirmResearch($post, $userId, true),
                'copy_markdown' => $this->recordReviewAction($post, $userId, 'markdown_copied'),
                'report_incident' => $this->reportIncident($post, $userId),
                default => ['type' => 'danger', 'message' => __('Ação inválida.', 'glpiintegaglpi')],
            };
        } catch (Throwable $exception) {
            error_log('[integaglpi][external_research][post] ' . $this->sanitizeText($exception->getMessage(), 180));

            return ['type' => 'danger', 'message' => __('Falha ao processar pesquisa externa controlada.', 'glpiintegaglpi')];
        }
    }

    /**
     * @param array<string, mixed> $post
     * @return array<string, mixed>
     */
    private function preview(array $post): array
    {
        $context = $this->buildContext($post);
        if ($context['sanitized']['text'] === '') {
            return ['type' => 'danger', 'message' => __('Informe um resumo técnico para pesquisa.', 'glpiintegaglpi')];
        }

        return [
            'type' => $context['sanitized']['blocked'] ? 'warning' : 'info',
            'message' => $context['sanitized']['blocked']
                ? __('Preview gerado, mas a pesquisa será bloqueada até remover PII/segredos do insumo.', 'glpiintegaglpi')
                : __('Preview anonimizado gerado. Confirme manualmente antes da pesquisa.', 'glpiintegaglpi'),
            'preview' => $context,
        ];
    }

    /**
     * @param array<string, mixed> $post
     * @return array<string, mixed>
     */
    private function confirmResearch(array $post, int $userId, bool $createCandidate): array
    {
        $context = $this->buildContext($post);
        if ($context['sanitized']['text'] === '') {
            return ['type' => 'danger', 'message' => __('Informe um resumo técnico para pesquisa.', 'glpiintegaglpi')];
        }

        if ($context['sanitized']['blocked']) {
            $this->audit('EXTERNAL_RESEARCH_BLOCKED_PII', null, $userId, [
                'detected_kinds' => $context['sanitized']['detected_kinds'],
                'anonymized_payload_hash' => $context['sanitized']['anonymized_payload_hash'],
            ]);

            return [
                'type' => 'danger',
                'message' => __('Pesquisa bloqueada: PII/segredo detectado. Revise o resumo antes de confirmar.', 'glpiintegaglpi'),
                'preview' => $context,
            ];
        }

        if ($context['source_errors'] !== []) {
            $this->audit('EXTERNAL_RESEARCH_BLOCKED_SOURCE', null, $userId, [
                'source_errors_count' => count($context['source_errors']),
                'anonymized_payload_hash' => $context['sanitized']['anonymized_payload_hash'],
            ]);

            return [
                'type' => 'danger',
                'message' => __('Pesquisa bloqueada: uma ou mais fontes estão fora da allowlist.', 'glpiintegaglpi'),
                'preview' => $context,
            ];
        }

        if ($context['validated_sources'] === []) {
            return ['type' => 'danger', 'message' => __('Informe ao menos uma fonte oficial cadastrada.', 'glpiintegaglpi'), 'preview' => $context];
        }

        $requestId = $this->newId('extresearch');
        $candidate = $this->buildCandidate($context, $requestId);
        $pdo = $this->getPdo();
        $pdo->beginTransaction();
        try {
            $this->insertRequest($requestId, $userId, $context, $createCandidate ? 'candidate_created' : 'completed', $candidate['confidence_score']);
            $this->insertResults($requestId, $context, $candidate);
            if ($createCandidate) {
                $this->insertCandidate($requestId, $userId, $context, $candidate);
                $this->audit('EXTERNAL_RESEARCH_CANDIDATE_CREATED', $requestId, $userId, [
                    'candidate_id' => $candidate['candidate_id'],
                    'confidence_score' => $candidate['confidence_score'],
                    'status' => $candidate['status'],
                    'source_catalog_ids' => $candidate['source_catalog_ids'],
                    'anonymized_payload_hash' => $context['sanitized']['anonymized_payload_hash'],
                ]);
            }
            $pdo->commit();
        } catch (Throwable $exception) {
            $pdo->rollBack();
            throw $exception;
        }

        $this->audit('EXTERNAL_RESEARCH_REQUESTED', $requestId, $userId, [
            'source_catalog_ids' => $candidate['source_catalog_ids'],
            'provider' => 'disabled',
            'estimated_cost' => 0,
            'anonymized_payload_hash' => $context['sanitized']['anonymized_payload_hash'],
        ]);
        $this->audit('EXTERNAL_RESEARCH_COMPLETED', $requestId, $userId, [
            'confidence_score' => $candidate['confidence_score'],
            'source_catalog_ids' => $candidate['source_catalog_ids'],
        ]);

        return [
            'type' => 'success',
            'message' => $createCandidate
                ? __('Candidato de KB externo criado para revisão humana. Publicação continua manual.', 'glpiintegaglpi')
                : __('Pesquisa externa controlada registrada com fontes citadas.', 'glpiintegaglpi'),
            'preview' => $context,
            'candidate' => $candidate,
            'request_id' => $requestId,
        ];
    }

    /**
     * @param array<string, mixed> $post
     * @return array<string, mixed>
     */
    private function recordReviewAction(array $post, int $userId, string $action): array
    {
        $requestId = $this->sanitizeIdentifier((string) ($post['request_id'] ?? ''));
        $candidateId = $this->sanitizeIdentifier((string) ($post['candidate_id'] ?? ''));
        if ($requestId === '' && $candidateId === '') {
            return ['type' => 'danger', 'message' => __('Informe uma pesquisa ou candidato para registrar a ação.', 'glpiintegaglpi')];
        }

        $stmt = $this->getPdo()->prepare(
            'INSERT INTO public.' . self::REVIEW_TABLE . ' (request_id, candidate_id, reviewer_id, action, notes_sanitized, created_at)
             VALUES (:request_id, :candidate_id, :reviewer_id, :action, :notes, NOW())'
        );
        $stmt->bindValue(':request_id', $requestId !== '' ? $requestId : 'manual');
        $stmt->bindValue(':candidate_id', $candidateId !== '' ? $candidateId : null);
        $stmt->bindValue(':reviewer_id', $userId, PDO::PARAM_INT);
        $stmt->bindValue(':action', $action);
        $stmt->bindValue(':notes', $this->sanitizeText((string) ($post['notes'] ?? ''), 500));
        $stmt->execute();
        $this->audit('EXTERNAL_RESEARCH_REVIEWED', $requestId !== '' ? $requestId : null, $userId, [
            'candidate_id' => $candidateId,
            'action' => $action,
        ]);

        return ['type' => 'success', 'message' => __('Ação revisável registrada. Nenhuma publicação automática foi executada.', 'glpiintegaglpi')];
    }

    /**
     * @param array<string, mixed> $post
     * @return array<string, mixed>
     */
    private function reportIncident(array $post, int $userId): array
    {
        $context = $this->buildContext($post);
        $requestId = $this->newId('incident');
        $this->insertRequest($requestId, $userId, $context, 'incident_reported', null);
        $this->audit('EXTERNAL_RESEARCH_INCIDENT_REPORTED', $requestId, $userId, [
            'provider' => 'disabled',
            'anonymized_payload_hash' => $context['sanitized']['anonymized_payload_hash'],
            'incident_response' => 'disable_external_provider_notify_dpo_no_retry',
        ]);

        return [
            'type' => 'warning',
            'message' => __('Incidente registrado. Mantenha provider externo desabilitado e acione DPO/responsável. Nenhum retry automático será feito.', 'glpiintegaglpi'),
            'preview' => $context,
        ];
    }

    /**
     * @param array<string, mixed> $post
     * @return array<string, mixed>
     */
    private function buildContext(array $post): array
    {
        $sanitized = $this->sanitizePrompt((string) ($post['technical_summary'] ?? ''));
        $catalog = $this->loadCatalog();
        $urls = $this->parseSourceUrls((string) ($post['source_urls'] ?? ''));
        $validated = [];
        $errors = [];
        foreach ($urls as $url) {
            $match = $this->matchSource($url, $catalog);
            if ($match === null) {
                $errors[] = ['url' => $this->sanitizeText($url, 250), 'reason' => 'EXTERNAL_RESEARCH_SOURCE_NOT_ALLOWLISTED'];
                continue;
            }
            $validated[] = [
                'url' => $this->sanitizeText($url, 500),
                'catalog' => $match,
                'confidence_score' => $this->sourceConfidence($match),
                'confidence_level' => (bool) $match['official_flag'] ? 'official' : ((string) $match['source_type'] === 'low_confidence' ? 'low_confidence' : 'verified'),
            ];
        }

        return [
            'sanitized' => $sanitized,
            'catalog' => $catalog,
            'source_urls' => $urls,
            'validated_sources' => $validated,
            'source_errors' => $errors,
            'source_conflicts' => $this->detectConflicts($validated),
        ];
    }

    /**
     * @param array<string, mixed> $context
     * @return array<string, mixed>
     */
    private function buildCandidate(array $context, string $requestId): array
    {
        $sources = $context['validated_sources'];
        $confidences = array_map(static fn (array $source): int => (int) $source['confidence_score'], $sources);
        $average = $confidences === [] ? 0 : (int) round(array_sum($confidences) / count($confidences));
        $conflictPenalty = count($context['source_conflicts']) * 12;
        $confidence = max(0, min(100, $average - $conflictPenalty));
        $status = $confidence >= self::CONFIDENCE_THRESHOLD ? 'suggested' : 'suggested_low_confidence';
        $today = new DateTimeImmutable('today');
        $nextReview = $today->add(new DateInterval('P90D'));
        $problem = $this->sanitizeText((string) $context['sanitized']['text'], 180);
        $title = $this->sanitizeText('Candidato externo: ' . ($problem !== '' ? $problem : 'procedimento técnico'), 180);
        $sourceRows = [];
        $catalogIds = [];
        foreach ($sources as $source) {
            $catalog = $source['catalog'];
            $catalogIds[] = (int) $catalog['id'];
            $sourceRows[] = [
                'title' => (string) $catalog['name'],
                'url' => (string) $source['url'],
                'source_type' => (string) $catalog['source_type'],
                'official_flag' => (bool) $catalog['official_flag'],
                'confidence' => (int) $source['confidence_score'],
                'last_verified_date' => $today->format('Y-m-d'),
            ];
        }

        $markdown = implode("\n", [
            '# ' . $title,
            '',
            '## Sintomas sanitizados',
            (string) $context['sanitized']['text'],
            '',
            '## Solução proposta para revisão humana',
            'Validar a documentação citada, conferir versões e adaptar o procedimento ao ambiente antes de publicar manualmente na KB nativa.',
            '',
            '## Passos sugeridos',
            '1. Priorizar fonte oficial.',
            '2. Validar pré-requisitos e riscos.',
            '3. Revisar com supervisor antes de publicação manual.',
            '',
            '## Aviso obrigatório',
            'Não execute comandos/scripts sem validação técnica humana.',
        ]);

        return [
            'candidate_id' => substr(hash('sha256', $requestId . ':' . $context['sanitized']['anonymized_payload_hash']), 0, 32),
            'request_id' => $requestId,
            'status' => $status,
            'title' => $title,
            'problem_signature' => $problem,
            'sanitized_symptoms' => (string) $context['sanitized']['text'],
            'likely_category' => 'Pesquisa externa controlada',
            'proposed_solution' => 'Transformar fontes citadas em procedimento interno revisado, sem publicação automática.',
            'step_by_step' => ['Priorizar documentação oficial.', 'Confirmar versão e escopo.', 'Publicar manualmente somente após revisão.'],
            'validation_steps' => ['Checar data da documentação.', 'Testar em ambiente controlado.', 'Revisar com supervisor.'],
            'risks' => ['Fonte externa pode estar desatualizada.', 'Não executar comandos/scripts sem validação humana.'],
            'prerequisites' => ['Prompt anonimizado.', 'Fonte cadastrada.', 'Revisão humana obrigatória.'],
            'external_sources' => $sourceRows,
            'source_conflicts' => $context['source_conflicts'],
            'confidence_score' => $confidence,
            'source_confidence_level' => $confidence >= self::CONFIDENCE_THRESHOLD ? 'official_or_verified' : 'low_confidence',
            'low_confidence_reason' => $confidence >= self::CONFIDENCE_THRESHOLD ? null : 'Confiança abaixo de 70 ou conflito de fontes.',
            'source_catalog_ids' => array_values(array_unique($catalogIds)),
            'last_verified_date' => $today->format('Y-m-d'),
            'next_review_due' => $nextReview->format('Y-m-d'),
            'humanized_customer_explanation' => 'Vamos validar a orientação em fonte confiável e adaptar o procedimento antes de aplicar no atendimento.',
            'suggested_kb_article' => ['title' => $title, 'content_markdown' => $markdown, 'tags' => ['pesquisa-externa', 'revisao-humana'], 'category_suggestion' => 'Pesquisa externa controlada'],
            'content_markdown' => $markdown,
            'human_review_required' => true,
            'auto_publish' => false,
        ];
    }

    /**
     * @return array{text: string, input_hash: string, anonymized_payload_hash: string, detected_kinds: list<string>, blocked: bool, blocked_reason: string|null}
     */
    private function sanitizePrompt(string $input): array
    {
        $original = mb_substr($input, 0, self::MAX_PROMPT_CHARS * 2);
        $detected = [];
        $text = $original;
        $patterns = [
            'private_key' => ['/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/i', '[private_key]'],
            'bearer' => ['/\bBearer\s+[A-Za-z0-9._~+\/=-]{12,}\b/i', 'Bearer [redacted]'],
            'secret' => ['/\b(password|passwd|senha|token|api[_-]?key|app[_-]?secret|secret|chave)\s*[:=]\s*[\'"]?[^\'"\s,;]{4,}/i', '$1=[redacted]'],
            'token_url' => ['#https?://[^\s<>"\']*(?:token|access_token|key|secret|sig|signature)=[^\s<>"\']+#i', '[token_url]'],
            'email' => ['/[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}/i', '[email]'],
            'name' => ['/\b(nome|cliente|contato|solicitante|tecnico|técnico)\s*(?::|=)?\s*[A-ZÀ-Ý][a-zà-ÿ]+(?:\s+[A-ZÀ-Ý][a-zà-ÿ]+){0,3}/iu', '$1: [nome]'],
            'phone' => ['/\b(?:\+?55\s?)?(?:\(?\d{2}\)?\s?)?(?:9\s?)?\d{4}[-.\s]?\d{4}\b/', '[telefone]'],
            'cpf_cnpj' => ['/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b|\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/', '[documento]'],
            'ip' => ['/\b(?:10|172\.(?:1[6-9]|2\d|3[0-1])|192\.168)\.\d{1,3}\.\d{1,3}\b/', '[ip_privado]'],
            'domain' => ['/\b(?:[a-z0-9-]+\.)+(?:local|lan|corp|internal|intra|eticainformatica\.com\.br)\b/i', '[dominio_interno]'],
            'address' => ['/\b(?:rua|avenida|av\.|rodovia|travessa)\s+[A-ZÀ-Ýa-zà-ÿ0-9 .-]{5,}/iu', '[endereco]'],
            'server_name' => ['/\b(?:srv|server|host|vm|db)-[a-z0-9-]{3,}\b/i', '[servidor_interno]'],
            'base64' => ['/\b(?:[A-Za-z0-9+\/]{80,}={0,2})\b/', '[base64]'],
        ];
        foreach ($patterns as $kind => [$pattern, $replacement]) {
            if (preg_match($pattern, $text)) {
                $detected[] = $kind;
            }
            $text = preg_replace($pattern, $replacement, $text) ?? '';
        }
        $text = preg_replace('/<script[\s\S]*?<\/script>/i', '[script_removed]', $text) ?? '';
        $text = preg_replace('/<iframe[\s\S]*?<\/iframe>/i', '[iframe_removed]', $text) ?? '';
        $text = preg_replace('/data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+\/=]+/i', '[image_base64]', $text) ?? '';
        $text = html_entity_decode(strip_tags($text), ENT_QUOTES | ENT_HTML5, 'UTF-8');
        $text = $this->sanitizeText($text, self::MAX_PROMPT_CHARS);
        $detected = array_values(array_unique($detected));

        return [
            'text' => $text,
            'input_hash' => hash('sha256', $original),
            'anonymized_payload_hash' => hash('sha256', $text),
            'detected_kinds' => $detected,
            'blocked' => $detected !== [],
            'blocked_reason' => $detected !== [] ? 'EXTERNAL_RESEARCH_PAYLOAD_BLOCKED_PII_OR_SECRET' : null,
        ];
    }

    /**
     * @return list<string>
     */
    private function parseSourceUrls(string $value): array
    {
        $items = [];
        foreach (preg_split('/\r?\n/', $value) ?: [] as $line) {
            $url = trim($line);
            if ($url === '' || !preg_match('#^https?://#i', $url)) {
                continue;
            }
            $items[] = $this->sanitizeText($url, 500);
        }

        return array_slice(array_values(array_unique($items)), 0, self::MAX_SOURCES);
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function loadCatalog(): array
    {
        $stmt = $this->getPdo()->query(
            'SELECT * FROM public.' . self::SOURCE_TABLE . ' WHERE enabled = TRUE ORDER BY priority ASC, id ASC LIMIT 100'
        );

        return $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
    }

    /**
     * @param list<array<string, mixed>> $catalog
     * @return array<string, mixed>|null
     */
    private function matchSource(string $url, array $catalog): ?array
    {
        $host = parse_url($url, PHP_URL_HOST);
        if (!is_string($host) || $host === '') {
            return null;
        }
        $host = strtolower($host);
        foreach ($catalog as $source) {
            $pattern = strtolower(trim((string) ($source['url_pattern'] ?? '')));
            if (str_starts_with($pattern, '*.')) {
                $suffix = substr($pattern, 2);
                if ($host === $suffix || str_ends_with($host, '.' . $suffix)) {
                    return $source;
                }
                continue;
            }
            if ($host === $pattern) {
                return $source;
            }
        }

        return null;
    }

    /**
     * @param array<string, mixed> $source
     */
    private function sourceConfidence(array $source): int
    {
        $base = (bool) ($source['official_flag'] ?? false) ? 70 : ((string) ($source['source_type'] ?? '') === 'low_confidence' ? 35 : 55);

        return max(0, min(100, $base + (int) ($source['confidence_boost'] ?? 0)));
    }

    /**
     * @param list<array<string, mixed>> $sources
     * @return list<string>
     */
    private function detectConflicts(array $sources): array
    {
        $hasOfficial = false;
        $hasLow = false;
        $types = [];
        foreach ($sources as $source) {
            $catalog = $source['catalog'] ?? [];
            $hasOfficial = $hasOfficial || (bool) ($catalog['official_flag'] ?? false);
            $hasLow = $hasLow || (string) ($catalog['source_type'] ?? '') === 'low_confidence';
            $types[(string) ($catalog['source_type'] ?? '')] = true;
        }

        $conflicts = [];
        if ($hasOfficial && $hasLow) {
            $conflicts[] = 'Fonte oficial e fonte de baixa confiança foram fornecidas; priorizar documentação oficial.';
        }
        if (count($types) > 1) {
            $conflicts[] = 'Fontes de tipos diferentes exigem validação humana de versão e escopo.';
        }

        return $conflicts;
    }

    /**
     * @param array<string, mixed> $context
     */
    private function insertRequest(string $requestId, int $userId, array $context, string $status, ?int $confidenceScore): void
    {
        $stmt = $this->getPdo()->prepare(
            'INSERT INTO public.' . self::REQUEST_TABLE . ' (
                request_id, requested_by_glpi_user_id, sanitized_prompt_hash, anonymized_payload_hash,
                provider, cloud_used, estimated_cost, status, blocked_reason, confidence_score, created_at, updated_at
            ) VALUES (
                :request_id, :user_id, :prompt_hash, :payload_hash,
                :provider, FALSE, 0, :status, :blocked_reason, :confidence_score, NOW(), NOW()
            )'
        );
        $stmt->bindValue(':request_id', $requestId);
        $stmt->bindValue(':user_id', $userId, PDO::PARAM_INT);
        $stmt->bindValue(':prompt_hash', (string) $context['sanitized']['input_hash']);
        $stmt->bindValue(':payload_hash', (string) $context['sanitized']['anonymized_payload_hash']);
        $stmt->bindValue(':provider', 'disabled');
        $stmt->bindValue(':status', $status);
        $stmt->bindValue(':blocked_reason', $context['sanitized']['blocked_reason']);
        $stmt->bindValue(':confidence_score', $confidenceScore, $confidenceScore === null ? PDO::PARAM_NULL : PDO::PARAM_INT);
        $stmt->execute();
    }

    /**
     * @param array<string, mixed> $context
     * @param array<string, mixed> $candidate
     */
    private function insertResults(string $requestId, array $context, array $candidate): void
    {
        $stmt = $this->getPdo()->prepare(
            'INSERT INTO public.' . self::RESULT_TABLE . ' (
                request_id, source_catalog_id, source_url, source_title, source_type, official_flag,
                confidence_score, excerpt_sanitized, source_conflicts_json, last_verified_date, next_review_due, created_at
            ) VALUES (
                :request_id, :source_catalog_id, :source_url, :source_title, :source_type, :official_flag,
                :confidence_score, :excerpt, CAST(:conflicts AS jsonb), :last_verified_date, :next_review_due, NOW()
            )'
        );
        foreach ($context['validated_sources'] as $source) {
            $catalog = $source['catalog'];
            $stmt->bindValue(':request_id', $requestId);
            $stmt->bindValue(':source_catalog_id', (int) $catalog['id'], PDO::PARAM_INT);
            $stmt->bindValue(':source_url', (string) $source['url']);
            $stmt->bindValue(':source_title', (string) $catalog['name']);
            $stmt->bindValue(':source_type', (string) $catalog['source_type']);
            $stmt->bindValue(':official_flag', (bool) $catalog['official_flag'], PDO::PARAM_BOOL);
            $stmt->bindValue(':confidence_score', (int) $source['confidence_score'], PDO::PARAM_INT);
            $stmt->bindValue(':excerpt', $this->sanitizeText('Fonte validada no catálogo. Conteúdo completo deve ser revisado manualmente no link citado.', 500));
            $stmt->bindValue(':conflicts', $this->json($candidate['source_conflicts']));
            $stmt->bindValue(':last_verified_date', (string) $candidate['last_verified_date']);
            $stmt->bindValue(':next_review_due', (string) $candidate['next_review_due']);
            $stmt->execute();
        }
    }

    /**
     * @param array<string, mixed> $context
     * @param array<string, mixed> $candidate
     */
    private function insertCandidate(string $requestId, int $userId, array $context, array $candidate): void
    {
        $stmt = $this->getPdo()->prepare(
            'INSERT INTO public.' . self::CANDIDATE_TABLE . ' (
                candidate_id, request_id, status, title, problem_signature, sanitized_symptoms,
                likely_category, proposed_solution, step_by_step_json, validation_steps_json, risks_json,
                prerequisites_json, external_sources_json, source_conflicts_json, confidence_score,
                source_confidence_level, low_confidence_reason, last_verified_date, next_review_due,
                humanized_customer_explanation, suggested_kb_article_json, content_markdown,
                source_catalog_ids_json, anonymized_payload_hash, input_hash, human_review_required,
                auto_publish, created_by_glpi_user_id, created_at, updated_at
            ) VALUES (
                :candidate_id, :request_id, :status, :title, :problem_signature, :sanitized_symptoms,
                :likely_category, :proposed_solution, CAST(:step_by_step AS jsonb), CAST(:validation_steps AS jsonb), CAST(:risks AS jsonb),
                CAST(:prerequisites AS jsonb), CAST(:external_sources AS jsonb), CAST(:source_conflicts AS jsonb), :confidence_score,
                :source_confidence_level, :low_confidence_reason, :last_verified_date, :next_review_due,
                :humanized_customer_explanation, CAST(:suggested_kb_article AS jsonb), :content_markdown,
                CAST(:source_catalog_ids AS jsonb), :anonymized_payload_hash, :input_hash, TRUE,
                FALSE, :user_id, NOW(), NOW()
            )
            ON CONFLICT (candidate_id) DO UPDATE SET updated_at = NOW()'
        );
        $stmt->bindValue(':candidate_id', (string) $candidate['candidate_id']);
        $stmt->bindValue(':request_id', $requestId);
        $stmt->bindValue(':status', (string) $candidate['status']);
        $stmt->bindValue(':title', (string) $candidate['title']);
        $stmt->bindValue(':problem_signature', (string) $candidate['problem_signature']);
        $stmt->bindValue(':sanitized_symptoms', (string) $candidate['sanitized_symptoms']);
        $stmt->bindValue(':likely_category', (string) $candidate['likely_category']);
        $stmt->bindValue(':proposed_solution', (string) $candidate['proposed_solution']);
        $stmt->bindValue(':step_by_step', $this->json($candidate['step_by_step']));
        $stmt->bindValue(':validation_steps', $this->json($candidate['validation_steps']));
        $stmt->bindValue(':risks', $this->json($candidate['risks']));
        $stmt->bindValue(':prerequisites', $this->json($candidate['prerequisites']));
        $stmt->bindValue(':external_sources', $this->json($candidate['external_sources']));
        $stmt->bindValue(':source_conflicts', $this->json($candidate['source_conflicts']));
        $stmt->bindValue(':confidence_score', (int) $candidate['confidence_score'], PDO::PARAM_INT);
        $stmt->bindValue(':source_confidence_level', (string) $candidate['source_confidence_level']);
        $stmt->bindValue(':low_confidence_reason', $candidate['low_confidence_reason']);
        $stmt->bindValue(':last_verified_date', (string) $candidate['last_verified_date']);
        $stmt->bindValue(':next_review_due', (string) $candidate['next_review_due']);
        $stmt->bindValue(':humanized_customer_explanation', (string) $candidate['humanized_customer_explanation']);
        $stmt->bindValue(':suggested_kb_article', $this->json($candidate['suggested_kb_article']));
        $stmt->bindValue(':content_markdown', (string) $candidate['content_markdown']);
        $stmt->bindValue(':source_catalog_ids', $this->json($candidate['source_catalog_ids']));
        $stmt->bindValue(':anonymized_payload_hash', (string) $context['sanitized']['anonymized_payload_hash']);
        $stmt->bindValue(':input_hash', (string) $context['sanitized']['input_hash']);
        $stmt->bindValue(':user_id', $userId, PDO::PARAM_INT);
        $stmt->execute();
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function loadRecentRequests(): array
    {
        $stmt = $this->getPdo()->query(
            'SELECT request_id, provider, cloud_used, estimated_cost, status, blocked_reason, confidence_score, created_at
               FROM public.' . self::REQUEST_TABLE . '
              ORDER BY created_at DESC
              LIMIT 10'
        );

        return $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function loadRecentCandidates(): array
    {
        $stmt = $this->getPdo()->query(
            'SELECT candidate_id, request_id, status, title, confidence_score, source_confidence_level,
                    low_confidence_reason, content_markdown, last_verified_date, next_review_due, created_at
               FROM public.' . self::CANDIDATE_TABLE . '
              ORDER BY created_at DESC
              LIMIT 10'
        );

        return array_map(fn (array $row): array => [
            'candidate_id' => (string) ($row['candidate_id'] ?? ''),
            'request_id' => (string) ($row['request_id'] ?? ''),
            'status' => (string) ($row['status'] ?? ''),
            'title' => $this->sanitizeText((string) ($row['title'] ?? ''), 180),
            'confidence_score' => (int) ($row['confidence_score'] ?? 0),
            'source_confidence_level' => (string) ($row['source_confidence_level'] ?? ''),
            'low_confidence_reason' => $this->sanitizeText((string) ($row['low_confidence_reason'] ?? ''), 250),
            'content_markdown' => $this->sanitizeText((string) ($row['content_markdown'] ?? ''), 4000),
            'last_verified_date' => (string) ($row['last_verified_date'] ?? ''),
            'next_review_due' => (string) ($row['next_review_due'] ?? ''),
            'created_at' => (string) ($row['created_at'] ?? ''),
        ], $stmt->fetchAll(PDO::FETCH_ASSOC) ?: []);
    }

    private function tablesReady(): bool
    {
        foreach ([self::SOURCE_TABLE, self::REQUEST_TABLE, self::RESULT_TABLE, self::CANDIDATE_TABLE, self::REVIEW_TABLE] as $table) {
            if (!$this->tableExists($table)) {
                return false;
            }
        }

        return true;
    }

    private function tableExists(string $table): bool
    {
        $stmt = $this->getPdo()->prepare(
            'SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = :table LIMIT 1'
        );
        $stmt->bindValue(':table', $table);
        $stmt->execute();

        return (bool) $stmt->fetchColumn();
    }

    /**
     * @param array<string, mixed> $payload
     */
    private function audit(string $eventType, ?string $requestId, int $userId, array $payload): void
    {
        try {
            if (!$this->tableExists(self::AUDIT_TABLE)) {
                return;
            }
            $stmt = $this->getPdo()->prepare(
                'INSERT INTO public.' . self::AUDIT_TABLE . ' (
                    correlation_id, event_type, status, severity, source, payload_json, created_at
                ) VALUES (
                    :correlation_id, :event_type, :status, :severity, :source, CAST(:payload AS jsonb), NOW()
                )'
            );
            $stmt->bindValue(':correlation_id', $requestId !== null ? 'external_research:' . $requestId : 'external_research:blocked');
            $stmt->bindValue(':event_type', $eventType);
            $stmt->bindValue(':status', str_contains($eventType, 'BLOCKED') ? 'blocked' : 'success');
            $stmt->bindValue(':severity', str_contains($eventType, 'INCIDENT') ? 'warning' : 'info');
            $stmt->bindValue(':source', 'ExternalResearchService');
            $stmt->bindValue(':payload', $this->json([
                'request_id' => $requestId,
                'glpi_user_id' => $userId,
                ...$payload,
            ]));
            $stmt->execute();
        } catch (Throwable $exception) {
            error_log('[integaglpi][external_research][audit] ' . $this->sanitizeText($exception->getMessage(), 180));
        }
    }

    private function sanitizeIdentifier(string $value): string
    {
        return preg_match('/^[a-z0-9:_-]{8,80}$/i', $value) ? $value : '';
    }

    private function sanitizeText(string $value, int $limit): string
    {
        $value = html_entity_decode(strip_tags($value), ENT_QUOTES | ENT_HTML5, 'UTF-8');
        $value = preg_replace('/[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}/i', '[email]', $value) ?? '';
        $value = preg_replace('/\b(?:\+?\d[\d .()\-]{7,}\d)\b/', '[telefone]', $value) ?? '';
        $value = preg_replace('/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b|\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/', '[documento]', $value) ?? '';
        $value = preg_replace('/(password|senha|token|bearer|api_key|app_secret|secret)\s*[:=]\s*\S+/i', '$1=[redacted]', $value) ?? '';
        $value = trim(preg_replace('/\s+/', ' ', $value) ?? '');

        return mb_substr($value, 0, $limit);
    }

    /**
     * @param mixed $value
     */
    private function json($value): string
    {
        $json = json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

        return $json === false ? 'null' : $json;
    }

    private function newId(string $prefix): string
    {
        return $prefix . '_' . bin2hex(random_bytes(16));
    }

    private function getPdo(): PDO
    {
        if (!$this->pdo instanceof PDO) {
            $this->pdo = ExternalDatabase::getConnection($this->pluginConfigService->getConnectionConfig());
        }

        return $this->pdo;
    }
}
