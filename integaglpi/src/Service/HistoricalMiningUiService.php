<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi\Service;

use RuntimeException;
use Throwable;

final class HistoricalMiningUiService
{
    private const MAX_UPLOAD_BYTES = 5242880;
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
        return [
            'flash' => $flash,
            'configured' => $this->pluginConfigService->isConfigured(),
            'selected_run_id' => $this->cleanIdentifier((string) ($query['run_id'] ?? '')),
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

        $action = trim((string) ($post['action'] ?? ''));
        try {
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

        $payload = $this->payloadForUpload($upload, $post, $userId);
        $payload['dry_run_token'] = $dryRunToken;
        $response = $this->client->executeHistoricalMining($payload);
        if (empty($response['success'])) {
            return $this->clientError($response, __('Execução da mineração falhou.', 'glpiintegaglpi'));
        }

        $body = is_array($response['body'] ?? null) ? $response['body'] : [];

        return [
            'type' => 'success',
            'message' => __('Mineração executada. O run_id está disponível para gerar candidatos de KB.', 'glpiintegaglpi'),
            'upload' => $upload,
            'mining_result' => $body,
        ];
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

        $response = $this->client->generateKbCandidatesFromHistory([
            'run_id' => $runId,
            'max_candidates' => max(1, min(50, (int) ($post['max_candidates'] ?? 20))),
            'min_confidence' => max(1, min(100, (int) ($post['min_confidence'] ?? 65))),
            'dry_run' => false,
            'requested_by' => $userId,
        ]);
        if (empty($response['success'])) {
            return $this->clientError($response, __('Geração de candidatos falhou.', 'glpiintegaglpi'));
        }

        return [
            'type' => 'success',
            'message' => __('Candidatos de KB gerados para revisão humana. Nenhuma publicação automática foi executada.', 'glpiintegaglpi'),
            'candidate_result' => is_array($response['body'] ?? null) ? $response['body'] : [],
        ];
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
        if ($path === '' || !is_file($path) || strpos(realpath($path) ?: '', realpath($this->uploadDir()) ?: '___') !== 0) {
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
        if (!isset($_SESSION['integaglpi_ai_mining_uploads']) || !is_array($_SESSION['integaglpi_ai_mining_uploads'])) {
            $_SESSION['integaglpi_ai_mining_uploads'] = [];
        }

        $_SESSION['integaglpi_ai_mining_uploads'][(string) $upload['upload_id']] = $upload;
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

        return $upload;
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
