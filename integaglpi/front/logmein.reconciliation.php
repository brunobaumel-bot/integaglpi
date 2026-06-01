<?php

declare(strict_types=1);

use GlpiPlugin\Integaglpi\GestaoGroupMenu;
use GlpiPlugin\Integaglpi\Plugin;
use GlpiPlugin\Integaglpi\Service\IntegrationServiceClient;
use GlpiPlugin\Integaglpi\Service\PluginConfigService;
use GlpiPlugin\Integaglpi\Service\SecurityAuditService;
use GlpiPlugin\Integaglpi\Service\SecurityPermissionService;

include '../../../inc/includes.php';

Session::checkLoginUser();

if (!SecurityPermissionService::hasRight(SecurityPermissionService::RIGHT_MANAGE_LOGMEIN_RECONCILIATION)) {
    Html::displayRightError();
}

$escape   = static fn (mixed $v): string => htmlspecialchars((string) $v, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
$csrfToken = Plugin::getCsrfToken();
$flash     = null;
$apiBase   = Plugin::getIntegrationServiceApiBase();
$apiKey    = trim((new PluginConfigService())->getIntegrationAuthKey());
if ($apiKey === '') {
    $apiKey = Plugin::getRuntimeConfigValue('INTEGRATION_SERVICE_API_KEY');
}

// ── POST actions ─────────────────────────────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (!Plugin::isCsrfValid($_POST)) {
        $flash = ['type' => 'danger', 'message' => __('Token CSRF inválido.', 'glpiintegaglpi')];
    } else {
        $action = trim((string) ($_POST['action'] ?? ''));

        if ($action === 'resolve_item') {
            // Resolve a regularization queue item (link ticket, ignore, etc.).
            $itemId    = (int) ($_POST['item_id'] ?? 0);
            $newStatus = trim((string) ($_POST['new_status'] ?? ''));
            $ticketId  = max(0, (int) ($_POST['ticket_id'] ?? 0));
            $taskId    = max(0, (int) ($_POST['task_id'] ?? 0));
            $note      = mb_substr(trim((string) ($_POST['note'] ?? '')), 0, 500, 'UTF-8');
            $userId    = Plugin::getCurrentUserId();

            $allowedStatuses = ['matched_ticket', 'ignored_duplicate', 'out_of_scope', 'no_ticket_found'];
            if ($itemId > 0 && in_array($newStatus, $allowedStatuses, true) && $apiBase !== '' && $apiKey !== '') {
                $payload = [
                    'status'  => $newStatus,
                    'user_id' => $userId,
                    'note'    => $note,
                ];
                if ($ticketId > 0) {
                    $payload['ticket_id'] = $ticketId;
                }
                if ($taskId > 0) {
                    $payload['task_id'] = $taskId;
                }

                $ch = curl_init($apiBase . '/internal/glpi/logmein/reconciliation/queue/' . $itemId . '/resolve');
                curl_setopt_array($ch, [
                    CURLOPT_RETURNTRANSFER => true,
                    CURLOPT_POST           => true,
                    CURLOPT_POSTFIELDS     => json_encode($payload),
                    CURLOPT_HTTPHEADER     => [
                        'Content-Type: application/json',
                        'Authorization: Bearer ' . $apiKey,
                        'Accept: application/json',
                    ],
                    CURLOPT_TIMEOUT        => 10,
                    CURLOPT_SSL_VERIFYPEER => true,
                ]);
                $body = curl_exec($ch);
                $httpCode = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
                curl_close($ch);

                $decoded = is_string($body) ? json_decode($body, true) : null;
                if ($httpCode === 200 && is_array($decoded) && ($decoded['ok'] ?? false)) {
                    SecurityAuditService::logReconciliationAction($newStatus, $itemId, [
                        'ticket_id' => $ticketId > 0 ? $ticketId : null,
                        'task_id'   => $taskId > 0 ? $taskId : null,
                        'note_length' => strlen($note),
                    ]);
                    $flash = ['type' => 'success', 'message' => __('Item resolvido com sucesso.', 'glpiintegaglpi')];
                } else {
                    $errMsg = is_array($decoded) ? (string) ($decoded['message'] ?? '') : '';
                    $flash = [
                        'type' => 'danger',
                        'message' => __('Erro ao resolver item: ', 'glpiintegaglpi') . htmlspecialchars($errMsg, ENT_QUOTES, 'UTF-8'),
                    ];
                }
            } else {
                $flash = ['type' => 'warning', 'message' => __('Parâmetros inválidos ou integração não configurada.', 'glpiintegaglpi')];
            }

        } elseif ($action === 'create_task') {
            // Create a GLPI task after human confirmation.
            // Duplicate prevention: each remote session may generate AT MOST one
            // GLPI task. GLPI itself is the source of truth — a structured marker
            // (LOGMEIN-SESSION-REF:<hash>) is embedded in the private task content,
            // and we query glpi_tickettasks for it before creating a new one. The
            // glpi_task_id is then persisted back to the regularization queue.
            global $DB;

            $ticketId      = (int) ($_POST['ticket_id'] ?? 0);
            $durationMins  = max(0, (int) ($_POST['duration_minutes'] ?? 0));
            $sessionIdHash = trim((string) ($_POST['session_id_hash'] ?? ''));
            $queueItemId   = (int) ($_POST['item_id'] ?? 0);
            $userId        = Plugin::getCurrentUserId();

            // Marker must be a safe, bounded hex token (16 chars from sha256 prefix).
            $isValidHash = $sessionIdHash !== '' && preg_match('/^[a-f0-9]{8,64}$/', $sessionIdHash) === 1;

            if ($ticketId > 0 && $durationMins > 0 && $isValidHash && $queueItemId > 0) {
                $taskMarker = 'LOGMEIN-SESSION-REF:' . $sessionIdHash;

                // ── Backend duplicate guard (source of truth = GLPI tickettasks) ──
                $duplicate = false;
                if (isset($DB) && is_object($DB) && method_exists($DB, 'request')) {
                    foreach ($DB->request([
                        'FROM'  => 'glpi_tickettasks',
                        'WHERE' => ['content' => ['LIKE', '%' . $taskMarker . '%']],
                        'LIMIT' => 1,
                    ]) as $existingTaskRow) {
                        $duplicate = true;
                        $existingTaskId = (int) ($existingTaskRow['id'] ?? 0);
                    }
                }

                if ($duplicate) {
                    SecurityAuditService::logReconciliationAction('create_task_duplicate_blocked', $queueItemId, [
                        'ticket_id'        => $ticketId,
                        'session_id_hash'  => $sessionIdHash,
                        'existing_task_id' => $existingTaskId ?? 0,
                    ]);
                    $flash = [
                        'type' => 'warning',
                        'message' => __('Tarefa já vinculada a esta sessão remota. Duplicidade bloqueada.', 'glpiintegaglpi'),
                    ];
                } else {
                    $ticket = new \Ticket();
                    if ($ticket->getFromDB($ticketId) && $ticket->can($ticketId, READ)) {
                        $task = new \TicketTask();
                        $taskContent = __('[LogMeIn] Acesso remoto conciliado. Duração registrada após confirmação humana.', 'glpiintegaglpi')
                            . "\n" . $taskMarker;
                        $taskId = $task->add([
                            'tickets_id'     => $ticketId,
                            'content'        => $taskContent,
                            'actiontime'     => $durationMins * 60,
                            'is_private'     => 1,  // private note — no public follow-up with internal metadata
                            'users_id_tech'  => $userId,
                            'state'          => \Planning::DONE,
                        ]);
                        if ($taskId > 0) {
                            // Persist glpi_task_id back to the queue (backend source of
                            // truth) via the resolve endpoint, marking it matched.
                            if ($apiBase !== '' && $apiKey !== '') {
                                $linkPayload = [
                                    'status'    => 'matched_ticket',
                                    'user_id'   => $userId,
                                    'ticket_id' => $ticketId,
                                    'task_id'   => $taskId,
                                ];
                                $lch = curl_init($apiBase . '/internal/glpi/logmein/reconciliation/queue/' . $queueItemId . '/resolve');
                                curl_setopt_array($lch, [
                                    CURLOPT_RETURNTRANSFER => true,
                                    CURLOPT_POST           => true,
                                    CURLOPT_POSTFIELDS     => json_encode($linkPayload),
                                    CURLOPT_HTTPHEADER     => [
                                        'Content-Type: application/json',
                                        'Authorization: Bearer ' . $apiKey,
                                        'Accept: application/json',
                                    ],
                                    CURLOPT_TIMEOUT        => 10,
                                    CURLOPT_SSL_VERIFYPEER => true,
                                ]);
                                curl_exec($lch);
                                curl_close($lch);
                            }

                            SecurityAuditService::logGlpiTaskCreated($ticketId, $taskId, [
                                'duration_minutes' => $durationMins,
                                'session_id_hash'  => $sessionIdHash,
                                'queue_item_id'    => $queueItemId,
                            ]);
                            $flash = ['type' => 'success', 'message' => sprintf(__('Tarefa GLPI #%d criada no ticket #%d.', 'glpiintegaglpi'), $taskId, $ticketId)];
                        } else {
                            $flash = ['type' => 'danger', 'message' => __('Falha ao criar tarefa GLPI.', 'glpiintegaglpi')];
                        }
                    } else {
                        $flash = ['type' => 'danger', 'message' => __('Ticket não encontrado ou sem permissão.', 'glpiintegaglpi')];
                    }
                }
            } else {
                $flash = ['type' => 'warning', 'message' => __('Informe ticket_id, duração e item válidos.', 'glpiintegaglpi')];
            }
        } elseif ($action === 'sync_reconciliation') {
            // ── Manual read-only reconciliation sync ──────────────────────────
            // Calls POST /internal/glpi/logmein/reconciliation/sync on the Node.
            // This fetches remote-access session data from the LogMeIn reports API
            // and populates the local ledger. No session is initiated remotely.
            // No ticket is created or modified. No WhatsApp is sent.
            $client   = new IntegrationServiceClient(new PluginConfigService());
            try {
                $response = $client->syncLogmeinReconciliation([
                    'requested_by_glpi_user_id' => Plugin::getCurrentUserId(),
                    'read_only'                 => true,
                ]);
                $body     = is_array($response['body'] ?? null) ? $response['body'] : [];
                $httpCode = (int) ($response['status'] ?? 0);

                if ($response['success'] ?? false) {
                    $sessionsFound   = (int) ($body['sessions_found']   ?? $body['sessionsFound']   ?? 0);
                    $sessionsInserted= (int) ($body['sessions_inserted']?? $body['sessionsInserted']?? 0);
                    $syncStatus      = (string) ($body['status'] ?? 'completed');
                    $flash = [
                        'type'    => 'success',
                        'message' => sprintf(
                            __('Sync de conciliação executado (%s): %d sessões encontradas, %d inseridas no ledger.', 'glpiintegaglpi'),
                            htmlspecialchars($syncStatus, ENT_QUOTES, 'UTF-8'),
                            $sessionsFound,
                            $sessionsInserted
                        ),
                    ];
                } elseif ($httpCode === 404) {
                    $flash = [
                        'type'    => 'warning',
                        'message' => __('Rota de sync de conciliação não encontrada (404). Verifique se a feature flag LOGMEIN_RECONCILIATION_ENABLED está ativa no integration-service e se o container foi reconstruído.', 'glpiintegaglpi'),
                    ];
                } elseif ($httpCode === 401 || $httpCode === 403) {
                    $flash = [
                        'type'    => 'danger',
                        'message' => __('Autenticação interna inválida (401/403). Verifique integration_auth_key na configuração do plugin.', 'glpiintegaglpi'),
                    ];
                } elseif ($httpCode === 409) {
                    $flash = [
                        'type'    => 'info',
                        'message' => __('Sync em andamento ou migration 043 pendente. Aguarde e tente novamente.', 'glpiintegaglpi'),
                    ];
                } else {
                    // The Node returns a sanitized report-error category (no body/token).
                    $reportError = (string) ($body['report_error'] ?? '');
                    $reportCode  = isset($body['report_status_code']) && $body['report_status_code'] !== null
                        ? (int) $body['report_status_code'] : 0;
                    $errMsg = (string) ($body['message'] ?? __('Indisponível.', 'glpiintegaglpi'));
                    $suffix = '';
                    if ($reportError !== '') {
                        $suffix = ' [' . htmlspecialchars($reportError, ENT_QUOTES, 'UTF-8')
                            . ($reportCode > 0 ? ' / HTTP ' . $reportCode : '') . ']';
                    }
                    $flash  = [
                        'type'    => 'danger',
                        'message' => __('Falha no sync de conciliação: ', 'glpiintegaglpi')
                            . htmlspecialchars(mb_substr($errMsg, 0, 200), ENT_QUOTES, 'UTF-8') . $suffix,
                    ];
                }
            } catch (\Throwable $e) {
                $flash = [
                    'type'    => 'danger',
                    'message' => __('Erro ao acionar sync de conciliação: integration-service inacessível.', 'glpiintegaglpi'),
                ];
                error_log('[integaglpi][reconciliation][sync_trigger] ' . mb_substr(strip_tags($e->getMessage()), 0, 240));
            }
        } else {
            $flash = ['type' => 'danger', 'message' => __('Ação desconhecida.', 'glpiintegaglpi')];
        }
    }
}

// ── Fetch queue from integration-service ──────────────────────────────────────
$queueData     = null;
$queueError    = null;
$filterStatus  = trim((string) ($_GET['status'] ?? ''));
$filterEntity  = max(0, (int) ($_GET['entity_id'] ?? 0));
$page          = max(1, (int) ($_GET['page'] ?? 1));
$limit         = 25;

if ($apiBase !== '' && $apiKey !== '') {
    $queryParams = http_build_query(array_filter([
        'status'    => $filterStatus !== '' ? $filterStatus : null,
        'entity_id' => $filterEntity > 0 ? $filterEntity : null,
        'page'      => $page,
        'limit'     => $limit,
    ]));
    $ch = curl_init($apiBase . '/internal/glpi/logmein/reconciliation/queue?' . $queryParams);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPGET        => true,
        CURLOPT_HTTPHEADER     => [
            'Authorization: Bearer ' . $apiKey,
            'Accept: application/json',
        ],
        CURLOPT_TIMEOUT        => 10,
        CURLOPT_SSL_VERIFYPEER => true,
    ]);
    $body     = curl_exec($ch);
    $httpCode = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($httpCode === 200 && is_string($body)) {
        $decoded = json_decode($body, true);
        if (is_array($decoded)) {
            $queueData = $decoded;
        } else {
            $queueError = __('Resposta inválida da fila de conciliação.', 'glpiintegaglpi');
        }
    } elseif ($httpCode === 409) {
        $queueError = __('Integration-service indisponível ou migration 043 pendente.', 'glpiintegaglpi');
    } else {
        $queueError = __('Fila de conciliação temporariamente indisponível (HTTP ', 'glpiintegaglpi') . $httpCode . ').';
    }
} else {
    $queueError = __('Integration-service não configurado (INTEGRATION_SERVICE_API_KEY ausente).', 'glpiintegaglpi');
}

Html::header(__('Conciliação de Acessos Remotos LogMeIn', 'glpiintegaglpi'), $_SERVER['PHP_SELF'], 'plugins', GestaoGroupMenu::class);

include __DIR__ . '/../templates/logmein_reconciliation.php';

Html::footer();
