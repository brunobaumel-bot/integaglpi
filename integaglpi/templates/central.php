<?php

declare(strict_types=1);

/** @var \GlpiPlugin\Integaglpi\Renderer\CentralRenderer $this */
/** @var array<string, mixed> $data */

$filters = is_array($data['filters'] ?? null) ? $data['filters'] : [];
$pagination = is_array($data['pagination'] ?? null) ? $data['pagination'] : [];
$rows = is_array($data['rows'] ?? null) ? $data['rows'] : [];
$queues = is_array($data['queues'] ?? null) ? $data['queues'] : [];
$serviceCatalog = is_array($data['service_catalog'] ?? null) ? $data['service_catalog'] : [];
$technicians = is_array($data['technicians'] ?? null) ? $data['technicians'] : [];
$glpiEntities = is_array($data['glpi_entities'] ?? null) ? $data['glpi_entities'] : [];
$diagnostics = is_array($data['diagnostics'] ?? null) ? $data['diagnostics'] : null;
$centralErrorDiagnostic = is_array($data['central_error_diagnostic'] ?? null) ? $data['central_error_diagnostic'] : null;
$allowedStatuses = is_array($data['allowed_statuses'] ?? null) ? $data['allowed_statuses'] : [];
$limitOptions = is_array($data['limit_options'] ?? null) ? $data['limit_options'] : [25, 50];
$error = isset($data['error']) ? (string) $data['error'] : '';
$orphanedCleanupCount = (int) ($data['orphaned_cleanup_count'] ?? 0);
$currentPage = (int) ($pagination['page'] ?? 1);
$currentLimit = (int) ($pagination['limit'] ?? 25);
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
$statusLabelMap = [
    'collecting_contact_profile' => __('Coletando perfil', 'glpiintegaglpi'),
    'awaiting_entity_selection' => __('Aguardando seleção de entidade', 'glpiintegaglpi'),
    'awaiting_queue_selection' => __('Aguardando escolha de fila', 'glpiintegaglpi'),
    'open' => __('Chamado aberto', 'glpiintegaglpi'),
    'closed' => __('Fechado', 'glpiintegaglpi'),
    'media_error' => __('Erro de mídia', 'glpiintegaglpi'),
    'pending_glpi' => __('Aguardando GLPI', 'glpiintegaglpi'),
];
$windowFilterMap = [
    'open' => __('Janela 24h aberta', 'glpiintegaglpi'),
    'closed' => __('Janela 24h fechada', 'glpiintegaglpi'),
];
$inactivityFilterMap = [
    'attention' => __('Inatividade em atenção', 'glpiintegaglpi'),
    'sent' => __('Inatividade enviada', 'glpiintegaglpi'),
    'skipped' => __('Inatividade ignorada', 'glpiintegaglpi'),
];
$deliveryFilterMap = [
    'failed' => __('Falha Meta', 'glpiintegaglpi'),
    'pending' => __('Pendente', 'glpiintegaglpi'),
    'sent' => __('Enviada', 'glpiintegaglpi'),
    'delivered' => __('Entregue', 'glpiintegaglpi'),
    'read' => __('Lida', 'glpiintegaglpi'),
];
$operationalFilterMap = [
    'pre_ticket' => __('Pré-ticket', 'glpiintegaglpi'),
    'awaiting_entity' => __('Aguardando entidade', 'glpiintegaglpi'),
    'processing' => __('Criação em processamento', 'glpiintegaglpi'),
    'ambiguous_reconciliation' => __('Reconciliação ambígua', 'glpiintegaglpi'),
    'delivery_failed' => __('Delivery falhou', 'glpiintegaglpi'),
    'inactivity_attention' => __('Inatividade exige atenção', 'glpiintegaglpi'),
    'risk' => __('Em risco operacional', 'glpiintegaglpi'),
];
?>

<link rel="stylesheet" type="text/css" href="<?= $this->escape($whatsappCssUrl); ?>">

<style>
.itg-central-layout {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    height: calc(100vh - 110px);
    min-height: 660px;
    min-width: 0;
    overflow: hidden;
}

.itg-central-toolbar {
    flex: 0 0 auto;
    background: #fff;
    border: 1px solid rgba(98, 105, 118, 0.16);
    border-radius: 14px;
    box-shadow: 0 10px 28px rgba(24, 36, 51, 0.06);
    padding: 0.5rem 0.75rem;
}

.itg-central-toolbar-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    margin-bottom: 0;
}

.itg-central-filter-panel {
    margin-top: 0.4rem;
}

.itg-central-filter-panel > summary {
    align-items: center;
    cursor: pointer;
    display: inline-flex;
    gap: 0.35rem;
    min-height: 1.75rem;
}

.itg-central-filter-panel > summary::marker {
    font-size: 0.8rem;
}

.itg-central-filter-panel[open] .itg-conversation-filters {
    margin-top: 0.5rem;
}

.itg-central-shell {
    display: grid;
    grid-template-columns: minmax(300px, 0.9fr) minmax(420px, 1.35fr) minmax(260px, 0.75fr);
    grid-auto-rows: minmax(0, 1fr);
    gap: 1rem;
    align-items: stretch;
    flex: 1 1 auto;
    height: auto;
    min-height: 0;
    min-width: 0;
    overflow: hidden;
}

.itg-panel {
    background: #fff;
    border: 1px solid rgba(98, 105, 118, 0.16);
    border-radius: 14px;
    box-shadow: 0 10px 28px rgba(24, 36, 51, 0.06);
    height: 100%;
    min-height: 0;
    min-width: 0;
    overflow: hidden;
}

.itg-panel-header {
    border-bottom: 1px solid rgba(98, 105, 118, 0.16);
    padding: 1rem;
}

.itg-panel-body {
    padding: 1rem;
}

.itg-conversation-panel .itg-panel-header {
    padding: 0.5rem 0.75rem;
}

.itg-conversation-panel,
.itg-chat-panel,
.itg-context-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
}

.itg-conversation-panel .itg-panel-header,
.itg-conversation-filters,
.itg-conversation-pagination {
    flex: 0 0 auto;
}

.itg-conversation-list {
    flex: 1 1 auto;
    min-height: 0;
    max-height: none;
    overflow-y: auto;
    padding: 0.6rem 0.65rem;
}

.itg-conversation-pagination {
    background: #fff;
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
    border-spacing: 0 0.5rem;
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
    padding: 0.75rem;
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

.itg-chat-body {
    background:
        radial-gradient(circle at 12% 20%, rgba(32, 107, 196, 0.08), transparent 30%),
        linear-gradient(180deg, #f8fafc 0%, #eef3f8 100%);
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 1rem;
}

.itg-context-panel .itg-panel-body {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
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

@media (max-width: 991px) {
    .itg-central-layout {
        height: auto;
        min-height: 0;
        overflow: visible;
    }

    .itg-central-toolbar-header {
        align-items: flex-start;
        flex-direction: column;
    }

    .itg-central-shell {
        grid-template-columns: 1fr;
        height: auto;
        min-height: 0;
    }

    .itg-conversation-panel,
    .itg-chat-panel,
    .itg-context-panel {
        height: auto;
        min-height: 0;
    }

    .itg-conversation-list,
    .itg-chat-body,
    .itg-context-panel .itg-panel-body {
        max-height: none;
        overflow-y: visible;
    }
}
</style>

<div class="itg-central-layout">
    <div class="itg-central-toolbar">
        <div class="itg-central-toolbar-header">
            <div>
                <h2 class="h6 mb-0"><?= $this->escape(__('Central WhatsApp', 'glpiintegaglpi')); ?></h2>
                <small class="text-muted js-integaglpi-central-refreshed-at"></small>
            </div>
            <div class="d-flex gap-2 align-items-center">
                <span class="small text-muted d-none js-integaglpi-central-refresh-message"></span>
                <button type="button" class="btn btn-sm btn-outline-secondary js-integaglpi-central-refresh">
                    <?= $this->escape(__('Atualizar', 'glpiintegaglpi')); ?>
                </button>
                <span class="badge bg-secondary js-integaglpi-central-total">
                    <?= $total; ?> <?= $this->escape(__('conversas', 'glpiintegaglpi')); ?>
                </span>
            </div>
        </div>

        <details class="itg-central-filter-panel">
            <summary class="btn btn-sm btn-outline-secondary">
                <?= $this->escape(__('Filtros', 'glpiintegaglpi')); ?>
            </summary>
            <div class="itg-conversation-filters">

            <?php if ($error !== '') { ?>
                <div class="alert alert-warning mb-3">
                    <?= $this->escape($error); ?>
                    <?php if ($centralErrorDiagnostic !== null) { ?>
                        <div class="small mt-2">
                            <strong><?= $this->escape(__('Diagnóstico admin:', 'glpiintegaglpi')); ?></strong>
                            <?= $this->escape((string) ($centralErrorDiagnostic['type'] ?? '-')); ?>
                            <?php if (!empty($centralErrorDiagnostic['sqlstate'])) { ?>
                                · SQLSTATE <?= $this->escape((string) $centralErrorDiagnostic['sqlstate']); ?>
                            <?php } ?>
                            <?php if (!empty($centralErrorDiagnostic['detail'])) { ?>
                                · <?= $this->escape((string) $centralErrorDiagnostic['detail']); ?>
                            <?php } ?>
                        </div>
                    <?php } ?>
                </div>
            <?php } ?>
            <?php if ($orphanedCleanupCount > 0) { ?>
                <div class="alert alert-warning mb-3">
                    <?= $this->escape(sprintf(
                        _n(
                            'Uma conversa vinculada a chamado GLPI excluído foi encerrada logicamente e removida da lista ativa. O histórico foi preservado.',
                            '%d conversas vinculadas a chamados GLPI excluídos foram encerradas logicamente e removidas da lista ativa. O histórico foi preservado.',
                            $orphanedCleanupCount,
                            'glpiintegaglpi'
                        ),
                        $orphanedCleanupCount
                    )); ?>
                </div>
            <?php } ?>

            <?php // Phase: integaglpi_ops_console_claim_ui_messaging_stabilization_001 — default scope = only conversations assigned to the logged-in technician. ?>
            <?php $mineOnlyActive = !array_key_exists('mine_only', $filters) || (bool) ($filters['mine_only'] ?? true); ?>
            <form method="get" action="<?= $this->escape($this->getCentralUrl()); ?>" class="mb-2 js-integaglpi-central-filter-form">
                <input type="hidden" name="mine_only" value="<?= $mineOnlyActive ? '1' : '0'; ?>" class="js-integaglpi-central-mine-only-hidden">
                <div class="alert alert-secondary py-2 px-3 d-flex justify-content-between align-items-center small mb-2">
                    <span>
                        <?php if ($mineOnlyActive) { ?>
                            <strong><?= $this->escape(__('Apenas chamados atribuídos a você', 'glpiintegaglpi')); ?></strong>
                            <span class="text-muted"> · <?= $this->escape(__('Inclui transferências e claims pessoais.', 'glpiintegaglpi')); ?></span>
                        <?php } else { ?>
                            <strong><?= $this->escape(__('Exibindo todos os atendimentos', 'glpiintegaglpi')); ?></strong>
                            <span class="text-muted"> · <?= $this->escape(__('Você pode assumir qualquer conversa não atribuída.', 'glpiintegaglpi')); ?></span>
                        <?php } ?>
                    </span>
                    <button
                        type="submit"
                        class="btn btn-sm btn-outline-primary js-integaglpi-central-mine-only-toggle"
                        formaction="<?= $this->escape($this->getCentralUrl()); ?>"
                        name="mine_only"
                        value="<?= $mineOnlyActive ? '0' : '1'; ?>"
                    >
                        <?php if ($mineOnlyActive) { ?>
                            <?= $this->escape(__('Mostrar todos', 'glpiintegaglpi')); ?>
                        <?php } else { ?>
                            <?= $this->escape(__('Mostrar apenas os meus', 'glpiintegaglpi')); ?>
                        <?php } ?>
                    </button>
                </div>
                <div class="row g-2 align-items-end">
                    <div class="col-6 col-xl-2">
                        <label class="form-label small mb-1"><?= $this->escape(__('Status', 'glpiintegaglpi')); ?></label>
                        <select name="status" class="form-select form-select-sm">
                            <option value=""><?= $this->escape(__('Todos os status', 'glpiintegaglpi')); ?></option>
                            <?php foreach ($allowedStatuses as $status) { ?>
                                <?php $statusValue = (string) $status; ?>
                                <option value="<?= $this->escape($statusValue); ?>" <?= (string) ($filters['status'] ?? '') === $statusValue ? "selected='selected'" : ''; ?>>
                                    <?= $this->escape((string) ($statusLabelMap[$statusValue] ?? $statusValue)); ?>
                                </option>
                            <?php } ?>
                        </select>
                    </div>
                    <div class="col-6 col-xl-2">
                        <label class="form-label small mb-1"><?= $this->escape(__('Técnico', 'glpiintegaglpi')); ?></label>
                        <select name="technician_id" class="form-select form-select-sm">
                            <option value="0"><?= $this->escape(__('Todos os técnicos', 'glpiintegaglpi')); ?></option>
                            <?php foreach ($technicians as $technician) { ?>
                                <?php $technicianId = (int) ($technician['id'] ?? 0); ?>
                                <?php if ($technicianId <= 0) { continue; } ?>
                                <option value="<?= $technicianId; ?>" <?= (int) ($filters['technician_id'] ?? 0) === $technicianId ? "selected='selected'" : ''; ?>>
                                    <?= $this->escape((string) ($technician['name'] ?? ('#' . $technicianId))); ?>
                                </option>
                            <?php } ?>
                        </select>
                    </div>
                    <div class="col-6 col-xl-2">
                        <label class="form-label small mb-1"><?= $this->escape(__('Entidade', 'glpiintegaglpi')); ?></label>
                        <select name="entity_id" class="form-select form-select-sm">
                            <option value="0"><?= $this->escape(__('Todas permitidas', 'glpiintegaglpi')); ?></option>
                            <?php foreach ($glpiEntities as $entity) { ?>
                                <?php $entityId = (int) ($entity['id'] ?? 0); ?>
                                <?php if ($entityId <= 0) { continue; } ?>
                                <option value="<?= $entityId; ?>" <?= (int) ($filters['entity_id'] ?? 0) === $entityId ? "selected='selected'" : ''; ?>>
                                    <?= $this->escape((string) ($entity['name'] ?? ('Entidade #' . $entityId))); ?>
                                </option>
                            <?php } ?>
                        </select>
                    </div>
                    <div class="col-12 col-xl-4">
                        <label class="form-label small mb-1"><?= $this->escape(__('Telefone ou ticket', 'glpiintegaglpi')); ?></label>
                        <input
                            type="search"
                            name="search"
                            class="form-control form-control-sm"
                            value="<?= $this->escape((string) ($filters['search'] ?? '')); ?>"
                            placeholder="<?= $this->escape(__('Phone or ticket ID', 'glpiintegaglpi')); ?>"
                        >
                    </div>
                    <div class="col-12 col-xl-2">
                        <button type="submit" class="btn btn-sm btn-primary w-100">
                            <?= $this->escape(__('Filter', 'glpiintegaglpi')); ?>
                        </button>
                    </div>
                    <div class="col-12">
                        <details class="mt-1">
                            <summary class="small text-muted"><?= $this->escape(__('Mais filtros', 'glpiintegaglpi')); ?></summary>
                            <div class="row g-2 mt-1">
                                <div class="col-6">
                                    <label class="form-label small mb-1"><?= $this->escape(__('Queue', 'glpiintegaglpi')); ?></label>
                                    <select name="queue_id" class="form-select form-select-sm">
                                        <option value="0"><?= $this->escape(__('All queues', 'glpiintegaglpi')); ?></option>
                                        <?php foreach ($queues as $queue) { ?>
                                            <?php $queueId = (int) ($queue['id'] ?? 0); ?>
                                            <option value="<?= $queueId; ?>" <?= (int) ($filters['queue_id'] ?? 0) === $queueId ? "selected='selected'" : ''; ?>>
                                                <?= $this->escape((string) ($queue['name'] ?? ('#' . $queueId))); ?>
                                            </option>
                                        <?php } ?>
                                    </select>
                                </div>
                                <div class="col-6">
                                    <label class="form-label small mb-1"><?= $this->escape(__('Janela 24h', 'glpiintegaglpi')); ?></label>
                                    <select name="window_status" class="form-select form-select-sm">
                                        <option value=""><?= $this->escape(__('Todas', 'glpiintegaglpi')); ?></option>
                                        <?php foreach ($windowFilterMap as $value => $label) { ?>
                                            <option value="<?= $this->escape($value); ?>" <?= (string) ($filters['window_status'] ?? '') === $value ? "selected='selected'" : ''; ?>>
                                                <?= $this->escape((string) $label); ?>
                                            </option>
                                        <?php } ?>
                                    </select>
                                </div>
                                <div class="col-6">
                                    <label class="form-label small mb-1"><?= $this->escape(__('Inatividade', 'glpiintegaglpi')); ?></label>
                                    <select name="inactivity" class="form-select form-select-sm">
                                        <option value=""><?= $this->escape(__('Todas', 'glpiintegaglpi')); ?></option>
                                        <?php foreach ($inactivityFilterMap as $value => $label) { ?>
                                            <option value="<?= $this->escape($value); ?>" <?= (string) ($filters['inactivity'] ?? '') === $value ? "selected='selected'" : ''; ?>>
                                                <?= $this->escape((string) $label); ?>
                                            </option>
                                        <?php } ?>
                                    </select>
                                </div>
                                <div class="col-6">
                                    <label class="form-label small mb-1"><?= $this->escape(__('Delivery', 'glpiintegaglpi')); ?></label>
                                    <select name="delivery" class="form-select form-select-sm">
                                        <option value=""><?= $this->escape(__('Todos', 'glpiintegaglpi')); ?></option>
                                        <?php foreach ($deliveryFilterMap as $value => $label) { ?>
                                            <option value="<?= $this->escape($value); ?>" <?= (string) ($filters['delivery'] ?? '') === $value ? "selected='selected'" : ''; ?>>
                                                <?= $this->escape((string) $label); ?>
                                            </option>
                                        <?php } ?>
                                    </select>
                                </div>
                                <div class="col-8">
                                    <label class="form-label small mb-1"><?= $this->escape(__('Operacional', 'glpiintegaglpi')); ?></label>
                                    <select name="operational_state" class="form-select form-select-sm">
                                        <option value=""><?= $this->escape(__('Todos', 'glpiintegaglpi')); ?></option>
                                        <?php foreach ($operationalFilterMap as $value => $label) { ?>
                                            <option value="<?= $this->escape($value); ?>" <?= (string) ($filters['operational_state'] ?? '') === $value ? "selected='selected'" : ''; ?>>
                                                <?= $this->escape((string) $label); ?>
                                            </option>
                                        <?php } ?>
                                    </select>
                                </div>
                                <div class="col-4">
                                    <label class="form-label small mb-1"><?= $this->escape(__('Limit', 'glpiintegaglpi')); ?></label>
                                    <select name="limit" class="form-select form-select-sm">
                                        <?php foreach ($limitOptions as $limitOption) { ?>
                                            <?php $limitValue = (int) $limitOption; ?>
                                            <option value="<?= $limitValue; ?>" <?= $currentLimit === $limitValue ? "selected='selected'" : ''; ?>>
                                                <?= $limitValue; ?>
                                            </option>
                                        <?php } ?>
                                    </select>
                                </div>
                            </div>
                        </details>
                    </div>
                </div>
            </form>
            </div>
        </details>
    </div>

    <div class="itg-central-shell">
        <aside class="itg-panel itg-conversation-panel">
            <div class="itg-panel-header d-flex justify-content-between align-items-center">
                <strong><?= $this->escape(__('Conversas', 'glpiintegaglpi')); ?></strong>
                <small class="text-muted"><?= $this->escape(__('cards e ações', 'glpiintegaglpi')); ?></small>
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
                                <?= $this->escape(__('Nenhuma conversa WhatsApp encontrada.', 'glpiintegaglpi')); ?>
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
                        $maskedPhone = (string) ($row['masked_phone'] ?? $phone);
                        $contactName = (string) ($row['contact_name'] ?? '');
                        $queueName = (string) ($row['queue_name'] ?? '');
                        $activityAt = (string) ($row['activity_at'] ?? '');
                        $entityLabel = (string) ($row['entity_label'] ?? '');
                        $stalledLabel = (string) ($row['stalled_label'] ?? '');
                        $lastMessagePreview = trim((string) ($row['last_message_preview'] ?? ''));
                        $effectiveStatus = (string) ($row['effective_status'] ?? $row['conversation_status'] ?? '');
                        $statusLabel = (string) ($row['status_label'] ?? ($statusLabelMap[$effectiveStatus] ?? $effectiveStatus));
                        $operationalStateLabel = (string) ($row['operational_state_label'] ?? '');
                        $nextAction = (string) ($row['next_action'] ?? '');
                        $entityAttemptStatusLabel = (string) ($row['entity_attempt_status_label'] ?? '');
                        $entityAttemptError = (string) ($row['entity_attempt_error_sanitized'] ?? '');
                        $inactivityStatusLabel = (string) ($row['inactivity_status_label'] ?? '');
                        $inactivityEventKey = (string) ($row['inactivity_event_key'] ?? '');
                        $inactivityNextAction = (string) ($row['inactivity_next_action'] ?? '');
                        $inactivitySkipReason = (string) ($row['inactivity_tracking_skip_reason'] ?? $row['inactivity_event_reason'] ?? '');
                        $inactivityLastError = (string) ($row['inactivity_last_error_sanitized'] ?? '');
                        $inactivityDeliveryStatus = (string) ($row['inactivity_delivery_status'] ?? '');
                        $inactivityMetaErrorCode = (string) ($row['inactivity_meta_error_code'] ?? '');
                        $inactivityLastCheckedAt = (string) ($row['inactivity_last_checked_at'] ?? '');
                        $lastDeliveryStatusLabel = (string) ($row['last_delivery_status_label'] ?? '');
                        $lastDeliveryError = (string) ($row['last_delivery_error_sanitized'] ?? '');
                        $businessHoursLabel = (string) ($row['business_hours_label'] ?? '');
                        $aiQualityLabel = trim((string) ($row['ai_quality_status'] ?? '') . ' ' . (string) ($row['ai_sentiment'] ?? ''));
                        $contractLabel = trim((string) ($row['contract_alert_status'] ?? ''));
                        $contractPercent = (string) ($row['contract_consumed_percent'] ?? '');
                        $csatLabel = !empty($row['csat_dissatisfied'])
                            ? __('CSAT insatisfeito', 'glpiintegaglpi')
                            : (!empty($row['supervisor_review_required']) ? __('Revisão CSAT', 'glpiintegaglpi') : '');
                        $riskBadges = is_array($row['risk_badges'] ?? null) ? $row['risk_badges'] : [];
                        $slaContext = is_array($row['sla_context'] ?? null) ? $row['sla_context'] : [];
                        $slaStatus = (string) ($slaContext['status'] ?? 'not_configured');
                        $slaLabel = (string) ($slaContext['label'] ?? __('SLA não configurado', 'glpiintegaglpi'));
                        $slaResponseDeadline = (string) ($slaContext['response_deadline'] ?? '');
                        $slaSolutionDeadline = (string) ($slaContext['solution_deadline'] ?? '');
                        $slaPausedMinutes = (int) ($slaContext['paused_minutes'] ?? 0);
                        $slaReopenCount = (int) ($slaContext['reopen_count'] ?? 0);
                        $serviceCatalogName = (string) ($slaContext['service_name'] ?? $row['service_catalog_name'] ?? '');
                        $ticketLabel = (string) ($row['ticket_label'] ?? ($ticketId > 0 ? '#' . $ticketId : __('Pré-Ticket', 'glpiintegaglpi')));
                        $whatsappWindow = is_array($row['whatsapp_window'] ?? null) ? $row['whatsapp_window'] : [];
                        $windowLabel = (string) ($whatsappWindow['label'] ?? '');
                        $windowOpen = !empty($whatsappWindow['is_open']);
                        $windowAlert = (string) ($whatsappWindow['alert'] ?? '');
                        $memoryEntityId = (int) ($row['memory_entity_id'] ?? 0);
                        $memoryEntityName = trim((string) ($row['memory_entity_name'] ?? ''));
                        $memoryEntitySourceLabel = trim((string) ($row['memory_entity_source_label'] ?? ''));
                        $profileSnapshot = is_array($row['contact_profile_snapshot'] ?? null)
                            ? $row['contact_profile_snapshot']
                            : null;
                        $profileContext = is_array($row['profile_context'] ?? null)
                            ? $row['profile_context']
                            : [];
                        $profileName = trim((string) ($profileContext['name'] ?? $contactName));
                        $profileCompany = trim((string) ($profileContext['company'] ?? ''));
                        $profileEmail = trim((string) ($profileContext['email'] ?? ''));
                        $profileEquipment = trim((string) ($profileContext['equipment'] ?? ''));
                        $profileReason = trim((string) ($profileContext['reason'] ?? ''));
                        $profileAnswered = trim((string) ($profileContext['answered_label'] ?? '-'));
                        $profilePending = trim((string) ($profileContext['pending_label'] ?? '-'));
                        $profileCollectionComplete = !empty($row['profile_collection_complete']);
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
                        $canConfirmEntity = (
                            $effectiveStatus === 'awaiting_entity_selection'
                            || ($effectiveStatus === 'collecting_contact_profile' && $profileCollectionComplete)
                        )
                            && $canUpdateActions
                            && $ticketId <= 0
                            && $conversationId !== '';
                        $canEditEntity = $canUpdateActions
                            && !$canConfirmEntity
                            && $conversationId !== '';
                        $canSoftClose = $canUpdateActions
                            && !empty($row['can_soft_close'])
                            && $conversationId !== '';
                        ?>
                        <tr
                            data-conversation-id="<?= $this->escape($conversationId); ?>"
                            data-ticket-id="<?= $ticketId; ?>"
                            data-phone="<?= $this->escape($phone); ?>"
                            data-masked-phone="<?= $this->escape($maskedPhone); ?>"
                            data-contact-name="<?= $this->escape($contactName); ?>"
                            data-profile-name="<?= $this->escape($profileName); ?>"
                            data-profile-company="<?= $this->escape($profileCompany); ?>"
                            data-profile-email="<?= $this->escape($profileEmail); ?>"
                            data-profile-equipment="<?= $this->escape($profileEquipment); ?>"
                            data-profile-reason="<?= $this->escape($profileReason); ?>"
                            data-profile-answered="<?= $this->escape($profileAnswered); ?>"
                            data-profile-pending="<?= $this->escape($profilePending); ?>"
                            data-memory-entity="<?= $this->escape($memoryEntityId > 0 ? ($memoryEntityName !== '' ? $memoryEntityName : (string) $memoryEntityId) : '-'); ?>"
                            data-last-message="<?= $this->escape($lastMessagePreview); ?>"
                            data-status="<?= $this->escape($effectiveStatus); ?>"
                            data-status-label="<?= $this->escape($statusLabel); ?>"
                            data-operational-state="<?= $this->escape($operationalStateLabel); ?>"
                            data-next-action="<?= $this->escape($nextAction); ?>"
                            data-ticket-label="<?= $this->escape($ticketLabel); ?>"
                            data-queue="<?= $this->escape($queueName); ?>"
                            data-queue-id="<?= $queueId; ?>"
                            data-technician="<?= $this->escape($assignedLabel); ?>"
                            data-activity="<?= $this->escape($activityAt); ?>"
                            data-entity="<?= $this->escape($entityLabel); ?>"
                            data-window="<?= $this->escape($windowLabel); ?>"
                            data-delivery="<?= $this->escape($lastDeliveryStatusLabel); ?>"
                            data-delivery-error="<?= $this->escape($lastDeliveryError); ?>"
                            data-inactivity="<?= $this->escape($inactivityStatusLabel); ?>"
                            data-inactivity-next="<?= $this->escape($inactivityNextAction); ?>"
                            data-stalled="<?= $this->escape($stalledLabel); ?>"
                            data-business-hours="<?= $this->escape($businessHoursLabel); ?>"
                            data-ai="<?= $this->escape($aiQualityLabel !== '' ? $aiQualityLabel : '-'); ?>"
                            data-contract="<?= $this->escape($contractLabel !== '' ? trim($contractLabel . ' ' . $contractPercent) : '-'); ?>"
                            data-csat="<?= $this->escape($csatLabel !== '' ? $csatLabel : '-'); ?>"
                            data-attempt="<?= $this->escape($entityAttemptStatusLabel !== '' ? $entityAttemptStatusLabel : '-'); ?>"
                            data-service="<?= $this->escape($serviceCatalogName !== '' ? $serviceCatalogName : '-'); ?>"
                            data-sla="<?= $this->escape($slaLabel); ?>"
                            data-sla-status="<?= $this->escape($slaStatus); ?>"
                            data-sla-response-deadline="<?= $this->escape($slaResponseDeadline !== '' ? $slaResponseDeadline : '-'); ?>"
                            data-sla-solution-deadline="<?= $this->escape($slaSolutionDeadline !== '' ? $slaSolutionDeadline : '-'); ?>"
                            data-sla-paused="<?= $slaPausedMinutes; ?>"
                            data-sla-reopen="<?= $slaReopenCount; ?>"
                            data-can-reply="<?= $canReply ? '1' : '0'; ?>"
                            data-can-edit-entity="<?= $canEditEntity ? '1' : '0'; ?>"
                            data-can-soft-close="<?= $canSoftClose ? '1' : '0'; ?>"
                        >
                            <td colspan="8">
                                <div class="itg-card">
                                    <div class="d-flex justify-content-between gap-2">
                                        <div>
                                            <div class="itg-card-title">
                                                <?= $this->escape($profileName !== '' ? $profileName : ($contactName !== '' ? $contactName : $maskedPhone)); ?>
                                            </div>
                                            <div class="itg-card-meta">
                                                <?= $this->escape($maskedPhone); ?>
                                                <?php if ($profileCompany !== '') { ?>
                                                    · <?= $this->escape($profileCompany); ?>
                                                <?php } ?>
                                            </div>
                                        </div>
                                        <span class="badge bg-light text-dark">
                                            <?= $this->escape($ticketLabel); ?>
                                        </span>
                                    </div>
                                    <div class="itg-card-badges my-2">
                                        <?php if ($assignedUserId === $currentUserId) { ?>
                                            <span class="badge bg-primary"><?= $this->escape(__('Minha', 'glpiintegaglpi')); ?></span>
                                        <?php } elseif ($assignedUserId <= 0) { ?>
                                            <span class="badge bg-warning text-dark"><?= $this->escape(__('Sem técnico', 'glpiintegaglpi')); ?></span>
                                        <?php } else { ?>
                                            <span class="badge bg-info text-dark"><?= $this->escape(__('Aguardando', 'glpiintegaglpi')); ?></span>
                                        <?php } ?>
                                        <span class="badge bg-secondary"><?= $this->escape($statusLabel); ?></span>
                                        <?php if ($operationalStateLabel !== '') { ?>
                                            <span class="badge bg-dark"><?= $this->escape($operationalStateLabel); ?></span>
                                        <?php } ?>
                                        <?php if ($windowLabel !== '') { ?>
                                            <span class="badge <?= $windowOpen ? 'bg-success' : 'bg-warning text-dark'; ?>">
                                                <?= $this->escape($windowLabel); ?>
                                            </span>
                                        <?php } ?>
                                        <?php if ($lastDeliveryStatusLabel !== '') { ?>
                                            <span class="badge <?= (string) ($row['last_delivery_status'] ?? '') === 'failed' ? 'bg-danger' : 'bg-light text-dark'; ?>">
                                                <?= $this->escape($lastDeliveryStatusLabel); ?>
                                            </span>
                                        <?php } ?>
                                        <?php foreach ($riskBadges as $badge) { ?>
                                            <span class="badge <?= $this->escape((string) ($badge['class'] ?? 'bg-light text-dark')); ?>">
                                                <?= $this->escape((string) ($badge['label'] ?? '')); ?>
                                            </span>
                                        <?php } ?>
                                        <?php if ($profilePending !== '' && $profilePending !== '-') { ?>
                                            <span class="badge bg-warning text-dark">
                                                <?= $this->escape(__('Pendente', 'glpiintegaglpi')); ?>:
                                                <?= $this->escape($profilePending); ?>
                                            </span>
                                        <?php } ?>
                                    </div>
                                    <?php if (!$windowOpen && $windowAlert !== '') { ?>
                                        <div class="alert alert-warning py-2 mb-2">
                                            <?= $this->escape($windowAlert); ?>
                                        </div>
                                    <?php } ?>
                                    <?php if ($nextAction !== '') { ?>
                                        <div class="itg-card-meta">
                                            <?= $this->escape(__('Próxima ação', 'glpiintegaglpi')); ?>:
                                            <?= $this->escape($nextAction); ?>
                                        </div>
                                    <?php } ?>
                                    <?php if ($entityAttemptStatusLabel !== '') { ?>
                                        <div class="itg-card-meta">
                                            <?= $this->escape(__('Última tentativa', 'glpiintegaglpi')); ?>:
                                            <?= $this->escape($entityAttemptStatusLabel); ?>
                                        </div>
                                    <?php } ?>
                                    <?php if ($entityAttemptError !== '') { ?>
                                        <div class="alert alert-warning py-2 my-2">
                                            <?= $this->escape($entityAttemptError); ?>
                                        </div>
                                    <?php } ?>
                                    <?php if ($lastDeliveryError !== '') { ?>
                                        <div class="alert alert-danger py-2 my-2">
                                            <?= $this->escape(__('Falha Meta', 'glpiintegaglpi')); ?>:
                                            <?= $this->escape($lastDeliveryError); ?>
                                        </div>
                                    <?php } ?>
                                    <?php if ($inactivityStatusLabel !== '') { ?>
                                        <div class="border rounded p-2 my-2 bg-light">
                                            <strong><?= $this->escape(__('Inatividade', 'glpiintegaglpi')); ?>:</strong>
                                            <?= $this->escape($inactivityStatusLabel); ?>
                                            <?php if ($inactivityEventKey !== '') { ?>
                                                <span class="text-muted">(<?= $this->escape($inactivityEventKey); ?>)</span>
                                            <?php } ?>
                                            <?php if ($inactivityLastCheckedAt !== '') { ?>
                                                <br><span class="text-muted">
                                                    <?= $this->escape(__('Última checagem', 'glpiintegaglpi')); ?>:
                                                    <?= $this->escape($inactivityLastCheckedAt); ?>
                                                </span>
                                            <?php } ?>
                                            <?php if ($inactivityNextAction !== '') { ?>
                                                <br><?= $this->escape(__('Próxima ação', 'glpiintegaglpi')); ?>:
                                                <?= $this->escape($inactivityNextAction); ?>
                                            <?php } ?>
                                            <?php if ($inactivitySkipReason !== '') { ?>
                                                <br><?= $this->escape(__('Motivo', 'glpiintegaglpi')); ?>:
                                                <?= $this->escape($inactivitySkipReason); ?>
                                            <?php } ?>
                                            <?php if ($inactivityDeliveryStatus !== '') { ?>
                                                <br><?= $this->escape(__('Delivery', 'glpiintegaglpi')); ?>:
                                                <?= $this->escape($inactivityDeliveryStatus); ?>
                                            <?php } ?>
                                            <?php if ($inactivityMetaErrorCode !== '' || $inactivityLastError !== '') { ?>
                                                <br><span class="text-warning">
                                                    <?= $this->escape(__('Erro Meta', 'glpiintegaglpi')); ?>:
                                                    <?= $this->escape(trim($inactivityMetaErrorCode . ' ' . $inactivityLastError)); ?>
                                                </span>
                                            <?php } ?>
                                        </div>
                                    <?php } ?>
                                    <div class="itg-card-meta">
                                        <?= $this->escape(__('Fila', 'glpiintegaglpi')); ?>:
                                        <?= $this->escape($queueName !== '' ? $queueName : '-'); ?>
                                        <?php if ($queueId > 0) { ?>
                                            <span>#<?= $queueId; ?></span>
                                        <?php } ?>
                                    </div>
                                    <div class="itg-card-meta">
                                        <?= $this->escape(__('Entidade', 'glpiintegaglpi')); ?>:
                                        <?= $this->escape($entityLabel !== '' ? $entityLabel : '-'); ?>
                                    </div>
                                    <div class="itg-card-meta">
                                        <?= $this->escape(__('Serviço', 'glpiintegaglpi')); ?>:
                                        <?= $this->escape($serviceCatalogName !== '' ? $serviceCatalogName : '-'); ?>
                                    </div>
                                    <div class="itg-card-meta">
                                        <?= $this->escape(__('SLA', 'glpiintegaglpi')); ?>:
                                        <?= $this->escape($slaLabel); ?>
                                        <?php if ($slaResponseDeadline !== '') { ?>
                                            · <?= $this->escape(__('Resposta', 'glpiintegaglpi')); ?> <?= $this->escape($slaResponseDeadline); ?>
                                        <?php } ?>
                                        <?php if ($slaSolutionDeadline !== '') { ?>
                                            · <?= $this->escape(__('Solução', 'glpiintegaglpi')); ?> <?= $this->escape($slaSolutionDeadline); ?>
                                        <?php } ?>
                                    </div>
                                    <?php if ($canEditEntity) { ?>
                                        <details class="mt-2 mb-2 integaglpi-central-entity-edit" data-entity-box="1">
                                            <summary class="small"><?= $this->escape(__('Alterar entidade da conversa/memória', 'glpiintegaglpi')); ?></summary>
                                            <?php if ($ticketId > 0) { ?>
                                                <div class="alert alert-info py-2 my-2">
                                                    <?= $this->escape(__('Esta ação atualiza a conversa e a memória do contato. O ticket GLPI existente não será movido automaticamente.', 'glpiintegaglpi')); ?>
                                                </div>
                                            <?php } ?>
                                            <div class="integaglpi-entity-selection d-flex flex-wrap gap-2 align-items-center mt-2">
                                                <select
                                                    class="form-select form-select-sm js-integaglpi-entity-id"
                                                    name="glpi_entity_id"
                                                    style="min-width: 280px; max-width: 420px"
                                                    <?= count($glpiEntities) === 0 ? "disabled='disabled'" : ''; ?>
                                                >
                                                    <option value="" disabled selected>
                                                        <?= $this->escape(count($glpiEntities) === 0
                                                            ? __('Nenhuma entidade GLPI disponível', 'glpiintegaglpi')
                                                            : __('Selecione uma entidade GLPI', 'glpiintegaglpi')); ?>
                                                    </option>
                                                    <?php foreach ($glpiEntities as $entity) { ?>
                                                        <?php $entityId = (int) ($entity['id'] ?? 0); ?>
                                                        <?php if ($entityId <= 0) { continue; } ?>
                                                        <option value="<?= $entityId; ?>" <?= (int) ($row['glpi_entity_id'] ?? 0) === $entityId ? "selected='selected'" : ''; ?>>
                                                            <?= $this->escape((string) ($entity['name'] ?? ('Entidade #' . $entityId))); ?>
                                                        </option>
                                                    <?php } ?>
                                                </select>
                                                <button
                                                    type="button"
                                                    class="btn btn-sm btn-outline-warning js-integaglpi-update-entity"
                                                    data-conversation-id="<?= $this->escape($conversationId); ?>"
                                                    data-ticket-id="<?= $ticketId; ?>"
                                                    <?= count($glpiEntities) === 0 ? "disabled='disabled'" : ''; ?>
                                                >
                                                    <?= $this->escape(__('Atualizar entidade', 'glpiintegaglpi')); ?>
                                                </button>
                                                <small class="text-muted js-integaglpi-entity-feedback"></small>
                                            </div>
                                        </details>
                                    <?php } ?>
                                    <?php if ($memoryEntityId > 0) { ?>
                                        <div class="itg-card-meta">
                                            <?= $this->escape(__('Entidade memorizada', 'glpiintegaglpi')); ?>:
                                            <?= $this->escape($memoryEntityName !== '' ? $memoryEntityName : (string) $memoryEntityId); ?>
                                            <?php if ($memoryEntitySourceLabel !== '') { ?>
                                                <span class="text-muted small">(<?= $this->escape($memoryEntitySourceLabel); ?>)</span>
                                            <?php } ?>
                                        </div>
                                    <?php } ?>
                                    <div class="itg-card-meta js-integaglpi-central-technician">
                                        <?= $this->escape(__('Técnico', 'glpiintegaglpi')); ?>:
                                        <?php if ($assignedLabel !== '') { ?>
                                            <?= $this->escape($assignedLabel); ?>
                                        <?php } elseif ($canSoftClose) { ?>
                                            <button
                                                type="button"
                                                class="btn btn-sm btn-outline-danger js-integaglpi-central-soft-close"
                                                data-conversation-id="<?= $this->escape($conversationId); ?>"
                                                data-ticket-id="0"
                                            >
                                                <?= $this->escape(__('Encerrar administrativamente', 'glpiintegaglpi')); ?>
                                            </button>
                                        <?php } else { ?>
                                            <span class="text-muted">-</span>
                                        <?php } ?>
                                    </div>
                                    <div class="itg-card-meta">
                                        <?= $this->escape(__('Última atividade', 'glpiintegaglpi')); ?>:
                                        <?= $this->escape($activityAt); ?>
                                        <?php if ($stalledLabel !== '') { ?>
                                            · <?= $this->escape(__('parado há', 'glpiintegaglpi')); ?> <?= $this->escape($stalledLabel); ?>
                                        <?php } ?>
                                    </div>
                                    <?php if ($lastMessagePreview !== '') { ?>
                                        <div class="itg-card-meta">
                                            <?= $this->escape(__('Última mensagem', 'glpiintegaglpi')); ?>:
                                            <?= $this->escape(function_exists('mb_substr') ? mb_substr($lastMessagePreview, 0, 140) : substr($lastMessagePreview, 0, 140)); ?>
                                        </div>
                                    <?php } ?>
                                    <?php if ($profileSnapshot !== null || $profileAnswered !== '-' || $profilePending !== '-') { ?>
                                        <div class="border rounded p-3 mt-3 mb-0 bg-light">
                                            <strong><?= $this->escape(__('Perfil do contato', 'glpiintegaglpi')); ?></strong><br>
                                            <?= $this->escape(__('Nome', 'glpiintegaglpi')); ?>:
                                            <?= $this->escape($profileName !== '' ? $profileName : '-'); ?><br>
                                            <?= $this->escape(__('Empresa informada', 'glpiintegaglpi')); ?>:
                                            <?= $this->escape($profileCompany !== '' ? $profileCompany : '-'); ?><br>
                                            <?= $this->escape(__('E-mail', 'glpiintegaglpi')); ?>:
                                            <?= $this->escape($profileEmail !== '' ? $profileEmail : '-'); ?><br>
                                            <?= $this->escape(__('Equipamento', 'glpiintegaglpi')); ?>:
                                            <?= $this->escape($profileEquipment !== '' ? $profileEquipment : '-'); ?><br>
                                            <?= $this->escape(__('Resumo', 'glpiintegaglpi')); ?>:
                                            <?= $this->escape($profileReason !== '' ? $profileReason : '-'); ?><br>
                                            <?= $this->escape(__('Respondidos', 'glpiintegaglpi')); ?>:
                                            <?= $this->escape($profileAnswered); ?><br>
                                            <?= $this->escape(__('Pendentes', 'glpiintegaglpi')); ?>:
                                            <?= $this->escape($profilePending); ?>
                                        </div>
                                    <?php } ?>
                                    <div class="mt-2 js-integaglpi-central-actions">
                                        <?php if ($canConfirmEntity) { ?>
                                            <div class="alert alert-warning py-2 mb-2">
                                                <?= $this->escape(__('Entidade do contato ainda não definida.', 'glpiintegaglpi')); ?>
                                            </div>
                                            <?php if ($memoryEntityId > 0) { ?>
                                                <div class="alert alert-info py-2 mb-2 d-flex align-items-center gap-2">
                                                    <div>
                                                        <strong><?= $this->escape(__('Entidade memorizada disponível', 'glpiintegaglpi')); ?>:</strong>
                                                        <?= $this->escape($memoryEntityName !== '' ? $memoryEntityName : (string) $memoryEntityId); ?>
                                                    </div>
                                                    <button
                                                        type="button"
                                                        class="btn btn-sm btn-success js-integaglpi-apply-memory-entity"
                                                        data-conversation-id="<?= $this->escape($conversationId); ?>"
                                                        data-entity-id="<?= $memoryEntityId; ?>"
                                                        data-entity-name="<?= $this->escape($memoryEntityName); ?>"
                                                        title="<?= $this->escape(__('Aplica a entidade memorizada e cria o chamado. A permissão sobre a entidade será verificada.', 'glpiintegaglpi')); ?>"
                                                    >
                                                        <?= $this->escape(__('Aplicar e criar chamado', 'glpiintegaglpi')); ?>
                                                    </button>
                                                    <small class="text-muted js-integaglpi-entity-feedback"></small>
                                                </div>
                                            <?php } ?>
                                            <div class="integaglpi-central-entity" data-entity-box="1">
                                                <label class="form-label small mb-1"><?= $this->escape(__('Filtrar entidades', 'glpiintegaglpi')); ?></label>
                                                <input
                                                    type="search"
                                                    class="form-control form-control-sm mb-2 js-integaglpi-entity-filter"
                                                    placeholder="<?= $this->escape(__('Digite para filtrar a lista', 'glpiintegaglpi')); ?>"
                                                    autocomplete="off"
                                                    aria-label="<?= $this->escape(__('Filtrar entidades', 'glpiintegaglpi')); ?>"
                                                >
                                                <div class="integaglpi-entity-selection d-flex flex-wrap gap-2 align-items-center">
                                                <div class="integaglpi-entity-dropdown" style="min-width: 280px; max-width: 420px">
                                                    <select
                                                        class="form-select form-select-sm js-integaglpi-entity-id"
                                                        name="glpi_entity_id"
                                                        <?= count($glpiEntities) === 0 ? "disabled='disabled'" : ''; ?>
                                                    >
                                                        <option value="" disabled selected>
                                                            <?= $this->escape(count($glpiEntities) === 0
                                                                ? __('Nenhuma entidade GLPI disponível', 'glpiintegaglpi')
                                                                : __('Selecione uma entidade GLPI', 'glpiintegaglpi')); ?>
                                                        </option>
                                                        <?php foreach ($glpiEntities as $entity) { ?>
                                                            <?php $entityId = (int) ($entity['id'] ?? 0); ?>
                                                            <?php if ($entityId <= 0) { continue; } ?>
                                                            <option value="<?= $entityId; ?>">
                                                                <?= $this->escape((string) ($entity['name'] ?? ('Entidade #' . $entityId))); ?>
                                                            </option>
                                                        <?php } ?>
                                                    </select>
                                                </div>
                                                <?php if ($serviceCatalog !== []) { ?>
                                                    <div style="min-width: 260px; max-width: 380px">
                                                        <select
                                                            class="form-select form-select-sm js-integaglpi-service-catalog-id"
                                                            name="service_catalog_id"
                                                        >
                                                            <option value="0"><?= $this->escape(__('Serviço opcional', 'glpiintegaglpi')); ?></option>
                                                            <?php foreach ($serviceCatalog as $serviceOption) { ?>
                                                                <?php
                                                                $serviceId = (int) ($serviceOption['id'] ?? 0);
                                                                if ($serviceId <= 0) {
                                                                    continue;
                                                                }
                                                                $requiredFields = is_array($serviceOption['required_fields'] ?? null)
                                                                    ? $serviceOption['required_fields']
                                                                    : [];
                                                                $serviceLabel = (string) ($serviceOption['name'] ?? ('Serviço #' . $serviceId));
                                                                ?>
                                                                <option
                                                                    value="<?= $serviceId; ?>"
                                                                    data-required-fields="<?= $this->escape(json_encode($requiredFields, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?: '[]'); ?>"
                                                                >
                                                                    <?= $this->escape($serviceLabel); ?>
                                                                </option>
                                                            <?php } ?>
                                                        </select>
                                                    </div>
                                                    <textarea
                                                        class="form-control form-control-sm js-integaglpi-service-checklist-json"
                                                        name="service_checklist_json"
                                                        rows="2"
                                                        placeholder="<?= $this->escape(__('Checklist do serviço em JSON quando obrigatório', 'glpiintegaglpi')); ?>"
                                                        style="min-width: 260px; max-width: 420px"
                                                    ></textarea>
                                                <?php } ?>
                                                <button
                                                    type="button"
                                                    class="btn btn-sm btn-warning js-integaglpi-confirm-entity"
                                                    data-conversation-id="<?= $this->escape($conversationId); ?>"
                                                    data-ticket-id="0"
                                                    <?= count($glpiEntities) === 0 ? "disabled='disabled'" : ''; ?>
                                                >
                                                    <?= $this->escape(__('Salvar entidade e criar chamado', 'glpiintegaglpi')); ?>
                                                </button>
                                                <button
                                                    type="button"
                                                    class="btn btn-sm btn-outline-secondary"
                                                    title="<?= $this->escape(__('A entidade selecionada será usada para criar este chamado e atualizar a memória do contato.', 'glpiintegaglpi')); ?>"
                                                    aria-label="<?= $this->escape(__('Informações sobre seleção de entidade', 'glpiintegaglpi')); ?>"
                                                ><i class="ti ti-info-circle"></i></button>
                                                <small class="text-muted js-integaglpi-entity-feedback"></small>
                                                </div>
                                            </div>
                                        <?php } elseif ($canClaim) { ?>
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

        <div class="itg-conversation-pagination d-flex justify-content-between align-items-center p-3 border-top">
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

    <aside class="itg-panel itg-context-panel">
        <div class="itg-panel-header">
            <h3 class="h5 mb-1"><?= $this->escape(__('Contexto do ticket', 'glpiintegaglpi')); ?></h3>
            <small class="text-muted"><?= $this->escape(__('Resumo operacional da conversa selecionada', 'glpiintegaglpi')); ?></small>
        </div>
        <div class="itg-panel-body">
            <div class="itg-context-list">
                <div class="itg-context-item">
                    <small class="text-muted d-block"><?= $this->escape(__('Contato', 'glpiintegaglpi')); ?></small>
                    <span class="js-integaglpi-central-context-contact">-</span><br>
                    <span class="small text-muted js-integaglpi-central-context-phone">-</span>
                </div>
                <div class="itg-context-item">
                    <small class="text-muted d-block"><?= $this->escape(__('Perfil informado', 'glpiintegaglpi')); ?></small>
                    <span><?= $this->escape(__('Empresa', 'glpiintegaglpi')); ?>: <span class="js-integaglpi-central-context-company">-</span></span><br>
                    <span><?= $this->escape(__('E-mail', 'glpiintegaglpi')); ?>: <span class="js-integaglpi-central-context-email">-</span></span><br>
                    <span><?= $this->escape(__('Equipamento', 'glpiintegaglpi')); ?>: <span class="js-integaglpi-central-context-equipment">-</span></span>
                </div>
                <div class="itg-context-item">
                    <small class="text-muted d-block"><?= $this->escape(__('Pré-ticket', 'glpiintegaglpi')); ?></small>
                    <span><?= $this->escape(__('Respondidos', 'glpiintegaglpi')); ?>: <span class="js-integaglpi-central-context-answered">-</span></span><br>
                    <span><?= $this->escape(__('Pendentes', 'glpiintegaglpi')); ?>: <span class="js-integaglpi-central-context-pending">-</span></span><br>
                    <span><?= $this->escape(__('Próxima ação', 'glpiintegaglpi')); ?>: <span class="js-integaglpi-central-context-next-action">-</span></span>
                </div>
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
                    <small class="text-muted d-block"><?= $this->escape(__('Serviço / SLA', 'glpiintegaglpi')); ?></small>
                    <span><?= $this->escape(__('Serviço', 'glpiintegaglpi')); ?>: <span class="js-integaglpi-central-context-service">-</span></span><br>
                    <span><?= $this->escape(__('Status', 'glpiintegaglpi')); ?>: <span class="js-integaglpi-central-context-sla">-</span></span><br>
                    <span class="small text-muted js-integaglpi-central-context-sla-deadlines">-</span>
                </div>
                <div class="itg-context-item">
                    <small class="text-muted d-block"><?= $this->escape(__('Técnico', 'glpiintegaglpi')); ?></small>
                    <span class="js-integaglpi-central-context-technician">-</span>
                </div>
                <div class="itg-context-item">
                    <small class="text-muted d-block"><?= $this->escape(__('Status', 'glpiintegaglpi')); ?></small>
                    <span class="js-integaglpi-central-context-status">-</span>
                </div>
                <div class="itg-context-item">
                    <small class="text-muted d-block"><?= $this->escape(__('Entidade', 'glpiintegaglpi')); ?></small>
                    <span class="js-integaglpi-central-context-entity">-</span>
                    <br><small class="text-muted"><?= $this->escape(__('Memória', 'glpiintegaglpi')); ?>:
                        <span class="js-integaglpi-central-context-memory-entity">-</span>
                    </small>
                </div>
                <div class="itg-context-item">
                    <small class="text-muted d-block"><?= $this->escape(__('Janela WhatsApp 24h', 'glpiintegaglpi')); ?></small>
                    <span class="js-integaglpi-central-context-window">-</span>
                </div>
                <div class="itg-context-item">
                    <small class="text-muted d-block"><?= $this->escape(__('Delivery', 'glpiintegaglpi')); ?></small>
                    <span class="js-integaglpi-central-context-delivery">-</span>
                </div>
                <div class="itg-context-item">
                    <small class="text-muted d-block"><?= $this->escape(__('Inatividade', 'glpiintegaglpi')); ?></small>
                    <span class="js-integaglpi-central-context-inactivity">-</span>
                </div>
                <div class="itg-context-item">
                    <small class="text-muted d-block"><?= $this->escape(__('Tempo parado / horário', 'glpiintegaglpi')); ?></small>
                    <span class="js-integaglpi-central-context-stalled">-</span>
                </div>
                <div class="itg-context-item">
                    <small class="text-muted d-block"><?= $this->escape(__('Tentativa de entidade', 'glpiintegaglpi')); ?></small>
                    <span class="js-integaglpi-central-context-attempt">-</span>
                </div>
                <div class="itg-context-item">
                    <small class="text-muted d-block"><?= $this->escape(__('IA / CSAT / Contrato', 'glpiintegaglpi')); ?></small>
                    <span class="js-integaglpi-central-context-ai">-</span><br>
                    <span class="js-integaglpi-central-context-csat">-</span><br>
                    <span class="js-integaglpi-central-context-contract">-</span>
                </div>
                <div class="itg-context-item">
                    <small class="text-muted d-block"><?= $this->escape(__('Atalhos', 'glpiintegaglpi')); ?></small>
                    <a class="js-integaglpi-central-context-whatsapp" href="#" target="_blank" rel="noopener noreferrer">
                        <?= $this->escape(__('Contexto WhatsApp', 'glpiintegaglpi')); ?>
                    </a>
                </div>
                <?php if ($diagnostics !== null) { ?>
                    <div class="itg-context-item js-integaglpi-central-diagnostics-readonly">
                        <small class="text-muted d-block"><?= $this->escape(__('Diagnóstico somente leitura', 'glpiintegaglpi')); ?></small>
                        <?php $node = is_array($diagnostics['node'] ?? null) ? $diagnostics['node'] : []; ?>
                        <?php $glpi = is_array($diagnostics['glpi'] ?? null) ? $diagnostics['glpi'] : []; ?>
                        <?php $meta = is_array($diagnostics['meta'] ?? null) ? $diagnostics['meta'] : []; ?>
                        <?php $ai = is_array($diagnostics['ai'] ?? null) ? $diagnostics['ai'] : []; ?>
                        <span>Node: <?= $this->escape((string) ($node['status'] ?? $diagnostics['status'] ?? '-')); ?></span><br>
                        <span>GLPI: <?= $this->escape((string) ($glpi['status'] ?? '-')); ?></span><br>
                        <span>Meta: <?= $this->escape((string) ($meta['status'] ?? $meta['webhook_guard'] ?? '-')); ?></span><br>
                        <span>IA: <?= $this->escape((string) ($ai['status'] ?? $ai['enabled'] ?? '-')); ?></span>
                    </div>
                <?php } ?>
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
</div>

<div id="itg-iw-soft-close-modal" class="itg-iw-modal-backdrop d-none" aria-hidden="true" role="dialog" aria-modal="true" aria-labelledby="itg-iw-soft-close-title">
    <div class="itg-iw-modal">
        <div class="itg-iw-modal__header" id="itg-iw-soft-close-title"><?= $this->escape(__('Encerrar administrativamente', 'glpiintegaglpi')); ?></div>
        <div class="itg-iw-modal__body">
            <p class="mb-2">
                <?= $this->escape(__('Esta ação encerra somente a conversa presa na integração. Nenhum WhatsApp será enviado e nenhum ticket GLPI será alterado.', 'glpiintegaglpi')); ?>
            </p>
            <label class="form-label small mb-1" for="itg-iw-soft-close-reason"><?= $this->escape(__('Motivo obrigatório', 'glpiintegaglpi')); ?></label>
            <textarea id="itg-iw-soft-close-reason" class="form-control form-control-sm js-itg-iw-soft-close-reason" rows="4" maxlength="500"></textarea>
            <p class="itg-iw-modal__error d-none js-itg-iw-soft-close-error mb-0 mt-2" role="alert"></p>
        </div>
        <div class="itg-iw-modal__actions">
            <button type="button" class="btn btn-sm btn-secondary js-itg-iw-soft-close-cancel"><?= $this->escape(__('Cancelar', 'glpiintegaglpi')); ?></button>
            <button type="button" class="btn btn-sm btn-danger js-itg-iw-soft-close-confirm" disabled><?= $this->escape(__('Encerrar', 'glpiintegaglpi')); ?></button>
        </div>
    </div>
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
    const glpiEntities = <?= json_encode(array_values($glpiEntities), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE); ?>;
    const serviceCatalog = <?= json_encode(array_values($serviceCatalog), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE); ?>;
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

    function buildEntitySelectionIdempotencyKey(conversationId, entityId) {
        const safeConversationId = String(conversationId || 'conversation').replace(/[^a-zA-Z0-9._-]/g, '_');
        return 'entity_selection:' + safeConversationId + ':' + String(entityId);
    }

    function escapeHtml(value) {
        return String(value === null || value === undefined ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    const statusLabels = {
        collecting_contact_profile: 'Coletando perfil',
        awaiting_entity_selection: 'Aguardando seleção de entidade',
        awaiting_queue_selection: 'Aguardando escolha de fila',
        open: 'Chamado aberto',
        closed: 'Fechado',
        media_error: 'Erro de mídia',
        pending_glpi: 'Aguardando GLPI'
    };

    function friendlyStatus(row) {
        const status = String(row.effective_status || row.conversation_status || '').trim();
        return String(row.status_label || statusLabels[status] || status || 'Sem status');
    }

    function nextActionLabel(row, hasTicket) {
        const explicit = String(row.next_action || '').trim();
        if (explicit !== '') {
            return explicit;
        }

        const status = String(row.effective_status || row.conversation_status || '').trim();
        if (status === 'awaiting_entity_selection') {
            return 'Selecione a entidade para criar o chamado';
        }
        if (status === 'awaiting_queue_selection') {
            return 'Selecione a fila';
        }
        if (status === 'collecting_contact_profile') {
            return 'Aguarde o usuário responder';
        }
        if (status === 'media_error') {
            return 'Verifique erro de mídia';
        }
        if (status === 'open') {
            return 'Responda o cliente';
        }

        return hasTicket ? 'Acompanhe o chamado' : 'Aguarde o usuário responder';
    }

    function ticketDisplayLabel(row, ticketId) {
        const explicit = String(row.ticket_label || '').trim();
        return explicit !== '' ? explicit : (ticketId > 0 ? '#' + ticketId : 'Pré-Ticket');
    }

    function showRefreshMessage(message, type) {
        const box = document.querySelector('.js-integaglpi-central-refresh-message');
        if (!box) {
            return;
        }

        box.className = 'small js-integaglpi-central-refresh-message mt-1 text-' + (type === 'danger' ? 'danger' : 'muted');
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

    function renderEntityOptions(selectedEntityId) {
        const selectedId = Number(selectedEntityId || 0);
        if (!Array.isArray(glpiEntities) || glpiEntities.length === 0) {
            return '<option value="">Nenhuma entidade GLPI disponível</option>';
        }

        return '<option value="" disabled' + (selectedId > 0 ? '' : ' selected') + '>Selecione uma entidade GLPI</option>' + glpiEntities.map(function (entity) {
            const id = Number(entity.id || 0);
            const name = String(entity.name || '').trim();
            if (!Number.isInteger(id) || id <= 0 || name === '' || /^-+$/.test(name)) {
                return '';
            }

            return '<option value="' + id + '"' + (selectedId === id ? ' selected' : '') + '>' + escapeHtml(name) + '</option>';
        }).join('');
    }

    function renderServiceCatalogControls() {
        if (!Array.isArray(serviceCatalog) || serviceCatalog.length === 0) {
            return '';
        }

        const options = serviceCatalog.map(function (service) {
            const id = Number(service.id || 0);
            if (!Number.isInteger(id) || id <= 0) {
                return '';
            }
            const required = Array.isArray(service.required_fields) ? service.required_fields : [];
            return '<option value="' + id + '" data-required-fields="' + escapeHtml(JSON.stringify(required)) + '">'
                + escapeHtml(String(service.name || ('Serviço #' + id)))
                + '</option>';
        }).join('');

        return '<div style="min-width: 260px; max-width: 380px">'
            + '<select class="form-select form-select-sm js-integaglpi-service-catalog-id" name="service_catalog_id">'
            + '<option value="0">Serviço opcional</option>'
            + options
            + '</select></div>'
            + '<textarea class="form-control form-control-sm js-integaglpi-service-checklist-json"'
            + ' name="service_checklist_json" rows="2"'
            + ' placeholder="Checklist do serviço em JSON quando obrigatório"'
            + ' style="min-width: 260px; max-width: 420px"></textarea>';
    }

    function renderEntityEditControls(row) {
        if (!canUpdateActions || !row.can_edit_entity) {
            return '';
        }

        const conversationId = escapeHtml(row.conversation_id || '');
        const ticketId = Number(row.glpi_ticket_id || 0);
        const hasEntities = Array.isArray(glpiEntities) && glpiEntities.length > 0;
        const warning = ticketId > 0
            ? '<div class="alert alert-info py-2 my-2">Esta ação atualiza a conversa e a memória do contato. O ticket GLPI existente não será movido automaticamente.</div>'
            : '';

        return '<details class="mt-2 mb-2 integaglpi-central-entity-edit" data-entity-box="1">'
            + '<summary class="small">Alterar entidade da conversa/memória</summary>'
            + warning
            + '<div class="integaglpi-entity-selection d-flex flex-wrap gap-2 align-items-center mt-2">'
            + '<select class="form-select form-select-sm js-integaglpi-entity-id" name="glpi_entity_id"'
            + ' style="min-width: 280px; max-width: 420px"' + (hasEntities ? '' : ' disabled') + '>'
            + renderEntityOptions(row.glpi_entity_id)
            + '</select>'
            + '<button type="button" class="btn btn-sm btn-outline-warning js-integaglpi-update-entity"'
            + ' data-conversation-id="' + conversationId + '" data-ticket-id="' + ticketId + '"' + (hasEntities ? '' : ' disabled')
            + '>Atualizar entidade</button>'
            + '<small class="text-muted js-integaglpi-entity-feedback"></small>'
            + '</div></details>';
    }

    function isProtectedRow(row) {
        const textarea = row.querySelector('.js-integaglpi-central-reply-text');
        const hasDraft = textarea && textarea.value.trim() !== '';
        const hasEntityFlow = row.querySelector('.integaglpi-central-entity') !== null
            || row.querySelector('[data-request-in-progress="1"]') !== null;
        return row.getAttribute('data-reply-in-progress') === '1' || hasDraft || hasEntityFlow;
    }

    function renderActions(row) {
        const conversationId = escapeHtml(row.conversation_id || '');
        const ticketId = Number(row.glpi_ticket_id || 0);

        if (canUpdateActions && row.can_confirm_entity) {
            const hasEntities = Array.isArray(glpiEntities) && glpiEntities.length > 0;
            const memId = Number(row.memory_entity_id || 0);
            const memName = String(row.memory_entity_name || '').trim();
            const memoryApplyBtn = memId > 0
                ? '<div class="alert alert-info py-2 mb-2 d-flex align-items-center gap-2">'
                    + '<div><strong>Entidade memorizada disponível:</strong> ' + escapeHtml(memName || String(memId)) + '</div>'
                    + '<button type="button" class="btn btn-sm btn-success js-integaglpi-apply-memory-entity"'
                    + ' data-conversation-id="' + conversationId + '"'
                    + ' data-entity-id="' + memId + '"'
                    + ' data-entity-name="' + escapeHtml(memName) + '"'
                    + ' title="Aplica a entidade memorizada e cria o chamado. A permissão sobre a entidade será verificada."'
                    + '>Aplicar e criar chamado</button>'
                    + '<small class="text-muted js-integaglpi-entity-feedback"></small>'
                    + '</div>'
                : '';
            return '<div class="alert alert-warning py-2 mb-2">Entidade do contato ainda não definida.</div>'
                + memoryApplyBtn
                + '<div class="integaglpi-central-entity" data-entity-box="1">'
                + '<label class="form-label small mb-1">Filtrar entidades</label>'
                + '<input type="search" class="form-control form-control-sm mb-2 js-integaglpi-entity-filter" placeholder="Digite para filtrar a lista" autocomplete="off" aria-label="Filtrar entidades">'
                + '<div class="integaglpi-entity-selection d-flex flex-wrap gap-2 align-items-center">'
                + '<select class="form-select form-select-sm js-integaglpi-entity-id"'
                + ' name="glpi_entity_id"'
                + ' style="min-width: 280px; max-width: 420px"' + (hasEntities ? '' : ' disabled') + '>'
                + renderEntityOptions(0)
                + '</select>'
                + renderServiceCatalogControls()
                + '<button type="button" class="btn btn-sm btn-warning js-integaglpi-confirm-entity"'
                + ' data-conversation-id="' + conversationId + '" data-ticket-id="0"' + (hasEntities ? '' : ' disabled')
                + '>Salvar entidade e criar chamado</button>'
                + '<button type="button" class="btn btn-sm btn-outline-secondary"'
                + ' title="A entidade selecionada será usada para criar este chamado e atualizar a memória do contato."'
                + ' aria-label="Informações sobre seleção de entidade"><i class="ti ti-info-circle"></i></button>'
                + '<small class="text-muted js-integaglpi-entity-feedback"></small>'
                + '</div></div>';
        }

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

        if (canUpdateActions && row.can_soft_close) {
            return '<button type="button" class="btn btn-sm btn-outline-danger js-integaglpi-central-soft-close"'
                + ' data-conversation-id="' + conversationId + '"'
                + ' data-ticket-id="0">Encerrar administrativamente</button>';
        }

        return '<span class="text-muted">-</span>';
    }

    function renderRow(row) {
        const ticketId = Number(row.glpi_ticket_id || 0);
        const queueId = Number(row.queue_id || 0);
        const conversationId = String(row.conversation_id || '');
        const phone = String(row.phone_e164 || '');
        const maskedPhone = String(row.masked_phone || phone);
        const contactName = String(row.contact_name || '');
        const title = contactName || maskedPhone || conversationId;
        const status = String(row.effective_status || row.conversation_status || '');
        const statusLabel = friendlyStatus(row);
        const operationalStateLabel = String(row.operational_state_label || '').trim();
        const ticketLabel = ticketDisplayLabel(row, ticketId);
        const nextAction = nextActionLabel(row, ticketId > 0);
        const lastMessagePreview = String(row.last_message_preview || '').trim();
        const queueName = String(row.queue_name || '');
        const activityAt = String(row.activity_at || '');
        const entityLabel = String(row.entity_label || '').trim();
        const stalledLabel = String(row.stalled_label || '').trim();
        const deliveryLabel = String(row.last_delivery_status_label || '').trim();
        const deliveryStatus = String(row.last_delivery_status || '').trim();
        const deliveryError = String(row.last_delivery_error_sanitized || '').trim();
        const businessHoursLabel = String(row.business_hours_label || '').trim();
        const aiLabel = (String(row.ai_quality_status || '').trim() + ' ' + String(row.ai_sentiment || '').trim()).trim();
        const contractLabel = (String(row.contract_alert_status || '').trim() + ' ' + String(row.contract_consumed_percent || '').trim()).trim();
        const csatLabel = row.csat_dissatisfied
            ? 'CSAT insatisfeito'
            : (row.supervisor_review_required ? 'Revisão CSAT' : '-');
        const slaContext = row.sla_context && typeof row.sla_context === 'object' ? row.sla_context : {};
        const slaLabel = String(slaContext.label || 'SLA não configurado').trim();
        const slaStatus = String(slaContext.status || 'not_configured').trim();
        const slaResponseDeadline = String(slaContext.response_deadline || '').trim();
        const slaSolutionDeadline = String(slaContext.solution_deadline || '').trim();
        const slaPausedMinutes = Number(slaContext.paused_minutes || 0);
        const slaReopenCount = Number(slaContext.reopen_count || 0);
        const serviceCatalogName = String(slaContext.service_name || row.service_catalog_name || '').trim();
        const riskBadges = Array.isArray(row.risk_badges)
            ? row.risk_badges.map(function (badge) {
                return '<span class="badge ' + escapeHtml(String(badge.class || 'bg-light text-dark')) + '">'
                    + escapeHtml(String(badge.label || ''))
                    + '</span>';
            }).join('')
            : '';
        const technicianHtml = row.assigned_user_label
            ? escapeHtml(row.assigned_user_label)
            : '<span class="text-muted">-</span>';
        const assignedUserId = Number(row.assigned_user_id || 0);
        const ownershipBadge = row.can_reply
            ? '<span class="badge bg-primary">Minha</span>'
            : assignedUserId <= 0
            ? '<span class="badge bg-warning text-dark">Sem técnico</span>'
            : '<span class="badge bg-info text-dark">Aguardando</span>';
        const profile = row.contact_profile_snapshot && typeof row.contact_profile_snapshot === 'object'
            ? row.contact_profile_snapshot
            : null;
        const profileContext = row.profile_context && typeof row.profile_context === 'object'
            ? row.profile_context
            : {};
        const profileName = String(profileContext.name || contactName || '').trim();
        const profileCompany = String(profileContext.company || '').trim();
        const profileEmail = String(profileContext.email || '').trim();
        const profileEquipment = String(profileContext.equipment || '').trim();
        const profileReason = String(profileContext.reason || '').trim();
        const profileAnswered = String(profileContext.answered_label || '-').trim();
        const profilePending = String(profileContext.pending_label || '-').trim();
        const pendingBadge = profilePending !== '' && profilePending !== '-'
            ? '<span class="badge bg-warning text-dark">Pendente: ' + escapeHtml(profilePending) + '</span>'
            : '';
        const memoryEntityId = Number(row.memory_entity_id || 0);
        const memoryEntityName = String(row.memory_entity_name || '').trim();
        const memoryEntitySourceLabel = String(row.memory_entity_source_label || '').trim();
        const memoryEntityHtml = memoryEntityId > 0
            ? '<div class="itg-card-meta">Entidade memorizada: '
                + escapeHtml(memoryEntityName || String(memoryEntityId))
                + (memoryEntitySourceLabel !== '' ? ' <span class="text-muted small">(' + escapeHtml(memoryEntitySourceLabel) + ')</span>' : '')
                + '</div>'
            : '';
        const inactivityStatus = String(row.inactivity_status_label || '').trim();
        const inactivityEventKey = String(row.inactivity_event_key || '').trim();
        const inactivityNextAction = String(row.inactivity_next_action || '').trim();
        const inactivityReason = String(row.inactivity_tracking_skip_reason || row.inactivity_event_reason || '').trim();
        const inactivityDelivery = String(row.inactivity_delivery_status || '').trim();
        const inactivityMetaError = (String(row.inactivity_meta_error_code || '').trim() + ' ' + String(row.inactivity_last_error_sanitized || '').trim()).trim();
        const inactivityCheckedAt = String(row.inactivity_last_checked_at || '').trim();
        const inactivityHtml = inactivityStatus !== ''
            ? '<div class="border rounded p-2 my-2 bg-light">'
                + '<strong>Inatividade:</strong> ' + escapeHtml(inactivityStatus)
                + (inactivityEventKey !== '' ? ' <span class="text-muted">(' + escapeHtml(inactivityEventKey) + ')</span>' : '')
                + (inactivityCheckedAt !== '' ? '<br><span class="text-muted">Última checagem: ' + escapeHtml(inactivityCheckedAt) + '</span>' : '')
                + (inactivityNextAction !== '' ? '<br>Próxima ação: ' + escapeHtml(inactivityNextAction) : '')
                + (inactivityReason !== '' ? '<br>Motivo: ' + escapeHtml(inactivityReason) : '')
                + (inactivityDelivery !== '' ? '<br>Delivery: ' + escapeHtml(inactivityDelivery) : '')
                + (inactivityMetaError !== '' ? '<br><span class="text-warning">Erro Meta: ' + escapeHtml(inactivityMetaError) + '</span>' : '')
                + '</div>'
            : '';
        const windowInfo = row.whatsapp_window && typeof row.whatsapp_window === 'object'
            ? row.whatsapp_window
            : {};
        const windowLabel = String(windowInfo.label || '').trim();
        const windowOpen = Boolean(windowInfo.is_open);
        const windowBadge = windowLabel !== ''
            ? '<span class="badge ' + (windowOpen ? 'bg-success' : 'bg-warning text-dark') + '">'
                + escapeHtml(windowLabel)
                + '</span>'
            : '';
        const deliveryBadge = deliveryLabel !== ''
            ? '<span class="badge ' + (deliveryStatus === 'failed' ? 'bg-danger' : 'bg-light text-dark') + '">'
                + escapeHtml(deliveryLabel)
                + '</span>'
            : '';
        const windowAlert = !windowOpen && String(windowInfo.alert || '').trim() !== ''
            ? '<div class="alert alert-warning py-2 mb-2">' + escapeHtml(String(windowInfo.alert)) + '</div>'
            : '';
        const deliveryAlert = deliveryError !== ''
            ? '<div class="alert alert-danger py-2 my-2">Falha Meta: ' + escapeHtml(deliveryError) + '</div>'
            : '';
        const profileHtml = profile || profileAnswered !== '-' || profilePending !== '-'
            ? '<div class="border rounded p-3 mt-3 mb-0 bg-light">'
                + '<strong>Perfil do contato</strong><br>'
                + 'Nome: ' + escapeHtml(profileName || '-') + '<br>'
                + 'Empresa informada: ' + escapeHtml(profileCompany || '-') + '<br>'
                + 'E-mail: ' + escapeHtml(profileEmail || '-') + '<br>'
                + 'Equipamento: ' + escapeHtml(profileEquipment || '-') + '<br>'
                + 'Resumo: ' + escapeHtml(profileReason || '-') + '<br>'
                + 'Respondidos: ' + escapeHtml(profileAnswered || '-') + '<br>'
                + 'Pendentes: ' + escapeHtml(profilePending || '-')
                + '</div>'
            : '';

        const element = document.createElement('tr');
        element.setAttribute('data-conversation-id', conversationId);
        element.setAttribute('data-ticket-id', String(ticketId));
        element.setAttribute('data-phone', phone);
        element.setAttribute('data-masked-phone', maskedPhone);
        element.setAttribute('data-contact-name', contactName);
        element.setAttribute('data-profile-name', profileName);
        element.setAttribute('data-profile-company', profileCompany);
        element.setAttribute('data-profile-email', profileEmail);
        element.setAttribute('data-profile-equipment', profileEquipment);
        element.setAttribute('data-profile-reason', profileReason);
        element.setAttribute('data-profile-answered', profileAnswered);
        element.setAttribute('data-profile-pending', profilePending);
        element.setAttribute('data-memory-entity', memoryEntityId > 0 ? (memoryEntityName || String(memoryEntityId)) : '-');
        element.setAttribute('data-last-message', lastMessagePreview);
        element.setAttribute('data-status', status);
        element.setAttribute('data-status-label', statusLabel);
        element.setAttribute('data-operational-state', operationalStateLabel);
        element.setAttribute('data-next-action', nextAction);
        element.setAttribute('data-ticket-label', ticketLabel);
        element.setAttribute('data-queue', queueName);
        element.setAttribute('data-queue-id', String(queueId));
        element.setAttribute('data-technician', String(row.assigned_user_label || ''));
        element.setAttribute('data-activity', activityAt);
        element.setAttribute('data-entity', entityLabel);
        element.setAttribute('data-window', windowLabel);
        element.setAttribute('data-delivery', deliveryLabel);
        element.setAttribute('data-delivery-error', deliveryError);
        element.setAttribute('data-inactivity', inactivityStatus);
        element.setAttribute('data-inactivity-next', inactivityNextAction);
        element.setAttribute('data-stalled', stalledLabel);
        element.setAttribute('data-business-hours', businessHoursLabel);
        element.setAttribute('data-ai', aiLabel || '-');
        element.setAttribute('data-contract', contractLabel || '-');
        element.setAttribute('data-csat', csatLabel);
        element.setAttribute('data-attempt', String(row.entity_attempt_status_label || '-'));
        element.setAttribute('data-service', serviceCatalogName || '-');
        element.setAttribute('data-sla', slaLabel || 'SLA não configurado');
        element.setAttribute('data-sla-status', slaStatus || 'not_configured');
        element.setAttribute('data-sla-response-deadline', slaResponseDeadline || '-');
        element.setAttribute('data-sla-solution-deadline', slaSolutionDeadline || '-');
        element.setAttribute('data-sla-paused', String(slaPausedMinutes));
        element.setAttribute('data-sla-reopen', String(slaReopenCount));
        element.setAttribute('data-can-reply', canUpdateActions && row.can_reply ? '1' : '0');
        element.setAttribute('data-can-edit-entity', canUpdateActions && row.can_edit_entity ? '1' : '0');
        element.setAttribute('data-can-soft-close', canUpdateActions && row.can_soft_close ? '1' : '0');
        if (selectedConversation && selectedConversation.conversationId === String(row.conversation_id || '')) {
            element.classList.add('table-active');
        }
        element.innerHTML =
            '<td colspan="8"><div class="itg-card">'
            + '<div class="d-flex justify-content-between gap-2"><div>'
            + '<div class="itg-card-title">' + escapeHtml(profileName || title) + '</div>'
            + '<div class="itg-card-meta">' + escapeHtml(maskedPhone)
            + (profileCompany !== '' ? ' · ' + escapeHtml(profileCompany) : '') + '</div>'
            + '</div><span class="badge bg-light text-dark">' + escapeHtml(ticketLabel) + '</span></div>'
            + '<div class="itg-card-badges my-2">'
            + ownershipBadge
            + '<span class="badge bg-secondary">' + escapeHtml(statusLabel) + '</span>'
            + (operationalStateLabel !== '' ? '<span class="badge bg-dark">' + escapeHtml(operationalStateLabel) + '</span>' : '')
            + windowBadge
            + deliveryBadge
            + riskBadges
            + pendingBadge
            + '</div>'
            + windowAlert
            + deliveryAlert
            + '<div class="itg-card-meta">Próxima ação: ' + escapeHtml(nextAction) + '</div>'
            + inactivityHtml
            + '<div class="itg-card-meta">Fila: ' + escapeHtml(queueName || '-')
            + (queueId > 0 ? ' <span>#' + queueId + '</span>' : '') + '</div>'
            + '<div class="itg-card-meta">Entidade: ' + escapeHtml(entityLabel || '-') + '</div>'
            + '<div class="itg-card-meta">Serviço: ' + escapeHtml(serviceCatalogName || '-') + '</div>'
            + '<div class="itg-card-meta">SLA: ' + escapeHtml(slaLabel || 'SLA não configurado')
            + (slaResponseDeadline !== '' ? ' · Resposta ' + escapeHtml(slaResponseDeadline) : '')
            + (slaSolutionDeadline !== '' ? ' · Solução ' + escapeHtml(slaSolutionDeadline) : '')
            + '</div>'
            + renderEntityEditControls(row)
            + memoryEntityHtml
            + '<div class="itg-card-meta js-integaglpi-central-technician">Técnico: ' + technicianHtml + '</div>'
            + '<div class="itg-card-meta">Última atividade: ' + escapeHtml(activityAt)
            + (stalledLabel !== '' ? ' · parado há ' + escapeHtml(stalledLabel) : '') + '</div>'
            + (lastMessagePreview !== '' ? '<div class="itg-card-meta">Última mensagem: '
                + escapeHtml(lastMessagePreview.slice(0, 140)) + '</div>' : '')
            + profileHtml
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
                // Phase: integaglpi_ops_console_claim_ui_messaging_stabilization_001.
                // `mine_only` is a tri-state filter ('1' on / '0' off / absent = default on).
                // The legacy filter skipped '0', which would erase the user's explicit
                // "Mostrar todos" choice. Forward it verbatim.
                if (key === 'mine_only') {
                    params.set(key, String(value));
                    return;
                }
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
            totalBadge.textContent = total + ' conversas';
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
        meta.textContent = (direction || 'message') + ' - ' + (message.created_at_display || message.created_at || '');

        const text = document.createElement('div');
        text.textContent = message.message_text || '[' + (message.message_type || 'message') + ']';

        bubble.appendChild(meta);
        bubble.appendChild(text);
        if (isOutbound && message.delivery_status_label) {
            const delivery = document.createElement('div');
            delivery.className = message.delivery_status === 'failed' ? 'small text-warning mt-1' : 'small text-white-50 mt-1';
            delivery.textContent = 'Status: ' + message.delivery_status_label;
            if (message.delivery_status === 'failed' && message.meta_error_message_sanitized) {
                delivery.textContent += ' - ' + message.meta_error_message_sanitized;
            }
            bubble.appendChild(delivery);
        }
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
        if (!conversationId) {
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
            const tid = Number(ticketId);
            const ticketLabel = row.getAttribute('data-ticket-label') || (tid > 0 ? '#' + tid : 'Pré-Ticket');
            label.textContent = ticketLabel + ' / ' + conversationId;
        }

        updateContextPanel(row);
        loadSelectedMessages(true);
    }

    function updateContextPanel(row) {
        const ticketId = row.getAttribute('data-ticket-id') || '';
        const contact = document.querySelector('.js-integaglpi-central-context-contact');
        const phone = document.querySelector('.js-integaglpi-central-context-phone');
        const company = document.querySelector('.js-integaglpi-central-context-company');
        const email = document.querySelector('.js-integaglpi-central-context-email');
        const equipment = document.querySelector('.js-integaglpi-central-context-equipment');
        const answered = document.querySelector('.js-integaglpi-central-context-answered');
        const pending = document.querySelector('.js-integaglpi-central-context-pending');
        const nextAction = document.querySelector('.js-integaglpi-central-context-next-action');
        const ticketLink = document.querySelector('.js-integaglpi-central-context-ticket');
        const queue = document.querySelector('.js-integaglpi-central-context-queue');
        const service = document.querySelector('.js-integaglpi-central-context-service');
        const sla = document.querySelector('.js-integaglpi-central-context-sla');
        const slaDeadlines = document.querySelector('.js-integaglpi-central-context-sla-deadlines');
        const technician = document.querySelector('.js-integaglpi-central-context-technician');
        const status = document.querySelector('.js-integaglpi-central-context-status');
        const entity = document.querySelector('.js-integaglpi-central-context-entity');
        const memoryEntity = document.querySelector('.js-integaglpi-central-context-memory-entity');
        const windowInfo = document.querySelector('.js-integaglpi-central-context-window');
        const delivery = document.querySelector('.js-integaglpi-central-context-delivery');
        const inactivity = document.querySelector('.js-integaglpi-central-context-inactivity');
        const stalled = document.querySelector('.js-integaglpi-central-context-stalled');
        const attempt = document.querySelector('.js-integaglpi-central-context-attempt');
        const ai = document.querySelector('.js-integaglpi-central-context-ai');
        const csat = document.querySelector('.js-integaglpi-central-context-csat');
        const contract = document.querySelector('.js-integaglpi-central-context-contract');
        const whatsappLink = document.querySelector('.js-integaglpi-central-context-whatsapp');
        const transferButton = document.querySelector('.js-integaglpi-central-context-transfer');
        const solveButton = document.querySelector('.js-integaglpi-central-context-solve');
        const conversationId = row.getAttribute('data-conversation-id') || '';
        const rowStatus = row.getAttribute('data-status') || '';
        const canUseTicketActions = row.getAttribute('data-can-reply') === '1'
            && rowStatus === 'open'
            && Number(ticketId) > 0;

        if (contact) {
            contact.textContent = row.getAttribute('data-profile-name')
                || row.getAttribute('data-contact-name')
                || '-';
        }

        if (phone) {
            phone.textContent = row.getAttribute('data-masked-phone') || '-';
        }

        if (company) {
            company.textContent = row.getAttribute('data-profile-company') || '-';
        }

        if (email) {
            email.textContent = row.getAttribute('data-profile-email') || '-';
        }

        if (equipment) {
            equipment.textContent = row.getAttribute('data-profile-equipment') || '-';
        }

        if (answered) {
            answered.textContent = row.getAttribute('data-profile-answered') || '-';
        }

        if (pending) {
            pending.textContent = row.getAttribute('data-profile-pending') || '-';
        }

        if (nextAction) {
            nextAction.textContent = row.getAttribute('data-next-action') || '-';
        }

        if (ticketLink) {
            const tid = Number(ticketId);
            ticketLink.textContent = row.getAttribute('data-ticket-label') || (tid > 0 ? '#' + tid : 'Pré-Ticket');
            ticketLink.href = tid > 0 ? ticketUrlBase + tid : '#';
        }

        if (queue) {
            const queueName = row.getAttribute('data-queue') || '';
            const queueId = row.getAttribute('data-queue-id') || '';
            queue.textContent = queueName ? queueName + (queueId && queueId !== '0' ? ' #' + queueId : '') : '-';
        }

        if (service) {
            service.textContent = row.getAttribute('data-service') || '-';
        }

        if (sla) {
            sla.textContent = row.getAttribute('data-sla') || '-';
        }

        if (slaDeadlines) {
            const responseDeadline = row.getAttribute('data-sla-response-deadline') || '-';
            const solutionDeadline = row.getAttribute('data-sla-solution-deadline') || '-';
            const paused = row.getAttribute('data-sla-paused') || '0';
            const reopen = row.getAttribute('data-sla-reopen') || '0';
            slaDeadlines.textContent = 'Resposta: ' + responseDeadline
                + ' / Solução: ' + solutionDeadline
                + ' / Pausa: ' + paused + ' min'
                + ' / Reaberturas: ' + reopen;
        }

        if (technician) {
            technician.textContent = row.getAttribute('data-technician') || '-';
        }

        if (status) {
            const operational = row.getAttribute('data-operational-state') || '';
            status.textContent = (row.getAttribute('data-status-label') || rowStatus || '-')
                + (operational ? ' / ' + operational : '');
        }

        if (entity) {
            entity.textContent = row.getAttribute('data-entity') || '-';
        }

        if (memoryEntity) {
            memoryEntity.textContent = row.getAttribute('data-memory-entity') || '-';
        }

        if (windowInfo) {
            windowInfo.textContent = row.getAttribute('data-window') || '-';
        }

        if (delivery) {
            const deliveryText = row.getAttribute('data-delivery') || '-';
            const deliveryError = row.getAttribute('data-delivery-error') || '';
            delivery.textContent = deliveryText + (deliveryError ? ' - ' + deliveryError : '');
        }

        if (inactivity) {
            const inactivityText = row.getAttribute('data-inactivity') || '-';
            const inactivityNext = row.getAttribute('data-inactivity-next') || '';
            inactivity.textContent = inactivityText + (inactivityNext ? ' - ' + inactivityNext : '');
        }

        if (stalled) {
            const stalledText = row.getAttribute('data-stalled') || '-';
            const businessHours = row.getAttribute('data-business-hours') || '-';
            stalled.textContent = stalledText + ' / ' + businessHours;
        }

        if (attempt) {
            attempt.textContent = row.getAttribute('data-attempt') || '-';
        }

        if (ai) {
            ai.textContent = 'IA: ' + (row.getAttribute('data-ai') || '-');
        }

        if (csat) {
            csat.textContent = 'CSAT: ' + (row.getAttribute('data-csat') || '-');
        }

        if (contract) {
            contract.textContent = 'Contrato: ' + (row.getAttribute('data-contract') || '-');
        }

        if (whatsappLink) {
            const tid = Number(ticketId);
            whatsappLink.href = tid > 0 ? ticketUrlBase + tid + '&forcetab=PluginIntegaglpiTicket$1' : '#';
            whatsappLink.classList.toggle('text-muted', tid <= 0);
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
            emptyRow.innerHTML = '<td colspan="8" class="text-center text-muted p-3">Nenhuma conversa WhatsApp encontrada.</td>';
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
    const softCloseModal = {
        button: null
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

    function getSoftCloseModalEls() {
        const backdrop = document.getElementById('itg-iw-soft-close-modal');
        if (!backdrop) {
            return {};
        }
        return {
            backdrop: backdrop,
            reason: backdrop.querySelector('.js-itg-iw-soft-close-reason'),
            err: backdrop.querySelector('.js-itg-iw-soft-close-error'),
            confirm: backdrop.querySelector('.js-itg-iw-soft-close-confirm')
        };
    }

    function closeSoftCloseModal() {
        const els = getSoftCloseModalEls();
        if (els.backdrop) {
            els.backdrop.classList.add('d-none');
            els.backdrop.setAttribute('aria-hidden', 'true');
        }
        if (softCloseModal.button) {
            softCloseModal.button.disabled = false;
            softCloseModal.button = null;
        }
        if (els.reason) {
            els.reason.value = '';
        }
        if (els.confirm) {
            els.confirm.disabled = true;
            els.confirm.textContent = 'Encerrar';
        }
        hideModalError(els);
    }

    function openSoftCloseModal(button) {
        const els = getSoftCloseModalEls();
        if (!els.backdrop || !els.reason) {
            alert('Modal de encerramento indisponível. Recarregue a página.');
            return;
        }
        softCloseModal.button = button;
        button.disabled = true;
        els.backdrop.classList.remove('d-none');
        els.backdrop.setAttribute('aria-hidden', 'false');
        els.reason.value = '';
        if (els.confirm) {
            els.confirm.disabled = true;
            els.confirm.textContent = 'Encerrar';
        }
        hideModalError(els);
        els.reason.focus();
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

                showRefreshMessage(result.body.message || 'Chamado solucionado', result.body.status && result.body.status.indexOf('failed') >= 0 ? 'warning' : 'success');
                lastRefreshAtMs = 0;
                refreshCentral(true);
            })
            .catch(function () {
                button.disabled = false;
                button.textContent = originalText;
                alert('Erro ao solucionar chamado.');
            });
    }

    function softCloseConversation(button, reason) {
        const row = button.closest('tr');
        const payload = new URLSearchParams();
        payload.set('_glpi_csrf_token', csrfToken);
        payload.set('action', 'soft_close');
        payload.set('conversation_id', button.dataset.conversationId || '');
        payload.set('ticket_id', '0');
        payload.set('reason', reason);

        const els = getSoftCloseModalEls();
        if (els.confirm) {
            els.confirm.disabled = true;
            els.confirm.textContent = 'Encerrando...';
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
                            : 'Erro ao encerrar administrativamente a conversa.');
                    showModalError(els, msg);
                    if (els.confirm) {
                        els.confirm.disabled = false;
                        els.confirm.textContent = 'Encerrar';
                    }
                    return;
                }

                closeSoftCloseModal();
                if (row) {
                    row.classList.add('table-warning');
                }
                showRefreshMessage(result.body.message || 'Conversa encerrada administrativamente.', 'success');
                lastRefreshAtMs = 0;
                refreshCentral(true);
            })
            .catch(function () {
                showModalError(els, 'Erro ao encerrar administrativamente a conversa.');
                if (els.confirm) {
                    els.confirm.disabled = false;
                    els.confirm.textContent = 'Encerrar';
                }
            });
    }

    function pollEntitySelectionStatus(conversationId, feedback, button, originalText, attempts) {
        const payload = new URLSearchParams();
        payload.set('_glpi_csrf_token', csrfToken);
        payload.set('action', 'entity_status');
        payload.set('conversation_id', conversationId);
        payload.set('ticket_id', '0');

        fetch(actionUrl, {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'Accept': 'application/json'
            },
            body: payload.toString()
        })
            .then(parseJsonResponse)
            .then(function (result) {
                updateCsrfToken(result.body);
                const body = result.body || {};
                const status = String(body.status || '');
                const message = body.message || 'Criando chamado no GLPI...';

                if (feedback) {
                    feedback.textContent = message;
                }

                if (status === 'processing' || status === 'not_started') {
                    if (attempts >= 40) {
                        if (feedback) {
                            feedback.textContent = 'A criação segue em processamento. Atualize a Central em alguns segundos.';
                        }
                        return;
                    }
                    window.setTimeout(function () {
                        pollEntitySelectionStatus(conversationId, feedback, button, originalText, attempts + 1);
                    }, 3000);
                    return;
                }

                if (status === 'succeeded' && Number(body.glpi_ticket_id || 0) > 0) {
                    showRefreshMessage('Chamado criado ou reconciliado.', 'success');
                    lastRefreshAtMs = 0;
                    refreshCentral(true);
                    return;
                }

                if (status === 'ambiguous_reconciliation') {
                    if (feedback) {
                        feedback.textContent = body.error_message || message;
                    }
                    showRefreshMessage('Reconciliação ambígua. Exige decisão humana antes de nova tentativa.', 'warning');
                    return;
                }

                if (button) {
                    button.disabled = false;
                    button.dataset.requestInProgress = '0';
                    button.textContent = originalText;
                }
                showRefreshMessage(message, 'warning');
                lastRefreshAtMs = 0;
                refreshCentral(true);
            })
            .catch(function () {
                if (attempts >= 3) {
                    if (button) {
                        button.disabled = false;
                        button.dataset.requestInProgress = '0';
                        button.textContent = originalText;
                    }
                    if (feedback) {
                        feedback.textContent = 'Não foi possível consultar o status da tentativa agora.';
                    }
                    return;
                }
                window.setTimeout(function () {
                    pollEntitySelectionStatus(conversationId, feedback, button, originalText, attempts + 1);
                }, 3000);
            });
    }

    document.addEventListener('click', function (event) {
        const row = event.target.closest('tr[data-conversation-id]');
        if (
            row
            && !event.target.closest('button')
            && !event.target.closest('a')
            && !event.target.closest('textarea')
            && !event.target.closest('select')
            && !event.target.closest('details')
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
            // ── "Aplicar entidade memorizada" one-click path ──────────────────
            const memoryApplyButton = event.target.closest('.js-integaglpi-apply-memory-entity');
            if (memoryApplyButton) {
                event.preventDefault();
                if (memoryApplyButton.dataset.requestInProgress === '1') {
                    return;
                }
                const memEntityId = Number(memoryApplyButton.dataset.entityId || 0);
                if (!Number.isInteger(memEntityId) || memEntityId <= 0) {
                    alert('Entidade memorizada inválida. Selecione manualmente.');
                    return;
                }
                // Find the nearest feedback element (may be in the same alert block)
                const feedbackEl = memoryApplyButton.parentElement
                    ? memoryApplyButton.parentElement.querySelector('.js-integaglpi-entity-feedback')
                    : null;
                const originalText = memoryApplyButton.textContent;
                memoryApplyButton.disabled = true;
                memoryApplyButton.dataset.requestInProgress = '1';
                memoryApplyButton.textContent = 'Criando chamado...';
                if (feedbackEl) { feedbackEl.textContent = ''; }

                const memPayload = new URLSearchParams();
                memPayload.set('_glpi_csrf_token', csrfToken);
                memPayload.set('action', 'confirm_entity');
                memPayload.set('conversation_id', memoryApplyButton.dataset.conversationId || '');
                memPayload.set('ticket_id', '0');
                memPayload.set('glpi_entity_id', String(memEntityId));
                memPayload.set('create_ticket', '1');
                memPayload.set('idempotency_key', buildEntitySelectionIdempotencyKey(
                    memoryApplyButton.dataset.conversationId || '',
                    memEntityId
                ));

                let keepMemDisabled = false;
                fetch(actionUrl, {
                    method: 'POST',
                    credentials: 'same-origin',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
                    body: memPayload.toString()
                })
                    .then(parseJsonResponse)
                    .then(function (result) {
                        updateCsrfToken(result.body);
                        const body = result.body || {};
                        const message = body.message || 'Não foi possível aplicar a entidade memorizada.';
                        if (!body.ok) {
                            if (feedbackEl) { feedbackEl.textContent = message; }
                            else { alert(message); }
                            refreshCentral(true);
                            return;
                        }
                        if (feedbackEl) { feedbackEl.textContent = message; }
                        if (body.status === 'processing') {
                            keepMemDisabled = true;
                            memoryApplyButton.textContent = 'Criando chamado...';
                            pollEntitySelectionStatus(
                                memoryApplyButton.dataset.conversationId || '',
                                feedbackEl,
                                memoryApplyButton,
                                originalText,
                                0
                            );
                            return;
                        }
                        refreshCentral(true);
                    })
                    .catch(function () {
                        if (feedbackEl) { feedbackEl.textContent = 'Erro ao aplicar entidade. Atualize a Central.'; }
                        refreshCentral(true);
                    })
                    .finally(function () {
                        if (!keepMemDisabled) {
                            memoryApplyButton.disabled = false;
                            memoryApplyButton.dataset.requestInProgress = '0';
                            memoryApplyButton.textContent = originalText;
                        }
                    });
                return;
            }

            // ── Regular confirm_entity / update_entity path ───────────────────
            const entityButton = event.target.closest('.js-integaglpi-confirm-entity, .js-integaglpi-update-entity');
            if (entityButton) {
                event.preventDefault();
                if (entityButton.dataset.requestInProgress === '1') {
                    return;
                }
                const isEntityUpdate = entityButton.classList.contains('js-integaglpi-update-entity');
                const box = entityButton.closest('.integaglpi-entity-selection');
            const entitySelect = box
                ? (box.querySelector('.js-integaglpi-entity-id') || box.querySelector('[name="glpi_entity_id"]'))
                : null;
            const feedback = box ? box.querySelector('.js-integaglpi-entity-feedback') : null;
            const entityId = entitySelect ? Number(entitySelect.value || 0) : 0;
            const serviceSelect = box ? box.querySelector('.js-integaglpi-service-catalog-id') : null;
            const serviceChecklist = box ? box.querySelector('.js-integaglpi-service-checklist-json') : null;

            if (!Number.isInteger(entityId) || entityId <= 0) {
                alert('Selecione uma entidade GLPI válida.');
                return;
            }

            const payload = new URLSearchParams();
            payload.set('_glpi_csrf_token', csrfToken);
            payload.set('action', isEntityUpdate ? 'update_entity' : 'confirm_entity');
            payload.set('conversation_id', entityButton.dataset.conversationId || '');
            payload.set('ticket_id', isEntityUpdate ? (entityButton.dataset.ticketId || '0') : '0');
            payload.set('glpi_entity_id', String(entityId));
            if (isEntityUpdate) {
                payload.set('apply_to_ticket', '0');
            } else {
                payload.set('create_ticket', '1');
                payload.set('service_catalog_id', serviceSelect ? String(serviceSelect.value || '0') : '0');
                payload.set('service_checklist_json', serviceChecklist ? String(serviceChecklist.value || '') : '');
                payload.set('idempotency_key', buildEntitySelectionIdempotencyKey(
                    entityButton.dataset.conversationId || '',
                    entityId
                ));
            }

            const originalText = entityButton.textContent;
            entityButton.disabled = true;
            entityButton.dataset.requestInProgress = '1';
            entityButton.textContent = isEntityUpdate ? 'Atualizando entidade...' : 'Criando chamado...';
            if (feedback) {
                feedback.textContent = '';
            }

            let keepDisabledForPolling = false;
            fetch(actionUrl, {
                method: 'POST',
                credentials: 'same-origin',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
                },
                body: payload.toString()
            })
                .then(parseJsonResponse)
                .then(function (result) {
                    updateCsrfToken(result.body);
                    const body = result.body || {};
                    const message = body.message || 'Não foi possível confirmar a entidade.';
                    if (!body.ok) {
                        if (feedback) {
                            feedback.textContent = message;
                        } else {
                            alert(message);
                        }
                        refreshCentral(true);
                        return;
                    }

                    if (feedback) {
                        feedback.textContent = message;
                    }
                    if (!isEntityUpdate && body.status === 'processing') {
                        keepDisabledForPolling = true;
                        entityButton.textContent = 'Criando chamado...';
                        pollEntitySelectionStatus(
                            entityButton.dataset.conversationId || '',
                            feedback,
                            entityButton,
                            originalText,
                            0
                        );
                        return;
                    }
                    if (isEntityUpdate && body.warning && feedback) {
                        feedback.textContent = message + ' ' + body.warning;
                    }
                    refreshCentral(true);
                })
                .catch(function () {
                    if (feedback) {
                        feedback.textContent = 'Erro ao confirmar entidade. Atualize a Central em alguns segundos.';
                    }
                    refreshCentral(true);
                })
                .finally(function () {
                    if (!keepDisabledForPolling) {
                        entityButton.disabled = false;
                        entityButton.dataset.requestInProgress = '0';
                        entityButton.textContent = originalText;
                    }
                });
            return;
        }

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

        const sbtn = event.target.closest('.js-integaglpi-central-soft-close');
        if (sbtn) {
            event.preventDefault();
            openSoftCloseModal(sbtn);
            return;
        }

        const cancelBtn = event.target.closest('.js-itg-iw-modal-cancel');
        if (cancelBtn) {
            event.preventDefault();
            closeTransferModal();
            return;
        }

        const softCancelBtn = event.target.closest('.js-itg-iw-soft-close-cancel');
        if (softCancelBtn) {
            event.preventDefault();
            closeSoftCloseModal();
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

    document.addEventListener('input', function (event) {
        const reason = event.target.closest('.js-itg-iw-soft-close-reason');
        if (!reason) {
            return;
        }
        const els = getSoftCloseModalEls();
        if (els.confirm) {
            els.confirm.disabled = String(reason.value || '').trim() === '';
        }
        hideModalError(els);
    });

    document.addEventListener('click', function (event) {
        const cbtn = event.target.closest('.js-itg-iw-soft-close-confirm');
        if (!cbtn) {
            return;
        }
        event.preventDefault();
        const els = getSoftCloseModalEls();
        const reason = els.reason ? String(els.reason.value || '').trim() : '';
        if (!softCloseModal.button) {
            showModalError(els, 'A conversa não está selecionada. Recarregue a página.');
            return;
        }
        if (reason === '') {
            showModalError(els, 'Informe o motivo do encerramento administrativo.');
            if (els.confirm) {
                els.confirm.disabled = true;
            }
            return;
        }
        if (!window.confirm('Confirmar encerramento administrativo sem envio de WhatsApp e sem alterar ticket GLPI?')) {
            return;
        }
        softCloseConversation(softCloseModal.button, reason);
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

    document.addEventListener('input', function (event) {
        var input = event.target.closest('.js-integaglpi-entity-filter');
        if (!input) {
            return;
        }
        var root = input.closest('[data-entity-box="1"]');
        if (!root) {
            return;
        }
        var select = root.querySelector('select[name="glpi_entity_id"]');
        if (!select) {
            return;
        }
        var q = String(input.value || '').toLowerCase().trim();
        var options = select.querySelectorAll('option');
        options.forEach(function (opt) {
            var val = String(opt.value || '');
            var label = String(opt.textContent || '').toLowerCase();
            if (val === '' || val === '0') {
                opt.hidden = false;
                return;
            }
            opt.hidden = q !== '' && label.indexOf(q) === -1 && val.indexOf(q) === -1;
        });
    });
}());
</script>
