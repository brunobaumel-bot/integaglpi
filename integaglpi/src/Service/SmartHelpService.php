<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi\Service;

use GlpiPlugin\Integaglpi\External\ExternalDatabase;
use GlpiPlugin\Integaglpi\Plugin;
use PDO;

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
    private const PATH_TECHNICAL_SUMMARY = '/internal/glpi/ai/technical-summary';
    private const PATH_EXTERNAL_RESEARCH = '/internal/glpi/ai/external-research/dynamic';
    private const PATH_EXTERNAL_PREVIEW  = '/internal/glpi/ai/external-research/preview';
    private const PATH_KB_FEEDBACK       = '/internal/glpi/ai/kb-feedback';
    private const PATH_COACHING_CHECKLIST = '/internal/glpi/ai/coaching/checklist';
    private const PATH_COACHING_SUGGEST_KB = '/internal/glpi/ai/coaching/suggest-kb';
    private const TIMEOUT_SECONDS = 8;
    private const LOCAL_CONFIDENCE_THRESHOLD = 0.8;
    private const MIN_KB_DISPLAY_CONFIDENCE = 0.55;

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
     * Step 1 of the guided flow: summary only.
     *
     * No KB search, no SmartHelp enrichment, no cloud, no ticket mutation.
     *
     * @return array<string, mixed>
     */
    public function summarizeTicket(int $ticketId, string $summary, bool $wantAiSummary = true): array
    {
        $technicalSummary = $this->buildTechnicalSummary($summary);
        $summarySource = 'fallback';
        $summaryErrorType = '';

        if ($wantAiSummary) {
            $sanitizedContext = $this->sanitizeContext($summary);
            if ($sanitizedContext === '') {
                $summaryErrorType = 'missing_context';
            } else {
                $ai = $this->technicalSummaryAi($ticketId, $sanitizedContext);
                $aiSummary = trim((string) ($ai['technical_summary'] ?? $ai['technicalSummary'] ?? ''));
                $aiOk = (($ai['ok'] ?? false) === true) && $aiSummary !== '';
                if ($aiOk) {
                    $technicalSummary = $this->enforceSummaryContract($aiSummary, $sanitizedContext);
                    $summarySource = 'local_ai';
                } else {
                    $summaryErrorType = (string) ($ai['error_type'] ?? 'provider_unavailable');
                }
            }
        }

        return [
            'ok' => true,
            'localResolved' => false,
            'relatedArticles' => [],
            'checklist' => [],
            'suggestedQuestions' => [],
            'cloudOffer' => ['available' => false, 'reason' => 'Execute a busca local antes de pedir ajuda externa.'],
            'localSuggestion' => null,
            'local_suggestion' => null,
            'technicalSummary' => $technicalSummary,
            'technical_summary' => $technicalSummary,
            'summarySource' => $summarySource,
            'summary_source' => $summarySource,
            'summaryErrorType' => $summaryErrorType,
            'summary_error_type' => $summaryErrorType,
            'schema044Status' => self::migration044SchemaStatus(),
            'degraded' => $summaryErrorType !== '',
            'message' => '',
            'read_only' => true,
        ];
    }

    public function buildTicketContextSummary(\Ticket $ticket): string
    {
        $ticketId = (int) $ticket->getID();
        $messageContext = $this->buildRecentConversationMessageContext($ticketId);
        if ($messageContext !== '') {
            return $messageContext;
        }

        $name = (string) ($ticket->fields['name'] ?? '');
        $content = trim(strip_tags((string) ($ticket->fields['content'] ?? '')));
        return mb_substr(trim($name . '. ' . $content), 0, 2000, 'UTF-8');
    }

    private function buildRecentConversationMessageContext(int $ticketId): string
    {
        if ($ticketId <= 0 || !$this->config->isConfigured()) {
            return '';
        }

        try {
            $pdo = ExternalDatabase::getConnection($this->config->getConnectionConfig());
            $statement = $pdo->prepare(
                <<<SQL
                WITH latest_conversation AS (
                    SELECT id
                    FROM glpi_plugin_integaglpi_conversations
                    WHERE glpi_ticket_id = :ticket_id
                    ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
                    LIMIT 1
                )
                SELECT direction, message_text, created_at
                FROM (
                    SELECT m.direction, m.message_text, m.created_at, m.id
                    FROM glpi_plugin_integaglpi_messages m
                    JOIN latest_conversation c ON c.id = m.conversation_id
                    WHERE m.message_text IS NOT NULL
                      AND trim(m.message_text) <> ''
                    ORDER BY m.created_at DESC NULLS LAST, m.id DESC
                    LIMIT 8
                ) recent
                ORDER BY created_at ASC NULLS LAST, id ASC
                SQL
            );
            $statement->bindValue(':ticket_id', $ticketId, PDO::PARAM_INT);
            $statement->execute();
            $rows = $statement->fetchAll(PDO::FETCH_ASSOC);
            if (!is_array($rows) || $rows === []) {
                return '';
            }

            $lines = [];
            foreach ($rows as $row) {
                $text = $this->sanitizeContext((string) ($row['message_text'] ?? ''));
                if ($text === '') {
                    continue;
                }
                $direction = strtolower(trim((string) ($row['direction'] ?? '')));
                $speaker = $direction === 'outbound' ? 'Técnico' : 'Cliente';
                $lines[] = $speaker . ': ' . $text;
            }

            if ($lines === []) {
                return '';
            }

            return mb_substr("Mensagens recentes da conversa atual:\n" . implode("\n", $lines), 0, 2000, 'UTF-8');
        } catch (\Throwable $exception) {
            error_log('[integaglpi][smart_help][context] ' . mb_substr($exception->getMessage(), 0, 160, 'UTF-8'));
            return '';
        }
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
    public function localFirstAssist(int $ticketId, string $summary, bool $wantAiSummary = false, bool $wantLocalAiSuggestion = false): array
    {
        // Deterministic, PII-free baseline summary (no GPU). Always available.
        $technicalSummary = $this->buildTechnicalSummary($summary);
        $summarySource = 'fallback';
        $summaryErrorType = '';

        // LOCAL-AI summary ONLY on explicit manual request (ai_summary=1). The auto-run
        // never sets $wantAiSummary, so it never hits the model — no GPU load on load.
        if ($wantAiSummary) {
            $sanitizedContext = $this->sanitizeContext($summary);
            if ($sanitizedContext === '') {
                $summaryErrorType = 'missing_context';
            } else {
                $ai = $this->technicalSummaryAi($ticketId, $sanitizedContext);
                $aiSummary = trim((string) ($ai['technical_summary'] ?? $ai['technicalSummary'] ?? ''));
                $aiOk = (($ai['ok'] ?? false) === true) && $aiSummary !== '';
                if ($aiOk) {
                    // Re-sanitize and enforce the summary-only contract defensively.
                    $technicalSummary = $this->enforceSummaryContract($aiSummary, $sanitizedContext);
                    $summarySource = 'local_ai';
                } else {
                    $summaryErrorType = (string) ($ai['error_type'] ?? 'provider_unavailable');
                }
            }
        }

        $schema044Status = self::migration044SchemaStatus();

        // 1. Local native KB search (PHP-side; never leaves the page; no cloud).
        $localArticles = [];
        $searchContext = $technicalSummary !== '' ? $technicalSummary : $summary;
        try {
            $native = new NativeKnowledgeBaseService();
            foreach ($native->searchVisibleArticles($searchContext, 5) as $a) {
                $relevance = $this->evaluateKbRelevance($searchContext, $a);
                if ($relevance === null || (float) $relevance['confidence'] < self::MIN_KB_DISPLAY_CONFIDENCE) {
                    continue;
                }
                $localArticles[] = [
                    'glpiKnowbaseitemId' => (int) ($a['article_id'] ?? 0),
                    'title'              => (string) ($a['title'] ?? ''),
                    'confidence'         => (float) $relevance['confidence'],
                    'category'           => (string) ($a['category'] ?? ''),
                    'excerpt'            => (string) ($a['excerpt'] ?? ''),
                    'internal_url'       => (string) ($a['internal_url'] ?? ''),
                    'source_label'       => (string) ($a['source_label'] ?? 'Base de Conhecimento GLPI'),
                    'confidence_reason'  => (string) $relevance['reason'],
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

        $localResolved = $this->hasTrustedArticle($relatedArticles) || (($node['localResolved'] ?? false) === true);
        $message = '';
        if (!$nodeOk) {
            $message = 'Assistente em modo local: o serviço de IA não respondeu agora. '
                . 'Veja a base de conhecimento local e o checklist abaixo.';
        } elseif (!$localResolved) {
            $message = 'Nenhum artigo local de alta confiança. '
                . 'Use o checklist e as perguntas sugeridas para diagnosticar.';
        }

        $localSuggestion = null;
        if (!$localResolved && $wantLocalAiSuggestion) {
            $localSuggestion = $this->localAiSuggestion($ticketId, $technicalSummary !== '' ? $technicalSummary : $summary);
        }

        // ALWAYS ok:true — the panel must show something useful, never a raw error.
        return [
            'ok'                => true,
            'localResolved'     => $localResolved,
            'relatedArticles'   => $relatedArticles,
            'checklist'         => $checklist,
            'suggestedQuestions' => $questions,
            'cloudOffer'        => $cloudOffer,
            'localSuggestion'   => $localSuggestion,
            'local_suggestion'  => $localSuggestion,
            'technicalSummary'   => $technicalSummary,
            'technical_summary'  => $technicalSummary,
            'summarySource'      => $summarySource,
            'summary_source'     => $summarySource,
            'summaryErrorType'   => $summaryErrorType,
            'summary_error_type' => $summaryErrorType,
            'kbSearchSource'     => [
                'source' => 'php_native_glpi_kb',
                'label' => 'Base de Conhecimento GLPI local',
                'node_endpoint' => 'GLPI_KB_SEARCH_URL',
            ],
            'schema044Status'    => $schema044Status,
            'degraded'          => !$nodeOk,
            'message'           => $message,
            'read_only'         => true,
        ];
    }

    /**
     * @param list<array<string, mixed>> $articles
     */
    private function hasTrustedArticle(array $articles): bool
    {
        foreach ($articles as $article) {
            $confidence = (float) ($article['confidence'] ?? $article['score'] ?? 0);
            if ($confidence >= self::LOCAL_CONFIDENCE_THRESHOLD) {
                return true;
            }
        }

        return false;
    }

    /**
     * Safe homologation gate: checks the committed additive migration file only.
     * It never queries or mutates any database.
     *
     * @return array{ok:bool, migration:string, mode:string, missing:list<string>}
     */
    public static function migration044SchemaStatus(): array
    {
        $path = dirname(__DIR__, 3) . DIRECTORY_SEPARATOR
            . 'integration-service' . DIRECTORY_SEPARATOR
            . 'schema-migrations' . DIRECTORY_SEPARATOR
            . '044_ai_kb_ecosystem_reengineered.sql';
        $required = [
            'confidence_reason',
            'difficulty_level',
            'target_audience',
            'duplicate_of',
            'cluster_id',
            'glpi_plugin_integaglpi_kb_article_helpfulness',
            'glpi_plugin_integaglpi_cloud_compliance_audit',
        ];

        $missing = $required;
        if (is_readable($path)) {
            $sql = (string) file_get_contents($path);
            $missing = [];
            foreach ($required as $token) {
                if (stripos($sql, $token) === false) {
                    $missing[] = $token;
                }
            }
        }

        return [
            'ok' => $missing === [],
            'migration' => '044_ai_kb_ecosystem_reengineered',
            'mode' => 'file_check_only_no_db_mutation',
            'missing' => $missing,
        ];
    }

    /**
     * Sanitizes ticket text (removes PII) and returns it for use as AI context or
     * as the technician-facing technical summary. Local-first, deterministic, no
     * external/GPU call: safe to run on every panel auto-load.
     */
    private function sanitizeContext(string $text): string
    {
        $clean = html_entity_decode(strip_tags($text), ENT_QUOTES | ENT_HTML5, 'UTF-8');

        // High-confidence secrets / identifiers first (specific placeholders, not over-broad).
        $clean = preg_replace('/\b(?:senha|password|token|api[_-]?key|app[_-]?secret|secret|bearer)\s*[:=]\s*\S+/iu', '[credencial removida]', $clean) ?? $clean;
        $clean = preg_replace('/https?:\/\/\S*\?\S+/u', '[url removida]', $clean) ?? $clean;

        $pii = [
            '/[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}/iu'          => '[email removido]',
            '/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/u'                  => '[documento removido]',
            '/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/u'          => '[documento removido]',
            '/(?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?9?\d{4}[-\s]?\d{4}/u' => '[telefone removido]',
            // Empresa com sufixo societário (LTDA/ME/EPP/S.A./EIRELI).
            '/\b[A-ZÀ-Ý][\wÀ-ÿ&.\-]*(?:\s+[A-ZÀ-Ý][\wÀ-ÿ&.\-]*){0,4}\s+(?:LTDA|ME|EPP|EIRELI|S\.?\s?A\.?)\b/u' => '[empresa removida]',
            // Ticket/chamado id rotulado.
            '/\b(?:ticket|chamado|protocolo)\s*(?:id|n[ºo°]|#|number)?\s*[:#]?\s*\d{2,}\b/iu' => '[chamado removido]',
            // Patrimônio / etiqueta / tombamento rotulado.
            '/\b(?:patrim[oô]nio|etiqueta|tombamento|asset(?:\s*tag)?|tag)\s*[:#]?\s*[A-Z0-9][A-Z0-9\-\/]{1,}\b/iu' => '[patrimonio removido]',
            // Nome próprio após rótulo (cliente/contato/solicitante/usuário/Sr./Sra.).
            '/\b(?:nome|cliente|contato|solicitante|usu[áa]rio|funcion[áa]rio|sr|sra|sr\.|sra\.)\s*[:\-]?\s*[A-ZÀ-Ý][a-zà-ÿ]+(?:\s+[A-ZÀ-Ý][a-zà-ÿ]+){0,3}/u' => '[nome removido]',
        ];
        $clean = preg_replace(array_keys($pii), array_values($pii), $clean) ?? $clean;

        // Collapse repeated placeholders ("[email removido] [email removido]" -> one).
        $clean = preg_replace('/(\[[^\]]+removid[ao]\])(\s+\1)+/u', '$1', $clean) ?? $clean;
        $clean = $this->neutralizeSmartHelpPiiText($clean);
        $clean = preg_replace('/\s+/u', ' ', $clean) ?? $clean;

        return trim($clean);
    }

    /**
     * Rewrites residual person/company-labelled prose into neutral technical text.
     * Keeps technical signals such as "sync do AD" while removing placeholders and
     * client/company constructions before the text reaches SmartHelp UI/cloud preview.
     */
    private function neutralizeSmartHelpPiiText(string $text): string
    {
        $clean = $text;

        $clean = preg_replace('/\bNome\s+informado\s*[:\-]?\s*[^,.;]+[.,;:]?/iu', ' ', $clean) ?? $clean;
        $clean = preg_replace('/\b(?:ticket|chamado)\s*#?\s*\d{3,}\b/iu', 'chamado informado', $clean) ?? $clean;
        $clean = preg_replace('/\b(?:patrim[oô]nio|etiqueta|tombamento|asset(?:\s*tag)?|tag)\s*[:#]?\s*[A-Z0-9][A-Z0-9\-\/]{1,}\b/iu', 'patrimonio informado', $clean) ?? $clean;
        $clean = preg_replace('/\[[^\[\]]*(?:nome|empresa|telefone|email|e-mail|removid[ao])[^\[\]]*\]/iu', ' ', $clean) ?? $clean;
        $clean = preg_replace('/\[[^\[\]]*(?:nome|empresa|telefone|email|e-mail|removid[ao])[^\[\]]*\]/iu', ' ', $clean) ?? $clean;
        $clean = preg_replace('/\b(?:nome|contato|solicitante|t[eé]cnico|tecnico)\s*:\s*:?\s*[A-ZÀ-Ý][\p{L}\'-]+(?:\s+[A-ZÀ-Ý][\p{L}\'-]+){0,3}[.,;:]?/iu', ' ', $clean) ?? $clean;
        $clean = preg_replace('/^\s*O\s+(?:cliente|contato|solicitante)\s*:\s*/iu', 'Foi relatado ', $clean) ?? $clean;
        $clean = preg_replace('/\b(?:cliente|contato|solicitante)\s*:\s*/iu', ' ', $clean) ?? $clean;

        $companyPatterns = [
            '/\b(?:representante|cliente|solicitante|contato)\s+d[aeo]\s+empresa\s+[^,.;:]+/iu',
            '/\bd[aeo]\s+empresa\s+[^,.;:]+/iu',
            '/\bcliente\s+d[aeo]\s+[^,.;:]+/iu',
            '/\bempresa\s+informada\s*[:\-]?\s*[^,.;:]+/iu',
            '/\bempresa\s+[A-ZÀ-Ý][\p{L}\p{N}.&\- ]{1,60}/u',
            '/\b[A-ZÀ-Ý][\p{L}\p{N}]+\s+inform[aá]tica\b/iu',
        ];
        foreach ($companyPatterns as $pattern) {
            $clean = preg_replace($pattern, 'em ambiente corporativo', $clean) ?? $clean;
        }
        $clean = preg_replace('/\b(?:resumo|relato|descri[cç][aã]o)\s*:\s*[A-ZÀ-Ý][\p{L}\'-]+(?:\s+[A-ZÀ-Ý][\p{L}\'-]+){1,3}\s+(?=em ambiente corporativo\b)/iu', 'Resumo: ', $clean) ?? $clean;

        $subjectPatterns = [
            '/^\s*[OA]\s+(?:\[[^\]]+\]|[A-ZÀ-Ý][\p{L}\'-]+(?:\s+[A-ZÀ-Ý][\p{L}\'-]+){0,3})\s*,?\s*/u',
            '/^\s*(?:O\s+)?cliente\s+d[aeo]\s+[^,.;:]+\s*/iu',
            '/^\s*(?:O\s+)?cliente\s+(?:\[[^\]]+\]|[A-ZÀ-Ý][\p{L}\'-]+(?:\s+[A-ZÀ-Ý][\p{L}\'-]+){0,3})\s*,?\s*/u',
        ];
        foreach ($subjectPatterns as $pattern) {
            $clean = preg_replace($pattern, 'Foi relatado ', $clean) ?? $clean;
        }
        $clean = preg_replace('/\b(?:nome|cliente|contato|solicitante|t[eé]cnico|tecnico)\s*:\s*(?=[,.;:"\'“”]|$)/iu', ' ', $clean) ?? $clean;

        $clean = preg_replace('/\brealizou\s+um\s+teste\s+d[eo]\s+sistema\s+via\s+WhatsApp,?\s*/iu', '', $clean) ?? $clean;
        $clean = preg_replace('/\brelatando\s+que\s+/iu', 'foi relatado que ', $clean) ?? $clean;
        $clean = preg_replace('/\brelata\s+(?:um\s+)?/iu', 'foi relatado ', $clean) ?? $clean;
        $clean = preg_replace('/\best[áa]\s+recebendo\s+(?:a\s+)?mensagem\s+d[eo]\s+erro/iu', 'foi informada mensagem de erro', $clean) ?? $clean;
        $clean = preg_replace('/\bFoi relatado\s+foi relatado\b/iu', 'Foi relatado', $clean) ?? $clean;

        if (!preg_match('/^\s*(?:Foi relatado|Foi informado|O solicitante relatou)\b/iu', $clean)) {
            $clean = 'Foi relatado ' . $clean;
        }

        $clean = preg_replace('/\bsync\s+d[eo]\s+ad\b/iu', 'sync do AD', $clean) ?? $clean;
        $clean = preg_replace('/\bactive\s+directory\b/iu', 'Active Directory', $clean) ?? $clean;
        $clean = preg_replace('/\s{2,}/u', ' ', $clean) ?? $clean;
        $clean = preg_replace('/\s+([,.;:])/u', '$1', $clean) ?? $clean;
        $clean = preg_replace('/([,;:])\1+/u', '$1', $clean) ?? $clean;
        $clean = preg_replace('/^[\s,;:.]+/u', '', $clean) ?? $clean;

        return trim($clean);
    }

    /**
     * Removes structural label boilerplate and duplicated sentences so the deterministic
     * summary never produces "Problema relatado: Problema relatado" when the input is
     * already structured. Returns clean technical prose.
     */
    private function stripSummaryBoilerplate(string $text): string
    {
        // Drop leading structural labels anywhere they appear (idempotency).
        $text = preg_replace('/(?:^|\n|\.\s*)\s*(?:Problema relatado|Contexto t[eé]cnico|Pr[oó]xima a[cç][aã]o sugerida)\s*:\s*/iu', ' ', $text) ?? $text;
        $text = preg_replace('/\s+/u', ' ', $text) ?? $text;
        $text = trim($text);

        // De-duplicate consecutive identical sentences.
        $sentences = preg_split('/(?<=[.!?])\s+/u', $text) ?: [$text];
        $seen = [];
        $unique = [];
        foreach ($sentences as $s) {
            $key = mb_strtolower(trim($s));
            if ($key === '' || isset($seen[$key])) {
                continue;
            }
            $seen[$key] = true;
            $unique[] = trim($s);
        }

        return trim(implode(' ', $unique));
    }

    private function enforceSummaryContract(string $candidate, string $sourceContext): string
    {
        $clean = $this->stripSummaryBoilerplate($this->sanitizeContext($candidate));
        $forbidden = '/Foi relatado\s+O usuário|O usuário foi relatado|Para solucionar|consulte o artigo|Base de Conhecimento|técnico\s+Bruno|Bruno\s+Baumel|logon|login|servidor|Active Directory|banco de dados/iu';
        if ($clean === '' || preg_match($forbidden, $clean) === 1) {
            return $this->buildTechnicalSummary($sourceContext);
        }

        return $this->buildTechnicalSummary($clean);
    }

    /**
     * Builds a SHORT, structured, PII-free technical summary for the technician.
     * Deterministic (no cloud, no GPU) so it is safe on every auto-load. The first
     * sentences become the "Problema"; the remainder feeds "Contexto"; a generic,
     * non-mutating next-action hint is appended. This is the local-first baseline;
     * an optional local-AI rewrite can replace it on explicit user action (see
     * CURSOR_REVIEW_NOTES — deferred, requires runtime validation against Ollama).
     */
    /**
     * Calls the LOCAL-AI technical summary endpoint (Ollama via Node). Context must be
     * already PII-sanitized by the caller. Short timeout; the endpoint always returns a
     * parseable JSON envelope, so failures degrade to the deterministic fallback.
     *
     * @return array<string, mixed>
     */
    private function technicalSummaryAi(int $ticketId, string $sanitizedContext): array
    {
        return $this->postJson(self::PATH_TECHNICAL_SUMMARY, [
            'ticket_id' => $ticketId,
            'context'   => mb_substr($sanitizedContext, 0, 4000, 'UTF-8'),
        ]);
    }

    /**
     * Local AI suggestion for the guided "Busca local" step only.
     *
     * @return array<string, mixed>
     */
    private function localAiSuggestion(int $ticketId, string $summary): array
    {
        $sanitizedContext = $this->sanitizeContext($summary);
        if ($sanitizedContext === '') {
            return $this->fallbackLocalSuggestion('missing_context');
        }

        $prompt = implode("\n", [
            'Gere uma sugestão técnica de resolução para o atendimento abaixo.',
            'Use apenas IA local. Não inclua dados pessoais. Não assuma fatos não descritos.',
            'Retorne passos curtos para o técnico validar antes de responder ao cliente.',
            '',
            $sanitizedContext,
        ]);

        $ai = $this->technicalSummaryAi($ticketId, $prompt);
        $content = trim((string) ($ai['technical_summary'] ?? $ai['technicalSummary'] ?? ''));
        if (($ai['ok'] ?? false) === true && $content !== '') {
            return [
                'source' => 'local_ai',
                'source_label' => 'IA local',
                'title' => 'Sugestão IA local — valide antes de aplicar',
                'content' => $this->sanitizeContext($content),
                'unverified' => true,
                'error_type' => '',
            ];
        }

        return $this->fallbackLocalSuggestion((string) ($ai['error_type'] ?? 'provider_unavailable'));
    }

    /**
     * @return array<string, mixed>
     */
    private function fallbackLocalSuggestion(string $errorType): array
    {
        return [
            'source' => 'local_ai',
            'source_label' => 'IA local',
            'title' => 'Sugestão IA local — valide antes de aplicar',
            'content' => 'IA local indisponível. Use o checklist e as perguntas sugeridas para validar o diagnóstico antes de responder ao cliente.',
            'unverified' => true,
            'error_type' => $errorType,
            'fallback' => true,
        ];
    }

    private function buildTechnicalSummary(string $summary): string
    {
        // PII-sanitize, then strip any existing labels/duplication for idempotency.
        $clean = $this->extractClientOnlyContext($this->stripSummaryBoilerplate($this->sanitizeContext($summary)));
        if ($clean === '') {
            return '';
        }

        $normalized = $this->normalizeForRelevance($clean);
        if ($this->isGenericTestContext($normalized)) {
            return 'Foi informado apenas um teste do sistema, sem descrição de problema técnico. Faltam detalhes sobre o erro, sistema afetado, mensagem exibida e impacto.';
        }
        if ($this->isWindowsActivationContext($normalized)) {
            return 'Foi relatado problema no Windows com mensagem solicitando ativação. Faltam detalhes sobre a mensagem exata, edição do Windows, tipo de licença, conta Microsoft/domínio corporativo, conectividade e mudanças recentes no equipamento.';
        }

        $sentences = preg_split('/(?<=[.!?])\s+/u', $clean) ?: [$clean];
        $prose = trim(implode(' ', array_slice($sentences, 0, 2)));
        $prose = preg_replace('/\b(?:Para solucionar|Solução|Procedimento|Base de Conhecimento|consulte o artigo)[^.?!]*(?:[.?!]|$)/iu', '', $prose) ?? $prose;
        $prose = trim($prose);
        if ($prose === '') {
            $prose = 'Foi relatado problema técnico sem detalhes suficientes.';
        }
        if (!preg_match('/\bFaltam detalhes\b/iu', $prose)) {
            $prose .= ' Faltam detalhes sobre mensagem de erro, impacto, escopo e quando começou.';
        }

        return mb_substr($this->stripSummaryBoilerplate($prose), 0, 600, 'UTF-8');
    }

    private function extractClientOnlyContext(string $text): string
    {
        if (!str_contains($text, 'Cliente:')) {
            return $text;
        }

        $clientLines = [];
        foreach (preg_split('/\r?\n|(?=\b(?:Cliente|Técnico):)/u', $text) ?: [] as $line) {
            $line = trim($line);
            if (preg_match('/^Cliente:\s*(.+)$/iu', $line, $matches) === 1) {
                $clientLines[] = trim((string) $matches[1]);
            }
        }

        return $clientLines !== [] ? implode(' ', $clientLines) : $text;
    }

    /**
     * @param array<string, mixed> $article
     * @return array{confidence: float, reason: string}|null
     */
    private function evaluateKbRelevance(string $context, array $article): ?array
    {
        $contextTokens = $this->technicalTokens($context);
        if (count($contextTokens) < 2 || $this->isGenericTestContext($this->normalizeForRelevance($context))) {
            return null;
        }

        $articleText = implode(' ', [
            (string) ($article['title'] ?? ''),
            (string) ($article['category'] ?? ''),
            (string) ($article['excerpt'] ?? ''),
        ]);
        $articleNorm = $this->normalizeForRelevance($articleText);
        if ($this->hasConflictingKbDomain($this->normalizeForRelevance($context), $articleNorm)) {
            return null;
        }

        $matched = [];
        foreach ($contextTokens as $token) {
            if (str_contains($articleNorm, $token)) {
                $matched[] = $token;
            }
        }
        $overlap = count(array_unique($matched));
        if ($overlap < 2) {
            return null;
        }

        $confidence = min(0.95, 0.45 + ($overlap * 0.12));
        return [
            'confidence' => $confidence,
            'reason' => $confidence >= self::LOCAL_CONFIDENCE_THRESHOLD
                ? 'Correspondência contextual forte com o resumo atual'
                : 'Referência local candidata; baixa confiança, valide antes de usar',
        ];
    }

    private function hasConflictingKbDomain(string $context, string $article): bool
    {
        if ($this->isWindowsActivationContext($context)) {
            return preg_match('/\b(logon|login|servidor|dominio|active directory|ad)\b/u', $article) === 1;
        }

        return false;
    }

    /**
     * @return list<string>
     */
    private function technicalTokens(string $value): array
    {
        $normalized = $this->normalizeForRelevance($value);
        $tokens = preg_split('/\s+/u', $normalized) ?: [];
        $stop = [
            'foi', 'relatado', 'informado', 'problema', 'mensagem', 'sistema', 'usuario', 'cliente',
            'preciso', 'ajuda', 'com', 'para', 'sobre', 'detalhes', 'faltam', 'exata', 'quando',
            'impacto', 'escopo', 'tecnico', 'atendimento', 'teste',
        ];
        $kept = [];
        foreach ($tokens as $token) {
            if (mb_strlen($token, 'UTF-8') < 4 || in_array($token, $stop, true)) {
                continue;
            }
            $kept[$token] = true;
            if ($token === 'ativar' || $token === 'ativacao' || $token === 'ativa') {
                $kept['ativacao'] = true;
                $kept['licenca'] = true;
            }
        }

        return array_keys($kept);
    }

    private function isGenericTestContext(string $normalized): bool
    {
        $tokens = array_values(array_filter(preg_split('/\s+/u', $normalized) ?: []));
        return count($tokens) <= 4 && in_array('teste', $tokens, true);
    }

    private function isWindowsActivationContext(string $normalized): bool
    {
        return str_contains($normalized, 'windows')
            && preg_match('/\b(ativacao|ativar|ativa|licenca|license)\b/u', $normalized) === 1;
    }

    private function normalizeForRelevance(string $value): string
    {
        $value = mb_strtolower($value, 'UTF-8');
        $ascii = function_exists('iconv') ? iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $value) : false;
        if (is_string($ascii)) {
            $value = $ascii;
        }
        $value = preg_replace('/[^a-z0-9]+/i', ' ', $value) ?? $value;
        $value = preg_replace('/\s+/u', ' ', $value) ?? $value;

        return trim($value);
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
     * Step 1 of the two-step cloud flow: sanitize the ticket context and return a
     * preview WITHOUT calling the cloud. The Node sanitizer strips PII; we surface the
     * sanitized text + detected kinds + safe_for_cloud so the operator can review before
     * any send. No consent required here (nothing leaves to the cloud). The raw context
     * is never returned to the panel — only the sanitized text.
     *
     * @return array<string, mixed>
     */
    public function prepareExternalContext(int $ticketId, string $context): array
    {
        return $this->postJson(self::PATH_EXTERNAL_PREVIEW, [
            'ticket_id' => $ticketId,
            'context'   => mb_substr($context, 0, 6000, 'UTF-8'),
        ]);
    }

    /**
     * Cloud research — ONLY with explicit human consent.
     * @return array<string, mixed>
     */
    /**
     * @param array<string, string> $providerSelection
     * @return array<string, mixed>
     */
    public function externalResearch(int $ticketId, string $context, bool $humanConsent, string $conversationId = '', array $providerSelection = []): array
    {
        if (!$humanConsent) {
            return ['ok' => false, 'status' => 'no_consent', 'message' => 'Confirmação do técnico necessária.'];
        }

        try {
            $externalResearchService = new ExternalResearchService($this->config);
            $research = $externalResearchService->confirmInlineResearch(
                mb_substr($context, 0, 6000, 'UTF-8'),
                Plugin::getCurrentUserId(),
                $providerSelection
            );
            $result = is_array($research['research_result'] ?? null) ? $research['research_result'] : [];
            $status = (string) ($result['status'] ?? ($research['type'] ?? 'failed'));
            $message = (string) ($research['message'] ?? '');
            $summary = trim((string) ($result['summary'] ?? ''));
            $viewModel = ExternalResearchService::externalHelpViewModel($summary !== '' ? $summary : $result, [
                'status' => $status,
                'source_type' => $summary !== '' ? 'external_ai_no_sources' : '',
            ]);
            $historyItem = null;
            if (($research['type'] ?? '') === 'success') {
                $historyItem = $externalResearchService->recordExternalHelpHistory(
                    $ticketId,
                    $conversationId,
                    $context,
                    $research,
                    $viewModel,
                    Plugin::getCurrentUserId()
                );
            }
            $history = $externalResearchService->listExternalHelpHistory($ticketId, $conversationId);

            return [
                'ok' => ($research['type'] ?? '') === 'success',
                'status' => $status,
                'message' => $summary !== '' ? $summary : $message,
                'summary' => $summary,
                'external_help_view_model' => $viewModel,
                'history_item' => $historyItem,
                'history' => $history,
                'history_persisted' => $historyItem !== null,
                'provider' => (string) ($result['provider'] ?? ''),
                'model' => (string) ($result['model'] ?? ''),
                'source' => (string) ($result['source'] ?? 'external_research_controlled_php'),
                'request_id' => (string) ($research['request_id'] ?? ''),
                'no_auto_send' => true,
                'no_auto_publish' => true,
                'read_only' => true,
            ];
        } catch (\Throwable $exception) {
            error_log('[integaglpi][smart_help][external_research_php] ' . mb_substr($exception->getMessage(), 0, 160, 'UTF-8'));

            return [
                'ok' => false,
                'status' => 'failed',
                'message' => __('Pesquisa externa indisponível no momento.', 'glpiintegaglpi'),
                'no_auto_send' => true,
                'no_auto_publish' => true,
                'read_only' => true,
            ];
        }
    }

    /**
     * @return array<string, mixed>
     */
    public function listExternalHistory(int $ticketId, string $conversationId = ''): array
    {
        try {
            $service = new ExternalResearchService($this->config);

            return [
                'ok' => true,
                'history' => $service->listExternalHelpHistory($ticketId, $conversationId),
                'provider_catalog' => $service->providerCatalogForSmartHelp(),
                'read_only' => true,
                'no_auto_send' => true,
                'no_auto_publish' => true,
            ];
        } catch (\Throwable $exception) {
            error_log('[integaglpi][smart_help][external_history] ' . mb_substr($exception->getMessage(), 0, 160, 'UTF-8'));

            return [
                'ok' => false,
                'history' => [],
                'provider_catalog' => ['ok' => false, 'providers' => []],
                'message' => __('Histórico de ajuda externa indisponível.', 'glpiintegaglpi'),
                'read_only' => true,
            ];
        }
    }

    /**
     * @return array<string, mixed>
     */
    public function createKbCandidateFromExternalHistory(int $ticketId, int $historyId): array
    {
        try {
            return (new ExternalResearchService($this->config))->createKbCandidateFromExternalHistory(
                $ticketId,
                $historyId,
                Plugin::getCurrentUserId()
            );
        } catch (\Throwable $exception) {
            error_log('[integaglpi][smart_help][external_history_kb] ' . mb_substr($exception->getMessage(), 0, 160, 'UTF-8'));

            return [
                'ok' => false,
                'status' => 'failed',
                'message' => __('Não foi possível gerar o candidato KB agora.', 'glpiintegaglpi'),
                'no_autopublish' => true,
            ];
        }
    }

    /**
     * @return array<string, mixed>
     */
    public function recordFeedback(
        int $ticketId,
        int $kbCandidateId,
        int $glpiKnowbaseitemId,
        bool $helpful,
        string $feedbackText = ''
    ): array
    {
        return $this->postJson(self::PATH_KB_FEEDBACK, [
            'ticket_id'       => $ticketId,
            'kb_candidate_id' => $kbCandidateId > 0 ? $kbCandidateId : null,
            'glpi_knowbaseitem_id' => $glpiKnowbaseitemId > 0 ? $glpiKnowbaseitemId : null,
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
