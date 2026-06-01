<?php

declare(strict_types=1);

use GlpiPlugin\Integaglpi\Plugin;

/** @var array{type:string,message:string}|null $flash */
/** @var array<string, mixed>|null $queueData */
/** @var string|null $queueError */
/** @var string $filterStatus */
/** @var int $filterEntity */
/** @var int $page */
/** @var int $limit */
/** @var string $csrfToken */

$escape    = static fn (mixed $v): string => htmlspecialchars((string) $v, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
$selfUrl   = Plugin::getLogmeinReconciliationUrl();
$items     = is_array($queueData['items'] ?? null) ? $queueData['items'] : [];
$total     = (int) ($queueData['total'] ?? 0);
$hasNext   = !empty($queueData['hasNext']);
$hasPrev   = $page > 1;

$statusLabels = [
    ''                   => 'Todos',
    'pending_user_review'=> 'Aguardando revisão',
    'no_ticket_found'    => 'Sem ticket',
    'no_entity_mapping'  => 'Sem entidade',
    'matched_ticket'     => 'Ticket vinculado',
    'ignored_duplicate'  => 'Duplicado ignorado',
    'out_of_scope'       => 'Fora do escopo',
    'resolved'           => 'Resolvido',
];

$confidenceLabels = [
    'high'   => ['text' => 'Alta',   'badge' => 'success'],
    'medium' => ['text' => 'Média',  'badge' => 'warning'],
    'low'    => ['text' => 'Baixa',  'badge' => 'secondary'],
    'none'   => ['text' => 'Nenhuma','badge' => 'light text-dark'],
];
?>

<div class="container-fluid">

    <div class="card mb-3">
        <div class="card-header d-flex align-items-center justify-content-between">
            <strong><?= $escape(__('Conciliação de Acessos Remotos LogMeIn', 'glpiintegaglpi')); ?></strong>
            <span class="badge bg-info"><?= $escape(__('V7 — read-only allowlist', 'glpiintegaglpi')); ?></span>
        </div>
        <div class="card-body">
            <div class="alert alert-info mb-2">
                <?= $escape(__('Sessões lidas da API de relatórios LogMeIn (POST passivo apenas). Nenhuma sessão remota é iniciada aqui. Técnicos não aparecem nominalmente. Vínculos e tarefas GLPI exigem confirmação humana.', 'glpiintegaglpi')); ?>
            </div>

            <?php if ($flash !== null) { ?>
                <div class="alert alert-<?= $escape($flash['type']); ?> alert-dismissible">
                    <?= $escape($flash['message']); ?>
                </div>
            <?php } ?>

            <?php if ($queueError !== null) { ?>
                <div class="alert alert-warning"><?= $escape($queueError); ?></div>
            <?php } ?>

            <?php /* ── Manual sync trigger ────────────────────────────── */ ?>
            <form method="post" action="<?= $escape($selfUrl); ?>" class="mt-2">
                <input type="hidden" name="_glpi_csrf_token" value="<?= $escape($csrfToken); ?>">
                <input type="hidden" name="action" value="sync_reconciliation">
                <button type="submit" class="btn btn-outline-primary">
                    <i class="ti ti-refresh me-1"></i>
                    <?= $escape(__('Sincronizar sessões para conciliação', 'glpiintegaglpi')); ?>
                </button>
                <div class="form-text mt-1">
                    <?= $escape(__('POST passivo/read-only ao LogMeIn. Não inicia sessão remota. Não envia WhatsApp. Não altera tickets sem confirmação humana.', 'glpiintegaglpi')); ?>
                </div>
            </form>

            <?php if ($items === [] && $queueError === null) { ?>
                <div class="alert alert-secondary mt-3">
                    <i class="ti ti-info-circle me-1"></i>
                    <?= $escape(__('Nenhuma sessão remota sincronizada ainda. Execute a sincronização manual acima para popular o ledger de acessos remotos.', 'glpiintegaglpi')); ?>
                </div>
            <?php } ?>
        </div>
    </div>

    <?php /* ── Filters ─────────────────────────────────────────────────── */ ?>
    <div class="card mb-3">
        <div class="card-header"><?= $escape(__('Filtros', 'glpiintegaglpi')); ?></div>
        <div class="card-body">
            <form method="get" action="<?= $escape($selfUrl); ?>">
                <div class="row g-3">
                    <div class="col-md-4">
                        <label class="form-label" for="rec-filter-status"><?= $escape(__('Status', 'glpiintegaglpi')); ?></label>
                        <select class="form-select" id="rec-filter-status" name="status">
                            <?php foreach ($statusLabels as $value => $label) { ?>
                                <option value="<?= $escape($value); ?>" <?= $filterStatus === $value ? 'selected' : ''; ?>>
                                    <?= $escape(__($label, 'glpiintegaglpi')); ?>
                                </option>
                            <?php } ?>
                        </select>
                    </div>
                    <div class="col-md-2 d-flex align-items-end gap-2">
                        <button class="btn btn-primary" type="submit"><?= $escape(__('Filtrar', 'glpiintegaglpi')); ?></button>
                        <a class="btn btn-outline-secondary" href="<?= $escape($selfUrl); ?>"><?= $escape(__('Limpar', 'glpiintegaglpi')); ?></a>
                    </div>
                </div>
            </form>
        </div>
    </div>

    <?php /* ── Queue table ─────────────────────────────────────────────── */ ?>
    <div class="card">
        <div class="card-header d-flex justify-content-between">
            <span><?= $escape(__('Fila de regularização', 'glpiintegaglpi')); ?></span>
            <span class="text-muted small"><?= $total; ?> <?= $escape(__('registro(s) total', 'glpiintegaglpi')); ?></span>
        </div>
        <div class="card-body p-0">
            <?php if ($items === []) { ?>
                <div class="p-3 text-muted"><?= $escape(__('Nenhum item para os filtros selecionados.', 'glpiintegaglpi')); ?></div>
            <?php } else { ?>
                <div class="table-responsive">
                    <table class="table table-sm table-hover mb-0">
                        <thead class="table-light">
                            <tr>
                                <th>#</th>
                                <th><?= $escape(__('Status', 'glpiintegaglpi')); ?></th>
                                <th><?= $escape(__('Confiança', 'glpiintegaglpi')); ?></th>
                                <th><?= $escape(__('Grupo', 'glpiintegaglpi')); ?></th>
                                <th><?= $escape(__('Host', 'glpiintegaglpi')); ?></th>
                                <th><?= $escape(__('Etiqueta', 'glpiintegaglpi')); ?></th>
                                <th><?= $escape(__('Início', 'glpiintegaglpi')); ?></th>
                                <th><?= $escape(__('Duração', 'glpiintegaglpi')); ?></th>
                                <th><?= $escape(__('Ticket vinculado', 'glpiintegaglpi')); ?></th>
                                <th><?= $escape(__('Ação', 'glpiintegaglpi')); ?></th>
                            </tr>
                        </thead>
                        <tbody>
                            <?php foreach ($items as $item) {
                                $itemId         = (int) ($item['id'] ?? 0);
                                $itemStatus     = (string) ($item['status'] ?? '');
                                $itemConfidence = (string) ($item['matchConfidence'] ?? 'none');
                                $itemGroup      = (string) ($item['groupName'] ?? '');
                                $itemHost       = (string) ($item['hostNameSanitized'] ?? '');
                                $itemTag        = (string) ($item['equipmentTag'] ?? '');
                                $itemStart      = (string) ($item['sessionStartAt'] ?? '');
                                $itemDuration   = (int) ($item['durationSeconds'] ?? 0);
                                $itemTicketId   = (int) ($item['glpiTicketId'] ?? 0);
                                $itemTaskId     = (int) ($item['glpiTaskId'] ?? 0);
                                $itemSessionId  = (string) ($item['sessionId'] ?? '');
                                // 16-char hex prefix of sha256 — matches the marker stored in the GLPI task.
                                $sessionIdHash  = substr(hash('sha256', $itemSessionId), 0, 16);
                                $durationMins   = (int) ceil($itemDuration / 60);
                                $confInfo       = $confidenceLabels[$itemConfidence] ?? $confidenceLabels['none'];
                                $canResolve     = in_array($itemStatus, ['pending_user_review', 'no_ticket_found', 'no_entity_mapping'], true);
                                // A session may have AT MOST one linked GLPI task. The button is
                                // hidden once glpiTaskId is set (backend re-checks regardless).
                                $hasLinkedTask  = $itemTaskId > 0;
                                ?>
                                <tr>
                                    <td><?= $itemId; ?></td>
                                    <td>
                                        <span class="badge bg-secondary">
                                            <?= $escape($statusLabels[$itemStatus] ?? $itemStatus); ?>
                                        </span>
                                    </td>
                                    <td>
                                        <span class="badge bg-<?= $escape($confInfo['badge']); ?>">
                                            <?= $escape(__($confInfo['text'], 'glpiintegaglpi')); ?>
                                        </span>
                                    </td>
                                    <td><?= $escape($itemGroup); ?></td>
                                    <td><?= $escape($itemHost); ?></td>
                                    <td><?= $escape($itemTag !== '' ? $itemTag : '—'); ?></td>
                                    <td class="text-muted small"><?= $escape($itemStart !== '' ? substr($itemStart, 0, 19) : '—'); ?></td>
                                    <td><?= $itemDuration > 0 ? $durationMins . ' min' : '—'; ?></td>
                                    <td>
                                        <?php if ($itemTicketId > 0) { ?>
                                            <a href="<?= $escape(Plugin::getTicketUrl($itemTicketId)); ?>" target="_blank" rel="noopener noreferrer">#<?= $itemTicketId; ?></a>
                                        <?php } else { ?>
                                            —
                                        <?php } ?>
                                    </td>
                                    <td>
                                        <?php if ($canResolve) { ?>
                                            <button type="button" class="btn btn-sm btn-outline-primary"
                                                data-bs-toggle="modal"
                                                data-bs-target="#modal-resolve-<?= $itemId; ?>">
                                                <?= $escape(__('Resolver', 'glpiintegaglpi')); ?>
                                            </button>
                                            <?php if ($itemTicketId > 0 && $itemDuration > 0) { ?>
                                                <?php if ($hasLinkedTask) { ?>
                                                    <span class="badge bg-success ms-1" title="<?= $escape(__('Tarefa GLPI #', 'glpiintegaglpi') . $itemTaskId); ?>">
                                                        <?= $escape(__('Tarefa já vinculada', 'glpiintegaglpi')); ?>
                                                    </span>
                                                <?php } else { ?>
                                                    <button type="button" class="btn btn-sm btn-outline-success ms-1"
                                                        data-bs-toggle="modal"
                                                        data-bs-target="#modal-task-<?= $itemId; ?>">
                                                        <?= $escape(__('Criar Tarefa', 'glpiintegaglpi')); ?>
                                                    </button>
                                                <?php } ?>
                                            <?php } ?>
                                        <?php } elseif ($hasLinkedTask) { ?>
                                            <span class="badge bg-success" title="<?= $escape(__('Tarefa GLPI #', 'glpiintegaglpi') . $itemTaskId); ?>">
                                                <?= $escape(__('Tarefa já vinculada', 'glpiintegaglpi')); ?>
                                            </span>
                                        <?php } else { ?>
                                            <span class="text-muted small"><?= $escape(__('Concluído', 'glpiintegaglpi')); ?></span>
                                        <?php } ?>
                                    </td>
                                </tr>

                                <?php /* ── Resolve modal ──────────────────────── */ ?>
                                <?php if ($canResolve) { ?>
                                    <div class="modal fade" id="modal-resolve-<?= $itemId; ?>" tabindex="-1">
                                        <div class="modal-dialog">
                                            <div class="modal-content">
                                                <form method="post" action="<?= $escape($selfUrl); ?>">
                                                    <input type="hidden" name="_glpi_csrf_token" value="<?= $escape($csrfToken); ?>">
                                                    <input type="hidden" name="action" value="resolve_item">
                                                    <input type="hidden" name="item_id" value="<?= $itemId; ?>">
                                                    <div class="modal-header">
                                                        <h5 class="modal-title"><?= $escape(__('Resolver item #', 'glpiintegaglpi') . $itemId); ?></h5>
                                                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                                                    </div>
                                                    <div class="modal-body">
                                                        <div class="mb-3">
                                                            <label class="form-label"><?= $escape(__('Novo status', 'glpiintegaglpi')); ?></label>
                                                            <select class="form-select" name="new_status" required>
                                                                <option value="no_ticket_found"><?= $escape(__('Sem ticket (registrar)', 'glpiintegaglpi')); ?></option>
                                                                <option value="ignored_duplicate"><?= $escape(__('Ignorar — duplicado', 'glpiintegaglpi')); ?></option>
                                                                <option value="out_of_scope"><?= $escape(__('Fora do escopo', 'glpiintegaglpi')); ?></option>
                                                                <option value="matched_ticket"><?= $escape(__('Vincular a ticket', 'glpiintegaglpi')); ?></option>
                                                            </select>
                                                        </div>
                                                        <div class="mb-3">
                                                            <label class="form-label"><?= $escape(__('Ticket GLPI (se vincular)', 'glpiintegaglpi')); ?></label>
                                                            <input class="form-control" type="number" name="ticket_id" min="1" value="<?= $itemTicketId > 0 ? $itemTicketId : ''; ?>" placeholder="<?= $escape(__('Número do ticket', 'glpiintegaglpi')); ?>">
                                                        </div>
                                                        <div class="mb-3">
                                                            <label class="form-label"><?= $escape(__('Nota (opcional, máx 500 chars)', 'glpiintegaglpi')); ?></label>
                                                            <textarea class="form-control" name="note" maxlength="500" rows="2"></textarea>
                                                        </div>
                                                        <div class="alert alert-secondary small">
                                                            <?= $escape(__('Nenhuma notificação automática será enviada. Nenhum WhatsApp será enviado.', 'glpiintegaglpi')); ?>
                                                        </div>
                                                    </div>
                                                    <div class="modal-footer">
                                                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal"><?= $escape(__('Cancelar', 'glpiintegaglpi')); ?></button>
                                                        <button type="submit" class="btn btn-primary"><?= $escape(__('Confirmar', 'glpiintegaglpi')); ?></button>
                                                    </div>
                                                </form>
                                            </div>
                                        </div>
                                    </div>

                                    <?php if ($itemTicketId > 0 && $itemDuration > 0 && !$hasLinkedTask) { ?>
                                        <div class="modal fade" id="modal-task-<?= $itemId; ?>" tabindex="-1">
                                            <div class="modal-dialog">
                                                <div class="modal-content">
                                                    <form method="post" action="<?= $escape($selfUrl); ?>">
                                                        <input type="hidden" name="_glpi_csrf_token" value="<?= $escape($csrfToken); ?>">
                                                        <input type="hidden" name="action" value="create_task">
                                                        <input type="hidden" name="item_id" value="<?= $itemId; ?>">
                                                        <input type="hidden" name="ticket_id" value="<?= $itemTicketId; ?>">
                                                        <input type="hidden" name="session_id_hash" value="<?= $escape($sessionIdHash); ?>">
                                                        <div class="modal-header">
                                                            <h5 class="modal-title"><?= $escape(__('Criar Tarefa GLPI — Ticket #', 'glpiintegaglpi') . $itemTicketId); ?></h5>
                                                            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                                                        </div>
                                                        <div class="modal-body">
                                                            <div class="mb-3">
                                                                <label class="form-label"><?= $escape(__('Duração (minutos)', 'glpiintegaglpi')); ?></label>
                                                                <input class="form-control" type="number" name="duration_minutes" min="1" max="480" value="<?= $durationMins; ?>" required>
                                                                <div class="form-text"><?= $escape(sprintf(__('Duração da sessão remota: %d min.', 'glpiintegaglpi'), $durationMins)); ?></div>
                                                            </div>
                                                            <div class="alert alert-warning small">
                                                                <?= $escape(__('A tarefa será criada como nota privada com actiontime. Nenhum follow-up público será gerado. Metadados internos não aparecem para o cliente.', 'glpiintegaglpi')); ?>
                                                            </div>
                                                        </div>
                                                        <div class="modal-footer">
                                                            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal"><?= $escape(__('Cancelar', 'glpiintegaglpi')); ?></button>
                                                            <button type="submit" class="btn btn-success"><?= $escape(__('Criar Tarefa', 'glpiintegaglpi')); ?></button>
                                                        </div>
                                                    </form>
                                                </div>
                                            </div>
                                        </div>
                                    <?php } ?>
                                <?php } ?>
                            <?php } ?>
                        </tbody>
                    </table>
                </div>
            <?php } ?>
        </div>
        <div class="card-footer d-flex justify-content-between">
            <?php if ($hasPrev) { ?>
                <a href="<?= $escape($selfUrl . '?' . http_build_query(array_filter(['status' => $filterStatus, 'entity_id' => $filterEntity ?: null, 'page' => $page - 1]))); ?>">&laquo; <?= $escape(__('Anterior', 'glpiintegaglpi')); ?></a>
            <?php } else { ?>
                <span></span>
            <?php } ?>
            <?php if ($hasNext) { ?>
                <a href="<?= $escape($selfUrl . '?' . http_build_query(array_filter(['status' => $filterStatus, 'entity_id' => $filterEntity ?: null, 'page' => $page + 1]))); ?>"><?= $escape(__('Próxima', 'glpiintegaglpi')); ?> &raquo;</a>
            <?php } ?>
        </div>
    </div>

    <div class="card mt-3">
        <div class="card-header"><?= $escape(__('Política de acesso read-only allowlist', 'glpiintegaglpi')); ?></div>
        <div class="card-body small text-muted">
            <ul class="mb-0">
                <li><?= $escape(__('Endpoint permitido: POST /public-api/v1/reports/remote-access-with-groups (passivo, read-only).', 'glpiintegaglpi')); ?></li>
                <li><?= $escape(__('Proibido: /hosts/{id}/connection, PUT, DELETE, PATCH, RMM, scripts.', 'glpiintegaglpi')); ?></li>
                <li><?= $escape(__('IP do técnico: nunca exibido. Técnico: apenas hash irreversível.', 'glpiintegaglpi')); ?></li>
                <li><?= $escape(__('Tarefa GLPI: somente após confirmação humana. Sem faturamento automático. Sem WhatsApp automático.', 'glpiintegaglpi')); ?></li>
                <li><?= $escape(__('Feature flag LOGMEIN_RECONCILIATION_ENABLED=false por padrão em produção.', 'glpiintegaglpi')); ?></li>
            </ul>
        </div>
    </div>
</div>
