<?php

declare(strict_types=1);

use GlpiPlugin\Integaglpi\Plugin;
use GlpiPlugin\Integaglpi\Service\SecurityPermissionService;

/** @var string $currentRole */
/** @var bool $canManage */
/** @var array<string, list<string>> $matrix */
/** @var array<string, list<string>> $denied */
/** @var list<string> $allRights */

$roleLabels = [
    SecurityPermissionService::ROLE_TECNICO => __('Técnico', 'glpiintegaglpi'),
    SecurityPermissionService::ROLE_SUPERVISAO => __('Supervisão', 'glpiintegaglpi'),
    SecurityPermissionService::ROLE_DIRECAO => __('Direção', 'glpiintegaglpi'),
];

$roleDescriptions = [
    SecurityPermissionService::ROLE_TECNICO => __('Responde apenas atendimentos que assumiu. Sem gestão de configurações, IA ou segurança. Vê apenas a própria fila com PII mascarada.', 'glpiintegaglpi'),
    SecurityPermissionService::ROLE_SUPERVISAO => __('Opera dentro da entidade ativa: assume, transfere, soluciona, encerra administrativamente com motivo. Não gerencia segredos de IA nem Central de Segurança.', 'glpiintegaglpi'),
    SecurityPermissionService::ROLE_DIRECAO => __('Read-only e agregado: SLA, contratos, dashboards executivos, auditoria sanitizada. Sem ações operacionais e sem PII por padrão.', 'glpiintegaglpi'),
];

$rightLabels = [
    SecurityPermissionService::RIGHT_VIEW_CENTRAL => __('Visualizar Central WhatsApp', 'glpiintegaglpi'),
    SecurityPermissionService::RIGHT_VIEW_OWN_QUEUE => __('Ver fila própria', 'glpiintegaglpi'),
    SecurityPermissionService::RIGHT_VIEW_ALL_QUEUES => __('Ver todas as filas da entidade', 'glpiintegaglpi'),
    SecurityPermissionService::RIGHT_CLAIM_TICKET => __('Assumir atendimento', 'glpiintegaglpi'),
    SecurityPermissionService::RIGHT_REPLY_OWNED_TICKET => __('Responder apenas o próprio chamado', 'glpiintegaglpi'),
    SecurityPermissionService::RIGHT_REPLY_ANY_TICKET => __('Responder qualquer chamado', 'glpiintegaglpi'),
    SecurityPermissionService::RIGHT_TRANSFER_TICKET => __('Transferir atendimento', 'glpiintegaglpi'),
    SecurityPermissionService::RIGHT_SOLVE_OWNED_TICKET => __('Solucionar apenas o próprio chamado', 'glpiintegaglpi'),
    SecurityPermissionService::RIGHT_SOLVE_TICKET => __('Solucionar qualquer chamado', 'glpiintegaglpi'),
    SecurityPermissionService::RIGHT_ADMINISTRATIVE_CLOSE => __('Encerrar administrativamente', 'glpiintegaglpi'),
    SecurityPermissionService::RIGHT_SELECT_ENTITY => __('Selecionar entidade', 'glpiintegaglpi'),
    SecurityPermissionService::RIGHT_OVERRIDE_ENTITY_MEMORY => __('Sobrepor memória de entidade', 'glpiintegaglpi'),
    SecurityPermissionService::RIGHT_MANAGE_MESSAGE_SETTINGS => __('Gerenciar mensagens', 'glpiintegaglpi'),
    SecurityPermissionService::RIGHT_MANAGE_TEMPLATES => __('Gerenciar templates WhatsApp', 'glpiintegaglpi'),
    SecurityPermissionService::RIGHT_VIEW_AI_CONSOLE => __('Ver Console IA', 'glpiintegaglpi'),
    SecurityPermissionService::RIGHT_USE_COPILOT_AS_DRAFT => __('Usar copiloto como rascunho', 'glpiintegaglpi'),
    SecurityPermissionService::RIGHT_MANAGE_AI_SETTINGS => __('Gerenciar configurações de IA', 'glpiintegaglpi'),
    SecurityPermissionService::RIGHT_MANAGE_AI_SECRETS => __('Gerenciar segredos de IA', 'glpiintegaglpi'),
    SecurityPermissionService::RIGHT_VIEW_AI_ALERTS => __('Ver alertas IA', 'glpiintegaglpi'),
    SecurityPermissionService::RIGHT_REVIEW_AI_ALERTS => __('Revisar alertas IA', 'glpiintegaglpi'),
    SecurityPermissionService::RIGHT_VIEW_AUDIT_OPERATIONAL => __('Ver auditoria operacional', 'glpiintegaglpi'),
    SecurityPermissionService::RIGHT_VIEW_AUDIT_READONLY_SANITIZED => __('Ver auditoria sanitizada', 'glpiintegaglpi'),
    SecurityPermissionService::RIGHT_EXPORT_OPERATIONAL_REPORTS => __('Exportar relatórios operacionais', 'glpiintegaglpi'),
    SecurityPermissionService::RIGHT_EXPORT_EXECUTIVE_REPORTS => __('Exportar relatórios executivos sanitizados', 'glpiintegaglpi'),
    SecurityPermissionService::RIGHT_VIEW_EXECUTIVE_DASHBOARD => __('Ver dashboard executivo', 'glpiintegaglpi'),
    SecurityPermissionService::RIGHT_VIEW_SECURITY_CENTER => __('Ver Central de Segurança', 'glpiintegaglpi'),
    SecurityPermissionService::RIGHT_MANAGE_SECURITY_CENTER => __('Gerenciar Central de Segurança', 'glpiintegaglpi'),
    SecurityPermissionService::RIGHT_VIEW_MASKED_PII => __('Ver PII mascarada', 'glpiintegaglpi'),
    SecurityPermissionService::RIGHT_VIEW_UNMASKED_PII => __('Ver PII não mascarada', 'glpiintegaglpi'),
    SecurityPermissionService::RIGHT_ENFORCE_ENTITY_ISOLATION => __('Escopo de entidade obrigatório', 'glpiintegaglpi'),
];

$badge = static function (bool $allowed, bool $explicitDenied): string {
    if ($explicitDenied) {
        return '<span class="badge bg-danger">' . __('Negado', 'glpiintegaglpi') . '</span>';
    }
    if ($allowed) {
        return '<span class="badge bg-success">' . __('Permitido', 'glpiintegaglpi') . '</span>';
    }
    return '<span class="badge bg-secondary">' . __('Não concedido', 'glpiintegaglpi') . '</span>';
};
?>
<div class="card mt-3">
    <div class="card-header d-flex align-items-center">
        <i class="ti ti-shield-lock me-2"></i>
        <h2 class="card-title mb-0"><?= __('Central de Segurança e Permissões', 'glpiintegaglpi') ?></h2>
    </div>
    <div class="card-body">
        <p class="text-muted">
            <?= __('Modelo híbrido: o GLPI controla sessão, perfil e entidade; o plugin controla ações operacionais granulares.', 'glpiintegaglpi') ?>
        </p>
        <p class="text-muted">
            <strong><?= __('Papel detectado:', 'glpiintegaglpi') ?></strong>
            <code><?= htmlspecialchars($currentRole, ENT_QUOTES, 'UTF-8') ?></code>
        </p>

        <div class="row mb-4">
            <?php foreach ([SecurityPermissionService::ROLE_TECNICO, SecurityPermissionService::ROLE_SUPERVISAO, SecurityPermissionService::ROLE_DIRECAO] as $role): ?>
                <div class="col-md-4">
                    <div class="card h-100">
                        <div class="card-header">
                            <h3 class="card-title mb-0"><?= htmlspecialchars($roleLabels[$role], ENT_QUOTES, 'UTF-8') ?></h3>
                        </div>
                        <div class="card-body small">
                            <?= htmlspecialchars($roleDescriptions[$role], ENT_QUOTES, 'UTF-8') ?>
                        </div>
                        <div class="card-footer small text-muted">
                            <?= sprintf(__('%d direitos concedidos · %d explicitamente negados', 'glpiintegaglpi'), count($matrix[$role] ?? []), count($denied[$role] ?? [])) ?>
                        </div>
                    </div>
                </div>
            <?php endforeach; ?>
        </div>

        <h3><?= __('Matriz de permissões', 'glpiintegaglpi') ?></h3>
        <div class="table-responsive">
            <table class="table table-sm table-striped align-middle">
                <thead>
                    <tr>
                        <th><?= __('Permissão', 'glpiintegaglpi') ?></th>
                        <th class="text-center"><?= htmlspecialchars($roleLabels[SecurityPermissionService::ROLE_TECNICO], ENT_QUOTES, 'UTF-8') ?></th>
                        <th class="text-center"><?= htmlspecialchars($roleLabels[SecurityPermissionService::ROLE_SUPERVISAO], ENT_QUOTES, 'UTF-8') ?></th>
                        <th class="text-center"><?= htmlspecialchars($roleLabels[SecurityPermissionService::ROLE_DIRECAO], ENT_QUOTES, 'UTF-8') ?></th>
                    </tr>
                </thead>
                <tbody>
                    <?php foreach ($allRights as $right): ?>
                        <?php
                        $label = $rightLabels[$right] ?? $right;
                        $tecAllowed = in_array($right, $matrix[SecurityPermissionService::ROLE_TECNICO] ?? [], true);
                        $supAllowed = in_array($right, $matrix[SecurityPermissionService::ROLE_SUPERVISAO] ?? [], true);
                        $dirAllowed = in_array($right, $matrix[SecurityPermissionService::ROLE_DIRECAO] ?? [], true);
                        $tecDenied = in_array($right, $denied[SecurityPermissionService::ROLE_TECNICO] ?? [], true);
                        $supDenied = in_array($right, $denied[SecurityPermissionService::ROLE_SUPERVISAO] ?? [], true);
                        $dirDenied = in_array($right, $denied[SecurityPermissionService::ROLE_DIRECAO] ?? [], true);
                        ?>
                        <tr>
                            <td>
                                <code class="small text-muted"><?= htmlspecialchars($right, ENT_QUOTES, 'UTF-8') ?></code><br>
                                <?= htmlspecialchars($label, ENT_QUOTES, 'UTF-8') ?>
                            </td>
                            <td class="text-center"><?= $badge($tecAllowed, $tecDenied) ?></td>
                            <td class="text-center"><?= $badge($supAllowed, $supDenied) ?></td>
                            <td class="text-center"><?= $badge($dirAllowed, $dirDenied) ?></td>
                        </tr>
                    <?php endforeach; ?>
                </tbody>
            </table>
        </div>

        <?php if ($canManage): ?>
            <form method="post" action="<?= htmlspecialchars($_SERVER['PHP_SELF'], ENT_QUOTES, 'UTF-8') ?>" class="mt-3">
                <?= Plugin::renderCsrfToken() ?>
                <button type="submit" class="btn btn-primary">
                    <i class="ti ti-device-floppy me-1"></i>
                    <?= __('Registrar revisão da matriz', 'glpiintegaglpi') ?>
                </button>
            </form>
        <?php else: ?>
            <div class="alert alert-info mt-3">
                <?= __('A matriz está em modo somente leitura para o seu perfil.', 'glpiintegaglpi') ?>
            </div>
        <?php endif; ?>
    </div>
</div>
