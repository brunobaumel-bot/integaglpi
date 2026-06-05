<?php

declare(strict_types=1);

/** @var \GlpiPlugin\Integaglpi\Renderer\TicketTabRenderer $this */
/** @var array<string, mixed>|null $runtime */
/** @var array<string, mixed>|null $context */
/** @var list<array<string, mixed>> $messages */
/** @var list<array<string, mixed>> $queues */
/** @var bool $isExternalConfigured */
/** @var array<string, mixed> $connectionConfig */
/** @var string|null $externalDbError */
/** @var \Ticket $ticket */
/** @var string $tabView */
/** @var array<string, mixed>|null $manualWhatsapp */

$timelineId = 'integaglpi-timeline-' . (int) $ticket->getID();
$runtimeView = is_array($runtime) ? $runtime : [];
$assignedUserId = isset($runtimeView['assigned_user_id_int']) ? (int) $runtimeView['assigned_user_id_int'] : 0;
$currentUserId = (int) (\Session::getLoginUserID() ?: 0);
$statusValue = strtolower(trim((string) ($runtimeView['status'] ?? 'open')));
$isClosed = array_key_exists('is_closed', $runtimeView)
    ? (bool) $runtimeView['is_closed']
    : $statusValue === 'closed';
$replyOwnedByCurrentUser = !$isClosed && $assignedUserId > 0 && $assignedUserId === $currentUserId;
$replyBlockedReason = '';
if (!$isClosed && $runtime !== null && $assignedUserId <= 0) {
    $replyBlockedReason = __('Você precisa assumir este atendimento antes de responder.', 'glpiintegaglpi');
} elseif (!$isClosed && $runtime !== null && !$replyOwnedByCurrentUser) {
    $replyBlockedReason = __('Este atendimento está atribuído a outro técnico.', 'glpiintegaglpi');
}
$canClaim = array_key_exists('can_claim', $runtimeView)
    ? (bool) $runtimeView['can_claim']
    : !$isClosed;
$claimBlockReason = trim((string) ($runtimeView['claim_block_reason'] ?? ''));
$canTransfer = array_key_exists('can_transfer', $runtimeView)
    ? (bool) $runtimeView['can_transfer']
    : !$isClosed;
$canClose = array_key_exists('can_close', $runtimeView)
    ? (bool) $runtimeView['can_close']
    : !$isClosed;
$profileSnapshot = is_array($runtimeView['contact_profile_snapshot'] ?? null)
    ? $runtimeView['contact_profile_snapshot']
    : null;
$canViewRawPii = $replyOwnedByCurrentUser
    || \GlpiPlugin\Integaglpi\Service\SecurityPermissionService::hasRight(
        \GlpiPlugin\Integaglpi\Service\SecurityPermissionService::RIGHT_VIEW_UNMASKED_PII
    );
$maskPhoneForDisplay = static function (string $phone): string {
    $digits = preg_replace('/\D+/', '', $phone) ?? '';
    if ($digits === '') {
        return '';
    }

    return str_repeat('*', max(4, strlen($digits) - 4)) . substr($digits, -4);
};
$maskEmailForDisplay = static function (string $email): string {
    $email = trim($email);
    if ($email === '' || !str_contains($email, '@')) {
        return $email === '' ? '' : '[email]';
    }

    [$local, $domain] = explode('@', $email, 2);
    $prefix = substr($local, 0, min(2, strlen($local)));

    return $prefix . str_repeat('*', max(2, strlen($local) - strlen($prefix))) . '@' . $domain;
};
if ($canViewRawPii && $runtime !== null) {
    \GlpiPlugin\Integaglpi\Service\SecurityAuditService::logPiiUnmaskedView(
        'ticket_tab',
        hash('sha256', (string) ($runtimeView['conversation_id'] ?? '') . '|' . $currentUserId)
    );
}
$contextView = is_array($context) ? $context : [];
$contextConversation = is_array($contextView['conversation'] ?? null) ? $contextView['conversation'] : null;
$contextRisk = is_array($contextView['risk'] ?? null) ? $contextView['risk'] : null;
$contextWarnings = is_array($contextView['warnings'] ?? null) ? $contextView['warnings'] : [];
$contextEvents = is_array($contextView['events'] ?? null) ? $contextView['events'] : [];
$contextDeadLetter = is_array($contextView['dead_letter'] ?? null) ? $contextView['dead_letter'] : null;
$contextCsat = is_array($contextView['csat'] ?? null) ? $contextView['csat'] : null;
$contextAiQuality = is_array($contextView['ai_quality'] ?? null) ? $contextView['ai_quality'] : null;
$contextLogmein = is_array($contextView['logmein_context'] ?? null) ? $contextView['logmein_context'] : [];
$aiAssistant = is_array($contextView['ai_assistant'] ?? null) ? $contextView['ai_assistant'] : [];
$aiAssistantKnowledge = is_array($aiAssistant['local_knowledge'] ?? null) ? $aiAssistant['local_knowledge'] : [];
$aiAssistantKnowledgeItems = is_array($aiAssistantKnowledge['items'] ?? null) ? $aiAssistantKnowledge['items'] : [];
$aiAssistantCopilot = is_array($aiAssistant['copilot'] ?? null) ? $aiAssistant['copilot'] : [];
$aiAssistantExternal = is_array($aiAssistant['external_research'] ?? null) ? $aiAssistant['external_research'] : [];
$aiAssistantP4 = is_array($aiAssistant['p4'] ?? null) ? $aiAssistant['p4'] : [];
$aiSupervisorEnabled = (bool) ($contextView['ai_supervisor_enabled'] ?? \GlpiPlugin\Integaglpi\Plugin::isAiSupervisorEnabled());
$contextCorrelationId = trim((string) ($contextView['correlation_id'] ?? ''));
$canViewTechnical = (bool) ($contextView['can_view_technical'] ?? false);
$predictiveRiskScore = null;
if ($canViewTechnical) {
    try {
        $predictiveRiskScore = (new \GlpiPlugin\Integaglpi\Service\RiskScoreService(
            new \GlpiPlugin\Integaglpi\Service\PluginConfigService()
        ))->getLatestScore(
            is_array($contextConversation) ? (string) ($contextConversation['conversation_id'] ?? '') : '',
            (int) $ticket->getID()
        );
    } catch (\Throwable $exception) {
        error_log('[integaglpi][risk_score][ticket_tab] ' . substr($exception->getMessage(), 0, 180));
        $predictiveRiskScore = null;
    }
}
$localTemplates = [];
try {
    $localTemplates = (new \GlpiPlugin\Integaglpi\Service\PluginConfigService())->getActiveLocalTemplates();
} catch (\Throwable $exception) {
    $localTemplates = [];
}
$statusBadge = static function ($status): string {
    $status = strtolower((string) $status);
    if (in_array($status, ['open', 'ok', 'success'], true)) {
        return 'success';
    }
    if (in_array($status, ['closed', 'critical', 'error', 'failed', 'danger'], true)) {
        return 'danger';
    }
    if (in_array($status, ['awaiting_queue_selection', 'awaiting_entity_selection', 'collecting_contact_profile', 'warning'], true)) {
        return 'warning';
    }

    return 'secondary';
};
$riskBadge = static function ($level): string {
    $level = (string) $level;
    if ($level === 'critical') {
        return 'danger';
    }
    if ($level === 'warning') {
        return 'warning';
    }

    return 'success';
};
$short = static function ($value, int $max = 44): string {
    $text = trim((string) $value);
    if ($text === '') {
        return '-';
    }

    return strlen($text) > $max ? substr($text, 0, $max) . '...' : $text;
};
$attachmentStatusLabel = static function (string $status): string {
    switch ($status) {
        case 'received':
            return __('recebido', 'glpiintegaglpi');
        case 'validated':
            return __('validado', 'glpiintegaglpi');
        case 'blocked':
            return __('bloqueado', 'glpiintegaglpi');
        case 'synced':
            return __('sincronizado', 'glpiintegaglpi');
        case 'failed':
            return __('falhou', 'glpiintegaglpi');
        case 'deleted':
            return __('excluído logicamente', 'glpiintegaglpi');
        default:
            return $status;
    }
};
$attachmentStatusBadge = static function (string $status): string {
    if (in_array($status, ['synced', 'validated'], true)) {
        return 'success';
    }
    if (in_array($status, ['blocked', 'failed'], true)) {
        return 'danger';
    }
    if ($status === 'deleted') {
        return 'secondary';
    }

    return 'info';
};
$shortHash = static function ($value): string {
    $hash = trim((string) $value);
    if ($hash === '') {
        return '';
    }

    return strlen($hash) > 24 ? substr($hash, 0, 12) . '...' . substr($hash, -8) : $hash;
};
$attachmentMediaValue = static function (array $message, string $key): string {
    $value = $message[$key] ?? null;
    if (is_string($value) && trim($value) !== '') {
        return trim($value);
    }
    $mediaInfo = $message['media_info'] ?? null;
    if (is_array($mediaInfo)) {
        $mediaValue = $mediaInfo[$key] ?? null;
        if (is_string($mediaValue) && trim($mediaValue) !== '') {
            return trim($mediaValue);
        }
    }

    return '';
};
$renderManualWhatsappStart = function () use ($ticket, $manualWhatsapp): void {
    $data = is_array($manualWhatsapp) ? $manualWhatsapp : [];
    $template = is_array($data['template'] ?? null) ? $data['template'] : null;
    $candidates = is_array($data['candidates'] ?? null) ? $data['candidates'] : [];
    $requester = is_array($data['requester'] ?? null) ? $data['requester'] : [];
    $csrfToken = \GlpiPlugin\Integaglpi\Plugin::getCsrfToken();
    ?>
    <div class="border rounded p-3 bg-light mt-3">
        <strong><?= $this->escape(__('Vincular/Iniciar WhatsApp', 'glpiintegaglpi')); ?></strong>
        <p class="text-muted small mb-3">
            <?= $this->escape(__('Use esta ação somente quando o chamado manual precisa iniciar atendimento WhatsApp por template aprovado. Texto livre fora da janela de 24h permanece bloqueado.', 'glpiintegaglpi')); ?>
        </p>
        <?php if (is_string($data['error'] ?? null) && $data['error'] !== '') { ?>
            <div class="alert alert-warning"><?= $this->escape((string) $data['error']); ?></div>
        <?php } ?>
        <?php if ($template === null) { ?>
            <div class="alert alert-warning mb-0">
                <?= $this->escape(__('Template aprovado aviso_atendimento_fora_janela não está ativo.', 'glpiintegaglpi')); ?>
            </div>
        <?php } else { ?>
            <form method="post" action="<?= $this->escape(\GlpiPlugin\Integaglpi\Plugin::getManualTicketWhatsappUrl()); ?>" class="mb-0">
                <input type="hidden" name="_glpi_csrf_token" value="<?= $this->escape($csrfToken); ?>">
                <input type="hidden" name="ticket_id" value="<?= (int) $ticket->getID(); ?>">
                <input type="hidden" name="manual_whatsapp_action" value="start_template">
                <?php if ($candidates !== []) { ?>
                    <div class="mb-3">
                        <label class="form-label"><?= $this->escape(__('Telefones candidatos', 'glpiintegaglpi')); ?></label>
                        <?php foreach ($candidates as $index => $candidate) { ?>
                            <?php
                            $phone = trim((string) ($candidate['phone_e164'] ?? ''));
                            if ($phone === '') {
                                continue;
                            }
                            $blocked = !empty($candidate['has_open_conflict']);
                            ?>
                            <label class="d-block border rounded p-2 mb-2 bg-white <?= $blocked ? 'text-muted' : ''; ?>">
                                <input
                                    type="radio"
                                    name="candidate_phone_e164"
                                    value="<?= $this->escape($phone); ?>"
                                    <?= $index === 0 && !$blocked ? 'checked' : ''; ?>
                                    <?= $blocked ? 'disabled' : ''; ?>
                                >
                                <strong><?= $this->escape((string) ($candidate['masked_phone'] ?? $phone)); ?></strong>
                                <span class="badge bg-light text-dark border"><?= $this->escape((string) ($candidate['source'] ?? '')); ?></span>
                                <?php if ($blocked) { ?>
                                    <span class="text-danger small">
                                        <?= $this->escape(sprintf(
                                            __('bloqueado: conversa aberta no chamado #%s', 'glpiintegaglpi'),
                                            (string) ($candidate['conflict_ticket_id'] ?? '-')
                                        )); ?>
                                    </span>
                                <?php } ?>
                            </label>
                        <?php } ?>
                    </div>
                <?php } ?>
                <div class="mb-3">
                    <label class="form-label" for="integaglpi-manual-phone-<?= (int) $ticket->getID(); ?>">
                        <?= $this->escape(__('Telefone manual em E.164', 'glpiintegaglpi')); ?>
                    </label>
                    <input
                        type="text"
                        class="form-control"
                        id="integaglpi-manual-phone-<?= (int) $ticket->getID(); ?>"
                        name="manual_phone_e164"
                        placeholder="+5511999999999"
                        pattern="^\+[1-9]\d{1,14}$"
                    >
                    <small class="text-muted"><?= $this->escape(__('Preencha somente se os candidatos estiverem ausentes ou incorretos.', 'glpiintegaglpi')); ?></small>
                </div>
                <div class="alert alert-warning">
                    <strong><?= $this->escape(__('Alerta de custo WhatsApp/Meta', 'glpiintegaglpi')); ?></strong><br>
                    <?= $this->escape(sprintf(
                        __('Será enviado o template aprovado %s (%s) com variáveis: nome=%s, ticket_id=%d.', 'glpiintegaglpi'),
                        (string) $template['name'],
                        (string) $template['language'],
                        (string) ($requester['name'] ?? __('Cliente', 'glpiintegaglpi')),
                        (int) $ticket->getID()
                    )); ?>
                </div>
                <label class="form-check mb-2">
                    <input class="form-check-input" type="checkbox" name="cost_acknowledged" value="1" required>
                    <span class="form-check-label"><?= $this->escape(__('Estou ciente de que o envio pode gerar custo Meta.', 'glpiintegaglpi')); ?></span>
                </label>
                <label class="form-check mb-3">
                    <input class="form-check-input" type="checkbox" name="manual_confirmation" value="1" required>
                    <span class="form-check-label"><?= $this->escape(__('Confirmo o início manual do atendimento WhatsApp para este chamado.', 'glpiintegaglpi')); ?></span>
                </label>
                <button type="submit" class="btn btn-primary">
                    <?= $this->escape(__('Enviar template e vincular conversa', 'glpiintegaglpi')); ?>
                </button>
            </form>
        <?php } ?>
    </div>
    <?php
};
?>
<?php if ($tabView === 'context') { ?>
<div class="card mb-3">
    <div class="card-header"><?= $this->escape(__('Contexto WhatsApp', 'glpiintegaglpi')); ?></div>
    <div class="card-body">
        <?php if (!$isExternalConfigured) { ?>
            <div class="alert alert-warning mb-0">
                <?= $this->escape(__('Configure o PostgreSQL externo para exibir o contexto WhatsApp.', 'glpiintegaglpi')); ?>
            </div>
        <?php } elseif (isset($externalDbError) && is_string($externalDbError) && $externalDbError !== '') { ?>
            <div class="alert alert-warning mb-0">
                <?= $this->escape($externalDbError); ?>
            </div>
        <?php } elseif ($runtime === null) { ?>
            <div class="alert alert-info mb-0">
                <?= $this->escape(__('Este chamado ainda não está vinculado a uma conversa WhatsApp.', 'glpiintegaglpi')); ?>
            </div>
            <?php if (\GlpiPlugin\Integaglpi\Plugin::canUpdate()) { $renderManualWhatsappStart(); } ?>
        <?php } else { ?>
            <div class="row g-3">
                <div class="col-md-3">
                    <small class="text-muted d-block"><?= $this->escape(__('Ticket GLPI', 'glpiintegaglpi')); ?></small>
                    <strong>#<?= (int) $ticket->getID(); ?></strong>
                </div>
                <div class="col-md-3">
                    <small class="text-muted d-block"><?= $this->escape(__('Telefone', 'glpiintegaglpi')); ?></small>
                    <?php $runtimePhone = (string) ($runtime['phone_e164'] ?? '-'); ?>
                    <strong><?= $this->escape($canViewRawPii ? $runtimePhone : $maskPhoneForDisplay($runtimePhone)); ?></strong>
                </div>
                <div class="col-md-3">
                    <small class="text-muted d-block"><?= $this->escape(__('Status conversa', 'glpiintegaglpi')); ?></small>
                    <span class="badge <?= $isClosed ? 'bg-danger' : 'bg-success'; ?>"><?= $this->escape((string) ($runtime['status'] ?? 'open')); ?></span>
                </div>
                <div class="col-md-3">
                    <small class="text-muted d-block"><?= $this->escape(__('Fila', 'glpiintegaglpi')); ?></small>
                    <?= $this->escape((string) ($runtime['queue_label'] ?? __('No queue', 'glpiintegaglpi'))); ?>
                </div>
                <div class="col-md-3">
                    <small class="text-muted d-block"><?= $this->escape(__('Contato', 'glpiintegaglpi')); ?></small>
                    <?= $this->escape((string) ($runtime['contact_name'] ?? __('Desconhecido', 'glpiintegaglpi'))); ?>
                </div>
                <div class="col-md-3">
                    <small class="text-muted d-block"><?= $this->escape(__('Técnico atual', 'glpiintegaglpi')); ?></small>
                    <?= $this->escape((string) ($runtime['assigned_user_label'] ?? __('Unassigned', 'glpiintegaglpi'))); ?>
                </div>
                <div class="col-md-3">
                    <small class="text-muted d-block"><?= $this->escape(__('Grupo atribuído', 'glpiintegaglpi')); ?></small>
                    <?= $this->escape((string) ($runtime['assigned_group_label'] ?? __('Sem grupo', 'glpiintegaglpi'))); ?>
                </div>
                <div class="col-md-3">
                    <small class="text-muted d-block"><?= $this->escape(__('Última atividade', 'glpiintegaglpi')); ?></small>
                    <?= $this->escape((string) ($runtime['last_message_at'] ?? '-')); ?>
                </div>
                <?php $whatsappWindow = is_array($context['whatsapp_window'] ?? null) ? $context['whatsapp_window'] : []; ?>
                <?php if (!empty($whatsappWindow)) { ?>
                    <?php $windowOpen = !empty($whatsappWindow['is_open']); ?>
                    <div class="col-md-3">
                        <small class="text-muted d-block"><?= $this->escape(__('Janela WhatsApp 24h', 'glpiintegaglpi')); ?></small>
                        <span class="badge <?= $windowOpen ? 'bg-success' : 'bg-warning text-dark'; ?>">
                            <?= $this->escape((string) ($whatsappWindow['label'] ?? '')); ?>
                        </span>
                    </div>
                <?php } ?>
                <?php if ($contextConversation !== null && (int) ($contextConversation['memory_entity_id'] ?? 0) > 0) { ?>
                    <div class="col-md-3">
                        <small class="text-muted d-block"><?= $this->escape(__('Entidade memorizada', 'glpiintegaglpi')); ?></small>
                        <?= $this->escape((string) ($contextConversation['memory_entity_name'] ?? $contextConversation['memory_entity_id'])); ?>
                    </div>
                <?php } ?>
            </div>

            <?php if (\GlpiPlugin\Integaglpi\Service\SmartHelpService::canViewPanel()) { ?>
                <div class="border rounded p-3 mt-3 mb-0 integaglpi-smart-help"
                     data-ticket-id="<?= (int) $ticket->getID(); ?>"
                     data-conversation-id="<?= $this->escape((string) ($contextConversation['conversation_id'] ?? '')); ?>"
                     data-context-updated-at="<?= $this->escape((string) ($ticket->fields['date_mod'] ?? $ticket->fields['date'] ?? '')); ?>"
                     data-action-url="<?= $this->escape(\GlpiPlugin\Integaglpi\Plugin::getWebBasePath() . '/front/smart.help.php'); ?>"
                     data-csrf="<?= $this->escape(\GlpiPlugin\Integaglpi\Plugin::getCsrfToken()); ?>">
                    <div class="d-flex justify-content-between align-items-center gap-2 flex-wrap mb-2">
                        <strong><i class="ti ti-bulb me-1"></i><?= $this->escape(__('Ajuda Inteligente', 'glpiintegaglpi')); ?></strong>
                        <div class="d-flex gap-2 flex-wrap">
                            <button type="button" class="btn btn-sm btn-primary js-smart-help-summarize">
                                <i class="ti ti-list-details me-1"></i><?= $this->escape(__('Resumo do chamado', 'glpiintegaglpi')); ?>
                            </button>
                            <button type="button" class="btn btn-sm btn-outline-primary js-smart-help-local-search" disabled>
                                <i class="ti ti-search me-1"></i><?= $this->escape(__('Busca local', 'glpiintegaglpi')); ?>
                            </button>
                            <button type="button" class="btn btn-sm btn-outline-warning js-smart-help-external" disabled>
                                <i class="ti ti-cloud-search me-1"></i><?= $this->escape(__('Pedir ajuda externa (nuvem)', 'glpiintegaglpi')); ?>
                            </button>
                            <span class="badge bg-secondary js-smart-help-status"><?= $this->escape(__('pronto', 'glpiintegaglpi')); ?></span>
                        </div>
                    </div>
                    <div class="text-muted small mb-2">
                        <?= $this->escape(__('Processo guiado somente leitura: gere o resumo, execute a busca local e só depois peça ajuda externa se necessário. Nada é enviado ao cliente nem altera o chamado automaticamente.', 'glpiintegaglpi')); ?>
                    </div>
                    <div class="row g-2 align-items-end mb-2">
                        <div class="col-md-7">
                            <label class="form-label small mb-1">
                                <?= $this->escape(__('IA para pesquisa externa', 'glpiintegaglpi')); ?>
                            </label>
                            <select class="form-select form-select-sm js-smart-help-provider">
                                <option value="disabled|" selected><?= $this->escape(__('Carregando providers seguros...', 'glpiintegaglpi')); ?></option>
                            </select>
                        </div>
                        <div class="col-md-5">
                            <div class="form-text js-smart-help-provider-help">
                                <?= $this->escape(__('Cloud exige consentimento e PII Guard.', 'glpiintegaglpi')); ?>
                            </div>
                        </div>
                    </div>
                    <div class="mb-2">
                        <label class="form-label small mb-1" for="smart-help-context-summary-<?= (int) $ticket->getID(); ?>">
                            <?= $this->escape(__('Resumo técnico sem dados pessoais', 'glpiintegaglpi')); ?>
                        </label>
                        <textarea class="form-control form-control-sm js-smart-help-technical-summary" id="smart-help-context-summary-<?= (int) $ticket->getID(); ?>" rows="2"></textarea>
                        <div class="form-text js-smart-help-schema-status">
                            <?= $this->escape(__('Aguardando validação local da KB e schema 044.', 'glpiintegaglpi')); ?>
                        </div>
                    </div>
                    <div class="js-smart-help-articles small"></div>
                    <div class="row g-2 mt-1">
                        <div class="col-md-6">
                            <div class="fw-bold small"><?= $this->escape(__('Checklist de diagnóstico', 'glpiintegaglpi')); ?></div>
                            <ul class="small mb-0 js-smart-help-checklist"></ul>
                        </div>
                        <div class="col-md-6">
                            <div class="fw-bold small"><?= $this->escape(__('Perguntas sugeridas ao cliente', 'glpiintegaglpi')); ?></div>
                            <ul class="small mb-0 list-unstyled js-smart-help-questions"></ul>
                        </div>
                    </div>
                    <div class="mt-2 js-smart-help-local-suggestion"></div>
                    <div class="mt-2 js-smart-help-history"></div>
                    <div class="mt-2 js-smart-help-cloud"></div>
                    <div class="mt-2 small js-smart-help-message text-muted"></div>
                    <div class="form-text mt-1">
                        <?= $this->escape(__('Somente leitura: nada é enviado ao cliente nem altera o chamado automaticamente. Publicação na KB é manual.', 'glpiintegaglpi')); ?>
                    </div>
                </div>
            <?php } ?>

            <?php if (!empty($whatsappWindow) && empty($whatsappWindow['is_open']) && trim((string) ($whatsappWindow['alert'] ?? '')) !== '') { ?>
                <div class="alert alert-warning mt-3 mb-0">
                    <?= $this->escape((string) $whatsappWindow['alert']); ?>
                    <?php if ($localTemplates !== []) { ?>
                        <div class="mt-2">
                            <strong><?= $this->escape(__('Templates locais disponíveis', 'glpiintegaglpi')); ?>:</strong>
                            <?php foreach (array_slice($localTemplates, 0, 5) as $template) { ?>
                                <span class="badge bg-light text-dark border">
                                    <?= $this->escape((string) $template['name']); ?>
                                    <?= $this->escape((string) $template['language']); ?>
                                </span>
                            <?php } ?>
                        </div>
                    <?php } ?>
                </div>
            <?php } ?>

            <?php if ($profileSnapshot !== null) { ?>
                <div class="border rounded p-3 mt-3 mb-0 bg-light">
                    <strong><?= $this->escape(__('Perfil do contato usado no chamado', 'glpiintegaglpi')); ?></strong><br>
                    <?= $this->escape(__('Nome', 'glpiintegaglpi')); ?>:
                    <?= $this->escape((string) ($profileSnapshot['requester_name'] ?? '-')); ?><br>
                    <?= $this->escape(__('E-mail', 'glpiintegaglpi')); ?>:
                    <?php $profileEmail = (string) ($profileSnapshot['email_address'] ?? $contextConversation['email_address'] ?? '-'); ?>
                    <?= $this->escape($canViewRawPii ? $profileEmail : $maskEmailForDisplay($profileEmail)); ?><br>
                    <?= $this->escape(__('Empresa informada', 'glpiintegaglpi')); ?>:
                    <?= $this->escape((string) ($profileSnapshot['company_name_raw'] ?? '-')); ?><br>
                    <?= $this->escape(__('Equipamento', 'glpiintegaglpi')); ?>:
                    <?= !empty($profileSnapshot['equipment_tag_unknown'])
                        ? $this->escape(__('Não informado', 'glpiintegaglpi'))
                        : $this->escape((string) ($profileSnapshot['last_equipment_tag'] ?? '-')); ?><br>
                    <?= $this->escape(__('Resumo', 'glpiintegaglpi')); ?>:
                    <?= $this->escape((string) ($profileSnapshot['last_problem_summary'] ?? '-')); ?><br>
                    <?= $this->escape(__('Status', 'glpiintegaglpi')); ?>:
                    <?= $this->escape((string) ($profileSnapshot['profile_status'] ?? 'incomplete')); ?>
                </div>
            <?php } ?>

            <?php if ($contextLogmein !== []) { ?>
                <?php
                $logmeinItems = is_array($contextLogmein['items'] ?? null) ? $contextLogmein['items'] : [];
                $logmeinStatus = (string) ($contextLogmein['status'] ?? 'disabled');
                ?>
                <div class="border rounded p-3 mt-3 mb-0">
                    <div class="d-flex align-items-start justify-content-between gap-2">
                        <div>
                            <strong><?= $this->escape(__('Contexto LogMeIn read-only', 'glpiintegaglpi')); ?></strong>
                            <div class="text-muted small">
                                <?= $this->escape(__('Somente grupo, host, etiqueta e status. Sem sessão remota, sem comando e sem gravação automática de entidade.', 'glpiintegaglpi')); ?>
                            </div>
                        </div>
                        <span class="badge bg-<?= $logmeinStatus === 'available' ? 'success' : 'secondary'; ?>">
                            <?= $this->escape($logmeinStatus); ?>
                        </span>
                    </div>

                    <?php if ($logmeinItems === []) { ?>
                        <div class="alert alert-light border mt-3 mb-0">
                            <?= $this->escape((string) ($contextLogmein['message'] ?? __('Contexto de ativo temporariamente indisponível.', 'glpiintegaglpi'))); ?>
                        </div>
                    <?php } else { ?>
                        <div class="table-responsive mt-3">
                            <table class="table table-sm align-middle mb-0">
                                <thead>
                                    <tr>
                                        <th><?= $this->escape(__('Grupo', 'glpiintegaglpi')); ?></th>
                                        <th><?= $this->escape(__('Host', 'glpiintegaglpi')); ?></th>
                                        <th><?= $this->escape(__('Etiqueta', 'glpiintegaglpi')); ?></th>
                                        <th><?= $this->escape(__('Status', 'glpiintegaglpi')); ?></th>
                                        <th><?= $this->escape(__('Último sync', 'glpiintegaglpi')); ?></th>
                                        <th><?= $this->escape(__('Alertas', 'glpiintegaglpi')); ?></th>
                                        <th><?= $this->escape(__('Entidade candidata', 'glpiintegaglpi')); ?></th>
                                        <th><?= $this->escape(__('Confiança', 'glpiintegaglpi')); ?></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <?php foreach ($logmeinItems as $item) { ?>
                                        <?php $score = (int) ($item['confidence_score'] ?? 0); ?>
                                        <tr>
                                            <td><?= $this->escape((string) ($item['group_name'] ?? '-')); ?></td>
                                            <td><?= $this->escape((string) ($item['host_name'] ?? '-')); ?></td>
                                            <td>
                                                <?= $this->escape((string) (($item['equipment_tag'] ?? '') !== '' ? $item['equipment_tag'] : __('sem etiqueta válida', 'glpiintegaglpi'))); ?>
                                            </td>
                                            <td><?= $this->escape((string) ($item['status'] ?? 'unknown')); ?></td>
                                            <td><?= $this->escape((string) ($item['last_sync_at'] ?? '-')); ?></td>
                                            <td>
                                                <?php $warnings = is_array($item['warnings'] ?? null) ? $item['warnings'] : []; ?>
                                                <?= $warnings === []
                                                    ? $this->escape(__('sem alerta', 'glpiintegaglpi'))
                                                    : $this->escape(implode(' | ', array_map('strval', $warnings))); ?>
                                            </td>
                                            <td><?= (int) ($item['entity_candidate_id'] ?? 0) > 0 ? '#' . (int) $item['entity_candidate_id'] : '-'; ?></td>
                                            <td><?= $score; ?>%</td>
                                        </tr>
                                    <?php } ?>
                                </tbody>
                            </table>
                        </div>
                        <div class="alert alert-warning mt-3 mb-0">
                            <?= $this->escape(__('Sugestões LogMeIn exigem confirmação técnica antes de gravar vínculo ou memória de entidade.', 'glpiintegaglpi')); ?>
                        </div>
                    <?php } ?>
                </div>
            <?php } ?>

            <?php if ($contextConversation !== null) { ?>
                <div class="border rounded p-3 mt-3 mb-0">
                    <strong><?= $this->escape(__('Vínculo GLPI do contato', 'glpiintegaglpi')); ?></strong><br>
                    <?= $this->escape(__('Usuário GLPI', 'glpiintegaglpi')); ?>:
                    <?= (int) ($contextConversation['glpi_user_id'] ?? 0) > 0
                        ? '#' . (int) $contextConversation['glpi_user_id']
                        : $this->escape(__('Não vinculado automaticamente', 'glpiintegaglpi')); ?><br>
                    <?= $this->escape(__('Status do vínculo', 'glpiintegaglpi')); ?>:
                    <?= $this->escape((string) ($contextConversation['glpi_user_link_status'] ?? '-')); ?><br>
                    <?= $this->escape(__('Origem', 'glpiintegaglpi')); ?>:
                    <?= $this->escape((string) ($contextConversation['glpi_user_link_source'] ?? '-')); ?>
                    <?php if (!empty($contextConversation['glpi_user_created_by_integaglpi'])) { ?>
                        <br><span class="badge bg-warning text-dark"><?= $this->escape(__('Criado de forma restrita pela integração', 'glpiintegaglpi')); ?></span>
                    <?php } ?>
                </div>
            <?php } ?>

            <?php if ($contextCsat !== null) { ?>
                <div class="border rounded p-3 mt-3 mb-0">
                    <strong><?= $this->escape(__('Pesquisa de satisfação', 'glpiintegaglpi')); ?></strong><br>
                    <?= $this->escape(__('Resposta', 'glpiintegaglpi')); ?>:
                    <?= $this->escape((string) ($contextCsat['csat_rating'] ?? '-')); ?><br>
                    <?= $this->escape(__('Status', 'glpiintegaglpi')); ?>:
                    <?= $this->escape((string) ($contextCsat['status'] ?? '-')); ?>
                    <?php if (!empty($contextCsat['supervisor_review_required'])) { ?>
                        <div class="alert alert-warning mt-2 mb-0">
                            <?= $this->escape(__('Cliente insatisfeito: revisar atendimento antes de fechar.', 'glpiintegaglpi')); ?>
                        </div>
                    <?php } ?>
                </div>
            <?php } ?>

            <?php if ($canViewTechnical && ($contextAiQuality !== null || ($aiSupervisorEnabled && $contextConversation !== null))) { ?>
                <?php
                $aiFlags = is_array($contextAiQuality['flags'] ?? null) ? $contextAiQuality['flags'] : [];
                $aiStatus = (string) ($contextAiQuality['status'] ?? '');
                $aiRiskFlags = is_array($contextAiQuality['risk_flags'] ?? null) ? $contextAiQuality['risk_flags'] : [];
                $aiQualityFlags = is_array($contextAiQuality['quality_flags'] ?? null) ? $contextAiQuality['quality_flags'] : [];
                $aiMissingContext = is_array($contextAiQuality['missing_context'] ?? null) ? $contextAiQuality['missing_context'] : [];
                $aiSafetyNotes = is_array($contextAiQuality['safety_notes'] ?? null) ? $contextAiQuality['safety_notes'] : [];
                $aiRelatedKbArticles = is_array($contextAiQuality['related_kb_articles'] ?? null) ? $contextAiQuality['related_kb_articles'] : [];
                $aiCommunicationQuality = is_array($contextAiQuality['communication_quality'] ?? null) ? $contextAiQuality['communication_quality'] : [];
                $aiKeyInsights = is_array($contextAiQuality['key_insights'] ?? null) ? $contextAiQuality['key_insights'] : [];
                $aiTechnicianImprovements = is_array($contextAiQuality['suggested_improvements_for_technician'] ?? null) ? $contextAiQuality['suggested_improvements_for_technician'] : [];
                $aiSupervisorRecommendation = is_array($contextAiQuality['supervisor_recommendation'] ?? null) ? $contextAiQuality['supervisor_recommendation'] : [];
                ?>
                <div class="border rounded p-3 mt-3 mb-0">
                    <div class="d-flex align-items-center justify-content-between gap-2">
                        <div>
                            <strong><?= $this->escape(__('Análise IA — revisão humana obrigatória', 'glpiintegaglpi')); ?></strong>
                            <div class="small text-muted">
                                <?= $this->escape(__('Feedback supervisor online read-only: qualidade, risco de reabertura, dados faltantes e próxima ação. Nenhuma ação é executada automaticamente.', 'glpiintegaglpi')); ?>
                            </div>
                        </div>
                        <?php if ($aiStatus !== '') { ?>
                            <span class="badge bg-<?= $this->escape($statusBadge($aiStatus)); ?>"><?= $this->escape($aiStatus); ?></span>
                        <?php } ?>
                    </div>

                    <?php if ($contextAiQuality !== null) { ?>
                        <div class="row g-3 mt-1">
                            <div class="col-md-6">
                                <small class="text-muted d-block"><?= $this->escape(__('Resumo', 'glpiintegaglpi')); ?></small>
                                <?= $this->escape((string) ($contextAiQuality['summary'] ?? '-')); ?>
                            </div>
                            <div class="col-md-3">
                                <small class="text-muted d-block"><?= $this->escape(__('Resolução', 'glpiintegaglpi')); ?></small>
                                <?= $this->escape((string) ($contextAiQuality['classification_resolution'] ?? '-')); ?>
                            </div>
                            <div class="col-md-3">
                                <small class="text-muted d-block"><?= $this->escape(__('Sentimento', 'glpiintegaglpi')); ?></small>
                                <?= $this->escape((string) ($contextAiQuality['sentiment'] ?? '-')); ?>
                            </div>
                            <div class="col-md-3">
                                <small class="text-muted d-block"><?= $this->escape(__('Urgência', 'glpiintegaglpi')); ?></small>
                                <?= $this->escape((string) ($contextAiQuality['urgency'] ?? '-')); ?>
                            </div>
                            <div class="col-md-3">
                                <small class="text-muted d-block"><?= $this->escape(__('Risco', 'glpiintegaglpi')); ?></small>
                                <?= $this->escape((string) ($contextAiQuality['risk_level'] ?? '-')); ?>
                            </div>
                            <div class="col-md-3">
                                <small class="text-muted d-block"><?= $this->escape(__('Confiança', 'glpiintegaglpi')); ?></small>
                                <?= $contextAiQuality['confidence_score'] === null ? '-' : (int) $contextAiQuality['confidence_score'] . '%'; ?>
                            </div>
                            <div class="col-md-12">
                                <small class="text-muted d-block"><?= $this->escape(__('Flags', 'glpiintegaglpi')); ?></small>
                                <?php if ($aiFlags === []) { ?>
                                    <span class="text-muted">-</span>
                                <?php } ?>
                                <?php foreach ($aiFlags as $flag) { ?>
                                    <span class="badge bg-secondary me-1"><?= $this->escape((string) $flag); ?></span>
                                <?php } ?>
                            </div>
                            <div class="col-md-6">
                                <small class="text-muted d-block"><?= $this->escape(__('Causa provável (hipótese)', 'glpiintegaglpi')); ?></small>
                                <?= $this->escape((string) ($contextAiQuality['probable_cause'] ?? '-')); ?>
                            </div>
                            <div class="col-md-6">
                                <small class="text-muted d-block"><?= $this->escape(__('Próxima ação sugerida', 'glpiintegaglpi')); ?></small>
                                <?= $this->escape((string) ($contextAiQuality['suggested_next_action'] ?? $contextAiQuality['recommendation'] ?? '-')); ?>
                            </div>
                            <div class="col-md-6">
                                <small class="text-muted d-block"><?= $this->escape(__('Qualidade do atendimento', 'glpiintegaglpi')); ?></small>
                                <?php if ($aiQualityFlags === []) { ?><span class="text-muted">-</span><?php } ?>
                                <?php foreach ($aiQualityFlags as $flag) { ?>
                                    <span class="badge bg-info text-dark me-1"><?= $this->escape((string) $flag); ?></span>
                                <?php } ?>
                            </div>
                            <div class="col-md-6">
                                <small class="text-muted d-block"><?= $this->escape(__('Riscos detectados', 'glpiintegaglpi')); ?></small>
                                <?php if ($aiRiskFlags === []) { ?><span class="text-muted">-</span><?php } ?>
                                <?php foreach ($aiRiskFlags as $flag) { ?>
                                    <span class="badge bg-warning text-dark me-1"><?= $this->escape((string) $flag); ?></span>
                                <?php } ?>
                            </div>
                            <div class="col-md-6">
                                <small class="text-muted d-block"><?= $this->escape(__('Lacunas de contexto', 'glpiintegaglpi')); ?></small>
                                <?= $this->escape($aiMissingContext === [] ? '-' : implode('; ', $aiMissingContext)); ?>
                            </div>
                            <div class="col-md-6">
                                <small class="text-muted d-block"><?= $this->escape(__('Notas de segurança', 'glpiintegaglpi')); ?></small>
                                <?= $this->escape($aiSafetyNotes === [] ? '-' : implode('; ', $aiSafetyNotes)); ?>
                            </div>
                            <div class="col-md-12">
                                <small class="text-muted d-block"><?= $this->escape(__('Notas ao supervisor', 'glpiintegaglpi')); ?></small>
                                <?= $this->escape((string) ($contextAiQuality['supervisor_notes'] ?? '-')); ?>
                            </div>
                            <div class="col-md-4">
                                <small class="text-muted d-block"><?= $this->escape(__('Aderência à KB GLPI', 'glpiintegaglpi')); ?></small>
                                <?= $this->escape((string) ($contextAiQuality['kb_alignment'] ?? '-')); ?>
                            </div>
                            <div class="col-md-4">
                                <small class="text-muted d-block"><?= $this->escape(__('Procedimento seguido', 'glpiintegaglpi')); ?></small>
                                <?= $this->escape((string) ($contextAiQuality['procedure_followed'] ?? '-')); ?>
                            </div>
                            <div class="col-md-4">
                                <small class="text-muted d-block"><?= $this->escape(__('Risco de satisfação', 'glpiintegaglpi')); ?></small>
                                <?= $this->escape((string) ($contextAiQuality['client_satisfaction_risk'] ?? '-')); ?>
                            </div>
                            <div class="col-md-12">
                                <small class="text-muted d-block"><?= $this->escape(__('Notas sobre procedimento', 'glpiintegaglpi')); ?></small>
                                <?= $this->escape((string) ($contextAiQuality['procedure_notes'] ?? '-')); ?>
                            </div>
                            <div class="col-md-12">
                                <small class="text-muted d-block"><?= $this->escape(__('Qualidade de comunicação', 'glpiintegaglpi')); ?></small>
                                <?= $this->escape(__('Clareza', 'glpiintegaglpi')); ?>:
                                <?= (int) ($aiCommunicationQuality['clarity'] ?? 0); ?>/10 ·
                                <?= $this->escape(__('Empatia', 'glpiintegaglpi')); ?>:
                                <?= (int) ($aiCommunicationQuality['empathy'] ?? 0); ?>/10 ·
                                <?= $this->escape(__('Completude', 'glpiintegaglpi')); ?>:
                                <?= (int) ($aiCommunicationQuality['completeness'] ?? 0); ?>/10 ·
                                <?= $this->escape(__('Tom', 'glpiintegaglpi')); ?>:
                                <?= $this->escape((string) ($aiCommunicationQuality['tone'] ?? '-')); ?>
                            </div>
                            <div class="col-md-12">
                                <small class="text-muted d-block"><?= $this->escape(__('Artigos relacionados da Base GLPI', 'glpiintegaglpi')); ?></small>
                                <?php if ($aiRelatedKbArticles === []) { ?>
                                    <span class="text-muted"><?= $this->escape(__('Nenhum artigo relacionado informado pela análise.', 'glpiintegaglpi')); ?></span>
                                <?php } ?>
                                <?php foreach ($aiRelatedKbArticles as $article) { ?>
                                    <div class="small">
                                        <a href="<?= $this->escape((string) ($article['internal_url'] ?? '#')); ?>" target="_blank" rel="noopener noreferrer">
                                            <?= $this->escape((string) ($article['title'] ?? '')); ?>
                                        </a>
                                        · <?= $this->escape((string) ($article['category'] ?? '-')); ?>
                                        · <?= (int) ($article['relevance_score'] ?? 0); ?>%
                                        <span class="text-muted"><?= $this->escape((string) ($article['why_relevant'] ?? '')); ?></span>
                                    </div>
                                <?php } ?>
                            </div>
                            <div class="col-md-4">
                                <small class="text-muted d-block"><?= $this->escape(__('Insights principais', 'glpiintegaglpi')); ?></small>
                                <?= $this->escape($aiKeyInsights === [] ? '-' : implode('; ', $aiKeyInsights)); ?>
                            </div>
                            <div class="col-md-4">
                                <small class="text-muted d-block"><?= $this->escape(__('Melhorias sugeridas ao técnico', 'glpiintegaglpi')); ?></small>
                                <?= $this->escape($aiTechnicianImprovements === [] ? '-' : implode('; ', $aiTechnicianImprovements)); ?>
                            </div>
                            <div class="col-md-4">
                                <small class="text-muted d-block"><?= $this->escape(__('Recomendação ao supervisor', 'glpiintegaglpi')); ?></small>
                                <?= $this->escape($aiSupervisorRecommendation === [] ? '-' : implode('; ', $aiSupervisorRecommendation)); ?>
                            </div>
                        </div>

                        <?php if ($aiSupervisorEnabled) { ?>
                            <form method="post" action="<?= $this->escape(\GlpiPlugin\Integaglpi\Plugin::getAiQualityUrl()); ?>" class="row g-2 mt-2">
                                <?= \GlpiPlugin\Integaglpi\Plugin::renderCsrfToken(); ?>
                                <input type="hidden" name="action" value="feedback">
                                <input type="hidden" name="ticket_id" value="<?= (int) $ticket->getID(); ?>">
                                <input type="hidden" name="conversation_id" value="<?= $this->escape((string) ($contextConversation['conversation_id'] ?? '')); ?>">
                                <input type="hidden" name="analysis_id" value="<?= (int) ($contextAiQuality['id'] ?? 0); ?>">
                                <div class="col-md-3">
                                    <select class="form-select form-select-sm" name="feedback">
                                        <option value="useful"><?= $this->escape(__('Útil', 'glpiintegaglpi')); ?></option>
                                        <option value="not_useful"><?= $this->escape(__('Pouco útil', 'glpiintegaglpi')); ?></option>
                                        <option value="incorrect"><?= $this->escape(__('Incorreta', 'glpiintegaglpi')); ?></option>
                                    </select>
                                </div>
                                <div class="col-md-6">
                                    <input class="form-control form-control-sm" type="text" name="feedback_notes" maxlength="500" placeholder="<?= $this->escape(__('Observação opcional do supervisor', 'glpiintegaglpi')); ?>">
                                </div>
                                <div class="col-md-3">
                                    <button type="submit" class="btn btn-sm btn-outline-secondary">
                                        <?= $this->escape(__('Salvar feedback', 'glpiintegaglpi')); ?>
                                    </button>
                                </div>
                            </form>
                        <?php } ?>
                    <?php } else { ?>
                        <div class="text-muted mt-2">
                            <?= $this->escape(__('Nenhuma análise IA registrada para este chamado.', 'glpiintegaglpi')); ?>
                        </div>
                    <?php } ?>

                    <?php if ($aiSupervisorEnabled && $contextConversation !== null) { ?>
                        <form method="post" action="<?= $this->escape(\GlpiPlugin\Integaglpi\Plugin::getTicketActionUrl()); ?>" class="mt-3 js-integaglpi-ai-quality-analyze-form">
                            <?= \GlpiPlugin\Integaglpi\Plugin::renderCsrfToken(); ?>
                            <input type="hidden" name="whatsapp_action" value="analyze_conversation">
                            <input type="hidden" name="ticket_id" value="<?= (int) $ticket->getID(); ?>">
                            <input type="hidden" name="conversation_id" value="<?= $this->escape((string) ($contextConversation['conversation_id'] ?? '')); ?>">
                            <button type="button" class="btn btn-sm btn-outline-primary js-integaglpi-ai-quality-analyze-submit">
                                <?= $this->escape($contextAiQuality === null ? __('Analisar conversa', 'glpiintegaglpi') : __('Analisar novamente', 'glpiintegaglpi')); ?>
                            </button>
                            <span class="small text-muted ms-2 js-integaglpi-ai-quality-analyze-status"></span>
                        </form>
                    <?php } ?>
                </div>
            <?php } ?>

            <?php if ($contextConversation !== null && $contextRisk !== null) { ?>
                <?php $riskLevel = (string) ($contextRisk['risk_level'] ?? 'ok'); ?>
                <div class="border rounded p-3 mt-3">
                    <div class="d-flex align-items-center justify-content-between gap-2">
                        <div>
                            <div class="fw-bold">
                                <?= $this->escape(__('Risco operacional WhatsApp', 'glpiintegaglpi')); ?>
                            </div>
                            <div class="small text-muted">
                                <?= $this->escape((string) ($contextRisk['risk_reason'] ?? '')); ?>
                            </div>
                        </div>
                        <span class="badge bg-<?= $this->escape($riskBadge($riskLevel)); ?>">
                            <?= $this->escape((string) ($contextRisk['risk_label'] ?? 'Saudável')); ?>
                        </span>
                    </div>
                    <div class="small mt-2">
                        <?= $this->escape(__('Última interação WhatsApp', 'glpiintegaglpi')); ?>:
                        <?= $this->escape((string) ($contextRisk['last_interaction_age'] ?? '-')); ?>
                    </div>
                </div>
            <?php } ?>

            <?php if ($contextConversation !== null && $predictiveRiskScore !== null) { ?>
                <?php
                echo (new \GlpiPlugin\Integaglpi\Renderer\RiskScoreRenderer())->renderTicketBadge(
                    $predictiveRiskScore,
                    (int) $ticket->getID(),
                    (string) ($contextConversation['conversation_id'] ?? '')
                );
                ?>
            <?php } ?>

            <?php if ($contextWarnings !== []) { ?>
                <div class="mt-3">
                    <?php foreach ($contextWarnings as $warning) { ?>
                        <?php $level = is_array($warning) ? (string) ($warning['level'] ?? 'info') : 'info'; ?>
                        <div class="alert alert-<?= $this->escape($statusBadge($level)); ?> mb-2">
                            <?= $this->escape(is_array($warning) ? (string) ($warning['text'] ?? '') : ''); ?>
                        </div>
                    <?php } ?>
                </div>
            <?php } ?>

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

<?php
$auditPanelOk = $contextConversation !== null && $canViewTechnical;
if ($auditPanelOk) {
    ?>
    <div class="card mb-3">
        <div class="card-header"><?= $this->escape(__('Diagnostico tecnico', 'glpiintegaglpi')); ?></div>
        <div class="card-body">
            <div class="row g-3">
                <div class="col-md-4">
                    <small class="text-muted d-block"><?= $this->escape(__('Conversation ID', 'glpiintegaglpi')); ?></small>
                    <code><?= $this->escape($short((string) ($contextConversation['conversation_id'] ?? ''), 44)); ?></code>
                </div>
                <div class="col-md-4">
                    <small class="text-muted d-block"><?= $this->escape(__('Correlation ID', 'glpiintegaglpi')); ?></small>
                    <code><?= $this->escape($short($contextCorrelationId, 44)); ?></code>
                    <?php if ($contextCorrelationId !== '') { ?>
                        <button type="button" class="btn btn-link btn-sm p-0 ms-1 js-integaglpi-copy" data-copy="<?= $this->escape($contextCorrelationId); ?>">
                            <?= $this->escape(__('copiar', 'glpiintegaglpi')); ?>
                        </button>
                    <?php } ?>
                </div>
                <div class="col-md-4">
                    <small class="text-muted d-block"><?= $this->escape(__('Dead-letter', 'glpiintegaglpi')); ?></small>
                    <?php if ($contextDeadLetter !== null) { ?>
                        <span class="badge bg-danger"><?= $this->escape(__('Aberto', 'glpiintegaglpi')); ?></span>
                        <span class="text-muted small"><?= $this->escape((string) ($contextDeadLetter['operation_type'] ?? '')); ?></span>
                    <?php } else { ?>
                        <span class="badge bg-success"><?= $this->escape(__('Sem aberto', 'glpiintegaglpi')); ?></span>
                    <?php } ?>
                </div>
            </div>

            <div class="d-flex flex-wrap gap-2 mt-3">
                <a class="btn btn-sm btn-outline-secondary" href="<?= $this->escape($this->getAuditUrlForTicket((int) $ticket->getID())); ?>" target="_blank" rel="noopener noreferrer">
                    <?= $this->escape(__('Ver Auditoria deste Ticket', 'glpiintegaglpi')); ?>
                </a>
                <?php if ($contextCorrelationId !== '') { ?>
                    <a class="btn btn-sm btn-outline-secondary" href="<?= $this->escape($this->getAuditUrlForCorrelation($contextCorrelationId)); ?>" target="_blank" rel="noopener noreferrer">
                        <?= $this->escape(__('Ver Auditoria deste correlation_id', 'glpiintegaglpi')); ?>
                    </a>
                <?php } ?>
                <a class="btn btn-sm btn-outline-secondary" href="<?= $this->escape($this->getOperationalHealthUrl()); ?>" target="_blank" rel="noopener noreferrer">
                    <?= $this->escape(__('Ver painel de Auditoria e Saude', 'glpiintegaglpi')); ?>
                </a>
            </div>
        </div>
    </div>

    <div class="card mb-3">
        <div class="card-header">
            <?= $this->escape(__('Ultimos eventos operacionais da conversa mais recente', 'glpiintegaglpi')); ?>
        </div>
        <div class="card-body p-0">
            <table class="table table-sm table-hover mb-0">
                <thead class="table-light">
                    <tr>
                        <th><?= $this->escape(__('Criado em', 'glpiintegaglpi')); ?></th>
                        <th><?= $this->escape(__('Evento', 'glpiintegaglpi')); ?></th>
                        <th><?= $this->escape(__('Status', 'glpiintegaglpi')); ?></th>
                        <th><?= $this->escape(__('Severity', 'glpiintegaglpi')); ?></th>
                        <th><?= $this->escape(__('Erro', 'glpiintegaglpi')); ?></th>
                    </tr>
                </thead>
                <tbody>
                <?php if ($contextEvents === []) { ?>
                    <tr>
                        <td colspan="5" class="text-center text-muted p-3">
                            <?= $this->escape(__('Sem dados', 'glpiintegaglpi')); ?>
                        </td>
                    </tr>
                <?php } ?>
                <?php foreach ($contextEvents as $event) { ?>
                    <tr>
                        <td><?= $this->escape((string) ($event['created_at'] ?? '')); ?></td>
                        <td><?= $this->escape((string) ($event['event_type'] ?? '')); ?></td>
                        <td><?= $this->escape((string) ($event['status'] ?? '')); ?></td>
                        <td><?= $this->escape((string) ($event['severity'] ?? '')); ?></td>
                        <td><?= $this->escape((string) ($event['error_summary'] ?? '')); ?></td>
                    </tr>
                <?php } ?>
                </tbody>
            </table>
        </div>
    </div>

    <script>
    (function () {
        document.addEventListener('click', function (event) {
            var button = event.target.closest('.js-integaglpi-copy');
            if (!button || !navigator.clipboard) {
                return;
            }
            event.preventDefault();
            navigator.clipboard.writeText(button.getAttribute('data-copy') || '');
        });
    }());
    </script>
    <?php
}
?>
<?php } ?>

<?php if ($tabView === 'conversations') { ?>
<?php if ($isExternalConfigured && $runtime !== null && \GlpiPlugin\Integaglpi\Plugin::canUpdate()) { ?>
    <div class="row g-3 mb-3">
        <?php
        $actionBaseUrl = \GlpiPlugin\Integaglpi\Plugin::getTicketActionUrl();
        $ticketIdForDebug = (int) $ticket->getID();
        $conversationIdForDebug = (string) ($runtime['conversation_id'] ?? '');
        ?>
        <?php if ($canClaim) { ?>
            <div class="col-md-4">
                <div class="card h-100">
                    <div class="card-header"><?= $this->escape(__('Assume attendance', 'glpiintegaglpi')); ?></div>
                    <div class="card-body">
                        <form method="post" action="<?= $this->escape($actionBaseUrl); ?>" class="mb-0 js-integaglpi-critical-action-form">
                            <?= \GlpiPlugin\Integaglpi\Plugin::renderCsrfToken(); ?>
                            <input type="hidden" name="ticket_id" value="<?= (int) $ticketIdForDebug; ?>">
                            <input type="hidden" name="conversation_id" value="<?= $this->escape($conversationIdForDebug); ?>">
                            <input type="hidden" name="whatsapp_action" value="claim">
                            <button type="submit" class="btn btn-primary" data-loading-text="<?= $this->escape(__('Processando...', 'glpiintegaglpi')); ?>">
                                <?= $this->escape($assignedUserId > 0
                                    ? __('Assumir para mim', 'glpiintegaglpi')
                                    : __('Assumir atendimento', 'glpiintegaglpi')); ?>
                            </button>
                        </form>
                    </div>
                </div>
            </div>
        <?php } ?>
        <?php if (!$canClaim && $claimBlockReason !== '') { ?>
            <div class="col-md-4">
                <div class="alert alert-warning h-100 mb-0">
                    <?= $this->escape($claimBlockReason); ?>
                </div>
            </div>
        <?php } ?>

        <?php if ($canTransfer) { ?>
            <div class="col-md-4">
                <div class="card h-100">
                    <div class="card-header"><?= $this->escape(__('Transfer queue', 'glpiintegaglpi')); ?></div>
                    <div class="card-body">
                        <form method="post" action="<?= $this->escape($actionBaseUrl); ?>" class="mb-0 js-integaglpi-critical-action-form">
                            <?= \GlpiPlugin\Integaglpi\Plugin::renderCsrfToken(); ?>
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
                            <button type="submit" class="btn btn-outline-primary" data-loading-text="<?= $this->escape(__('Processando...', 'glpiintegaglpi')); ?>"><?= $this->escape(__('Transferir', 'glpiintegaglpi')); ?></button>
                        </form>
                    </div>
                </div>
            </div>
        <?php } ?>

        <?php if ($canClose) { ?>
            <div class="col-md-4">
                <div class="card h-100">
                    <div class="card-header"><?= $this->escape(__('Close conversation', 'glpiintegaglpi')); ?></div>
                    <div class="card-body">
                        <form method="post" action="<?= $this->escape($actionBaseUrl); ?>" class="mb-0 js-integaglpi-critical-action-form">
                            <?= \GlpiPlugin\Integaglpi\Plugin::renderCsrfToken(); ?>
                            <input type="hidden" name="ticket_id" value="<?= (int) $ticketIdForDebug; ?>">
                            <input type="hidden" name="conversation_id" value="<?= $this->escape((string) $conversationIdForDebug); ?>">
                            <input type="hidden" name="whatsapp_action" value="close">
                            <button type="submit" class="btn btn-outline-danger" data-loading-text="<?= $this->escape(__('Processando...', 'glpiintegaglpi')); ?>"><?= $this->escape(__('Encerrar conversa', 'glpiintegaglpi')); ?></button>
                        </form>
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
                        <form method="post" action="<?= $this->escape($actionBaseUrl); ?>" class="mb-0 js-integaglpi-critical-action-form">
                            <?= \GlpiPlugin\Integaglpi\Plugin::renderCsrfToken(); ?>
                            <input type="hidden" name="ticket_id" value="<?= (int) $ticketIdForDebug; ?>">
                            <input type="hidden" name="conversation_id" value="<?= $this->escape((string) $conversationIdForDebug); ?>">
                            <input type="hidden" name="whatsapp_action" value="reopen">
                            <button type="submit" class="btn btn-outline-primary" data-loading-text="<?= $this->escape(__('Processando...', 'glpiintegaglpi')); ?>"><?= $this->escape(__('Reabrir atendimento', 'glpiintegaglpi')); ?></button>
                        </form>
                    </div>
                </div>
            </div>
        <?php } ?>
    </div>
<?php } ?>

<div class="card">
    <div class="card-header"><?= $this->escape(__('Conversas WhatsApp', 'glpiintegaglpi')); ?></div>
    <div class="card-body">
        <?php if (!$isExternalConfigured) { ?>
            <p class="mb-0 text-muted"><?= $this->escape(__('The timeline becomes available after configuring the external PostgreSQL connection.', 'glpiintegaglpi')); ?></p>
        <?php } elseif ($runtime === null) { ?>
            <div class="alert alert-info">
                <?= $this->escape(__('Este chamado ainda não está vinculado a uma conversa WhatsApp.', 'glpiintegaglpi')); ?>
            </div>
            <?php if (\GlpiPlugin\Integaglpi\Plugin::canUpdate()) { $renderManualWhatsappStart(); } ?>
        <?php } elseif ($messages === []) { ?>
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
                            <?php
                            $mediaInfo = is_array($message['media_info'] ?? null) ? $message['media_info'] : [];
                            $hasAttachment = $mediaInfo !== []
                                || trim((string) ($message['attachment_hash'] ?? '')) !== ''
                                || trim((string) ($message['attachment_status'] ?? '')) !== '';
                            $attachmentStatus = (bool) ($message['is_deleted'] ?? false)
                                ? 'deleted'
                                : ($attachmentMediaValue($message, 'attachment_status')
                                    ?: trim((string) ($mediaInfo['status'] ?? '')));
                            $attachmentStatus = $attachmentStatus !== '' ? $attachmentStatus : 'received';
                            $attachmentFilename = $attachmentMediaValue($message, 'attachment_filename_sanitized')
                                ?: trim((string) ($mediaInfo['file_name'] ?? $mediaInfo['filename'] ?? ''));
                            $attachmentMime = $attachmentMediaValue($message, 'attachment_mime_detected')
                                ?: trim((string) ($mediaInfo['mime_type'] ?? ''));
                            $attachmentReason = $attachmentMediaValue($message, 'attachment_blocked_reason')
                                ?: trim((string) ($mediaInfo['error'] ?? ''));
                            $attachmentHash = $attachmentMediaValue($message, 'attachment_hash');
                            $attachmentSize = (int) ($message['attachment_size_bytes'] ?? $mediaInfo['attachment_size_bytes'] ?? $mediaInfo['file_size'] ?? 0);
                            $attachmentSizeLabel = $attachmentSize > 0
                                ? ($attachmentSize < 1048576 ? round($attachmentSize / 1024, 1) . ' KB' : round($attachmentSize / 1048576, 1) . ' MB')
                                : '';
                            ?>
                            <?php if ($hasAttachment) { ?>
                                <div class="mt-2 p-2 rounded border bg-white" style="font-size: .72rem;">
                                    <div class="d-flex align-items-center justify-content-between gap-2 flex-wrap">
                                        <strong><?= $this->escape($attachmentFilename !== '' ? $attachmentFilename : __('Anexo WhatsApp', 'glpiintegaglpi')); ?></strong>
                                        <span class="badge bg-<?= $this->escape($attachmentStatusBadge($attachmentStatus)); ?>">
                                            <?= $this->escape($attachmentStatusLabel($attachmentStatus)); ?>
                                        </span>
                                    </div>
                                    <div class="text-muted mt-1">
                                        <?php if ($attachmentMime !== '') { ?>
                                            <?= $this->escape($attachmentMime); ?>
                                        <?php } ?>
                                        <?php if ($attachmentSizeLabel !== '') { ?>
                                            <?= $attachmentMime !== '' ? ' · ' : ''; ?><?= $this->escape($attachmentSizeLabel); ?>
                                        <?php } ?>
                                        <?php if ($attachmentHash !== '') { ?>
                                            <?= ($attachmentMime !== '' || $attachmentSizeLabel !== '') ? ' · ' : ''; ?>
                                            SHA256 <?= $this->escape($shortHash($attachmentHash)); ?>
                                        <?php } ?>
                                    </div>
                                    <?php if ($attachmentReason !== '' && in_array($attachmentStatus, ['blocked', 'failed', 'deleted'], true)) { ?>
                                        <div class="text-danger mt-1">
                                            <?= $this->escape(__('Motivo', 'glpiintegaglpi')); ?>:
                                            <?= $this->escape($attachmentReason); ?>
                                        </div>
                                    <?php } ?>
                                </div>
                            <?php } ?>
                            <?php if (!$isInbound && !empty($message['delivery_status'])) { ?>
                                <?php
                                $deliveryStatus = (string) $message['delivery_status'];
                                $deliveryLabel = \GlpiPlugin\Integaglpi\Service\TicketContextService::deliveryStatusLabel($deliveryStatus);
                                $deliveryColor = $deliveryStatus === 'failed' ? '#946200' : '#6c757d';
                                ?>
                                <div style="font-size: .65rem; color: <?= $deliveryColor; ?>; margin-top: 4px;">
                                    <?= $this->escape(__('Status WhatsApp', 'glpiintegaglpi')); ?>:
                                    <?= $this->escape($deliveryLabel !== '' ? $deliveryLabel : $deliveryStatus); ?>
                                    <?php if ($deliveryStatus === 'failed' && !empty($message['meta_error_message_sanitized'])) { ?>
                                        - <?= $this->escape((string) $message['meta_error_message_sanitized']); ?>
                                    <?php } ?>
                                </div>
                            <?php } ?>
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

<?php
// Phase: integaglpi_ops_console_claim_ui_messaging_stabilization_001.
// Lightweight polling for the ticket WhatsApp tab. Calls central.messages.php
// every ~12s using after_id to fetch ONLY new messages. When new messages
// arrive a non-intrusive banner appears; user clicks to refresh the tab.
// We never auto-reload to avoid losing the technician's draft reply.
if ($isExternalConfigured && $runtime !== null && !$isClosed) {
    $pollingConversationId = (string) ($runtime['conversation_id'] ?? '');
    $pollingTicketId = (int) $ticket->getID();
    $pollingMessagesUrl = rtrim((string) ($CFG_GLPI['root_doc'] ?? ''), '/')
        . '/plugins/integaglpi/front/central.messages.php';
    $pollingLastId = '';
    if (!empty($messages)) {
        $lastMessage = $messages[count($messages) - 1];
        $pollingLastId = (string) ($lastMessage['id'] ?? $lastMessage['message_id'] ?? '');
    }
    if ($pollingConversationId !== '' && $pollingTicketId > 0) {
        ?>
        <div class="alert alert-info mt-2 mb-0 d-none js-integaglpi-ticket-poll-banner" role="alert">
            <span class="js-integaglpi-ticket-poll-text"><?= $this->escape(__('Novas mensagens recebidas. Atualize para visualizar.', 'glpiintegaglpi')); ?></span>
            <button type="button" class="btn btn-sm btn-outline-primary ms-2 js-integaglpi-ticket-poll-refresh">
                <?= $this->escape(__('Atualizar', 'glpiintegaglpi')); ?>
            </button>
        </div>
        <script>
        (function () {
            var pollingEndpoint = <?= json_encode($pollingMessagesUrl, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE); ?>;
            var conversationId = <?= json_encode($pollingConversationId, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE); ?>;
            var ticketId = <?= (int) $pollingTicketId; ?>;
            var lastId = <?= json_encode($pollingLastId, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE); ?>;
            var pollIntervalMs = 12000;
            var pollHandle = null;
            var banner = document.querySelector('.js-integaglpi-ticket-poll-banner');
            var refreshBtn = document.querySelector('.js-integaglpi-ticket-poll-refresh');
            var bannerText = document.querySelector('.js-integaglpi-ticket-poll-text');
            if (!banner || !refreshBtn) {
                return;
            }
            refreshBtn.addEventListener('click', function () {
                window.location.reload();
            });

            function buildUrl(after) {
                var params = new URLSearchParams({
                    conversation_id: conversationId,
                    ticket_id: String(ticketId),
                    limit: '20'
                });
                if (after) {
                    params.set('after_id', after);
                }
                return pollingEndpoint + '?' + params.toString();
            }

            function tick() {
                if (document.hidden) {
                    return; // pause polling when the tab is in background
                }
                fetch(buildUrl(lastId), {
                    method: 'GET',
                    credentials: 'same-origin',
                    headers: { 'Accept': 'application/json' }
                }).then(function (response) {
                    if (!response.ok) {
                        return null;
                    }
                    return response.json();
                }).then(function (data) {
                    if (!data || data.ok !== true) {
                        return;
                    }
                    var messages = Array.isArray(data.messages) ? data.messages : [];
                    if (messages.length === 0) {
                        return;
                    }
                    // Update tracking id; show banner once.
                    var latest = messages[messages.length - 1];
                    if (latest && latest.id) {
                        lastId = String(latest.id);
                    }
                    banner.classList.remove('d-none');
                    if (bannerText) {
                        var count = messages.length;
                        var template = <?= json_encode(__('Novas mensagens recebidas (%d). Atualize para visualizar.', 'glpiintegaglpi'), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE); ?>;
                        bannerText.textContent = template.replace('%d', String(count));
                    }
                }).catch(function () {
                    // Silent — polling errors must not disrupt the page.
                });
            }

            function start() {
                if (pollHandle !== null) {
                    return;
                }
                pollHandle = window.setInterval(tick, pollIntervalMs);
            }
            function stop() {
                if (pollHandle !== null) {
                    window.clearInterval(pollHandle);
                    pollHandle = null;
                }
            }

            document.addEventListener('visibilitychange', function () {
                if (document.hidden) {
                    stop();
                } else {
                    start();
                }
            });
            window.addEventListener('beforeunload', stop);
            start();
        })();
        </script>
        <?php
    }
}
?>

<?php if ($isExternalConfigured && $runtime !== null && $isClosed) { ?>
    <div class="alert alert-warning mt-3 mb-0 d-flex align-items-start gap-2">
        <span style="font-size: 1.1rem;">&#128274;</span>
        <div>
            <strong><?= $this->escape(__('Conversa encerrada', 'glpiintegaglpi')); ?></strong><br>
            <?= $this->escape(__('Esta conversa está encerrada. Para responder, reabra ou inicie um novo atendimento.', 'glpiintegaglpi')); ?>
        </div>
    </div>
<?php } ?>

<?php if ($isExternalConfigured && $runtime !== null && !$isClosed && \GlpiPlugin\Integaglpi\Plugin::canUpdate() && !$replyOwnedByCurrentUser) { ?>
    <div class="alert alert-warning mt-3 mb-0 js-integaglpi-ticket-reply-owner-gate">
        <strong><?= $this->escape(__('Resposta bloqueada', 'glpiintegaglpi')); ?></strong><br>
        <?= $this->escape($replyBlockedReason); ?>
    </div>
<?php } ?>

<?php
$smartHelpReadGateTicketId = (int) $ticket->getID();
$smartHelpReadGateCsrf     = \GlpiPlugin\Integaglpi\Plugin::getCsrfToken();
$smartHelpReadGateVisible  = $isExternalConfigured
    && $runtime !== null
    && \GlpiPlugin\Integaglpi\Service\SmartHelpService::canViewPanel()
    && (!\GlpiPlugin\Integaglpi\Plugin::canUpdate() || !$replyOwnedByCurrentUser);
?>
<?php if ($smartHelpReadGateVisible) { ?>
    <div class="border rounded p-3 mt-3 mb-3 integaglpi-smart-help"
         data-ticket-id="<?= (int) $smartHelpReadGateTicketId; ?>"
         data-conversation-id="<?= $this->escape((string) ($runtime['conversation_id'] ?? '')); ?>"
         data-context-updated-at="<?= $this->escape((string) ($ticket->fields['date_mod'] ?? $ticket->fields['date'] ?? '')); ?>"
         data-action-url="<?= $this->escape(\GlpiPlugin\Integaglpi\Plugin::getWebBasePath() . '/front/smart.help.php'); ?>"
         data-csrf="<?= $this->escape($smartHelpReadGateCsrf); ?>">
        <div class="d-flex justify-content-between align-items-center gap-2 flex-wrap mb-2">
            <strong><i class="ti ti-bulb me-1"></i><?= $this->escape(__('Ajuda Inteligente', 'glpiintegaglpi')); ?></strong>
            <div class="d-flex gap-2 flex-wrap">
                <button type="button" class="btn btn-sm btn-primary js-smart-help-summarize">
                    <i class="ti ti-list-details me-1"></i><?= $this->escape(__('Resumo do chamado', 'glpiintegaglpi')); ?>
                </button>
                <button type="button" class="btn btn-sm btn-outline-primary js-smart-help-local-search" disabled>
                    <i class="ti ti-search me-1"></i><?= $this->escape(__('Busca local', 'glpiintegaglpi')); ?>
                </button>
                <button type="button" class="btn btn-sm btn-outline-warning js-smart-help-external" disabled>
                    <i class="ti ti-cloud-search me-1"></i><?= $this->escape(__('Pedir ajuda externa (nuvem)', 'glpiintegaglpi')); ?>
                </button>
                <span class="badge bg-secondary js-smart-help-status"><?= $this->escape(__('pronto', 'glpiintegaglpi')); ?></span>
            </div>
        </div>
        <div class="text-muted small mb-2">
            <?= $this->escape(__('Processo guiado somente leitura: gere o resumo, execute a busca local e só depois peça ajuda externa se necessário. Nada é enviado ao cliente nem altera o chamado automaticamente.', 'glpiintegaglpi')); ?>
        </div>
        <div class="row g-2 align-items-end mb-2">
            <div class="col-md-7">
                <label class="form-label small mb-1">
                    <?= $this->escape(__('IA para pesquisa externa', 'glpiintegaglpi')); ?>
                </label>
                <select class="form-select form-select-sm js-smart-help-provider">
                    <option value="disabled|" selected><?= $this->escape(__('Carregando providers seguros...', 'glpiintegaglpi')); ?></option>
                </select>
            </div>
            <div class="col-md-5">
                <div class="form-text js-smart-help-provider-help">
                    <?= $this->escape(__('Cloud exige consentimento e PII Guard.', 'glpiintegaglpi')); ?>
                </div>
            </div>
        </div>
        <div class="mb-2">
            <label class="form-label small mb-1" for="smart-help-summary-ro-<?= (int) $smartHelpReadGateTicketId; ?>">
                <?= $this->escape(__('Resumo técnico sem dados pessoais', 'glpiintegaglpi')); ?>
            </label>
            <textarea
                class="form-control form-control-sm js-smart-help-technical-summary"
                id="smart-help-summary-ro-<?= (int) $smartHelpReadGateTicketId; ?>"
                rows="2"
            ></textarea>
            <div class="form-text js-smart-help-schema-status">
                <?= $this->escape(__('Aguardando validação local da KB e schema 044.', 'glpiintegaglpi')); ?>
            </div>
        </div>
        <div class="js-smart-help-articles small"></div>
        <div class="row g-2 mt-1">
            <div class="col-md-6">
                <div class="fw-bold small"><?= $this->escape(__('Checklist de diagnóstico', 'glpiintegaglpi')); ?></div>
                <ul class="small mb-0 js-smart-help-checklist"></ul>
            </div>
            <div class="col-md-6">
                <div class="fw-bold small"><?= $this->escape(__('Perguntas sugeridas ao cliente', 'glpiintegaglpi')); ?></div>
                <ul class="small mb-0 list-unstyled js-smart-help-questions"></ul>
            </div>
        </div>
        <div class="mt-2 js-smart-help-local-suggestion"></div>
        <div class="mt-2 js-smart-help-history"></div>
        <div class="mt-2 js-smart-help-cloud"></div>
        <div class="mt-2 small js-smart-help-message text-muted"></div>
        <div class="form-text mt-1">
            <?= $this->escape(__('Somente leitura: nada é enviado ao cliente nem altera o chamado automaticamente. Publicação na KB é manual.', 'glpiintegaglpi')); ?>
        </div>
    </div>
<?php } ?>

<?php if ($isExternalConfigured && $runtime !== null && !$isClosed && \GlpiPlugin\Integaglpi\Plugin::canUpdate() && $replyOwnedByCurrentUser) { ?>
    <?php
    $replyTicketId = (int) $ticket->getID();
    $replyConvId   = (string) ($runtime['conversation_id'] ?? '');
    $replyPostUrl  = rtrim($CFG_GLPI['root_doc'] ?? '', '/')
        . '/plugins/integaglpi/front/ticket.whatsapp.reply.php';
    $copilotPostUrl = rtrim($CFG_GLPI['root_doc'] ?? '', '/')
        . '/plugins/integaglpi/front/copilot.draft.php';
    $assistantExternalQuery = trim((string) ($aiAssistantKnowledge['ticket_summary_for_research'] ?? $aiAssistantKnowledge['query'] ?? ''));
    $assistantExternalUrl = \GlpiPlugin\Integaglpi\Plugin::getExternalResearchUrl()
        . ($assistantExternalQuery !== '' ? '?' . http_build_query(['q' => $assistantExternalQuery]) : '');
    $assistantExternalAvailable = \GlpiPlugin\Integaglpi\Plugin::canExternalResearchRead()
        && (string) ($aiAssistantExternal['status'] ?? '') === 'available';
    $replyCsrfToken = \GlpiPlugin\Integaglpi\Plugin::getCsrfToken();
    $replyDomId    = 'integaglpi-reply-' . $replyTicketId;
    $historicalMiningUrl = rtrim($CFG_GLPI['root_doc'] ?? '', '/')
        . '/plugins/integaglpi/front/historical.mining.php';
    // Read latest accepted ticket solution for "Criar candidato KB da solução" form (manual, no auto-publish).
    $solutionText = '';
    $solutionTitle = (string) ($ticket->fields['name'] ?? '');
    if (isset($DB) && is_object($DB)) {
        foreach ($DB->request([
            'SELECT' => ['content'],
            'FROM' => 'glpi_itilsolutions',
            'WHERE' => ['itemtype' => 'Ticket', 'items_id' => $replyTicketId],
            'ORDER' => 'date_creation DESC',
            'LIMIT' => 1,
        ]) as $solRow) {
            $solutionText = trim(strip_tags((string) ($solRow['content'] ?? '')));
            break;
        }
    }
    $solutionText = (string) preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/', '', $solutionText);
    $solutionText = mb_substr($solutionText, 0, 2000);
    // Phase 7.4C regression fix: previous version used window.location.href to a GET
    // endpoint (debug_get=1). 7.4C blocked GET on ticket.whatsapp.reply.php with HTTP 405,
    // so the WhatsApp tab needs to POST through fetch with CSRF, like the Central does.
    ?>
    <div class="card mt-3" id="<?= $this->escape($replyDomId); ?>" data-reply-card="1">
        <div class="card-header"><?= $this->escape(__('Responder cliente', 'glpiintegaglpi')); ?></div>
        <div class="card-body">
            <?php // Phase: integaglpi_ops_console_claim_ui_messaging_stabilization_001 — Assistente IA stays deferred and is appended below reply + Copiloto using data-ai-assistant-position="below-reply". ?>
            <div class="border rounded p-3 mb-3 bg-white js-integaglpi-ticket-ai-assistant" data-ai-assistant-position="below-reply" data-ai-assistant-render="deferred" hidden>
                <div class="d-flex justify-content-between align-items-start gap-2 flex-wrap mb-2">
                    <div>
                        <strong><?= $this->escape(__('Assistente IA', 'glpiintegaglpi')); ?></strong>
                        <div class="text-muted small">
                            <?= $this->escape(__('Fluxo local-first: consulte KB local, gere rascunho revisável e use pesquisa externa somente por clique manual.', 'glpiintegaglpi')); ?>
                        </div>
                    </div>
                    <span class="badge bg-light text-dark border"><?= $this->escape(__('noAutoSend=true', 'glpiintegaglpi')); ?></span>
                </div>
                <div class="row g-2">
                    <div class="col-lg-4">
                        <div class="border rounded p-2 h-100">
                            <div class="d-flex justify-content-between align-items-center gap-2">
                                <strong class="small"><?= $this->escape(__('Base de Conhecimento Local', 'glpiintegaglpi')); ?></strong>
                                <button type="button" class="btn btn-sm btn-outline-primary js-integaglpi-kb-local-focus">
                                    <?= $this->escape(__('Consultar KB Local', 'glpiintegaglpi')); ?>
                                </button>
                            </div>
                            <div class="small text-muted mt-1"><?= $this->escape((string) ($aiAssistantKnowledge['message'] ?? '')); ?></div>
                            <?php if ($aiAssistantKnowledgeItems !== []) { ?>
                                <ul class="list-unstyled small mt-2 mb-0 js-integaglpi-kb-local-results">
                                    <?php foreach ($aiAssistantKnowledgeItems as $item) {
                                        if (!is_array($item)) {
                                            continue;
                                        }
                                        $itemUrl = trim((string) ($item['internal_url'] ?? ''));
                                        ?>
                                        <li class="mb-2">
                                            <span class="badge bg-light text-dark border"><?= $this->escape((string) ($item['origin'] ?? 'interno')); ?></span>
                                            <?php if ($itemUrl !== '') { ?>
                                                <a href="<?= $this->escape($itemUrl); ?>" target="_blank" rel="noopener"><?= $this->escape((string) ($item['title'] ?? '')); ?></a>
                                            <?php } else { ?>
                                                <strong><?= $this->escape((string) ($item['title'] ?? '')); ?></strong>
                                            <?php } ?>
                                            <div class="text-muted"><?= $this->escape((string) ($item['excerpt'] ?? '')); ?></div>
                                        </li>
                                    <?php } ?>
                                </ul>
                            <?php } else { ?>
                                <div class="text-muted small mt-2"><?= $this->escape(__('Sem resultado local suficiente para este chamado.', 'glpiintegaglpi')); ?></div>
                            <?php } ?>
                        </div>
                    </div>
                    <div class="col-lg-4">
                        <div class="border rounded p-2 h-100">
                            <strong class="small d-block"><?= $this->escape(__('Rascunho Técnico', 'glpiintegaglpi')); ?></strong>
                            <div class="small text-muted mb-2">
                                <?= $this->escape(__('O Copiloto usa contexto sanitizado e referências locais. O técnico revisa e envia manualmente.', 'glpiintegaglpi')); ?>
                            </div>
                            <div class="small mb-2">
                                <?= $this->escape(__('Rascunho técnico:', 'glpiintegaglpi')); ?>
                                <code><?= $this->escape((string) ($aiAssistantCopilot['provider'] ?? 'disabled')); ?></code>
                                /
                                <code><?= $this->escape((string) ($aiAssistantCopilot['model'] ?? '')); ?></code>
                                <span class="badge bg-light text-dark border">
                                    <?= $this->escape((string) ($aiAssistantCopilot['origin_label'] ?? '[Fallback local - provider desabilitado]')); ?>
                                </span>
                            </div>
                            <button type="button" class="btn btn-sm btn-outline-primary js-integaglpi-copilot-generate" data-tone="neutral">
                                <?= $this->escape(__('Gerar rascunho com IA', 'glpiintegaglpi')); ?>
                            </button>
                        </div>
                    </div>
                    <div class="col-lg-4">
                        <div class="border rounded p-2 h-100">
                            <strong class="small d-block"><?= $this->escape(__('Pesquisa Externa', 'glpiintegaglpi')); ?></strong>
                            <div class="small text-muted mb-2">
                                <?= $this->escape(__('Pesquisa externa exige preview anonimizado, fontes allowlisted e não preenche resposta automaticamente.', 'glpiintegaglpi')); ?>
                            </div>
                            <?php if ($assistantExternalAvailable) { ?>
                                <a class="btn btn-sm btn-outline-secondary" href="<?= $this->escape($assistantExternalUrl); ?>" target="_blank" rel="noopener">
                                    <?= $this->escape(__('Pesquisar fora', 'glpiintegaglpi')); ?>
                                </a>
                            <?php } else { ?>
                                <button type="button" class="btn btn-sm btn-outline-secondary" disabled>
                                    <?= $this->escape(__('Pesquisar fora', 'glpiintegaglpi')); ?>
                                </button>
                                <div class="small text-muted mt-1">
                                    <?= $this->escape(__('Bloqueada:', 'glpiintegaglpi')); ?>
                                    <code><?= $this->escape((string) ($aiAssistantExternal['blocked_reason'] ?? 'feature_flag_disabled')); ?></code>
                                </div>
                            <?php } ?>
                            <?php if ($solutionText !== '') { ?>
                                <form method="post" action="<?= $this->escape($historicalMiningUrl); ?>" target="_blank" class="mt-1">
                                    <input type="hidden" name="_glpi_csrf_token" value="<?= $this->escape($replyCsrfToken); ?>">
                                    <input type="hidden" name="action" value="create_kb_from_solution">
                                    <input type="hidden" name="ticket_id" value="<?= (int) $replyTicketId; ?>">
                                    <input type="hidden" name="solution_text" value="<?= $this->escape(mb_substr($solutionText, 0, 2000)); ?>">
                                    <input type="hidden" name="ticket_title" value="<?= $this->escape(mb_substr($solutionTitle, 0, 120)); ?>">
                                    <button type="submit" class="btn btn-sm btn-outline-success">
                                        <?= $this->escape(__('Criar candidato KB da solução', 'glpiintegaglpi')); ?>
                                    </button>
                                </form>
                            <?php } ?>
                            <div class="small text-muted mt-2">
                                <?= $this->escape((string) ($aiAssistantP4['message'] ?? __('P4 permanece manual na tela de Mineração Histórica.', 'glpiintegaglpi'))); ?>
                            </div>
                            <div class="small text-muted mt-1">
                                <?= $this->escape(__('Solução aceita ou pesquisa aprovada pode virar candidato KB revisável; publicação continua manual.', 'glpiintegaglpi')); ?>
                            </div>
                        </div>
                    </div>
                </div>
                <small class="js-integaglpi-kb-local-status text-muted d-block mt-2"></small>
            </div>
            <textarea
                class="form-control mb-2 js-integaglpi-tab-reply-text"
                rows="3"
                maxlength="4096"
                placeholder="<?= $this->escape(__('Digite a mensagem para enviar ao cliente via WhatsApp...', 'glpiintegaglpi')); ?>"
            ></textarea>
            <div class="mb-2">
                <label class="form-label small mb-1" for="<?= $this->escape($replyDomId); ?>-file">
                    <?= $this->escape(__('Anexo opcional', 'glpiintegaglpi')); ?>
                </label>
                <input
                    type="file"
                    class="form-control form-control-sm js-integaglpi-tab-reply-file"
                    id="<?= $this->escape($replyDomId); ?>-file"
                    accept="application/pdf,image/jpeg,image/png,image/gif"
                >
                <small class="text-muted">
                    <?= $this->escape(__('PDF e imagens suportadas serão enviados como arquivo real pelo WhatsApp.', 'glpiintegaglpi')); ?>
                </small>
            </div>
            <div class="d-flex gap-2 align-items-center">
                <button
                    type="button"
                    class="btn btn-success js-integaglpi-tab-reply-send"
                    data-ticket-id="<?= $replyTicketId; ?>"
                    data-conversation-id="<?= $this->escape($replyConvId); ?>"
                ><?= $this->escape(__('Enviar resposta', 'glpiintegaglpi')); ?></button>
                <small class="text-muted js-integaglpi-tab-reply-feedback"></small>
            </div>
            <?php /* ── Ajuda Inteligente (IA/KB local-first) — read-only, no ticket mutation ── */ ?>
            <?php if (\GlpiPlugin\Integaglpi\Service\SmartHelpService::canViewPanel()) { ?>
                <div class="border rounded p-3 mt-3 mb-3 integaglpi-smart-help"
                     data-ticket-id="<?= (int) $replyTicketId; ?>"
                     data-conversation-id="<?= $this->escape($replyConvId); ?>"
                     data-context-updated-at="<?= $this->escape((string) ($ticket->fields['date_mod'] ?? $ticket->fields['date'] ?? '')); ?>"
                     data-action-url="<?= $this->escape(\GlpiPlugin\Integaglpi\Plugin::getWebBasePath() . '/front/smart.help.php'); ?>"
                     data-csrf="<?= $this->escape($replyCsrfToken); ?>">
                    <div class="d-flex justify-content-between align-items-center gap-2 flex-wrap mb-2">
                        <strong><i class="ti ti-bulb me-1"></i><?= $this->escape(__('Ajuda Inteligente', 'glpiintegaglpi')); ?></strong>
                        <div class="d-flex gap-2 flex-wrap">
                            <button type="button" class="btn btn-sm btn-primary js-smart-help-summarize">
                                <i class="ti ti-list-details me-1"></i><?= $this->escape(__('Resumo do chamado', 'glpiintegaglpi')); ?>
                            </button>
                            <button type="button" class="btn btn-sm btn-outline-primary js-smart-help-local-search" disabled>
                                <i class="ti ti-search me-1"></i><?= $this->escape(__('Busca local', 'glpiintegaglpi')); ?>
                            </button>
                            <button type="button" class="btn btn-sm btn-outline-warning js-smart-help-external" disabled>
                                <i class="ti ti-cloud-search me-1"></i><?= $this->escape(__('Pedir ajuda externa (nuvem)', 'glpiintegaglpi')); ?>
                            </button>
                            <span class="badge bg-secondary js-smart-help-status"><?= $this->escape(__('pronto', 'glpiintegaglpi')); ?></span>
                        </div>
                    </div>
                    <div class="text-muted small mb-2">
                        <?= $this->escape(__('Processo guiado: gere o resumo, execute a busca local e só depois peça ajuda externa se necessário. Nada é enviado ao cliente nem altera o chamado automaticamente.', 'glpiintegaglpi')); ?>
                    </div>

                    <div class="row g-2 align-items-end mb-2">
                        <div class="col-md-7">
                            <label class="form-label small mb-1">
                                <?= $this->escape(__('IA para pesquisa externa', 'glpiintegaglpi')); ?>
                            </label>
                            <select class="form-select form-select-sm js-smart-help-provider">
                                <option value="disabled|" selected><?= $this->escape(__('Carregando providers seguros...', 'glpiintegaglpi')); ?></option>
                            </select>
                        </div>
                        <div class="col-md-5">
                            <div class="form-text js-smart-help-provider-help">
                                <?= $this->escape(__('Cloud exige consentimento e PII Guard.', 'glpiintegaglpi')); ?>
                            </div>
                        </div>
                    </div>

                    <div class="mb-2">
                        <label class="form-label small mb-1" for="smart-help-summary-<?= (int) $replyTicketId; ?>">
                            <?= $this->escape(__('Resumo técnico sem dados pessoais', 'glpiintegaglpi')); ?>
                        </label>
                        <textarea
                            class="form-control form-control-sm js-smart-help-technical-summary"
                            id="smart-help-summary-<?= (int) $replyTicketId; ?>"
                            rows="2"
                        ></textarea>
                        <div class="form-text js-smart-help-schema-status">
                            <?= $this->escape(__('Aguardando validação local da KB e schema 044.', 'glpiintegaglpi')); ?>
                        </div>
                    </div>

                    <?php /* KB articles */ ?>
                    <div class="js-smart-help-articles small"></div>

                    <?php /* checklist + questions */ ?>
                    <div class="row g-2 mt-1">
                        <div class="col-md-6">
                            <div class="fw-bold small"><?= $this->escape(__('Checklist de diagnóstico', 'glpiintegaglpi')); ?></div>
                            <ul class="small mb-0 js-smart-help-checklist"></ul>
                        </div>
                        <div class="col-md-6">
                            <div class="fw-bold small"><?= $this->escape(__('Perguntas sugeridas ao cliente', 'glpiintegaglpi')); ?></div>
                            <ul class="small mb-0 list-unstyled js-smart-help-questions"></ul>
                        </div>
                    </div>

                    <?php /* cloud offer / states */ ?>
                    <div class="mt-2 js-smart-help-local-suggestion"></div>
                    <div class="mt-2 js-smart-help-history"></div>
                    <div class="mt-2 js-smart-help-cloud"></div>
                    <div class="mt-2 small js-smart-help-message text-muted"></div>

                    <div class="d-flex gap-2 mt-2 flex-wrap">
                        <button type="button" class="btn btn-sm btn-outline-success js-smart-help-suggest-kb">
                            <i class="ti ti-file-plus me-1"></i><?= $this->escape(__('Virar artigo KB', 'glpiintegaglpi')); ?>
                        </button>
                        <a class="btn btn-sm btn-outline-secondary" href="<?= $this->escape(\GlpiPlugin\Integaglpi\Plugin::getKbCandidatesUrl()); ?>" target="_blank" rel="noopener noreferrer">
                            <?= $this->escape(__('Ver candidatos de KB', 'glpiintegaglpi')); ?>
                        </a>
                    </div>
                    <div class="form-text mt-1">
                        <?= $this->escape(__('Somente leitura: nada é enviado ao cliente nem altera o chamado automaticamente. Publicação na KB é manual.', 'glpiintegaglpi')); ?>
                    </div>
                </div>
            <?php } ?>

            <div class="border rounded p-3 mt-3 mb-3 bg-light js-integaglpi-copilot" data-draft-hash="">
                <div class="d-flex justify-content-between align-items-center gap-2 flex-wrap">
                    <div>
                        <strong><?= $this->escape(__('Copiloto interno', 'glpiintegaglpi')); ?></strong>
                        <div class="text-muted small">
                            <?= $this->escape(__('Rascunho gerado por IA. Revise antes de enviar. Nenhuma mensagem é enviada automaticamente.', 'glpiintegaglpi')); ?>
                        </div>
                        <div class="small">
                            <?= $this->escape(__('Provider efetivo:', 'glpiintegaglpi')); ?>
                            <code><?= $this->escape((string) ($aiAssistantCopilot['provider'] ?? 'disabled')); ?></code>
                            /
                            <code><?= $this->escape((string) ($aiAssistantCopilot['model'] ?? '')); ?></code>
                            <span class="badge bg-light text-dark border"><?= $this->escape((string) ($aiAssistantCopilot['origin_label'] ?? '[Fallback local - provider desabilitado]')); ?></span>
                        </div>
                    </div>
                    <div class="btn-group btn-group-sm">
                        <button type="button" class="btn btn-outline-primary js-integaglpi-copilot-generate" data-tone="neutral">
                            <?= $this->escape(__('Sugerir resposta', 'glpiintegaglpi')); ?>
                        </button>
                        <button type="button" class="btn btn-outline-secondary js-integaglpi-copilot-generate" data-tone="friendly">
                            <?= $this->escape(__('Mais amigável', 'glpiintegaglpi')); ?>
                        </button>
                        <button type="button" class="btn btn-outline-secondary js-integaglpi-copilot-generate" data-tone="technical">
                            <?= $this->escape(__('Mais técnico', 'glpiintegaglpi')); ?>
                        </button>
                        <button type="button" class="btn btn-outline-secondary js-integaglpi-copilot-generate" data-tone="concise">
                            <?= $this->escape(__('Mais curta', 'glpiintegaglpi')); ?>
                        </button>
                        <?php if (\GlpiPlugin\Integaglpi\Plugin::canExternalResearchRead()) { ?>
                            <a class="btn btn-outline-secondary" href="<?= $this->escape(\GlpiPlugin\Integaglpi\Plugin::getExternalResearchUrl()); ?>" target="_blank" rel="noopener">
                                <?= $this->escape(__('Pesquisa externa controlada', 'glpiintegaglpi')); ?>
                            </a>
                        <?php } ?>
                    </div>
                </div>
                <textarea class="form-control mt-2 js-integaglpi-copilot-draft" rows="4" maxlength="2000" placeholder="<?= $this->escape(__('O rascunho aparecerá aqui para revisão.', 'glpiintegaglpi')); ?>"></textarea>
                <div class="mt-2 small js-integaglpi-copilot-meta text-muted">
                    <?= $this->escape(__('Fonte explícita aparecerá aqui após gerar a sugestão.', 'glpiintegaglpi')); ?>
                </div>
                <div class="d-flex gap-2 align-items-center mt-2 flex-wrap">
                    <button type="button" class="btn btn-sm btn-outline-secondary js-integaglpi-copilot-copy">
                        <?= $this->escape(__('Copiar rascunho', 'glpiintegaglpi')); ?>
                    </button>
                    <button type="button" class="btn btn-sm btn-outline-success js-integaglpi-copilot-use">
                        <?= $this->escape(__('Usar rascunho', 'glpiintegaglpi')); ?>
                    </button>
                    <button type="button" class="btn btn-sm btn-outline-danger js-integaglpi-copilot-discard">
                        <?= $this->escape(__('Descartar sugestão', 'glpiintegaglpi')); ?>
                    </button>
                    <button type="button" class="btn btn-sm btn-outline-secondary js-integaglpi-copilot-feedback" data-feedback="useful">
                        <?= $this->escape(__('Útil', 'glpiintegaglpi')); ?>
                    </button>
                    <button type="button" class="btn btn-sm btn-outline-secondary js-integaglpi-copilot-feedback" data-feedback="not_useful">
                        <?= $this->escape(__('Não útil', 'glpiintegaglpi')); ?>
                    </button>
                    <input type="text" class="form-control form-control-sm js-integaglpi-copilot-notes" style="max-width: 260px;" placeholder="<?= $this->escape(__('Comentário opcional', 'glpiintegaglpi')); ?>">
                    <small class="js-integaglpi-copilot-status text-muted"></small>
                </div>
            </div>
        </div>
    </div>
    <script>
    // Phase: integaglpi_ops_console_claim_ui_messaging_stabilization_001.
    // Reposition the Assistente IA block to AFTER the reply textarea/attachment/send.
    // The block is rendered hidden in its original position; this script appends it
    // at the end of the reply card body and reveals it.
    (function () {
        var card = document.getElementById(<?= json_encode($replyDomId, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE); ?>);
        if (!card) {
            return;
        }
        var assistant = card.querySelector('.js-integaglpi-ticket-ai-assistant[data-ai-assistant-position="below-reply"]');
        if (!assistant) {
            return;
        }
        var body = card.querySelector('.card-body');
        if (body) {
            try {
                var smartHelp = card.querySelector('.integaglpi-smart-help');
                var copilot = card.querySelector('.js-integaglpi-copilot');
                if (smartHelp && copilot && smartHelp.parentNode === copilot.parentNode) {
                    body.insertBefore(copilot, smartHelp);
                }
                body.appendChild(assistant);
            } catch (err) {
                // Reposition is non-critical; fall back to revealing in place.
            }
        }
        assistant.removeAttribute('hidden');
    })();
    </script>
    <script>
    (function () {
        var card = document.getElementById(<?= json_encode($replyDomId, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE); ?>);
        if (!card || card.dataset.integaglpiBound === '1') {
            return;
        }
        card.dataset.integaglpiBound = '1';

        var endpoint  = <?= json_encode($replyPostUrl, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE); ?>;
        var copilotEndpoint = <?= json_encode($copilotPostUrl, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE); ?>;
        var csrfToken = <?= json_encode($replyCsrfToken, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE); ?>;
        var emptyMsg  = <?= json_encode(__('Informe uma mensagem ou anexe um arquivo.', 'glpiintegaglpi'), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE); ?>;
        var sendingMsg = <?= json_encode(__('Enviando...', 'glpiintegaglpi'), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE); ?>;
        var sentMsg   = <?= json_encode(__('Mensagem enviada.', 'glpiintegaglpi'), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE); ?>;
        var genericErr = <?= json_encode(__('Falha ao enviar a mensagem.', 'glpiintegaglpi'), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE); ?>;
        var networkErr = <?= json_encode(__('Erro de rede ao enviar a mensagem.', 'glpiintegaglpi'), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE); ?>;

        var button   = card.querySelector('.js-integaglpi-tab-reply-send');
        var textarea = card.querySelector('.js-integaglpi-tab-reply-text');
        var fileInput = card.querySelector('.js-integaglpi-tab-reply-file');
        var feedback = card.querySelector('.js-integaglpi-tab-reply-feedback');
        var copilotBox = card.querySelector('.js-integaglpi-copilot');
        var copilotDraft = card.querySelector('.js-integaglpi-copilot-draft');
        var copilotMeta = card.querySelector('.js-integaglpi-copilot-meta');
        var copilotStatus = card.querySelector('.js-integaglpi-copilot-status');
        var copilotNotes = card.querySelector('.js-integaglpi-copilot-notes');
        var kbLocalStatus = card.querySelector('.js-integaglpi-kb-local-status');
        var copilotStorageKey = 'integaglpi_copilot_draft_' + String(button ? button.dataset.ticketId || '' : '') + '_' + String(button ? button.dataset.conversationId || '' : '');

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

        function updateCsrfToken(body) {
            if (body && typeof body.csrf_token === 'string' && body.csrf_token !== '') {
                csrfToken = body.csrf_token;
            }
        }

        function refreshCsrfToken() {
            return fetch(copilotEndpoint + '?csrf_token=1&_=' + String(Date.now()), {
                method: 'GET',
                credentials: 'same-origin',
                cache: 'no-store',
                headers: { 'Accept': 'application/json', 'Cache-Control': 'no-store' }
            })
                .then(parseJsonResponse)
                .then(function (result) {
                    updateCsrfToken(result.body);
                    return result;
                })
                .catch(function () {
                    return { status: 0, body: null };
                });
        }

        function copilotMessage(result, fallback) {
            if (!result || !result.body) { return fallback; }
            return copilotFriendlyMessage(result.body.display_message || result.body.message || fallback);
        }

        function copilotFriendlyMessage(message) {
            var text = String(message || '');
            if (/COPILOT_DRAFT_(INVALID_JSON|INVALID_SHAPE|INVALID_ENUM|EMPTY)/.test(text)) {
                return <?= json_encode(__('A IA respondeu em formato inválido. Tente novamente ou redija manualmente.', 'glpiintegaglpi'), JSON_UNESCAPED_UNICODE); ?>;
            }
            if (/COPILOT_DRAFT_SECRET_DETECTED/.test(text)) {
                return <?= json_encode(__('A resposta da IA foi bloqueada por conter dado sensível.', 'glpiintegaglpi'), JSON_UNESCAPED_UNICODE); ?>;
            }
            if (/COPILOT_DRAFT_CHECKLIST_REQUIRED/.test(text)) {
                return <?= json_encode(__('A IA retornou um rascunho sem checklist técnico obrigatório. Gere novamente ou revise o contexto antes de usar.', 'glpiintegaglpi'), JSON_UNESCAPED_UNICODE); ?>;
            }
            return text;
        }

        function copilotTypedFallback(result, fallback) {
            var errorType = result && result.body && result.body.error_type ? String(result.body.error_type) : '';
            if (errorType === 'node_timeout') {
                return <?= json_encode(__('Integration-service demorou mais que o esperado. Tente novamente em breve.', 'glpiintegaglpi'), JSON_UNESCAPED_UNICODE); ?>;
            }
            if (errorType === 'diagnostics_timeout') {
                return <?= json_encode(__('Diagnóstico do integration-service excedeu o tempo limite. A IA não será tratada como offline sem nova evidência.', 'glpiintegaglpi'), JSON_UNESCAPED_UNICODE); ?>;
            }
            if (errorType === 'configuration_pending') {
                return <?= json_encode(__('Copiloto com configuração pendente. Revise a Central IA antes de tentar novamente.', 'glpiintegaglpi'), JSON_UNESCAPED_UNICODE); ?>;
            }
            if (errorType === 'provider_unavailable') {
                return <?= json_encode(__('Provider do Copiloto indisponível no momento. Verifique o serviço IA local.', 'glpiintegaglpi'), JSON_UNESCAPED_UNICODE); ?>;
            }
            if (errorType === 'invalid_provider_response') {
                return <?= json_encode(__('Copiloto indisponível: resposta do modelo inválida. A sugestão foi bloqueada por segurança. Redija manualmente ou tente novamente quando o modelo IA local estiver configurado.', 'glpiintegaglpi'), JSON_UNESCAPED_UNICODE); ?>;
            }
            if (errorType === 'type_error') {
                return <?= json_encode(__('Erro interno ao normalizar dados do Copiloto. O retorno foi bloqueado com segurança.', 'glpiintegaglpi'), JSON_UNESCAPED_UNICODE); ?>;
            }
            if (errorType === 'missing_context') {
                return <?= json_encode(__('Contexto insuficiente para gerar rascunho.', 'glpiintegaglpi'), JSON_UNESCAPED_UNICODE); ?>;
            }

            return fallback;
        }

        function isCsrfFailure(result) {
            if (!result || result.status !== 403) { return false; }
            if (!result.body) { return true; }
            return result.body.error_type === 'csrf_failed'
                || result.body.error_type === 'csrf_denied'
                || result.body.message === 'csrf_denied'
                || result.body.message === 'csrf_failed_reload_page'
                || !result.body.csrf_token;
        }

        function setCopilotStatus(message, kind) {
            if (!copilotStatus) { return; }
            copilotStatus.textContent = copilotFriendlyMessage(message || '');
            copilotStatus.className = 'js-integaglpi-copilot-status small ' + (
                kind === 'error' ? 'text-danger'
                : kind === 'success' ? 'text-success'
                : 'text-muted'
            );
        }

        card.querySelectorAll('.js-integaglpi-kb-local-focus').forEach(function (kbButton) {
            kbButton.addEventListener('click', function () {
                var results = card.querySelector('.js-integaglpi-kb-local-results');
                if (results) {
                    results.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }
                if (kbLocalStatus) {
                    kbLocalStatus.textContent = <?= json_encode(__('KB local exibida. Nenhuma IA externa foi chamada.', 'glpiintegaglpi'), JSON_UNESCAPED_UNICODE); ?>;
                    kbLocalStatus.className = 'js-integaglpi-kb-local-status text-success small d-block mt-2';
                }
            });
        });

        function postCopilot(payload, retryAllowed) {
            retryAllowed = retryAllowed !== false;
            function send() {
                payload.set('_glpi_csrf_token', csrfToken);
                payload.set('ticket_id', String(button.dataset.ticketId || ''));
                payload.set('conversation_id', String(button.dataset.conversationId || ''));

                return fetch(copilotEndpoint, {
                    method: 'POST',
                    credentials: 'same-origin',
                    headers: { 'Accept': 'application/json' },
                    body: payload
                });
            }

            return send().then(parseJsonResponse).then(function (result) {
                updateCsrfToken(result.body);
                if (retryAllowed && isCsrfFailure(result)) {
                    return refreshCsrfToken().then(function () {
                        return postCopilot(payload, false);
                    });
                }
                return result;
            });
        }

        var copilotPollingTimer = null;
        var copilotPollingAttempts = 0;

        function setCopilotGenerateDisabled(disabled) {
            card.querySelectorAll('.js-integaglpi-copilot-generate').forEach(function (item) {
                item.disabled = !!disabled;
            });
        }

        function draftFromResponseBody(responseBody) {
            return responseBody && responseBody.draft ? responseBody.draft : null;
        }

        function applyCopilotDraft(draft) {
            if (!draft) {
                setCopilotStatus(<?= json_encode(__('O Copiloto não retornou rascunho para revisão.', 'glpiintegaglpi'), JSON_UNESCAPED_UNICODE); ?>, 'error');
                return false;
            }
            var draftText = draft.draftResponse || draft.draft_response || '';
            if (!draftText.trim()) {
                setCopilotStatus(<?= json_encode(__('O Copiloto retornou um rascunho vazio.', 'glpiintegaglpi'), JSON_UNESCAPED_UNICODE); ?>, 'error');
                return false;
            }
            copilotDraft.value = draftText;
            copilotBox.dataset.draftHash = draft.draftHash || draft.draft_hash || '';
            var metaText = '';
            if (copilotMeta) {
                var notices = [];
                if (draft.templateNotice || draft.template_notice) { notices.push(draft.templateNotice || draft.template_notice); }
                if (draft.source_name || draft.sourceName || draft.source_type || draft.sourceType) {
                    notices.push('Fonte: ' + String(draft.source_name || draft.sourceName || 'Copiloto assistivo')
                        + ' (' + String(draft.source_type || draft.sourceType || 'fallback') + ')');
                } else if (draft.source || draft.provider || draft.model) {
                    notices.push('Fonte: ' + String(draft.source || <?= json_encode((string) ($aiAssistantCopilot['origin_label'] ?? ''), JSON_UNESCAPED_UNICODE); ?> || 'provider efetivo'));
                }
                if (draft.request_id || draft.requestId) { notices.push('request_id ' + String(draft.request_id || draft.requestId)); }
                if (draft.confidenceScore || draft.confidence_score) { notices.push('confiança ' + String(draft.confidenceScore || draft.confidence_score) + '%'); }
                if (draft.confidence) { notices.push('confiança ' + String(draft.confidence)); }
                metaText = notices.join(' · ');
                copilotMeta.textContent = metaText;
            }
            saveCopilotDraft(copilotDraft.value, copilotBox.dataset.draftHash || '', metaText, '', 'completed');
            setCopilotStatus(<?= json_encode(__('Rascunho pronto para revisão.', 'glpiintegaglpi'), JSON_UNESCAPED_UNICODE); ?>, 'success');
            return true;
        }

        function pollCopilotDraft(jobId) {
            if (!jobId) { return; }
            if (copilotPollingTimer) {
                window.clearTimeout(copilotPollingTimer);
                copilotPollingTimer = null;
            }
            var payload = new FormData();
            payload.set('copilot_action', 'status');
            payload.set('job_id', jobId);
            postCopilot(payload).then(function (result) {
                var responseBody = result.body && (result.body.body || result.body);
                if (!result.body || result.body.success !== true || !responseBody) {
                    setCopilotGenerateDisabled(false);
                    setCopilotStatus(copilotMessage(result, <?= json_encode(__('Não foi possível consultar o status do Copiloto.', 'glpiintegaglpi'), JSON_UNESCAPED_UNICODE); ?>), 'error');
                    return;
                }
                if (responseBody.status === 'completed') {
                    setCopilotGenerateDisabled(false);
                    if (applyCopilotDraft(draftFromResponseBody(responseBody))) {
                        saveCopilotDraft(copilotDraft.value, copilotBox.dataset.draftHash || '', copilotMeta ? copilotMeta.textContent : '', '', 'completed');
                    }
                    return;
                }
                if (responseBody.status === 'failed' || responseBody.ok === false) {
                    setCopilotGenerateDisabled(false);
                    saveCopilotDraft('', '', '', '', 'failed');
                    setCopilotStatus(responseBody.message || <?= json_encode(__('IA local indisponível no momento.', 'glpiintegaglpi'), JSON_UNESCAPED_UNICODE); ?>, 'error');
                    return;
                }
                copilotPollingAttempts += 1;
                if (copilotPollingAttempts >= 36) {
                    setCopilotGenerateDisabled(false);
                    saveCopilotDraft('', '', '', jobId, 'failed');
                    setCopilotStatus(<?= json_encode(__('O rascunho ainda está em processamento. Tente atualizar o status em instantes.', 'glpiintegaglpi'), JSON_UNESCAPED_UNICODE); ?>, 'error');
                    return;
                }
                saveCopilotDraft('', '', copilotMeta ? copilotMeta.textContent : '', jobId, 'pending');
                copilotPollingTimer = window.setTimeout(function () { pollCopilotDraft(jobId); }, 2500);
            }).catch(function () {
                setCopilotGenerateDisabled(false);
                setCopilotStatus(<?= json_encode(__('Erro de rede ao consultar o status do Copiloto.', 'glpiintegaglpi'), JSON_UNESCAPED_UNICODE); ?>, 'error');
            });
        }

        function restoreCopilotDraft() {
            if (!copilotDraft || !copilotBox || !window.sessionStorage) { return; }
            var raw = window.sessionStorage.getItem(copilotStorageKey);
            if (!raw) { return; }
            try {
                var saved = JSON.parse(raw);
                copilotDraft.value = saved.text || '';
                copilotBox.dataset.draftHash = saved.hash || '';
                if (copilotMeta) { copilotMeta.textContent = saved.meta || ''; }
                if (saved.jobId && saved.jobStatus === 'pending') {
                    copilotPollingAttempts = 0;
                    setCopilotGenerateDisabled(true);
                    setCopilotStatus(<?= json_encode(__('Gerando rascunho em segundo plano...', 'glpiintegaglpi'), JSON_UNESCAPED_UNICODE); ?>, 'muted');
                    pollCopilotDraft(saved.jobId);
                    return;
                }
                if (copilotDraft.value.trim()) {
                    setCopilotStatus(<?= json_encode(__('Rascunho restaurado para revisão.', 'glpiintegaglpi'), JSON_UNESCAPED_UNICODE); ?>, 'success');
                }
            } catch (e) {
                window.sessionStorage.removeItem(copilotStorageKey);
            }
        }

        function saveCopilotDraft(text, hash, meta, jobId, jobStatus) {
            if (!window.sessionStorage) { return; }
            window.sessionStorage.setItem(copilotStorageKey, JSON.stringify({
                text: text || '',
                hash: hash || '',
                meta: meta || '',
                jobId: jobId || '',
                jobStatus: jobStatus || ''
            }));
        }

        function clearCopilotDraft() {
            if (window.sessionStorage) {
                window.sessionStorage.removeItem(copilotStorageKey);
            }
        }

        restoreCopilotDraft();

        card.querySelectorAll('.js-integaglpi-copilot-generate').forEach(function (copilotButton) {
            copilotButton.addEventListener('click', function () {
                if (!copilotDraft || !copilotBox) { return; }
                var payload = new FormData();
                payload.set('copilot_action', 'generate');
                payload.set('tone', String(copilotButton.dataset.tone || 'neutral'));
                copilotPollingAttempts = 0;
                setCopilotGenerateDisabled(true);
                setCopilotStatus(<?= json_encode(__('Gerando rascunho em segundo plano...', 'glpiintegaglpi'), JSON_UNESCAPED_UNICODE); ?>, 'muted');
                postCopilot(payload).then(function (result) {
                    var responseBody = result.body && (result.body.body || result.body);
                    var jobId = responseBody && (responseBody.job_id || responseBody.jobId) ? String(responseBody.job_id || responseBody.jobId) : '';
                    if (!result.body || result.body.success !== true || !jobId) {
                        setCopilotGenerateDisabled(false);
                        if (isCsrfFailure(result)) {
                            setCopilotStatus(<?= json_encode(__('Token de segurança expirado. Atualize a página e tente novamente.', 'glpiintegaglpi'), JSON_UNESCAPED_UNICODE); ?>, 'error');
                            return;
                        }
                        // Use HTTP status to replace the generic fallback with a contextual message.
                        var genericMsg = <?= json_encode(__('Não foi possível usar o Copiloto agora.', 'glpiintegaglpi'), JSON_UNESCAPED_UNICODE); ?>;
                        var displayMsg = copilotTypedFallback(result, copilotMessage(result, null));
                        if (!displayMsg || displayMsg === genericMsg) {
                            if (result.status === 504 || result.status === 503) {
                                displayMsg = <?= json_encode(__('O Copiloto não respondeu a tempo. Tente novamente em breve.', 'glpiintegaglpi'), JSON_UNESCAPED_UNICODE); ?>;
                            } else if (result.status === 403) {
                                displayMsg = <?= json_encode(__('Sem permissão para usar o Copiloto ou sessão expirada. Recarregue a página.', 'glpiintegaglpi'), JSON_UNESCAPED_UNICODE); ?>;
                            } else if (result.status === 500) {
                                displayMsg = <?= json_encode(__('Erro interno no Copiloto. Consulte o error_type retornado e os logs sanitizados.', 'glpiintegaglpi'), JSON_UNESCAPED_UNICODE); ?>;
                            } else {
                                displayMsg = displayMsg || <?= json_encode(__('Não foi possível gerar o rascunho.', 'glpiintegaglpi'), JSON_UNESCAPED_UNICODE); ?>;
                            }
                        }
                        setCopilotStatus(displayMsg, 'error');
                        return;
                    }
                    saveCopilotDraft('', '', copilotMeta ? copilotMeta.textContent : '', jobId, 'pending');
                    pollCopilotDraft(jobId);
                }).catch(function () {
                    setCopilotGenerateDisabled(false);
                    setCopilotStatus(<?= json_encode(__('Erro de rede ao chamar o Copiloto.', 'glpiintegaglpi'), JSON_UNESCAPED_UNICODE); ?>, 'error');
                });
            });
        });

        var copyButton = card.querySelector('.js-integaglpi-copilot-copy');
        if (copyButton) {
            copyButton.addEventListener('click', function () {
                if (!copilotDraft || !copilotDraft.value.trim()) { return; }
                navigator.clipboard && navigator.clipboard.writeText(copilotDraft.value);
                setCopilotStatus(<?= json_encode(__('Rascunho copiado.', 'glpiintegaglpi'), JSON_UNESCAPED_UNICODE); ?>, 'success');
            });
        }

        var useButton = card.querySelector('.js-integaglpi-copilot-use');
        if (useButton) {
            useButton.addEventListener('click', function () {
                if (!copilotDraft || !textarea || !copilotDraft.value.trim()) { return; }
                textarea.value = copilotDraft.value;
                saveCopilotDraft(copilotDraft.value, copilotBox ? (copilotBox.dataset.draftHash || '') : '', copilotMeta ? copilotMeta.textContent : '');
                setCopilotStatus(<?= json_encode(__('Rascunho aplicado. Revise antes de enviar manualmente.', 'glpiintegaglpi'), JSON_UNESCAPED_UNICODE); ?>, 'success');
            });
        }

        var discardButton = card.querySelector('.js-integaglpi-copilot-discard');
        if (discardButton) {
            discardButton.addEventListener('click', function () {
                if (copilotDraft) { copilotDraft.value = ''; }
                var payload = new FormData();
                payload.set('copilot_action', 'discard');
                payload.set('draft_hash', copilotBox ? (copilotBox.dataset.draftHash || '') : '');
                postCopilot(payload);
                if (copilotBox) { copilotBox.dataset.draftHash = ''; }
                if (copilotMeta) { copilotMeta.textContent = ''; }
                clearCopilotDraft();
                setCopilotStatus(<?= json_encode(__('Sugestão descartada.', 'glpiintegaglpi'), JSON_UNESCAPED_UNICODE); ?>, 'muted');
            });
        }

        card.querySelectorAll('.js-integaglpi-copilot-feedback').forEach(function (feedbackButton) {
            if (!feedbackButton.dataset || !feedbackButton.dataset.feedback) { return; }
            feedbackButton.addEventListener('click', function () {
                var payload = new FormData();
                payload.set('copilot_action', 'feedback');
                payload.set('draft_hash', copilotBox ? (copilotBox.dataset.draftHash || '') : '');
                payload.set('feedback', String(feedbackButton.dataset.feedback || 'useful'));
                payload.set('notes', copilotNotes ? copilotNotes.value : '');
                postCopilot(payload).then(function (result) {
                    if (!result.body || result.body.success !== true) {
                        setCopilotStatus(copilotMessage(result, <?= json_encode(__('Não foi possível registrar feedback.', 'glpiintegaglpi'), JSON_UNESCAPED_UNICODE); ?>), 'error');
                        return;
                    }
                    setCopilotStatus(<?= json_encode(__('Feedback registrado.', 'glpiintegaglpi'), JSON_UNESCAPED_UNICODE); ?>, 'success');
                }).catch(function () {
                    setCopilotStatus(<?= json_encode(__('Erro de rede ao registrar feedback.', 'glpiintegaglpi'), JSON_UNESCAPED_UNICODE); ?>, 'error');
                });
            });
        });

        button.addEventListener('click', function () {
            var msg = (textarea.value || '').trim();
            var file = fileInput && fileInput.files && fileInput.files.length > 0 ? fileInput.files[0] : null;
            if (msg === '' && !file) {
                alert(emptyMsg);
                return;
            }

            var payload = new FormData();
            payload.set('ticket_id',       String(button.dataset.ticketId || ''));
            payload.set('conversation_id', String(button.dataset.conversationId || ''));
            payload.set('reply_text',      msg);
            if (file) {
                payload.set('reply_file', file);
            }

            var originalLabel = button.textContent;
            button.disabled = true;
            button.textContent = sendingMsg;
            setFeedback('', 'muted');

            refreshCsrfToken()
                .then(function () {
                    payload.set('_glpi_csrf_token', csrfToken);

                    return fetch(endpoint, {
                        method: 'POST',
                        credentials: 'same-origin',
                        headers: {
                            'Accept': 'application/json'
                        },
                        body: payload
                    });
                })
                .then(parseJsonResponse)
                .then(function (result) {
                    updateCsrfToken(result.body);
                    if (!result.body || result.body.success !== true) {
                        if (result.status === 403 && (!result.body || !result.body.csrf_token)) {
                            setFeedback(<?= json_encode(__('Token de segurança expirado. Atualize a página e tente novamente.', 'glpiintegaglpi'), JSON_UNESCAPED_UNICODE); ?>, 'error');
                            button.disabled = false;
                            button.textContent = originalLabel;
                            return;
                        }
                        var msgFromServer = result.body && result.body.message
                            ? result.body.message
                            : genericErr;
                        setFeedback(msgFromServer, 'error');
                        button.disabled = false;
                        button.textContent = originalLabel;
                        return;
                    }

                    textarea.value = '';
                    if (fileInput) {
                        fileInput.value = '';
                    }
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
<script>
document.addEventListener('submit', function (event) {
    var form = event.target && event.target.closest
        ? event.target.closest('.js-integaglpi-critical-action-form')
        : null;
    if (!form) {
        return;
    }
    if (form.dataset.submitted === '1') {
        event.preventDefault();
        return;
    }
    form.dataset.submitted = '1';
    var button = form.querySelector('button[type="submit"]');
    if (button) {
        button.dataset.originalText = button.textContent || '';
        button.disabled = true;
        button.textContent = button.dataset.loadingText || 'Processando...';
    }
}, true);
</script>
<?php } ?>

<?php
/* Inline-inject the Smart Help panel assets (404-safe: some installs do not
   serve /plugins/... static files). Only when the panel is visible. */
if (\GlpiPlugin\Integaglpi\Service\SmartHelpService::canViewPanel()) {
    $integaglpiSmartHelpCss = dirname(__DIR__) . '/css/ticket_ai_panel.css';
    $integaglpiSmartHelpJs  = dirname(__DIR__) . '/js/ticket_ai_panel.js';
    if (is_file($integaglpiSmartHelpCss)) {
        echo "<style>\n" . file_get_contents($integaglpiSmartHelpCss) . "\n</style>";
    }
    if (is_file($integaglpiSmartHelpJs)) {
        echo "<script>\n" . file_get_contents($integaglpiSmartHelpJs) . "\n</script>";
    }
}
?>
