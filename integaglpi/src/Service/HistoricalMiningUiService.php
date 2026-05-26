<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi\Service;

use GlpiPlugin\Integaglpi\External\ExternalDatabase;
use PDO;
use RuntimeException;
use Throwable;

final class HistoricalMiningUiService
{
    private const MAX_UPLOAD_BYTES = 5242880;
    private const MAX_EXPORT_TICKETS = 1000;
    private const JSONL_RETENTION_SECONDS = 86400;
    private const LOCK_TTL_SECONDS = 900;
    private const P4_AI_REVIEW_FEATURE_FLAG = 'AI_KB_CANDIDATE_REVIEW_ENABLED';
    private const P4_AI_REVIEW_PROVIDER = 'AI_KB_CANDIDATE_REVIEW_PROVIDER';
    private const P4_AI_REVIEW_BASE_URL = 'AI_KB_CANDIDATE_REVIEW_BASE_URL';
    private const P4_AI_REVIEW_MODEL = 'AI_KB_CANDIDATE_REVIEW_MODEL';
    private const P4_AI_REVIEW_TIMEOUT_SECONDS = 'AI_KB_CANDIDATE_REVIEW_TIMEOUT_SECONDS';
    private const P4_CONFIDENCE_THRESHOLD = 70;
    private const P4_MAX_CANDIDATES = 10;
    private const P4_ELIGIBLE_CANDIDATE_STATUSES = ['suggested', 'in_review', 'low_confidence', 'possible_duplicate', 'approved'];
    private PluginConfigService $pluginConfigService;
    private IntegrationServiceClient $client;

    public function __construct(PluginConfigService $pluginConfigService, ?IntegrationServiceClient $client = null)
    {
        $this->pluginConfigService = $pluginConfigService;
        $this->client = $client ?? new IntegrationServiceClient($pluginConfigService);
    }

    /**
     * @param array<string, mixed> $query
     * @param array<string, mixed>|null $flash
     * @return array<string, mixed>
     */
    public function getPageData(array $query, ?array $flash = null): array
    {
        $this->cleanupExpiredUploads();

        return [
            'flash' => $flash,
            'configured' => $this->pluginConfigService->isConfigured(),
            'selected_run_id' => $this->cleanIdentifier((string) ($query['run_id'] ?? '')),
            'export_options' => $this->loadExportOptions(),
            'jsonl_retention_seconds' => self::JSONL_RETENTION_SECONDS,
            'p4_ai_review_enabled' => $this->isAiCandidateReviewEnabled(),
            'p4_ai_review_feature_flag' => self::P4_AI_REVIEW_FEATURE_FLAG,
            'recent_p4_candidate_runs' => $this->loadRecentP4CandidateRuns(),
            'p4_eligible_candidate_statuses' => self::P4_ELIGIBLE_CANDIDATE_STATUSES,
            'ai_provider_catalog' => $this->loadOperationalProviderCatalog(),
        ];
    }

    /**
     * @param array<string, mixed> $post
     * @param array<string, mixed> $files
     * @return array<string, mixed>
     */
    public function handlePost(array $post, array $files, int $userId): array
    {
        if (!$this->pluginConfigService->isConfigured()) {
            return ['type' => 'danger', 'message' => __('PostgreSQL externo ainda não está configurado.', 'glpiintegaglpi')];
        }
        $this->cleanupExpiredUploads();

        $action = trim((string) ($post['action'] ?? ''));
        try {
            if ($action === 'preview_glpi_export') {
                return $this->previewGlpiExport($post, $userId);
            }
            if ($action === 'generate_glpi_jsonl') {
                return $this->generateGlpiJsonl($post, $userId);
            }
            if ($action === 'validate_generated') {
                return $this->validateGeneratedJsonl($post, $userId);
            }
            if ($action === 'validate_upload') {
                return $this->validateUpload($post, $files, $userId);
            }
            if ($action === 'execute_mining') {
                return $this->executeMining($post, $userId);
            }
            if ($action === 'generate_candidates') {
                return $this->generateCandidates($post, $userId);
            }
            if ($action === 'preview_ai_candidate_review') {
                return $this->previewAiCandidateReview($post, $userId);
            }
            if ($action === 'execute_ai_candidate_review') {
                return $this->executeAiCandidateReview($post, $userId);
            }
            if ($action === 'create_kb_from_solution') {
                return $this->handleCreateKbFromSolution($post, $userId);
            }

            return ['type' => 'danger', 'message' => __('Ação inválida.', 'glpiintegaglpi')];
        } catch (RuntimeException $exception) {
            return ['type' => 'danger', 'message' => $this->publicError($exception->getMessage())];
        } catch (Throwable $exception) {
            error_log('[integaglpi][historical_mining_ui] ' . $this->sanitizeLog($exception->getMessage()));

            return ['type' => 'danger', 'message' => __('Falha ao processar mineração histórica.', 'glpiintegaglpi')];
        }
    }

    /**
     * @param array<string, mixed> $post
     */
    public function downloadGeneratedJsonl(array $post, int $userId): void
    {
        if (!$this->pluginConfigService->isConfigured()) {
            throw new RuntimeException(__('PostgreSQL externo ainda não está configurado.', 'glpiintegaglpi'));
        }

        $this->cleanupExpiredUploads();
        $uploadId = (string) ($post['upload_id'] ?? '');
        $upload = $this->loadGeneratedUploadForAction($uploadId, $userId, 'download');
        $path = (string) ($upload['path'] ?? '');
        if ($path === '' || !is_file($path) || !$this->isPathInside($path, $this->uploadDir())) {
            $this->auditExpiredOrNotFound($uploadId, $userId, 'download');
            throw new RuntimeException(__('Arquivo JSONL expirado ou indisponível. Gere o arquivo novamente.', 'glpiintegaglpi'));
        }

        $filename = $this->safeDownloadFilename((string) ($upload['filename'] ?? 'glpi-history.jsonl'));
        $filesize = filesize($path);
        $this->audit('HISTORICAL_JSONL_DOWNLOADED', [
            'glpi_user_id' => $userId,
            'upload_id_hash' => hash('sha256', (string) $upload['upload_id']),
            'content_hash' => (string) ($upload['content_hash'] ?? ''),
            'total_exported' => (int) ($upload['line_count'] ?? 0),
            'expires_at' => (int) ($upload['expires_at'] ?? 0),
            'source' => 'glpi_export',
        ]);

        while (ob_get_level() > 0) {
            @ob_end_clean();
        }
        header('Content-Type: application/jsonl; charset=UTF-8');
        header('Content-Disposition: attachment; filename="' . $filename . '"');
        header('X-Content-Type-Options: nosniff');
        header('Cache-Control: no-store, no-cache, must-revalidate');
        if ($filesize !== false) {
            header('Content-Length: ' . (string) $filesize);
        }
        readfile($path);
    }

    /**
     * @param array<string, mixed> $post
     * @param array<string, mixed> $files
     * @return array<string, mixed>
     */
    private function validateUpload(array $post, array $files, int $userId): array
    {
        $upload = $this->storeUploadedJsonl(is_array($files['history_jsonl'] ?? null) ? $files['history_jsonl'] : []);
        $payload = $this->payloadForUpload($upload, $post, $userId);
        $response = $this->client->previewHistoricalMining($payload);
        if (empty($response['success'])) {
            return $this->clientError($response, __('Dry-run de mineração falhou.', 'glpiintegaglpi'));
        }

        $body = is_array($response['body'] ?? null) ? $response['body'] : [];
        $rowsProcessed = $this->rowsProcessedFromMiningBody($body);
        $upload['dry_run_token'] = $rowsProcessed > 0 ? (string) ($body['dry_run_token'] ?? '') : '';
        $upload['dry_run_ready'] = $rowsProcessed > 0;
        $upload['dry_run_rows_processed'] = $rowsProcessed;
        $upload['window_start'] = (string) ($payload['window_start'] ?? '');
        $upload['window_end'] = (string) ($payload['window_end'] ?? '');
        $upload['max_rows'] = (int) ($payload['max_rows'] ?? 1000);
        $this->rememberUpload($upload);

        return [
            'type' => $rowsProcessed > 0 ? 'success' : 'warning',
            'message' => $rowsProcessed > 0
                ? __('Dry-run concluído. Revise o preview antes de executar a mineração real.', 'glpiintegaglpi')
                : __('Dry-run concluído sem linhas processáveis. Revise os motivos de rejeição antes de executar a mineração real.', 'glpiintegaglpi'),
            'upload' => $upload,
            'mining_result' => $body,
        ];
    }

    /**
     * @param array<string, mixed> $post
     * @return array<string, mixed>
     */
    private function executeMining(array $post, int $userId): array
    {
        $upload = $this->loadRememberedUpload((string) ($post['upload_id'] ?? ''));
        $dryRunToken = trim((string) ($post['dry_run_token'] ?? ''));
        if ($dryRunToken === '' || !hash_equals((string) ($upload['dry_run_token'] ?? ''), $dryRunToken)) {
            throw new RuntimeException(__('Execute o dry-run do mesmo arquivo antes da mineração real.', 'glpiintegaglpi'));
        }
        if (empty($upload['dry_run_ready']) || (int) ($upload['dry_run_rows_processed'] ?? 0) <= 0) {
            throw new RuntimeException(__('Execução real bloqueada: o dry-run não encontrou linhas processáveis.', 'glpiintegaglpi'));
        }

        return $this->withFileLock('p2_execute:' . (string) $upload['upload_id'], function () use ($upload, $post, $userId, $dryRunToken): array {
            $payload = $this->payloadForUpload($upload, $post, $userId);
            $payload['dry_run_token'] = $dryRunToken;
            $response = $this->client->executeHistoricalMining($payload);
            if (empty($response['success'])) {
                return $this->clientError($response, __('Execução da mineração falhou.', 'glpiintegaglpi'));
            }

            $body = is_array($response['body'] ?? null) ? $response['body'] : [];
            $summary = is_array($body['summary'] ?? null) ? $body['summary'] : [];
            $rowsProcessed = (int) ($summary['rows_processed'] ?? 0);
            $this->audit('HISTORICAL_MINING_EXECUTED', [
                'glpi_user_id' => $userId,
                'upload_id_hash' => hash('sha256', (string) $upload['upload_id']),
                'run_id' => (string) ($summary['run_id'] ?? ''),
                'rows_processed' => $summary['rows_processed'] ?? null,
                'rows_rejected' => $summary['rows_rejected'] ?? null,
            ]);

            return [
                'type' => $rowsProcessed > 0 ? 'success' : 'warning',
                'message' => $rowsProcessed > 0
                    ? __('Mineração executada. O run_id está disponível para gerar candidatos de KB.', 'glpiintegaglpi')
                    : __('Mineração não foi persistida como sucesso pleno porque não houve linhas processadas.', 'glpiintegaglpi'),
                'upload' => $upload,
                'export_upload' => ($upload['source'] ?? '') === 'glpi_export' ? $upload : null,
                'export_preview' => $this->exportPreviewFromUpload($upload),
                'mining_result' => $body,
            ];
        });
    }

    /**
     * @param array<string, mixed> $post
     * @return array<string, mixed>
     */
    private function generateCandidates(array $post, int $userId): array
    {
        $runId = $this->cleanIdentifier((string) ($post['run_id'] ?? ''));
        if ($runId === '') {
            throw new RuntimeException(__('Informe um run_id válido da mineração P2.', 'glpiintegaglpi'));
        }

        return $this->withFileLock('p3_candidates:' . $runId, function () use ($runId, $post, $userId): array {
            $maxCandidates = max(1, min(50, (int) ($post['max_candidates'] ?? 20)));
            $minConfidence = max(1, min(100, (int) ($post['min_confidence'] ?? 65)));
            $this->audit('KB_CANDIDATE_GENERATION_REQUESTED', [
                'glpi_user_id' => $userId,
                'run_id' => $runId,
                'max_candidates' => $maxCandidates,
                'min_confidence' => $minConfidence,
            ]);
            $response = $this->client->generateKbCandidatesFromHistory([
                'run_id' => $runId,
                'max_candidates' => $maxCandidates,
                'min_confidence' => $minConfidence,
                'dry_run' => false,
                'requested_by' => $userId,
            ]);
            if (empty($response['success'])) {
                return $this->clientError($response, __('Geração de candidatos falhou.', 'glpiintegaglpi'));
            }
            $body = is_array($response['body'] ?? null) ? $response['body'] : [];
            $this->audit('KB_CANDIDATE_GENERATION_COMPLETED', [
                'glpi_user_id' => $userId,
                'run_id' => $runId,
                'candidates_generated' => $body['candidates_generated'] ?? null,
                'candidates_inserted' => $body['candidates_inserted'] ?? null,
            ]);

            return [
                'type' => 'success',
                'message' => __('Candidatos de KB gerados para revisão humana. Nenhuma publicação automática foi executada.', 'glpiintegaglpi'),
                'candidate_result' => $body,
            ];
        });
    }

    /**
     * @param array<string, mixed> $post
     * @return array<string, mixed>
     */
    private function previewAiCandidateReview(array $post, int $userId): array
    {
        $runId = $this->cleanIdentifier((string) ($post['run_id'] ?? ''));
        if ($runId === '') {
            throw new RuntimeException(__('Informe um run_id válido com candidatos P3 persistidos.', 'glpiintegaglpi'));
        }

        $maxCandidates = max(1, min(self::P4_MAX_CANDIDATES, (int) ($post['max_candidates'] ?? self::P4_MAX_CANDIDATES)));
        $lookup = $this->lookupAiReviewCandidatePayloads($runId, $maxCandidates);
        $payloads = is_array($lookup['payloads'] ?? null) ? $lookup['payloads'] : [];
        $diagnostic = is_array($lookup['diagnostic'] ?? null) ? $lookup['diagnostic'] : [];
        if ($payloads === []) {
            return [
                'type' => 'warning',
                'message' => $this->aiReviewCandidateLookupMessage($diagnostic),
                'ai_review_preview' => [
                    'enabled' => $this->isAiCandidateReviewEnabled(),
                    'run_id' => $runId,
                    'diagnostic' => $diagnostic,
                    'candidates' => [],
                    'next_action' => $this->aiReviewCandidateLookupNextAction($diagnostic),
                ],
            ];
        }

        $payloadHash = hash('sha256', json_encode($payloads, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?: '');
        $providerSelection = $this->selectedAiProviderForP4($post);
        $preview = [
            'enabled' => $this->isAiCandidateReviewEnabled(),
            'run_id' => $runId,
            'feature_flag' => self::P4_AI_REVIEW_FEATURE_FLAG,
            'confidence_threshold' => self::P4_CONFIDENCE_THRESHOLD,
            'max_candidates' => $maxCandidates,
            'payload_hash' => $payloadHash,
            'provider_selection' => $providerSelection,
            'provider' => (string) ($providerSelection['provider'] ?? 'disabled'),
            'model' => (string) ($providerSelection['model'] ?? ''),
            'source' => (string) ($providerSelection['source'] ?? 'local'),
            'candidates' => $payloads,
            'safety_flags' => [
                'p4_ai_sanitized_candidates_only' => true,
                'p4_no_raw_history' => true,
                'p4_no_pii' => true,
                'p4_no_auto_publish' => true,
                'p4_human_review_required' => true,
            ],
            'next_action' => $this->isAiCandidateReviewEnabled()
                ? __('Payload P4 sanitizado. A execução real exige clique manual e provider disponível.', 'glpiintegaglpi')
                : __('Revisão IA de candidatos está desabilitada. Você ainda pode revisar manualmente.', 'glpiintegaglpi'),
        ];

        $this->audit('KB_CANDIDATE_AI_REVIEW_PREVIEWED', [
            'glpi_user_id' => $userId,
            'run_id' => $runId,
            'candidate_count' => count($payloads),
            'payload_hash' => $payloadHash,
            'feature_enabled' => (bool) $preview['enabled'],
            'provider' => (string) ($providerSelection['provider'] ?? 'disabled'),
            'model_hash' => hash('sha256', (string) ($providerSelection['model'] ?? '')),
            'source' => (string) ($providerSelection['source'] ?? 'local'),
            'ready' => !empty($providerSelection['ready']),
        ]);

        return [
            'type' => 'success',
            'message' => __('Preview P4 gerado sem chamar IA. Revise o payload sanitizado antes de qualquer execução real.', 'glpiintegaglpi'),
            'ai_review_preview' => $preview,
        ];
    }

    /**
     * @param array<string, mixed> $post
     * @return array<string, mixed>
     */
    private function executeAiCandidateReview(array $post, int $userId): array
    {
        $runId = $this->cleanIdentifier((string) ($post['run_id'] ?? ''));
        if ($runId === '') {
            throw new RuntimeException(__('Informe um run_id válido com candidatos P3 persistidos.', 'glpiintegaglpi'));
        }

        if (!$this->isAiCandidateReviewEnabled()) {
            $providerSelection = $this->selectedAiProviderForP4($post);
            $this->audit('KB_CANDIDATE_AI_REVIEW_BLOCKED', [
                'glpi_user_id' => $userId,
                'run_id' => $runId,
                'reason' => 'feature_flag_disabled',
                'feature_flag' => self::P4_AI_REVIEW_FEATURE_FLAG,
                'provider' => (string) ($providerSelection['provider'] ?? 'disabled'),
                'model_hash' => hash('sha256', (string) ($providerSelection['model'] ?? '')),
                'source' => (string) ($providerSelection['source'] ?? 'local'),
            ]);

            return [
                'type' => 'warning',
                'message' => __('Revisão IA de candidatos está desabilitada. Você ainda pode revisar manualmente.', 'glpiintegaglpi'),
                'ai_review_result' => [
                    'status' => 'disabled',
                    'run_id' => $runId,
                    'feature_flag' => self::P4_AI_REVIEW_FEATURE_FLAG,
                    'provider' => (string) ($providerSelection['provider'] ?? 'disabled'),
                    'model' => (string) ($providerSelection['model'] ?? ''),
                    'source' => (string) ($providerSelection['source'] ?? 'local'),
                    'no_auto_publish' => true,
                ],
            ];
        }

        $maxCandidates = max(1, min(self::P4_MAX_CANDIDATES, (int) ($post['max_candidates'] ?? self::P4_MAX_CANDIDATES)));
        $lookup = $this->lookupAiReviewCandidatePayloads($runId, $maxCandidates);
        $payloads = is_array($lookup['payloads'] ?? null) ? $lookup['payloads'] : [];
        $diagnostic = is_array($lookup['diagnostic'] ?? null) ? $lookup['diagnostic'] : [];
        if ($payloads === []) {
            return [
                'type' => 'warning',
                'message' => $this->aiReviewCandidateLookupMessage($diagnostic),
                'ai_review_result' => [
                    'status' => 'no_candidates',
                    'run_id' => $runId,
                    'diagnostic' => $diagnostic,
                    'no_auto_publish' => true,
                ],
            ];
        }

        $providerConfig = $this->loadAiCandidateReviewProviderConfig($post);
        $provider = (string) ($providerConfig['provider'] ?? 'disabled');
        $providerModel = (string) ($providerConfig['model'] ?? '');
        $providerSource = (string) ($providerConfig['source'] ?? (!empty($providerConfig['cloud']) ? 'cloud' : 'local'));
        if (empty($providerConfig['available'])) {
            $this->audit('KB_CANDIDATE_AI_REVIEW_BLOCKED', [
                'glpi_user_id' => $userId,
                'run_id' => $runId,
                'reason' => (string) ($providerConfig['reason'] ?? 'provider_unavailable'),
                'feature_flag' => self::P4_AI_REVIEW_FEATURE_FLAG,
                'provider' => $provider,
                'model_hash' => hash('sha256', $providerModel),
                'source' => $providerSource,
            ]);

            return [
                'type' => 'warning',
                'message' => $this->publicError((string) ($providerConfig['reason'] ?? 'provider_unavailable')),
                'ai_review_result' => [
                    'status' => 'error',
                    'error_type' => (string) ($providerConfig['reason'] ?? 'provider_unavailable'),
                    'run_id' => $runId,
                    'reason' => (string) ($providerConfig['reason'] ?? 'provider_unavailable'),
                    'provider' => $provider,
                    'model' => $providerModel,
                    'source' => $providerSource,
                    'no_auto_publish' => true,
                ],
            ];
        }

        $payloadHash = hash('sha256', json_encode($payloads, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?: '');
        try {
            $providerResponse = !empty($providerConfig['cloud'])
                ? $this->callCloudProviderForCandidateReview($providerConfig, $payloads)
                : $this->callLocalOllamaForCandidateReview($providerConfig, $payloads);
            $suggestions = $this->validateAiCandidateReviewResponse((string) $providerResponse['response_text'], $payloads);
            $suggestionHash = hash('sha256', json_encode($suggestions, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?: '');
            $persisted = $this->persistAiCandidateReviewSuggestions($runId, $suggestions, $userId);

            $this->audit('KB_CANDIDATE_AI_REVIEW_COMPLETED', [
                'glpi_user_id' => $userId,
                'run_id' => $runId,
                'provider' => $provider,
                'model_hash' => hash('sha256', $providerModel),
                'source' => $providerSource,
                'payload_hash' => $payloadHash,
                'suggestion_hash' => $suggestionHash,
                'candidate_count' => count($payloads),
                'suggestion_count' => count($suggestions),
                'persisted_reviews' => $persisted,
                'no_auto_publish' => true,
                'recommended_actions' => array_map(static function (array $suggestion): string {
                    return (string) ($suggestion['recommended_action'] ?? '');
                }, $suggestions),
                'confidence_values' => array_map(static function (array $suggestion): int {
                    return (int) ($suggestion['confidence'] ?? 0);
                }, $suggestions),
            ]);

            return [
                'type' => 'success',
                'message' => __('Revisão IA concluída como sugestão revisável. Nenhuma publicação automática foi executada.', 'glpiintegaglpi'),
                'ai_review_result' => [
                    'status' => 'completed',
                    'run_id' => $runId,
                    'provider' => $provider,
                    'model' => $providerModel,
                    'source' => $providerSource,
                    'payload_hash' => $payloadHash,
                    'suggestion_hash' => $suggestionHash,
                    'elapsed_ms' => (int) ($providerResponse['elapsed_ms'] ?? 0),
                    'persisted_reviews' => $persisted,
                    'confidence_threshold' => self::P4_CONFIDENCE_THRESHOLD,
                    'suggestions' => $suggestions,
                    'human_review_required' => true,
                    'no_auto_publish' => true,
                ],
            ];
        } catch (RuntimeException $exception) {
            $errorType = $this->p4ProviderErrorType($exception->getMessage());
            $this->audit('KB_CANDIDATE_AI_REVIEW_BLOCKED', [
                'glpi_user_id' => $userId,
                'run_id' => $runId,
                'reason' => $errorType,
                'provider' => $provider,
                'model_hash' => hash('sha256', $providerModel),
                'source' => $providerSource,
                'payload_hash' => $payloadHash,
                'error_hash' => hash('sha256', $exception->getMessage()),
            ]);

            return [
                'type' => 'warning',
                'message' => $this->publicError($errorType),
                'ai_review_result' => [
                    'status' => 'error',
                    'error_type' => $errorType,
                    'run_id' => $runId,
                    'provider' => $provider,
                    'model' => $providerModel,
                    'source' => $providerSource,
                    'payload_hash' => $payloadHash,
                    'human_review_required' => true,
                    'no_auto_publish' => true,
                ],
            ];
        }
    }

    /**
     * Handles creation of a KB candidate from a ticket solution submitted from the ticket tab.
     * Delegates sanitization and persistence to KbCandidateService.
     * No automatic publish. No WhatsApp send. Human gate required.
     *
     * @param array<string, mixed> $post
     * @return array{type: string, message: string}
     */
    private function handleCreateKbFromSolution(array $post, int $userId): array
    {
        $ticketId = (int) ($post['ticket_id'] ?? 0);
        if ($ticketId <= 0) {
            throw new RuntimeException(__('ID de chamado inválido para criar candidato KB.', 'glpiintegaglpi'));
        }

        $solutionText = mb_substr(strip_tags((string) ($post['solution_text'] ?? '')), 0, 4000);
        $ticketTitle = mb_substr(strip_tags((string) ($post['ticket_title'] ?? '')), 0, 240);

        $service = new KbCandidateService($this->pluginConfigService);

        return $service->createKbCandidateFromSolution($ticketId, $solutionText, $ticketTitle, $userId);
    }

    /**
     * @param array<string, mixed> $post
     * @return array<string, mixed>
     */
    private function previewGlpiExport(array $post, int $userId): array
    {
        $filters = $this->normalizeExportFilters($post);
        $export = $this->buildGlpiJsonlExport($filters, false);
        $token = $this->exportPreviewToken($filters);
        $this->rememberExportPreview($token, $filters);
        $this->audit('HISTORICAL_JSONL_PREVIEWED', [
            'glpi_user_id' => $userId,
            'filters_hash' => hash('sha256', json_encode($filters, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?: ''),
            'total_found' => $export['total_found'],
            'total_exportable' => $export['total_exportable'],
            'rows_rejected' => $export['rows_rejected'],
            'fields_sanitized' => $export['fields_sanitized'],
        ]);

        return [
            'type' => $export['total_exportable'] > 0 ? 'success' : 'warning',
            'message' => $export['total_exportable'] > 0
                ? __('Pré-visualização gerada. Revise a amostra sanitizada antes de gerar o JSONL.', 'glpiintegaglpi')
                : __('Nenhum chamado exportável foi encontrado com esses filtros.', 'glpiintegaglpi'),
            'export_preview' => $export + [
                'preview_token' => $token,
                'filters' => $filters,
            ],
        ];
    }

    /**
     * @param array<string, mixed> $post
     * @return array<string, mixed>
     */
    private function generateGlpiJsonl(array $post, int $userId): array
    {
        $filters = $this->normalizeExportFilters($post);
        $token = trim((string) ($post['export_preview_token'] ?? ''));
        if ($token === '' || !$this->isRememberedExportPreview($token, $filters)) {
            throw new RuntimeException(__('Gere a pré-visualização da exportação antes de criar o JSONL.', 'glpiintegaglpi'));
        }

        return $this->withFileLock('glpi_jsonl_export:' . hash('sha256', $userId . ':' . json_encode($filters, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)), function () use ($filters, $token, $userId): array {
            $export = $this->buildGlpiJsonlExport($filters, true);
            if ((int) ($export['residual_sensitive_rows'] ?? 0) > 0) {
                $this->audit('HISTORICAL_JSONL_BLOCKED_PII', [
                    'glpi_user_id' => $userId,
                    'filters_hash' => hash('sha256', json_encode($filters, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?: ''),
                    'residual_sensitive_rows' => $export['residual_sensitive_rows'],
                    'rows_rejected' => $export['rows_rejected'],
                ]);
                throw new RuntimeException(__('A exportação foi bloqueada porque ainda há dado sensível detectável após sanitização.', 'glpiintegaglpi'));
            }
            if ($export['total_exportable'] <= 0 || trim((string) $export['jsonl_content']) === '') {
                throw new RuntimeException(__('Nenhuma linha exportável para gerar JSONL.', 'glpiintegaglpi'));
            }

            $exportPreview = $this->exportPreviewForSession($export, $token, $filters);
            $upload = $this->storeGeneratedJsonl((string) $export['jsonl_content'], (int) $export['total_exportable']);
            $upload['export_preview'] = $exportPreview;
            $this->rememberUpload($upload);
            $this->audit('HISTORICAL_JSONL_GENERATED', [
                'glpi_user_id' => $userId,
                'upload_id_hash' => hash('sha256', (string) $upload['upload_id']),
                'content_hash' => (string) ($upload['content_hash'] ?? ''),
                'filters_hash' => hash('sha256', json_encode($filters, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?: ''),
                'total_exportable' => $export['total_exportable'],
                'total_exported' => (int) ($upload['line_count'] ?? $export['total_exportable']),
                'rows_rejected' => $export['rows_rejected'],
                'expires_at' => (int) ($upload['expires_at'] ?? 0),
                'retention_seconds' => self::JSONL_RETENTION_SECONDS,
            ]);

            return [
                'type' => 'success',
                'message' => __('JSONL sanitizado gerado em área controlada. Agora execute o dry-run P2 com este arquivo.', 'glpiintegaglpi'),
                'export_preview' => $exportPreview,
                'export_upload' => $upload,
            ];
        });
    }

    /**
     * @param array<string, mixed> $post
     * @return array<string, mixed>
     */
    private function validateGeneratedJsonl(array $post, int $userId): array
    {
        $uploadId = (string) ($post['upload_id'] ?? '');
        $upload = $this->loadGeneratedUploadForAction($uploadId, $userId, 'dry_run');
        if (($upload['source'] ?? '') !== 'glpi_export') {
            throw new RuntimeException(__('Arquivo gerado inválido. Gere novamente o JSONL a partir do GLPI.', 'glpiintegaglpi'));
        }

        return $this->withFileLock('p2_dry_run:' . (string) $upload['upload_id'], function () use ($upload, $post, $userId): array {
            $payload = $this->payloadForUpload($upload, $post, $userId);
            $this->audit('HISTORICAL_JSONL_SELECTED_FOR_DRY_RUN', [
                'glpi_user_id' => $userId,
                'upload_id_hash' => hash('sha256', (string) $upload['upload_id']),
                'content_hash' => (string) ($upload['content_hash'] ?? ''),
                'total_exported' => (int) ($upload['line_count'] ?? 0),
                'expires_at' => (int) ($upload['expires_at'] ?? 0),
                'source' => 'glpi_export',
            ]);
            $this->audit('HISTORICAL_MINING_DRY_RUN_REQUESTED', [
                'glpi_user_id' => $userId,
                'upload_id_hash' => hash('sha256', (string) $upload['upload_id']),
                'source' => 'glpi_export',
            ]);
            $response = $this->client->previewHistoricalMining($payload);
            if (empty($response['success'])) {
                return $this->clientError($response, __('Dry-run de mineração falhou.', 'glpiintegaglpi'));
            }

            $body = is_array($response['body'] ?? null) ? $response['body'] : [];
            $rowsProcessed = $this->rowsProcessedFromMiningBody($body);
            $upload['dry_run_token'] = $rowsProcessed > 0 ? (string) ($body['dry_run_token'] ?? '') : '';
            $upload['dry_run_ready'] = $rowsProcessed > 0;
            $upload['dry_run_rows_processed'] = $rowsProcessed;
            $upload['window_start'] = (string) ($payload['window_start'] ?? '');
            $upload['window_end'] = (string) ($payload['window_end'] ?? '');
            $upload['max_rows'] = (int) ($payload['max_rows'] ?? 1000);
            $this->rememberUpload($upload);

            return [
                'type' => $rowsProcessed > 0 ? 'success' : 'warning',
                'message' => $rowsProcessed > 0
                    ? __('Dry-run do JSONL gerado concluído. Revise o preview antes da execução real.', 'glpiintegaglpi')
                    : __('Dry-run do JSONL gerado concluiu sem linhas processáveis. Veja os motivos de rejeição e ajuste a exportação.', 'glpiintegaglpi'),
                'upload' => $upload,
                'export_upload' => $upload,
                'export_preview' => $this->exportPreviewFromUpload($upload),
                'mining_result' => $body,
            ];
        });
    }

    /**
     * @param array<string, mixed> $file
     * @return array<string, mixed>
     */
    private function storeUploadedJsonl(array $file): array
    {
        if ((int) ($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
            throw new RuntimeException(__('Envie um arquivo JSONL sanitizado.', 'glpiintegaglpi'));
        }

        $originalName = basename((string) ($file['name'] ?? 'history.jsonl'));
        if (strtolower(pathinfo($originalName, PATHINFO_EXTENSION)) !== 'jsonl') {
            throw new RuntimeException(__('Somente arquivos .jsonl sanitizados são aceitos nesta tela.', 'glpiintegaglpi'));
        }

        $size = (int) ($file['size'] ?? 0);
        if ($size <= 0 || $size > self::MAX_UPLOAD_BYTES) {
            throw new RuntimeException(__('Arquivo vazio ou acima do limite seguro de 5 MB.', 'glpiintegaglpi'));
        }

        $tmpName = (string) ($file['tmp_name'] ?? '');
        if ($tmpName === '' || !is_uploaded_file($tmpName)) {
            throw new RuntimeException(__('Upload inválido. Reenvie o arquivo pela tela de mineração.', 'glpiintegaglpi'));
        }

        $dir = $this->uploadDir();
        if (!is_dir($dir) && !mkdir($dir, 0700, true) && !is_dir($dir)) {
            throw new RuntimeException(__('Não foi possível preparar área temporária controlada.', 'glpiintegaglpi'));
        }

        $uploadId = bin2hex(random_bytes(16));
        $path = $dir . DIRECTORY_SEPARATOR . $uploadId . '.jsonl';
        if (!move_uploaded_file($tmpName, $path)) {
            throw new RuntimeException(__('Falha ao armazenar upload na área temporária controlada.', 'glpiintegaglpi'));
        }

        return [
            'upload_id' => $uploadId,
            'path' => $path,
            'filename' => $originalName,
            'created_at' => time(),
            'expires_at' => time() + self::JSONL_RETENTION_SECONDS,
            'retention_seconds' => self::JSONL_RETENTION_SECONDS,
            'source' => 'upload',
        ];
    }

    /**
     * @param array<string, mixed> $post
     * @return array<string, mixed>
     */
    private function normalizeExportFilters(array $post): array
    {
        $closedOnly = !empty($post['closed_only']);
        $status = $this->cleanTicketStatus((string) ($post['ticket_status'] ?? ''));

        return [
            'date_start' => $this->cleanDate((string) ($post['export_date_start'] ?? '')),
            'date_end' => $this->cleanDate((string) ($post['export_date_end'] ?? '')),
            'entities_id' => max(0, (int) ($post['entities_id'] ?? 0)),
            'groups_id' => max(0, (int) ($post['groups_id'] ?? 0)),
            'itilcategories_id' => max(0, (int) ($post['itilcategories_id'] ?? 0)),
            'status' => $closedOnly ? '' : $status,
            'closed_only' => $closedOnly,
            'limit' => max(1, min(self::MAX_EXPORT_TICKETS, (int) ($post['export_limit'] ?? 100))),
            'include_followups' => !empty($post['include_followups']),
            'include_solution' => !empty($post['include_solution']),
        ];
    }

    private function cleanTicketStatus(string $value): string
    {
        $value = trim($value);

        return in_array($value, ['1', '2', '3', '4', '5', '6'], true) ? $value : '';
    }

    /**
     * @param array<string, mixed> $filters
     * @return array<string, mixed>
     */
    private function buildGlpiJsonlExport(array $filters, bool $includeContent): array
    {
        $tickets = $this->fetchGlpiTicketsForExport($filters);
        $sample = [];
        $jsonlLines = [];
        $fieldsSanitized = [];
        $rowsRejected = 0;
        $residualSensitiveRows = 0;

        foreach ($tickets as $ticket) {
            $row = $this->buildJsonlRowFromTicket($ticket, $filters, $fieldsSanitized);
            $json = json_encode($row, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
            if (!is_string($json) || $json === '') {
                $rowsRejected++;
                continue;
            }
            if ($this->containsSensitiveData($json)) {
                $rowsRejected++;
                $residualSensitiveRows++;
                continue;
            }

            if (count($sample) < 5) {
                $sample[] = $json;
            }
            if ($includeContent) {
                $jsonlLines[] = $json;
            }
        }

        return [
            'total_found' => count($tickets),
            'total_exportable' => count($jsonlLines) > 0 ? count($jsonlLines) : max(0, count($tickets) - $rowsRejected),
            'rows_rejected' => $rowsRejected,
            'residual_sensitive_rows' => $residualSensitiveRows,
            'sample_jsonl' => $sample,
            'fields_sanitized' => array_values(array_unique($fieldsSanitized)),
            'fields_removed' => ['id', 'requesttypes_id', 'users_id_recipient', 'locations_id', 'content_raw', 'followups_raw', 'solution_raw', 'attachments'],
            'jsonl_content' => $includeContent ? implode("\n", $jsonlLines) . "\n" : '',
        ];
    }

    /**
     * @param array<string, mixed> $export
     * @param array<string, mixed> $filters
     * @return array<string, mixed>
     */
    private function exportPreviewForSession(array $export, string $token, array $filters): array
    {
        unset($export['jsonl_content']);

        return $export + [
            'preview_token' => $token,
            'filters' => $filters,
        ];
    }

    /**
     * @param array<string, mixed> $filters
     * @return list<array<string, mixed>>
     */
    private function fetchGlpiTicketsForExport(array $filters): array
    {
        global $DB;
        if (!isset($DB) || !is_object($DB)) {
            return [];
        }

        $where = ['is_deleted' => 0];
        $activeEntities = $this->activeEntityIds();
        if ($activeEntities !== []) {
            $where['entities_id'] = $activeEntities;
        }

        $entityId = (int) ($filters['entities_id'] ?? 0);
        if ($entityId > 0) {
            if (!$this->canUseEntity($entityId)) {
                throw new RuntimeException(__('Entidade sem permissão para exportação.', 'glpiintegaglpi'));
            }
            $where['entities_id'] = $entityId;
        }

        $categoryId = (int) ($filters['itilcategories_id'] ?? 0);
        if ($categoryId > 0) {
            $where['itilcategories_id'] = $categoryId;
        }

        if (!empty($filters['closed_only'])) {
            $where['status'] = [5, 6];
        } elseif ((string) ($filters['status'] ?? '') !== '') {
            $where['status'] = (int) $filters['status'];
        }

        $dateStart = (string) ($filters['date_start'] ?? '');
        $dateEnd = (string) ($filters['date_end'] ?? '');
        if ($dateStart !== '') {
            $where[] = ['date' => ['>=', $dateStart . ' 00:00:00']];
        }
        if ($dateEnd !== '') {
            $where[] = ['date' => ['<=', $dateEnd . ' 23:59:59']];
        }

        $ticketIdsForGroup = null;
        $groupId = (int) ($filters['groups_id'] ?? 0);
        if ($groupId > 0) {
            $ticketIdsForGroup = $this->ticketIdsForGroup($groupId);
            if ($ticketIdsForGroup === []) {
                return [];
            }
            $where['id'] = $ticketIdsForGroup;
        }

        $rows = [];
        foreach ($DB->request([
            'SELECT' => ['id', 'name', 'content', 'date', 'solvedate', 'closedate', 'status', 'entities_id', 'itilcategories_id', 'priority', 'urgency'],
            'FROM' => 'glpi_tickets',
            'WHERE' => $where,
            'ORDER' => 'date DESC',
            'LIMIT' => (int) ($filters['limit'] ?? 100),
        ]) as $row) {
            $ticket = (array) $row;
            $ticketId = (int) ($ticket['id'] ?? 0);
            if ($ticketId <= 0) {
                continue;
            }
            if (!$this->canReadTicket($ticketId)) {
                continue;
            }
            $ticket['entity_name'] = $this->lookupName('glpi_entities', (int) ($ticket['entities_id'] ?? 0), 'completename');
            $ticket['category_name'] = $this->lookupName('glpi_itilcategories', (int) ($ticket['itilcategories_id'] ?? 0), 'completename');
            $ticket['group_name'] = $this->assignedGroupName($ticketId);
            $ticket['followup_text'] = !empty($filters['include_followups']) ? $this->loadFollowupText($ticketId) : '';
            $ticket['solution_text'] = !empty($filters['include_solution']) ? $this->loadSolutionText($ticketId) : '';
            $ticket['satisfaction_score'] = $this->loadSatisfactionScore($ticketId);
            $rows[] = $ticket;
        }

        return $rows;
    }

    /**
     * @param array<string, mixed> $ticket
     * @param array<string, mixed> $filters
     * @param array<int, string> $fieldsSanitized
     * @return array<string, mixed>
     */
    private function buildJsonlRowFromTicket(array $ticket, array $filters, array &$fieldsSanitized): array
    {
        $ticketId = (int) ($ticket['id'] ?? 0);
        $title = $this->sanitizeExportText((string) ($ticket['name'] ?? ''), 400, 'title_text_sanitized', $fieldsSanitized);
        $description = $this->sanitizeExportText((string) ($ticket['content'] ?? ''), 1200, 'description_text_sanitized', $fieldsSanitized);
        $followups = $this->sanitizeExportText((string) ($ticket['followup_text'] ?? ''), 1200, 'followup_text_sanitized', $fieldsSanitized);
        $solution = $this->sanitizeExportText((string) ($ticket['solution_text'] ?? ''), 1200, 'solution_text_sanitized', $fieldsSanitized);

        return [
            'ticket_id_hash' => hash('sha256', 'glpi_ticket:' . $ticketId),
            'opened_at' => $this->dateOrNull((string) ($ticket['date'] ?? '')),
            'solved_at' => $this->dateOrNull((string) ($ticket['solvedate'] ?? '')) ?? $this->dateOrNull((string) ($ticket['closedate'] ?? '')),
            'status' => $this->statusLabel((int) ($ticket['status'] ?? 0)),
            'category' => $this->sanitizeExportText((string) ($ticket['category_name'] ?? ''), 160, 'category', $fieldsSanitized),
            'entity' => $this->sanitizeExportText((string) ($ticket['entity_name'] ?? ''), 160, 'entity', $fieldsSanitized),
            'group' => $this->sanitizeExportText((string) ($ticket['group_name'] ?? ''), 160, 'group', $fieldsSanitized),
            'priority' => (string) ((int) ($ticket['priority'] ?? 0)),
            'urgency' => (string) ((int) ($ticket['urgency'] ?? 0)),
            'title_text_sanitized' => $title,
            'description_text_sanitized' => $description,
            'followup_text_sanitized' => $followups,
            'solution_text_sanitized' => $solution,
            'reopened_count' => 0,
            'satisfaction_score' => $ticket['satisfaction_score'],
        ];
    }

    /**
     * @return list<int>
     */
    private function activeEntityIds(): array
    {
        if (!class_exists('\Session') || !method_exists('\Session', 'getActiveEntities')) {
            return [];
        }

        $ids = \Session::getActiveEntities();
        if (!is_array($ids)) {
            return [];
        }

        return array_values(array_unique(array_filter(array_map('intval', $ids), static function (int $id): bool {
            return $id >= 0;
        })));
    }

    private function canUseEntity(int $entityId): bool
    {
        return !class_exists('\Session')
            || !method_exists('\Session', 'haveAccessToEntity')
            || (bool) \Session::haveAccessToEntity($entityId);
    }

    private function canReadTicket(int $ticketId): bool
    {
        $ticket = new \Ticket();

        return $ticketId > 0
            && $ticket->getFromDB($ticketId)
            && (bool) $ticket->can($ticketId, READ);
    }

    /**
     * @return list<int>
     */
    private function ticketIdsForGroup(int $groupId): array
    {
        global $DB;
        if ($groupId <= 0 || !isset($DB) || !is_object($DB)) {
            return [];
        }

        $ids = [];
        foreach ($DB->request([
            'SELECT' => ['tickets_id'],
            'FROM' => 'glpi_groups_tickets',
            'WHERE' => ['groups_id' => $groupId],
            'LIMIT' => self::MAX_EXPORT_TICKETS * 2,
        ]) as $row) {
            $id = (int) ($row['tickets_id'] ?? 0);
            if ($id > 0) {
                $ids[] = $id;
            }
        }

        return array_values(array_unique($ids));
    }

    private function assignedGroupName(int $ticketId): string
    {
        global $DB;
        if ($ticketId <= 0 || !isset($DB) || !is_object($DB)) {
            return '';
        }

        foreach ($DB->request([
            'SELECT' => ['groups_id'],
            'FROM' => 'glpi_groups_tickets',
            'WHERE' => ['tickets_id' => $ticketId],
            'ORDER' => 'type DESC, groups_id ASC',
            'LIMIT' => 1,
        ]) as $row) {
            return $this->lookupName('glpi_groups', (int) ($row['groups_id'] ?? 0), 'completename');
        }

        return '';
    }

    private function loadFollowupText(int $ticketId): string
    {
        global $DB;
        if ($ticketId <= 0 || !isset($DB) || !is_object($DB)) {
            return '';
        }

        $parts = [];
        foreach ($DB->request([
            'SELECT' => ['content'],
            'FROM' => 'glpi_itilfollowups',
            'WHERE' => [
                'itemtype' => 'Ticket',
                'items_id' => $ticketId,
                'is_private' => 0,
            ],
            'ORDER' => 'date ASC',
            'LIMIT' => 5,
        ]) as $row) {
            $parts[] = (string) ($row['content'] ?? '');
        }

        return implode("\n", $parts);
    }

    private function loadSolutionText(int $ticketId): string
    {
        global $DB;
        if ($ticketId <= 0 || !isset($DB) || !is_object($DB)) {
            return '';
        }

        $parts = [];
        foreach ($DB->request([
            'SELECT' => ['content'],
            'FROM' => 'glpi_itilsolutions',
            'WHERE' => [
                'itemtype' => 'Ticket',
                'items_id' => $ticketId,
            ],
            'ORDER' => 'date_creation ASC',
            'LIMIT' => 3,
        ]) as $row) {
            $parts[] = (string) ($row['content'] ?? '');
        }

        return implode("\n", $parts);
    }

    private function loadSatisfactionScore(int $ticketId): ?int
    {
        global $DB;
        if ($ticketId <= 0 || !isset($DB) || !is_object($DB) || !$DB->tableExists('glpi_ticketsatisfactions')) {
            return null;
        }

        foreach ($DB->request([
            'SELECT' => ['satisfaction'],
            'FROM' => 'glpi_ticketsatisfactions',
            'WHERE' => ['tickets_id' => $ticketId],
            'LIMIT' => 1,
        ]) as $row) {
            $score = (int) ($row['satisfaction'] ?? 0);

            return $score > 0 ? $score : null;
        }

        return null;
    }

    private function lookupName(string $table, int $id, string $preferredField = 'name'): string
    {
        static $cache = [];
        global $DB;
        if ($id <= 0 || !isset($DB) || !is_object($DB)) {
            return '';
        }

        $key = $table . ':' . $preferredField . ':' . $id;
        if (array_key_exists($key, $cache)) {
            return (string) $cache[$key];
        }

        foreach ($DB->request([
            'FROM' => $table,
            'WHERE' => ['id' => $id],
            'LIMIT' => 1,
        ]) as $row) {
            $row = (array) $row;
            $name = (string) ($row[$preferredField] ?? $row['name'] ?? '');
            $cache[$key] = $name;

            return $name;
        }

        $cache[$key] = '';
        return '';
    }

    /**
     * @return array<string, list<array<string, mixed>>>
     */
    private function loadExportOptions(): array
    {
        return [
            'entities' => $this->loadOptionsFromTable('glpi_entities', 'completename', 250, true),
            'groups' => $this->loadOptionsFromTable('glpi_groups', 'completename', 250, false),
            'categories' => $this->loadOptionsFromTable('glpi_itilcategories', 'completename', 250, false),
            'statuses' => [
                ['id' => 1, 'name' => 'new'],
                ['id' => 2, 'name' => 'processing'],
                ['id' => 3, 'name' => 'planned'],
                ['id' => 4, 'name' => 'pending'],
                ['id' => 5, 'name' => 'solved'],
                ['id' => 6, 'name' => 'closed'],
            ],
        ];
    }

    /**
     * @return list<array{id: int, name: string}>
     */
    private function loadOptionsFromTable(string $table, string $labelField, int $limit, bool $filterEntities): array
    {
        global $DB;
        if (!isset($DB) || !is_object($DB) || !$DB->tableExists($table)) {
            return [];
        }

        $where = [];
        if ($filterEntities) {
            $active = $this->activeEntityIds();
            if ($active !== []) {
                $where['id'] = $active;
            }
        }

        $criteria = [
            'FROM' => $table,
            'ORDER' => $labelField . ' ASC',
            'LIMIT' => $limit,
        ];
        if ($where !== []) {
            $criteria['WHERE'] = $where;
        }

        $rows = [];
        foreach ($DB->request($criteria) as $row) {
            $row = (array) $row;
            $id = (int) ($row['id'] ?? 0);
            if ($id < 0) {
                continue;
            }
            $rows[] = [
                'id' => $id,
                'name' => (string) ($row[$labelField] ?? $row['name'] ?? ('#' . $id)),
            ];
        }

        return $rows;
    }

    private function sanitizeExportText(string $value, int $limit, string $field, array &$fieldsSanitized): string
    {
        $original = $value;
        $value = html_entity_decode(strip_tags($value), ENT_QUOTES | ENT_HTML5, 'UTF-8');
        $value = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]+/u', ' ', $value) ?? '';
        $patterns = [
            'email' => '/[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}/i',
            'phone' => '/\b(?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?\d{4,5}[\s.\-]?\d{4}\b/',
            'cpf_cnpj' => '/\b(?:\d{3}\.?\d{3}\.?\d{3}-?\d{2}|\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2})\b/',
            'bearer' => '/\bBearer\s+[A-Za-z0-9._~+\/=-]+/i',
            'password' => '/\b(password|senha|token|secret|api[_-]?key|app_secret)\s*[:=]\s*\S+/i',
            'ip' => '/\b(?:10|127|172\.(?:1[6-9]|2\d|3[0-1])|192\.168)(?:\.\d{1,3}){2}\b/',
            'url' => '/https?:\/\/[^\s<>"\']+/i',
            'base64' => '/\b[A-Za-z0-9+\/]{48,}={0,2}\b/',
        ];

        foreach ($patterns as $kind => $pattern) {
            $updated = preg_replace($pattern, '[' . $kind . '_redacted]', $value);
            if (is_string($updated) && $updated !== $value) {
                $fieldsSanitized[] = $field . ':' . $kind;
                $value = $updated;
            }
        }

        $value = preg_replace('/\s+/u', ' ', $value) ?? '';
        $value = trim($value);
        if ($value !== trim(strip_tags($original))) {
            $fieldsSanitized[] = $field . ':normalized';
        }

        return mb_substr($value, 0, $limit, 'UTF-8');
    }

    private function containsSensitiveData(string $value): bool
    {
        return preg_match('/[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}|\b(?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?\d{4,5}[\s.\-]?\d{4}\b|\b(?:\d{3}\.?\d{3}\.?\d{3}-?\d{2}|\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2})\b|\bBearer\s+[A-Za-z0-9._~+\/=-]+|\b(password|senha|token|secret|api[_-]?key|app_secret)\s*[:=]\s*\S+/i', $value) === 1;
    }

    private function statusLabel(int $status): string
    {
        $labels = [
            1 => 'new',
            2 => 'processing',
            3 => 'planned',
            4 => 'pending',
            5 => 'solved',
            6 => 'closed',
        ];

        return $labels[$status] ?? 'unknown';
    }

    private function dateOrNull(string $value): ?string
    {
        $value = trim($value);

        return $value !== '' ? $value : null;
    }

    private function storeGeneratedJsonl(string $content, int $lineCount = 0): array
    {
        if (trim($content) === '') {
            throw new RuntimeException(__('JSONL gerado vazio.', 'glpiintegaglpi'));
        }

        $dir = $this->uploadDir();
        if (!is_dir($dir) && !mkdir($dir, 0700, true) && !is_dir($dir)) {
            throw new RuntimeException(__('Não foi possível preparar área temporária controlada.', 'glpiintegaglpi'));
        }

        $uploadId = bin2hex(random_bytes(16));
        $path = $dir . DIRECTORY_SEPARATOR . $uploadId . '.jsonl';
        if (file_put_contents($path, $content, LOCK_EX) === false) {
            throw new RuntimeException(__('Falha ao gravar JSONL sanitizado.', 'glpiintegaglpi'));
        }
        @chmod($path, 0600);

        return [
            'upload_id' => $uploadId,
            'file_id' => $uploadId,
            'path' => $path,
            'filename' => 'glpi-history-' . date('Ymd-His') . '.jsonl',
            'created_at' => time(),
            'expires_at' => time() + self::JSONL_RETENTION_SECONDS,
            'retention_seconds' => self::JSONL_RETENTION_SECONDS,
            'content_hash' => hash('sha256', $content),
            'line_count' => max(0, $lineCount),
            'source' => 'glpi_export',
        ];
    }

    /**
     * @param array<string, mixed> $upload
     * @return array<string, mixed>|null
     */
    private function exportPreviewFromUpload(array $upload): ?array
    {
        return is_array($upload['export_preview'] ?? null) ? $upload['export_preview'] : null;
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function loadAiReviewCandidatePayloads(string $runId, int $maxCandidates): array
    {
        $lookup = $this->lookupAiReviewCandidatePayloads($runId, $maxCandidates);

        return is_array($lookup['payloads'] ?? null) ? $lookup['payloads'] : [];
    }

    /**
     * @return array{payloads: list<array<string, mixed>>, diagnostic: array<string, mixed>}
     */
    private function lookupAiReviewCandidatePayloads(string $runId, int $maxCandidates): array
    {
        if (!$this->pluginConfigService->isConfigured()) {
            return [
                'payloads' => [],
                'diagnostic' => [
                    'status' => 'not_configured',
                    'message_key' => 'postgres_not_configured',
                    'run_id' => $runId,
                    'candidate_count' => 0,
                    'eligible_count' => 0,
                ],
            ];
        }

        $pdo = ExternalDatabase::getConnection($this->pluginConfigService->getConnectionConfig());
        $this->assertP4CandidateSchema($pdo);

        $resolved = $this->resolveP4RunInputHashes($pdo, $runId);
        $inputHashes = is_array($resolved['input_hashes'] ?? null) ? $resolved['input_hashes'] : [];
        $diagnostic = [
            'status' => 'unknown',
            'message_key' => '',
            'run_id' => $runId,
            'run_exists' => (bool) ($resolved['run_exists'] ?? false),
            'input_hashes' => $inputHashes,
            'candidate_count' => 0,
            'eligible_count' => 0,
            'status_counts' => [],
            'eligible_statuses' => self::P4_ELIGIBLE_CANDIDATE_STATUSES,
        ];
        if ($inputHashes === []) {
            $diagnostic['status'] = 'run_not_found';
            $diagnostic['message_key'] = 'run_id_not_found';

            return ['payloads' => [], 'diagnostic' => $diagnostic];
        }

        $statusCounts = $this->loadP4CandidateStatusCounts($pdo, $inputHashes);
        $candidateCount = array_sum($statusCounts);
        $eligibleCount = 0;
        foreach (self::P4_ELIGIBLE_CANDIDATE_STATUSES as $status) {
            $eligibleCount += (int) ($statusCounts[$status] ?? 0);
        }
        $diagnostic['candidate_count'] = $candidateCount;
        $diagnostic['eligible_count'] = $eligibleCount;
        $diagnostic['status_counts'] = $statusCounts;
        if ($candidateCount <= 0) {
            $diagnostic['status'] = !empty($diagnostic['run_exists']) ? 'run_without_candidates' : 'input_hash_without_candidates';
            $diagnostic['message_key'] = !empty($diagnostic['run_exists']) ? 'run_without_candidates' : 'run_id_not_found';

            return ['payloads' => [], 'diagnostic' => $diagnostic];
        }
        if ($eligibleCount <= 0) {
            $diagnostic['status'] = 'no_eligible_status';
            $diagnostic['message_key'] = 'no_eligible_status';

            return ['payloads' => [], 'diagnostic' => $diagnostic];
        }

        [$inputHashWhere, $inputHashParams] = $this->pdoInClause('input_hash', $inputHashes);
        [$statusWhere, $statusParams] = $this->pdoInClause('status', self::P4_ELIGIBLE_CANDIDATE_STATUSES);
        $candidateStatement = $pdo->prepare(
            "SELECT id,
                    candidate_key,
                    status,
                    article_type,
                    title,
                    content_markdown,
                    problem_pattern,
                    recommended_procedure_json,
                    evidence_hashes_json,
                    evidence_summary_sanitized,
                    confidence_score,
                    possible_duplicate,
                    limitations_json
               FROM public.glpi_plugin_integaglpi_kb_candidates
              WHERE input_hash IN ($inputHashWhere)
                AND status IN ($statusWhere)
              ORDER BY confidence_score DESC, created_at DESC
              LIMIT :limit"
        );
        foreach ($inputHashParams + $statusParams as $key => $value) {
            $candidateStatement->bindValue($key, $value);
        }
        $candidateStatement->bindValue(':limit', $maxCandidates, PDO::PARAM_INT);
        $candidateStatement->execute();

        $payloads = [];
        while (($row = $candidateStatement->fetch(PDO::FETCH_ASSOC)) !== false) {
            $fieldsSanitized = [];
            $steps = [];
            foreach (array_slice($this->jsonStringList($row['recommended_procedure_json'] ?? '[]'), 0, 6) as $step) {
                $sanitizedStep = $this->sanitizeExportText($step, 500, 'p4_resolution_step', $fieldsSanitized);
                if ($sanitizedStep !== '') {
                    $steps[] = $sanitizedStep;
                }
            }

            $payload = [
                'candidate_id' => (int) ($row['id'] ?? 0),
                'candidate_key' => $this->cleanIdentifier((string) ($row['candidate_key'] ?? '')),
                'run_id' => $runId,
                'suggested_type' => $this->sanitizeExportText((string) ($row['article_type'] ?? ''), 80, 'p4_article_type', $fieldsSanitized),
                'status' => $this->sanitizeExportText((string) ($row['status'] ?? ''), 80, 'p4_status', $fieldsSanitized),
                'kb_title_suggested' => $this->sanitizeExportText((string) ($row['title'] ?? ''), 180, 'p4_title', $fieldsSanitized),
                'kb_problem_summary' => $this->sanitizeExportText((string) ($row['problem_pattern'] ?? ''), 500, 'p4_problem', $fieldsSanitized),
                'kb_resolution_steps' => $steps,
                'candidate_excerpt_sanitized' => $this->sanitizeExportText((string) ($row['content_markdown'] ?? ''), 900, 'p4_content', $fieldsSanitized),
                'confidence' => (int) ($row['confidence_score'] ?? 0),
                'duplicate_flags' => [
                    'possible_duplicate' => (bool) ($row['possible_duplicate'] ?? false),
                ],
                'missing_information' => array_slice($this->jsonStringList($row['limitations_json'] ?? '[]'), 0, 5),
                'evidence_used' => [
                    'summary' => $this->sanitizeExportText((string) ($row['evidence_summary_sanitized'] ?? ''), 500, 'p4_evidence', $fieldsSanitized),
                    'hashes' => array_slice($this->jsonStringList($row['evidence_hashes_json'] ?? '[]'), 0, 5),
                ],
                'fields_sanitized' => array_values(array_unique($fieldsSanitized)),
                'safety_flags' => [
                    'raw_history_included' => false,
                    'contains_attachment' => false,
                    'auto_publish' => false,
                    'human_review_required' => true,
                ],
            ];

            $encoded = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?: '';
            if ($encoded === '' || $this->containsSensitiveData($encoded)) {
                throw new RuntimeException(__('P4 bloqueado: candidato contém dado sensível residual após sanitização.', 'glpiintegaglpi'));
            }
            $payloads[] = $payload;
        }

        $diagnostic['status'] = $payloads !== [] ? 'ok' : 'no_eligible_status';
        $diagnostic['message_key'] = $payloads !== [] ? 'ok' : 'no_eligible_status';

        return ['payloads' => $payloads, 'diagnostic' => $diagnostic];
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function loadRecentP4CandidateRuns(): array
    {
        if (!$this->pluginConfigService->isConfigured()) {
            return [];
        }

        try {
            $pdo = ExternalDatabase::getConnection($this->pluginConfigService->getConnectionConfig());
            $this->assertP4CandidateSchema($pdo);
            $statuses = implode("','", array_map(static function (string $status): string {
                return str_replace("'", "''", $status);
            }, self::P4_ELIGIBLE_CANDIDATE_STATUSES));
            $statement = $pdo->query(
                "SELECT COALESCE(r.run_id, c.input_hash) AS run_id,
                        c.input_hash,
                        COUNT(*)::int AS candidate_count,
                        COUNT(*) FILTER (WHERE c.status IN ('$statuses'))::int AS eligible_count,
                        STRING_AGG(DISTINCT c.status, ', ' ORDER BY c.status) AS status_list,
                        MAX(c.created_at) AS last_candidate_at
                   FROM public.glpi_plugin_integaglpi_kb_candidates c
              LEFT JOIN public.glpi_plugin_integaglpi_hist_mining_runs r
                     ON r.input_hash = c.input_hash
               GROUP BY COALESCE(r.run_id, c.input_hash), c.input_hash
               ORDER BY MAX(c.created_at) DESC
                  LIMIT 10"
            );
            if ($statement === false) {
                return [];
            }

            $rows = [];
            while (($row = $statement->fetch(PDO::FETCH_ASSOC)) !== false) {
                $ignored = [];
                $statusList = $this->sanitizeExportText((string) ($row['status_list'] ?? ''), 200, 'p4_status_list', $ignored);
                $ignored = [];
                $lastCandidateAt = $this->sanitizeExportText((string) ($row['last_candidate_at'] ?? ''), 80, 'p4_last_candidate_at', $ignored);
                $rows[] = [
                    'run_id' => $this->cleanIdentifier((string) ($row['run_id'] ?? '')),
                    'input_hash' => $this->cleanIdentifier((string) ($row['input_hash'] ?? '')),
                    'candidate_count' => max(0, (int) ($row['candidate_count'] ?? 0)),
                    'eligible_count' => max(0, (int) ($row['eligible_count'] ?? 0)),
                    'status_list' => $statusList,
                    'last_candidate_at' => $lastCandidateAt,
                ];
            }

            return array_values(array_filter($rows, static function (array $row): bool {
                return (string) ($row['run_id'] ?? '') !== '';
            }));
        } catch (Throwable $exception) {
            error_log('[integaglpi][historical_mining_ui][p4_recent_runs] ' . $this->sanitizeLog($exception->getMessage()));

            return [];
        }
    }

    private function assertP4CandidateSchema(PDO $pdo): void
    {
        $required = [
            'candidate_key',
            'input_hash',
            'status',
            'article_type',
            'title',
            'content_markdown',
            'problem_pattern',
            'recommended_procedure_json',
            'evidence_hashes_json',
            'evidence_summary_sanitized',
            'confidence_score',
            'possible_duplicate',
            'limitations_json',
            'created_at',
        ];
        $placeholders = [];
        $params = [':table_name' => 'glpi_plugin_integaglpi_kb_candidates'];
        foreach ($required as $index => $column) {
            $key = ':column_' . $index;
            $placeholders[] = $key;
            $params[$key] = $column;
        }
        $statement = $pdo->prepare(
            'SELECT column_name
               FROM information_schema.columns
              WHERE table_schema = \'public\'
                AND table_name = :table_name
                AND column_name IN (' . implode(', ', $placeholders) . ')'
        );
        $statement->execute($params);
        $found = [];
        while (($column = $statement->fetchColumn()) !== false) {
            $found[] = (string) $column;
        }
        $missing = array_values(array_diff($required, $found));
        if ($missing !== []) {
            throw new RuntimeException(sprintf(
                __('Schema de candidatos P3 incompatível para P4. Colunas ausentes: %s.', 'glpiintegaglpi'),
                implode(', ', $missing)
            ));
        }
    }

    /**
     * @return array{run_exists: bool, input_hashes: list<string>}
     */
    private function resolveP4RunInputHashes(PDO $pdo, string $runId): array
    {
        $inputHashes = [];
        $runExists = false;
        try {
            $runStatement = $pdo->prepare(
                'SELECT input_hash
                   FROM public.glpi_plugin_integaglpi_hist_mining_runs
                  WHERE run_id = :run_id
                  LIMIT 1'
            );
            $runStatement->execute([':run_id' => $runId]);
            $inputHash = $this->cleanIdentifier((string) ($runStatement->fetchColumn() ?: ''));
            if ($inputHash !== '') {
                $runExists = true;
                $inputHashes[] = $inputHash;
            }
        } catch (Throwable $exception) {
            error_log('[integaglpi][historical_mining_ui][p4_run_resolve] ' . $this->sanitizeLog($exception->getMessage()));
        }

        $inputHashes[] = $runId;

        return [
            'run_exists' => $runExists,
            'input_hashes' => array_values(array_unique(array_filter($inputHashes, static function (string $value): bool {
                return $value !== '';
            }))),
        ];
    }

    /**
     * @param list<string> $inputHashes
     * @return array<string, int>
     */
    private function loadP4CandidateStatusCounts(PDO $pdo, array $inputHashes): array
    {
        if ($inputHashes === []) {
            return [];
        }

        [$where, $params] = $this->pdoInClause('input_hash', $inputHashes);
        $statement = $pdo->prepare(
            "SELECT status, COUNT(*)::int AS total
               FROM public.glpi_plugin_integaglpi_kb_candidates
              WHERE input_hash IN ($where)
              GROUP BY status
              ORDER BY status ASC"
        );
        $statement->execute($params);

        $counts = [];
        while (($row = $statement->fetch(PDO::FETCH_ASSOC)) !== false) {
            $counts[(string) ($row['status'] ?? 'unknown')] = max(0, (int) ($row['total'] ?? 0));
        }

        return $counts;
    }

    /**
     * @param list<string> $values
     * @return array{0: string, 1: array<string, string>}
     */
    private function pdoInClause(string $prefix, array $values): array
    {
        $placeholders = [];
        $params = [];
        foreach (array_values($values) as $index => $value) {
            $key = ':' . $prefix . '_' . $index;
            $placeholders[] = $key;
            $params[$key] = $value;
        }

        return [implode(', ', $placeholders), $params];
    }

    /**
     * @param array<string, mixed> $diagnostic
     */
    private function aiReviewCandidateLookupMessage(array $diagnostic): string
    {
        $messageKey = (string) ($diagnostic['message_key'] ?? '');
        if ($messageKey === 'run_id_not_found') {
            return __('run_id/input_hash não encontrado com candidatos P3 persistidos.', 'glpiintegaglpi');
        }
        if ($messageKey === 'run_without_candidates') {
            return __('run_id existe, mas ainda não possui candidatos P3 persistidos. Gere candidatos P3 antes de executar P4.', 'glpiintegaglpi');
        }
        if ($messageKey === 'no_eligible_status') {
            return __('Candidatos P3 encontrados, mas nenhum está em status elegível para P4.', 'glpiintegaglpi');
        }
        if ($messageKey === 'postgres_not_configured') {
            return __('PostgreSQL externo ainda não está configurado.', 'glpiintegaglpi');
        }

        return __('Nenhum candidato P3 sanitizado foi encontrado para revisão IA.', 'glpiintegaglpi');
    }

    /**
     * @param array<string, mixed> $diagnostic
     */
    private function aiReviewCandidateLookupNextAction(array $diagnostic): string
    {
        $messageKey = (string) ($diagnostic['message_key'] ?? '');
        if ($messageKey === 'no_eligible_status') {
            $statuses = is_array($diagnostic['status_counts'] ?? null) ? implode(', ', array_keys($diagnostic['status_counts'])) : '';

            return sprintf(
                __('Revise o status dos candidatos. Status elegíveis para P4: %s. Status encontrados: %s.', 'glpiintegaglpi'),
                implode(', ', self::P4_ELIGIBLE_CANDIDATE_STATUSES),
                $statuses !== '' ? $statuses : __('nenhum', 'glpiintegaglpi')
            );
        }
        if ($messageKey === 'run_without_candidates') {
            return __('Execute P3 para esse run_id e volte para pré-visualizar o payload P4.', 'glpiintegaglpi');
        }

        return __('Use um run_id da lista de candidatos recentes ou gere candidatos P3 antes de executar P4.', 'glpiintegaglpi');
    }

    /**
     * @return list<string>
     */
    private function jsonStringList($value): array
    {
        if (is_array($value)) {
            return array_values(array_filter(array_map('strval', $value), static function (string $item): bool {
                return trim($item) !== '';
            }));
        }

        $decoded = json_decode((string) $value, true);
        if (!is_array($decoded)) {
            return [];
        }

        return array_values(array_filter(array_map('strval', $decoded), static function (string $item): bool {
            return trim($item) !== '';
        }));
    }

    private function isAiCandidateReviewEnabled(): bool
    {
        $value = strtolower($this->aiConfigSettingValue(
            'p4_candidate_review_enabled',
            (string) getenv(self::P4_AI_REVIEW_FEATURE_FLAG)
        ));

        return in_array($value, ['1', 'true', 'yes', 'on'], true);
    }

    /**
     * @return array<string, mixed>
     */
    private function loadAiCandidateReviewProviderConfig(array $post = []): array
    {
        $selection = $this->selectedAiProviderForP4($post);
        $selectedProvider = strtolower((string) ($selection['provider'] ?? ''));
        if (!empty($selection['cloud'])) {
            if (empty($selection['ready'])) {
                return [
                    'available' => false,
                    'reason' => (string) ($selection['blocked_reason'] ?? 'provider_not_ready'),
                    'provider' => $selectedProvider !== '' ? $selectedProvider : 'disabled',
                    'model' => (string) ($selection['model'] ?? ''),
                    'source' => 'cloud',
                    'cloud' => true,
                ];
            }

            return [
                'available' => true,
                'provider' => $selectedProvider,
                'model' => (string) ($selection['model'] ?? ''),
                'timeout_seconds' => max(15, min(120, (int) $this->runtimeConfigValue(self::P4_AI_REVIEW_TIMEOUT_SECONDS) ?: 75)),
                'source' => 'cloud',
                'cloud' => true,
            ];
        }

        $provider = $selectedProvider !== '' ? $selectedProvider : strtolower($this->aiConfigSettingValue('p4_candidate_review_provider', $this->runtimeConfigValue(self::P4_AI_REVIEW_PROVIDER)));
        if ($provider === '') {
            $provider = strtolower($this->runtimeConfigValue('AI_SUPERVISOR_PROVIDER'));
        }
        if ($provider !== 'ollama') {
            return [
                'available' => false,
                'reason' => $provider === '' ? 'provider_disabled' : 'provider_not_local_ollama',
                'provider' => $provider === '' ? 'disabled' : $provider,
                'model' => (string) ($selection['model'] ?? ''),
                'source' => 'local',
            ];
        }

        $model = $this->sanitizeModel((string) ($selection['model'] ?? ''));
        if ($model === '') {
            $model = $this->aiConfigSettingValue('p4_candidate_review_model', $this->runtimeConfigValue(self::P4_AI_REVIEW_MODEL));
        }
        if ($model === '') {
            $model = $this->runtimeConfigValue('AI_SUPERVISOR_MODEL');
        }
        if ($model === '') {
            return [
                'available' => false,
                'reason' => 'model_not_configured',
                'provider' => 'ollama',
                'model' => '',
                'source' => 'local',
            ];
        }

        $baseUrl = $this->runtimeConfigValue(self::P4_AI_REVIEW_BASE_URL);
        if ($baseUrl === '') {
            $baseUrl = $this->runtimeConfigValue('AI_SUPERVISOR_BASE_URL');
        }
        if ($baseUrl === '') {
            $baseUrl = 'http://127.0.0.1:11434';
        }
        if (!$this->isAllowedLocalOllamaUrl($baseUrl)) {
            return [
                'available' => false,
                'reason' => 'provider_url_not_allowed',
                'provider' => 'ollama',
                'model' => $model,
                'source' => 'local',
            ];
        }

        $timeout = (int) $this->runtimeConfigValue(self::P4_AI_REVIEW_TIMEOUT_SECONDS);
        if ($timeout <= 0) {
            $timeout = (int) $this->runtimeConfigValue('AI_SUPERVISOR_TIMEOUT_SECONDS');
        }
        $timeout = max(15, min(120, $timeout > 0 ? $timeout : 75));

        return [
            'available' => true,
            'provider' => 'ollama',
            'base_url' => rtrim($baseUrl, '/'),
            'model' => $model,
            'timeout_seconds' => $timeout,
            'source' => 'local',
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function loadOperationalProviderCatalog(): array
    {
        try {
            return (new AiConfigViewService($this->pluginConfigService))->getOperationalProviderCatalog();
        } catch (Throwable $exception) {
            error_log('[integaglpi][historical_mining_ui][provider_catalog] ' . $this->sanitizeLog($exception->getMessage()));

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
    private function selectedAiProviderForP4(array $post): array
    {
        $catalog = $this->loadOperationalProviderCatalog();
        $default = is_array($catalog['p4_default'] ?? null) ? $catalog['p4_default'] : ['provider' => 'ollama', 'model' => ''];
        $hasExplicitProvider = array_key_exists('ai_provider', $post);
        $hasExplicitModel = array_key_exists('ai_model', $post);
        $provider = strtolower(trim((string) ($hasExplicitProvider ? $post['ai_provider'] : ($default['provider'] ?? 'ollama'))));
        $model = $this->sanitizeModel((string) ($hasExplicitModel ? $post['ai_model'] : ($default['model'] ?? '')));
        if ($provider === 'local') {
            $provider = 'ollama';
        }

        if ($provider === '' || $provider === 'ollama') {
            $local = is_array($catalog['local_ollama_available'] ?? null) ? $catalog['local_ollama_available'] : [];
            $models = is_array($local['models'] ?? null) ? array_values(array_map('strval', $local['models'])) : [];
            if ($model === '') {
                $model = $this->sanitizeModel((string) ($local['default_model'] ?? ''));
            }
            $modelAllowed = $model !== '' && ($models === [] || in_array($model, $models, true));

            return [
                'provider' => 'ollama',
                'model' => $model,
                'label' => 'Ollama local',
                'ready' => $modelAllowed && !empty($local['ready']),
                'cloud' => false,
                'source' => 'local',
                'blocked_reason' => $modelAllowed && !empty($local['ready']) ? '' : 'local_model_not_available',
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
                    if ($hasExplicitProvider) {
                        return [
                            'provider' => $provider,
                            'model' => '',
                            'label' => (string) ($row['name'] ?? $provider),
                            'ready' => false,
                            'cloud' => true,
                            'source' => 'cloud',
                            'blocked_reason' => 'provider_selection_missing',
                            'last_test_status' => (string) ($row['last_test_status'] ?? 'not_tested'),
                        ];
                    }
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
                    'source' => 'cloud',
                    'blocked_reason' => $ready ? '' : ($modelAllowed ? (string) ($row['blocked_reason'] ?? 'provider_not_ready') : 'model_not_allowed'),
                    'last_test_status' => (string) ($row['last_test_status'] ?? 'not_tested'),
                ];
            }
        }

        return [
            'provider' => 'disabled',
            'model' => '',
            'label' => 'provider inválido',
            'ready' => false,
            'cloud' => false,
            'source' => 'local',
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

    private function aiConfigSettingValue(string $column, string $fallback): string
    {
        if (!preg_match('/^[a-z0-9_]+$/', $column) || !$this->pluginConfigService->isConfigured()) {
            return trim($fallback);
        }

        try {
            $pdo = ExternalDatabase::getConnection($this->pluginConfigService->getConnectionConfig());
            $exists = $pdo->prepare(
                'SELECT 1 FROM information_schema.columns
                  WHERE table_schema = current_schema()
                    AND table_name = :table
                    AND column_name = :column
                  LIMIT 1'
            );
            $exists->execute([
                ':table' => 'glpi_plugin_integaglpi_configs',
                ':column' => $column,
            ]);
            if (!$exists->fetchColumn()) {
                return trim($fallback);
            }

            $stmt = $pdo->prepare(
                'SELECT "' . $column . '" FROM public.glpi_plugin_integaglpi_configs WHERE context = :context LIMIT 1'
            );
            $stmt->execute([':context' => 'ai_settings']);
            $value = $stmt->fetchColumn();

            return $value === false || $value === null || trim((string) $value) === '' ? trim($fallback) : trim((string) $value);
        } catch (Throwable $exception) {
            error_log('[integaglpi][historical_mining_ui][ai_config_setting] ' . $this->sanitizeLog($exception->getMessage()));

            return trim($fallback);
        }
    }

    private function runtimeConfigValue(string $key): string
    {
        if (isset($_ENV[$key]) && is_scalar($_ENV[$key])) {
            return trim((string) $_ENV[$key]);
        }
        if (isset($_SERVER[$key]) && is_scalar($_SERVER[$key])) {
            return trim((string) $_SERVER[$key]);
        }

        $value = getenv($key);

        return is_string($value) ? trim($value) : '';
    }

    private function isAllowedLocalOllamaUrl(string $baseUrl): bool
    {
        $parts = parse_url($baseUrl);
        if (!is_array($parts)) {
            return false;
        }

        $scheme = strtolower((string) ($parts['scheme'] ?? ''));
        $host = strtolower((string) ($parts['host'] ?? ''));
        if ($scheme !== 'http' || $host === '') {
            return false;
        }

        return in_array($host, ['127.0.0.1', 'localhost', '::1', 'ollama', 'ollama-local'], true);
    }

    /**
     * @param array<string, mixed> $providerConfig
     * @param list<array<string, mixed>> $payloads
     * @return array{response_text: string, elapsed_ms: int}
     */
    private function callLocalOllamaForCandidateReview(array $providerConfig, array $payloads): array
    {
        $payloadJson = json_encode(['candidates' => $payloads], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?: '';
        if ($payloadJson === '' || $this->containsSensitiveData($payloadJson)) {
            throw new RuntimeException(__('P4 bloqueado: payload sanitizado contém dado sensível residual.', 'glpiintegaglpi'));
        }

        $prompt = $this->buildAiCandidateReviewPrompt($payloads);
        $request = [
            'model' => (string) ($providerConfig['model'] ?? ''),
            'prompt' => $prompt,
            'stream' => false,
            'format' => 'json',
            'options' => [
                'temperature' => 0.1,
                'num_predict' => 1200,
            ],
        ];
        $requestJson = json_encode($request, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        if (!is_string($requestJson) || $requestJson === '') {
            throw new RuntimeException(__('P4 bloqueado: falha ao serializar payload sanitizado.', 'glpiintegaglpi'));
        }
        if (!function_exists('curl_init')) {
            throw new RuntimeException(__('Provider local/Ollama indisponível: extensão cURL do PHP não está ativa.', 'glpiintegaglpi'));
        }

        $endpoint = rtrim((string) ($providerConfig['base_url'] ?? ''), '/') . '/api/generate';
        $startedAt = microtime(true);
        $handle = curl_init($endpoint);
        if ($handle === false) {
            throw new RuntimeException(__('Provider local/Ollama indisponível para revisão P4.', 'glpiintegaglpi'));
        }

        curl_setopt_array($handle, [
            CURLOPT_POST => true,
            CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
            CURLOPT_POSTFIELDS => $requestJson,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_TIMEOUT => (int) ($providerConfig['timeout_seconds'] ?? 75),
        ]);
        $raw = curl_exec($handle);
        $status = (int) curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
        $error = curl_error($handle);
        curl_close($handle);

        $elapsedMs = (int) round((microtime(true) - $startedAt) * 1000);
        if (!is_string($raw) || $raw === '') {
            error_log('[integaglpi][historical_mining_ui][p4_ai_review] provider_empty elapsed_ms=' . $elapsedMs . ' error=' . $this->sanitizeLog($error));
            throw new RuntimeException($error !== '' && preg_match('/timed out|timeout/i', $error) === 1 ? 'timeout' : 'provider_unreachable');
        }
        if ($status < 200 || $status >= 300) {
            error_log('[integaglpi][historical_mining_ui][p4_ai_review] provider_http_' . $status . ' elapsed_ms=' . $elapsedMs);
            throw new RuntimeException('provider_unreachable');
        }

        $decoded = json_decode($raw, true);
        if (!is_array($decoded)) {
            throw new RuntimeException('invalid_json');
        }
        $responseText = trim((string) ($decoded['response'] ?? ''));
        if ($responseText === '') {
            throw new RuntimeException('schema_invalid');
        }

        return [
            'response_text' => $responseText,
            'elapsed_ms' => $elapsedMs,
        ];
    }

    /**
     * @param array<string, mixed> $providerConfig
     * @param list<array<string, mixed>> $payloads
     * @return array{response_text: string, elapsed_ms: int}
     */
    private function callCloudProviderForCandidateReview(array $providerConfig, array $payloads): array
    {
        $payloadJson = json_encode(['candidates' => $payloads], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?: '';
        if ($payloadJson === '' || $this->containsSensitiveData($payloadJson)) {
            throw new RuntimeException('pii_blocked');
        }

        $prompt = $this->buildAiCandidateReviewPrompt($payloads);
        if ($this->containsSensitiveData($prompt)) {
            throw new RuntimeException('pii_blocked');
        }

        $result = (new AiSecretVaultService($this->pluginConfigService))->completeProvider(
            (string) ($providerConfig['provider'] ?? ''),
            (string) ($providerConfig['model'] ?? ''),
            $prompt,
            max(15000, min(120000, (int) ($providerConfig['timeout_seconds'] ?? 75) * 1000)),
            1200
        );
        $responseText = trim((string) ($result['response_text'] ?? ''));
        if ($responseText === '') {
            throw new RuntimeException('invalid_json');
        }
        if ($this->containsSensitiveData($responseText)) {
            throw new RuntimeException('pii_blocked');
        }

        return [
            'response_text' => $responseText,
            'elapsed_ms' => (int) ($result['elapsed_ms'] ?? 0),
        ];
    }

    /**
     * @param list<array<string, mixed>> $payloads
     */
    private function buildAiCandidateReviewPrompt(array $payloads): string
    {
        $payloadJson = json_encode(['candidates' => $payloads], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?: '{"candidates":[]}';

        return implode("\n", [
            'Voce e um revisor tecnico de base de conhecimento. Analise somente candidatos P3 sanitizados.',
            'Nunca use historico bruto, PII, anexos, midia, telefone, email, CPF/CNPJ, tokens ou senhas.',
            'Nao publique KB, nao altere ticket e nao execute comandos. Toda sugestao exige revisao humana.',
            'Responda somente JSON valido no formato:',
            '{"suggestions":[{"candidate_id":0,"candidate_key":"","recommended_action":"keep|improve|merge|discard","kb_title_suggested":"","kb_problem_summary":"","kb_resolution_steps":[""],"confidence":0.0,"reason":"","risks":[""],"missing_information":[""],"evidence_used":[""],"safety_flags":{"human_review_required":true,"auto_publish":false,"raw_history_included":false}}]}',
            'Regras: confidence abaixo de 0.70 deve destacar revisao humana; merge nunca e automatico; discard deve justificar; improve deve trazer uma versao sugerida de KB.',
            'Entrada sanitizada:',
            $payloadJson,
        ]);
    }

    /**
     * @param list<array<string, mixed>> $payloads
     * @return list<array<string, mixed>>
     */
    private function validateAiCandidateReviewResponse(string $responseText, array $payloads): array
    {
        $responseText = trim($responseText);
        $responseText = preg_replace('/^```(?:json)?\s*/i', '', $responseText) ?? $responseText;
        $responseText = preg_replace('/\s*```$/', '', $responseText) ?? $responseText;
        $decoded = json_decode($responseText, true);
        if (!is_array($decoded)) {
            throw new RuntimeException(__('A IA retornou JSON inválido para revisão P4.', 'glpiintegaglpi'));
        }

        $items = is_array($decoded['suggestions'] ?? null) ? $decoded['suggestions'] : $decoded;
        if (!is_array($items) || $items === []) {
            throw new RuntimeException(__('A IA não retornou sugestões P4 revisáveis.', 'glpiintegaglpi'));
        }

        $lookup = [];
        foreach ($payloads as $payload) {
            $key = (string) ($payload['candidate_key'] ?? '');
            $id = (int) ($payload['candidate_id'] ?? 0);
            if ($key !== '') {
                $lookup['key:' . $key] = $payload;
            }
            if ($id > 0) {
                $lookup['id:' . $id] = $payload;
            }
        }

        $suggestions = [];
        foreach ($items as $item) {
            if (!is_array($item)) {
                continue;
            }

            $candidateKey = $this->cleanIdentifier((string) ($item['candidate_key'] ?? ''));
            $candidateId = (int) ($item['candidate_id'] ?? 0);
            $sourcePayload = $candidateKey !== '' && isset($lookup['key:' . $candidateKey])
                ? $lookup['key:' . $candidateKey]
                : ($candidateId > 0 && isset($lookup['id:' . $candidateId]) ? $lookup['id:' . $candidateId] : null);
            if (!is_array($sourcePayload)) {
                continue;
            }

            $suggestion = $this->normalizeAiCandidateReviewSuggestion($item, $sourcePayload);
            $encoded = json_encode($suggestion, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?: '';
            if ($encoded === '' || $this->containsSensitiveData($encoded)) {
                throw new RuntimeException(__('P4 bloqueado: sugestão IA contém dado sensível residual.', 'glpiintegaglpi'));
            }
            $suggestions[] = $suggestion;
        }

        if ($suggestions === []) {
            throw new RuntimeException(__('A IA não retornou sugestão para candidatos P3 válidos.', 'glpiintegaglpi'));
        }

        return $suggestions;
    }

    /**
     * @param array<string, mixed> $item
     * @param array<string, mixed> $sourcePayload
     * @return array<string, mixed>
     */
    private function normalizeAiCandidateReviewSuggestion(array $item, array $sourcePayload): array
    {
        $fieldsSanitized = [];
        $action = strtolower(trim((string) ($item['recommended_action'] ?? 'improve')));
        if (!in_array($action, ['keep', 'improve', 'merge', 'discard'], true)) {
            $action = 'improve';
        }

        $safetyFlags = is_array($item['safety_flags'] ?? null) ? $item['safety_flags'] : [];
        if (!empty($safetyFlags['auto_publish'])) {
            throw new RuntimeException(__('P4 bloqueado: IA sugeriu publicação automática.', 'glpiintegaglpi'));
        }
        if (!empty($safetyFlags['raw_history_included'])) {
            throw new RuntimeException(__('P4 bloqueado: IA indicou uso de histórico bruto.', 'glpiintegaglpi'));
        }

        $confidence = $this->normalizeAiConfidence($item['confidence'] ?? 0);
        $steps = $this->sanitizeAiStringList($item['kb_resolution_steps'] ?? [], 8, 600, 'p4_ai_step', $fieldsSanitized);
        if ($steps === [] && is_array($sourcePayload['kb_resolution_steps'] ?? null)) {
            $steps = array_slice(array_map('strval', $sourcePayload['kb_resolution_steps']), 0, 8);
        }

        return [
            'candidate_id' => (int) ($sourcePayload['candidate_id'] ?? 0),
            'candidate_key' => (string) ($sourcePayload['candidate_key'] ?? ''),
            'run_id' => (string) ($sourcePayload['run_id'] ?? ''),
            'candidate_status' => (string) ($sourcePayload['status'] ?? ''),
            'recommended_action' => $action,
            'kb_title_before' => (string) ($sourcePayload['kb_title_suggested'] ?? ''),
            'kb_title_suggested' => $this->sanitizeExportText((string) ($item['kb_title_suggested'] ?? $sourcePayload['kb_title_suggested'] ?? ''), 180, 'p4_ai_title', $fieldsSanitized),
            'kb_problem_summary' => $this->sanitizeExportText((string) ($item['kb_problem_summary'] ?? $sourcePayload['kb_problem_summary'] ?? ''), 700, 'p4_ai_problem', $fieldsSanitized),
            'kb_resolution_steps' => $steps,
            'confidence' => $confidence,
            'confidence_below_threshold' => $confidence < self::P4_CONFIDENCE_THRESHOLD,
            'reason' => $this->sanitizeExportText((string) ($item['reason'] ?? ''), 700, 'p4_ai_reason', $fieldsSanitized),
            'risks' => $this->sanitizeAiStringList($item['risks'] ?? [], 5, 300, 'p4_ai_risk', $fieldsSanitized),
            'missing_information' => $this->sanitizeAiStringList($item['missing_information'] ?? [], 5, 300, 'p4_ai_missing', $fieldsSanitized),
            'evidence_used' => $this->sanitizeAiStringList($item['evidence_used'] ?? [], 5, 220, 'p4_ai_evidence', $fieldsSanitized),
            'human_review_required' => true,
            'auto_publish' => false,
            'merge_not_applied' => $action === 'merge',
            'improve_not_applied' => $action === 'improve',
            'fields_sanitized' => array_values(array_unique($fieldsSanitized)),
            'safety_flags' => [
                'human_review_required' => true,
                'auto_publish' => false,
                'raw_history_included' => false,
                'p4_no_auto_publish' => true,
                'p4_sanitized_candidate_only' => true,
            ],
        ];
    }

    private function normalizeAiConfidence($value): int
    {
        $confidence = is_numeric($value) ? (float) $value : 0.0;
        if ($confidence > 0 && $confidence <= 1) {
            $confidence *= 100;
        }

        return max(0, min(100, (int) round($confidence)));
    }

    /**
     * @param mixed $value
     * @return list<string>
     */
    private function sanitizeAiStringList($value, int $maxItems, int $itemLimit, string $field, array &$fieldsSanitized): array
    {
        $items = is_array($value) ? $value : [$value];
        $clean = [];
        foreach ($items as $item) {
            $text = $this->sanitizeExportText((string) $item, $itemLimit, $field, $fieldsSanitized);
            if ($text !== '') {
                $clean[] = $text;
            }
            if (count($clean) >= $maxItems) {
                break;
            }
        }

        return $clean;
    }

    /**
     * @param list<array<string, mixed>> $suggestions
     */
    private function persistAiCandidateReviewSuggestions(string $runId, array $suggestions, int $userId): int
    {
        if (!$this->pluginConfigService->isConfigured()) {
            return 0;
        }

        $pdo = ExternalDatabase::getConnection($this->pluginConfigService->getConnectionConfig());
        $exists = $pdo->query("SELECT to_regclass('public.glpi_plugin_integaglpi_kb_candidate_reviews')");
        if ($exists === false || !$exists->fetchColumn()) {
            return 0;
        }

        $statement = $pdo->prepare(
            "INSERT INTO public.glpi_plugin_integaglpi_kb_candidate_reviews (
                candidate_id,
                action,
                reviewer_id,
                notes,
                previous_status,
                new_status,
                created_at
            ) VALUES (
                :candidate_id,
                'edit_note',
                :reviewer_id,
                :notes,
                :previous_status,
                :new_status,
                NOW()
            )"
        );

        $persisted = 0;
        foreach ($suggestions as $suggestion) {
            $notes = [
                'source' => 'ai_p4_candidate_review',
                'run_id' => $runId,
                'recommended_action' => (string) ($suggestion['recommended_action'] ?? ''),
                'confidence' => (int) ($suggestion['confidence'] ?? 0),
                'confidence_below_threshold' => (bool) ($suggestion['confidence_below_threshold'] ?? true),
                'human_review_required' => true,
                'auto_publish' => false,
                'suggestion' => $suggestion,
            ];
            $encodedNotes = json_encode($notes, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?: '{}';
            if ($this->containsSensitiveData($encodedNotes)) {
                throw new RuntimeException(__('P4 bloqueado: revisão IA contém dado sensível residual.', 'glpiintegaglpi'));
            }

            $statement->execute([
                ':candidate_id' => (int) ($suggestion['candidate_id'] ?? 0),
                ':reviewer_id' => $userId > 0 ? $userId : null,
                ':notes' => $encodedNotes,
                ':previous_status' => (string) ($suggestion['candidate_status'] ?? ''),
                ':new_status' => (string) ($suggestion['candidate_status'] ?? ''),
            ]);
            $persisted++;
        }

        return $persisted;
    }

    /**
     * @param array<string, mixed> $upload
     * @param array<string, mixed> $post
     * @return array<string, mixed>
     */
    private function payloadForUpload(array $upload, array $post, int $userId): array
    {
        $path = (string) ($upload['path'] ?? '');
        if ($path === '' || !is_file($path) || !$this->isPathInside($path, $this->uploadDir())) {
            throw new RuntimeException(__('Upload expirado ou inválido. Reenvie o arquivo JSONL.', 'glpiintegaglpi'));
        }

        $content = file_get_contents($path);
        if ($content === false || trim($content) === '') {
            throw new RuntimeException(__('Arquivo JSONL vazio ou indisponível.', 'glpiintegaglpi'));
        }

        return [
            'filename' => (string) ($upload['filename'] ?? 'history.jsonl'),
            'jsonl_base64' => base64_encode($content),
            'window_start' => $this->cleanDate((string) ($post['window_start'] ?? '')),
            'window_end' => $this->cleanDate((string) ($post['window_end'] ?? '')),
            'max_rows' => max(1, min(5000, (int) ($post['max_rows'] ?? 1000))),
            'requested_by' => $userId,
            'source_origin' => (string) ($upload['source'] ?? 'upload'),
            'file_id_hash' => hash('sha256', (string) ($upload['upload_id'] ?? '')),
        ];
    }

    /**
     * @param array<string, mixed> $upload
     */
    private function rememberUpload(array $upload): void
    {
        $this->cleanupExpiredUploads();
        if (!isset($_SESSION['integaglpi_ai_mining_uploads']) || !is_array($_SESSION['integaglpi_ai_mining_uploads'])) {
            $_SESSION['integaglpi_ai_mining_uploads'] = [];
        }

        $_SESSION['integaglpi_ai_mining_uploads'][(string) $upload['upload_id']] = $upload;
    }

    /**
     * @param array<string, mixed> $filters
     */
    private function rememberExportPreview(string $token, array $filters): void
    {
        if (!isset($_SESSION['integaglpi_ai_mining_export_previews']) || !is_array($_SESSION['integaglpi_ai_mining_export_previews'])) {
            $_SESSION['integaglpi_ai_mining_export_previews'] = [];
        }

        $_SESSION['integaglpi_ai_mining_export_previews'][$token] = [
            'filters' => $filters,
            'created_at' => time(),
        ];
    }

    /**
     * @param array<string, mixed> $filters
     */
    private function isRememberedExportPreview(string $token, array $filters): bool
    {
        $token = preg_match('/^[a-f0-9]{64}$/', $token) ? $token : '';
        if ($token === '') {
            return false;
        }

        $previews = is_array($_SESSION['integaglpi_ai_mining_export_previews'] ?? null) ? $_SESSION['integaglpi_ai_mining_export_previews'] : [];
        $preview = is_array($previews[$token] ?? null) ? $previews[$token] : null;
        if ($preview === null || (time() - (int) ($preview['created_at'] ?? 0)) > 1800) {
            return false;
        }

        return hash_equals($token, $this->exportPreviewToken($filters));
    }

    /**
     * @param array<string, mixed> $filters
     */
    private function exportPreviewToken(array $filters): string
    {
        return hash('sha256', 'integaglpi_glpi_jsonl_export_preview_v1|' . (json_encode($filters, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?: ''));
    }

    /**
     * @return array<string, mixed>
     */
    private function loadRememberedUpload(string $uploadId): array
    {
        $uploadId = $this->cleanIdentifier($uploadId);
        $uploads = is_array($_SESSION['integaglpi_ai_mining_uploads'] ?? null) ? $_SESSION['integaglpi_ai_mining_uploads'] : [];
        $upload = is_array($uploads[$uploadId] ?? null) ? $uploads[$uploadId] : null;
        if ($upload === null) {
            throw new RuntimeException(__('Upload não encontrado na sessão. Refaça o dry-run.', 'glpiintegaglpi'));
        }
        if ((int) ($upload['expires_at'] ?? 0) > 0 && time() > (int) $upload['expires_at']) {
            $path = (string) ($upload['path'] ?? '');
            if ($path !== '' && $this->isPathInside($path, $this->uploadDir())) {
                @unlink($path);
            }
            unset($_SESSION['integaglpi_ai_mining_uploads'][$uploadId]);
            throw new RuntimeException(__('Upload expirado pela política de retenção. Gere ou envie o JSONL novamente.', 'glpiintegaglpi'));
        }

        return $upload;
    }

    /**
     * @return array<string, mixed>
     */
    private function loadGeneratedUploadForAction(string $uploadId, int $userId, string $action): array
    {
        try {
            $upload = $this->loadRememberedUpload($uploadId);
        } catch (RuntimeException $exception) {
            $this->auditExpiredOrNotFound($uploadId, $userId, $action);
            throw $exception;
        }

        if (($upload['source'] ?? '') !== 'glpi_export') {
            $this->auditExpiredOrNotFound($uploadId, $userId, $action);
            throw new RuntimeException(__('Arquivo gerado inválido. Gere novamente o JSONL a partir do GLPI.', 'glpiintegaglpi'));
        }

        return $upload;
    }

    private function auditExpiredOrNotFound(string $uploadId, int $userId, string $action): void
    {
        $uploadId = $this->cleanIdentifier($uploadId);
        $this->audit('HISTORICAL_JSONL_EXPIRED_OR_NOT_FOUND', [
            'glpi_user_id' => $userId,
            'upload_id_hash' => $uploadId !== '' ? hash('sha256', $uploadId) : '',
            'action' => $this->sanitizeLog($action),
            'source' => 'glpi_export',
        ]);
    }

    private function safeDownloadFilename(string $filename): string
    {
        $filename = basename($filename);
        $filename = preg_replace('/[^A-Za-z0-9._-]+/', '-', $filename) ?? 'glpi-history.jsonl';
        $filename = trim($filename, '.-');
        if ($filename === '') {
            $filename = 'glpi-history.jsonl';
        }
        if (!preg_match('/\.jsonl$/i', $filename)) {
            $filename .= '.jsonl';
        }

        return $filename;
    }

    /**
     * @template T
     * @param callable(): T $work
     * @return T
     */
    private function withFileLock(string $key, callable $work)
    {
        $dir = $this->lockDir();
        if (!is_dir($dir) && !mkdir($dir, 0700, true) && !is_dir($dir)) {
            throw new RuntimeException(__('Não foi possível preparar lock operacional.', 'glpiintegaglpi'));
        }

        $lockFile = $dir . DIRECTORY_SEPARATOR . hash('sha256', $key) . '.lock';
        if (is_file($lockFile) && (time() - (int) filemtime($lockFile)) > self::LOCK_TTL_SECONDS) {
            @unlink($lockFile);
        }

        $handle = fopen($lockFile, 'c');
        if ($handle === false) {
            throw new RuntimeException(__('Não foi possível criar lock operacional.', 'glpiintegaglpi'));
        }

        try {
            if (!flock($handle, LOCK_EX | LOCK_NB)) {
                throw new RuntimeException(__('Operação já em andamento para o mesmo arquivo/filtro. Aguarde finalizar.', 'glpiintegaglpi'));
            }
            ftruncate($handle, 0);
            fwrite($handle, (string) time());

            return $work();
        } finally {
            @flock($handle, LOCK_UN);
            @fclose($handle);
        }
    }

    private function cleanupExpiredUploads(): void
    {
        $uploads = is_array($_SESSION['integaglpi_ai_mining_uploads'] ?? null) ? $_SESSION['integaglpi_ai_mining_uploads'] : [];
        foreach ($uploads as $uploadId => $upload) {
            if (!is_array($upload)) {
                unset($_SESSION['integaglpi_ai_mining_uploads'][$uploadId]);
                continue;
            }
            $expiresAt = (int) ($upload['expires_at'] ?? 0);
            if ($expiresAt > 0 && time() > $expiresAt) {
                $path = (string) ($upload['path'] ?? '');
                if ($path !== '' && $this->isPathInside($path, $this->uploadDir())) {
                    @unlink($path);
                }
                unset($_SESSION['integaglpi_ai_mining_uploads'][$uploadId]);
            }
        }
    }

    /**
     * @param array<string, mixed> $payload
     */
    private function audit(string $eventType, array $payload): void
    {
        if (!$this->pluginConfigService->isConfigured()) {
            return;
        }

        try {
            $pdo = ExternalDatabase::getConnection($this->pluginConfigService->getConnectionConfig());
            $exists = $pdo->query("SELECT to_regclass('public.glpi_plugin_integaglpi_audit_events')");
            if ($exists === false || !$exists->fetchColumn()) {
                return;
            }

            $statement = $pdo->prepare(
                "INSERT INTO public.glpi_plugin_integaglpi_audit_events (
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
                    'success',
                    'info',
                    'HistoricalMiningUiService',
                    CAST(:payload AS jsonb),
                    NOW()
                )"
            );
            $statement->execute([
                ':correlation_id' => 'historical_mining_ui:' . bin2hex(random_bytes(8)),
                ':event_type' => $eventType,
                ':payload' => json_encode($this->sanitizeAuditPayload($payload), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?: '{}',
            ]);
        } catch (Throwable $exception) {
            error_log('[integaglpi][historical_mining_ui][audit] ' . $this->sanitizeLog($exception->getMessage()));
        }
    }

    /**
     * @param array<string, mixed> $payload
     * @return array<string, mixed>
     */
    private function sanitizeAuditPayload(array $payload): array
    {
        unset($payload['jsonl_content'], $payload['sample_jsonl'], $payload['path']);

        return $payload;
    }

    /**
     * @param array{status?: int, body?: mixed, success?: bool} $response
     * @return array<string, mixed>
     */
    private function clientError(array $response, string $fallback): array
    {
        $body = is_array($response['body'] ?? null) ? $response['body'] : [];
        $message = trim((string) ($body['message'] ?? ''));

        return [
            'type' => 'danger',
            'message' => $message !== '' ? $this->publicError($message) : $fallback,
            'mining_result' => $body,
        ];
    }

    /**
     * @param array<string, mixed> $body
     */
    private function rowsProcessedFromMiningBody(array $body): int
    {
        $summary = is_array($body['summary'] ?? null) ? $body['summary'] : [];

        return max(0, (int) ($summary['rows_processed'] ?? 0));
    }

    private function uploadDir(): string
    {
        return rtrim(sys_get_temp_dir(), DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . 'integaglpi_ai_mining';
    }

    private function lockDir(): string
    {
        return rtrim(sys_get_temp_dir(), DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . 'integaglpi_ai_mining_locks';
    }

    private function isPathInside(string $path, string $directory): bool
    {
        $realPath = realpath($path);
        $realDirectory = realpath($directory);
        if ($realPath === false || $realDirectory === false) {
            return false;
        }

        return strpos($realPath . DIRECTORY_SEPARATOR, rtrim($realDirectory, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR) === 0;
    }

    private function cleanIdentifier(string $value): string
    {
        $value = trim($value);

        return preg_match('/^[a-z0-9:_-]{8,100}$/i', $value) ? $value : '';
    }

    private function cleanDate(string $value): string
    {
        $value = trim($value);
        return preg_match('/^\d{4}-\d{2}-\d{2}(?:[T ][0-9:.+-Z]*)?$/', $value) ? $value : '';
    }

    private function p4ProviderErrorType(string $message): string
    {
        $normalized = strtolower(trim($message));
        if (in_array($normalized, ['provider_url_not_allowed', 'provider_unreachable', 'provider_unavailable', 'provider_disabled', 'provider_not_local_ollama', 'provider_not_ready', 'provider_selection_missing', 'model_not_allowed', 'local_model_not_available', 'model_not_configured', 'timeout', 'invalid_json', 'schema_invalid', 'low_confidence', 'pii_blocked', 'secret_not_configured', 'secret_vault_locked'], true)) {
            return $normalized;
        }
        if (strpos($normalized, 'dado sensível') !== false || strpos($normalized, 'pii') !== false) {
            return 'pii_blocked';
        }
        if (strpos($normalized, 'confidence_below_threshold') !== false || strpos($normalized, 'low_confidence') !== false || strpos($normalized, 'confiança abaixo') !== false) {
            return 'low_confidence';
        }
        if (strpos($normalized, 'json') !== false) {
            return 'invalid_json';
        }
        if (strpos($normalized, 'timeout') !== false || strpos($normalized, 'timed out') !== false) {
            return 'timeout';
        }
        if (strpos($normalized, 'schema') !== false || strpos($normalized, 'sugest') !== false) {
            return 'schema_invalid';
        }

        return 'provider_unreachable';
    }

    private function publicError(string $message): string
    {
        if ($message === 'provider_url_not_allowed') {
            return __('provider_url_not_allowed: base_url do provider P4 não está na allowlist local.', 'glpiintegaglpi');
        }
        if ($message === 'provider_unreachable') {
            return __('provider_unreachable: Provider local/Ollama indisponível para revisão P4.', 'glpiintegaglpi');
        }
        if ($message === 'provider_unavailable') {
            return __('provider_unavailable: Provider local/Ollama de revisão IA não está disponível. P1/P2/P3 e revisão manual permanecem operacionais.', 'glpiintegaglpi');
        }
        if ($message === 'provider_disabled') {
            return __('provider_disabled: revisão IA P4 está sem provider configurado; revisão manual permanece disponível.', 'glpiintegaglpi');
        }
        if ($message === 'provider_not_local_ollama') {
            return __('provider_not_local_ollama: P4 real permite apenas provider local/Ollama nesta etapa.', 'glpiintegaglpi');
        }
        if ($message === 'provider_not_ready') {
            return __('provider_not_ready: provider/modelo selecionado não passou gates, Secret Vault e teste sintético.', 'glpiintegaglpi');
        }
        if ($message === 'provider_selection_missing') {
            return __('provider_selection_missing: selecione provider e modelo antes de executar P4 cloud.', 'glpiintegaglpi');
        }
        if ($message === 'model_not_allowed') {
            return __('model_not_allowed: modelo selecionado não está no catálogo allowlist do provider.', 'glpiintegaglpi');
        }
        if ($message === 'local_model_not_available') {
            return __('local_model_not_available: modelo local selecionado não está disponível no catálogo Ollama.', 'glpiintegaglpi');
        }
        if ($message === 'secret_not_configured') {
            return __('secret_not_configured: provider cloud selecionado não possui chave ativa no Secret Vault.', 'glpiintegaglpi');
        }
        if ($message === 'secret_vault_locked') {
            return __('secret_vault_locked: Secret Vault está bloqueado; configure a chave mestra via ambiente/ops.', 'glpiintegaglpi');
        }
        if ($message === 'model_not_configured') {
            return __('model_not_configured: configure um modelo local/Ollama para executar P4 real.', 'glpiintegaglpi');
        }
        if ($message === 'timeout') {
            return __('timeout: Provider local/Ollama demorou mais que o esperado na revisão P4.', 'glpiintegaglpi');
        }
        if ($message === 'invalid_json') {
            return __('invalid_json: Provider local/Ollama respondeu em formato inválido.', 'glpiintegaglpi');
        }
        if ($message === 'schema_invalid') {
            return __('schema_invalid: IA não retornou sugestão P4 no schema esperado.', 'glpiintegaglpi');
        }
        if ($message === 'low_confidence') {
            return __('low_confidence: sugestão P4 abaixo do limite; revisão humana obrigatória.', 'glpiintegaglpi');
        }
        if ($message === 'pii_blocked') {
            return __('pii_blocked: P4 bloqueado por dado sensível residual no payload ou sugestão.', 'glpiintegaglpi');
        }

        return mb_substr($this->sanitizeLog($message), 0, 240);
    }

    private function sanitizeLog(string $message): string
    {
        $message = preg_replace('/(password|senha|token|secret|bearer|api_key)\s*[:=]\s*\S+/i', '$1=[redacted]', $message) ?? '';
        $message = preg_replace('/[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}/i', '[email]', $message) ?? '';
        $message = preg_replace('/\b(?:\+?\d[\d .()\-]{7,}\d)\b/', '[telefone]', $message) ?? '';

        return trim($message);
    }
}
