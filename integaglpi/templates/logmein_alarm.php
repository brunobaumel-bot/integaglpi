<?php
/**
 * Template: LogMeIn Alarm Rules Administration
 *
 * Variables injected by logmein.alarm.php:
 *   $schemaReady  bool
 *   $hasGuards    bool
 *   $rules        list<array<string, mixed>>
 *   $recentEvents list<array<string, mixed>>
 *   $validTypes   list<string>
 *   $canWrite     bool
 *   $flash        ?array{type: string, message: string}
 *
 * PHASE: integaglpi_logmein_alarm_rules_and_auto_ticket_implementation_001
 */

declare(strict_types=1);

/** @var bool $schemaReady */
/** @var bool $hasGuards */
/** @var list<array<string, mixed>> $rules */
/** @var list<array<string, mixed>> $recentEvents */
/** @var list<string> $validTypes */
/** @var bool $canWrite */
/** @var array{type: string, message: string}|null $flash */

$alertOnlyTypes = ['missing_equipment_tag', 'missing_entity_mapping', 'hardware_change', 'low_disk', 'low_memory'];
$autoTicketTypes = ['host_offline', 'host_not_seen'];

$csrfToken = \GlpiPlugin\Integaglpi\Plugin::getCsrfToken();

function e(mixed $v): string {
    return htmlspecialchars((string) ($v ?? ''), ENT_QUOTES | ENT_HTML5, 'UTF-8');
}
?>

<div class="container-fluid mt-2">

  <?php if (!$schemaReady): ?>
    <div class="alert alert-warning">
      <i class="ti ti-alert-triangle me-1"></i>
      <?= __('Tabelas de alarme não encontradas. Execute as migrations 048 e 049 no PostgreSQL de integração.', 'glpiintegaglpi') ?>
    </div>
  <?php elseif (!$hasGuards): ?>
    <div class="alert alert-info">
      <i class="ti ti-info-circle me-1"></i>
      <?= __('Migration 049 ainda não aplicada. Execute 049_logmein_alarm_guards.sql para guards de checks consecutivos.', 'glpiintegaglpi') ?>
    </div>
  <?php endif; ?>

  <?php if (isset($flash)): ?>
    <div class="alert alert-<?= e($flash['type']) ?> alert-dismissible fade show">
      <?= e($flash['message']) ?>
      <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    </div>
  <?php endif; ?>

  <!-- ── Regras ─────────────────────────────────────────────────────────── -->
  <div class="card mb-3">
    <div class="card-header d-flex justify-content-between align-items-center">
      <h5 class="mb-0"><i class="ti ti-bell-ringing me-1"></i><?= __('Regras de Alarme LogMeIn', 'glpiintegaglpi') ?></h5>
      <?php if ($canWrite && $schemaReady): ?>
        <button class="btn btn-primary btn-sm" type="button" data-bs-toggle="collapse" data-bs-target="#createRulePanel">
          <i class="ti ti-plus me-1"></i><?= __('Nova Regra', 'glpiintegaglpi') ?>
        </button>
      <?php endif; ?>
    </div>

    <!-- Create rule form -->
    <?php if ($canWrite && $schemaReady): ?>
    <div class="collapse" id="createRulePanel">
      <div class="card-body border-bottom bg-light">
        <h6 class="mb-3"><?= __('Criar Nova Regra (enabled=false por padrão)', 'glpiintegaglpi') ?></h6>
        <form method="POST" action="">
          <input type="hidden" name="_glpi_csrf_token" value="<?= e($csrfToken) ?>">
          <input type="hidden" name="action" value="create_rule">

          <div class="row g-2">
            <div class="col-md-4">
              <label class="form-label fw-bold"><?= __('Nome da Regra', 'glpiintegaglpi') ?> *</label>
              <input type="text" name="rule_name" class="form-control form-control-sm" required maxlength="200">
            </div>
            <div class="col-md-3">
              <label class="form-label fw-bold"><?= __('Tipo de Alarme', 'glpiintegaglpi') ?> *</label>
              <select name="alarm_type" class="form-select form-select-sm" required id="alarmTypeSelect">
                <?php foreach ($validTypes as $t): ?>
                  <option value="<?= e($t) ?>"><?= e($t) ?></option>
                <?php endforeach; ?>
              </select>
            </div>
            <div class="col-md-2">
              <label class="form-label fw-bold"><?= __('Cooldown (min)', 'glpiintegaglpi') ?></label>
              <input type="number" name="cooldown_minutes" class="form-control form-control-sm" value="60" min="1" max="10080">
            </div>
            <div class="col-md-3">
              <label class="form-label fw-bold"><?= __('Entidade GLPI (ID)', 'glpiintegaglpi') ?> *</label>
              <input type="number" name="glpi_entities_id" class="form-control form-control-sm" required min="1">
            </div>
          </div>

          <div class="row g-2 mt-1">
            <div class="col-md-3">
              <label class="form-label"><?= __('Fila/Grupo GLPI (ID)', 'glpiintegaglpi') ?></label>
              <input type="number" name="glpi_group_id" class="form-control form-control-sm" min="1">
              <small class="text-muted"><?= __('Obrigatório se create_ticket=true', 'glpiintegaglpi') ?></small>
            </div>
            <div class="col-md-3">
              <label class="form-label"><?= __('Categoria GLPI (ID)', 'glpiintegaglpi') ?></label>
              <input type="number" name="glpi_itil_category_id" class="form-control form-control-sm" min="1">
              <small class="text-muted"><?= __('Obrigatório se create_ticket=true', 'glpiintegaglpi') ?></small>
            </div>
            <div class="col-md-2">
              <label class="form-label"><?= __('not_seen_days', 'glpiintegaglpi') ?></label>
              <input type="number" name="not_seen_days" class="form-control form-control-sm" value="7" min="7">
              <small class="text-muted"><?= __('Só host_not_seen (mín. 7)', 'glpiintegaglpi') ?></small>
            </div>
            <div class="col-md-2">
              <label class="form-label"><?= __('Checks Consec.', 'glpiintegaglpi') ?></label>
              <input type="number" name="min_consecutive_checks" class="form-control form-control-sm" value="2" min="1" max="10">
              <small class="text-muted"><?= __('host_offline (mín. 2 c/ ticket)', 'glpiintegaglpi') ?></small>
            </div>
            <div class="col-md-2">
              <label class="form-label"><?= __('Intervalo Check (min)', 'glpiintegaglpi') ?></label>
              <input type="number" name="consecutive_check_interval_minutes" class="form-control form-control-sm" value="5" min="5">
            </div>
          </div>

          <div class="row g-2 mt-1 align-items-end">
            <div class="col-md-3">
              <div class="form-check mt-3">
                <input type="checkbox" name="create_ticket" value="1" class="form-check-input" id="createTicketCheck">
                <label class="form-check-label" for="createTicketCheck">
                  <?= __('Criar ticket GLPI quando disparar', 'glpiintegaglpi') ?>
                </label>
                <div><small class="text-warning"><?= __('Requer LOGMEIN_AUTO_TICKET_ENABLED=true no .env', 'glpiintegaglpi') ?></small></div>
              </div>
            </div>
            <div class="col-md-2">
              <button type="submit" class="btn btn-primary btn-sm w-100">
                <i class="ti ti-device-floppy me-1"></i><?= __('Salvar', 'glpiintegaglpi') ?>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
    <?php endif; ?>

    <div class="card-body p-0">
      <?php if ($schemaReady && count($rules) > 0): ?>
      <div class="table-responsive">
        <table class="table table-hover table-sm mb-0">
          <thead class="table-dark">
            <tr>
              <th><?= __('Nome', 'glpiintegaglpi') ?></th>
              <th><?= __('Tipo', 'glpiintegaglpi') ?></th>
              <th><?= __('Status', 'glpiintegaglpi') ?></th>
              <th><?= __('Cooldown', 'glpiintegaglpi') ?></th>
              <th><?= __('Entidade', 'glpiintegaglpi') ?></th>
              <th><?= __('Ticket?', 'glpiintegaglpi') ?></th>
              <th><?= __('Ações', 'glpiintegaglpi') ?></th>
            </tr>
          </thead>
          <tbody>
            <?php foreach ($rules as $rule): ?>
            <tr>
              <td><?= e($rule['rule_name']) ?></td>
              <td>
                <code><?= e($rule['alarm_type']) ?></code>
                <?php if (in_array($rule['alarm_type'], $alertOnlyTypes, true)): ?>
                  <span class="badge bg-secondary ms-1"><?= __('alert-only', 'glpiintegaglpi') ?></span>
                <?php elseif (in_array($rule['alarm_type'], $autoTicketTypes, true)): ?>
                  <span class="badge bg-info ms-1"><?= __('auto-ticket', 'glpiintegaglpi') ?></span>
                <?php endif; ?>
              </td>
              <td>
                <?php if ($rule['enabled']): ?>
                  <span class="badge bg-success"><?= __('Ativa', 'glpiintegaglpi') ?></span>
                <?php else: ?>
                  <span class="badge bg-secondary"><?= __('Inativa', 'glpiintegaglpi') ?></span>
                <?php endif; ?>
              </td>
              <td><?= e($rule['cooldown_minutes']) ?>min</td>
              <td><?= e($rule['glpi_entities_id']) ?></td>
              <td>
                <?php if ($rule['create_ticket']): ?>
                  <span class="badge bg-warning text-dark"><?= __('Sim', 'glpiintegaglpi') ?></span>
                <?php else: ?>
                  <span class="text-muted"><?= __('Não', 'glpiintegaglpi') ?></span>
                <?php endif; ?>
              </td>
              <td>
                <?php if ($canWrite): ?>
                  <!-- Toggle enabled -->
                  <form method="POST" action="" class="d-inline">
                    <input type="hidden" name="_glpi_csrf_token" value="<?= e($csrfToken) ?>">
                    <input type="hidden" name="action" value="toggle_enabled">
                    <input type="hidden" name="rule_id" value="<?= e($rule['id']) ?>">
                    <input type="hidden" name="enabled" value="<?= $rule['enabled'] ? '0' : '1' ?>">
                    <button type="submit" class="btn btn-sm <?= $rule['enabled'] ? 'btn-outline-warning' : 'btn-outline-success' ?>">
                      <?= $rule['enabled'] ? __('Desabilitar', 'glpiintegaglpi') : __('Habilitar', 'glpiintegaglpi') ?>
                    </button>
                  </form>
                  <!-- Delete -->
                  <form method="POST" action="" class="d-inline"
                        onsubmit="return confirm('<?= __('Confirmar exclusão da regra?', 'glpiintegaglpi') ?>')">
                    <input type="hidden" name="_glpi_csrf_token" value="<?= e($csrfToken) ?>">
                    <input type="hidden" name="action" value="delete_rule">
                    <input type="hidden" name="rule_id" value="<?= e($rule['id']) ?>">
                    <button type="submit" class="btn btn-sm btn-outline-danger ms-1">
                      <i class="ti ti-trash"></i>
                    </button>
                  </form>
                <?php endif; ?>
              </td>
            </tr>
            <?php endforeach; ?>
          </tbody>
        </table>
      </div>
      <?php elseif ($schemaReady): ?>
        <div class="p-3 text-muted"><?= __('Nenhuma regra cadastrada.', 'glpiintegaglpi') ?></div>
      <?php endif; ?>
    </div>
  </div>

  <!-- ── Eventos recentes ────────────────────────────────────────────────── -->
  <div class="card">
    <div class="card-header">
      <h5 class="mb-0"><i class="ti ti-history me-1"></i><?= __('Eventos Recentes (últimos 50)', 'glpiintegaglpi') ?></h5>
    </div>
    <div class="card-body p-0">
      <?php if ($schemaReady && count($recentEvents) > 0): ?>
      <div class="table-responsive">
        <table class="table table-hover table-sm mb-0">
          <thead class="table-dark">
            <tr>
              <th><?= __('Data/Hora', 'glpiintegaglpi') ?></th>
              <th><?= __('Regra', 'glpiintegaglpi') ?></th>
              <th><?= __('Host', 'glpiintegaglpi') ?></th>
              <th><?= __('Tipo', 'glpiintegaglpi') ?></th>
              <th><?= __('Ticket', 'glpiintegaglpi') ?></th>
              <th><?= __('Cooldown', 'glpiintegaglpi') ?></th>
              <th><?= __('Dedupe', 'glpiintegaglpi') ?></th>
            </tr>
          </thead>
          <tbody>
            <?php foreach ($recentEvents as $event): ?>
            <tr>
              <td><small><?= e($event['created_at']) ?></small></td>
              <td><small><?= e($event['rule_name'] ?? $event['rule_id']) ?></small></td>
              <td><code><?= e($event['hostname']) ?></code></td>
              <td><code><?= e($event['alarm_type']) ?></code></td>
              <td>
                <?php if (!empty($event['glpi_ticket_id'])): ?>
                  <span class="badge bg-info">#<?= e($event['glpi_ticket_id']) ?></span>
                <?php else: ?>
                  <span class="text-muted">—</span>
                <?php endif; ?>
              </td>
              <td><?= $event['cooldown_skipped'] ? '<span class="badge bg-warning text-dark">skip</span>' : '' ?></td>
              <td><?= $event['dedupe_hit'] ? '<span class="badge bg-secondary">dup</span>' : '' ?></td>
            </tr>
            <?php endforeach; ?>
          </tbody>
        </table>
      </div>
      <?php elseif ($schemaReady): ?>
        <div class="p-3 text-muted"><?= __('Nenhum evento registrado ainda.', 'glpiintegaglpi') ?></div>
      <?php endif; ?>
    </div>
  </div>

  <!-- ── Info segurança ─────────────────────────────────────────────────── -->
  <div class="alert alert-light mt-3 border">
    <small class="text-muted">
      <i class="ti ti-shield-lock me-1"></i>
      <?= __('Alarmes alert-only nunca criam chamados. Auto-ticket requer LOGMEIN_AUTO_TICKET_ENABLED=true + create_ticket=true por regra + entidade + categoria + fila. Cooldown mínimo: 60 min para host_offline e host_not_seen. Produção bloqueada até promoção manual.', 'glpiintegaglpi') ?>
    </small>
  </div>

</div>
