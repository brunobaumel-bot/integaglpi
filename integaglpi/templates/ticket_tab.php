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
$profileSnapshot = is_array($runtimeView['contact_profile_snapshot'] ?? null)
    ? $runtimeView['contact_profile_snapshot']
    : null;
$contextView = is_array($context) ? $context : [];
$contextConversation = is_array($contextView['conversation'] ?? null) ? $contextView['conversation'] : null;
$contextRisk = is_array($contextView['risk'] ?? null) ? $contextView['risk'] : null;
$contextWarnings = is_array($contextView['warnings'] ?? null) ? $contextView['warnings'] : [];
$contextEvents = is_array($contextView['events'] ?? null) ? $contextView['events'] : [];
$contextDeadLetter = is_array($contextView['dead_letter'] ?? null) ? $contextView['dead_letter'] : null;
$contextCsat = is_array($contextView['csat'] ?? null) ? $contextView['csat'] : null;
$contextAiQuality = is_array($contextView['ai_quality'] ?? null) ? $contextView['ai_quality'] : null;
$aiSupervisorEnabled = (bool) ($contextView['ai_supervisor_enabled'] ?? \GlpiPlugin\Integaglpi\Plugin::isAiSupervisorEnabled());
$contextCorrelationId = trim((string) ($contextView['correlation_id'] ?? ''));
$canViewTechnical = (bool) ($contextView['can_view_technical'] ?? false);
$localTemplates = [];
try {
    $localTemplates = (new \GlpiPlugin\Integaglpi\Service\PluginConfigService())->getActiveLocalTemplates();
} catch (\Throwable) {
    $localTemplates = [];
}
$statusBadge = static function (mixed $status): string {
    return match (strtolower((string) $status)) {
        'open', 'ok', 'success' => 'success',
        'closed', 'critical', 'error', 'failed', 'danger' => 'danger',
        'awaiting_queue_selection', 'awaiting_entity_selection', 'collecting_contact_profile', 'warning' => 'warning',
        default => 'secondary',
    };
};
$riskBadge = static function (mixed $level): string {
    return match ((string) $level) {
        'critical' => 'danger',
        'warning' => 'warning',
        default => 'success',
    };
};
$short = static function (mixed $value, int $max = 44): string {
    $text = trim((string) $value);
    if ($text === '') {
        return '-';
    }

    return strlen($text) > $max ? substr($text, 0, $max) . '...' : $text;
};
$attachmentActionUrl = \GlpiPlugin\Integaglpi\Plugin::getWebBasePath() . '/front/attachment.action.php';
$attachmentStatusLabel = static function (string $status): string {
    return match ($status) {
        'received' => __('recebido', 'glpiintegaglpi'),
        'validated' => __('validado', 'glpiintegaglpi'),
        'blocked' => __('bloqueado', 'glpiintegaglpi'),
        'synced' => __('sincronizado', 'glpiintegaglpi'),
        'failed' => __('falhou', 'glpiintegaglpi'),
        'deleted' => __('excluído logicamente', 'glpiintegaglpi'),
        default => $status,
    };
};
$attachmentStatusBadge = static function (string $status): string {
    return match ($status) {
        'synced', 'validated' => 'success',
        'blocked', 'failed' => 'danger',
        'deleted' => 'secondary',
        default => 'info',
    };
};
$shortHash = static function (mixed $value): string {
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
                    <strong><?= $this->escape((string) ($runtime['phone_e164'] ?? '-')); ?></strong>
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
                    <?= $this->escape((string) ($profileSnapshot['email_address'] ?? $contextConversation['email_address'] ?? '-')); ?><br>
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
                                <?= $this->escape(__('Sugestão gerada por IA. Técnico deve revisar. Nenhuma ação é executada automaticamente.', 'glpiintegaglpi')); ?>
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
                        <form method="post" action="<?= $this->escape(\GlpiPlugin\Integaglpi\Plugin::getAiQualityUrl()); ?>" class="mt-3">
                            <?= \GlpiPlugin\Integaglpi\Plugin::renderCsrfToken(); ?>
                            <input type="hidden" name="action" value="analyze">
                            <input type="hidden" name="ticket_id" value="<?= (int) $ticket->getID(); ?>">
                            <input type="hidden" name="conversation_id" value="<?= $this->escape((string) ($contextConversation['conversation_id'] ?? '')); ?>">
                            <button type="submit" class="btn btn-sm btn-outline-primary">
                                <?= $this->escape($contextAiQuality === null ? __('Analisar conversa', 'glpiintegaglpi') : __('Analisar novamente', 'glpiintegaglpi')); ?>
                            </button>
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
                        <div
                            class="js-integaglpi-ticket-transfer-get"
                            data-action-url="<?= $this->escape($actionBaseUrl); ?>"
                            data-ticket-id="<?= (int) $ticketIdForDebug; ?>"
                            data-conversation-id="<?= $this->escape((string) $conversationIdForDebug); ?>"
                        >
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
                            <button type="button" class="btn btn-outline-primary js-integaglpi-ticket-transfer-get-submit"><?= $this->escape(__('Transferir', 'glpiintegaglpi')); ?></button>
                        </div>
                        <script>
                            (function () {
                                var box = document.currentScript ? document.currentScript.previousElementSibling : null;
                                if (!box || !box.classList || !box.classList.contains('js-integaglpi-ticket-transfer-get')) {
                                    return;
                                }
                                var button = box.querySelector('.js-integaglpi-ticket-transfer-get-submit');
                                var select = box.querySelector('.js-integaglpi-wa-queue');
                                if (!button || !select) {
                                    return;
                                }
                                button.addEventListener('click', function () {
                                    var queueId = select.value || '';
                                    if (queueId === '') {
                                        return;
                                    }
                                    var params = new URLSearchParams();
                                    params.set('debug_get', '1');
                                    params.set('ticket_id', box.dataset.ticketId || '');
                                    params.set('conversation_id', box.dataset.conversationId || '');
                                    params.set('whatsapp_action', 'transfer');
                                    params.set('queue_id', queueId);
                                    window.location.href = (box.dataset.actionUrl || '') + '?' + params.toString();
                                });
                            })();
                        </script>

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
                                    <?php if (\GlpiPlugin\Integaglpi\Plugin::canUpdate() && trim((string) ($message['message_id'] ?? '')) !== '') { ?>
                                        <form method="post" action="<?= $this->escape($attachmentActionUrl); ?>" class="mt-2 mb-0">
                                            <?= \GlpiPlugin\Integaglpi\Plugin::renderCsrfToken(); ?>
                                            <input type="hidden" name="ticket_id" value="<?= (int) $ticket->getID(); ?>">
                                            <input type="hidden" name="message_id" value="<?= $this->escape((string) $message['message_id']); ?>">
                                            <?php if ($attachmentStatus === 'deleted') { ?>
                                                <input type="hidden" name="attachment_action" value="restore">
                                                <button type="submit" class="btn btn-sm btn-outline-secondary">
                                                    <?= $this->escape(__('Restaurar anexo', 'glpiintegaglpi')); ?>
                                                </button>
                                            <?php } else { ?>
                                                <input type="hidden" name="attachment_action" value="soft_delete">
                                                <button type="submit" class="btn btn-sm btn-outline-danger">
                                                    <?= $this->escape(__('Excluir logicamente', 'glpiintegaglpi')); ?>
                                                </button>
                                            <?php } ?>
                                        </form>
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
        var emptyMsg  = <?= json_encode(__('Informe uma mensagem ou anexe um arquivo.', 'glpiintegaglpi'), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE); ?>;
        var sendingMsg = <?= json_encode(__('Enviando...', 'glpiintegaglpi'), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE); ?>;
        var sentMsg   = <?= json_encode(__('Mensagem enviada.', 'glpiintegaglpi'), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE); ?>;
        var genericErr = <?= json_encode(__('Falha ao enviar a mensagem.', 'glpiintegaglpi'), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE); ?>;
        var networkErr = <?= json_encode(__('Erro de rede ao enviar a mensagem.', 'glpiintegaglpi'), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE); ?>;

        var button   = card.querySelector('.js-integaglpi-tab-reply-send');
        var textarea = card.querySelector('.js-integaglpi-tab-reply-text');
        var fileInput = card.querySelector('.js-integaglpi-tab-reply-file');
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
            var file = fileInput && fileInput.files && fileInput.files.length > 0 ? fileInput.files[0] : null;
            if (msg === '' && !file) {
                alert(emptyMsg);
                return;
            }

            var payload = new FormData();
            payload.set('_glpi_csrf_token', csrfToken);
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

            fetch(endpoint, {
                method: 'POST',
                credentials: 'same-origin',
                headers: {
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
<?php } ?>
