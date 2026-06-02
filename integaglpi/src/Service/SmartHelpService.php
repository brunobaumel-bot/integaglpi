<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi\Service;

use GlpiPlugin\Integaglpi\Plugin;

/**
 * PHP consumer of the Node AI/KB endpoints, for the ticket-side Smart Help panel.
 *
 * Phase: integaglpi_ai_kb_ecosystem_ui_and_wiring_001.
 *
 * Local-first flow:
 *   1. The panel/PHP searches the native GLPI KB (KbSearchService) — articles shown
 *      immediately without leaving the page.
 *   2. "Ajuda Inteligente" calls assist(): PHP passes the native articles as context;
 *      Node returns checklist, suggested questions and the cloud-offer gate.
 *   3. "Pesquisar fora" calls externalResearch() with explicit human consent.
 *   4. "Ajudou/Não ajudou" calls recordFeedback().
 *   5. "Virar artigo?" (on solved) calls suggestKb().
 *
 * Safety: read-only; never mutates the ticket, never sends WhatsApp, never publishes
 * KB, never calls cloud without explicit consent. Secrets (auth key) are never echoed.
 */
final class SmartHelpService
{
    private const PATH_SMART_HELP        = '/internal/glpi/ai/smart-help';
    private const PATH_EXTERNAL_RESEARCH = '/internal/glpi/ai/external-research/dynamic';
    private const PATH_KB_FEEDBACK       = '/internal/glpi/ai/kb-feedback';
    private const PATH_COACHING_CHECKLIST = '/internal/glpi/ai/coaching/checklist';
    private const PATH_COACHING_SUGGEST_KB = '/internal/glpi/ai/coaching/suggest-kb';
    private const TIMEOUT_SECONDS = 8;

    private PluginConfigService $config;

    public function __construct(?PluginConfigService $config = null)
    {
        $this->config = $config ?? new PluginConfigService();
    }

    /** Only technicians/supervisors (plugin READ) see the panel. */
    public static function canViewPanel(): bool
    {
        return Plugin::canRead();
    }

    /**
     * @param list<array<string, mixed>> $nativeArticles
     * @return array<string, mixed>
     */
    public function assist(int $ticketId, string $summary, array $nativeArticles = []): array
    {
        return $this->postJson(self::PATH_SMART_HELP, [
            'ticket_id' => $ticketId,
            'summary'   => mb_substr($summary, 0, 4000, 'UTF-8'),
            'native_articles' => $nativeArticles,
        ]);
    }

    /**
     * Cloud research — ONLY with explicit human consent.
     * @return array<string, mixed>
     */
    public function externalResearch(int $ticketId, string $context, bool $humanConsent): array
    {
        if (!$humanConsent) {
            return ['ok' => false, 'status' => 'no_consent', 'message' => 'Confirmação do técnico necessária.'];
        }
        return $this->postJson(self::PATH_EXTERNAL_RESEARCH, [
            'ticket_id'     => $ticketId,
            'profile_id'    => (int) ($_SESSION['glpiactiveprofile']['id'] ?? 0),
            'context'       => mb_substr($context, 0, 6000, 'UTF-8'),
            'human_consent' => true,
        ]);
    }

    /**
     * @return array<string, mixed>
     */
    public function recordFeedback(int $ticketId, int $kbCandidateId, bool $helpful, string $feedbackText = ''): array
    {
        return $this->postJson(self::PATH_KB_FEEDBACK, [
            'ticket_id'       => $ticketId,
            'kb_candidate_id' => $kbCandidateId > 0 ? $kbCandidateId : null,
            'technician_id'   => Plugin::getCurrentUserId(),
            'helpful'         => $helpful,
            'feedback_text'   => $feedbackText !== '' ? mb_substr($feedbackText, 0, 500, 'UTF-8') : null,
        ]);
    }

    /**
     * @return array<string, mixed>
     */
    public function getCoachingChecklist(int $ticketId): array
    {
        $query = http_build_query([
            'ticket_id'     => $ticketId,
            'technician_id' => Plugin::getCurrentUserId(),
        ]);
        return $this->getJson(self::PATH_COACHING_CHECKLIST . '?' . $query);
    }

    /**
     * Post-resolution: suggest turning the ticket into a KB article (manual review).
     * @return array<string, mixed>
     */
    public function suggestKb(int $ticketId): array
    {
        return $this->postJson(self::PATH_COACHING_SUGGEST_KB, ['ticket_id' => $ticketId]);
    }

    /**
     * @param array<string, mixed> $payload
     * @return array<string, mixed>
     */
    private function postJson(string $path, array $payload): array
    {
        return $this->request('POST', $path, $payload);
    }

    /**
     * @return array<string, mixed>
     */
    private function getJson(string $path): array
    {
        return $this->request('GET', $path, null);
    }

    /**
     * @param array<string, mixed>|null $payload
     * @return array<string, mixed>
     */
    private function request(string $method, string $path, ?array $payload): array
    {
        $base = rtrim($this->config->getIntegrationServiceUrl(), '/');
        $authKey = $this->config->getIntegrationAuthKey();
        if ($base === '' || $authKey === '') {
            return ['ok' => false, 'status' => 'unconfigured', 'message' => 'Integração não configurada.'];
        }

        $ch = curl_init($base . $path);
        if ($ch === false) {
            return ['ok' => false, 'status' => 'failed', 'message' => 'Falha ao preparar requisição.'];
        }

        $headers = [
            'Accept: application/json',
            'Authorization: Bearer ' . $authKey,   // never logged
        ];
        $opts = [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CUSTOMREQUEST  => $method,
            CURLOPT_TIMEOUT        => self::TIMEOUT_SECONDS,
            CURLOPT_SSL_VERIFYPEER => true,
        ];
        if ($payload !== null) {
            $headers[] = 'Content-Type: application/json';
            $opts[CURLOPT_POSTFIELDS] = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        }
        $opts[CURLOPT_HTTPHEADER] = $headers;
        curl_setopt_array($ch, $opts);

        $body = curl_exec($ch);
        $httpCode = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlError = curl_error($ch);
        curl_close($ch);

        if ($body === false) {
            error_log('[integaglpi][smart_help] transport error: ' . mb_substr(strip_tags($curlError), 0, 180, 'UTF-8'));
            return ['ok' => false, 'status' => 'failed', 'message' => 'Serviço de IA inacessível.'];
        }

        $decoded = is_string($body) ? json_decode($body, true) : null;
        if (!is_array($decoded)) {
            return ['ok' => false, 'status' => 'failed', 'message' => 'Resposta inválida do serviço de IA.', 'http_code' => $httpCode];
        }
        $decoded['http_code'] = $httpCode;
        return $decoded;
    }
}
