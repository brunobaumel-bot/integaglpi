<?php

declare(strict_types=1);

/** @var \GlpiPlugin\Integaglpi\Renderer\TicketTabRenderer $this */
/** @var array<string, mixed>|null $runtime */
/** @var list<array<string, mixed>> $messages */
/** @var list<array<string, mixed>> $queues */
/** @var bool $isExternalConfigured */
/** @var array<string, mixed> $connectionConfig */
/** @var \Ticket $ticket */

$timelineId = 'integaglpi-timeline-' . (int) $ticket->getID();
$runtimeView = is_array($runtime) ? $runtime : [];
$assignedUserId = isset($runtimeView['assigned_user_id_int']) ? (int) $runtimeView['assigned_user_id_int'] : 0;
$statusValue = strtolower(trim((string) ($runtimeView['status'] ?? 'open')));
$isClosed = array_key_exists('is_closed', $runtimeView)
    ? (bool) $runtimeView['is_closed']
    : $statusValue === 'closed';
$canClaim = array_key_exists('can_claim', $runtimeView)
    ? (bool) $runtimeView['can_claim']
    : !$isClosed;
$canTransfer = array_key_exists('can_transfer', $runtimeView)
    ? (bool) $runtimeView['can_transfer']
    : !$isClosed;
$canClose = array_key_exists('can_close', $runtimeView)
    ? (bool) $runtimeView['can_close']
    : !$isClosed;
?>
<div class="card mb-3">
    <div class="card-header"><?= $this->escape(__('WhatsApp', 'glpiintegaglpi')); ?></div>
    <div class="card-body">
        <?php if (!$isExternalConfigured) { ?>
            <div class="alert alert-warning mb-0">
                <?= $this->escape(__('Configure the external PostgreSQL connection on the plugin administration page before using the WhatsApp tab.', 'glpiintegaglpi')); ?>
            </div>
        <?php } elseif ($runtime === null) { ?>
            <div class="alert alert-info mb-0">
                <?= $this->escape(__('No WhatsApp conversation is linked to this ticket yet.', 'glpiintegaglpi')); ?>
            </div>
        <?php } else { ?>
            <div class="row g-3">
                <div class="col-md-3">
                    <strong><?= $this->escape(__('Phone', 'glpiintegaglpi')); ?></strong><br>
                    <?= $this->escape((string) ($runtime['phone_e164'] ?? '-')); ?>
                </div>
                <div class="col-md-3">
                    <strong><?= $this->escape(__('Contact name', 'glpiintegaglpi')); ?></strong><br>
                    <?= $this->escape((string) ($runtime['contact_name'] ?? __('Unknown', 'glpiintegaglpi'))); ?>
                </div>
                <div class="col-md-3">
                    <strong><?= $this->escape(__('Conversation status', 'glpiintegaglpi')); ?></strong><br>
                    <span class="badge <?= $isClosed ? 'bg-danger' : 'bg-success'; ?>"><?= $this->escape((string) ($runtime['status'] ?? 'open')); ?></span>
                </div>
                <div class="col-md-3">
                    <strong><?= $this->escape(__('Current queue', 'glpiintegaglpi')); ?></strong><br>
                    <?= $this->escape((string) ($runtime['queue_label'] ?? __('No queue', 'glpiintegaglpi'))); ?>
                </div>
                <div class="col-md-3">
                    <strong><?= $this->escape(__('Default group of queue', 'glpiintegaglpi')); ?></strong><br>
                    <?= $this->escape((string) ($runtime['queue_default_group_label'] ?? __('No group', 'glpiintegaglpi'))); ?>
                </div>
                <div class="col-md-3">
                    <strong><?= $this->escape(__('Current technician', 'glpiintegaglpi')); ?></strong><br>
                    <?= $this->escape((string) ($runtime['assigned_user_label'] ?? __('Unassigned', 'glpiintegaglpi'))); ?>
                </div>
                <div class="col-md-3">
                    <strong><?= $this->escape(__('Assigned group', 'glpiintegaglpi')); ?></strong><br>
                    <?= $this->escape((string) ($runtime['assigned_group_label'] ?? __('No group', 'glpiintegaglpi'))); ?>
                </div>
                <div class="col-md-3">
                    <strong><?= $this->escape(__('Linked GLPI ticket', 'glpiintegaglpi')); ?></strong><br>
                    #<?= (int) $ticket->getID(); ?>
                </div>
                <div class="col-md-3">
                    <strong><?= $this->escape(__('Last message at', 'glpiintegaglpi')); ?></strong><br>
                    <?= $this->escape((string) ($runtime['last_message_at'] ?? '-')); ?>
                </div>
            </div>

            <?php if ($isClosed) { ?>
                <div class="alert alert-danger mt-3 mb-0">
                    <strong><?= $this->escape(__('Conversa encerrada', 'glpiintegaglpi')); ?></strong><br>
                    <?= $this->escape(__('Closed at', 'glpiintegaglpi')); ?>:
                    <?= $this->escape((string) ($runtime['closed_at'] ?? '-')); ?>
                </div>
            <?php } elseif (!$isClosed && $assignedUserId > 0) { ?>
                <div class="alert alert-success mt-3 mb-0">
                    <?= $this->escape(sprintf(
                        __('Atendimento assumido por %s', 'glpiintegaglpi'),
                        (string) ($runtime['assigned_user_label'] ?? (string) $assignedUserId)
                    )); ?>
                    <?php if (!empty($runtime['claimed_at'])) { ?>
                        <br><span class="text-muted small"><?= $this->escape(__('Claimed at', 'glpiintegaglpi')); ?>: <?= $this->escape((string) $runtime['claimed_at']); ?></span>
                    <?php } ?>
                </div>
            <?php } else { ?>
                <div class="alert alert-info mt-3 mb-0">
                    <?= $this->escape(__('Conversation open and waiting assignment.', 'glpiintegaglpi')); ?>
                </div>
            <?php } ?>
        <?php } ?>
    </div>
</div>

<?php if ($isExternalConfigured && $runtime !== null && \GlpiPlugin\Integaglpi\Plugin::canUpdate()) { ?>
    <div class="row g-3 mb-3">
        <?php
        $actionBaseUrl = \GlpiPlugin\Integaglpi\Plugin::getTicketActionUrl();
        $ticketIdForDebug = (int) $ticket->getID();
        $conversationIdForDebug = (string) ($runtime['conversation_id'] ?? '');
        $debugBaseParams = [
            'debug_get' => '1',
            'ticket_id' => (string) $ticketIdForDebug,
            'conversation_id' => $conversationIdForDebug,
        ];
        $buildDebugUrl = static function (array $params) use ($actionBaseUrl): string {
            return $actionBaseUrl . '?' . http_build_query($params, '', '&', PHP_QUERY_RFC3986);
        };
        ?>
        <?php if ($canClaim) { ?>
            <div class="col-md-4">
                <div class="card h-100">
                    <div class="card-header"><?= $this->escape(__('Assume attendance', 'glpiintegaglpi')); ?></div>
                    <div class="card-body">
                        <a
                            class="btn btn-primary"
                            href="<?= $this->escape($buildDebugUrl($debugBaseParams + ['whatsapp_action' => 'claim'])); ?>"
                        ><?= $this->escape($assignedUserId > 0
                            ? __('Assumir para mim', 'glpiintegaglpi')
                            : __('Assumir atendimento', 'glpiintegaglpi')); ?></a>
                    </div>
                </div>
            </div>
        <?php } ?>

        <?php if ($canTransfer) { ?>
            <div class="col-md-4">
                <div class="card h-100">
                    <div class="card-header"><?= $this->escape(__('Transfer queue', 'glpiintegaglpi')); ?></div>
                    <div class="card-body">
                        <form method="get" action="<?= $this->escape($actionBaseUrl); ?>">
                            <input type="hidden" name="debug_get" value="1">
                            <input type="hidden" name="ticket_id" value="<?= (int) $ticketIdForDebug; ?>">
                            <input type="hidden" name="conversation_id" value="<?= $this->escape((string) $conversationIdForDebug); ?>">
                            <input type="hidden" name="whatsapp_action" value="transfer">
                            <select name="queue_id" class="form-select mb-2 js-integaglpi-wa-queue">
                                <option value=""><?= $this->escape(__('Select a queue', 'glpiintegaglpi')); ?></option>
                                <?php foreach ($queues as $queue) { ?>
                                    <option
                                        value="<?= (int) $queue['id']; ?>"
                                        <?= (int) ($runtime['queue_id'] ?? 0) === (int) $queue['id'] ? "selected='selected'" : ''; ?>
                                    >
                                        <?= $this->escape((string) $queue['name']); ?>
                                    </option>
                                <?php } ?>
                            </select>
                            <button type="submit" class="btn btn-outline-primary"><?= $this->escape(__('Transferir', 'glpiintegaglpi')); ?></button>
                        </form>

                        <details class="mt-3">
                            <summary class="small text-muted"><?= $this->escape(__('Outras opções de transferência', 'glpiintegaglpi')); ?></summary>
                            <div class="d-flex flex-wrap gap-2 mt-2">
                                <?php foreach ($queues as $queue) { ?>
                                    <a
                                        class="btn btn-sm btn-outline-primary"
                                        href="<?= $this->escape($buildDebugUrl($debugBaseParams + [
                                            'whatsapp_action' => 'transfer',
                                            'queue_id' => (string) (int) ($queue['id'] ?? 0),
                                        ])); ?>"
                                    >
                                        <?= $this->escape(sprintf(
                                            __('Transferir para %s', 'glpiintegaglpi'),
                                            (string) ($queue['name'] ?? (string) ($queue['id'] ?? ''))
                                        )); ?>
                                    </a>
                                <?php } ?>
                            </div>
                        </details>
                    </div>
                </div>
            </div>
        <?php } ?>

        <?php if ($canClose) { ?>
            <div class="col-md-4">
                <div class="card h-100">
                    <div class="card-header"><?= $this->escape(__('Close conversation', 'glpiintegaglpi')); ?></div>
                    <div class="card-body">
                        <a
                            class="btn btn-outline-danger"
                            href="<?= $this->escape($buildDebugUrl($debugBaseParams + ['whatsapp_action' => 'close'])); ?>"
                        ><?= $this->escape(__('Encerrar conversa', 'glpiintegaglpi')); ?></a>
                    </div>
                </div>
            </div>
        <?php } ?>

        <?php if ($isClosed) { ?>
            <div class="col-md-4">
                <div class="card h-100">
                    <div class="card-header"><?= $this->escape(__('Reabrir atendimento', 'glpiintegaglpi')); ?></div>
                    <div class="card-body">
                        <p class="small text-muted mb-2"><?= $this->escape(__('A conversa está encerrada. Reabra para continuar respondendo o cliente.', 'glpiintegaglpi')); ?></p>
                        <a
                            class="btn btn-outline-primary"
                            href="<?= $this->escape($buildDebugUrl($debugBaseParams + ['whatsapp_action' => 'reopen'])); ?>"
                        ><?= $this->escape(__('Reabrir atendimento', 'glpiintegaglpi')); ?></a>
                    </div>
                </div>
            </div>
        <?php } ?>
    </div>
<?php } ?>

<div class="card">
    <div class="card-header"><?= $this->escape(__('Conversation timeline', 'glpiintegaglpi')); ?></div>
    <div class="card-body">
        <?php if (!$isExternalConfigured) { ?>
            <p class="mb-0 text-muted"><?= $this->escape(__('The timeline becomes available after configuring the external PostgreSQL connection.', 'glpiintegaglpi')); ?></p>
        <?php } elseif ($runtime === null || $messages === []) { ?>
            <p class="mb-0 text-muted"><?= $this->escape(__('No WhatsApp messages were found for this ticket.', 'glpiintegaglpi')); ?></p>
        <?php } else { ?>
            <div
                id="<?= $this->escape($timelineId); ?>"
                class="border rounded p-3"
                style="max-height: 500px; overflow-y: auto; background: var(--tblr-bg-surface, #f8f9fa);"
            >
                <?php foreach ($messages as $message) { ?>
                    <?php
                    $isInbound    = (string) ($message['direction'] ?? 'inbound') === 'inbound';
                    $wrapAlign    = $isInbound ? 'justify-content-start' : 'justify-content-end';
                    $bubbleBg     = $isInbound ? '#f0f2f5' : '#dcf8c6';
                    $bubbleBorder = $isInbound ? '#d0d4d8' : '#a8d8a8';
                    $senderLabel  = $isInbound
                        ? $this->escape(__('Cliente', 'glpiintegaglpi'))
                        : ($assignedUserId > 0
                            ? $this->escape((string) ($runtime['assigned_user_label'] ?? __('Técnico', 'glpiintegaglpi')))
                            : $this->escape(__('Técnico', 'glpiintegaglpi')));
                    $senderColor  = $isInbound ? '#6c757d' : '#1a7a3c';
                    $timestamp    = $this->escape((string) ($message['created_at'] ?? ''));
                    ?>
                    <div class="d-flex <?= $wrapAlign; ?>" style="margin-bottom: 12px;">
                        <div style="
                            max-width: 65%;
                            padding: 10px 12px;
                            border-radius: 12px;
                            background: <?= $bubbleBg; ?>;
                            border: 1px solid <?= $bubbleBorder; ?>;
                            word-break: break-word;
                            box-shadow: 0 1px 2px rgba(0,0,0,.08);
                        ">
                            <div style="display: flex; justify-content: space-between; align-items: baseline; gap: 8px; margin-bottom: 4px;">
                                <span style="font-size: .72rem; font-weight: 600; color: <?= $senderColor; ?>; text-transform: uppercase; letter-spacing: .04em;"><?= $senderLabel; ?></span>
                                <span style="font-size: .68rem; color: #9aa0a6; white-space: nowrap;"><?= $timestamp; ?></span>
                            </div>
                            <div style="font-size: .875rem; line-height: 1.45;"><?= nl2br($this->escape((string) ($message['message_text'] ?? ''))); ?></div>
                            <?php if (!empty($message['glpi_sync_status'])) { ?>
                                <div style="font-size: .65rem; color: #9aa0a6; margin-top: 4px;"><?= $this->escape((string) $message['glpi_sync_status']); ?></div>
                            <?php } ?>
                        </div>
                    </div>
                <?php } ?>
            </div>
            <script>
                (function ($) {
                    const selector = '#<?= $this->escape($timelineId); ?>';
                    const scrollToBottom = function () {
                        const $timeline = $(selector);
                        if ($timeline.length === 0 || $timeline.children().length === 0) {
                            return;
                        }

                        const node = $timeline.get(0);
                        window.requestAnimationFrame(function () {
                            node.scrollTop = node.scrollHeight;
                        });
                    };

                    scrollToBottom();
                    $(document)
                        .off('ajaxComplete.integaglpiTimeline<?= (int) $ticket->getID(); ?>')
                        .on('ajaxComplete.integaglpiTimeline<?= (int) $ticket->getID(); ?>', function () {
                            setTimeout(scrollToBottom, 30);
                        });

                    const target = $(selector).get(0);
                    if (target && !target.dataset.integaglpiObserverAttached) {
                        const observer = new MutationObserver(function () {
                            scrollToBottom();
                        });

                        observer.observe(target, {
                            childList: true,
                            subtree: true
                        });
                        target.dataset.integaglpiObserverAttached = '1';
                    }
                })(jQuery);
            </script>
        <?php } ?>
    </div>
</div>

<?php if ($isExternalConfigured && $runtime !== null && $isClosed) { ?>
    <div class="alert alert-warning mt-3 mb-0 d-flex align-items-start gap-2">
        <span style="font-size: 1.1rem;">&#128274;</span>
        <div>
            <strong><?= $this->escape(__('Conversa encerrada', 'glpiintegaglpi')); ?></strong><br>
            <?= $this->escape(__('Esta conversa está encerrada. Para responder, reabra ou inicie um novo atendimento.', 'glpiintegaglpi')); ?>
        </div>
    </div>
<?php } ?>

<?php if ($isExternalConfigured && $runtime !== null && !$isClosed && \GlpiPlugin\Integaglpi\Plugin::canUpdate()) { ?>
    <?php
    $replyTicketId = (int) $ticket->getID();
    $replyConvId   = (string) ($runtime['conversation_id'] ?? '');
    $replyPostUrl  = rtrim($CFG_GLPI['root_doc'] ?? '', '/')
        . '/plugins/integaglpi/front/ticket.whatsapp.reply.php';
    $replyCsrfToken = \GlpiPlugin\Integaglpi\Plugin::getCsrfToken();
    $replyDomId    = 'integaglpi-reply-' . $replyTicketId;
    // Phase 7.4C regression fix: previous version used window.location.href to a GET
    // endpoint (debug_get=1). 7.4C blocked GET on ticket.whatsapp.reply.php with HTTP 405,
    // so the WhatsApp tab needs to POST through fetch with CSRF, like the Central does.
    ?>
    <div class="card mt-3" id="<?= $this->escape($replyDomId); ?>" data-reply-card="1">
        <div class="card-header"><?= $this->escape(__('Responder cliente', 'glpiintegaglpi')); ?></div>
        <div class="card-body">
            <textarea
                class="form-control mb-2 js-integaglpi-tab-reply-text"
                rows="3"
                maxlength="4096"
                placeholder="<?= $this->escape(__('Digite a mensagem para enviar ao cliente via WhatsApp...', 'glpiintegaglpi')); ?>"
            ></textarea>
            <div class="d-flex gap-2 align-items-center">
                <button
                    type="button"
                    class="btn btn-success js-integaglpi-tab-reply-send"
                    data-ticket-id="<?= $replyTicketId; ?>"
                    data-conversation-id="<?= $this->escape($replyConvId); ?>"
                ><?= $this->escape(__('Enviar resposta', 'glpiintegaglpi')); ?></button>
                <small class="text-muted js-integaglpi-tab-reply-feedback"></small>
            </div>
        </div>
    </div>
    <script>
    (function () {
        var card = document.getElementById(<?= json_encode($replyDomId, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE); ?>);
        if (!card || card.dataset.integaglpiBound === '1') {
            return;
        }
        card.dataset.integaglpiBound = '1';

        var endpoint  = <?= json_encode($replyPostUrl, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE); ?>;
        var csrfToken = <?= json_encode($replyCsrfToken, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE); ?>;
        var emptyMsg  = <?= json_encode(__('A mensagem não pode ser vazia.', 'glpiintegaglpi'), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE); ?>;
        var sendingMsg = <?= json_encode(__('Enviando...', 'glpiintegaglpi'), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE); ?>;
        var sentMsg   = <?= json_encode(__('Mensagem enviada.', 'glpiintegaglpi'), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE); ?>;
        var genericErr = <?= json_encode(__('Falha ao enviar a mensagem.', 'glpiintegaglpi'), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE); ?>;
        var networkErr = <?= json_encode(__('Erro de rede ao enviar a mensagem.', 'glpiintegaglpi'), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE); ?>;

        var button   = card.querySelector('.js-integaglpi-tab-reply-send');
        var textarea = card.querySelector('.js-integaglpi-tab-reply-text');
        var feedback = card.querySelector('.js-integaglpi-tab-reply-feedback');

        if (!button || !textarea) {
            return;
        }

        function setFeedback(message, kind) {
            if (!feedback) { return; }
            feedback.textContent = message || '';
            feedback.className = 'js-integaglpi-tab-reply-feedback small ' + (
                kind === 'error' ? 'text-danger'
                : kind === 'success' ? 'text-success'
                : 'text-muted'
            );
        }

        function parseJsonResponse(response) {
            return response.text().then(function (text) {
                var body = null;
                if (text) {
                    try { body = JSON.parse(text); } catch (e) { body = null; }
                }
                return { status: response.status, body: body };
            });
        }

        button.addEventListener('click', function () {
            var msg = (textarea.value || '').trim();
            if (msg === '') {
                alert(emptyMsg);
                return;
            }

            var payload = new URLSearchParams();
            payload.set('_glpi_csrf_token', csrfToken);
            payload.set('ticket_id',       String(button.dataset.ticketId || ''));
            payload.set('conversation_id', String(button.dataset.conversationId || ''));
            payload.set('reply_text',      msg);

            var originalLabel = button.textContent;
            button.disabled = true;
            button.textContent = sendingMsg;
            setFeedback('', 'muted');

            fetch(endpoint, {
                method: 'POST',
                credentials: 'same-origin',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Accept': 'application/json'
                },
                body: payload
            })
                .then(parseJsonResponse)
                .then(function (result) {
                    if (!result.body || result.body.success !== true) {
                        var msgFromServer = result.body && result.body.message
                            ? result.body.message
                            : genericErr;
                        setFeedback(msgFromServer, 'error');
                        button.disabled = false;
                        button.textContent = originalLabel;
                        return;
                    }

                    textarea.value = '';
                    setFeedback(sentMsg, 'success');
                    button.disabled = false;
                    button.textContent = originalLabel;
                    window.setTimeout(function () {
                        window.location.reload();
                    }, 500);
                })
                .catch(function () {
                    setFeedback(networkErr, 'error');
                    button.disabled = false;
                    button.textContent = originalLabel;
                });
        });
    })();
    </script>
<?php } ?>
