<?php

declare(strict_types=1);

use GlpiPlugin\Integaglpi\Plugin;
use GlpiPlugin\Integaglpi\Service\NativeKnowledgeBaseService;
use GlpiPlugin\Integaglpi\Service\IntegrationServiceClient;

include '../../../inc/includes.php';

Session::checkLoginUser();
Plugin::requireSupervisorRead();

$ticketId = (int) ($_POST['ticket_id'] ?? 0);
$conversationId = trim((string) ($_POST['conversation_id'] ?? ''));
$action = trim((string) ($_POST['action'] ?? ''));

try {
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
        throw new RuntimeException(__('Método inválido para análise IA.', 'glpiintegaglpi'));
    }

    if (!Plugin::isCsrfValid($_POST)) {
        throw new RuntimeException(__('Token CSRF inválido. Recarregue a página e tente novamente.', 'glpiintegaglpi'));
    }

    if (!Plugin::isAiSupervisorEnabled()) {
        throw new RuntimeException(__('IA supervisora está desativada neste ambiente.', 'glpiintegaglpi'));
    }

    if ($ticketId <= 0 || $conversationId === '') {
        throw new RuntimeException(__('Ticket e conversa são obrigatórios para análise IA.', 'glpiintegaglpi'));
    }

    $ticket = new Ticket();
    if (!$ticket->getFromDB($ticketId)) {
        throw new RuntimeException(__('Ticket não encontrado para análise IA.', 'glpiintegaglpi'));
    }

    $ticket->check($ticketId, READ);

    $client = new IntegrationServiceClient();
    if ($action === 'analyze') {
        $kbContext = (new NativeKnowledgeBaseService())->buildRelatedArticlesContext([
            'ticket_name' => (string) ($ticket->fields['name'] ?? ''),
            'summary' => (string) ($ticket->fields['content'] ?? ''),
        ], 5);

        $response = $client->requestAiQualityAnalysis([
            'conversation_id' => $conversationId,
            'glpi_ticket_id' => $ticketId,
            'glpi_user_id' => Plugin::getCurrentUserId(),
            'kb_context' => $kbContext,
        ]);

        if (!($response['success'] ?? false)) {
            throw new RuntimeException(__('Não foi possível concluir a análise IA agora.', 'glpiintegaglpi'));
        }

        Session::addMessageAfterRedirect(__('Análise IA registrada para revisão humana.', 'glpiintegaglpi'));
    } elseif ($action === 'feedback') {
        $analysisId = (int) ($_POST['analysis_id'] ?? 0);
        $feedback = trim((string) ($_POST['feedback'] ?? ''));
        $feedbackNotes = trim((string) ($_POST['feedback_notes'] ?? ''));
        if ($analysisId <= 0 || !in_array($feedback, ['useful', 'not_useful', 'incorrect'], true)) {
            throw new RuntimeException(__('Feedback IA inválido.', 'glpiintegaglpi'));
        }

        $response = $client->submitAiQualityFeedback([
            'analysis_id' => $analysisId,
            'feedback' => $feedback,
            'feedback_notes' => $feedbackNotes,
            'glpi_user_id' => Plugin::getCurrentUserId(),
        ]);

        if (!($response['success'] ?? false)) {
            throw new RuntimeException(__('Não foi possível salvar o feedback da análise IA agora.', 'glpiintegaglpi'));
        }

        Session::addMessageAfterRedirect(__('Feedback da análise IA salvo.', 'glpiintegaglpi'));
    } else {
        throw new RuntimeException(__('Ação de análise IA inválida.', 'glpiintegaglpi'));
    }
} catch (Throwable $exception) {
    error_log('[integaglpi][ai_quality][error] ticket_id=' . $ticketId . ' conversation_id=' . substr($conversationId, 0, 12) . ' message=' . $exception->getMessage());
    Session::addMessageAfterRedirect($exception->getMessage(), false, ERROR);
}

Html::redirect(Plugin::getTicketUrl($ticketId) . '&forcetab=PluginIntegaglpiTicketRuntime$2');
