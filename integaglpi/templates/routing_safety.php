<?php

declare(strict_types=1);

/**
 * @var array<string, mixed> $report
 */

$esc = static fn (string $value): string => Html::cleanInputText($value);
$maskPhone = static function (string $phone): string {
    $digits = preg_replace('/\D+/', '', $phone) ?? '';
    if (strlen($digits) < 8) {
        return '***';
    }

    return '+' . substr($digits, 0, 2) . '******' . substr($digits, -4);
};
$config = is_array($report['routing_config'] ?? null) ? $report['routing_config'] : [];
$issues = is_array($report['issues'] ?? null) ? $report['issues'] : [];
$abandoned = is_array($report['abandoned'] ?? null) ? $report['abandoned'] : [];
$events = is_array($report['recent_events'] ?? null) ? $report['recent_events'] : [];
?>

<div class="d-flex align-items-center justify-content-between mb-3">
    <h2 class="mb-0"><?= $esc(__('Filas e Roteamento', 'glpiintegaglpi')); ?></h2>
    <a class="btn btn-sm btn-outline-secondary" href="<?= $esc(\GlpiPlugin\Integaglpi\Plugin::getQueueAdminUrl() . '?tab=queues'); ?>">
        <?= $esc(__('Configurar filas', 'glpiintegaglpi')); ?>
    </a>
</div>

<?php if (empty($report['configured'])) : ?>
    <div class="alert alert-warning">
        <?= $esc(__('External PostgreSQL connection not configured. Configure it first.', 'glpiintegaglpi')); ?>
    </div>
<?php else : ?>
    <div class="alert alert-info">
        <?= $esc(__('Relatorio read-only. Esta tela nao corrige, reprocessa, move tickets nem fecha conversas.', 'glpiintegaglpi')); ?>
    </div>

    <div class="card mb-3">
        <div class="card-header"><?= $esc(__('Fallback global', 'glpiintegaglpi')); ?></div>
        <div class="card-body">
            <div class="row g-3">
                <div class="col-md-3">
                    <strong><?= $esc(__('Status', 'glpiintegaglpi')); ?></strong><br>
                    <?php if (!empty($config['fallback_enabled'])) : ?>
                        <span class="badge bg-success"><?= $esc(__('Habilitado', 'glpiintegaglpi')); ?></span>
                    <?php else : ?>
                        <span class="badge bg-secondary"><?= $esc(__('Desabilitado', 'glpiintegaglpi')); ?></span>
                    <?php endif; ?>
                </div>
                <div class="col-md-3">
                    <strong><?= $esc(__('Fila fallback', 'glpiintegaglpi')); ?></strong><br>
                    <?= $esc((string) ($config['fallback_queue_name'] ?? '—')); ?>
                    <?php if (!empty($config['fallback_queue_id'])) : ?>
                        <span class="text-muted">#<?= (int) $config['fallback_queue_id']; ?></span>
                    <?php endif; ?>
                </div>
                <div class="col-md-3">
                    <strong><?= $esc(__('Grupo GLPI fallback', 'glpiintegaglpi')); ?></strong><br>
                    <?= !empty($config['fallback_glpi_group_id']) ? (int) $config['fallback_glpi_group_id'] : '—'; ?>
                </div>
                <div class="col-md-3">
                    <strong><?= $esc(__('Limite de tentativas invalidas', 'glpiintegaglpi')); ?></strong><br>
                    <?= (int) ($config['max_invalid_queue_attempts'] ?? 3); ?>
                </div>
            </div>
        </div>
    </div>

    <div class="card mb-3">
        <div class="card-header"><?= $esc(__('Problemas de configuracao', 'glpiintegaglpi')); ?></div>
        <div class="card-body p-0">
            <?php if ($issues === []) : ?>
                <p class="p-3 mb-0 text-muted"><?= $esc(__('Nenhum problema encontrado no limite consultado.', 'glpiintegaglpi')); ?></p>
            <?php else : ?>
                <table class="table table-sm table-hover mb-0">
                    <thead>
                        <tr>
                            <th><?= $esc(__('Severidade', 'glpiintegaglpi')); ?></th>
                            <th><?= $esc(__('Tipo', 'glpiintegaglpi')); ?></th>
                            <th><?= $esc(__('Opcao', 'glpiintegaglpi')); ?></th>
                            <th><?= $esc(__('Fila', 'glpiintegaglpi')); ?></th>
                            <th><?= $esc(__('Grupo', 'glpiintegaglpi')); ?></th>
                            <th><?= $esc(__('Mensagem', 'glpiintegaglpi')); ?></th>
                        </tr>
                    </thead>
                    <tbody>
                        <?php foreach ($issues as $issue) : ?>
                            <tr>
                                <td><?= $esc((string) ($issue['severity'] ?? '')); ?></td>
                                <td><code><?= $esc((string) ($issue['type'] ?? '')); ?></code></td>
                                <td><?= $esc((string) ($issue['option_key'] ?? '—')); ?></td>
                                <td><?= !empty($issue['queue_id']) ? (int) $issue['queue_id'] : '—'; ?></td>
                                <td><?= !empty($issue['glpi_group_id']) ? (int) $issue['glpi_group_id'] : '—'; ?></td>
                                <td><?= $esc((string) ($issue['message'] ?? '')); ?></td>
                            </tr>
                        <?php endforeach; ?>
                    </tbody>
                </table>
            <?php endif; ?>
        </div>
    </div>

    <div class="card mb-3">
        <div class="card-header">
            <?= $esc(__('Conversas aguardando fila ha mais de 24h', 'glpiintegaglpi')); ?>
        </div>
        <div class="card-body p-0">
            <?php if ($abandoned === []) : ?>
                <p class="p-3 mb-0 text-muted"><?= $esc(__('Nenhuma conversa abandonada encontrada.', 'glpiintegaglpi')); ?></p>
            <?php else : ?>
                <table class="table table-sm table-hover mb-0">
                    <thead>
                        <tr>
                            <th><?= $esc(__('Conversation', 'glpiintegaglpi')); ?></th>
                            <th><?= $esc(__('Telefone', 'glpiintegaglpi')); ?></th>
                            <th><?= $esc(__('Tentativas invalidas', 'glpiintegaglpi')); ?></th>
                            <th><?= $esc(__('Ultima atividade', 'glpiintegaglpi')); ?></th>
                            <th><?= $esc(__('Motivo', 'glpiintegaglpi')); ?></th>
                        </tr>
                    </thead>
                    <tbody>
                        <?php foreach ($abandoned as $row) : ?>
                            <tr>
                                <td><code><?= $esc((string) ($row['id'] ?? '')); ?></code></td>
                                <td><?= $esc($maskPhone((string) ($row['phone_e164'] ?? ''))); ?></td>
                                <td><?= (int) ($row['invalid_queue_attempts'] ?? 0); ?></td>
                                <td><?= $esc((string) ($row['updated_at'] ?? '')); ?></td>
                                <td><code>awaiting_queue_selection_timeout_candidate</code></td>
                            </tr>
                        <?php endforeach; ?>
                    </tbody>
                </table>
            <?php endif; ?>
        </div>
    </div>

    <div class="card">
        <div class="card-header"><?= $esc(__('Eventos recentes de roteamento', 'glpiintegaglpi')); ?></div>
        <div class="card-body p-0">
            <?php if ($events === []) : ?>
                <p class="p-3 mb-0 text-muted"><?= $esc(__('Nenhum evento recente de roteamento encontrado.', 'glpiintegaglpi')); ?></p>
            <?php else : ?>
                <table class="table table-sm table-hover mb-0">
                    <thead>
                        <tr>
                            <th><?= $esc(__('Data', 'glpiintegaglpi')); ?></th>
                            <th><?= $esc(__('Evento', 'glpiintegaglpi')); ?></th>
                            <th><?= $esc(__('Status', 'glpiintegaglpi')); ?></th>
                            <th><?= $esc(__('Severidade', 'glpiintegaglpi')); ?></th>
                            <th><?= $esc(__('Ticket', 'glpiintegaglpi')); ?></th>
                            <th><?= $esc(__('Correlation', 'glpiintegaglpi')); ?></th>
                        </tr>
                    </thead>
                    <tbody>
                        <?php foreach ($events as $event) : ?>
                            <tr>
                                <td><?= $esc((string) ($event['created_at'] ?? '')); ?></td>
                                <td><code><?= $esc((string) ($event['event_type'] ?? '')); ?></code></td>
                                <td><?= $esc((string) ($event['status'] ?? '')); ?></td>
                                <td><?= $esc((string) ($event['severity'] ?? '')); ?></td>
                                <td><?= !empty($event['ticket_id']) ? (int) $event['ticket_id'] : '—'; ?></td>
                                <td><code><?= $esc((string) ($event['correlation_id'] ?? '')); ?></code></td>
                            </tr>
                        <?php endforeach; ?>
                    </tbody>
                </table>
            <?php endif; ?>
        </div>
    </div>
<?php endif; ?>
