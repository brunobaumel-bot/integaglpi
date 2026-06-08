<?php

declare(strict_types=1);

use GlpiPlugin\Integaglpi\Plugin;
use GlpiPlugin\Integaglpi\Service\PluginConfigService;

include '../../../inc/includes.php';

/**
 * KB Feedback proxy — GLPI-session-gated POST to Node /internal/glpi/ai/kb-feedback.
 *
 * Called from the JS widget. Passes the technician vote to Node
 * which persists it in kb_article_helpfulness (for ranking bias).
 *
 * Read-only for the technician (UI action only).
 * No customer impact. No ticket mutation.
 *
 * Phase: integaglpi_local_kb_rag_technician_copilot_001
 */

header('Content-Type: application/json; charset=UTF-8');
header('Cache-Control: no-store');

function kbFeedbackRespond(array $payload, int $status = 200): void
{
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

Session::checkLoginUser();

if (strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET')) !== 'POST') {
    kbFeedbackRespond(['ok' => false, 'message' => 'Method not allowed.'], 405);
}

$rawBody = (string) file_get_contents('php://input');
$body    = is_string($rawBody) ? (array) json_decode($rawBody, true) : [];
$merged  = array_merge($_POST, is_array($body) ? $body : []);

if (!Plugin::isCsrfValid($merged)) {
    kbFeedbackRespond(['ok' => false, 'message' => 'Token CSRF inválido.'], 403);
}

$kbCandidateId     = isset($merged['kb_candidate_id']) && (int) $merged['kb_candidate_id'] > 0
    ? (int) $merged['kb_candidate_id'] : null;
$glpiKnowbaseitemId = isset($merged['glpi_knowbaseitem_id']) && (int) $merged['glpi_knowbaseitem_id'] > 0
    ? (int) $merged['glpi_knowbaseitem_id'] : null;

if ($kbCandidateId === null && $glpiKnowbaseitemId === null) {
    kbFeedbackRespond(['ok' => false, 'message' => 'kb_candidate_id ou glpi_knowbaseitem_id obrigatório.'], 400);
}

$helpful      = isset($merged['helpful']) && ($merged['helpful'] === true || $merged['helpful'] === 'true');
$ticketId     = isset($merged['ticket_id']) ? (int) $merged['ticket_id'] : null;
$technicianId = Plugin::getCurrentUserId() ?: null;
$feedbackText = mb_substr(strip_tags((string) ($merged['feedback_text'] ?? '')), 0, 400, 'UTF-8');
$source       = 'kb_rag_copilot';

$configService = new PluginConfigService();
$nodeUrl       = rtrim($configService->getIntegrationServiceUrl(), '/');
$authKey       = $configService->getIntegrationAuthKey();

if ($authKey === '') {
    kbFeedbackRespond(['ok' => false, 'message' => 'Integração não configurada.'], 503);
}

$payload = json_encode([
    'kb_candidate_id'      => $kbCandidateId,
    'glpi_knowbaseitem_id' => $glpiKnowbaseitemId,
    'ticket_id'            => $ticketId,
    'technician_id'        => $technicianId,
    'helpful'              => $helpful,
    'feedback_text'        => $feedbackText !== '' ? $feedbackText : null,
    'source'               => $source,
], JSON_UNESCAPED_UNICODE);

$ctx = stream_context_create([
    'http' => [
        'method'        => 'POST',
        'header'        => implode("\r\n", [
            'Content-Type: application/json; charset=UTF-8',
            'Accept: application/json',
            'Authorization: Bearer ' . $authKey,
            'X-Integaglpi-Key: ' . $authKey,
            'Connection: close',
        ]),
        'content'       => $payload,
        'timeout'       => 5,
        'ignore_errors' => true,
    ],
]);

$raw = @file_get_contents($nodeUrl . '/internal/glpi/ai/kb-feedback', false, $ctx);
if ($raw === false) {
    kbFeedbackRespond(['ok' => false, 'message' => 'Serviço de feedback indisponível.'], 503);
}

$data = json_decode($raw, true);
kbFeedbackRespond(is_array($data) ? $data : ['ok' => false, 'message' => 'Resposta inválida.']);
