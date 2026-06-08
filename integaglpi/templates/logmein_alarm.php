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
 *   $groups       list<array{group_id: string, group_name: string, host_count: int}>
 *   $ruleTargets  array<string, list<array<string, mixed>>>
 *
 * PHASE: integaglpi_logmein_alarm_rules_and_auto_ticket_implementation_001
 * PHASE: integaglpi_post_smoke_operational_gaps_hml_fix_prod_report_001
 */

declare(strict_types=1);

/** @var bool $schemaReady */
/** @var bool $hasGuards */
/** @var list<array<string, mixed>> $rules */
/** @var list<array<string, mixed>> $recentEvents */
/** @var list<string> $validTypes */
/** @var bool $canWrite */
/** @var array{type: string, message: string}|null $flash */
/** @var list<array{group_id: string, group_name: string, host_count: int}> $groups */
/** @var array<string, list<array<string, mixed>>> $ruleTargets */

$alertOnlyTypes  = ['missing_equipment_tag', 'missing_entity_mapping', 'hardware_change', 'low_disk', 'low_memory'];
$autoTicketTypes = ['host_offline', 'host_not_seen'];

$csrfToken = \GlpiPlugin\Integaglpi\Plugin::getCsrfToken();
$selfUrl   = htmlspecialchars($_SERVER['PHP_SELF'], ENT_QUOTES | ENT_HTML5, 'UTF-8');

function ealarm(mixed $v): string {
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
    <div class="alert alert-<?= ealarm($flash['type']) ?> alert-dismissible fade show" role="alert">
      <?= ealarm($flash['message']) ?>
      <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    </div>
  <?php endif; ?>

  <!-- ── Nova Regra (accordion form) ──────────────────────────────────────── -->
  <?php if ($canWrite && $schemaReady): ?>
  <div class="card mb-3">
    <div class="card-header d-flex justify-content-between align-items-center">
      <h5 class="mb-0"><i class="ti ti-plus me-1"></i><?= __('Nova Regra de Alarme', 'glpiintegaglpi') ?></h5>
      <button class="btn btn-primary btn-sm" type="button"
              data-bs-toggle="collapse" data-bs-target="#createRulePanel" aria-expanded="false">
        <i class="ti ti-chevron-down me-1"></i><?= __('Expandir', 'glpiintegaglpi') ?>
      </button>
    </div>
    <div class="collapse" id="createRulePanel">
      <div class="card-body bg-light">
        <form method="POST" action="<?= $selfUrl ?>">
          <input type="hidden" name="_glpi_csrf_token" value="<?= ealarm($csrfToken) ?>">
          <input type="hidden" name="action" value="create_rule">

          <div class="accordion" id="newRuleAccordion">

            <!-- ① Identificação -->
            <div class="accordion-item">
              <h2 class="accordion-header">
                <button class="accordion-button" type="button"
                        data-bs-toggle="collapse" data-bs-target="#acc-geral" aria-expanded="true">
                  <i class="ti ti-tag me-2"></i><?= __('① Identificação', 'glpiintegaglpi') ?>
                </button>
              </h2>
              <div id="acc-geral" class="accordion-collapse collapse show" data-bs-parent="#newRuleAccordion">
                <div class="accordion-body">
                  <div class="row g-3">
                    <div class="col-md-5">
                      <label class="form-label fw-bold"><?= __('Nome da Regra', 'glpiintegaglpi') ?> *</label>
                      <input type="text" name="rule_name" class="form-control form-control-sm"
                             required maxlength="200" placeholder="Ex: Offline Clínica Norte">
                    </div>
                    <div class="col-md-4">
                      <label class="form-label fw-bold"><?= __('Tipo de Alarme', 'glpiintegaglpi') ?> *</label>
                      <select name="alarm_type" class="form-select form-select-sm" required id="alarmTypeSelect">
                        <?php foreach ($validTypes as $t): ?>
                          <option value="<?= ealarm($t) ?>"><?= ealarm($t) ?>
                            <?php if (in_array($t, $alertOnlyTypes, true)): ?>(alert-only)<?php endif; ?>
                            <?php if (in_array($t, $autoTicketTypes, true)): ?>(auto-ticket)<?php endif; ?>
                          </option>
                        <?php endforeach; ?>
                      </select>
                      <small class="text-muted" id="alarmTypeHint"></small>
                    </div>
                    <div class="col-md-3">
                      <label class="form-label fw-bold"><?= __('Entidade GLPI (ID)', 'glpiintegaglpi') ?> *</label>
                      <input type="number" name="glpi_entities_id" class="form-control form-control-sm"
                             required min="1" placeholder="Ex: 5">
                      <small class="text-muted"><?= __('Obrigatório; entidade raiz (0) proibida', 'glpiintegaglpi') ?></small>
                    </div>
                  </div>
                </div>
              </div>
            </div><!-- /Identificação -->

            <!-- ② Condições -->
            <div class="accordion-item">
              <h2 class="accordion-header">
                <button class="accordion-button collapsed" type="button"
                        data-bs-toggle="collapse" data-bs-target="#acc-cond" aria-expanded="false">
                  <i class="ti ti-settings me-2"></i><?= __('② Condições de Disparo', 'glpiintegaglpi') ?>
                </button>
              </h2>
              <div id="acc-cond" class="accordion-collapse collapse" data-bs-parent="#newRuleAccordion">
                <div class="accordion-body">
                  <div class="row g-3">
                    <div class="col-md-3">
                      <label class="form-label fw-bold"><?= __('Cooldown (min)', 'glpiintegaglpi') ?></label>
                      <input type="number" name="cooldown_minutes" class="form-control form-control-sm"
                             value="60" min="1" max="10080">
                      <small class="text-warning" id="cooldownHint"></small>
                    </div>
                    <div class="col-md-3" id="notSeenDaysWrap" style="display:none">
                      <label class="form-label"><?= __('Dias sem contato (host_not_seen)', 'glpiintegaglpi') ?></label>
                      <input type="number" name="not_seen_days" class="form-control form-control-sm"
                             value="7" min="7">
                      <small class="text-muted"><?= __('Mínimo 7 dias', 'glpiintegaglpi') ?></small>
                    </div>
                    <div class="col-md-3" id="consecChecksWrap">
                      <label class="form-label"><?= __('Checks Consecutivos (host_offline)', 'glpiintegaglpi') ?></label>
                      <input type="number" name="min_consecutive_checks" class="form-control form-control-sm"
                             value="2" min="1" max="10">
                      <small class="text-muted"><?= __('Mínimo 2 quando create_ticket=true', 'glpiintegaglpi') ?></small>
                    </div>
                    <div class="col-md-3" id="consecIntervalWrap">
                      <label class="form-label"><?= __('Intervalo Check (min)', 'glpiintegaglpi') ?></label>
                      <input type="number" name="consecutive_check_interval_minutes"
                             class="form-control form-control-sm" value="5" min="5">
                    </div>
                  </div>
                </div>
              </div>
            </div><!-- /Condições -->

            <!-- ③ Chamado -->
            <div class="accordion-item" id="acc-ticket-item">
              <h2 class="accordion-header">
                <button class="accordion-button collapsed" type="button"
                        data-bs-toggle="collapse" data-bs-target="#acc-ticket" aria-expanded="false">
                  <i class="ti ti-ticket me-2"></i><?= __('③ Abertura de Chamado (opcional)', 'glpiintegaglpi') ?>
                </button>
              </h2>
              <div id="acc-ticket" class="accordion-collapse collapse" data-bs-parent="#newRuleAccordion">
                <div class="accordion-body">
                  <div class="form-check mb-3">
                    <input type="checkbox" name="create_ticket" value="1" class="form-check-input" id="createTicketCheck">
                    <label class="form-check-label fw-bold" for="createTicketCheck">
                      <?= __('Criar chamado GLPI quando alarme disparar', 'glpiintegaglpi') ?>
                    </label>
                    <div>
                      <small class="text-warning">
                        <?= __('Requer LOGMEIN_AUTO_TICKET_ENABLED=true + entidade + categoria + fila. Apenas tipos auto-ticket (host_offline, host_not_seen).', 'glpiintegaglpi') ?>
                      </small>
                    </div>
                  </div>
                  <div class="row g-3" id="ticketFieldsWrap" style="display:none">
                    <div class="col-md-4">
                      <label class="form-label fw-bold"><?= __('Fila/Grupo GLPI (ID)', 'glpiintegaglpi') ?> *</label>
                      <input type="number" name="glpi_group_id" class="form-control form-control-sm" min="1"
                             placeholder="Ex: 10">
                    </div>
                    <div class="col-md-4">
                      <label class="form-label fw-bold"><?= __('Categoria GLPI (ID)', 'glpiintegaglpi') ?> *</label>
                      <input type="number" name="glpi_itil_category_id" class="form-control form-control-sm" min="1"
                             placeholder="Ex: 20">
                    </div>
                  </div>
                </div>
              </div>
            </div><!-- /Chamado -->

          </div><!-- /accordion -->

          <div class="mt-3 d-flex align-items-center gap-2">
            <button type="submit" class="btn btn-primary btn-sm">
              <i class="ti ti-device-floppy me-1"></i><?= __('Criar Regra (desabilitada por padrão)', 'glpiintegaglpi') ?>
            </button>
            <span class="text-muted small"><?= __('Alvos podem ser adicionados após criação da regra.', 'glpiintegaglpi') ?></span>
          </div>
        </form>
      </div>
    </div>
  </div>
  <?php endif; ?>

  <!-- ── Lista de Regras ────────────────────────────────────────────────────── -->
  <div class="card mb-3">
    <div class="card-header">
      <h5 class="mb-0"><i class="ti ti-bell-ringing me-1"></i>
        <?= __('Regras de Alarme LogMeIn', 'glpiintegaglpi') ?>
        <span class="badge bg-secondary ms-1"><?= count($rules) ?></span>
      </h5>
    </div>
    <div class="card-body p-0">
      <?php if ($schemaReady && count($rules) > 0): ?>
      <div class="accordion" id="rulesAccordion">
        <?php foreach ($rules as $idx => $rule): ?>
        <?php
          $ruleId        = (string) $rule['id'];
          $targets       = $ruleTargets[$ruleId] ?? [];
          $targetCount   = count($targets);
          $isAlertOnly   = in_array($rule['alarm_type'], $alertOnlyTypes, true);
          $isAutoTicket  = in_array($rule['alarm_type'], $autoTicketTypes, true);
          $accordionId   = 'rule-' . preg_replace('/[^a-z0-9]/i', '-', $ruleId);
        ?>
        <div class="accordion-item border-0 border-bottom">
          <h2 class="accordion-header">
            <button class="accordion-button collapsed py-2" type="button"
                    data-bs-toggle="collapse"
                    data-bs-target="#<?= ealarm($accordionId) ?>">
              <!-- Status badge -->
              <?php if ($rule['enabled']): ?>
                <span class="badge bg-success me-2" title="Ativa"><?= __('ON', 'glpiintegaglpi') ?></span>
              <?php else: ?>
                <span class="badge bg-secondary me-2" title="Inativa"><?= __('OFF', 'glpiintegaglpi') ?></span>
              <?php endif; ?>
              <!-- Rule info -->
              <strong class="me-2"><?= ealarm($rule['rule_name']) ?></strong>
              <code class="small text-muted me-2"><?= ealarm($rule['alarm_type']) ?></code>
              <?php if ($isAlertOnly): ?>
                <span class="badge bg-secondary me-1"><?= __('alert-only', 'glpiintegaglpi') ?></span>
              <?php elseif ($isAutoTicket): ?>
                <span class="badge bg-info text-dark me-1"><?= __('auto-ticket', 'glpiintegaglpi') ?></span>
              <?php endif; ?>
              <?php if ($rule['create_ticket']): ?>
                <span class="badge bg-warning text-dark me-1"><i class="ti ti-ticket me-1"></i><?= __('ticket', 'glpiintegaglpi') ?></span>
              <?php endif; ?>
              <span class="badge bg-light text-dark ms-auto me-2">
                <i class="ti ti-devices me-1"></i><?= $targetCount ?> <?= __('alvos', 'glpiintegaglpi') ?>
              </span>
              <span class="text-muted small"><?= ealarm($rule['cooldown_minutes']) ?>min</span>
            </button>
          </h2>

          <div id="<?= ealarm($accordionId) ?>" class="accordion-collapse collapse">
            <div class="accordion-body pt-2 pb-3">

              <!-- Rule summary -->
              <div class="row g-2 mb-3">
                <div class="col-auto">
                  <small class="text-muted"><?= __('Entidade GLPI:', 'glpiintegaglpi') ?></small>
                  <strong><?= ealarm($rule['glpi_entities_id']) ?></strong>
                </div>
                <?php if ($rule['glpi_group_id']): ?>
                <div class="col-auto">
                  <small class="text-muted"><?= __('Fila/Grupo:', 'glpiintegaglpi') ?></small>
                  <strong><?= ealarm($rule['glpi_group_id']) ?></strong>
                </div>
                <?php endif; ?>
                <?php if ($rule['glpi_itil_category_id']): ?>
                <div class="col-auto">
                  <small class="text-muted"><?= __('Categoria:', 'glpiintegaglpi') ?></small>
                  <strong><?= ealarm($rule['glpi_itil_category_id']) ?></strong>
                </div>
                <?php endif; ?>
                <div class="col-auto">
                  <small class="text-muted"><?= __('Checks consec.:', 'glpiintegaglpi') ?></small>
                  <strong><?= ealarm($rule['min_consecutive_checks'] ?? 1) ?></strong>
                </div>
              </div>

              <!-- Actions row -->
              <?php if ($canWrite): ?>
              <div class="d-flex gap-2 mb-3 flex-wrap">
                <!-- Toggle enabled -->
                <form method="POST" action="<?= $selfUrl ?>" class="d-inline">
                  <input type="hidden" name="_glpi_csrf_token" value="<?= ealarm($csrfToken) ?>">
                  <input type="hidden" name="action" value="toggle_enabled">
                  <input type="hidden" name="rule_id" value="<?= ealarm($ruleId) ?>">
                  <input type="hidden" name="enabled" value="<?= $rule['enabled'] ? '0' : '1' ?>">
                  <button type="submit" class="btn btn-sm <?= $rule['enabled'] ? 'btn-outline-warning' : 'btn-outline-success' ?>">
                    <i class="ti <?= $rule['enabled'] ? 'ti-player-pause' : 'ti-player-play' ?> me-1"></i>
                    <?= $rule['enabled'] ? __('Desabilitar', 'glpiintegaglpi') : __('Habilitar', 'glpiintegaglpi') ?>
                  </button>
                </form>
                <!-- Delete -->
                <form method="POST" action="<?= $selfUrl ?>" class="d-inline"
                      onsubmit="return confirm('<?= __('Confirmar exclusão da regra e todos os seus alvos?', 'glpiintegaglpi') ?>')">
                  <input type="hidden" name="_glpi_csrf_token" value="<?= ealarm($csrfToken) ?>">
                  <input type="hidden" name="action" value="delete_rule">
                  <input type="hidden" name="rule_id" value="<?= ealarm($ruleId) ?>">
                  <button type="submit" class="btn btn-sm btn-outline-danger">
                    <i class="ti ti-trash me-1"></i><?= __('Excluir Regra', 'glpiintegaglpi') ?>
                  </button>
                </form>
              </div>
              <?php endif; ?>

              <!-- ── Targets section ─────────────────────────────────────── -->
              <div class="border rounded p-3 bg-white">
                <h6 class="mb-2">
                  <i class="ti ti-devices me-1"></i>
                  <?= __('Dispositivos Monitorados', 'glpiintegaglpi') ?>
                  <span class="badge bg-secondary"><?= $targetCount ?></span>
                  <small class="text-muted ms-2 fw-normal"><?= __('(vazio = monitorar TODOS da entidade)', 'glpiintegaglpi') ?></small>
                </h6>

                <?php if ($targetCount > 0): ?>
                <div class="table-responsive mb-2">
                  <table class="table table-sm table-hover mb-0">
                    <thead class="table-light">
                      <tr>
                        <th><?= __('Hostname', 'glpiintegaglpi') ?></th>
                        <th><?= __('Host ID', 'glpiintegaglpi') ?></th>
                        <?php if ($canWrite): ?><th></th><?php endif; ?>
                      </tr>
                    </thead>
                    <tbody>
                      <?php foreach ($targets as $target): ?>
                      <tr>
                        <td><code><?= ealarm($target['hostname']) ?></code></td>
                        <td><small class="text-muted"><?= ealarm($target['host_id']) ?></small></td>
                        <?php if ($canWrite): ?>
                        <td>
                          <form method="POST" action="<?= $selfUrl ?>" class="d-inline">
                            <input type="hidden" name="_glpi_csrf_token" value="<?= ealarm($csrfToken) ?>">
                            <input type="hidden" name="action" value="remove_target">
                            <input type="hidden" name="rule_id" value="<?= ealarm($ruleId) ?>">
                            <input type="hidden" name="host_id" value="<?= ealarm($target['host_id']) ?>">
                            <button type="submit" class="btn btn-sm btn-outline-danger btn-xs py-0 px-1"
                                    title="<?= __('Remover alvo', 'glpiintegaglpi') ?>">
                              <i class="ti ti-x"></i>
                            </button>
                          </form>
                        </td>
                        <?php endif; ?>
                      </tr>
                      <?php endforeach; ?>
                    </tbody>
                  </table>
                </div>
                <?php elseif ($schemaReady): ?>
                  <div class="text-muted small mb-2">
                    <i class="ti ti-info-circle me-1"></i>
                    <?= __('Nenhum dispositivo específico — a regra será avaliada para TODOS os hosts da entidade.', 'glpiintegaglpi') ?>
                  </div>
                <?php endif; ?>

                <!-- Add target UI -->
                <?php if ($canWrite): ?>
                <div class="mt-2" id="addTargetSection-<?= ealarm($accordionId) ?>">
                  <!-- Target selection mode -->
                  <div class="d-flex align-items-center gap-2 mb-2 flex-wrap">
                    <span class="small fw-bold"><?= __('Adicionar dispositivos por:', 'glpiintegaglpi') ?></span>
                    <div class="btn-group btn-group-sm" role="group">
                      <button type="button" class="btn btn-outline-secondary active"
                              onclick="lmAlarmTargetMode('<?= ealarm($accordionId) ?>', 'search')">
                        <i class="ti ti-search me-1"></i><?= __('Busca', 'glpiintegaglpi') ?>
                      </button>
                      <button type="button" class="btn btn-outline-secondary"
                              onclick="lmAlarmTargetMode('<?= ealarm($accordionId) ?>', 'group')">
                        <i class="ti ti-sitemap me-1"></i><?= __('Grupo LogMeIn', 'glpiintegaglpi') ?>
                      </button>
                    </div>
                  </div>

                  <!-- Mode: Search by hostname/tag -->
                  <div id="targetMode-search-<?= ealarm($accordionId) ?>">
                    <div class="input-group input-group-sm mb-2">
                      <input type="text" class="form-control"
                             id="hostSearch-<?= ealarm($accordionId) ?>"
                             placeholder="<?= __('Hostname ou etiqueta...', 'glpiintegaglpi') ?>"
                             oninput="lmHostSearch('<?= ealarm($accordionId) ?>','')"
                             autocomplete="off">
                      <span class="input-group-text"><i class="ti ti-search"></i></span>
                    </div>
                    <div id="hostResults-<?= ealarm($accordionId) ?>" class="list-group mb-2" style="max-height:200px;overflow-y:auto;"></div>
                  </div>

                  <!-- Mode: Add by group -->
                  <div id="targetMode-group-<?= ealarm($accordionId) ?>" style="display:none">
                    <?php if (count($groups) > 0): ?>
                    <select class="form-select form-select-sm mb-2"
                            id="groupSelect-<?= ealarm($accordionId) ?>"
                            onchange="lmHostSearch('<?= ealarm($accordionId) ?>', this.value)">
                      <option value=""><?= __('— selecionar grupo —', 'glpiintegaglpi') ?></option>
                      <?php foreach ($groups as $g): ?>
                        <option value="<?= ealarm($g['group_id']) ?>">
                          <?= ealarm($g['group_name']) ?> (<?= (int) $g['host_count'] ?> hosts)
                        </option>
                      <?php endforeach; ?>
                    </select>
                    <div id="hostResults-<?= ealarm($accordionId) ?>-g" class="list-group mb-2" style="max-height:200px;overflow-y:auto;"></div>
                    <?php else: ?>
                      <div class="text-muted small"><?= __('Nenhum grupo disponível no cache.', 'glpiintegaglpi') ?></div>
                    <?php endif; ?>
                  </div>

                  <!-- Add selected hosts form (populated by JS) -->
                  <form method="POST" action="<?= $selfUrl ?>" id="addTargetForm-<?= ealarm($accordionId) ?>">
                    <input type="hidden" name="_glpi_csrf_token" value="<?= ealarm($csrfToken) ?>">
                    <input type="hidden" name="action" value="add_target">
                    <input type="hidden" name="rule_id" value="<?= ealarm($ruleId) ?>">
                    <input type="hidden" name="host_id" id="addHostId-<?= ealarm($accordionId) ?>" value="">
                    <input type="hidden" name="hostname" id="addHostname-<?= ealarm($accordionId) ?>" value="">
                    <button type="submit" class="btn btn-sm btn-success" id="addTargetBtn-<?= ealarm($accordionId) ?>" style="display:none">
                      <i class="ti ti-plus me-1"></i><span id="addTargetBtnLabel-<?= ealarm($accordionId) ?>"></span>
                    </button>
                  </form>
                </div>
                <?php endif; ?>
              </div><!-- /targets section -->

            </div><!-- /accordion-body -->
          </div><!-- /accordion-collapse -->
        </div><!-- /accordion-item -->
        <?php endforeach; ?>
      </div><!-- /rulesAccordion -->
      <?php elseif ($schemaReady): ?>
        <div class="p-3 text-muted">
          <i class="ti ti-info-circle me-1"></i>
          <?= __('Nenhuma regra cadastrada. Use o formulário acima para criar.', 'glpiintegaglpi') ?>
        </div>
      <?php endif; ?>
    </div>
  </div>

  <!-- ── Eventos recentes ────────────────────────────────────────────────── -->
  <div class="card mb-3">
    <div class="card-header d-flex justify-content-between align-items-center">
      <h5 class="mb-0"><i class="ti ti-history me-1"></i><?= __('Eventos Recentes (últimos 50)', 'glpiintegaglpi') ?></h5>
      <button class="btn btn-sm btn-outline-secondary" type="button"
              data-bs-toggle="collapse" data-bs-target="#eventsPanel">
        <i class="ti ti-chevron-down"></i>
      </button>
    </div>
    <div class="collapse" id="eventsPanel">
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
                <td><small><?= ealarm($event['created_at']) ?></small></td>
                <td><small><?= ealarm($event['rule_name'] ?? $event['rule_id']) ?></small></td>
                <td><code><?= ealarm($event['hostname']) ?></code></td>
                <td><code><?= ealarm($event['alarm_type']) ?></code></td>
                <td>
                  <?php if (!empty($event['glpi_ticket_id'])): ?>
                    <span class="badge bg-info">#<?= ealarm($event['glpi_ticket_id']) ?></span>
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
  </div>

  <!-- ── Info segurança ─────────────────────────────────────────────────── -->
  <div class="alert alert-light border mt-2">
    <small class="text-muted">
      <i class="ti ti-shield-lock me-1"></i>
      <?= __('Alarmes alert-only nunca criam chamados. Auto-ticket requer LOGMEIN_AUTO_TICKET_ENABLED=true + create_ticket=true por regra + entidade + categoria + fila. Cooldown mínimo: 60 min para host_offline e host_not_seen. Vazio em Alvos = monitorar todos os hosts da entidade. Produção bloqueada até promoção manual.', 'glpiintegaglpi') ?>
    </small>
  </div>

</div><!-- /container -->

<script>
// ── LogMeIn Alarm UI helpers ──────────────────────────────────────────────────

(function () {
  const SELF = <?= json_encode($_SERVER['PHP_SELF'] ?? '', JSON_UNESCAPED_SLASHES) ?>;

  // Show/hide ticket fields and hints based on alarm type
  var alarmTypeSelect = document.getElementById('alarmTypeSelect');
  var createTicketCheck = document.getElementById('createTicketCheck');
  var ALERT_ONLY = <?= json_encode($alertOnlyTypes) ?>;
  var AUTO_TICKET = <?= json_encode($autoTicketTypes) ?>;

  function updateAlarmTypeHints() {
    if (!alarmTypeSelect) return;
    var t = alarmTypeSelect.value;
    var hint = document.getElementById('alarmTypeHint');
    var cooldownHint = document.getElementById('cooldownHint');
    var notSeenWrap = document.getElementById('notSeenDaysWrap');
    var consecWrap = document.getElementById('consecChecksWrap');
    var consecIntervalWrap = document.getElementById('consecIntervalWrap');
    var ticketItem = document.getElementById('acc-ticket-item');

    if (ALERT_ONLY.indexOf(t) !== -1) {
      if (hint) hint.textContent = '⚠ Alert-only: nunca cria chamado.';
      if (ticketItem) ticketItem.style.opacity = '0.5';
      if (createTicketCheck) { createTicketCheck.checked = false; createTicketCheck.disabled = true; }
    } else {
      if (hint) hint.textContent = '';
      if (ticketItem) ticketItem.style.opacity = '1';
      if (createTicketCheck) createTicketCheck.disabled = false;
    }

    if (t === 'host_not_seen') {
      if (notSeenWrap) notSeenWrap.style.display = '';
      if (cooldownHint) cooldownHint.textContent = '';
    } else {
      if (notSeenWrap) notSeenWrap.style.display = 'none';
    }

    if (t === 'host_offline') {
      if (consecWrap) consecWrap.style.display = '';
      if (consecIntervalWrap) consecIntervalWrap.style.display = '';
      if (cooldownHint) cooldownHint.textContent = 'Mínimo 60 min para host_offline com create_ticket=true.';
    } else {
      if (consecWrap) consecWrap.style.display = 'none';
      if (consecIntervalWrap) consecIntervalWrap.style.display = 'none';
      if (cooldownHint) cooldownHint.textContent = '';
    }
  }

  if (alarmTypeSelect) {
    alarmTypeSelect.addEventListener('change', updateAlarmTypeHints);
    updateAlarmTypeHints();
  }

  // Show/hide ticket fields when create_ticket is checked
  if (createTicketCheck) {
    createTicketCheck.addEventListener('change', function () {
      var wrap = document.getElementById('ticketFieldsWrap');
      if (wrap) wrap.style.display = this.checked ? '' : 'none';
    });
  }
})();

// ── Target mode toggle ────────────────────────────────────────────────────────

function lmAlarmTargetMode(accordionId, mode) {
  var searchDiv = document.getElementById('targetMode-search-' + accordionId);
  var groupDiv  = document.getElementById('targetMode-group-' + accordionId);
  if (searchDiv) searchDiv.style.display = (mode === 'search') ? '' : 'none';
  if (groupDiv)  groupDiv.style.display  = (mode === 'group')  ? '' : 'none';
  // clear results
  var r1 = document.getElementById('hostResults-' + accordionId);
  if (r1) r1.innerHTML = '';
}

// ── AJAX host search ──────────────────────────────────────────────────────────

var _lmSearchTimers = {};

function lmHostSearch(accordionId, groupId) {
  var isGroupMode = (groupId !== '');
  var resultsId   = 'hostResults-' + accordionId + (isGroupMode ? '-g' : '');
  var inputEl     = document.getElementById('hostSearch-' + accordionId);
  var q           = isGroupMode ? '' : (inputEl ? inputEl.value.trim() : '');

  if (!isGroupMode && q.length < 2) {
    var r = document.getElementById(resultsId);
    if (r) r.innerHTML = '';
    return;
  }

  clearTimeout(_lmSearchTimers[accordionId]);
  _lmSearchTimers[accordionId] = setTimeout(function () {
    var url = window.location.pathname + '?action=search_hosts&q=' + encodeURIComponent(q)
              + (groupId ? '&group_id=' + encodeURIComponent(groupId) : '');
    fetch(url, { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        lmRenderHostResults(accordionId, resultsId, data.hosts || [], q, groupId);
      })
      .catch(function () {});
  }, isGroupMode ? 0 : 350);
}

function lmRenderHostResults(accordionId, resultsId, hosts, q, groupId) {
  var container = document.getElementById(resultsId);
  if (!container) return;

  if (hosts.length === 0) {
    container.innerHTML = '<div class="list-group-item list-group-item-action text-muted small py-1">'
      + '<?= __('Nenhum dispositivo encontrado.', 'glpiintegaglpi') ?>'
      + '</div>';
    return;
  }

  var html = '';
  hosts.forEach(function (h) {
    var statusColor = h.status === 'online' ? 'success' : (h.status === 'offline' ? 'danger' : 'secondary');
    var label = h.hostname + (h.equipment_tag ? ' [' + h.equipment_tag + ']' : '')
                           + ' — ' + h.group_name;
    html += '<button type="button" class="list-group-item list-group-item-action py-1 small"'
          + ' onclick="lmSelectHost(\'' + accordionId + '\','
          + '\'' + h.host_id.replace(/'/g, "\\'") + '\','
          + '\'' + h.hostname.replace(/'/g, "\\'") + '\')">'
          + '<span class="badge bg-' + statusColor + ' me-2" style="width:14px;height:14px;display:inline-block;border-radius:50%"></span>'
          + label
          + '</button>';
  });

  if (hosts.length === 100) {
    html += '<div class="list-group-item text-muted small py-1"><?= __('Mostrando primeiros 100 resultados. Refine a busca.', 'glpiintegaglpi') ?></div>';
  }

  container.innerHTML = html;
}

function lmSelectHost(accordionId, hostId, hostname) {
  var idEl    = document.getElementById('addHostId-' + accordionId);
  var nameEl  = document.getElementById('addHostname-' + accordionId);
  var btn     = document.getElementById('addTargetBtn-' + accordionId);
  var lblEl   = document.getElementById('addTargetBtnLabel-' + accordionId);

  if (idEl) idEl.value = hostId;
  if (nameEl) nameEl.value = hostname;
  if (btn) btn.style.display = '';
  if (lblEl) lblEl.textContent = '<?= __('Adicionar:', 'glpiintegaglpi') ?> ' + hostname;
}
</script>
