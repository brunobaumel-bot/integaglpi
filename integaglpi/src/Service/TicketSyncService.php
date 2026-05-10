<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi\Service;

use GlpiPlugin\Integaglpi\External\ExternalDatabase;
use GlpiPlugin\Integaglpi\External\Repository\ConversationRepository;
use Throwable;

/**
 * Sincroniza o status da conversation no PostgreSQL quando o ticket GLPI é fechado/solucionado.
 */
final class TicketSyncService
{
    private PluginConfigService $pluginConfigService;

    public function __construct(?PluginConfigService $pluginConfigService = null)
    {
        $this->pluginConfigService = $pluginConfigService ?? new PluginConfigService();
    }

    /**
     * Fecha a conversation vinculada ao ticket, se existir e não estiver fechada.
     * Loga [integaglpi][ticket][SYNC_CLOSE] quando uma conversation vinculada é encontrada.
     */
    public function syncCloseByTicket(int $ticketId): void
    {
        if (!$this->pluginConfigService->isConfigured()) {
            error_log('[integaglpi][ticket][SYNC_CLOSE][skip] plugin external database is not configured ticket_id=' . $ticketId);

            return;
        }

        try {
            $pdo  = ExternalDatabase::getConnection($this->pluginConfigService->getConnectionConfig());
            $repo = new ConversationRepository($pdo);

            $conversation = $repo->findByTicketId($ticketId);
            if ($conversation === null) {
                error_log('[integaglpi][ticket][SYNC_CLOSE][skip] no conversation found for ticket_id=' . $ticketId);

                return;
            }

            $conversationId = isset($conversation['conversation_id']) ? trim((string) $conversation['conversation_id']) : '';
            if ($conversationId === '') {
                error_log('[integaglpi][ticket][SYNC_CLOSE][skip] conversation_id missing ticket_id=' . $ticketId);

                return;
            }

            $repo->close($ticketId, $conversationId);
        } catch (Throwable $e) {
            error_log('[integaglpi][ticket][SYNC_CLOSE][error] ticket_id=' . $ticketId . ' ' . $e->getMessage());
            error_log($e->getTraceAsString());

            return;
        }

        error_log('[integaglpi][ticket][SYNC_CLOSE] ' . json_encode([
            'ticket_id'       => $ticketId,
            'conversation_id' => $conversationId,
        ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
    }
}
