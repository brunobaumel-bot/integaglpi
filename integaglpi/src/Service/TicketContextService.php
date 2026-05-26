<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi\Service;

use GlpiPlugin\Integaglpi\External\ExternalDatabase;
use GlpiPlugin\Integaglpi\External\Repository\TicketContextRepository;
use GlpiPlugin\Integaglpi\Plugin;
use PDO;
use Throwable;

final class TicketContextService
{
    private const COPILOT_MAX_MESSAGES = 8;
    private const COPILOT_MESSAGE_CHARS = 360;
    private const COPILOT_MAX_KB_ARTICLES = 3;
    private const COPILOT_KB_EXCERPT_CHARS = 500;
    private const COPILOT_MAX_AUXILIARY_ITEMS = 3;

    private PluginConfigService $pluginConfigService;

    private ?PDO $pdo = null;

    private ?TicketContextRepository $repository = null;

    public function __construct(?PluginConfigService $pluginConfigService = null)
    {
        $this->pluginConfigService = $pluginConfigService ?? new PluginConfigService();
    }

    /**
     * @return array<string, mixed>
     */
    public function getTicketContext(\Ticket $ticket): array
    {
        $ticketId = (int) $ticket->getID();
        $ticketStatus = (int) ($ticket->fields['status'] ?? 0);
        $canViewTechnical = Plugin::canAuditRead();

        $base = [
            'ticket_id' => $ticketId,
            'ticket_status' => $ticketStatus,
            'is_configured' => $this->pluginConfigService->isConfigured(),
            'has_conversation' => false,
            'has_multiple_conversations' => false,
            'conversation' => null,
            'last_inbound' => null,
            'last_outbound' => null,
            'events' => [],
            'dead_letter' => null,
            'risk' => null,
            'warnings' => [],
            'ai_assistant' => [
                'local_knowledge' => ['items' => [], 'message' => __('Nenhum contexto disponível para consultar KB local.', 'glpiintegaglpi')],
                'external_research' => ['status' => 'disabled', 'blocked_reason' => 'context_unavailable'],
                'p4' => ['status' => 'manual_review_only'],
            ],
            'can_view_technical' => $canViewTechnical,
        ];

        if (!$this->pluginConfigService->isConfigured()) {
            return $base + [
                'error' => __('Configure the external PostgreSQL connection before using this tab.', 'glpiintegaglpi'),
            ];
        }

        try {
            $repository = $this->getRepository();
            $conversations = $repository->findRecentConversationsByTicketId($ticketId);
            if ($conversations === []) {
                return $base;
            }

            $conversation = $this->decorateConversation($conversations[0]);
            $conversationId = (string) ($conversation['conversation_id'] ?? '');
            $lastInbound = $repository->findLastMessageByDirection($conversationId, 'inbound');
            $lastOutbound = $repository->findLastMessageByDirection($conversationId, 'outbound');
            $recentOutboundFailure = $canViewTechnical ? $repository->findRecentOutboundFailure($conversationId) : null;
            $events = $canViewTechnical ? $repository->findRecentConversationAuditEvents($conversationId, 5) : [];
            $deadLetter = $canViewTechnical ? $repository->findOpenDeadLetter($ticketId, $conversationId) : null;
            $csat = $repository->findLatestCsatByTicketId($ticketId);
            $aiQuality = $canViewTechnical ? $repository->findLatestAiQualityAnalysisByTicketId($ticketId) : null;
            $correlationId = $canViewTechnical ? $repository->findLatestCorrelationId($ticketId, $conversationId) : '';
            $risk = OperationalQualityService::classifyRisk([
                'conversation_status' => $conversation['conversation_status'] ?? '',
                'runtime_status' => $conversation['runtime_status'] ?? '',
                'ticket_status' => $ticketStatus,
                'last_interaction_at' => $conversation['last_activity_at'] ?? null,
                'has_dead_letter_open' => $deadLetter !== null,
                'has_outbound_failed' => $recentOutboundFailure !== null,
            ]);

            return [
                ...$base,
                'has_conversation' => true,
                'has_multiple_conversations' => count($conversations) > 1,
                'conversation' => $conversation,
                'last_inbound' => $lastInbound,
                'last_outbound' => $lastOutbound,
                'whatsapp_window' => $this->buildWhatsappWindow((string) ($lastInbound['created_at'] ?? '')),
                'events' => $this->decorateEvents($events),
                'dead_letter' => $deadLetter,
                'csat' => $csat,
                'ai_quality' => $this->decorateAiQuality($aiQuality),
                'ai_supervisor_enabled' => Plugin::isAiSupervisorEnabled(),
                'risk' => $risk,
                'correlation_id' => $correlationId,
                'ai_assistant' => $this->buildTicketAiAssistant($ticket, $conversationId, $conversation),
                'warnings' => $this->buildWarnings(
                    $conversation,
                    $ticketStatus,
                    $lastOutbound,
                    $events,
                    $deadLetter,
                    $recentOutboundFailure
                ),
            ];
        } catch (Throwable $exception) {
            error_log('[integaglpi][ticket_context][error] ticket_id=' . $ticketId . ' ' . $exception->getMessage());

            return $base + [
                'error' => __('Unable to load WhatsApp context right now.', 'glpiintegaglpi'),
            ];
        }
    }

    public function maskPhone(string $phone): string
    {
        // Privacy decision for 8.1: phone is always masked in the ticket tab.
        // Full display can be revisited in a future phase with explicit profile rules.
        $phone = trim($phone);
        if ($phone === '') {
            return '-';
        }

        $digits = preg_replace('/\D+/', '', $phone) ?? '';
        if (strlen($digits) < 8) {
            return '******';
        }

        $prefix = str_starts_with($phone, '+') ? '+' . substr($digits, 0, 2) : substr($digits, 0, 2);
        $suffix = substr($digits, -4);

        return $prefix . '******' . $suffix;
    }

    /**
     * @param array<string, mixed> $conversation
     * @return array<string, mixed>
     */
    private function buildTicketAiAssistant(\Ticket $ticket, string $conversationId, array $conversation): array
    {
        $queryParts = [
            (string) ($ticket->fields['name'] ?? ''),
            (string) ($ticket->fields['content'] ?? ''),
            $this->latestMessageText($conversationId),
            (string) ($conversation['queue_name'] ?? ''),
        ];
        $query = $this->sanitizeCopilotText(implode(' ', array_filter($queryParts, static function (string $value): bool { return trim($value) !== ''; })), 360);
        $items = [];
        try {
            foreach ((new NativeKnowledgeBaseService())->buildRelatedArticlesContext(['summary' => $query], 3) as $article) {
                if (!is_array($article)) {
                    continue;
                }
                $items[] = [
                    'origin' => 'KB nativa',
                    'title' => $this->sanitizeCopilotText((string) ($article['title'] ?? ''), 180),
                    'excerpt' => $this->sanitizeCopilotText((string) ($article['excerpt'] ?? ''), 360),
                    'confidence' => 80,
                    'internal_url' => $this->sanitizeCopilotUrl((string) ($article['internal_url'] ?? '')),
                ];
            }
        } catch (Throwable $exception) {
            error_log('[integaglpi][ticket_ai_assistant][kb_native] ' . $this->sanitizeCopilotText($exception->getMessage(), 180));
        }

        if ($this->pluginConfigService->isConfigured()) {
            try {
                $items = array_merge($items, $this->loadTicketAssistantKbCandidates($query), $this->loadTicketAssistantHistoricalInsights($query));
            } catch (Throwable $exception) {
                error_log('[integaglpi][ticket_ai_assistant][internal_context] ' . $this->sanitizeCopilotText($exception->getMessage(), 180));
            }
        }

        $items = array_slice($items, 0, 6);
        $ticketSummaryForResearch = $this->buildExternalResearchTicketSummary($ticket, $conversationId, $items);
        $copilotProvider = strtolower(trim($this->loadAiSettingValue(
            'copilot_provider',
            Plugin::getRuntimeConfigValue('COPILOT_PROVIDER') ?: (Plugin::getRuntimeConfigValue('AI_SUPERVISOR_PROVIDER') ?: 'disabled')
        )));
        if ($copilotProvider === 'local') {
            $copilotProvider = 'ollama';
        }
        if (!in_array($copilotProvider, ['ollama', 'disabled'], true)) {
            $copilotProvider = 'disabled';
        }
        $copilotModel = $this->sanitizeCopilotText($this->loadAiSettingValue(
            'copilot_model',
            Plugin::getRuntimeConfigValue('AI_SUPERVISOR_MODEL') ?: ''
        ), 120);
        $copilotDryRun = strtolower($this->loadAiSettingValue(
            'copilot_dry_run',
            Plugin::getRuntimeConfigValue('COPILOT_DRY_RUN') ?: (Plugin::getRuntimeConfigValue('AI_SUPERVISOR_DRY_RUN') ?: 'true')
        )) !== 'false';
        $copilotOrigin = $copilotProvider === 'ollama'
            ? ($copilotDryRun ? '[Fallback local - dry-run ativo]' : '[IA Local - ' . ($copilotModel !== '' ? $copilotModel : 'modelo não configurado') . ']')
            : '[Fallback local - provider desabilitado]';
        $this->auditTicketAiAssistant('TICKET_AI_ASSISTANT_KB_LOCAL_PREPARED', (int) $ticket->getID(), $conversationId, [
            'query_hash' => hash('sha256', $query),
            'result_count' => count($items),
            'source' => 'TicketContextService',
        ]);

        return [
            'local_knowledge' => [
                'query' => $query,
                'items' => $items,
                'message' => $items === []
                    ? __('Nenhum artigo/candidato/insight interno encontrado. Use o Copiloto apenas como rascunho revisável.', 'glpiintegaglpi')
                    : __('KB local consultada antes de qualquer IA externa.', 'glpiintegaglpi'),
                'ticket_summary_for_research' => $ticketSummaryForResearch,
            ],
            'copilot' => [
                'provider' => $copilotProvider,
                'model' => $copilotModel,
                'dry_run' => $copilotDryRun,
                'origin_label' => $copilotOrigin,
                'no_auto_send' => true,
            ],
            'external_research' => $this->ticketExternalResearchStatus(),
            'p4' => [
                'status' => 'available_in_historical_mining',
                'message' => __('P4 revisa apenas candidatos P3 sanitizados e nunca publica KB automaticamente.', 'glpiintegaglpi'),
            ],
        ];
    }

    /**
     * Builds a structured sanitized technical summary for external research prefill.
     * No PII, no ticket raw content, no internal IPs, no tokens.
     *
     * @param list<array<string, mixed>> $kbItems
     */
    private function buildExternalResearchTicketSummary(\Ticket $ticket, string $conversationId, array $kbItems): string
    {
        $title = $this->sanitizeCopilotText((string) ($ticket->fields['name'] ?? ''), 120);
        $rawContent = strip_tags((string) ($ticket->fields['content'] ?? ''));
        $symptoms = $this->sanitizeCopilotText($rawContent, 400);
        $latestMsg = $this->sanitizeCopilotText($this->latestMessageText($conversationId), 200);

        $parts = [];
        if ($title !== '') {
            $parts[] = 'Título: ' . $title;
        }
        if ($symptoms !== '') {
            $parts[] = 'Sintomas: ' . $symptoms;
        }
        if ($latestMsg !== '') {
            $parts[] = 'Última mensagem do cliente: ' . $latestMsg;
        }

        $kbTitles = [];
        foreach (array_slice($kbItems, 0, 3) as $kbItem) {
            if (!is_array($kbItem)) {
                continue;
            }
            $kbTitle = trim((string) ($kbItem['title'] ?? ''));
            if ($kbTitle !== '') {
                $kbTitles[] = $kbTitle;
            }
        }
        if ($kbTitles !== []) {
            $parts[] = 'KB local relacionada: ' . implode(', ', $kbTitles);
        }

        $parts[] = 'Objetivo: buscar solução técnica em documentação oficial sem expor dados pessoais ou internos.';

        return $this->sanitizeCopilotText(implode("\n", $parts), 1800);
    }

    /**
     * @return array<string, mixed>
     */
    public function buildCopilotContext(\Ticket $ticket, string $conversationId): array
    {
        $ticketId = (int) $ticket->getID();
        $conversationId = trim($conversationId);
        if ($ticketId <= 0 || $conversationId === '') {
            throw new \RuntimeException('COPILOT_CONTEXT_INVALID');
        }

        $ticketContext = $this->getTicketContext($ticket);
        $conversation = is_array($ticketContext['conversation'] ?? null) ? $ticketContext['conversation'] : [];
        $whatsappWindow = is_array($ticketContext['whatsapp_window'] ?? null) ? $ticketContext['whatsapp_window'] : [];
        $windowNotice = 'unknown';
        if ($whatsappWindow !== []) {
            $windowNotice = !empty($whatsappWindow['is_open']) ? 'open_24h' : 'closed_24h';
        }

        $kbService = new NativeKnowledgeBaseService();
        $kbArticles = $kbService->buildRelatedArticlesContext([
            'ticket_name' => (string) ($ticket->fields['name'] ?? ''),
            'summary' => (string) ($ticket->fields['content'] ?? ''),
            'last_message' => $this->latestMessageText($conversationId),
            'queue_name' => (string) ($conversation['queue_name'] ?? ''),
        ], self::COPILOT_MAX_KB_ARTICLES);

        return [
            'conversation_id' => $conversationId,
            'glpi_ticket_id' => $ticketId,
            'ticket_title' => $this->sanitizeCopilotText((string) ($ticket->fields['name'] ?? '')),
            'ticket_status' => (string) ($ticket->fields['status'] ?? ''),
            'queue_name' => $this->sanitizeCopilotText((string) ($conversation['queue_name'] ?? '')),
            'sla_label' => $this->sanitizeCopilotText((string) ($ticketContext['risk']['level'] ?? '')),
            'window_notice' => $windowNotice,
            'messages' => $this->loadCopilotMessages($conversationId),
            'kb_articles' => array_map(
                fn (array $article): array => [
                    'article_id' => (int) ($article['article_id'] ?? 0),
                    'title' => $this->sanitizeCopilotText((string) ($article['title'] ?? ''), 180),
                    'category' => $this->sanitizeCopilotText((string) ($article['category'] ?? ''), 120),
                    'excerpt' => $this->sanitizeCopilotText((string) ($article['excerpt'] ?? ''), self::COPILOT_KB_EXCERPT_CHARS),
                    'internal_url' => $this->sanitizeCopilotUrl((string) ($article['internal_url'] ?? '')),
                ],
                $kbArticles
            ),
            'ai_quality' => $this->sanitizeCopilotArray(is_array($ticketContext['ai_quality'] ?? null) ? $ticketContext['ai_quality'] : []),
            'kb_candidates' => $this->loadCopilotKbCandidates(),
            'historical_insights' => $this->loadCopilotHistoricalInsights(),
        ];
    }

    /**
     * @param array<string, mixed> $conversation
     * @return array<string, mixed>
     */
    private function decorateConversation(array $conversation): array
    {
        $conversationStatus = strtolower(trim((string) ($conversation['conversation_status'] ?? '')));
        $runtimeStatus = strtolower(trim((string) ($conversation['runtime_status'] ?? '')));
        $lastActivity = (string) (
            $conversation['last_message_at']
            ?? $conversation['conversation_updated_at']
            ?? $conversation['runtime_updated_at']
            ?? ''
        );

        $conversation['conversation_status_label'] = $conversationStatus !== '' ? $conversationStatus : '-';
        $conversation['runtime_status_label'] = $runtimeStatus !== '' ? $runtimeStatus : '-';
        $conversation['last_activity_at'] = $lastActivity;
        $conversation['masked_phone'] = $this->maskPhone((string) ($conversation['phone_e164'] ?? ''));
        $conversation['memory_entity_id'] = isset($conversation['memory_entity_id'])
            ? (int) $conversation['memory_entity_id']
            : 0;
        $conversation['memory_entity_name'] = (string) ($conversation['memory_entity_name'] ?? '');

        return $conversation;
    }

    /**
     * @param list<array<string, mixed>> $events
     * @return list<array<string, mixed>>
     */
    private function decorateEvents(array $events): array
    {
        return array_map(
            static function (array $event): array {
                $message = trim((string) ($event['error_message'] ?? ''));
                if (strlen($message) > 50) {
                    $message = substr($message, 0, 50) . '...';
                }

                $event['error_summary'] = $message;

                return $event;
            },
            $events
        );
    }

    /**
     * @return array{is_open: bool, label: string, expires_at: string, alert: string}
     */
    private function buildWhatsappWindow(string $lastInboundAt): array
    {
        $lastInboundAt = trim($lastInboundAt);
        if ($lastInboundAt === '') {
            return [
                'is_open' => false,
                'label' => __('Janela fechada — use template', 'glpiintegaglpi'),
                'expires_at' => '',
                'alert' => __('Sem mensagem inbound recente do cliente. Use template aprovado para iniciar contato.', 'glpiintegaglpi'),
            ];
        }

        try {
            $lastInbound = new \DateTimeImmutable($lastInboundAt);
            $expiresAt = $lastInbound->modify('+24 hours');
            $now = new \DateTimeImmutable('now', $expiresAt->getTimezone());
            $isOpen = $expiresAt > $now;
            $formatted = $expiresAt->format('H:i');

            return [
                'is_open' => $isOpen,
                'label' => $isOpen
                    ? sprintf(__('Janela aberta até %s', 'glpiintegaglpi'), $formatted)
                    : __('Janela fechada — use template', 'glpiintegaglpi'),
                'expires_at' => $expiresAt->format('c'),
                'alert' => $isOpen
                    ? ''
                    : __('A janela de 24h está fechada. Use um template aprovado antes de enviar texto livre.', 'glpiintegaglpi'),
            ];
        } catch (Throwable $exception) {
            return [
                'is_open' => false,
                'label' => __('Janela fechada — use template', 'glpiintegaglpi'),
                'expires_at' => '',
                'alert' => __('Não foi possível calcular a janela de 24h com segurança.', 'glpiintegaglpi'),
            ];
        }
    }

    public static function deliveryStatusLabel(string $status): string
    {
        switch (strtolower(trim($status))) {
            case 'pending':
                return __('Pendente', 'glpiintegaglpi');
            case 'sent':
                return __('Enviada', 'glpiintegaglpi');
            case 'delivered':
                return __('Entregue', 'glpiintegaglpi');
            case 'read':
                return __('Lida', 'glpiintegaglpi');
            case 'failed':
                return __('Falhou', 'glpiintegaglpi');
            default:
                return '';
        }
    }

    /**
     * @param array<string, mixed>|null $analysis
     * @return array<string, mixed>|null
     */
    private function decorateAiQuality(?array $analysis): ?array
    {
        if ($analysis === null) {
            return null;
        }

        $flags = $analysis['flags'] ?? [];
        if (is_string($flags)) {
            $decoded = json_decode($flags, true);
            $flags = is_array($decoded) ? $decoded : [];
        }
        if (!is_array($flags)) {
            $flags = [];
        }

        $resultJson = $analysis['result_json'] ?? null;
        if (is_string($resultJson) && trim($resultJson) !== '') {
            $decoded = json_decode($resultJson, true);
            $resultJson = is_array($decoded) ? $decoded : [];
        }
        if (!is_array($resultJson)) {
            $resultJson = [];
        }

        $analysis['flags'] = array_values(array_filter(
            array_map('strval', $flags),
            static fn (string $flag): bool => trim($flag) !== ''
        ));
        $analysis['result_json'] = $resultJson;
        $analysis['urgency'] = (string) ($resultJson['urgency'] ?? '-');
        $analysis['risk_level'] = (string) ($resultJson['riskLevel'] ?? $resultJson['risk_level'] ?? '-');
        $analysis['risk_flags'] = $this->normalizeStringList($resultJson['riskFlags'] ?? $resultJson['risk_flags'] ?? []);
        $analysis['quality_flags'] = $this->normalizeStringList($resultJson['qualityFlags'] ?? $resultJson['quality_flags'] ?? []);
        $analysis['missing_context'] = $this->normalizeStringList($resultJson['missingContext'] ?? $resultJson['missing_context'] ?? []);
        $analysis['probable_cause'] = (string) ($resultJson['probableCause'] ?? $resultJson['probable_cause'] ?? '-');
        $analysis['suggested_next_action'] = (string) ($resultJson['suggestedNextAction'] ?? $resultJson['suggested_next_action'] ?? ($analysis['recommendation'] ?? '-'));
        $analysis['supervisor_notes'] = (string) ($resultJson['supervisorNotes'] ?? $resultJson['supervisor_notes'] ?? '-');
        $analysis['confidence_score'] = isset($resultJson['confidenceScore'])
            ? (int) $resultJson['confidenceScore']
            : (isset($resultJson['confidence_score']) ? (int) $resultJson['confidence_score'] : null);
        $analysis['safety_notes'] = $this->normalizeStringList($resultJson['safetyNotes'] ?? $resultJson['safety_notes'] ?? []);
        $analysis['related_kb_articles'] = $this->normalizeKbArticles($resultJson['relatedKbArticles'] ?? $resultJson['related_kb_articles'] ?? []);
        $analysis['kb_alignment'] = (string) ($resultJson['kbAlignment'] ?? $resultJson['kb_alignment'] ?? '-');
        $analysis['procedure_followed'] = (string) ($resultJson['procedureFollowed'] ?? $resultJson['procedure_followed'] ?? '-');
        $analysis['procedure_notes'] = (string) ($resultJson['procedureNotes'] ?? $resultJson['procedure_notes'] ?? '-');
        $analysis['communication_quality'] = is_array($resultJson['communicationQuality'] ?? null)
            ? $resultJson['communicationQuality']
            : (is_array($resultJson['communication_quality'] ?? null) ? $resultJson['communication_quality'] : []);
        $analysis['client_satisfaction_risk'] = (string) ($resultJson['clientSatisfactionRisk'] ?? $resultJson['client_satisfaction_risk'] ?? '-');
        $analysis['key_insights'] = $this->normalizeStringList($resultJson['keyInsights'] ?? $resultJson['key_insights'] ?? []);
        $analysis['suggested_improvements_for_technician'] = $this->normalizeStringList($resultJson['suggestedImprovementsForTechnician'] ?? $resultJson['suggested_improvements_for_technician'] ?? []);
        $analysis['supervisor_recommendation'] = $this->normalizeStringList($resultJson['supervisorRecommendation'] ?? $resultJson['supervisor_recommendation'] ?? []);

        return $analysis;
    }

    /**
     * @param mixed $value
     * @return list<string>
     */
    private function normalizeStringList($value): array
    {
        if (!is_array($value)) {
            return [];
        }

        return array_values(array_filter(
            array_map('strval', $value),
            static fn (string $item): bool => trim($item) !== ''
        ));
    }

    /**
     * @param mixed $value
     * @return list<array<string, mixed>>
     */
    private function normalizeKbArticles($value): array
    {
        if (!is_array($value)) {
            return [];
        }

        $articles = [];
        foreach (array_slice($value, 0, 5) as $item) {
            if (!is_array($item)) {
                continue;
            }

            $articles[] = [
                'article_id' => (int) ($item['articleId'] ?? $item['article_id'] ?? 0),
                'title' => (string) ($item['title'] ?? ''),
                'category' => (string) ($item['category'] ?? ''),
                'relevance_score' => (int) ($item['relevanceScore'] ?? $item['relevance_score'] ?? 0),
                'why_relevant' => (string) ($item['whyRelevant'] ?? $item['why_relevant'] ?? ''),
                'internal_url' => (string) ($item['internalUrl'] ?? $item['internal_url'] ?? ''),
            ];
        }

        return $articles;
    }

    /**
     * @param array<string, mixed> $conversation
     * @param array<string, mixed>|null $lastOutbound
     * @param list<array<string, mixed>> $events
     * @param array<string, mixed>|null $deadLetter
     * @return list<array{level: string, text: string}>
     */
    private function buildWarnings(
        array $conversation,
        int $ticketStatus,
        ?array $lastOutbound,
        array $events,
        ?array $deadLetter,
        ?array $recentOutboundFailure = null
    ): array {
        $warnings = [];
        $conversationStatus = strtolower((string) ($conversation['conversation_status'] ?? ''));
        $runtimeStatus = strtolower((string) ($conversation['runtime_status'] ?? ''));
        $ticketClosed = in_array($ticketStatus, [\CommonITILObject::SOLVED, \CommonITILObject::CLOSED], true);

        if ($conversationStatus === 'closed' && !$ticketClosed) {
            $warnings[] = [
                'level' => 'warning',
                'text' => __('Conversa fechada enquanto o ticket GLPI nao esta fechado.', 'glpiintegaglpi'),
            ];
        }

        if ($conversationStatus === 'open' && $runtimeStatus === 'closed') {
            $warnings[] = [
                'level' => 'warning',
                'text' => __('Runtime fechado enquanto a conversa esta aberta.', 'glpiintegaglpi'),
            ];
        }

        if ($ticketClosed && $conversationStatus === 'open') {
            $warnings[] = [
                'level' => 'warning',
                'text' => __('Ticket fechado com conversa WhatsApp aberta.', 'glpiintegaglpi'),
            ];
        }

        if ($deadLetter !== null) {
            $warnings[] = [
                'level' => 'danger',
                'text' => __('Existe dead-letter aberto relacionado a este ticket.', 'glpiintegaglpi'),
            ];
        }

        if ($recentOutboundFailure !== null) {
            $warnings[] = [
                'level' => 'danger',
                'text' => __('Ha falha outbound recente relacionada a este ticket.', 'glpiintegaglpi'),
            ];
        }

        $outboundProcessingStatus = $lastOutbound !== null
            ? strtolower((string) ($lastOutbound['processing_status'] ?? ''))
            : '';
        $outboundGlpiSyncStatus = $lastOutbound !== null
            ? strtolower((string) ($lastOutbound['glpi_sync_status'] ?? ''))
            : '';
        if (in_array('failed', [$outboundProcessingStatus, $outboundGlpiSyncStatus], true)) {
            $warnings[] = [
                'level' => 'danger',
                'text' => __('A ultima mensagem outbound esta marcada como failed.', 'glpiintegaglpi'),
            ];
        }

        foreach ($events as $event) {
            $eventType = (string) ($event['event_type'] ?? '');
            $severity = strtolower((string) ($event['severity'] ?? ''));
            $operationalNoiseEvents = [
                'STALE_WEBHOOK_IGNORED',
                'WEBHOOK_DUPLICATED',
                'MESSAGE_DUPLICATED',
                'IDEMPOTENCY_CONFLICT',
                'ACTION_DUPLICATED',
                'QUEUE_SELECTION_DUPLICATED',
            ];
            if (in_array($eventType, $operationalNoiseEvents, true)) {
                $warnings[] = [
                    'level' => 'warning',
                    'text' => __('Ha evento recente de webhook stale/duplicado.', 'glpiintegaglpi'),
                ];
                break;
            }

            if (in_array($severity, ['error', 'critical'], true)) {
                $warnings[] = [
                    'level' => 'danger',
                    'text' => __('Ha evento error/critical recente para este contexto.', 'glpiintegaglpi'),
                ];
                break;
            }
        }

        return $warnings;
    }

    /**
     * @return list<array<string, string>>
     */
    private function loadCopilotMessages(string $conversationId): array
    {
        $statement = $this->getPdo()->prepare(
            <<<SQL
            SELECT direction, message_type, message_text, created_at
            FROM (
                SELECT direction, message_type, message_text, created_at, id
                FROM glpi_plugin_integaglpi_messages
                WHERE conversation_id = :conversation_id
                  AND message_text IS NOT NULL
                  AND trim(message_text) <> ''
                ORDER BY created_at DESC, id DESC
                LIMIT 8
            ) recent
            ORDER BY created_at ASC, id ASC
            SQL
        );
        $statement->bindValue(':conversation_id', $conversationId);
        $statement->execute();

        $rows = $statement->fetchAll();
        if (!is_array($rows)) {
            return [];
        }

        return array_map(fn (array $row): array => [
            'direction' => $this->sanitizeCopilotText((string) ($row['direction'] ?? ''), 20),
            'message_type' => $this->sanitizeCopilotText((string) ($row['message_type'] ?? ''), 40),
            'text' => $this->sanitizeCopilotText((string) ($row['message_text'] ?? ''), self::COPILOT_MESSAGE_CHARS),
            'created_at' => $this->sanitizeCopilotText((string) ($row['created_at'] ?? ''), 40),
        ], $rows);
    }

    private function latestMessageText(string $conversationId): string
    {
        $messages = $this->loadCopilotMessages($conversationId);
        $last = end($messages);

        return is_array($last) ? (string) ($last['text'] ?? '') : '';
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function loadTicketAssistantKbCandidates(string $query): array
    {
        if ($query === '' || !$this->tableExists('glpi_plugin_integaglpi_kb_candidates')) {
            return [];
        }

        $statement = $this->getPdo()->prepare(
            <<<SQL
            SELECT title, article_type, confidence_score, status, content_markdown
            FROM glpi_plugin_integaglpi_kb_candidates
            WHERE status IN ('approved', 'in_review', 'suggested')
              AND (
                title ILIKE :term
                OR COALESCE(problem_pattern, '') ILIKE :term
                OR COALESCE(content_markdown, '') ILIKE :term
              )
            ORDER BY confidence_score DESC, updated_at DESC
            LIMIT 3
            SQL
        );
        $statement->bindValue(':term', '%' . $query . '%');
        $statement->execute();

        $rows = $statement->fetchAll();
        if (!is_array($rows)) {
            return [];
        }

        return array_map(fn (array $row): array => [
            'origin' => 'candidato KB',
            'title' => $this->sanitizeCopilotText((string) ($row['title'] ?? ''), 180),
            'excerpt' => $this->sanitizeCopilotText((string) ($row['content_markdown'] ?? ''), 360),
            'confidence' => (int) ($row['confidence_score'] ?? 0),
            'status' => $this->sanitizeCopilotText((string) ($row['status'] ?? ''), 40),
            'internal_url' => '',
        ], $rows);
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function loadTicketAssistantHistoricalInsights(string $query): array
    {
        if ($query === '' || !$this->tableExists('glpi_plugin_integaglpi_hist_insights')) {
            return [];
        }

        $statement = $this->getPdo()->prepare(
            <<<SQL
            SELECT title, summary_sanitized, recommendation_sanitized, confidence_score, priority
            FROM glpi_plugin_integaglpi_hist_insights
            WHERE title ILIKE :term
               OR summary_sanitized ILIKE :term
               OR recommendation_sanitized ILIKE :term
            ORDER BY confidence_score DESC, created_at DESC
            LIMIT 3
            SQL
        );
        $statement->bindValue(':term', '%' . $query . '%');
        $statement->execute();
        $rows = $statement->fetchAll();
        if (!is_array($rows)) {
            return [];
        }

        return array_map(fn (array $row): array => [
            'origin' => 'insight histórico',
            'title' => $this->sanitizeCopilotText((string) ($row['title'] ?? ''), 180),
            'excerpt' => $this->sanitizeCopilotText((string) ($row['recommendation_sanitized'] ?? $row['summary_sanitized'] ?? ''), 360),
            'confidence' => (int) ($row['confidence_score'] ?? 0),
            'priority' => $this->sanitizeCopilotText((string) ($row['priority'] ?? ''), 40),
            'internal_url' => '',
        ], $rows);
    }

    /**
     * @return array<string, mixed>
     */
    private function ticketExternalResearchStatus(): array
    {
        $enabled = strtolower($this->loadAiSettingValue('external_research_enabled', Plugin::getRuntimeConfigValue('EXTERNAL_RESEARCH_ENABLED') ?: 'false'));
        $tablesReady = $this->pluginConfigService->isConfigured()
            && $this->tableExists('glpi_plugin_integaglpi_external_source_catalog')
            && $this->tableExists('glpi_plugin_integaglpi_external_research_requests')
            && $this->tableExists('glpi_plugin_integaglpi_external_research_candidates');

        return [
            'status' => $enabled === 'true' && $tablesReady ? 'available' : 'disabled',
            'blocked_reason' => $enabled === 'true'
                ? ($tablesReady ? '' : 'migration_036_not_ready')
                : 'feature_flag_disabled',
            'manual_only' => true,
            'preview_required' => true,
        ];
    }

    private function loadAiSettingValue(string $key, string $fallback): string
    {
        if (!preg_match('/^[a-z0-9_]+$/', $key) || !$this->pluginConfigService->isConfigured() || !$this->tableExists('glpi_plugin_integaglpi_configs')) {
            return $fallback;
        }

        try {
            $statement = $this->getPdo()->prepare(
                'SELECT "' . $key . '" FROM glpi_plugin_integaglpi_configs WHERE context = :context LIMIT 1'
            );
            $statement->execute([':context' => 'ai_settings']);
            $value = $statement->fetchColumn();

            return $value === false || $value === null || $value === '' ? $fallback : (string) $value;
        } catch (Throwable $exception) {
            error_log('[integaglpi][ticket_ai_assistant][setting] ' . $this->sanitizeCopilotText($exception->getMessage(), 180));

            return $fallback;
        }
    }

    /**
     * @param array<string, mixed> $payload
     */
    private function auditTicketAiAssistant(string $eventType, int $ticketId, string $conversationId, array $payload): void
    {
        try {
            if (!$this->pluginConfigService->isConfigured() || !$this->tableExists('glpi_plugin_integaglpi_audit_events')) {
                return;
            }
            $statement = $this->getPdo()->prepare(
                "INSERT INTO glpi_plugin_integaglpi_audit_events (
                    correlation_id, ticket_id, conversation_id, event_type, status, severity, source, payload_json, created_at
                ) VALUES (
                    :correlation_id, :ticket_id, :conversation_id, :event_type, 'success', 'info', 'TicketContextService', CAST(:payload AS jsonb), NOW()
                )"
            );
            $statement->execute([
                ':correlation_id' => 'ticket_ai_assistant:' . bin2hex(random_bytes(8)),
                ':ticket_id' => $ticketId,
                ':conversation_id' => $this->sanitizeCopilotText($conversationId, 80),
                ':event_type' => $eventType,
                ':payload' => json_encode([
                    'payload_policy' => 'hashes_only_no_raw_ticket_no_pii',
                    'result_count' => (int) ($payload['result_count'] ?? 0),
                    'query_hash' => (string) ($payload['query_hash'] ?? ''),
                ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?: '{}',
            ]);
        } catch (Throwable $exception) {
            error_log('[integaglpi][ticket_ai_assistant][audit] ' . $this->sanitizeCopilotText($exception->getMessage(), 180));
        }
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function loadCopilotKbCandidates(): array
    {
        if (!$this->tableExists('glpi_plugin_integaglpi_kb_candidates')) {
            return [];
        }

        $statement = $this->getPdo()->prepare(
            <<<SQL
            SELECT id, title, article_type, confidence_score, status
            FROM glpi_plugin_integaglpi_kb_candidates
            WHERE status IN ('approved', 'in_review')
            ORDER BY confidence_score DESC, updated_at DESC
            LIMIT 3
            SQL
        );
        $statement->execute();
        $rows = $statement->fetchAll();
        if (!is_array($rows)) {
            return [];
        }

        return array_map(fn (array $row): array => $this->sanitizeCopilotArray([
            'id' => (int) ($row['id'] ?? 0),
            'title' => (string) ($row['title'] ?? ''),
            'article_type' => (string) ($row['article_type'] ?? ''),
            'confidence_score' => (int) ($row['confidence_score'] ?? 0),
            'status' => (string) ($row['status'] ?? ''),
        ]), $rows);
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function loadCopilotHistoricalInsights(): array
    {
        if (!$this->tableExists('glpi_plugin_integaglpi_hist_insights')) {
            return [];
        }

        $statement = $this->getPdo()->prepare(
            <<<SQL
            SELECT insight_type, priority, title, confidence_score
            FROM glpi_plugin_integaglpi_hist_insights
            ORDER BY created_at DESC
            LIMIT 3
            SQL
        );
        $statement->execute();
        $rows = $statement->fetchAll();
        if (!is_array($rows)) {
            return [];
        }

        return array_map(fn (array $row): array => $this->sanitizeCopilotArray([
            'insight_type' => (string) ($row['insight_type'] ?? ''),
            'priority' => (string) ($row['priority'] ?? ''),
            'title' => (string) ($row['title'] ?? ''),
            'confidence_score' => (int) ($row['confidence_score'] ?? 0),
        ]), $rows);
    }

    /**
     * @param array<string, mixed> $value
     * @return array<string, mixed>
     */
    private function sanitizeCopilotArray(array $value): array
    {
        $sanitized = [];
        foreach ($value as $key => $item) {
            if (is_array($item)) {
                $sanitized[(string) $key] = $this->sanitizeCopilotArray($item);
                continue;
            }
            if (is_bool($item) || is_int($item) || is_float($item) || $item === null) {
                $sanitized[(string) $key] = $item;
                continue;
            }

            $sanitized[(string) $key] = $this->sanitizeCopilotText((string) $item, 300);
        }

        return $sanitized;
    }

    private function sanitizeCopilotText(string $value, int $limit = 300): string
    {
        $value = html_entity_decode(strip_tags($value), ENT_QUOTES | ENT_HTML5, 'UTF-8');
        $value = preg_replace('/[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}/i', '[email]', $value) ?? $value;
        $value = preg_replace('/\+?\d[\d\s().-]{7,}\d/', '[telefone]', $value) ?? $value;
        $value = preg_replace('/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b|\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/', '[documento]', $value) ?? $value;
        $value = preg_replace('/(password|token|bearer|api_key|app_secret|secret)\s*[:=]\s*\S+/i', '$1=[redacted]', $value) ?? $value;
        $value = preg_replace('/\s+/u', ' ', $value) ?? $value;
        $value = trim($value);

        return mb_substr($value, 0, max(1, $limit), 'UTF-8');
    }

    private function sanitizeCopilotUrl(string $value): string
    {
        $value = $this->sanitizeCopilotText($value, 300);
        if ($value === '' || preg_match('/(?:access_token|token|bearer|signature|app_secret)/i', $value)) {
            return '';
        }

        return str_contains($value, '/front/knowbaseitem.form.php') ? $value : '';
    }

    private function tableExists(string $table): bool
    {
        $statement = $this->getPdo()->prepare("SELECT to_regclass(:table_name) IS NOT NULL");
        $statement->bindValue(':table_name', 'public.' . $table);
        $statement->execute();

        return (bool) $statement->fetchColumn();
    }

    private function getRepository(): TicketContextRepository
    {
        if ($this->repository instanceof TicketContextRepository) {
            return $this->repository;
        }

        $this->repository = new TicketContextRepository($this->getPdo());

        return $this->repository;
    }

    private function getPdo(): PDO
    {
        if ($this->pdo instanceof PDO) {
            return $this->pdo;
        }

        $this->pdo = ExternalDatabase::getConnection($this->pluginConfigService->getConnectionConfig());

        return $this->pdo;
    }
}
