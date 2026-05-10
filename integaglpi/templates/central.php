<?php

declare(strict_types=1);

/** @var \GlpiPlugin\Integaglpi\Renderer\CentralRenderer $this */
/** @var array<string, mixed> $data */

$filters = is_array($data['filters'] ?? null) ? $data['filters'] : [];
$pagination = is_array($data['pagination'] ?? null) ? $data['pagination'] : [];
$rows = is_array($data['rows'] ?? null) ? $data['rows'] : [];
$queues = is_array($data['queues'] ?? null) ? $data['queues'] : [];
$allowedStatuses = is_array($data['allowed_statuses'] ?? null) ? $data['allowed_statuses'] : [];
$limitOptions = is_array($data['limit_options'] ?? null) ? $data['limit_options'] : [20, 50];
$error = isset($data['error']) ? (string) $data['error'] : '';
$currentPage = (int) ($pagination['page'] ?? 1);
$currentLimit = (int) ($pagination['limit'] ?? 20);
$total = (int) ($pagination['total'] ?? 0);
$totalPages = (int) ($pagination['total_pages'] ?? 1);
$centralActionUrl = $this->getCentralActionUrl();
$centralRefreshUrl = $this->getCentralRefreshUrl();
$centralMessagesUrl = $this->getCentralMessagesUrl();
$centralTechniciansUrl = \GlpiPlugin\Integaglpi\Plugin::getWebBasePath() . '/front/central.technicians.php';
$ticketUrlBase = $this->getTicketUrlBase();
$csrfToken = $this->getCsrfToken();
$currentUserId = $this->getCurrentUserId();
$canUpdateActions = \Session::haveRight(\GlpiPlugin\Integaglpi\Plugin::RIGHT_NAME, UPDATE);
$whatsappCssUrl = \GlpiPlugin\Integaglpi\Plugin::getWebBasePath() . '/css/whatsapp.css';
?>

<link rel="stylesheet" type="text/css" href="<?= $this->escape($whatsappCssUrl); ?>">

<style>
.itg-central-shell {
    display: grid;
    grid-template-columns: minmax(300px, 0.9fr) minmax(420px, 1.35fr) minmax(260px, 0.75fr);
    gap: 1rem;
    min-height: 72vh;
}

.itg-panel {
    background: #fff;
    border: 1px solid rgba(98, 105, 118, 0.16);
    border-radius: 14px;
    box-shadow: 0 10px 28px rgba(24, 36, 51, 0.06);
    min-height: 0;
    overflow: hidden;
}

.itg-panel-header {
    border-bottom: 1px solid rgba(98, 105, 118, 0.16);
    padding: 1rem;
}

.itg-panel-body {
    padding: 1rem;
}

.itg-conversation-list {
    max-height: calc(72vh - 230px);
    overflow-y: auto;
    padding: 0.75rem;
}

.itg-conversation-table,
.itg-conversation-table tbody,
.itg-conversation-table tr,
.itg-conversation-table td {
    display: block;
    width: 100%;
}

.itg-conversation-table {
    border-collapse: separate;
    border-spacing: 0 0.7rem;
}

.itg-conversation-table thead {
    display: none;
}

.itg-conversation-table tr {
    background: #fff;
    border: 1px solid rgba(98, 105, 118, 0.18);
    border-radius: 14px;
    cursor: pointer;
    margin-bottom: 0.7rem;
    transition: border-color 0.18s ease, box-shadow 0.18s ease, transform 0.18s ease;
}

.itg-conversation-table tr:hover,
.itg-conversation-table tr.table-active {
    border-color: rgba(32, 107, 196, 0.45);
    box-shadow: 0 12px 26px rgba(32, 107, 196, 0.12);
    transform: translateY(-1px);
}

.itg-conversation-table td {
    border: 0;
    padding: 0;
}

.itg-card {
    padding: 0.9rem;
}

.itg-card-title {
    font-weight: 700;
}

.itg-card-meta {
    color: #667085;
    font-size: 0.78rem;
}

.itg-card-badges {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
}

.itg-chat-panel {
    display: flex;
    flex-direction: column;
}

.itg-chat-body {
    background:
        radial-gradient(circle at 12% 20%, rgba(32, 107, 196, 0.08), transparent 30%),
        linear-gradient(180deg, #f8fafc 0%, #eef3f8 100%);
    flex: 1;
    min-height: 420px;
    overflow-y: auto;
    padding: 1rem;
}

.itg-context-list {
    display: grid;
    gap: 0.75rem;
}

.itg-context-item {
    background: #f8fafc;
    border-radius: 12px;
    padding: 0.75rem;
}

.itg-placeholder-action {
    opacity: 0.65;
    pointer-events: none;
}

@media (max-width: 1199px) {
    .itg-central-shell {
        grid-template-columns: 1fr;
    }

    .itg-conversation-list,
    .itg-chat-body {
        max-height: none;
    }
}
</style>

<div class="itg-central-shell">
    <aside class="itg-panel">
        <div class="itg-panel-header">
            <div class="d-flex justify-content-between align-items-start gap-2">
                <div>
                    <h2 class="h4 mb-1"><?= $this->escape(__('Central de Atendimento', 'glpiintegaglpi')); ?></h2>
                    <small class="text-muted js-integaglpi-central-refreshed-at"></small>
                </div>
                <div class="d-flex gap-2 align-items-center">
                    <button type="button" class="btn btn-sm btn-outline-secondary js-integaglpi-central-refresh">
                        <?= $this->escape(__('Atualizar', 'glpiintegaglpi')); ?>
                    </button>
                    <span class="badge bg-secondary js-integaglpi-central-total">
                        <?= $total; ?> <?= $this->escape(__('open conversations', 'glpiintegaglpi')); ?>
                    </span>
                </div>
            </div>
        </div>

        <div class="itg-panel-body">
            <div class="alert d-none js-integaglpi-central-refresh-message mb-3"></div>

            <?php if ($error !== '') { ?>
                <div class="alert alert-warning mb-3">
                    <?= $this->escape($error); ?>
                </div>
            <?php } ?>

            <form method="get" action="<?= $this->escape($this->getCentralUrl()); ?>" class="mb-3 js-integaglpi-central-filter-form">
                <div class="row g-2">
                    <div class="col-6">
                        <label class="form-label"><?= $this->escape(__('Status', 'glpiintegaglpi')); ?></label>
                        <select name="status" class="form-select">
                            <option value=""><?= $this->escape(__('All open statuses', 'glpiintegaglpi')); ?></option>
                            <?php foreach ($allowedStatuses as $status) { ?>
                                <?php $statusValue = (string) $status; ?>
                                <option value="<?= $this->escape($statusValue); ?>" <?= (string) ($filters['status'] ?? '') === $statusValue ? "selected='selected'" : ''; ?>>
                                    <?= $this->escape($statusValue); ?>
                                </option>
                            <?php } ?>
                        </select>
                    </div>
                    <div class="col-6">
                        <label class="form-label"><?= $this->escape(__('Queue', 'glpiintegaglpi')); ?></label>
                        <select name="queue_id" class="form-select">
                            <option value="0"><?= $this->escape(__('All queues', 'glpiintegaglpi')); ?></option>
                            <?php foreach ($queues as $queue) { ?>
                                <?php $queueId = (int) ($queue['id'] ?? 0); ?>
                                <option value="<?= $queueId; ?>" <?= (int) ($filters['queue_id'] ?? 0) === $queueId ? "selected='selected'" : ''; ?>>
                                    <?= $this->escape((string) ($queue['name'] ?? ('#' . $queueId))); ?>
                                </option>
                            <?php } ?>
                        </select>
                    </div>
                    <div class="col-8">
                        <label class="form-label"><?= $this->escape(__('Phone or ticket', 'glpiintegaglpi')); ?></label>
                        <input
                            type="search"
                            name="search"
                            class="form-control"
                            value="<?= $this->escape((string) ($filters['search'] ?? '')); ?>"
                            placeholder="<?= $this->escape(__('Phone or ticket ID', 'glpiintegaglpi')); ?>"
                        >
                    </div>
                    <div class="col-4">
                        <label class="form-label"><?= $this->escape(__('Limit', 'glpiintegaglpi')); ?></label>
                        <select name="limit" class="form-select">
                            <?php foreach ($limitOptions as $limitOption) { ?>
                                <?php $limitValue = (int) $limitOption; ?>
                                <option value="<?= $limitValue; ?>" <?= $currentLimit === $limitValue ? "selected='selected'" : ''; ?>>
                                    <?= $limitValue; ?>
                                </option>
                            <?php } ?>
                        </select>
                    </div>
                    <div class="col-12">
                        <button type="submit" class="btn btn-primary w-100">
                            <?= $this->escape(__('Filter', 'glpiintegaglpi')); ?>
                        </button>
                    </div>
                </div>
            </form>
        </div>

        <div class="itg-conversation-list">
            <table class="itg-conversation-table">
                <thead>
                    <tr>
                        <th><?= $this->escape(__('Conversation', 'glpiintegaglpi')); ?></th>
                        <th><?= $this->escape(__('Phone', 'glpiintegaglpi')); ?></th>
                        <th><?= $this->escape(__('Status', 'glpiintegaglpi')); ?></th>
                        <th><?= $this->escape(__('Queue', 'glpiintegaglpi')); ?></th>
                        <th><?= $this->escape(__('Ticket', 'glpiintegaglpi')); ?></th>
                        <th><?= $this->escape(__('Technician', 'glpiintegaglpi')); ?></th>
                        <th><?= $this->escape(__('Last activity', 'glpiintegaglpi')); ?></th>
                        <th><?= $this->escape(__('Actions', 'glpiintegaglpi')); ?></th>
                    </tr>
                </thead>
                <tbody class="js-integaglpi-central-tbody">
                    <?php if ($rows === []) { ?>
                        <tr>
                            <td colspan="8" class="text-center text-muted p-3">
                                <?= $this->escape(__('No open WhatsApp conversations found.', 'glpiintegaglpi')); ?>
                            </td>
                        </tr>
                    <?php } ?>

                    <?php foreach ($rows as $row) { ?>
                        <?php
                        $ticketId = (int) ($row['glpi_ticket_id'] ?? 0);
                        $queueId = (int) ($row['queue_id'] ?? 0);
                        $conversationId = (string) ($row['conversation_id'] ?? '');
                        $assignedUserId = (int) ($row['assigned_user_id'] ?? 0);
                        $assignedLabel = (string) ($row['assigned_user_label'] ?? '');
                        $phone = (string) ($row['phone_e164'] ?? '');
                        $contactName = (string) ($row['contact_name'] ?? '');
                        $queueName = (string) ($row['queue_name'] ?? '');
                        $activityAt = (string) ($row['activity_at'] ?? '');
                        $effectiveStatus = (string) ($row['effective_status'] ?? $row['conversation_status'] ?? '');
                        $canClaim = $canUpdateActions
                            && $effectiveStatus === 'open'
                            && $assignedUserId <= 0
                            && $ticketId > 0
                            && $conversationId !== '';
                        $canReply = $effectiveStatus === 'open'
                            && $canUpdateActions
                            && $assignedUserId === $currentUserId
                            && $ticketId > 0
                            && $conversationId !== '';
                        ?>
                        <tr
                            data-conversation-id="<?= $this->escape($conversationId); ?>"
                            data-ticket-id="<?= $ticketId; ?>"
                            data-phone="<?= $this->escape($phone); ?>"
                            data-contact-name="<?= $this->escape($contactName); ?>"
                            data-status="<?= $this->escape($effectiveStatus); ?>"
                            data-queue="<?= $this->escape($queueName); ?>"
                            data-queue-id="<?= $queueId; ?>"
                            data-technician="<?= $this->escape($assignedLabel); ?>"
                            data-activity="<?= $this->escape($activityAt); ?>"
                            data-can-reply="<?= $canReply ? '1' : '0'; ?>"
                        >
                            <td colspan="8">
                                <div class="itg-card">
                                    <div class="d-flex justify-content-between gap-2">
                                        <div>
                                            <div class="itg-card-title">
                                                <?= $this->escape($contactName !== '' ? $contactName : $phone); ?>
                                            </div>
                                            <div class="itg-card-meta"><?= $this->escape($phone); ?></div>
                                        </div>
                                        <span class="badge bg-light text-dark">#<?= $ticketId; ?></span>
                                    </div>
                                    <div class="itg-card-badges my-2">
                                        <?php if ($assignedUserId === $currentUserId) { ?>
                                            <span class="badge bg-primary"><?= $this->escape(__('Minha', 'glpiintegaglpi')); ?></span>
                                        <?php } elseif ($assignedUserId <= 0) { ?>
                                            <span class="badge bg-warning text-dark"><?= $this->escape(__('Sem técnico', 'glpiintegaglpi')); ?></span>
                                        <?php } else { ?>
                                            <span class="badge bg-info text-dark"><?= $this->escape(__('Aguardando', 'glpiintegaglpi')); ?></span>
                                        <?php } ?>
                                        <span class="badge bg-secondary"><?= $this->escape($effectiveStatus); ?></span>
                                    </div>
                                    <div class="itg-card-meta">
                                        <?= $this->escape(__('Fila', 'glpiintegaglpi')); ?>:
                                        <?= $this->escape($queueName !== '' ? $queueName : '-'); ?>
                                        <?php if ($queueId > 0) { ?>
                                            <span>#<?= $queueId; ?></span>
                                        <?php } ?>
                                    </div>
                                    <div class="itg-card-meta js-integaglpi-central-technician">
                                        <?= $this->escape(__('Técnico', 'glpiintegaglpi')); ?>:
                                        <?php if ($assignedLabel !== '') { ?>
                                            <?= $this->escape($assignedLabel); ?>
                                        <?php } else { ?>
                                            <span class="text-muted">-</span>
                                        <?php } ?>
                                    </div>
                                    <div class="itg-card-meta">
                                        <?= $this->escape(__('Última atividade', 'glpiintegaglpi')); ?>:
                                        <?= $this->escape($activityAt); ?>
                                    </div>
                                    <div class="mt-2 js-integaglpi-central-actions">
                                        <?php if ($canClaim) { ?>
                                            <button
                                                type="button"
                                                class="btn btn-sm btn-primary js-integaglpi-central-claim"
                                                data-conversation-id="<?= $this->escape($conversationId); ?>"
                                                data-ticket-id="<?= $ticketId; ?>"
                                            >
                                                <?= $this->escape(__('Assumir', 'glpiintegaglpi')); ?>
                                            </button>
                                        <?php } elseif ($canReply) { ?>
                                            <div class="integaglpi-central-reply" data-reply-box="1">
                                                <textarea
                                                    class="form-control form-control-sm mb-2 js-integaglpi-central-reply-text"
                                                    rows="2"
                                                    maxlength="4096"
                                                    placeholder="<?= $this->escape(__('Responder via WhatsApp', 'glpiintegaglpi')); ?>"
                                                ></textarea>
                                                <div class="d-flex gap-2 align-items-center">
                                                    <button
                                                        type="button"
                                                        class="btn btn-sm btn-success js-integaglpi-central-reply"
                                                        data-conversation-id="<?= $this->escape($conversationId); ?>"
                                                        data-ticket-id="<?= $ticketId; ?>"
                                                    >
                                                        <?= $this->escape(__('Enviar', 'glpiintegaglpi')); ?>
                                                    </button>
                                                    <button
                                                        type="button"
                                                        class="btn btn-sm btn-outline-secondary js-integaglpi-central-transfer"
                                                        data-conversation-id="<?= $this->escape($conversationId); ?>"
                                                        data-ticket-id="<?= $ticketId; ?>"
                                                    >
                                                        <?= $this->escape(__('Transferir', 'glpiintegaglpi')); ?>
                                                    </button>
                                                    <button
                                                        type="button"
                                                        class="btn btn-sm btn-outline-primary js-integaglpi-central-solve"
                                                        data-conversation-id="<?= $this->escape($conversationId); ?>"
                                                        data-ticket-id="<?= $ticketId; ?>"
                                                    >
                                                        <?= $this->escape(__('Solucionar', 'glpiintegaglpi')); ?>
                                                    </button>
                                                    <small class="text-muted js-integaglpi-central-reply-feedback"></small>
                                                </div>
                                            </div>
                                        <?php } else { ?>
                                            <span class="text-muted">-</span>
                                        <?php } ?>
                                    </div>
                                </div>
                            </td>
                        </tr>
                    <?php } ?>
                </tbody>
            </table>
        </div>

        <div class="d-flex justify-content-between align-items-center p-3 border-top">
            <div class="text-muted js-integaglpi-central-page-label">
                <?= $this->escape(sprintf(__('Page %d of %d', 'glpiintegaglpi'), $currentPage, $totalPages)); ?>
            </div>
            <div>
                <?php if (!empty($pagination['has_previous'])) { ?>
                    <a class="btn btn-sm btn-outline-secondary" href="<?= $this->escape($this->getPageUrl($filters, $currentPage - 1, $currentLimit)); ?>">
                        <?= $this->escape(__('Previous', 'glpiintegaglpi')); ?>
                    </a>
                <?php } ?>
                <?php if (!empty($pagination['has_next'])) { ?>
                    <a class="btn btn-sm btn-outline-secondary ms-2" href="<?= $this->escape($this->getPageUrl($filters, $currentPage + 1, $currentLimit)); ?>">
                        <?= $this->escape(__('Next', 'glpiintegaglpi')); ?>
                    </a>
                <?php } ?>
            </div>
        </div>
    </aside>

    <section class="itg-panel itg-chat-panel js-integaglpi-central-conversation-panel d-none">
        <div class="itg-panel-header d-flex justify-content-between align-items-center">
            <span>
                <?= $this->escape(__('Conversa selecionada', 'glpiintegaglpi')); ?>
                <small class="text-muted js-integaglpi-central-selected-label"></small>
            </span>
            <small class="text-muted js-integaglpi-central-messages-status"></small>
        </div>
        <div class="itg-chat-body js-integaglpi-central-messages"></div>
    </section>

    <aside class="itg-panel">
        <div class="itg-panel-header">
            <h3 class="h5 mb-1"><?= $this->escape(__('Contexto do ticket', 'glpiintegaglpi')); ?></h3>
            <small class="text-muted"><?= $this->escape(__('Resumo operacional da conversa selecionada', 'glpiintegaglpi')); ?></small>
        </div>
        <div class="itg-panel-body">
            <div class="itg-context-list">
                <div class="itg-context-item">
                    <small class="text-muted d-block"><?= $this->escape(__('Ticket', 'glpiintegaglpi')); ?></small>
                    <a
                        class="js-integaglpi-central-context-ticket"
                        href="#"
                        target="_blank"
                        rel="noopener noreferrer"
                    >-</a>
                </div>
                <div class="itg-context-item">
                    <small class="text-muted d-block"><?= $this->escape(__('Fila', 'glpiintegaglpi')); ?></small>
                    <span class="js-integaglpi-central-context-queue">-</span>
                </div>
                <div class="itg-context-item">
                    <small class="text-muted d-block"><?= $this->escape(__('Técnico', 'glpiintegaglpi')); ?></small>
                    <span class="js-integaglpi-central-context-technician">-</span>
                </div>
                <div class="itg-context-item">
                    <small class="text-muted d-block"><?= $this->escape(__('Status', 'glpiintegaglpi')); ?></small>
                    <span class="js-integaglpi-central-context-status">-</span>
                </div>
                <button
                    type="button"
                    class="btn btn-outline-secondary js-integaglpi-central-context-transfer js-integaglpi-central-transfer"
                    data-conversation-id=""
                    data-ticket-id=""
                    disabled
                >
                    <?= $this->escape(__('Transferir', 'glpiintegaglpi')); ?>
                </button>
                <button
                    type="button"
                    class="btn btn-outline-secondary js-integaglpi-central-context-solve js-integaglpi-central-solve"
                    data-conversation-id=""
                    data-ticket-id=""
                    disabled
                >
                    <?= $this->escape(__('Solucionar', 'glpiintegaglpi')); ?>
                </button>
            </div>
        </div>
    </aside>
</div>

<div id="itg-iw-int-transfer-modal" class="itg-iw-modal-backdrop d-none" aria-hidden="true" role="dialog" aria-modal="true" aria-labelledby="itg-iw-transfer-title">
    <div class="itg-iw-modal">
        <div class="itg-iw-modal__header" id="itg-iw-transfer-title"><?= $this->escape(__('Transferir atendimento', 'glpiintegaglpi')); ?></div>
        <div class="itg-iw-modal__body">
            <p class="itg-iw-modal__loading js-itg-iw-modal-loading mb-0"><?= $this->escape(__('Carregando técnicos...', 'glpiintegaglpi')); ?></p>
            <div class="itg-iw-modal__form d-none js-itg-iw-modal-form">
                <label class="form-label small mb-0" for="itg-iw-filter-tech"><?= $this->escape(__('Filtrar por nome', 'glpiintegaglpi')); ?></label>
                <div class="itg-iw-filter">
                    <input id="itg-iw-filter-tech" type="search" class="form-control form-control-sm" autocomplete="off" placeholder="">
                </div>
                <label class="form-label small mb-0" for="itg-iw-select-tech"><?= $this->escape(__('Técnico de destino', 'glpiintegaglpi')); ?></label>
                <select id="itg-iw-select-tech" class="form-select form-select-sm itg-iw-technician-select" size="8" aria-label="<?= $this->escape(__('Técnico de destino', 'glpiintegaglpi'), ENT_QUOTES, 'UTF-8'); ?>"></select>
            </div>
            <p class="itg-iw-modal__error d-none js-itg-iw-modal-error mb-0" role="alert"></p>
        </div>
        <div class="itg-iw-modal__actions">
            <button type="button" class="btn btn-sm btn-secondary js-itg-iw-modal-cancel"><?= $this->escape(__('Cancelar', 'glpiintegaglpi')); ?></button>
            <button type="button" class="btn btn-sm btn-primary js-itg-iw-modal-confirm" disabled><?= $this->escape(__('Confirmar', 'glpiintegaglpi')); ?></button>
        </div>
    </div>
</div>

<script>
(function () {
    const itgI18nTransferConfirm = <?= json_encode((string) __('Confirmar', 'glpiintegaglpi'), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE); ?>;
    const actionUrl = <?= json_encode($centralActionUrl, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE); ?>;
    const refreshUrl = <?= json_encode($centralRefreshUrl, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE); ?>;
    const messagesUrl = <?= json_encode($centralMessagesUrl, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE); ?>;
    const techniciansUrl = <?= json_encode($centralTechniciansUrl, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE); ?>;
    let csrfToken = <?= json_encode($csrfToken, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE); ?>;
    const ticketUrlBase = <?= json_encode($ticketUrlBase, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE); ?>;
    const canUpdateActions = <?= json_encode($canUpdateActions); ?>;
    const refreshMinIntervalMs = 15000;
    const pollingIntervalMs = 15000;
    let refreshInProgress = false;
    let lastRefreshAtMs = 0;
    let messagesInProgress = false;
    let selectedConversation = null;
    let messagesCursor = {createdAt: '', id: ''};
    const renderedMessageKeys = new Set();

    function buildIdempotencyKey() {
        if (window.crypto && typeof window.crypto.randomUUID === 'function') {
            return 'central-reply-' + window.crypto.randomUUID();
        }

        return 'central-reply-' + Date.now() + '-' + Math.random().toString(16).slice(2);
    }

    function escapeHtml(value) {
        return String(value === null || value === undefined ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function showRefreshMessage(message, type) {
        const box = document.querySelector('.js-integaglpi-central-refresh-message');
        if (!box) {
            return;
        }

        box.className = 'alert mb-3 js-integaglpi-central-refresh-message alert-' + type;
        box.textContent = message;
        box.classList.remove('d-none');
    }

    function hideRefreshMessage() {
        const box = document.querySelector('.js-integaglpi-central-refresh-message');
        if (box) {
            box.classList.add('d-none');
            box.textContent = '';
        }
    }

    function parseJsonResponse(response) {
        return response.text().then(function (text) {
            let body = null;

            if (text) {
                try {
                    body = JSON.parse(text);
                } catch (error) {
                    body = null;
                }
            }

            return {
                status: response.status,
                body: body
            };
        });
    }

    function updateCsrfToken(body) {
        if (body && typeof body.csrf_token === 'string' && body.csrf_token !== '') {
            csrfToken = body.csrf_token;
        }
    }

    function csrfErrorMessage() {
        return 'Sessão expirada ou token de segurança inválido. Recarregue a página.';
    }

    function isProtectedRow(row) {
        const textarea = row.querySelector('.js-integaglpi-central-reply-text');
        const hasDraft = textarea && textarea.value.trim() !== '';
        return row.getAttribute('data-reply-in-progress') === '1' || hasDraft;
    }

    function renderActions(row) {
        const conversationId = escapeHtml(row.conversation_id || '');
        const ticketId = Number(row.glpi_ticket_id || 0);

        if (canUpdateActions && row.can_claim) {
            return '<button type="button" class="btn btn-sm btn-primary js-integaglpi-central-claim"'
                + ' data-conversation-id="' + conversationId + '"'
                + ' data-ticket-id="' + ticketId + '">Assumir</button>';
        }

        if (canUpdateActions && row.can_reply) {
            return '<div class="integaglpi-central-reply" data-reply-box="1">'
                + '<textarea class="form-control form-control-sm mb-2 js-integaglpi-central-reply-text"'
                + ' rows="2" maxlength="4096" placeholder="Responder via WhatsApp"></textarea>'
                + '<div class="d-flex gap-2 align-items-center">'
                + '<button type="button" class="btn btn-sm btn-success js-integaglpi-central-reply"'
                + ' data-conversation-id="' + conversationId + '"'
                + ' data-ticket-id="' + ticketId + '">Enviar</button>'
                + '<button type="button" class="btn btn-sm btn-outline-secondary js-integaglpi-central-transfer"'
                + ' data-conversation-id="' + conversationId + '"'
                + ' data-ticket-id="' + ticketId + '">Transferir</button>'
                + '<button type="button" class="btn btn-sm btn-outline-primary js-integaglpi-central-solve"'
                + ' data-conversation-id="' + conversationId + '"'
                + ' data-ticket-id="' + ticketId + '">Solucionar</button>'
                + '<small class="text-muted js-integaglpi-central-reply-feedback"></small>'
                + '</div></div>';
        }

        return '<span class="text-muted">-</span>';
    }

    function renderRow(row) {
        const ticketId = Number(row.glpi_ticket_id || 0);
        const queueId = Number(row.queue_id || 0);
        const conversationId = String(row.conversation_id || '');
        const phone = String(row.phone_e164 || '');
        const contactName = String(row.contact_name || '');
        const title = contactName || phone || conversationId;
        const status = String(row.effective_status || row.conversation_status || '');
        const queueName = String(row.queue_name || '');
        const activityAt = String(row.activity_at || '');
        const technicianHtml = row.assigned_user_label
            ? escapeHtml(row.assigned_user_label)
            : '<span class="text-muted">-</span>';
        const assignedUserId = Number(row.assigned_user_id || 0);
        const ownershipBadge = row.can_reply
            ? '<span class="badge bg-primary">Minha</span>'
            : assignedUserId <= 0
            ? '<span class="badge bg-warning text-dark">Sem técnico</span>'
            : '<span class="badge bg-info text-dark">Aguardando</span>';

        const element = document.createElement('tr');
        element.setAttribute('data-conversation-id', conversationId);
        element.setAttribute('data-ticket-id', String(ticketId));
        element.setAttribute('data-phone', phone);
        element.setAttribute('data-contact-name', contactName);
        element.setAttribute('data-status', status);
        element.setAttribute('data-queue', queueName);
        element.setAttribute('data-queue-id', String(queueId));
        element.setAttribute('data-technician', String(row.assigned_user_label || ''));
        element.setAttribute('data-activity', activityAt);
        element.setAttribute('data-can-reply', canUpdateActions && row.can_reply ? '1' : '0');
        if (selectedConversation && selectedConversation.conversationId === String(row.conversation_id || '')) {
            element.classList.add('table-active');
        }
        element.innerHTML =
            '<td colspan="8"><div class="itg-card">'
            + '<div class="d-flex justify-content-between gap-2"><div>'
            + '<div class="itg-card-title">' + escapeHtml(title) + '</div>'
            + '<div class="itg-card-meta">' + escapeHtml(phone) + '</div>'
            + '</div><span class="badge bg-light text-dark">#' + ticketId + '</span></div>'
            + '<div class="itg-card-badges my-2">'
            + ownershipBadge
            + '<span class="badge bg-secondary">' + escapeHtml(status) + '</span>'
            + '</div>'
            + '<div class="itg-card-meta">Fila: ' + escapeHtml(queueName || '-')
            + (queueId > 0 ? ' <span>#' + queueId + '</span>' : '') + '</div>'
            + '<div class="itg-card-meta js-integaglpi-central-technician">Técnico: ' + technicianHtml + '</div>'
            + '<div class="itg-card-meta">Última atividade: ' + escapeHtml(activityAt) + '</div>'
            + '<div class="mt-2 js-integaglpi-central-actions">' + renderActions(row) + '</div>'
            + '</div></td>';

        return element;
    }

    function collectRefreshParams() {
        const form = document.querySelector('.js-integaglpi-central-filter-form');
        const params = new URLSearchParams();

        if (form) {
            const data = new FormData(form);
            data.forEach(function (value, key) {
                if (String(value) !== '' && String(value) !== '0') {
                    params.set(key, String(value));
                }
            });
        }

        const pageMatch = new URLSearchParams(window.location.search).get('page');
        if (pageMatch) {
            params.set('page', pageMatch);
        }

        return params;
    }

    function updatePagination(pagination) {
        const total = Number(pagination && pagination.total ? pagination.total : 0);
        const totalPages = Number(pagination && pagination.total_pages ? pagination.total_pages : 1);
        const page = Number(pagination && pagination.page ? pagination.page : 1);
        const totalBadge = document.querySelector('.js-integaglpi-central-total');
        const pageLabel = document.querySelector('.js-integaglpi-central-page-label');

        if (totalBadge) {
            totalBadge.textContent = total + ' open conversations';
        }

        if (pageLabel) {
            pageLabel.textContent = 'Page ' + page + ' of ' + totalPages;
        }
    }

    function updateRefreshedAt(value) {
        const target = document.querySelector('.js-integaglpi-central-refreshed-at');
        if (!target) {
            return;
        }

        const date = value ? new Date(value) : new Date();
        target.textContent = 'Atualizado em ' + date.toLocaleTimeString();
    }

    function showMessagesStatus(message) {
        const target = document.querySelector('.js-integaglpi-central-messages-status');
        if (target) {
            target.textContent = message;
        }
    }

    function scrollMessagesToBottom() {
        const container = document.querySelector('.js-integaglpi-central-messages');
        if (container) {
            container.scrollTop = container.scrollHeight;
        }
    }

    function messageKey(message) {
        return String(message.id || message.message_id || '');
    }

    function renderMessage(message) {
        const direction = String(message.direction || '');
        const isOutbound = direction === 'outbound';
        const wrapper = document.createElement('div');
        wrapper.className = 'd-flex mb-2 ' + (isOutbound ? 'justify-content-end' : 'justify-content-start');

        const bubble = document.createElement('div');
        bubble.className = 'p-2 rounded ' + (isOutbound ? 'bg-primary text-white' : 'bg-light border');
        bubble.style.maxWidth = '75%';

        const meta = document.createElement('div');
        meta.className = isOutbound ? 'small text-white-50' : 'small text-muted';
        meta.textContent = (direction || 'message') + ' - ' + (message.created_at || '');

        const text = document.createElement('div');
        text.textContent = message.message_text || '[' + (message.message_type || 'message') + ']';

        bubble.appendChild(meta);
        bubble.appendChild(text);
        wrapper.appendChild(bubble);

        return wrapper;
    }

    function appendMessages(messages) {
        const container = document.querySelector('.js-integaglpi-central-messages');
        if (!container) {
            return;
        }

        let appended = false;
        messages.forEach(function (message) {
            const key = messageKey(message);
            if (!key || renderedMessageKeys.has(key)) {
                return;
            }

            const node = renderMessage(message);
            container.appendChild(node);
            renderedMessageKeys.add(key);
            messagesCursor.createdAt = message.created_at || messagesCursor.createdAt;
            messagesCursor.id = message.id || messagesCursor.id;
            appended = true;
        });

        if (appended) {
            scrollMessagesToBottom();
        }
    }

    function loadSelectedMessages(reset) {
        if (!selectedConversation || messagesInProgress || document.hidden) {
            return;
        }

        const hasReplyInProgress = document.querySelector('tr[data-reply-in-progress="1"]') !== null;
        if (hasReplyInProgress) {
            return;
        }

        messagesInProgress = true;
        showMessagesStatus('Atualizando mensagens...');

        if (reset) {
            messagesCursor = {createdAt: '', id: ''};
            renderedMessageKeys.clear();
            const container = document.querySelector('.js-integaglpi-central-messages');
            if (container) {
                container.textContent = '';
            }
        }

        const params = new URLSearchParams();
        params.set('conversation_id', selectedConversation.conversationId);
        params.set('ticket_id', selectedConversation.ticketId);
        params.set('limit', '50');
        if (messagesCursor.createdAt) {
            params.set('after_created_at', messagesCursor.createdAt);
            params.set('after_id', messagesCursor.id || '');
        }

        fetch(messagesUrl + '?' + params.toString(), {
            method: 'GET',
            credentials: 'same-origin',
            headers: {
                'Accept': 'application/json'
            }
        })
            .then(parseJsonResponse)
            .then(function (result) {
                if (!result.body || result.body.ok !== true) {
                    if (result.status === 401 || result.status === 403) {
                        showMessagesStatus('Sessão expirada ou sem permissão. Recarregue a página.');
                        return;
                    }

                    showMessagesStatus(result.body && result.body.message ? result.body.message : 'Erro ao atualizar mensagens.');
                    return;
                }

                appendMessages(Array.isArray(result.body.messages) ? result.body.messages : []);
                showMessagesStatus('Mensagens atualizadas.');
            })
            .catch(function () {
                showMessagesStatus('Erro de rede ao atualizar mensagens.');
            })
            .finally(function () {
                messagesInProgress = false;
            });
    }

    function selectConversation(row) {
        const conversationId = row.getAttribute('data-conversation-id') || '';
        const ticketId = row.getAttribute('data-ticket-id') || '';
        if (!conversationId || !ticketId) {
            return;
        }

        selectedConversation = {conversationId: conversationId, ticketId: ticketId};
        document.querySelectorAll('tr[data-conversation-id]').forEach(function (candidate) {
            candidate.classList.remove('table-active');
        });
        row.classList.add('table-active');

        const panel = document.querySelector('.js-integaglpi-central-conversation-panel');
        const label = document.querySelector('.js-integaglpi-central-selected-label');
        if (panel) {
            panel.classList.remove('d-none');
        }
        if (label) {
            label.textContent = '#' + ticketId + ' / ' + conversationId;
        }

        updateContextPanel(row);
        loadSelectedMessages(true);
    }

    function updateContextPanel(row) {
        const ticketId = row.getAttribute('data-ticket-id') || '';
        const ticketLink = document.querySelector('.js-integaglpi-central-context-ticket');
        const queue = document.querySelector('.js-integaglpi-central-context-queue');
        const technician = document.querySelector('.js-integaglpi-central-context-technician');
        const status = document.querySelector('.js-integaglpi-central-context-status');
        const transferButton = document.querySelector('.js-integaglpi-central-context-transfer');
        const solveButton = document.querySelector('.js-integaglpi-central-context-solve');
        const conversationId = row.getAttribute('data-conversation-id') || '';
        const rowStatus = row.getAttribute('data-status') || '';
        const canUseTicketActions = row.getAttribute('data-can-reply') === '1'
            && rowStatus === 'open'
            && Number(ticketId) > 0;

        if (ticketLink) {
            ticketLink.textContent = ticketId ? '#' + ticketId : '-';
            ticketLink.href = ticketId ? ticketUrlBase + ticketId : '#';
        }

        if (queue) {
            const queueName = row.getAttribute('data-queue') || '';
            const queueId = row.getAttribute('data-queue-id') || '';
            queue.textContent = queueName ? queueName + (queueId && queueId !== '0' ? ' #' + queueId : '') : '-';
        }

        if (technician) {
            technician.textContent = row.getAttribute('data-technician') || '-';
        }

        if (status) {
            status.textContent = rowStatus || '-';
        }

        [transferButton, solveButton].forEach(function (button) {
            if (!button) {
                return;
            }

            button.dataset.conversationId = canUseTicketActions ? conversationId : '';
            button.dataset.ticketId = canUseTicketActions ? ticketId : '';
            button.disabled = !canUseTicketActions;
        });
    }

    function applyRefreshRows(rows) {
        const tbody = document.querySelector('.js-integaglpi-central-tbody');
        if (!tbody) {
            return;
        }

        const currentRows = new Map();
        tbody.querySelectorAll('tr[data-conversation-id]').forEach(function (row) {
            currentRows.set(row.getAttribute('data-conversation-id') || '', row);
        });

        const nextBody = document.createDocumentFragment();
        const seen = new Set();

        rows.forEach(function (row) {
            const conversationId = String(row.conversation_id || '');
            const existing = currentRows.get(conversationId);
            seen.add(conversationId);

            if (existing && isProtectedRow(existing)) {
                nextBody.appendChild(existing);
                return;
            }

            nextBody.appendChild(renderRow(row));
        });

        currentRows.forEach(function (row, conversationId) {
            if (!seen.has(conversationId) && isProtectedRow(row)) {
                nextBody.appendChild(row);
            }
        });

        if (!rows.length && nextBody.childNodes.length === 0) {
            const emptyRow = document.createElement('tr');
            emptyRow.innerHTML = '<td colspan="8" class="text-center text-muted p-3">No open WhatsApp conversations found.</td>';
            nextBody.appendChild(emptyRow);
        }

        tbody.textContent = '';
        tbody.appendChild(nextBody);

        if (selectedConversation) {
            let selectedRow = null;
            tbody.querySelectorAll('tr[data-conversation-id]').forEach(function (candidate) {
                if ((candidate.getAttribute('data-conversation-id') || '') === selectedConversation.conversationId) {
                    selectedRow = candidate;
                }
            });

            if (selectedRow) {
                updateContextPanel(selectedRow);
            }
        }
    }

    function refreshCentral(showRateLimitMessage) {
        if (refreshInProgress) {
            return;
        }

        const now = Date.now();
        if (lastRefreshAtMs > 0 && now - lastRefreshAtMs < refreshMinIntervalMs) {
            if (showRateLimitMessage) {
                showRefreshMessage('Aguarde alguns segundos antes de atualizar novamente.', 'warning');
            }
            return;
        }

        const hasReplyInProgress = document.querySelector('tr[data-reply-in-progress="1"]') !== null;
        if (hasReplyInProgress) {
            if (showRateLimitMessage) {
                showRefreshMessage('Aguarde o envio da resposta terminar antes de atualizar.', 'warning');
            }
            return;
        }

        const button = document.querySelector('.js-integaglpi-central-refresh');
        const originalText = button ? button.textContent : '';
        refreshInProgress = true;
        lastRefreshAtMs = now;
        hideRefreshMessage();

        if (button) {
            button.disabled = true;
            button.textContent = 'Atualizando...';
        }

        fetch(refreshUrl + '?' + collectRefreshParams().toString(), {
            method: 'GET',
            credentials: 'same-origin',
            headers: {
                'Accept': 'application/json'
            }
        })
            .then(parseJsonResponse)
            .then(function (result) {
                if (!result.body || result.body.ok !== true) {
                    if (result.status === 401 || result.status === 403) {
                        showRefreshMessage('Sessão expirada ou sem permissão. Recarregue a página.', 'warning');
                        return;
                    }

                    showRefreshMessage(
                        result.body && result.body.message ? result.body.message : 'Erro ao atualizar a Central.',
                        'warning'
                    );
                    return;
                }

                applyRefreshRows(Array.isArray(result.body.rows) ? result.body.rows : []);
                updatePagination(result.body.pagination || {});
                updateRefreshedAt(result.body.refreshed_at || '');
                showRefreshMessage('Central atualizada.', 'success');
            })
            .catch(function () {
                showRefreshMessage('Erro ao atualizar a Central.', 'warning');
            })
            .finally(function () {
                refreshInProgress = false;
                if (button) {
                    button.disabled = false;
                    button.textContent = originalText;
                }
            });
    }

    function loadTechnicians() {
        return fetch(techniciansUrl, {
            method: 'GET',
            credentials: 'same-origin',
            headers: {
                'Accept': 'application/json'
            }
        })
            .then(parseJsonResponse)
            .then(function (result) {
                if (!result.body || result.body.ok !== true) {
                    throw new Error(result.body && result.body.message ? result.body.message : 'Erro ao carregar técnicos.');
                }

                return Array.isArray(result.body.users) ? result.body.users : [];
            });
    }

    const transferModal = {
        button: null,
        allUsers: [],
        filterInputBound: false
    };

    function getTransferModalEls() {
        const backdrop = document.getElementById('itg-iw-int-transfer-modal');
        if (!backdrop) {
            return {};
        }
        return {
            backdrop: backdrop,
            loading: backdrop.querySelector('.js-itg-iw-modal-loading'),
            form: backdrop.querySelector('.js-itg-iw-modal-form'),
            err: backdrop.querySelector('.js-itg-iw-modal-error'),
            filter: document.getElementById('itg-iw-filter-tech'),
            select: backdrop.querySelector('.itg-iw-technician-select'),
            confirm: backdrop.querySelector('.js-itg-iw-modal-confirm')
        };
    }

    function hideModalError(els) {
        if (els && els.err) {
            els.err.classList.add('d-none');
            els.err.textContent = '';
        }
    }

    function showModalError(els, message) {
        if (els && els.err) {
            els.err.textContent = message;
            els.err.classList.remove('d-none');
        }
    }

    function repopulateTechnicianSelect(els, users) {
        if (!els || !els.select) {
            return;
        }
        const select = els.select;
        const prev = document.activeElement;
        const prevId = (prev === select) ? (select.value || null) : null;
        while (select.firstChild) {
            select.removeChild(select.firstChild);
        }
        users.forEach(function (user) {
            const opt = document.createElement('option');
            opt.value = String(user.id);
            opt.textContent = String(user.id) + ' — ' + String(user.name || '');
            select.appendChild(opt);
        });
        if (prevId && select.querySelector('option[value=\"' + prevId + '\"]')) {
            select.value = prevId;
        } else {
            select.selectedIndex = users.length > 0 ? 0 : -1;
        }
    }

    function closeTransferModal() {
        const els = getTransferModalEls();
        if (els.backdrop) {
            els.backdrop.classList.add('d-none');
            els.backdrop.setAttribute('aria-hidden', 'true');
        }
        if (transferModal.button) {
            transferModal.button.disabled = false;
            transferModal.button = null;
        }
        if (els.filter) {
            els.filter.value = '';
        }
        if (els.confirm) {
            els.confirm.disabled = true;
            els.confirm.textContent = itgI18nTransferConfirm;
        }
        hideModalError(els);
    }

    function openTransferModal(button) {
        const els = getTransferModalEls();
        if (!els.backdrop) {
            alert('Modal de transferência indisponível. Recarregue a página.');
            return;
        }
        transferModal.button = button;
        transferModal.allUsers = [];
        if (els.backdrop) {
            els.backdrop.classList.remove('d-none');
            els.backdrop.setAttribute('aria-hidden', 'false');
        }
        button.disabled = true;
        if (els.loading) {
            els.loading.classList.remove('d-none');
        }
        if (els.form) {
            els.form.classList.add('d-none');
        }
        if (els.confirm) {
            els.confirm.disabled = true;
        }
        hideModalError(els);
        if (els.select) {
            els.select.textContent = '';
        }

        function bindFilterOnce() {
            if (transferModal.filterInputBound) {
                return;
            }
            if (!els.filter) {
                return;
            }
            els.filter.addEventListener('input', function () {
                const q = (els.filter && els.filter.value) ? String(els.filter.value).toLowerCase().trim() : '';
                const mels = getTransferModalEls();
                const all = Array.isArray(transferModal.allUsers) ? transferModal.allUsers : [];
                const list = all.filter(function (u) {
                    if (q.length === 0) {
                        return true;
                    }
                    return String(u.name || '').toLowerCase().indexOf(q) >= 0
                        || String(u.id).indexOf(q) >= 0;
                });
                repopulateTechnicianSelect(mels, list);
                if (mels.confirm) {
                    mels.confirm.disabled = !list.length;
                }
            });
            transferModal.filterInputBound = true;
        }

        loadTechnicians()
            .then(function (users) {
                transferModal.allUsers = users;
                const mels = getTransferModalEls();
                if (mels.loading) {
                    mels.loading.classList.add('d-none');
                }
                if (!mels.form) {
                    return;
                }
                mels.form.classList.remove('d-none');
                if (!users.length) {
                    showModalError(mels, 'Nenhum técnico ativo encontrado.');
                    if (mels.confirm) {
                        mels.confirm.disabled = true;
                    }
                    return;
                }
                bindFilterOnce();
                if (mels.filter) {
                    mels.filter.value = '';
                }
                repopulateTechnicianSelect(mels, users);
                if (mels.confirm) {
                    mels.confirm.disabled = false;
                }
            })
            .catch(function (error) {
                const mels = getTransferModalEls();
                if (mels && mels.loading) {
                    mels.loading.classList.add('d-none');
                }
                if (mels && mels.form) {
                    mels.form.classList.add('d-none');
                }
                showModalError(
                    mels,
                    error && error.message ? String(error.message) : 'Erro ao carregar técnicos.',
                );
            });
    }

    function transferConversation(button, newTechnicianId, fromModal) {
        const row = button.closest('tr');
        const payload = new URLSearchParams();
        payload.set('_glpi_csrf_token', csrfToken);
        payload.set('action', 'transfer');
        payload.set('conversation_id', button.dataset.conversationId || '');
        payload.set('ticket_id', button.dataset.ticketId || '');
        payload.set('new_technician_id', String(newTechnicianId));

        const originalText = button.textContent;
        const mels = getTransferModalEls();
        if (fromModal && mels && mels.confirm) {
            mels.confirm.disabled = true;
            mels.confirm.textContent = 'Transferindo...';
        } else {
            button.disabled = true;
            button.textContent = 'Transferindo...';
        }

        function failTransfer(message) {
            if (fromModal) {
                if (mels && mels.confirm) {
                    mels.confirm.disabled = false;
                    mels.confirm.textContent = itgI18nTransferConfirm;
                }
                if (mels) {
                    showModalError(mels, message);
                } else {
                    alert(message);
                }
            } else {
                button.disabled = false;
                button.textContent = originalText;
                alert(message);
            }
        }

        fetch(actionUrl, {
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
                updateCsrfToken(result.body);

                if (!result.body || result.body.ok !== true) {
                    const msg = result.status === 403 && (!result.body || !result.body.csrf_token)
                        ? csrfErrorMessage()
                        : (result.body && result.body.message
                            ? result.body.message
                            : 'Erro ao transferir atendimento.');
                    failTransfer(msg);
                    return;
                }

                if (row) {
                    const technicianName = result.body.technician_name || String(result.body.technician_id || '');
                    row.setAttribute('data-technician', technicianName);
                    const technicianCell = row.querySelector('.js-integaglpi-central-technician');
                    if (technicianCell) {
                        technicianCell.textContent = 'Técnico: ' + technicianName;
                    }
                    updateContextPanel(row);
                }

                if (fromModal) {
                    closeTransferModal();
                } else {
                    button.disabled = false;
                    button.textContent = originalText;
                }

                if (result.body.glpi_assignment_warning) {
                    alert('Atendimento transferido, mas a atribuição do ticket GLPI falhou. Verifique o ticket.');
                } else {
                    showRefreshMessage('Atendimento transferido.', 'success');
                }

                lastRefreshAtMs = 0;
                refreshCentral(true);
            })
            .catch(function () {
                failTransfer('Erro ao transferir atendimento.');
            });
    }

    function solveConversation(button) {
        const payload = new URLSearchParams();
        payload.set('_glpi_csrf_token', csrfToken);
        payload.set('action', 'solve');
        payload.set('conversation_id', button.dataset.conversationId || '');
        payload.set('ticket_id', button.dataset.ticketId || '');

        const originalText = button.textContent;
        button.disabled = true;
        button.textContent = 'Solucionando...';

        fetch(actionUrl, {
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
                updateCsrfToken(result.body);

                if (!result.body || result.body.ok !== true) {
                    button.disabled = false;
                    button.textContent = originalText;
                    alert(result.status === 403 && (!result.body || !result.body.csrf_token)
                        ? csrfErrorMessage()
                        : (result.body && result.body.message ? result.body.message : 'Erro ao solucionar chamado.'));
                    return;
                }

                showRefreshMessage('Chamado solucionado', 'success');
                lastRefreshAtMs = 0;
                refreshCentral(true);
            })
            .catch(function () {
                button.disabled = false;
                button.textContent = originalText;
                alert('Erro ao solucionar chamado.');
            });
    }

    document.addEventListener('click', function (event) {
        const row = event.target.closest('tr[data-conversation-id]');
        if (
            row
            && !event.target.closest('button')
            && !event.target.closest('a')
            && !event.target.closest('textarea')
        ) {
            selectConversation(row);
            return;
        }

        const button = event.target.closest('.js-integaglpi-central-refresh');
        if (!button) {
            return;
        }

        event.preventDefault();
        refreshCentral(true);
    });

    window.setInterval(function () {
        if (document.hidden) {
            return;
        }

        const hasReplyInProgress = document.querySelector('tr[data-reply-in-progress="1"]') !== null;
        if (hasReplyInProgress) {
            return;
        }

        refreshCentral(false);
        loadSelectedMessages(false);
    }, pollingIntervalMs);

    document.addEventListener('click', function (event) {
        const button = event.target.closest('.js-integaglpi-central-claim');
        if (!button) {
            return;
        }

        event.preventDefault();

        const row = button.closest('tr');
        const payload = new URLSearchParams();
        payload.set('_glpi_csrf_token', csrfToken);
        payload.set('action', 'claim');
        payload.set('conversation_id', button.dataset.conversationId || '');
        payload.set('ticket_id', button.dataset.ticketId || '');

        button.disabled = true;

        fetch(actionUrl, {
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
                updateCsrfToken(result.body);

                if (!result.body || result.body.ok !== true) {
                    button.disabled = false;
                    alert(result.status === 403 && (!result.body || !result.body.csrf_token)
                        ? csrfErrorMessage()
                        : (result.body && result.body.message ? result.body.message : 'Erro ao assumir atendimento.'));
                    if (result.status === 409 && row) {
                        const technicianCell = row.querySelector('.js-integaglpi-central-technician');
                        if (technicianCell && result.body && result.body.technician_name) {
                            technicianCell.textContent = result.body.technician_name;
                        }
                        button.remove();
                    }
                    return;
                }

                if (row) {
                    const technicianCell = row.querySelector('.js-integaglpi-central-technician');
                    const actionsCell = row.querySelector('.js-integaglpi-central-actions');

                    if (technicianCell) {
                        technicianCell.textContent = result.body.technician_name || String(result.body.technician_id || '');
                    }

                    row.setAttribute('data-technician', result.body.technician_name || String(result.body.technician_id || ''));

                    if (selectedConversation && selectedConversation.conversationId === (row.getAttribute('data-conversation-id') || '')) {
                        updateContextPanel(row);
                    }

                    if (actionsCell) {
                        actionsCell.innerHTML = '<span class="text-muted">Atualize a página para responder.</span>';
                    }
                }

                if (result.body.glpi_assignment_warning) {
                    alert('Atendimento assumido, mas a atribuição do ticket GLPI falhou. Verifique o ticket.');
                }
            })
            .catch(function () {
                button.disabled = false;
                alert('Erro ao assumir atendimento.');
            });
    });

    document.addEventListener('click', function (event) {
        const button = event.target.closest('.js-integaglpi-central-reply');
        if (!button) {
            return;
        }

        event.preventDefault();

        const row = button.closest('tr');
        const replyBox = button.closest('[data-reply-box="1"]');
        const textarea = replyBox ? replyBox.querySelector('.js-integaglpi-central-reply-text') : null;
        const feedback = replyBox ? replyBox.querySelector('.js-integaglpi-central-reply-feedback') : null;
        const text = textarea ? textarea.value.trim() : '';

        if (!text) {
            alert('A mensagem não pode ser vazia.');
            return;
        }

        if (text.length > 4096) {
            alert('A mensagem deve ter no máximo 4096 caracteres.');
            return;
        }

        const payload = new URLSearchParams();
        payload.set('_glpi_csrf_token', csrfToken);
        payload.set('action', 'reply');
        payload.set('conversation_id', button.dataset.conversationId || '');
        payload.set('ticket_id', button.dataset.ticketId || '');
        payload.set('reply_text', text);
        payload.set('message', text);
        payload.set('idempotency_key', buildIdempotencyKey());

        const originalText = button.textContent;
        button.disabled = true;
        button.textContent = 'Enviando...';
        if (row) {
            row.setAttribute('data-reply-in-progress', '1');
        }
        if (feedback) {
            feedback.textContent = '';
        }

        fetch(actionUrl, {
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
                updateCsrfToken(result.body);

                if (!result.body || result.body.ok !== true) {
                    const message = result.status === 403 && (!result.body || !result.body.csrf_token)
                        ? csrfErrorMessage()
                        : result.body && result.body.message
                        ? result.body.message
                        : 'Erro ao enviar mensagem.';

                    alert(message);

                    if (result.status === 403 && (!result.body || !result.body.csrf_token)) {
                        button.disabled = false;
                        button.textContent = originalText;
                        if (row) {
                            row.removeAttribute('data-reply-in-progress');
                        }
                        return;
                    }

                    if (result.status === 403 || result.status === 409) {
                        if (row) {
                            row.removeAttribute('data-reply-in-progress');
                        }
                        if (replyBox) {
                            replyBox.textContent = '';
                            const muted = document.createElement('span');
                            muted.className = 'text-muted';
                            muted.textContent = message;
                            replyBox.appendChild(muted);
                        }
                        return;
                    }

                    button.disabled = false;
                    button.textContent = originalText;
                    if (row) {
                        row.removeAttribute('data-reply-in-progress');
                    }
                    return;
                }

                if (textarea) {
                    textarea.value = '';
                }

                if (feedback) {
                    feedback.textContent = result.body.message || 'Mensagem enviada.';
                }

                button.disabled = false;
                button.textContent = originalText;
                if (row) {
                    row.removeAttribute('data-reply-in-progress');
                }

                if (row) {
                    row.classList.add('table-success');
                    window.setTimeout(function () {
                        row.classList.remove('table-success');
                    }, 1200);
                }
            })
            .catch(function () {
                button.disabled = false;
                button.textContent = originalText;
                if (row) {
                    row.removeAttribute('data-reply-in-progress');
                }
                alert('Erro ao enviar mensagem.');
            });
    });

    document.addEventListener('click', function (event) {
        const tbtn = event.target.closest('.js-integaglpi-central-transfer');
        if (tbtn) {
            event.preventDefault();
            openTransferModal(tbtn);
            return;
        }

        const cancelBtn = event.target.closest('.js-itg-iw-modal-cancel');
        if (cancelBtn) {
            event.preventDefault();
            closeTransferModal();
        }
    });

    document.addEventListener('click', function (event) {
        const cbtn = event.target.closest('.js-itg-iw-modal-confirm');
        if (!cbtn) {
            return;
        }
        const els = getTransferModalEls();
        if (!els || !els.select) {
            return;
        }
        if (!transferModal.button) {
            return;
        }
        event.preventDefault();
        const selectedId = Number(els.select.value);
        if (!Number.isFinite(selectedId) || selectedId <= 0) {
            hideModalError(els);
            showModalError(els, 'Selecione um técnico de destino.');
            return;
        }
        transferConversation(transferModal.button, selectedId, true);
    });

    document.addEventListener('click', function (event) {
        const button = event.target.closest('.js-integaglpi-central-solve');
        if (!button) {
            return;
        }

        event.preventDefault();
        if (!window.confirm('Deseja marcar como resolvido?')) {
            return;
        }

        solveConversation(button);
    });
}());
</script>
