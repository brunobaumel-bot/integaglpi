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
     * Local-first "Ajuda Inteligente": NEVER returns a raw error to the technician.
     *
     * Flow (degrades gracefully at every step):
     *   1. Search the native GLPI KB in PHP (visibility-filtered) — shown even if Node is down.
     *   2. Ask Node (best-effort) for checklist + suggested questions + the cloud gate.
     *   3. Merge: local articles take precedence; Node enriches; local defaults fill any gap.
     *
     * Read-only: never mutates the ticket, never sends WhatsApp, never publishes KB,
     * never calls the cloud (that stays behind explicit consent in externalResearch()).
     *
     * @return array<string, mixed>
     */
    public function localFirstAssist(int $ticketId, string $summary): array
    {
        // 1. Local native KB search (PHP-side; never leaves the page; no cloud).
        $localArticles = [];
        try {
            $native = new NativeKnowledgeBaseService();
            foreach ($native->searchVisibleArticles($summary, 5) as $a) {
                $localArticles[] = [
                    'glpiKnowbaseitemId' => (int) ($a['article_id'] ?? 0),
                    'title'              => (string) ($a['title'] ?? ''),
                    'confidence'         => 0.6,
                    'category'           => (string) ($a['category'] ?? ''),
                    'excerpt'            => (string) ($a['excerpt'] ?? ''),
                    'internal_url'       => (string) ($a['internal_url'] ?? ''),
                    'source_label'       => (string) ($a['source_label'] ?? 'Base de Conhecimento GLPI'),
                ];
            }
        } catch (\Throwable $e) {
            error_log('[integaglpi][smart_help] native KB error: ' . mb_substr($e->getMessage(), 0, 180, 'UTF-8'));
        }

        // 2. Ask Node for checklist + suggested questions + cloud gate (best-effort).
        $node = $this->assist($ticketId, $summary, $localArticles);
        $nodeOk = ((int) ($node['http_code'] ?? 0)) === 200;

        // 3. Merge: local articles win; Node enriches; local defaults fill the gaps.
        $relatedArticles = $localArticles;
        if ($relatedArticles === [] && is_array($node['relatedArticles'] ?? null)) {
            $relatedArticles = $node['relatedArticles'];
        }

        $checklist = (is_array($node['checklist'] ?? null) && $node['checklist'] !== [])
            ? $node['checklist']
            : $this->defaultChecklist();

        $questions = $this->defaultQuestions();
        if (is_array($node['suggestedQuestions'] ?? null) && $node['suggestedQuestions'] !== []) {
            $questions = $node['suggestedQuestions'];
        } elseif (is_array($node['suggested_questions'] ?? null) && $node['suggested_questions'] !== []) {
            $questions = $node['suggested_questions'];
        }

        $cloudOffer = ['available' => false, 'reason' => ''];
        if (is_array($node['cloudOffer'] ?? null)) {
            $cloudOffer = $node['cloudOffer'];
        } elseif (is_array($node['cloud_offer'] ?? null)) {
            $cloudOffer = $node['cloud_offer'];
        }

        $localResolved = $relatedArticles !== [];
        $message = '';
        if (!$nodeOk) {
            $message = 'Assistente em modo local: o serviço de IA não respondeu agora. '
                . 'Veja a base de conhecimento local e o checklist abaixo.';
        } elseif (!$localResolved) {
            $message = 'Nenhum artigo local de alta confiança. '
                . 'Use o checklist e as perguntas sugeridas para diagnosticar.';
        }

        // ALWAYS ok:true — the panel must show something useful, never a raw error.
        return [
            'ok'                => true,
            'localResolved'     => $localResolved,
            'relatedArticles'   => $relatedArticles,
            'checklist'         => $checklist,
            'suggestedQuestions' => $questions,
            'cloudOffer'        => $cloudOffer,
            'degraded'          => !$nodeOk,
            'message'           => $message,
            'read_only'         => true,
        ];
    }

    /**
     * Local diagnostic checklist used when Node is unavailable or returns nothing.
     * @return list<string>
     */
    private function defaultChecklist(): array
    {
        return [
            'Confirme o problema exato relatado e desde quando ocorre.',
            'Verifique o escopo: afeta um único usuário ou vários (host/rede)?',
            'Reproduza a falha e registre a mensagem de erro exata.',
            'Cheque mudanças recentes (atualização, instalação, política, senha).',
            'Teste uma solução de contorno conhecida antes de escalar.',
        ];
    }

    /**
     * Local questions to ask the requester when there is no high-confidence article.
     * @return list<string>
     */
    private function defaultQuestions(): array
    {
        return [
            'Quando o problema começou e o que mudou nesse período?',
            'A falha acontece sempre ou de forma intermitente?',
            'Aparece alguma mensagem de erro? Qual é o texto exato?',
            'Outras pessoas ou equipamentos apresentam o mesmo problema?',
        ];
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
