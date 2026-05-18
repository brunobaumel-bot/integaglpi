<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi\Service;

use DateTimeImmutable;
use DateTimeZone;
use GlpiPlugin\Integaglpi\External\ExternalDatabase;
use GlpiPlugin\Integaglpi\External\Repository\OperationalQualityRepository;
use PDO;
use Throwable;

final class OperationalQualityService
{
    public const WARNING_NO_ACTIVITY_HOURS = 4;
    public const CRITICAL_NO_ACTIVITY_HOURS = 24;
    public const RECENT_FAILURE_WINDOW_HOURS = 24;
    public const RISK_LIST_LIMIT = 10;
    public const TICKET_TAB_EVENT_LIMIT = 5;
    private const TICKET_STATUS_LOOKUP_LIMIT = 25;

    private PluginConfigService $pluginConfigService;

    private ?PDO $pdo = null;

    private ?OperationalQualityRepository $repository = null;

    public function __construct(
        ?PluginConfigService $pluginConfigService = null,
        ?OperationalQualityRepository $repository = null
    ) {
        $this->pluginConfigService = $pluginConfigService ?? new PluginConfigService();
        $this->repository = $repository;
    }

    /**
     * @return array<string, mixed>
     */
    public function buildRiskList(): array
    {
        if (!$this->pluginConfigService->isConfigured()) {
            return [
                'available' => false,
                'items' => [],
                'limit' => self::RISK_LIST_LIMIT,
                'message' => __('PostgreSQL externo nao configurado.', 'glpiintegaglpi'),
            ];
        }

        try {
            $repository = $this->getRepository();
            $signalRows = $repository->findGlobalRiskCandidates(35);
            $linkedRows = $repository->findRecentTicketLinkedForRisk(18);
            $rows = self::mergeRiskCandidateRows($signalRows, $linkedRows);
            // Bound GLPI Ticket::getFromDB enrichment to avoid N+1 over the full external dataset.
            // At most 25 candidate conversations are enriched; final display remains capped at 10.
            if (count($rows) > self::TICKET_STATUS_LOOKUP_LIMIT) {
                usort(
                    $rows,
                    static function (array $a, array $b): int {
                        $ta = (string) ($a['last_message_at'] ?? '');
                        $tb = (string) ($b['last_message_at'] ?? '');

                        return $ta <=> $tb;
                    }
                );
                $rows = array_slice($rows, 0, self::TICKET_STATUS_LOOKUP_LIMIT);
            }
        } catch (Throwable $exception) {
            error_log('[integaglpi][quality][risk_list_error] ' . $exception->getMessage());

            return [
                'available' => false,
                'items' => [],
                'limit' => self::RISK_LIST_LIMIT,
                'message' => __('Nao foi possivel carregar chamados em risco agora.', 'glpiintegaglpi'),
            ];
        }

        $items = [];
        foreach ($rows as $row) {
            $ticketId = (int) ($row['glpi_ticket_id'] ?? 0);
            $ticketStatus = self::resolveTicketStatusFromGlpi($ticketId);
            $risk = self::classifyRisk([
                'conversation_status' => $row['conversation_status'] ?? '',
                'runtime_status' => $row['runtime_status'] ?? '',
                'ticket_status' => $ticketStatus,
                'last_interaction_at' => $row['last_message_at'] ?? $row['conversation_updated_at'] ?? null,
                'has_dead_letter_open' => $this->toBool($row['has_dead_letter_open'] ?? false),
                'has_outbound_failed' => $this->toBool($row['has_outbound_failed'] ?? false),
            ]);

            if ($risk['risk_level'] === 'ok') {
                continue;
            }

            $items[] = [
                'ticket_id' => $ticketId,
                'conversation_id' => (string) ($row['conversation_id'] ?? ''),
                'risk' => $risk,
                'last_interaction_at' => (string) ($row['last_message_at'] ?? ''),
                'conversation_status' => (string) ($row['conversation_status'] ?? ''),
                'runtime_status' => (string) ($row['runtime_status'] ?? ''),
            ];
        }

        usort(
            $items,
            static function (array $a, array $b): int {
                $rank = static fn (array $item): int => match ((string) ($item['risk']['risk_level'] ?? 'ok')) {
                    'critical' => 3,
                    'warning' => 2,
                    default => 1,
                };

                return $rank($b) <=> $rank($a);
            }
        );

        return [
            'available' => true,
            'items' => array_slice($items, 0, self::RISK_LIST_LIMIT),
            'limit' => self::RISK_LIST_LIMIT,
            'message' => '',
        ];
    }

    /**
     * @param array<string, mixed> $signals
     * @return array<string, mixed>
     */
    public static function classifyRisk(array $signals, ?DateTimeImmutable $now = null): array
    {
        $now ??= new DateTimeImmutable('now', new DateTimeZone(date_default_timezone_get()));
        $levelRank = ['ok' => 0, 'warning' => 1, 'critical' => 2];
        $riskLevel = 'ok';
        $reasons = [];
        $flags = [
            'dead_letter_open' => false,
            'outbound_failed' => false,
            'conversation_ticket_state_mismatch' => false,
            'no_recent_activity' => false,
            'reopened_without_activity' => false,
        ];

        $raise = static function (string $level, string $reason) use (&$riskLevel, &$reasons, $levelRank): void {
            if ($levelRank[$level] > $levelRank[$riskLevel]) {
                $riskLevel = $level;
            }
            $reasons[] = $reason;
        };

        if (!empty($signals['has_dead_letter_open'])) {
            $flags['dead_letter_open'] = true;
            $raise('critical', __('Dead-letter aberto relacionado.', 'glpiintegaglpi'));
        }

        if (!empty($signals['has_outbound_failed'])) {
            $flags['outbound_failed'] = true;
            $raise('critical', __('Falha outbound recente relacionada.', 'glpiintegaglpi'));
        }

        $conversationStatus = strtolower(trim((string) ($signals['conversation_status'] ?? '')));
        $ticketStatus = (int) ($signals['ticket_status'] ?? 0);
        $ticketClosed = in_array($ticketStatus, [5, 6], true);
        $ticketOpenKnown = $ticketStatus > 0 && !$ticketClosed;

        if ($conversationStatus === 'open' && $ticketClosed) {
            $flags['conversation_ticket_state_mismatch'] = true;
            $raise('warning', __('Conversa aberta vinculada a ticket fechado.', 'glpiintegaglpi'));
        }

        if ($conversationStatus === 'closed' && $ticketOpenKnown) {
            $flags['conversation_ticket_state_mismatch'] = true;
            $raise('warning', __('Conversa fechada vinculada a ticket aberto.', 'glpiintegaglpi'));
        }

        $lastInteraction = self::parseTimestamp($signals['last_interaction_at'] ?? null);
        $hoursSinceLastInteraction = null;
        if ($lastInteraction !== null) {
            $seconds = max(0, $now->getTimestamp() - $lastInteraction->getTimestamp());
            $hoursSinceLastInteraction = $seconds / 3600;

            if (
                in_array($conversationStatus, ['open', 'awaiting_queue_selection'], true)
                && $hoursSinceLastInteraction > self::CRITICAL_NO_ACTIVITY_HOURS
            ) {
                $flags['no_recent_activity'] = true;
                $raise('critical', __('Vácuo de comunicação acima de 24h.', 'glpiintegaglpi'));
            } elseif (
                in_array($conversationStatus, ['open', 'awaiting_queue_selection'], true)
                && $hoursSinceLastInteraction > self::WARNING_NO_ACTIVITY_HOURS
            ) {
                $flags['no_recent_activity'] = true;
                $raise('warning', __('Vácuo de comunicação acima de 4h.', 'glpiintegaglpi'));
            }
        } elseif (in_array($conversationStatus, ['open', 'awaiting_queue_selection'], true)) {
            $flags['no_recent_activity'] = true;
            $raise('warning', __('Ultima interação WhatsApp indisponível.', 'glpiintegaglpi'));
        }

        if ($reasons === []) {
            $reasons[] = __('Sem risco operacional WhatsApp relevante.', 'glpiintegaglpi');
        }

        return [
            'risk_level' => $riskLevel,
            'risk_label' => self::riskLabel($riskLevel),
            'risk_reason' => $reasons[0],
            'risk_reasons' => array_values(array_unique($reasons)),
            'flags' => $flags,
            'last_interaction_at' => $lastInteraction?->format('Y-m-d H:i:sP'),
            'last_interaction_age' => self::formatAge($hoursSinceLastInteraction),
        ];
    }

    public static function riskLabel(string $riskLevel): string
    {
        return match ($riskLevel) {
            'critical' => __('Crítico', 'glpiintegaglpi'),
            'warning' => __('Atenção', 'glpiintegaglpi'),
            default => __('OK operacional', 'glpiintegaglpi'),
        };
    }

    /**
     * @param list<array<string, mixed>> $primary
     * @param list<array<string, mixed>> $secondary
     * @return list<array<string, mixed>>
     */
    private static function mergeRiskCandidateRows(array $primary, array $secondary): array
    {
        $byId = [];
        foreach (array_merge($primary, $secondary) as $row) {
            $id = (string) ($row['conversation_id'] ?? '');
            if ($id === '') {
                continue;
            }
            if (!isset($byId[$id])) {
                $byId[$id] = $row;
                continue;
            }
            $existing = $byId[$id];
            $preferNew = self::candidatePriorityScore($row) > self::candidatePriorityScore($existing);
            if ($preferNew) {
                $byId[$id] = $row;
            }
        }

        return array_values($byId);
    }

    /**
     * @param array<string, mixed> $row
     */
    private static function candidatePriorityScore(array $row): int
    {
        $dead = !empty($row['has_dead_letter_open']);
        $fail = !empty($row['has_outbound_failed']);

        return ($dead ? 100 : 0) + ($fail ? 90 : 0);
    }

    private static function resolveTicketStatusFromGlpi(int $ticketId): int
    {
        if ($ticketId <= 0 || !class_exists(\Ticket::class)) {
            return 0;
        }

        $ticket = new \Ticket();
        if (!$ticket->getFromDB($ticketId)) {
            return 0;
        }

        return (int) ($ticket->fields['status'] ?? 0);
    }

    private static function parseTimestamp(mixed $value): ?DateTimeImmutable
    {
        $timestamp = trim((string) $value);
        if ($timestamp === '') {
            return null;
        }

        try {
            return new DateTimeImmutable($timestamp, new DateTimeZone(date_default_timezone_get()));
        } catch (Throwable) {
            return null;
        }
    }

    private static function formatAge(?float $hours): string
    {
        if ($hours === null) {
            return __('Indisponível', 'glpiintegaglpi');
        }

        $minutes = (int) floor(max(0, $hours) * 60);
        if ($minutes < 60) {
            return sprintf(__('Há %d minutos', 'glpiintegaglpi'), $minutes);
        }

        $wholeHours = intdiv($minutes, 60);
        if ($wholeHours < 48) {
            return sprintf(__('Há %d horas', 'glpiintegaglpi'), $wholeHours);
        }

        return sprintf(__('Há %d dias', 'glpiintegaglpi'), intdiv($wholeHours, 24));
    }

    private function toBool(mixed $value): bool
    {
        if (is_bool($value)) {
            return $value;
        }

        return in_array(strtolower((string) $value), ['1', 't', 'true', 'yes'], true);
    }

    private function getRepository(): OperationalQualityRepository
    {
        if ($this->repository instanceof OperationalQualityRepository) {
            return $this->repository;
        }

        $this->repository = new OperationalQualityRepository($this->getPdo());

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
