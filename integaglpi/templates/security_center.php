<?php

declare(strict_types=1);

use GlpiPlugin\Integaglpi\Plugin;
use GlpiPlugin\Integaglpi\Service\SecurityPermissionService;

/** @var string $currentRole */
/** @var bool $canManage */
/** @var bool $isSecurityAdmin */
/** @var array<string, list<string>> $matrix */
/** @var array<string, list<string>> $denied */
/** @var list<string> $allRights */

$roleLabels = [
    SecurityPermissionService::ROLE_TECNICO    => __('Técnico', 'glpiintegaglpi'),
    SecurityPermissionService::ROLE_SUPERVISAO => __('Supervisão', 'glpiintegaglpi'),
    SecurityPermissionService::ROLE_DIRECAO    => __('Direção', 'glpiintegaglpi'),
];

$roleDescriptions = [
    SecurityPermissionService::ROLE_TECNICO => __(
        'Responde apenas atendimentos que assumiu. Sem gestão de configurações, IA ou segurança. Vê apenas a própria fila com PII mascarada.',
        'glpiintegaglpi'
    ),
    SecurityPermissionService::ROLE_SUPERVISAO => __(
        'Opera dentro da entidade ativa: assume, transfere, soluciona, encerra administrativamente (com motivo). Gerencia mensagens/templates de forma limitada. Não gerencia segredos de IA nem Central de Segurança.',
        'glpiintegaglpi'
    ),
    SecurityPermissionService::ROLE_DIRECAO => __(
        'Read-only e agregado: SLA, contratos, dashboards executivos, auditoria sanitizada. Sem ações operacionais e sem PII por padrão.',
        'glpiintegaglpi'
    ),
];

$rightLabels = [
    SecurityPermissionService::RIGHT_ENFORCE_ENTITY_ISOLATION => __('Escopo de entidade obrigatório', 'glpiintegaglpi'),
    SecurityPermissionService::RIGHT_VIEW_CENTRAL             => __('Visualizar Central WhatsApp', 'glpiintegaglpi'),
    SecurityPermissionService::RIGHT_VIEW_OWN_QUEUE           => __('Ver fila própria', 'glpiintegaglpi'),
    SecurityPermissionService::RIGHT_VIEW_ALL_QUEUES          => __('Ver todas as filas da entidade', 'glpiintegaglpi'),
    SecurityPermissionService::RIGHT_CLAIM_TICKET             => __('Assumir atendimento', 'glpiintegaglpi'),
    SecurityPermissionService::RIGHT_REPLY_OWNED_TICKET       => __('Responder apenas o próprio chamado', 'glpiintegaglpi'),
    SecurityPermissionService::RIGHT_REPLY_ANY_TICKET         => __('Responder qualquer chamado', 'glpiintegaglpi'),
    SecurityPermissionService::RIGHT_TRANSFER_TICKET          => __('Transferir atendimento', 'glpiintegaglpi'),
    SecurityPermissionService::RIGHT_SOLVE_OWNED_TICKET       => __('Solucionar apenas o próprio chamado', 'glpiintegaglpi'),
    SecurityPermissionService::RIGHT_SOLVE_TICKET             => __('Solucionar qualquer chamado', 'glpiintegaglpi'),
    SecurityPermissionService::RIGHT_ADMINISTRATIVE_CLOSE     => __('Encerrar administrativamente (motivo obrigatório)', 'glpiintegaglpi'),
    SecurityPermissionService::RIGHT_SELECT_ENTITY            => __('Selecionar entidade do chamado', 'glpiintegaglpi'),
    SecurityPermissionService::RIGHT_OVERRIDE_ENTITY_MEMORY   => __('Sobrepor memória de entidade (motivo obrigatório)', 'glpiintegaglpi'),
    SecurityPermissionService::RIGHT_MANAGE_MESSAGE_SETTINGS  => __('Gerenciar configurações de mensagens', 'glpiintegaglpi'),
    SecurityPermissionService::RIGHT_MANAGE_TEMPLATES         => __('Gerenciar templates WhatsApp', 'glpiintegaglpi'),
    SecurityPermissionService::RIGHT_VIEW_AI_CONSOLE          => __('Ver Console IA', 'glpiintegaglpi'),
    SecurityPermissionService::RIGHT_USE_COPILOT_AS_DRAFT     => __('Usar copiloto como rascunho', 'glpiintegaglpi'),
    SecurityPermissionService::RIGHT_MANAGE_AI_SETTINGS       => __('Gerenciar configurações de IA', 'glpiintegaglpi'),
    SecurityPermissionService::RIGHT_MANAGE_AI_SECRETS        => __('Gerenciar segredos de IA', 'glpiintegaglpi'),
    SecurityPermissionService::RIGHT_VIEW_AI_ALERTS           => __('Ver alertas de IA', 'glpiintegaglpi'),
    SecurityPermissionService::RIGHT_REVIEW_AI_ALERTS         => __('Revisar alertas de IA', 'glpiintegaglpi'),
    SecurityPermissionService::RIGHT_VIEW_KB_REFERENCE        => __('Consultar KB', 'glpiintegaglpi'),
    SecurityPermissionService::RIGHT_REVIEW_KB_CANDIDATES     => __('Revisar candidatos a KB', 'glpiintegaglpi'),
    SecurityPermissionService::RIGHT_VIEW_EXTERNAL_RESEARCH   => __('Ver pesquisa externa', 'glpiintegaglpi'),
    SecurityPermissionService::RIGHT_RUN_EXTERNAL_RESEARCH    => __('Executar pesquisa externa (controlada)', 'glpiintegaglpi'),
    SecurityPermissionService::RIGHT_VIEW_AUDIT_OPERATIONAL   => __('Ver auditoria operacional', 'glpiintegaglpi'),
    SecurityPermissionService::RIGHT_VIEW_AUDIT_READONLY_SANITIZED => __('Ver auditoria executiva sanitizada', 'glpiintegaglpi'),
    SecurityPermissionService::RIGHT_EXPORT_OPERATIONAL_REPORTS    => __('Exportar relatórios operacionais', 'glpiintegaglpi'),
    SecurityPermissionService::RIGHT_EXPORT_EXECUTIVE_REPORTS      => __('Exportar relatórios executivos (sanitizado)', 'glpiintegaglpi'),
    SecurityPermissionService::RIGHT_VIEW_CONTRACTS_READONLY       => __('Ver contratos (read-only)', 'glpiintegaglpi'),
    SecurityPermissionService::RIGHT_MANAGE_CONTRACTS              => __('Gerenciar contratos', 'glpiintegaglpi'),
    SecurityPermissionService::RIGHT_VIEW_EXECUTIVE_DASHBOARD      => __('Ver dashboard executivo', 'glpiintegaglpi'),
    SecurityPermissionService::RIGHT_VIEW_SLA_AGGREGATED           => __('Ver SLA agregado', 'glpiintegaglpi'),
    SecurityPermissionService::RIGHT_VIEW_SECURITY_CENTER          => __('Ver Central de Segurança', 'glpiintegaglpi'),
    SecurityPermissionService::RIGHT_MANAGE_SECURITY_CENTER        => __('Gerenciar Central de Segurança', 'glpiintegaglpi'),
    SecurityPermissionService::RIGHT_VIEW_MASKED_PII               => __('Ver PII mascarada', 'glpiintegaglpi'),
    SecurityPermissionService::RIGHT_VIEW_UNMASKED_PII             => __('Ver PII não mascarada', 'glpiintegaglpi'),
    SecurityPermissionService::RIGHT_VIEW_LOGMEIN_CONTEXT          => __('Ver contexto LogMeIn read-only', 'glpiintegaglpi'),
    SecurityPermissionService::RIGHT_MANAGE_LOGMEIN_MAPPING        => __('Gerenciar mapeamento LogMeIn -> entidade', 'glpiintegaglpi'),
];

$flagBadges = static function (string $right): string {
    $flags = [];
    if (in_array($right, [
        SecurityPermissionService::RIGHT_REPLY_OWNED_TICKET,
        SecurityPermissionService::RIGHT_SOLVE_OWNED_TICKET,
    ], true)) {
        $flags[] = '<span class="badge bg-info">' . __('Somente próprios', 'glpiintegaglpi') . '</span>';
    }
    if (in_array($right, [
        SecurityPermissionService::RIGHT_VIEW_CONTRACTS_READONLY,
        SecurityPermissionService::RIGHT_VIEW_AUDIT_READONLY_SANITIZED,
        SecurityPermissionService::RIGHT_VIEW_SLA_AGGREGATED,
        SecurityPermissionService::RIGHT_VIEW_EXECUTIVE_DASHBOARD,
    ], true)) {
        $flags[] = '<span class="badge bg-info">' . __('Somente leitura', 'glpiintegaglpi') . '</span>';
    }
    if (in_array($right, [
        SecurityPermissionService::RIGHT_ADMINISTRATIVE_CLOSE,
        SecurityPermissionService::RIGHT_OVERRIDE_ENTITY_MEMORY,
    ], true)) {
        $flags[] = '<span class="badge bg-warning text-dark">' . __('Exige motivo', 'glpiintegaglpi') . '</span>';
    }
    if (in_array($right, [
        SecurityPermissionService::RIGHT_ADMINISTRATIVE_CLOSE,
        SecurityPermissionService::RIGHT_OVERRIDE_ENTITY_MEMORY,
        SecurityPermissionService::RIGHT_EXPORT_OPERATIONAL_REPORTS,
        SecurityPermissionService::RIGHT_EXPORT_EXECUTIVE_REPORTS,
        SecurityPermissionService::RIGHT_MANAGE_SECURITY_CENTER,
    ], true)) {
        $flags[] = '<span class="badge bg-warning text-dark">' . __('Exige auditoria', 'glpiintegaglpi') . '</span>';
    }
    if ($right === SecurityPermissionService::RIGHT_VIEW_MASKED_PII) {
        $flags[] = '<span class="badge bg-secondary">' . __('PII mascarada', 'glpiintegaglpi') . '</span>';
    }

    return implode(' ', $flags);
};

$selfUrl = htmlspecialchars($_SERVER['PHP_SELF'] ?? '', ENT_QUOTES, 'UTF-8');
?>
<div class="card mt-3">
    <div class="card-header d-flex align-items-center justify-content-between">
        <div class="d-flex align-items-center">
            <i class="ti ti-shield-lock me-2"></i>
            <h2 class="card-title mb-0"><?= __('Central de Segurança e Permissões', 'glpiintegaglpi') ?></h2>
        </div>
        <div>
            <?php if ($isSecurityAdmin): ?>
                <span class="badge bg-success">
                    <i class="ti ti-shield-check me-1"></i>
                    <?= __('Administrador de Segurança', 'glpiintegaglpi') ?>
                </span>
            <?php else: ?>
                <span class="badge bg-secondary"><?= __('Somente leitura', 'glpiintegaglpi') ?></span>
            <?php endif; ?>
        </div>
    </div>
    <div class="card-body">
        <p class="text-muted">
            <?= __('Modelo RBAC híbrido: perfis nativos do GLPI continuam controlando sessão e escopo de entidade; esta Central é a fonte canônica das ações específicas do IntegraGLPI por papel.', 'glpiintegaglpi') ?>
        </p>
        <p class="text-muted">
            <strong><?= __('Papel operacional detectado para a sua sessão:', 'glpiintegaglpi') ?></strong>
            <code><?= htmlspecialchars($currentRole, ENT_QUOTES, 'UTF-8') ?></code>
            &middot;
            <strong><?= __('Administrador de Segurança:', 'glpiintegaglpi') ?></strong>
            <code><?= $isSecurityAdmin ? 'sim' : 'não' ?></code>
        </p>
        <div class="alert alert-info">
            <i class="ti ti-info-circle me-1"></i>
            <?= __('Esta tela é o ponto canônico de gestão das permissões granulares do IntegraGLPI. A aba “PluginIntegaglpi permissions” dentro de Administração &gt; Perfis foi mantida apenas como bootstrap (Ler/Atualizar) e aponta para cá.', 'glpiintegaglpi') ?>
        </div>

        <!-- Phase FIX2: bloco "Como funciona" — modelo híbrido GLPI + plugin -->
        <div class="card mb-3">
            <div class="card-header">
                <h3 class="card-title mb-0">
                    <i class="ti ti-help-circle me-1"></i>
                    <?= __('Como funciona', 'glpiintegaglpi') ?>
                </h3>
            </div>
            <div class="card-body">
                <ul class="mb-0 small">
                    <li><strong><?= __('GLPI nativo:', 'glpiintegaglpi') ?></strong>
                        <?= __('controla sessão, perfil ativo e escopo de entidade. Perfil GLPI "Ler/Atualizar" no plugin é apenas o bootstrap de acesso.', 'glpiintegaglpi') ?>
                    </li>
                    <li><strong><?= __('IntegraGLPI granular:', 'glpiintegaglpi') ?></strong>
                        <?= __('controla quem pode assumir, responder, transferir, solucionar, encerrar administrativamente e gerir configurações — papel a papel (Técnico / Supervisão / Direção).', 'glpiintegaglpi') ?>
                    </li>
                    <li><strong><?= __('Direção:', 'glpiintegaglpi') ?></strong>
                        <?= __('é read-only e agregado, sem ações operacionais e sem PII detalhada por padrão.', 'glpiintegaglpi') ?>
                    </li>
                    <li><strong><?= __('Backend enforcement:', 'glpiintegaglpi') ?></strong>
                        <?= __('todas as ações críticas validam CSRF + permissão granular antes de qualquer mutação. Esconder botão na UI não é segurança.', 'glpiintegaglpi') ?>
                    </li>
                    <li><strong><?= __('ROLE_DENIED:', 'glpiintegaglpi') ?></strong>
                        <?= __('é teto inviolável — direitos marcados como negados nunca podem ser concedidos por esta tela (separação de deveres).', 'glpiintegaglpi') ?>
                    </li>
                </ul>
            </div>
        </div>

        <!-- Phase FIX2: ponteiro para o bootstrap GLPI (não é gestão granular) -->
        <div class="card mb-3 border-secondary">
            <div class="card-header">
                <h3 class="card-title mb-0">
                    <i class="ti ti-settings me-1"></i>
                    <?= __('Bootstrap GLPI (Ler / Atualizar)', 'glpiintegaglpi') ?>
                </h3>
            </div>
            <div class="card-body small">
                <p class="mb-2">
                    <?= __('O direito plugin_integaglpi (Ler/Atualizar) é o portão de entrada exigido pelo GLPI para qualquer acesso ao plugin. Ele continua administrado no perfil GLPI — esta tela NÃO o substitui.', 'glpiintegaglpi') ?>
                </p>
                <a class="btn btn-outline-secondary btn-sm"
                   href="<?= htmlspecialchars(Plugin::getWebBasePath() . '/front/profile.form.php', ENT_QUOTES, 'UTF-8') ?>">
                    <i class="ti ti-external-link me-1"></i>
                    <?= __('Abrir bootstrap de perfil GLPI', 'glpiintegaglpi') ?>
                </a>
            </div>
        </div>

        <div class="row mb-4">
            <?php foreach ([
                SecurityPermissionService::ROLE_TECNICO,
                SecurityPermissionService::ROLE_SUPERVISAO,
                SecurityPermissionService::ROLE_DIRECAO,
            ] as $role): ?>
                <div class="col-md-4">
                    <div class="card h-100">
                        <div class="card-header">
                            <h3 class="card-title mb-0"><?= htmlspecialchars($roleLabels[$role], ENT_QUOTES, 'UTF-8') ?></h3>
                        </div>
                        <div class="card-body small">
                            <?= htmlspecialchars($roleDescriptions[$role], ENT_QUOTES, 'UTF-8') ?>
                        </div>
                        <div class="card-footer small text-muted">
                            <?= sprintf(__('%d direitos concedidos · %d explicitamente negados', 'glpiintegaglpi'),
                                count($matrix[$role] ?? []), count($denied[$role] ?? [])) ?>
                        </div>
                    </div>
                </div>
            <?php endforeach; ?>
        </div>

        <form method="post" action="<?= $selfUrl ?>" class="js-integaglpi-security-matrix-form">
            <?= Plugin::renderCsrfToken() ?>
            <input type="hidden" name="action" value="save_matrix">

            <h3><?= __('Matriz de permissões', 'glpiintegaglpi') ?></h3>
            <p class="text-muted small">
                <?= __('Marque para conceder ou desmarque para revogar. Direitos em ROLE_DENIED não podem ser concedidos por aqui (separação de deveres).', 'glpiintegaglpi') ?>
            </p>
            <div class="table-responsive">
                <table class="table table-sm table-striped align-middle js-integaglpi-security-matrix-table">
                    <thead>
                        <tr>
                            <th><?= __('Permissão', 'glpiintegaglpi') ?></th>
                            <th class="text-center"><?= htmlspecialchars($roleLabels[SecurityPermissionService::ROLE_TECNICO], ENT_QUOTES, 'UTF-8') ?></th>
                            <th class="text-center"><?= htmlspecialchars($roleLabels[SecurityPermissionService::ROLE_SUPERVISAO], ENT_QUOTES, 'UTF-8') ?></th>
                            <th class="text-center"><?= htmlspecialchars($roleLabels[SecurityPermissionService::ROLE_DIRECAO], ENT_QUOTES, 'UTF-8') ?></th>
                            <th><?= __('Marcadores', 'glpiintegaglpi') ?></th>
                        </tr>
                    </thead>
                    <tbody>
                        <?php foreach ($allRights as $right):
                            $label = $rightLabels[$right] ?? $right;
                        ?>
                            <tr>
                                <td>
                                    <code class="small text-muted"><?= htmlspecialchars($right, ENT_QUOTES, 'UTF-8') ?></code><br>
                                    <?= htmlspecialchars($label, ENT_QUOTES, 'UTF-8') ?>
                                </td>
                                <?php foreach ([
                                    SecurityPermissionService::ROLE_TECNICO,
                                    SecurityPermissionService::ROLE_SUPERVISAO,
                                    SecurityPermissionService::ROLE_DIRECAO,
                                ] as $role):
                                    $isAllowed = in_array($right, $matrix[$role] ?? [], true);
                                    $isDenied  = in_array($right, $denied[$role] ?? [], true);
                                    $inputId = 'integaglpi_perm_' . $role . '_' . preg_replace('/[^a-z0-9_]+/i', '_', $right);
                                ?>
                                    <td class="text-center">
                                        <?php if ($isDenied): ?>
                                            <span class="badge bg-danger"><?= __('Negado', 'glpiintegaglpi') ?></span>
                                        <?php else: ?>
                                            <div class="form-check form-check-inline m-0">
                                                <input
                                                    class="form-check-input js-integaglpi-perm-checkbox"
                                                    type="checkbox"
                                                    id="<?= htmlspecialchars($inputId, ENT_QUOTES, 'UTF-8') ?>"
                                                    name="matrix[<?= htmlspecialchars($role, ENT_QUOTES, 'UTF-8') ?>][]"
                                                    value="<?= htmlspecialchars($right, ENT_QUOTES, 'UTF-8') ?>"
                                                    <?= $isAllowed ? 'checked' : '' ?>
                                                    <?= $canManage ? '' : 'disabled' ?>
                                                >
                                            </div>
                                        <?php endif; ?>
                                    </td>
                                <?php endforeach; ?>
                                <td><?= $flagBadges($right) ?></td>
                            </tr>
                        <?php endforeach; ?>
                    </tbody>
                </table>
            </div>

            <div class="d-flex gap-2 mt-3 align-items-center flex-wrap">
                <?php if ($canManage): ?>
                    <button type="submit" name="action" value="save_matrix" class="btn btn-primary">
                        <i class="ti ti-device-floppy me-1"></i>
                        <?= __('Salvar permissões', 'glpiintegaglpi') ?>
                    </button>
                    <button type="submit" name="action" value="review_matrix" class="btn btn-outline-secondary">
                        <i class="ti ti-clipboard-check me-1"></i>
                        <?= __('Registrar revisão', 'glpiintegaglpi') ?>
                    </button>
                    <span class="text-muted small">
                        <?= __('“Salvar permissões” persiste alterações via Config GLPI. “Registrar revisão” apenas audita que a matriz foi revisada (noop_v1).', 'glpiintegaglpi') ?>
                    </span>
                <?php else: ?>
                    <div class="alert alert-info mb-0 w-100">
                        <i class="ti ti-info-circle me-1"></i>
                        <?= __('Apenas Administrador de Segurança (Super-Admin GLPI) pode alterar a matriz. Você está em modo somente leitura.', 'glpiintegaglpi') ?>
                    </div>
                <?php endif; ?>
            </div>
        </form>
    </div>
</div>
