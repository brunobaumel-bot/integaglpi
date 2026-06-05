<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi\Service;

use DateInterval;
use DateTimeImmutable;
use GlpiPlugin\Integaglpi\External\ExternalDatabase;
use PDO;
use RuntimeException;
use Throwable;

final class ExternalResearchService
{
    private const SOURCE_TABLE = 'glpi_plugin_integaglpi_external_source_catalog';
    private const REQUEST_TABLE = 'glpi_plugin_integaglpi_external_research_requests';
    private const RESULT_TABLE = 'glpi_plugin_integaglpi_external_research_results';
    private const CANDIDATE_TABLE = 'glpi_plugin_integaglpi_external_research_candidates';
    private const REVIEW_TABLE = 'glpi_plugin_integaglpi_external_research_reviews';
    private const AUDIT_TABLE = 'glpi_plugin_integaglpi_audit_events';
    private const KB_CANDIDATES_TABLE = 'glpi_plugin_integaglpi_kb_candidates';
    private const HIST_INSIGHTS_TABLE = 'glpi_plugin_integaglpi_hist_insights';
    private const MAX_PROMPT_CHARS = 4000;
    private const MAX_SOURCES = 5;
    private const CONFIDENCE_THRESHOLD = 70;
    private const INTERNAL_KNOWLEDGE_LIMIT = 9;

    private PluginConfigService $pluginConfigService;
    private ?PDO $pdo = null;

    public function __construct(PluginConfigService $pluginConfigService)
    {
        $this->pluginConfigService = $pluginConfigService;
    }

    /**
     * Normalize provider responses for human review surfaces. This accepts the
     * JSON schema requested from the provider, legacy DynamicResearchAnswer
     * objects, or free text. The returned array is safe to render as a card; raw
     * JSON stays out of the primary view.
     *
     * @param mixed $payload
     * @param array<string, mixed> $meta
     * @return array<string, mixed>
     */
    public static function externalHelpViewModel($payload, array $meta = []): array
    {
        $decoded = self::decodeExternalPayload($payload);
        $record = is_array($decoded) ? $decoded : [];
        if ($record === [] && is_string($decoded)) {
            $record = self::extractExternalFieldsFromText($decoded);
        }
        $freeText = is_string($decoded) ? self::safeViewText($decoded, 2200) : '';
        if ($record !== []) {
            $freeText = '';
        }

        $diagnostic = self::firstViewText($record, ['diagnostico_provavel', 'diagnostic_hypothesis', 'diagnosis', 'diagnostico']);
        if ($diagnostic === '' && $freeText !== '') {
            $diagnostic = $freeText;
        }

        $questions = self::firstViewList($record, ['perguntas_ao_cliente', 'customer_questions', 'confirmationQuestions', 'questions']);
        $steps = self::firstViewList($record, ['passos_tecnicos', 'technical_steps', 'steps', 'procedimento']);
        $commands = self::firstViewList($record, ['commands_or_checks', 'commands', 'comandos_verificacoes', 'verificacoes', 'checks']);
        $cautions = self::firstViewList($record, ['riscos_cuidados', 'cautions', 'risks', 'cuidados']);
        $references = self::firstViewList($record, ['fontes_links_sugeridas', 'references', 'fontes', 'sources']);
        $nestedDecoded = self::decodeExternalPayload($diagnostic);
        if (is_array($nestedDecoded)) {
            $nestedDiagnostic = self::firstViewText($nestedDecoded, ['diagnostico_provavel', 'diagnostic_hypothesis', 'diagnosis', 'diagnostico']);
            if ($nestedDiagnostic !== '') {
                $diagnostic = $nestedDiagnostic;
            }
            if ($questions === []) {
                $questions = self::firstViewList($nestedDecoded, ['perguntas_ao_cliente', 'customer_questions', 'confirmationQuestions', 'questions']);
            }
            if ($steps === []) {
                $steps = self::firstViewList($nestedDecoded, ['passos_tecnicos', 'technical_steps', 'steps', 'procedimento']);
            }
            if ($commands === []) {
                $commands = self::firstViewList($nestedDecoded, ['commands_or_checks', 'commands', 'comandos_verificacoes', 'verificacoes', 'checks']);
            }
            if ($cautions === []) {
                $cautions = self::firstViewList($nestedDecoded, ['riscos_cuidados', 'cautions', 'risks', 'cuidados']);
            }
            if ($references === []) {
                $references = self::firstViewList($nestedDecoded, ['fontes_links_sugeridas', 'references', 'fontes', 'sources']);
            }
        }

        $confidence = self::safeViewText((string) ($meta['confidence_label'] ?? $record['confidence_label'] ?? ''), 40);
        if ($confidence === '') {
            $confidence = $references === [] ? 'baixa' : 'media';
        }
        if ($references === [] && mb_strtolower($confidence, 'UTF-8') === 'alta') {
            $confidence = 'baixa';
        }

        $sourceType = self::safeViewText((string) ($meta['source_type'] ?? $record['source_type'] ?? ''), 80);
        if ($sourceType === '') {
            $sourceType = $references === [] ? 'external_ai_no_sources' : 'external_ai_with_sources';
        }

        return [
            'status' => self::safeViewText((string) ($meta['status'] ?? $record['status'] ?? 'completed'), 80),
            'title' => __('Ajuda externa por IA — sugestão, revise antes de aplicar', 'glpiintegaglpi'),
            'diagnostic_hypothesis' => $diagnostic,
            'customer_questions' => $questions,
            'technical_steps' => $steps,
            'commands_or_checks' => $commands,
            'cautions' => $cautions,
            'references' => $references,
            'confidence_label' => $confidence,
            'source_type' => $sourceType,
            'source_warning' => $references === []
                ? __('Sem fontes externas verificáveis; use como sugestão técnica.', 'glpiintegaglpi')
                : __('Fonte informada; ainda exige revisão humana.', 'glpiintegaglpi'),
            'human_review_required' => true,
            'can_create_kb_candidate' => true,
            'raw_payload_available' => is_array($decoded),
            'no_auto_send' => true,
            'no_auto_publish' => true,
        ];
    }

    /**
     * @param mixed $payload
     * @return mixed
     */
    private static function decodeExternalPayload($payload)
    {
        if (is_array($payload)) {
            return $payload;
        }
        $text = trim((string) $payload);
        if ($text === '') {
            return '';
        }
        $text = preg_replace('/^```(?:json)?\s*|\s*```$/i', '', $text) ?? $text;
        $decoded = json_decode($text, true);
        if (json_last_error() === JSON_ERROR_NONE && is_array($decoded)) {
            return $decoded;
        }
        if (preg_match('/\{[\s\S]*\}/u', $text, $match) === 1) {
            $decoded = json_decode($match[0], true);
            if (json_last_error() === JSON_ERROR_NONE && is_array($decoded)) {
                return $decoded;
            }
        }

        return $text;
    }

    /**
     * Best-effort parser for provider answers that look like the expected JSON
     * schema but are wrapped in prose, markdown, or malformed/truncated by an
     * intermediary. It only extracts known view-model fields.
     *
     * @return array<string, mixed>
     */
    private static function extractExternalFieldsFromText(string $text): array
    {
        $out = [];
        foreach (['diagnostico_provavel', 'diagnostic_hypothesis', 'diagnosis', 'diagnostico'] as $key) {
            $value = self::extractJsonStringField($text, $key);
            if ($value !== '') {
                $out['diagnostico_provavel'] = $value;
                break;
            }
        }

        $fieldMap = [
            'perguntas_ao_cliente' => ['perguntas_ao_cliente', 'customer_questions', 'confirmationQuestions', 'questions'],
            'passos_tecnicos' => ['passos_tecnicos', 'technical_steps', 'steps', 'procedimento'],
            'commands_or_checks' => ['commands_or_checks', 'commands', 'comandos_verificacoes', 'verificacoes', 'checks'],
            'riscos_cuidados' => ['riscos_cuidados', 'cautions', 'risks', 'cuidados'],
            'fontes_links_sugeridas' => ['fontes_links_sugeridas', 'references', 'fontes', 'sources'],
        ];
        foreach ($fieldMap as $target => $keys) {
            foreach ($keys as $key) {
                $values = self::extractJsonStringArrayField($text, $key);
                if ($values !== []) {
                    $out[$target] = $values;
                    break;
                }
            }
        }

        return $out;
    }

    private static function extractJsonStringField(string $text, string $key): string
    {
        $pattern = '/"' . preg_quote($key, '/') . '"\s*:\s*"((?:\\\\.|[^"\\\\])*)"/u';
        if (preg_match($pattern, $text, $match) !== 1) {
            return '';
        }
        $decoded = json_decode('"' . $match[1] . '"', true);
        return is_string($decoded) ? self::safeViewText($decoded, 1200) : '';
    }

    /**
     * @return list<string>
     */
    private static function extractJsonStringArrayField(string $text, string $key): array
    {
        $pattern = '/"' . preg_quote($key, '/') . '"\s*:\s*\[([\s\S]*?)(?:\]\s*(?:,|\})|,\s*"[a-zA-Z0-9_]+\"\s*:)/u';
        if (preg_match($pattern, $text, $match) !== 1) {
            return [];
        }
        $body = $match[1];
        $items = [];
        if (preg_match_all('/"((?:\\\\.|[^"\\\\])*)"/u', $body, $matches) === false) {
            return [];
        }
        foreach ($matches[1] as $raw) {
            $decoded = json_decode('"' . $raw . '"', true);
            if (is_string($decoded)) {
                $value = self::safeViewText($decoded, 1000);
                if ($value !== '') {
                    $items[] = $value;
                }
            }
        }

        return array_values(array_slice(array_unique($items), 0, 8));
    }

    /**
     * @param array<string, mixed> $record
     * @param list<string> $keys
     */
    private static function firstViewText(array $record, array $keys): string
    {
        foreach ($keys as $key) {
            if (array_key_exists($key, $record)) {
                $text = self::viewValueToText($record[$key]);
                if ($text !== '') {
                    return self::safeViewText($text, 1200);
                }
            }
        }

        return '';
    }

    /**
     * @param array<string, mixed> $record
     * @param list<string> $keys
     * @return list<string>
     */
    private static function firstViewList(array $record, array $keys): array
    {
        foreach ($keys as $key) {
            if (array_key_exists($key, $record)) {
                $items = self::viewValueToList($record[$key]);
                if ($items !== []) {
                    return $items;
                }
            }
        }

        return [];
    }

    /**
     * @param mixed $value
     */
    private static function viewValueToText($value): string
    {
        if (is_scalar($value) || $value === null) {
            return trim((string) $value);
        }
        if (is_array($value)) {
            $parts = [];
            foreach ($value as $key => $item) {
                $text = self::viewValueToText($item);
                if ($text === '') {
                    continue;
                }
                $parts[] = is_string($key) ? ($key . ': ' . $text) : $text;
            }

            return implode('; ', $parts);
        }

        return '';
    }

    /**
     * @param mixed $value
     * @return list<string>
     */
    private static function viewValueToList($value): array
    {
        if (is_array($value)) {
            $items = [];
            foreach ($value as $item) {
                $text = self::viewValueToText($item);
                if ($text !== '') {
                    $items[] = self::safeViewText($text, 900);
                }
            }

            return array_values(array_unique($items));
        }

        $text = self::safeViewText(self::viewValueToText($value), 900);
        if ($text === '') {
            return [];
        }

        return [$text];
    }

    private static function safeViewText(string $value, int $max): string
    {
        $text = html_entity_decode(strip_tags($value), ENT_QUOTES | ENT_HTML5, 'UTF-8');
        $text = preg_replace('/\s+/u', ' ', $text) ?? '';

        return mb_substr(trim($text), 0, $max, 'UTF-8');
    }

    /**
     * @param array<string, mixed> $query
     * @param array<string, mixed>|null $flash
     * @return array<string, mixed>
     */
    public function getPageData(array $query, ?array $flash = null): array
    {
        $configured = $this->pluginConfigService->isConfigured();
        $internalQuery = $this->extractInternalKnowledgeQuery($query, $flash);
        $data = [
            'flash' => $flash,
            'catalog' => [],
            'recent_requests' => [],
            'recent_candidates' => [],
            'internal_context' => $this->loadInternalKnowledgeContext($internalQuery, $configured),
            'ai_provider_catalog' => $this->loadOperationalProviderCatalog(),
            'error' => '',
        ];

        if (!$configured) {
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
            switch ($action) {
                case 'preview':
                    return $this->preview($post);

                case 'confirm_research':
                    return $this->confirmResearch($post, $userId);

                case 'create_candidate':
                    return $this->createCandidateFromConfirmedRequest($post, $userId);

                case 'copy_markdown':
                    return $this->recordReviewAction($post, $userId, 'markdown_copied');

                case 'report_incident':
                    return $this->reportIncident($post, $userId);

                default:
                    return ['type' => 'danger', 'message' => __('Ação inválida.', 'glpiintegaglpi')];
            }
        } catch (Throwable $exception) {
            error_log('[integaglpi][external_research][post] ' . $this->sanitizeText($exception->getMessage(), 180));

            return ['type' => 'danger', 'message' => __('Falha ao processar pesquisa externa controlada.', 'glpiintegaglpi')];
        }
    }

    /**
     * SmartHelp inline adapter.
     *
     * The ticket tab already performed the explicit preview/consent flow before
     * calling this method. Rebuild the canonical PHP preview token server-side
     * and reuse the same controlled research path as the dedicated External
     * Research page, including provider readiness, PII guard, Secret Vault and
     * audit. No ticket, WhatsApp or KB mutation is performed.
     *
     * @return array<string, mixed>
     */
    public function confirmInlineResearch(string $technicalSummary, int $userId): array
    {
        if (!$this->pluginConfigService->isConfigured() || !$this->tablesReady()) {
            return ['type' => 'danger', 'message' => __('Pesquisa externa ainda não está disponível.', 'glpiintegaglpi')];
        }

        $post = [
            'action' => 'confirm_research',
            'technical_summary' => mb_substr($technicalSummary, 0, self::MAX_PROMPT_CHARS, 'UTF-8'),
            'trusted_sanitized_context' => '1',
        ];
        $context = $this->buildContext($post);
        $post['preview_token'] = $this->previewToken($context);

        return $this->confirmResearch($post, $userId);
    }

    /**
     * @param array<string, mixed> $post
     * @return array<string, mixed>
     */
    private function preview(array $post): array
    {
        $context = $this->buildContext($post);
        if ($context['sanitized']['text'] === '') {
            return ['type' => 'danger', 'message' => __('Informe um resumo técnico sem dados pessoais.', 'glpiintegaglpi')];
        }
        $providerSelection = is_array($context['provider_selection'] ?? null) ? $context['provider_selection'] : [];

        return [
            'type' => $context['sanitized']['blocked'] || empty($providerSelection['ready']) ? 'warning' : 'info',
            'message' => $context['sanitized']['blocked']
                ? __('Preview gerado, mas a pesquisa será bloqueada até remover PII/segredos do insumo.', 'glpiintegaglpi')
                : (empty($providerSelection['ready'])
                    ? __('Preview gerado, mas o provider/modelo selecionado ainda não está pronto para uso.', 'glpiintegaglpi')
                    : __('Preview anonimizado gerado. Confirme manualmente antes da pesquisa.', 'glpiintegaglpi')),
            'preview' => $context,
        ];
    }

    /**
     * @param array<string, mixed> $post
     * @return array<string, mixed>
     */
    private function confirmResearch(array $post, int $userId): array
    {
        $context = $this->buildContext($post);
        if ($context['sanitized']['text'] === '') {
            return ['type' => 'danger', 'message' => __('Informe um resumo técnico sem dados pessoais.', 'glpiintegaglpi')];
        }

        if (!$this->hasValidPreviewToken($post, $context)) {
            $this->audit('EXTERNAL_RESEARCH_PREVIEW_REQUIRED', null, $userId, [
                'source_count' => count($context['source_urls']),
                'anonymized_payload_hash' => $context['sanitized']['anonymized_payload_hash'],
                'provider' => (string) ($context['provider_selection']['provider'] ?? 'disabled'),
                'model_hash' => hash('sha256', (string) ($context['provider_selection']['model'] ?? '')),
            ]);

            return [
                'type' => 'danger',
                'message' => __('EXTERNAL_RESEARCH_PREVIEW_REQUIRED: gere e confirme o preview anonimizado antes da pesquisa.', 'glpiintegaglpi'),
                'preview' => $context,
            ];
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

        // Sources are optional/advanced; when empty the prompt uses default official allowlist.
        // Do NOT block here — proceed with research using default catalog as source guidance.

        $providerSelection = is_array($context['provider_selection'] ?? null) ? $context['provider_selection'] : [];
        if (!empty($providerSelection['cloud']) && empty($providerSelection['ready'])) {
            $this->audit('EXTERNAL_RESEARCH_BLOCKED_PROVIDER', null, $userId, [
                'provider' => (string) ($providerSelection['provider'] ?? 'disabled'),
                'model_hash' => hash('sha256', (string) ($providerSelection['model'] ?? '')),
                'blocked_reason' => (string) ($providerSelection['blocked_reason'] ?? 'provider_not_ready'),
                'anonymized_payload_hash' => $context['sanitized']['anonymized_payload_hash'],
            ]);

            return [
                'type' => 'danger',
                'message' => sprintf(
                    __('Pesquisa bloqueada: provider/modelo não está pronto (%s).', 'glpiintegaglpi'),
                    (string) ($providerSelection['blocked_reason'] ?? 'provider_not_ready')
                ),
                'preview' => $context,
            ];
        }

        $requestId = $this->newId('extresearch');
        $cloudResult = null;
        if (!empty($providerSelection['cloud'])) {
            $cloudResult = $this->executeCloudResearch($context, $userId);
            if (($cloudResult['status'] ?? '') !== 'success') {
                return [
                    'type' => 'warning',
                    'message' => sprintf(
                        __('Pesquisa cloud não concluída: %s. Nenhum dado bruto foi enviado ou salvo.', 'glpiintegaglpi'),
                        (string) ($cloudResult['error_type'] ?? 'provider_unavailable')
                    ),
                    'preview' => $context,
                    'research_result' => [
                        'status' => 'error',
                        'provider' => (string) ($providerSelection['provider'] ?? 'disabled'),
                        'model' => (string) ($providerSelection['model'] ?? ''),
                        'source' => 'external_research_cloud',
                        'error_type' => (string) ($cloudResult['error_type'] ?? 'provider_unavailable'),
                        'no_auto_send' => true,
                        'no_auto_publish' => true,
                    ],
                ];
            }
            $context['cloud_result'] = $cloudResult;
        }
        $candidate = $this->buildCandidate($context, $requestId);

        // No useful technical guidance (no accepted source, no cloud answer, zero
        // confidence). Do NOT treat this as success and do NOT persist a request —
        // an honest "nothing useful" beats a bureaucratic success that later lets the
        // technician generate an empty candidate.
        if (!$this->isResearchActionable($context, $candidate)) {
            $this->audit('EXTERNAL_RESEARCH_NO_ACTIONABLE_RESULT', null, $userId, [
                'provider' => (string) ($providerSelection['provider'] ?? 'disabled'),
                'model_hash' => hash('sha256', (string) ($providerSelection['model'] ?? '')),
                'anonymized_payload_hash' => $context['sanitized']['anonymized_payload_hash'],
            ]);

            return [
                'type' => 'warning',
                'message' => __('A pesquisa não retornou orientação técnica utilizável.', 'glpiintegaglpi'),
                'preview' => $context,
                'research_result' => [
                    'status' => 'no_actionable_result',
                    'confidence_score' => 0,
                    'provider' => (string) ($providerSelection['provider'] ?? 'disabled'),
                    'model' => (string) ($providerSelection['model'] ?? ''),
                    'source' => !empty($providerSelection['cloud']) ? 'external_research_cloud' : 'external_research_manual_catalog',
                    'no_actionable_result' => true,
                    'no_auto_send' => true,
                    'no_auto_publish' => true,
                ],
            ];
        }

        $pdo = $this->getPdo();
        $pdo->beginTransaction();
        try {
            $this->insertRequest($requestId, $userId, $context, 'completed', $candidate['confidence_score']);
            $this->insertResults($requestId, $context, $candidate);
            $pdo->commit();
        } catch (Throwable $exception) {
            $pdo->rollBack();
            throw $exception;
        }

        $this->audit('EXTERNAL_RESEARCH_REQUESTED', $requestId, $userId, [
            'source_catalog_ids' => $candidate['source_catalog_ids'],
            'provider' => (string) ($providerSelection['provider'] ?? 'disabled'),
            'model_hash' => hash('sha256', (string) ($providerSelection['model'] ?? '')),
            'estimated_cost' => 0,
            'anonymized_payload_hash' => $context['sanitized']['anonymized_payload_hash'],
        ]);
        $this->audit('EXTERNAL_RESEARCH_EXECUTED', $requestId, $userId, [
            'confidence_score' => $candidate['confidence_score'],
            'source_catalog_ids' => $candidate['source_catalog_ids'],
            'provider' => (string) ($providerSelection['provider'] ?? 'disabled'),
            'model_hash' => hash('sha256', (string) ($providerSelection['model'] ?? '')),
            'response_hash' => (string) ($cloudResult['response_hash'] ?? ''),
            'cloud_used' => !empty($providerSelection['cloud']),
            'no_auto_send' => true,
            'no_auto_publish' => true,
        ]);

        return [
            'type' => 'success',
            'message' => __('Pesquisa externa controlada registrada com fontes citadas. Agora você pode gerar um candidato revisável.', 'glpiintegaglpi'),
            'preview' => $context,
            'research_result' => [
                'status' => 'completed',
                'confidence_score' => $candidate['confidence_score'],
                'source_catalog_ids' => $candidate['source_catalog_ids'],
                'provider' => (string) ($providerSelection['provider'] ?? 'disabled'),
                'model' => (string) ($providerSelection['model'] ?? ''),
                'source' => !empty($providerSelection['cloud']) ? 'external_research_cloud' : 'external_research_manual_catalog',
                'summary' => (string) ($cloudResult['response_text'] ?? ''),
                'no_auto_send' => true,
                'no_auto_publish' => true,
            ],
            'request_id' => $requestId,
        ];
    }

    /**
     * @param array<string, mixed> $post
     * @return array<string, mixed>
     */
    private function createCandidateFromConfirmedRequest(array $post, int $userId): array
    {
        $context = $this->buildContext($post);
        if ($context['sanitized']['text'] === '') {
            return ['type' => 'danger', 'message' => __('Informe um resumo técnico sem dados pessoais.', 'glpiintegaglpi')];
        }

        if (!$this->hasValidPreviewToken($post, $context)) {
            $this->audit('EXTERNAL_RESEARCH_PREVIEW_REQUIRED', null, $userId, [
                'source_count' => count($context['source_urls']),
                'anonymized_payload_hash' => $context['sanitized']['anonymized_payload_hash'],
            ]);

            return [
                'type' => 'danger',
                'message' => __('EXTERNAL_RESEARCH_PREVIEW_REQUIRED: gere e confirme o preview anonimizado antes de criar candidato.', 'glpiintegaglpi'),
                'preview' => $context,
            ];
        }

        $requestId = $this->sanitizeIdentifier((string) ($post['request_id'] ?? ''));
        if ($requestId === '' || !$this->requestExists($requestId)) {
            $this->audit('EXTERNAL_RESEARCH_REQUEST_REQUIRED', null, $userId, [
                'anonymized_payload_hash' => $context['sanitized']['anonymized_payload_hash'],
            ]);

            return [
                'type' => 'danger',
                'message' => __('Confirme a pesquisa antes de gerar candidato revisável.', 'glpiintegaglpi'),
                'preview' => $context,
            ];
        }

        if ($context['sanitized']['blocked']) {
            $this->audit('EXTERNAL_RESEARCH_BLOCKED_PII', $requestId, $userId, [
                'detected_kinds' => $context['sanitized']['detected_kinds'],
                'anonymized_payload_hash' => $context['sanitized']['anonymized_payload_hash'],
            ]);

            return [
                'type' => 'danger',
                'message' => __('Candidato bloqueado: PII/segredo detectado. Revise o resumo antes de continuar.', 'glpiintegaglpi'),
                'preview' => $context,
            ];
        }

        if ($context['source_errors'] !== []) {
            return [
                'type' => 'danger',
                'message' => __('Candidato bloqueado: uma ou mais fontes estão fora da allowlist.', 'glpiintegaglpi'),
                'preview' => $context,
            ];
        }

        // Sources are optional/advanced; when empty the candidate is built with low confidence using
        // the default official allowlist as guidance.

        $candidate = $this->buildCandidate($context, $requestId);

        // Defense in depth: never let the technician generate a reviewable candidate
        // when the research produced no usable diagnosis/procedure (no source, no
        // cloud answer, zero confidence). An empty candidate is worse than none.
        if (!$this->isResearchActionable($context, $candidate)) {
            $this->audit('EXTERNAL_RESEARCH_CANDIDATE_BLOCKED_NO_ACTIONABLE', $requestId, $userId, [
                'anonymized_payload_hash' => $context['sanitized']['anonymized_payload_hash'],
            ]);

            return [
                'type' => 'warning',
                'message' => __('Candidato não gerado: a pesquisa não retornou orientação técnica utilizável.', 'glpiintegaglpi'),
                'preview' => $context,
            ];
        }

        $pdo = $this->getPdo();
        $pdo->beginTransaction();
        try {
            $this->insertCandidate($requestId, $userId, $context, $candidate);
            $this->updateRequestStatus($requestId, 'candidate_created', $candidate['confidence_score']);
            $pdo->commit();
        } catch (Throwable $exception) {
            $pdo->rollBack();
            throw $exception;
        }

        $this->audit('EXTERNAL_RESEARCH_CANDIDATE_CREATED', $requestId, $userId, [
            'candidate_id' => $candidate['candidate_id'],
            'confidence_score' => $candidate['confidence_score'],
            'status' => $candidate['status'],
            'source_catalog_ids' => $candidate['source_catalog_ids'],
            'anonymized_payload_hash' => $context['sanitized']['anonymized_payload_hash'],
        ]);

        return [
            'type' => 'success',
            'message' => __('Candidato de KB externo criado para revisão humana. Publicação continua manual.', 'glpiintegaglpi'),
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
        $blockOnDetected = empty($post['trusted_sanitized_context']);
        $sanitized = $this->sanitizePrompt((string) ($post['technical_summary'] ?? ''), $blockOnDetected);
        $providerSelection = $this->providerSelectionFromPost($post);
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

        $context = [
            'sanitized' => $sanitized,
            'catalog' => $catalog,
            'source_urls' => $urls,
            'validated_sources' => $validated,
            'source_errors' => $errors,
            'source_conflicts' => $this->detectConflicts($validated),
            'provider_selection' => $providerSelection,
        ];

        return [
            ...$context,
            'preview_token' => $this->previewToken($context),
        ];
    }

    /**
     * @param array<string, mixed> $post
     * @param array<string, mixed> $context
     */
    private function hasValidPreviewToken(array $post, array $context): bool
    {
        $provided = trim((string) ($post['preview_token'] ?? ''));
        if ($provided === '') {
            return false;
        }

        return hash_equals($this->previewToken($context), $provided);
    }

    /**
     * @param array<string, mixed> $context
     */
    private function previewToken(array $context): string
    {
        $sourceUrls = array_map('strval', is_array($context['source_urls'] ?? null) ? $context['source_urls'] : []);
        sort($sourceUrls);

        return hash('sha256', implode('|', [
            'external_research_preview_v1',
            (string) ($context['sanitized']['input_hash'] ?? ''),
            (string) ($context['sanitized']['anonymized_payload_hash'] ?? ''),
            (string) ($context['provider_selection']['provider'] ?? 'disabled'),
            (string) ($context['provider_selection']['model'] ?? ''),
            implode("\n", $sourceUrls),
        ]));
    }

    /**
     * Whether a confirmed research carries usable technical guidance.
     *
     * Useful when there is at least one validated/accepted source, OR a real cloud
     * answer (non-empty response text), OR a non-zero aggregated confidence. When
     * none of these hold (sources = 0, confidence = 0, no cloud answer) the result is
     * a bureaucratic non-answer and must NOT be treated as success nor become a
     * reviewable candidate.
     *
     * @param array<string, mixed> $context
     * @param array<string, mixed> $candidate
     */
    private function isResearchActionable(array $context, array $candidate): bool
    {
        $validatedSources = is_array($context['validated_sources'] ?? null) ? $context['validated_sources'] : [];
        $cloudResult = is_array($context['cloud_result'] ?? null) ? $context['cloud_result'] : null;
        $cloudText = $cloudResult !== null ? trim((string) ($cloudResult['response_text'] ?? '')) : '';
        $confidence = (int) ($candidate['confidence_score'] ?? 0);

        return $validatedSources !== [] || $cloudText !== '' || $confidence > 0;
    }

    /**
     * @param array<string, mixed> $context
     * @return array<string, mixed>
     */
    private function buildCandidate(array $context, string $requestId): array
    {
        $sources = $context['validated_sources'];
        $cloudResult = is_array($context['cloud_result'] ?? null) ? $context['cloud_result'] : null;
        $cloudSummary = $cloudResult !== null ? $this->sanitizeText((string) ($cloudResult['response_text'] ?? ''), 1600) : '';
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
            '## Apoio IA selecionado',
            $cloudSummary !== '' ? $cloudSummary : 'Sem consulta cloud; pesquisa baseada em preview sanitizado e fontes cadastradas.',
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
            'cloud_research_summary' => $cloudSummary,
            'human_review_required' => true,
            'auto_publish' => false,
        ];
    }

    /**
     * @param array<string, mixed> $context
     * @return array{status: string, error_type: string, elapsed_ms: int, response_hash: string, response_text: string}
     */
    private function executeCloudResearch(array $context, int $userId): array
    {
        $providerSelection = is_array($context['provider_selection'] ?? null) ? $context['provider_selection'] : [];
        $provider = (string) ($providerSelection['provider'] ?? '');
        $model = (string) ($providerSelection['model'] ?? '');
        if ($provider === '' || $provider === 'disabled' || empty($providerSelection['cloud'])) {
            return ['status' => 'success', 'error_type' => 'none', 'elapsed_ms' => 0, 'response_hash' => '', 'response_text' => ''];
        }

        $prompt = $this->buildCloudResearchPrompt($context);
        if ($prompt === '' || $this->containsSensitiveData($prompt)) {
            $this->audit('EXTERNAL_RESEARCH_BLOCKED_PII', null, $userId, [
                'provider' => $provider,
                'model_hash' => hash('sha256', $model),
                'reason' => 'pii_blocked',
                'anonymized_payload_hash' => (string) ($context['sanitized']['anonymized_payload_hash'] ?? ''),
            ]);

            return ['status' => 'blocked', 'error_type' => 'pii_blocked', 'elapsed_ms' => 0, 'response_hash' => '', 'response_text' => ''];
        }

        try {
            $result = (new AiSecretVaultService($this->pluginConfigService))->completeProvider($provider, $model, $prompt, 30000, 900);
            $responseText = $this->sanitizeText((string) ($result['response_text'] ?? ''), 2200);
            if ($responseText === '' || $this->containsSensitiveData($responseText)) {
                return [
                    'status' => 'invalid_response',
                    'error_type' => $responseText === '' ? 'invalid_response' : 'pii_blocked',
                    'elapsed_ms' => (int) ($result['elapsed_ms'] ?? 0),
                    'response_hash' => (string) ($result['response_hash'] ?? ''),
                    'response_text' => '',
                ];
            }

            return [
                'status' => 'success',
                'error_type' => 'none',
                'elapsed_ms' => (int) ($result['elapsed_ms'] ?? 0),
                'response_hash' => (string) ($result['response_hash'] ?? ''),
                'response_text' => $responseText,
            ];
        } catch (RuntimeException $exception) {
            return [
                'status' => 'failed',
                'error_type' => $this->normalizeErrorType($exception->getMessage()),
                'elapsed_ms' => 0,
                'response_hash' => '',
                'response_text' => '',
            ];
        }
    }

    /**
     * @param array<string, mixed> $context
     */
    private function buildCloudResearchPrompt(array $context): string
    {
        $sourceTitles = [];
        foreach (array_slice((array) ($context['validated_sources'] ?? []), 0, self::MAX_SOURCES) as $source) {
            if (!is_array($source)) {
                continue;
            }
            $catalog = is_array($source['catalog'] ?? null) ? $source['catalog'] : [];
            $sourceTitles[] = $this->sanitizeText((string) ($catalog['name'] ?? $source['url'] ?? ''), 180);
        }

        $hasCustomSources = $sourceTitles !== [];
        $defaultSourcesLine = 'Sem fontes personalizadas — use preferencialmente: Microsoft Learn, GLPI Docs (docs.glpi-project.org), Meta/WhatsApp Cloud API Docs, Docker Docs, PostgreSQL Docs, Redis Docs, Node.js Docs, Ubuntu Docs.';
        $sourcesLine = $hasCustomSources
            ? ('Fontes citadas: ' . implode('; ', array_filter($sourceTitles)))
            : $defaultSourcesLine;

        $schema = '{"diagnostico_provavel":"","perguntas_ao_cliente":[""],"passos_tecnicos":[""],"riscos_cuidados":[""],"fontes_links_sugeridas":[""],"texto_resposta_cliente":"","candidato_kb":{"titulo":"","problema":"","resolucao":[""],"adequado_para_kb":false},"confidence":0,"limites_incertezas":""}';

        return $this->sanitizeText(implode("\n", [
            'Voce e apoio tecnico para pesquisa externa controlada. Use apenas o resumo sanitizado e as fontes citadas; nao invente dados do cliente, nao execute comandos e nao exponha PII.',
            'Retorne SOMENTE JSON valido no schema abaixo. Nao inclua texto fora do JSON.',
            'Schema obrigatorio: ' . $schema,
            'Campos obrigatorios: diagnostico_provavel (string), perguntas_ao_cliente (array de strings), passos_tecnicos (array), riscos_cuidados (array), fontes_links_sugeridas (array de URLs/referencias), texto_resposta_cliente (string sem PII), candidato_kb (objeto: titulo, problema, resolucao array, adequado_para_kb bool), confidence (inteiro 0-100), limites_incertezas (string).',
            'confidence: 0 se insuficiente, 100 se altamente confiante. candidato_kb.adequado_para_kb: true somente se resolucao clara, reproducivel e sem PII.',
            'Resumo sanitizado:',
            (string) ($context['sanitized']['text'] ?? ''),
            $sourcesLine,
        ]), self::MAX_PROMPT_CHARS);
    }

    /**
     * @return array{text: string, input_hash: string, anonymized_payload_hash: string, detected_kinds: list<string>, blocked: bool, blocked_reason: string|null}
     */
    private function sanitizePrompt(string $input, bool $blockOnDetected = true): array
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
            'company' => ['/\b(?:empresa|cliente|companhia|organizacao|organização|razao social|razão social)\s*(?::|=|-)?\s*[A-ZÀ-Ý0-9][A-ZÀ-Ýa-zà-ÿ0-9 .&_-]{2,80}/iu', 'empresa: [empresa]'],
            'name' => ['/\b(nome|cliente|contato|solicitante|tecnico|técnico|usuario|usuário|responsavel|responsável|atendente|chamador|requerente|requisitante|sr|sra)\s*(?::|=)?\s*[A-ZÀ-Ý][a-zà-ÿ]+(?:\s+[A-ZÀ-Ý][a-zà-ÿ]+){0,3}/iu', '$1: [nome]'],
            'proper_name' => ['/\b[A-ZÀ-Ý][a-zà-ÿ]{2,}(?:\s+[A-ZÀ-Ý][a-zà-ÿ]{2,}){1,4}\b/u', '[nome]'],
            'uppercase_name' => ['/\b[A-ZÀ-Ý]{2,}(?:\s+[A-ZÀ-Ý]{2,}){1,5}\b/u', '[nome]'],
            'patrimonio_id' => ['/\b(?:patrimônio|patrimonio|etiqueta|ativo|inv\.)\s*#?n?[o°]?\.?\s*\d{3,}/iu', '[id]'],
            'ticket_id' => ['/\b(?:chamado|ticket|incidente)\s*#?\s*\d{3,}/iu', '[id]'],
            'phone' => ['/\b(?:\+?55\s?)?(?:\(?\d{2}\)?\s?)?(?:9\s?)?\d{4}[-.\s]?\d{4}\b/', '[telefone]'],
            'cpf_cnpj' => ['/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b|\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/', '[documento]'],
            'ip' => ['/\b(?:10|172\.(?:1[6-9]|2\d|3[0-1])|192\.168)\.\d{1,3}\.\d{1,3}\b/', '[ip_privado]'],
            'domain' => ['/\b(?:[a-z0-9-]+\.)+(?:local|lan|corp|internal|intra|eticainformatica\.com\.br)\b/i', '[dominio_interno]'],
            'address' => ['/\b(?:rua|avenida|av\.|rodovia|travessa)\s+[A-ZÀ-Ýa-zà-ÿ0-9 .-]{5,}/iu', '[endereco]'],
            'server_name' => ['/\b(?:srv|server|host|vm|db)-[a-z0-9-]{3,}\b/i', '[servidor_interno]'],
            'media' => ['/\b(?:anexo|arquivo|midia|mídia|imagem|audio|áudio|video|vídeo)\s*[:=]?\s*\S+/iu', '[midia]'],
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

        $blocked = $blockOnDetected ? $detected !== [] : $this->containsSensitiveData($text);

        return [
            'text' => $text,
            'input_hash' => hash('sha256', $original),
            'anonymized_payload_hash' => hash('sha256', $text),
            'detected_kinds' => $detected,
            'blocked' => $blocked,
            'blocked_reason' => $blocked ? 'EXTERNAL_RESEARCH_PAYLOAD_BLOCKED_PII_OR_SECRET' : null,
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
            if ($this->startsWith($pattern, '*.')) {
                $suffix = substr($pattern, 2);
                if ($host === $suffix || $this->endsWith($host, '.' . $suffix)) {
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
        $providerSelection = is_array($context['provider_selection'] ?? null) ? $context['provider_selection'] : [];
        $provider = (string) ($providerSelection['provider'] ?? 'disabled');
        $cloudUsed = !empty($providerSelection['cloud']) && $provider !== 'disabled';
        $stmt = $this->getPdo()->prepare(
            'INSERT INTO public.' . self::REQUEST_TABLE . ' (
                request_id, requested_by_glpi_user_id, sanitized_prompt_hash, anonymized_payload_hash,
                provider, cloud_used, estimated_cost, status, blocked_reason, confidence_score, created_at, updated_at
            ) VALUES (
                :request_id, :user_id, :prompt_hash, :payload_hash,
                :provider, :cloud_used, 0, :status, :blocked_reason, :confidence_score, NOW(), NOW()
            )'
        );
        $stmt->bindValue(':request_id', $requestId);
        $stmt->bindValue(':user_id', $userId, PDO::PARAM_INT);
        $stmt->bindValue(':prompt_hash', (string) $context['sanitized']['input_hash']);
        $stmt->bindValue(':payload_hash', (string) $context['sanitized']['anonymized_payload_hash']);
        $stmt->bindValue(':provider', $provider);
        $stmt->bindValue(':cloud_used', $cloudUsed, PDO::PARAM_BOOL);
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

    /**
     * @param array<string, mixed> $query
     * @param array<string, mixed>|null $flash
     */
    private function extractInternalKnowledgeQuery(array $query, ?array $flash): string
    {
        $preview = is_array($flash['preview'] ?? null) ? $flash['preview'] : null;
        $sanitized = is_array($preview['sanitized'] ?? null) ? $preview['sanitized'] : null;
        if (is_array($sanitized) && trim((string) ($sanitized['text'] ?? '')) !== '') {
            return $this->sanitizeText((string) $sanitized['text'], 240);
        }

        return $this->sanitizeText((string) ($query['q'] ?? ''), 240);
    }

    /**
     * @return array{query: string, items: list<array<string, mixed>>, message: string}
     */
    private function loadInternalKnowledgeContext(string $query, bool $includeExternalTables): array
    {
        $query = $this->sanitizeText($query, 240);
        if ($query === '') {
            return [
                'query' => '',
                'items' => [],
                'message' => __('Gere o preview anonimizado para buscar conhecimento interno relacionado.', 'glpiintegaglpi'),
            ];
        }

        $items = [];
        try {
            $nativeKnowledgeBase = new NativeKnowledgeBaseService();
            foreach ($nativeKnowledgeBase->buildRelatedArticlesContext(['summary' => $query], 3) as $article) {
                if (!is_array($article)) {
                    continue;
                }
                $items[] = [
                    'title' => $this->sanitizeText((string) ($article['title'] ?? ''), 180),
                    'type' => $this->sanitizeText((string) ($article['category'] ?? 'Artigo KB'), 80),
                    'origin' => 'KB nativa',
                    'confidence' => 80,
                    'internal_url' => $this->sanitizeInternalUrl((string) ($article['internal_url'] ?? '')),
                ];
            }
        } catch (Throwable $exception) {
            error_log('[integaglpi][external_research][internal_kb] ' . $this->sanitizeText($exception->getMessage(), 180));
        }

        if ($includeExternalTables) {
            try {
                $items = array_merge(
                    $items,
                    $this->loadRelatedKbCandidates($query),
                    $this->loadRelatedHistoricalInsights($query)
                );
            } catch (Throwable $exception) {
                error_log('[integaglpi][external_research][internal_context] ' . $this->sanitizeText($exception->getMessage(), 180));
            }
        }

        $items = array_slice($items, 0, self::INTERNAL_KNOWLEDGE_LIMIT);

        return [
            'query' => $query,
            'items' => $items,
            'message' => $items === []
                ? __('Nenhum conhecimento interno relacionado encontrado para o preview.', 'glpiintegaglpi')
                : '',
        ];
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function loadRelatedKbCandidates(string $query): array
    {
        if (!$this->tableExists(self::KB_CANDIDATES_TABLE)) {
            return [];
        }

        $stmt = $this->getPdo()->prepare(
            'SELECT title, article_type, status, confidence_score, category_suggestion, created_at
               FROM public.' . self::KB_CANDIDATES_TABLE . "
              WHERE status IN ('approved', 'in_review', 'suggested')
                AND (
                    title ILIKE :term
                    OR COALESCE(problem_pattern, '') ILIKE :term
                    OR COALESCE(category_suggestion, '') ILIKE :term
                    OR COALESCE(content_markdown, '') ILIKE :term
                )
              ORDER BY confidence_score DESC, created_at DESC
              LIMIT 3"
        );
        $stmt->bindValue(':term', '%' . $query . '%');
        $stmt->execute();

        return array_map(fn (array $row): array => [
            'title' => $this->sanitizeText((string) ($row['title'] ?? ''), 180),
            'type' => $this->sanitizeText((string) ($row['article_type'] ?? 'candidato'), 80),
            'origin' => 'candidato KB',
            'confidence' => (int) ($row['confidence_score'] ?? 0),
            'internal_url' => '',
            'status' => $this->sanitizeText((string) ($row['status'] ?? ''), 40),
        ], $stmt->fetchAll(PDO::FETCH_ASSOC) ?: []);
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function loadRelatedHistoricalInsights(string $query): array
    {
        if (!$this->tableExists(self::HIST_INSIGHTS_TABLE)) {
            return [];
        }

        $stmt = $this->getPdo()->prepare(
            'SELECT title, insight_type, priority, confidence_score, created_at
               FROM public.' . self::HIST_INSIGHTS_TABLE . '
              WHERE title ILIKE :term
                 OR summary_sanitized ILIKE :term
                 OR recommendation_sanitized ILIKE :term
              ORDER BY confidence_score DESC, created_at DESC
              LIMIT 3'
        );
        $stmt->bindValue(':term', '%' . $query . '%');
        $stmt->execute();

        return array_map(fn (array $row): array => [
            'title' => $this->sanitizeText((string) ($row['title'] ?? ''), 180),
            'type' => $this->sanitizeText((string) ($row['insight_type'] ?? 'insight'), 80),
            'origin' => 'insight histórico',
            'confidence' => (int) ($row['confidence_score'] ?? 0),
            'internal_url' => '',
            'priority' => $this->sanitizeText((string) ($row['priority'] ?? ''), 40),
        ], $stmt->fetchAll(PDO::FETCH_ASSOC) ?: []);
    }

    private function requestExists(string $requestId): bool
    {
        $stmt = $this->getPdo()->prepare(
            "SELECT 1 FROM public." . self::REQUEST_TABLE . "
              WHERE request_id = :request_id
                AND status IN ('completed', 'candidate_created')
              LIMIT 1"
        );
        $stmt->bindValue(':request_id', $requestId);
        $stmt->execute();

        return (bool) $stmt->fetchColumn();
    }

    private function updateRequestStatus(string $requestId, string $status, int $confidenceScore): void
    {
        $stmt = $this->getPdo()->prepare(
            'UPDATE public.' . self::REQUEST_TABLE . '
                SET status = :status,
                    confidence_score = :confidence_score,
                    updated_at = NOW()
              WHERE request_id = :request_id'
        );
        $stmt->bindValue(':status', $status);
        $stmt->bindValue(':confidence_score', $confidenceScore, PDO::PARAM_INT);
        $stmt->bindValue(':request_id', $requestId);
        $stmt->execute();
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
     * @return array<string, mixed>
     */
    private function loadOperationalProviderCatalog(): array
    {
        try {
            return (new AiConfigViewService($this->pluginConfigService))->getOperationalProviderCatalog();
        } catch (Throwable $exception) {
            error_log('[integaglpi][external_research][provider_catalog] ' . $this->sanitizeText($exception->getMessage(), 180));

            return [
                'local_ollama_available' => ['provider' => 'ollama', 'name' => 'Ollama local', 'models' => [], 'default_model' => '', 'ready' => false, 'blocked_reason' => 'provider_catalog_unavailable'],
                'cloud_ready_providers' => [],
                'cloud_blocked_providers' => [],
                'external_research_default' => ['provider' => 'disabled', 'model' => '', 'source' => 'fallback'],
                'p4_default' => ['provider' => 'ollama', 'model' => '', 'source' => 'fallback'],
                'cloud_gates_ok' => false,
            ];
        }
    }

    /**
     * @param array<string, mixed> $post
     * @return array<string, mixed>
     */
    private function providerSelectionFromPost(array $post): array
    {
        $catalog = $this->loadOperationalProviderCatalog();
        $default = is_array($catalog['external_research_default'] ?? null)
            ? $catalog['external_research_default']
            : ['provider' => 'disabled', 'model' => ''];
        $provider = strtolower(trim((string) ($post['ai_provider'] ?? $default['provider'] ?? 'disabled')));
        $model = $this->sanitizeModel((string) ($post['ai_model'] ?? $default['model'] ?? ''));
        if ($provider === '' || $provider === 'disabled') {
            return [
                'provider' => 'disabled',
                'model' => '',
                'label' => 'manual / sem provider IA',
                'ready' => true,
                'cloud' => false,
                'blocked_reason' => '',
            ];
        }

        if ($provider === 'local') {
            $provider = 'ollama';
        }
        if ($provider === 'ollama') {
            $local = is_array($catalog['local_ollama_available'] ?? null) ? $catalog['local_ollama_available'] : [];
            $models = is_array($local['models'] ?? null) ? array_values(array_map('strval', $local['models'])) : [];
            if ($model === '') {
                $model = $this->sanitizeModel((string) ($local['default_model'] ?? ''));
            }
            $allowed = $model !== '' && ($models === [] || in_array($model, $models, true));

            return [
                'provider' => 'ollama',
                'model' => $model,
                'label' => 'Ollama local',
                'ready' => $allowed && !empty($local['ready']),
                'cloud' => false,
                'blocked_reason' => $allowed && !empty($local['ready']) ? '' : 'local_model_not_available',
            ];
        }

        $readyCloud = is_array($catalog['cloud_ready_providers'] ?? null) ? $catalog['cloud_ready_providers'] : [];
        $blockedCloud = is_array($catalog['cloud_blocked_providers'] ?? null) ? $catalog['cloud_blocked_providers'] : [];
        foreach ([$readyCloud, $blockedCloud] as $group) {
            foreach ($group as $row) {
                if (!is_array($row) || (string) ($row['id'] ?? '') !== $provider) {
                    continue;
                }
                $models = is_array($row['models'] ?? null) ? array_values(array_map('strval', $row['models'])) : [];
                if ($model === '' && $models !== []) {
                    $model = (string) $models[0];
                }
                $modelAllowed = $model !== '' && in_array($model, $models, true);
                $ready = !empty($row['ready_for_controlled_use']) && $modelAllowed;

                return [
                    'provider' => $provider,
                    'model' => $model,
                    'label' => (string) ($row['name'] ?? $provider),
                    'ready' => $ready,
                    'cloud' => true,
                    'blocked_reason' => $ready ? '' : ($modelAllowed ? (string) ($row['blocked_reason'] ?? 'provider_not_ready') : 'model_not_allowed'),
                    'last_test_status' => (string) ($row['last_test_status'] ?? 'not_tested'),
                ];
            }
        }

        return [
            'provider' => 'disabled',
            'model' => '',
            'label' => 'manual / provider inválido',
            'ready' => false,
            'cloud' => false,
            'blocked_reason' => 'provider_not_allowed',
        ];
    }

    private function sanitizeModel(string $model): string
    {
        $model = trim($model);
        if ($model === '' || strlen($model) > 120) {
            return '';
        }

        return preg_match('/^[A-Za-z0-9_.:\/-]+$/', $model) === 1 ? $model : '';
    }

    private function containsSensitiveData(string $text): bool
    {
        return preg_match('/[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}/i', $text) === 1
            || preg_match('/\b(?:\+?\d[\d .()\-]{7,}\d)\b/', $text) === 1
            || preg_match('/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b|\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/', $text) === 1
            || preg_match('/\bBearer\s+[A-Za-z0-9._~+\/=-]{12,}\b/i', $text) === 1
            || preg_match('/(password|senha|token|bearer|api[_-]?key|app_secret|secret)\s*[:=]\s*\S+/i', $text) === 1;
    }

    private function normalizeErrorType(string $value): string
    {
        $value = strtolower(trim($value));
        $value = preg_replace('/[^a-z0-9_:-]+/', '_', $value) ?? '';
        $value = trim($value, '_');

        return substr($value !== '' ? $value : 'provider_unavailable', 0, 80);
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
            $stmt->bindValue(
                ':status',
                $this->contains($eventType, 'BLOCKED')
                || $this->contains($eventType, 'PREVIEW_REQUIRED')
                || $this->contains($eventType, 'REQUEST_REQUIRED') ? 'blocked' : 'success'
            );
            $stmt->bindValue(':severity', $this->contains($eventType, 'INCIDENT') ? 'warning' : 'info');
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

    private function sanitizeInternalUrl(string $value): string
    {
        $value = trim(html_entity_decode($value, ENT_QUOTES | ENT_HTML5, 'UTF-8'));
        if ($value === '' || preg_match('/[\x00-\x1F\x7F]/', $value)) {
            return '';
        }
        if (preg_match('#^(?:javascript|data|vbscript):#i', $value) || preg_match('#^https?://#i', $value)) {
            return '';
        }
        if (!$this->startsWith($value, '/')) {
            return '';
        }

        $path = parse_url($value, PHP_URL_PATH);
        if (!is_string($path)) {
            return '';
        }

        foreach (['/front/knowbaseitem.form.php', '/plugins/integaglpi/'] as $prefix) {
            if ($path === $prefix || $this->startsWith($path, $prefix)) {
                return $this->sanitizeText($value, 260);
            }
        }

        return '';
    }

    private function startsWith(string $value, string $prefix): bool
    {
        return $prefix === '' || substr($value, 0, strlen($prefix)) === $prefix;
    }

    private function endsWith(string $value, string $suffix): bool
    {
        if ($suffix === '') {
            return true;
        }

        return substr($value, -strlen($suffix)) === $suffix;
    }

    private function contains(string $value, string $needle): bool
    {
        return $needle === '' || strpos($value, $needle) !== false;
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
