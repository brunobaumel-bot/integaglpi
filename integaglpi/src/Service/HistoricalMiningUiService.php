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
        $upload['dry_run_token'] = (string) ($body['dry_run_token'] ?? '');
        $upload['window_start'] = (string) ($payload['window_start'] ?? '');
        $upload['window_end'] = (string) ($payload['window_end'] ?? '');
        $upload['max_rows'] = (int) ($payload['max_rows'] ?? 1000);
        $this->rememberUpload($upload);

        return [
            'type' => 'success',
            'message' => __('Dry-run concluído. Revise o preview antes de executar a mineração real.', 'glpiintegaglpi'),
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

        return $this->withFileLock('p2_execute:' . (string) $upload['upload_id'], function () use ($upload, $post, $userId, $dryRunToken): array {
            $payload = $this->payloadForUpload($upload, $post, $userId);
            $payload['dry_run_token'] = $dryRunToken;
            $response = $this->client->executeHistoricalMining($payload);
            if (empty($response['success'])) {
                return $this->clientError($response, __('Execução da mineração falhou.', 'glpiintegaglpi'));
            }

            $body = is_array($response['body'] ?? null) ? $response['body'] : [];
            $summary = is_array($body['summary'] ?? null) ? $body['summary'] : [];
            $this->audit('HISTORICAL_MINING_EXECUTED', [
                'glpi_user_id' => $userId,
                'upload_id_hash' => hash('sha256', (string) $upload['upload_id']),
                'run_id' => (string) ($summary['run_id'] ?? ''),
                'rows_processed' => $summary['rows_processed'] ?? null,
                'rows_rejected' => $summary['rows_rejected'] ?? null,
            ]);

            return [
                'type' => 'success',
                'message' => __('Mineração executada. O run_id está disponível para gerar candidatos de KB.', 'glpiintegaglpi'),
                'upload' => $upload,
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

            $upload = $this->storeGeneratedJsonl((string) $export['jsonl_content'], (int) $export['total_exportable']);
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
                'export_preview' => $export + [
                    'preview_token' => $token,
                    'filters' => $filters,
                ],
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
            $upload['dry_run_token'] = (string) ($body['dry_run_token'] ?? '');
            $upload['window_start'] = (string) ($payload['window_start'] ?? '');
            $upload['window_end'] = (string) ($payload['window_end'] ?? '');
            $upload['max_rows'] = (int) ($payload['max_rows'] ?? 1000);
            $this->rememberUpload($upload);

            return [
                'type' => 'success',
                'message' => __('Dry-run do JSONL gerado concluído. Revise o preview antes da execução real.', 'glpiintegaglpi'),
                'upload' => $upload,
                'export_upload' => $upload,
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
        ];
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
        return preg_match('/^[a-z0-9:_-]{8,100}$/i', $value) ? $value : '';
    }

    private function cleanDate(string $value): string
    {
        $value = trim($value);
        return preg_match('/^\d{4}-\d{2}-\d{2}(?:[T ][0-9:.+-Z]*)?$/', $value) ? $value : '';
    }

    private function publicError(string $message): string
    {
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
