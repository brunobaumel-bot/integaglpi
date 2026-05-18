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
        } catch (Throwable) {
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
        return match (strtolower(trim($status))) {
            'pending' => __('Pendente', 'glpiintegaglpi'),
            'sent' => __('Enviada', 'glpiintegaglpi'),
            'delivered' => __('Entregue', 'glpiintegaglpi'),
            'read' => __('Lida', 'glpiintegaglpi'),
            'failed' => __('Falhou', 'glpiintegaglpi'),
            default => '',
        };
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

        $analysis['flags'] = array_values(array_filter(
            array_map('strval', $flags),
            static fn (string $flag): bool => trim($flag) !== ''
        ));

        return $analysis;
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
