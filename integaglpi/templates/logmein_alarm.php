<?php
/**
 * Template: LogMeIn Alarm Rules Administration — Gold UI
 *
 * Variables injected by logmein.alarm.php:
 *   $schemaReady  bool
 *   $hasGuards    bool
 *   $rules        list<array<string, mixed>>
 *   $recentEvents list<array<string, mixed>>
 *   $validTypes   list<string>
 *   $autoTicketTypes list<string>
 *   $unsupportedTypes list<string>
 *   $canWrite     bool
 *   $flash        ?array{type: string, message: string}
 *   $groups       list<array{group_id: string, group_name: string, host_count: int}>
 *   $entities     list<array{id:int, name:string}>
 *   $ruleTargets  array<string, list<array<string, mixed>>>
 *   $ruleStats    array<string, array{total_events: int, last_trigger: string|null, tickets_created: int, cooldown_skipped: int, dedupe_hit: int}>
 *
 * PHASE: integaglpi_logmein_alarm_rules_and_auto_ticket_implementation_001
 * PHASE: integaglpi_post_smoke_operational_gaps_hml_fix_prod_report_001
 * PHASE: integaglpi_logmein_alarm_ui_gold_hml_001
 *
 * BLOCKS DECLARED:
 *   - BLOCK_NEEDS_SCHEMA_CHANGE: maintenance/silence windows require new table
 *     (integaglpi_logmein_alarm_maintenance: rule_id, start_at, end_at, reason)
 *   - BLOCK_NEEDS_SCHEMA_CHANGE: target exclusions require column `excluded BOOLEAN`
 *     on integaglpi_logmein_alarm_targets or a new integaglpi_logmein_alarm_exclusions table
 */

declare(strict_types=1);

/** @var bool $schemaReady */
/** @var bool $hasGuards */
/** @var list<array<string, mixed>> $rules */
/** @var list<array<string, mixed>> $recentEvents */
/** @var list<string> $validTypes */
/** @var list<string> $autoTicketTypes */
/** @var list<string> $unsupportedTypes */
/** @var bool $canWrite */
/** @var array{type: string, message: string}|null $flash */
/** @var list<array{group_id: string, group_name: string, host_count: int}> $groups */
/** @var list<array{id:int, name:string}> $entities */
/** @var array<string, list<array<string, mixed>>> $ruleTargets */
/** @var array<string, array{total_events: int, last_trigger: string|null, tickets_created: int, cooldown_skipped: int, dedupe_hit: int}> $ruleStats */

$alertOnlyTypes  = ['hardware_change'];
$autoTicketTypes = $autoTicketTypes ?? ['host_offline', 'host_not_seen', 'missing_equipment_tag', 'missing_entity_mapping', 'low_disk', 'low_memory'];
$forbiddenTypes  = $unsupportedTypes ?? ['high_cpu', 'disk_health_smart', 'network_bandwidth', 'software_compliance', 'antivirus_outdated', 'antivirus_inactive', 'antivirus_threat', 'raid_degraded'];
$allTypeLabels = [
    'host_offline'          => 'host_offline — Equipamento offline',
    'host_not_seen'         => 'host_not_seen — Sem comunicação',
    'low_disk'              => 'low_disk — Espaço em disco baixo',
    'low_memory'            => 'low_memory — Memória instalada abaixo do mínimo',
    'missing_equipment_tag' => 'missing_equipment_tag — Sem patrimônio/etiqueta',
    'missing_entity_mapping'=> 'missing_entity_mapping — Grupo sem entidade',
    'hardware_change'       => 'hardware_change — Mudança de hardware',
    'raid_degraded'         => 'raid_degraded — RAID com falha/degradado',
    'antivirus_outdated'    => 'antivirus_outdated — Antivírus desatualizado',
    'antivirus_inactive'    => 'antivirus_inactive — Antivírus inativo',
    'antivirus_threat'      => 'antivirus_threat — Ameaça detectada',
];

$csrfToken = \GlpiPlugin\Integaglpi\Plugin::getCsrfToken();
$selfUrl   = htmlspecialchars($_SERVER['PHP_SELF'], ENT_QUOTES | ENT_HTML5, 'UTF-8');

/**
 * HTML-escape any value safely for use in innerHTML and attributes.
 */
function ealarm(mixed $v): string {
    return htmlspecialchars((string) ($v ?? ''), ENT_QUOTES | ENT_HTML5, 'UTF-8');
}

/**
 * Format a UTC timestamp string as a local short datetime, or return a placeholder.
 */
function fmtAlarmDate(?string $ts): string {
    if ($ts === null || $ts === '') {
        return '—';
    }
    try {
        $dt = new DateTimeImmutable($ts);
        return $dt->format('d/m/Y H:i');
    } catch (Throwable) {
        return ealarm($ts);
    }
}
?>

<style>
/* ── LogMeIn Alarm Gold UI ─────────────────────────────────── */
.lm-alarm-card          { border-left: 4px solid #6c757d; transition: border-color .2s; }
.lm-alarm-card.enabled  { border-left-color: #198754; }
.lm-alarm-card.disabled { border-left-color: #adb5bd; }
.lm-stat-chip           { font-size: .72rem; padding: 2px 7px; border-radius: 20px; white-space: nowrap; }
.lm-type-badge          { font-size: .7rem; letter-spacing: .02em; }
.lm-dry-result          { font-size: .82rem; }
.lm-dry-result table    { font-size: .8rem; }
.lm-hist-mini           { font-size: .78rem; max-height: 220px; overflow-y: auto; }
.lm-section-toggle      { cursor: pointer; user-select: none; }
.lm-acc-body            { animation: fadeInDown .15s ease; }
@keyframes fadeInDown    { from { opacity:0; transform:translateY(-4px) } to { opacity:1; transform:none } }
</style>

<div class="container-fluid mt-2">

  <!-- ── Schema warnings ──────────────────────────────────────────────────── -->
  <?php if (!$schemaReady): ?>
    <div class="alert alert-warning">
      <i class="ti ti-alert-triangle me-1"></i>
      <?= __('Tabelas de alarme não encontradas. Execute as migrations 048 e 049 no PostgreSQL de integração.', 'glpiintegaglpi') ?>
    </div>
  <?php elseif (!$hasGuards): ?>
    <div class="alert alert-info">
      <i class="ti ti-info-circle me-1"></i>
      <?= __('Migration 049 (guards) ainda não aplicada. Execute 049_logmein_alarm_guards.sql.', 'glpiintegaglpi') ?>
    </div>
  <?php endif; ?>

  <?php if (isset($flash)): ?>
    <div class="alert alert-<?= ealarm($flash['type']) ?> alert-dismissible fade show">
      <?= ealarm($flash['message']) ?>
      <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    </div>
  <?php endif; ?>

  <!-- ── Page header ──────────────────────────────────────────────────────── -->
  <div class="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2">
    <div>
      <h4 class="mb-0 fw-bold">
        <i class="ti ti-bell-ringing me-2 text-warning"></i><?= __('Alarmes LogMeIn', 'glpiintegaglpi') ?>
      </h4>
      <small class="text-muted">
        <?= __('Monitore equipamentos e valide regras antes de qualquer automação.', 'glpiintegaglpi') ?>
        <span class="badge bg-secondary ms-1"><?= count($rules) ?> <?= __('regras', 'glpiintegaglpi') ?></span>
      </small>
    </div>
    <?php if ($canWrite && $schemaReady): ?>
    <div class="d-flex gap-2">
      <button class="btn btn-primary btn-sm" type="button"
              data-bs-toggle="collapse" data-bs-target="#createRulePanel">
        <i class="ti ti-plus me-1"></i><?= __('+ Nova Regra', 'glpiintegaglpi') ?>
      </button>
      <?php if (count($rules) > 0): ?>
      <button class="btn btn-outline-info btn-sm" type="button" id="globalDryRunBtn"
              onclick="lmGlobalDryRun()">
        <i class="ti ti-test-pipe me-1"></i><?= __('Dry-run Global', 'glpiintegaglpi') ?>
      </button>
      <?php endif; ?>
    </div>
    <?php endif; ?>
  </div>

  <!-- ── Nova Regra (accordion / colapsável) ──────────────────────────────── -->
  <?php if ($canWrite && $schemaReady): ?>
  <div class="card mb-3 shadow-sm">
    <div class="collapse" id="createRulePanel">
      <div class="card-body bg-light">
        <h6 class="fw-bold mb-3"><i class="ti ti-plus me-1"></i><?= __('Nova Regra de Alarme', 'glpiintegaglpi') ?></h6>
        <form method="POST" action="<?= $selfUrl ?>">
          <input type="hidden" name="_glpi_csrf_token" value="<?= ealarm($csrfToken) ?>">
          <input type="hidden" name="action" value="create_rule">

          <div class="accordion" id="newRuleAccordion">

            <!-- ① Identificação -->
            <div class="accordion-item">
              <h2 class="accordion-header">
                <button class="accordion-button py-2" type="button"
                        data-bs-toggle="collapse" data-bs-target="#acc-geral" aria-expanded="true">
                  <i class="ti ti-tag me-2 text-primary"></i><strong><?= __('① Identificação', 'glpiintegaglpi') ?></strong>
                </button>
              </h2>
              <div id="acc-geral" class="accordion-collapse collapse show" data-bs-parent="#newRuleAccordion">
                <div class="accordion-body lm-acc-body">
                  <div class="row g-3">
                    <div class="col-md-6">
                      <label class="form-label fw-bold"><?= __('Nome da Regra', 'glpiintegaglpi') ?> *</label>
                      <input type="text" name="rule_name" class="form-control form-control-sm" required
                             placeholder="<?= __('Ex: Servidores offline - Empresa X', 'glpiintegaglpi') ?>">
                    </div>
                    <div class="col-md-6">
                      <label class="form-label fw-bold"><?= __('Tipo de Alarme', 'glpiintegaglpi') ?> *</label>
                      <select name="alarm_type" id="alarmTypeSelect" class="form-select form-select-sm" required>
                        <option value=""><?= __('— selecionar —', 'glpiintegaglpi') ?></option>
                        <?php foreach ($allTypeLabels as $t => $label): ?>
                          <?php
                            $isUnsupported = in_array($t, $forbiddenTypes, true);
                            $isAlertOnlyOpt = in_array($t, $alertOnlyTypes, true);
                            $isAutoTicketOpt = in_array($t, $autoTicketTypes, true);
                            if (!in_array($t, $validTypes, true) && !$isUnsupported) {
                                continue;
                            }
                          ?>
                          <option value="<?= ealarm($t) ?>"
                                  data-alert-only="<?= $isAlertOnlyOpt ? '1' : '0' ?>"
                                  data-auto-ticket="<?= $isAutoTicketOpt ? '1' : '0' ?>"
                                  data-unsupported="<?= $isUnsupported ? '1' : '0' ?>"
                                  <?= $isUnsupported ? 'disabled' : '' ?>>
                            <?= ealarm($label) ?>
                            <?php if ($isUnsupported): ?>(fonte indisponível)<?php endif; ?>
                            <?php if ($isAlertOnlyOpt): ?>(sem snapshot)<?php endif; ?>
                            <?php if ($isAutoTicketOpt): ?>(pode gerar ticket)<?php endif; ?>
                          </option>
                        <?php endforeach; ?>
                      </select>
                      <div id="alarmTypeHint" class="form-text text-warning fw-bold mt-1"></div>
                    </div>
                    <div class="col-md-4">
                      <label class="form-label fw-bold"><?= __('Entidade GLPI', 'glpiintegaglpi') ?> *</label>
                      <select name="glpi_entities_id" class="form-select form-select-sm" required>
                        <option value=""><?= __('— selecionar entidade —', 'glpiintegaglpi') ?></option>
                        <?php foreach (($entities ?? []) as $entity): ?>
                          <option value="<?= (int) $entity['id'] ?>"><?= ealarm($entity['name']) ?> (#<?= (int) $entity['id'] ?>)</option>
                        <?php endforeach; ?>
                      </select>
                      <div class="form-text"><?= __('Lista interna do GLPI; entidade raiz proibida.', 'glpiintegaglpi') ?></div>
                    </div>
                    <div class="col-md-8">
                      <label class="form-label fw-bold text-muted fw-normal"><?= __('Obs / Documentação interna', 'glpiintegaglpi') ?></label>
                      <input type="text" name="rule_notes" class="form-control form-control-sm"
                             placeholder="<?= __('Notas internas para o supervisor (não enviadas ao cliente)', 'glpiintegaglpi') ?>">
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- ② Escopo / Alvos (info only no create; adiciona alvos após criar) -->
            <div class="accordion-item">
              <h2 class="accordion-header">
                <button class="accordion-button collapsed py-2" type="button"
                        data-bs-toggle="collapse" data-bs-target="#acc-scope">
                  <i class="ti ti-devices me-2 text-info"></i><strong><?= __('② Escopo / Alvos', 'glpiintegaglpi') ?></strong>
                </button>
              </h2>
              <div id="acc-scope" class="accordion-collapse collapse" data-bs-parent="#newRuleAccordion">
                <div class="accordion-body lm-acc-body">
                  <div class="alert alert-light border small mb-0">
                    <i class="ti ti-info-circle me-1"></i>
                    <?= __('Alvos (dispositivos específicos, grupos LogMeIn) são adicionados após criar a regra. Sem alvos = avalia TODOS os hosts da entidade.', 'glpiintegaglpi') ?>
                    <br><span class="text-muted">
                      <?= __('Exclusões de alvos específicos requerem alteração de schema (coluna `excluded` em alarm_targets) — disponível em fase futura.', 'glpiintegaglpi') ?>
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <!-- ③ Condições de Disparo -->
            <div class="accordion-item">
              <h2 class="accordion-header">
                <button class="accordion-button collapsed py-2" type="button"
                        data-bs-toggle="collapse" data-bs-target="#acc-cond">
                  <i class="ti ti-adjustments me-2 text-warning"></i><strong><?= __('③ Condições de Disparo', 'glpiintegaglpi') ?></strong>
                </button>
              </h2>
              <div id="acc-cond" class="accordion-collapse collapse" data-bs-parent="#newRuleAccordion">
                <div class="accordion-body lm-acc-body">
                  <div class="row g-3">
                    <div class="col-md-4" id="notSeenDaysWrap" style="display:none">
                      <label class="form-label fw-bold"><?= __('Não visto há (dias)', 'glpiintegaglpi') ?> *</label>
                      <input type="number" name="not_seen_days" class="form-control form-control-sm" min="7" value="7">
                    </div>
                    <div class="col-md-4" id="consecChecksWrap" style="display:none">
                      <label class="form-label fw-bold"><?= __('Checks consecutivos mínimos', 'glpiintegaglpi') ?></label>
                      <input type="number" name="min_consecutive_checks" class="form-control form-control-sm" min="1" max="10" value="2">
                    </div>
                    <div class="col-md-4" id="consecIntervalWrap" style="display:none">
                      <label class="form-label fw-bold"><?= __('Intervalo entre checks (min)', 'glpiintegaglpi') ?></label>
                      <input type="number" name="consecutive_check_interval_minutes" class="form-control form-control-sm" min="5" max="1440" value="5">
                    </div>
                    <div class="col-md-4" id="offlineMinutesWrap" style="display:none">
                      <label class="form-label fw-bold"><?= __('Offline há pelo menos (min)', 'glpiintegaglpi') ?></label>
                      <input type="number" name="offline_minutes" class="form-control form-control-sm" min="1" max="1440" value="5">
                    </div>
                    <div class="col-md-4" id="diskPercentWrap" style="display:none">
                      <label class="form-label fw-bold"><?= __('Percentual livre máximo (%)', 'glpiintegaglpi') ?></label>
                      <input type="number" name="free_percent_threshold" class="form-control form-control-sm" min="1" max="100" value="20">
                    </div>
                    <div class="col-md-4" id="diskGbWrap" style="display:none">
                      <label class="form-label fw-bold"><?= __('Livre máximo opcional (GB)', 'glpiintegaglpi') ?></label>
                      <input type="number" name="free_space_gb_threshold" class="form-control form-control-sm" min="0" max="9999" step="0.1" value="">
                    </div>
                    <div class="col-md-4" id="partitionWrap" style="display:none">
                      <label class="form-label fw-bold"><?= __('Partição opcional', 'glpiintegaglpi') ?></label>
                      <input type="text" name="partition_selector" class="form-control form-control-sm" maxlength="80" placeholder="C:, /, Data">
                    </div>
                    <div class="col-md-4" id="memoryWrap" style="display:none">
                      <label class="form-label fw-bold"><?= __('Memória mínima instalada (GB)', 'glpiintegaglpi') ?></label>
                      <input type="number" name="min_total_memory_gb" class="form-control form-control-sm" min="1" max="1024" step="0.5" value="8">
                    </div>
                    <div class="col-md-4" id="raidWrap" style="display:none">
                      <label class="form-label fw-bold"><?= __('Status RAID que dispara', 'glpiintegaglpi') ?></label>
                      <input type="text" name="raid_status" class="form-control form-control-sm" maxlength="80" value="degraded">
                    </div>
                    <div class="col-md-8" id="hardwareChangeWrap" style="display:none">
                      <label class="form-label fw-bold"><?= __('Campos monitorados', 'glpiintegaglpi') ?></label>
                      <input type="text" name="watched_fields" class="form-control form-control-sm" maxlength="240" value="processors,memory,drives">
                    </div>
                    <div class="col-12">
                      <div id="conditionInfoBox" class="alert alert-light border small mb-0" style="display:none"></div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- ④ Ações ITSM -->
            <div class="accordion-item" id="acc-ticket-item">
              <h2 class="accordion-header">
                <button class="accordion-button collapsed py-2" type="button"
                        data-bs-toggle="collapse" data-bs-target="#acc-ticket">
                  <i class="ti ti-ticket me-2 text-danger"></i><strong><?= __('④ Ações ITSM', 'glpiintegaglpi') ?></strong>
                  <span class="badge bg-secondary ms-2 small"><?= __('auto-ticket desligado por padrão', 'glpiintegaglpi') ?></span>
                </button>
              </h2>
              <div id="acc-ticket" class="accordion-collapse collapse" data-bs-parent="#newRuleAccordion">
                <div class="accordion-body lm-acc-body">
                  <div class="form-check mb-3">
                    <input type="checkbox" name="create_ticket" value="1" class="form-check-input" id="createTicketCheck">
                    <label class="form-check-label fw-bold" for="createTicketCheck">
                      <?= __('Criar chamado GLPI quando alarme disparar', 'glpiintegaglpi') ?>
                    </label>
                    <div class="form-text text-warning">
                      <?= __('Requer: LOGMEIN_AUTO_TICKET_ENABLED=true (flag global) + create_ticket=true por regra + entidade + categoria + fila. Fontes indisponíveis ficam bloqueadas.', 'glpiintegaglpi') ?>
                    </div>
                  </div>
                  <div class="row g-3" id="ticketFieldsWrap" style="display:none">
                    <div class="col-md-6">
                      <label class="form-label fw-bold"><?= __('Fila/Grupo GLPI (ID)', 'glpiintegaglpi') ?> *</label>
                      <input type="number" name="glpi_group_id" class="form-control form-control-sm" min="1" placeholder="Ex: 10">
                    </div>
                    <div class="col-md-6">
                      <label class="form-label fw-bold"><?= __('Categoria GLPI (ID)', 'glpiintegaglpi') ?> *</label>
                      <input type="number" name="glpi_itil_category_id" class="form-control form-control-sm" min="1" placeholder="Ex: 20">
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- ⑤ Cooldown e Deduplicação -->
            <div class="accordion-item">
              <h2 class="accordion-header">
                <button class="accordion-button collapsed py-2" type="button"
                        data-bs-toggle="collapse" data-bs-target="#acc-cooldown">
                  <i class="ti ti-clock-pause me-2 text-secondary"></i><strong><?= __('⑤ Cooldown e Deduplicação', 'glpiintegaglpi') ?></strong>
                </button>
              </h2>
              <div id="acc-cooldown" class="accordion-collapse collapse" data-bs-parent="#newRuleAccordion">
                <div class="accordion-body lm-acc-body">
                  <div class="row g-3">
                    <div class="col-md-4">
                      <label class="form-label fw-bold"><?= __('Cooldown (minutos)', 'glpiintegaglpi') ?></label>
                      <input type="number" name="cooldown_minutes" class="form-control form-control-sm" min="1" max="10080" value="60">
                      <div id="cooldownHint" class="form-text text-warning"></div>
                    </div>
                    <div class="col-12">
                      <div class="alert alert-light border small mb-0">
                        <i class="ti ti-shield-check me-1 text-success"></i>
                        <?= __('Dedupe automático por hash diário (rule_id + host_id + alarm_type + data UTC). Cooldown via Redis.', 'glpiintegaglpi') ?>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- ⑥ Segurança / Preview -->
            <div class="accordion-item">
              <h2 class="accordion-header">
                <button class="accordion-button collapsed py-2" type="button"
                        data-bs-toggle="collapse" data-bs-target="#acc-security">
                  <i class="ti ti-shield-lock me-2 text-success"></i><strong><?= __('⑥ Segurança / Preview', 'glpiintegaglpi') ?></strong>
                </button>
              </h2>
              <div id="acc-security" class="accordion-collapse collapse" data-bs-parent="#newRuleAccordion">
                <div class="accordion-body lm-acc-body">
                  <ul class="list-unstyled small mb-0">
                    <li><i class="ti ti-check text-success me-1"></i><?= __('Regra nasce DESABILITADA — não dispara sem ativação manual.', 'glpiintegaglpi') ?></li>
                    <li><i class="ti ti-check text-success me-1"></i><?= __('create_ticket nasce false — nenhum chamado criado sem confirmação.', 'glpiintegaglpi') ?></li>
                    <li><i class="ti ti-check text-success me-1"></i><?= __('Nunca envia WhatsApp.', 'glpiintegaglpi') ?></li>
                    <li><i class="ti ti-check text-success me-1"></i><?= __('Nunca fecha chamado automaticamente.', 'glpiintegaglpi') ?></li>
                    <li><i class="ti ti-check text-success me-1"></i><?= __('Nunca atribui técnico automaticamente.', 'glpiintegaglpi') ?></li>
                    <li><i class="ti ti-alert-triangle text-warning me-1"></i><?= __('Auto-ticket requer LOGMEIN_AUTO_TICKET_ENABLED=true na flag global (desligado em HML).', 'glpiintegaglpi') ?></li>
                  </ul>
                </div>
              </div>
            </div>

          </div><!-- /accordion -->

          <div class="mt-3 d-flex align-items-center gap-2">
            <button type="submit" class="btn btn-primary btn-sm">
              <i class="ti ti-device-floppy me-1"></i><?= __('Criar Regra (desabilitada por padrão)', 'glpiintegaglpi') ?>
            </button>
            <button type="button" class="btn btn-outline-secondary btn-sm"
                    data-bs-toggle="collapse" data-bs-target="#createRulePanel">
              <?= __('Cancelar', 'glpiintegaglpi') ?>
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
  <?php endif; ?>

  <!-- ── Cards de Regras ────────────────────────────────────────────────────── -->
  <?php if ($schemaReady && count($rules) > 0): ?>
  <div class="row g-3 mb-3" id="rulesGrid">
    <?php foreach ($rules as $rule):
      $ruleId      = (string) ($rule['id'] ?? '');
      $targets     = $ruleTargets[$ruleId] ?? [];
      $stats       = $ruleStats[$ruleId]   ?? null;
      $targetCount = count($targets);
      $isEnabled   = (bool) ($rule['enabled'] ?? false);
      $isAlertOnly = in_array($rule['alarm_type'], $alertOnlyTypes, true);
      $isAutoTkt   = in_array($rule['alarm_type'], $autoTicketTypes, true);
      $cardClass   = $isEnabled ? 'enabled' : 'disabled';
      $accordionId = 'rc-' . preg_replace('/[^a-z0-9]/i', '-', $ruleId);
    ?>
    <div class="col-12 col-xl-6">
      <div class="card shadow-sm lm-alarm-card <?= ealarm($cardClass) ?>">

        <!-- Card header row -->
        <div class="card-header py-2 bg-white d-flex align-items-center gap-2 flex-wrap">
          <!-- Status badge -->
          <?php if ($isEnabled): ?>
            <span class="badge bg-success lm-stat-chip"><i class="ti ti-player-play me-1"></i>ON</span>
          <?php else: ?>
            <span class="badge bg-secondary lm-stat-chip"><i class="ti ti-player-pause me-1"></i>OFF</span>
          <?php endif; ?>

          <!-- Rule name -->
          <strong class="flex-grow-1"><?= ealarm($rule['rule_name']) ?></strong>

          <!-- Type badge -->
          <?php if ($isAlertOnly): ?>
            <span class="badge bg-warning text-dark lm-type-badge">sem snapshot</span>
          <?php elseif ($isAutoTkt): ?>
            <span class="badge bg-info text-dark lm-type-badge">auto-ticket</span>
          <?php endif; ?>
          <code class="text-muted small"><?= ealarm($rule['alarm_type']) ?></code>

          <!-- Expand button -->
          <button class="btn btn-sm btn-outline-secondary py-0 px-2 ms-auto" type="button"
                  data-bs-toggle="collapse" data-bs-target="#<?= ealarm($accordionId) ?>"
                  title="<?= __('Expandir detalhes', 'glpiintegaglpi') ?>">
            <i class="ti ti-chevron-down"></i>
          </button>
        </div>

        <!-- Stat chips row -->
        <div class="card-body py-2 border-bottom d-flex flex-wrap gap-2 align-items-center">
          <!-- Targets -->
          <span class="lm-stat-chip bg-light border text-dark">
            <i class="ti ti-devices me-1"></i><?= $targetCount ?>
            <?= $targetCount === 0 ? __('alvos (todos da entidade)', 'glpiintegaglpi') : __('alvos', 'glpiintegaglpi') ?>
          </span>
          <!-- Cooldown -->
          <span class="lm-stat-chip bg-light border text-dark">
            <i class="ti ti-clock-pause me-1"></i><?= ealarm($rule['cooldown_minutes']) ?>min
          </span>
          <!-- Entidade -->
          <span class="lm-stat-chip bg-light border text-dark">
            <i class="ti ti-building me-1"></i>entidade <?= ealarm($rule['glpi_entities_id']) ?>
          </span>
          <!-- create_ticket badge -->
          <?php if ($rule['create_ticket']): ?>
            <span class="lm-stat-chip bg-warning text-dark">
              <i class="ti ti-ticket me-1"></i><?= __('ticket=ON', 'glpiintegaglpi') ?>
            </span>
          <?php endif; ?>

          <?php if ($stats !== null): ?>
            <!-- Total fires -->
            <span class="lm-stat-chip bg-primary text-white" title="<?= __('Total de disparos', 'glpiintegaglpi') ?>">
              <i class="ti ti-bell me-1"></i><?= (int) ($stats['total_events']) ?>
            </span>
            <!-- Tickets -->
            <?php if ($stats['tickets_created'] > 0): ?>
            <span class="lm-stat-chip bg-danger text-white" title="<?= __('Chamados gerados', 'glpiintegaglpi') ?>">
              <i class="ti ti-ticket me-1"></i><?= (int) ($stats['tickets_created']) ?>
            </span>
            <?php endif; ?>
            <!-- Last trigger -->
            <?php if ($stats['last_trigger'] !== null): ?>
            <span class="lm-stat-chip bg-light border text-secondary" title="<?= __('Último disparo', 'glpiintegaglpi') ?>">
              <i class="ti ti-clock me-1"></i><?= ealarm(fmtAlarmDate($stats['last_trigger'])) ?>
            </span>
            <?php endif; ?>
          <?php else: ?>
            <span class="lm-stat-chip bg-light border text-muted"><i class="ti ti-circle-off me-1"></i><?= __('sem eventos', 'glpiintegaglpi') ?></span>
          <?php endif; ?>
        </div>

        <!-- Collapsible detail -->
        <div class="collapse" id="<?= ealarm($accordionId) ?>">
          <div class="card-body pt-2 pb-3">

            <!-- Quick actions -->
            <?php if ($canWrite): ?>
            <div class="d-flex gap-2 mb-3 flex-wrap align-items-center">
              <!-- Toggle enabled -->
              <form method="POST" action="<?= $selfUrl ?>" class="d-inline">
                <input type="hidden" name="_glpi_csrf_token" value="<?= ealarm($csrfToken) ?>">
                <input type="hidden" name="action" value="toggle_enabled">
                <input type="hidden" name="rule_id" value="<?= ealarm($ruleId) ?>">
                <input type="hidden" name="enabled" value="<?= $isEnabled ? '0' : '1' ?>">
                <button type="submit" class="btn btn-sm <?= $isEnabled ? 'btn-outline-warning' : 'btn-outline-success' ?>">
                  <i class="ti <?= $isEnabled ? 'ti-player-pause' : 'ti-player-play' ?> me-1"></i>
                  <?= $isEnabled ? __('Desabilitar', 'glpiintegaglpi') : __('Habilitar', 'glpiintegaglpi') ?>
                </button>
              </form>
              <!-- Dry-run -->
              <button type="button" class="btn btn-sm btn-outline-info" id="dryRunBtn-<?= ealarm($accordionId) ?>"
                      onclick="lmDryRun('<?= ealarm($ruleId) ?>','<?= ealarm($accordionId) ?>')">
                <i class="ti ti-test-pipe me-1"></i><?= __('Dry-run', 'glpiintegaglpi') ?>
              </button>
              <!-- Delete -->
              <form method="POST" action="<?= $selfUrl ?>" class="d-inline ms-auto"
                    onsubmit="return confirm('<?= __('Confirmar exclusão da regra e todos os alvos?', 'glpiintegaglpi') ?>')">
                <input type="hidden" name="_glpi_csrf_token" value="<?= ealarm($csrfToken) ?>">
                <input type="hidden" name="action" value="delete_rule">
                <input type="hidden" name="rule_id" value="<?= ealarm($ruleId) ?>">
                <button type="submit" class="btn btn-sm btn-outline-danger">
                  <i class="ti ti-trash me-1"></i><?= __('Excluir', 'glpiintegaglpi') ?>
                </button>
              </form>
            </div>
            <?php endif; ?>

            <!-- Dry-run result panel -->
            <div id="dryRunResult-<?= ealarm($accordionId) ?>" class="lm-dry-result mb-3" style="display:none"></div>

            <!-- ── Targets section ─────────────────────────────────────── -->
            <div class="border rounded p-2 bg-white mb-3">
              <div class="d-flex align-items-center mb-2 gap-2">
                <h6 class="mb-0 small fw-bold">
                  <i class="ti ti-devices me-1"></i><?= __('Dispositivos Monitorados', 'glpiintegaglpi') ?>
                  <span class="badge bg-secondary ms-1"><?= $targetCount ?></span>
                </h6>
                <?php if ($targetCount === 0): ?>
                  <span class="badge bg-light text-muted border small">
                    <?= __('vazio = TODOS da entidade', 'glpiintegaglpi') ?>
                  </span>
                <?php endif; ?>
              </div>

              <?php if ($targetCount > 0): ?>
              <div class="d-flex flex-wrap gap-1 mb-2">
                <?php foreach ($targets as $tgt): ?>
                  <span class="badge bg-light text-dark border d-flex align-items-center gap-1">
                    <i class="ti ti-device-desktop-analytics" style="font-size:.75rem"></i>
                    <?= ealarm($tgt['hostname']) ?>
                    <?php if ($canWrite): ?>
                    <form method="POST" action="<?= $selfUrl ?>" class="d-inline m-0 p-0">
                      <input type="hidden" name="_glpi_csrf_token" value="<?= ealarm($csrfToken) ?>">
                      <input type="hidden" name="action" value="remove_target">
                      <input type="hidden" name="rule_id" value="<?= ealarm($ruleId) ?>">
                      <input type="hidden" name="host_id" value="<?= ealarm($tgt['host_id']) ?>">
                      <button type="submit" class="btn p-0 border-0 bg-transparent text-danger ms-1"
                              style="font-size:.7rem;line-height:1"
                              title="<?= __('Remover alvo', 'glpiintegaglpi') ?>">
                        <i class="ti ti-x"></i>
                      </button>
                    </form>
                    <?php endif; ?>
                  </span>
                <?php endforeach; ?>
              </div>
              <?php elseif ($schemaReady): ?>
                <p class="text-muted small mb-2">
                  <i class="ti ti-info-circle me-1"></i>
                  <?= __('Nenhum dispositivo específico — avalia TODOS os hosts da entidade.', 'glpiintegaglpi') ?>
                </p>
              <?php endif; ?>

              <!-- Add target UI -->
              <?php if ($canWrite): ?>
              <div class="mt-1" id="addTargetSection-<?= ealarm($accordionId) ?>">
                <div class="d-flex gap-2 mb-2 flex-wrap align-items-center">
                  <small class="fw-bold text-muted"><?= __('Adicionar por:', 'glpiintegaglpi') ?></small>
                  <div class="btn-group btn-group-sm">
                    <button type="button" class="btn btn-outline-secondary active btn-xs"
                            onclick="lmAlarmTargetMode('<?= ealarm($accordionId) ?>', 'search')">
                      <i class="ti ti-search me-1"></i><?= __('Busca', 'glpiintegaglpi') ?>
                    </button>
                    <button type="button" class="btn btn-outline-secondary btn-xs"
                            onclick="lmAlarmTargetMode('<?= ealarm($accordionId) ?>', 'group')">
                      <i class="ti ti-sitemap me-1"></i><?= __('Grupo LMI', 'glpiintegaglpi') ?>
                    </button>
                  </div>
                </div>

                <!-- Search mode -->
                <div id="targetMode-search-<?= ealarm($accordionId) ?>">
                  <div class="input-group input-group-sm mb-1">
                    <input type="text" class="form-control form-control-sm"
                           id="hostSearch-<?= ealarm($accordionId) ?>"
                           placeholder="<?= __('Hostname ou etiqueta (mín 2 chars)...', 'glpiintegaglpi') ?>"
                           oninput="lmHostSearch('<?= ealarm($accordionId) ?>','')"
                           autocomplete="off">
                    <span class="input-group-text"><i class="ti ti-search"></i></span>
                  </div>
                  <div id="hostResults-<?= ealarm($accordionId) ?>" class="list-group mb-1" style="max-height:180px;overflow-y:auto;"></div>
                </div>

                <!-- Group mode -->
                <div id="targetMode-group-<?= ealarm($accordionId) ?>" style="display:none">
                  <?php if (count($groups) > 0): ?>
                  <select class="form-select form-select-sm mb-1"
                          id="groupSelect-<?= ealarm($accordionId) ?>"
                          onchange="lmHostSearch('<?= ealarm($accordionId) ?>', this.value)">
                    <option value=""><?= __('— selecionar grupo LogMeIn —', 'glpiintegaglpi') ?></option>
                    <?php foreach ($groups as $g): ?>
                      <option value="<?= ealarm($g['group_id']) ?>">
                        <?= ealarm($g['group_name']) ?> (<?= (int) $g['host_count'] ?> hosts)
                      </option>
                    <?php endforeach; ?>
                  </select>
                  <div id="hostResults-<?= ealarm($accordionId) ?>-g" class="list-group mb-1" style="max-height:180px;overflow-y:auto;"></div>
                  <?php else: ?>
                    <div class="text-muted small"><?= __('Nenhum grupo disponível no cache.', 'glpiintegaglpi') ?></div>
                  <?php endif; ?>
                </div>

                <!-- Hidden add form (populated by JS) -->
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

                <div class="form-text text-muted mt-1">
                  <i class="ti ti-lock me-1"></i>
                  <?= __('Exclusões de hosts específicos requerem schema change futuro (coluna `excluded` em alarm_targets).', 'glpiintegaglpi') ?>
                </div>
              </div>
              <?php endif; ?>
            </div>

            <!-- ── Histórico / Estatísticas ─────────────────────────────── -->
            <div class="border rounded p-2 bg-white">
              <div class="d-flex align-items-center mb-2 justify-content-between">
                <h6 class="mb-0 small fw-bold">
                  <i class="ti ti-history me-1"></i><?= __('Histórico / Estatísticas', 'glpiintegaglpi') ?>
                </h6>
                <?php if ($stats !== null): ?>
                  <div class="d-flex gap-1 flex-wrap">
                    <span class="badge bg-primary lm-stat-chip" title="<?= __('Total disparos', 'glpiintegaglpi') ?>">
                      ↑<?= (int) $stats['total_events'] ?>
                    </span>
                    <?php if ($stats['tickets_created'] > 0): ?>
                    <span class="badge bg-danger lm-stat-chip" title="<?= __('Tickets criados', 'glpiintegaglpi') ?>">
                      #<?= (int) $stats['tickets_created'] ?>
                    </span>
                    <?php endif; ?>
                    <?php if ($stats['cooldown_skipped'] > 0): ?>
                    <span class="badge bg-warning text-dark lm-stat-chip" title="<?= __('Suprimidos por cooldown', 'glpiintegaglpi') ?>">
                      ~cool<?= (int) $stats['cooldown_skipped'] ?>
                    </span>
                    <?php endif; ?>
                    <?php if ($stats['dedupe_hit'] > 0): ?>
                    <span class="badge bg-secondary lm-stat-chip" title="<?= __('Suprimidos por dedupe', 'glpiintegaglpi') ?>">
                      ~dup<?= (int) $stats['dedupe_hit'] ?>
                    </span>
                    <?php endif; ?>
                    <?php if ($stats['last_trigger'] !== null): ?>
                    <span class="badge bg-light border text-secondary lm-stat-chip">
                      <i class="ti ti-clock me-1"></i><?= ealarm(fmtAlarmDate($stats['last_trigger'])) ?>
                    </span>
                    <?php endif; ?>
                  </div>
                <?php endif; ?>
              </div>

              <?php
                // Load recent events for this rule (already in $recentEvents filtered by rule_id)
                $ruleEvents = array_values(array_filter($recentEvents, static fn($e) => (string) ($e['rule_id'] ?? '') === $ruleId));
                $ruleEvents = array_slice($ruleEvents, 0, 10);
              ?>

              <?php if (count($ruleEvents) > 0): ?>
              <div class="lm-hist-mini">
                <table class="table table-sm table-hover mb-0">
                  <thead class="table-light sticky-top">
                    <tr>
                      <th class="small"><?= __('Data', 'glpiintegaglpi') ?></th>
                      <th class="small"><?= __('Host', 'glpiintegaglpi') ?></th>
                      <th class="small"><?= __('Ticket', 'glpiintegaglpi') ?></th>
                      <th class="small"><?= __('Flags', 'glpiintegaglpi') ?></th>
                    </tr>
                  </thead>
                  <tbody>
                    <?php foreach ($ruleEvents as $ev): ?>
                    <tr>
                      <td class="small"><?= ealarm(fmtAlarmDate($ev['created_at'] ?? null)) ?></td>
                      <td><code class="small"><?= ealarm($ev['hostname'] ?? $ev['host_id'] ?? '—') ?></code></td>
                      <td>
                        <?php if (!empty($ev['glpi_ticket_id'])): ?>
                          <span class="badge bg-info">#<?= ealarm($ev['glpi_ticket_id']) ?></span>
                        <?php else: ?>
                          <span class="text-muted small">—</span>
                        <?php endif; ?>
                      </td>
                      <td>
                        <?php if ($ev['cooldown_skipped'] ?? false): ?>
                          <span class="badge bg-warning text-dark" title="cooldown">~C</span>
                        <?php endif; ?>
                        <?php if ($ev['dedupe_hit'] ?? false): ?>
                          <span class="badge bg-secondary" title="dedupe">~D</span>
                        <?php endif; ?>
                      </td>
                    </tr>
                    <?php endforeach; ?>
                  </tbody>
                </table>
              </div>
              <?php else: ?>
                <div class="text-muted small py-2 text-center">
                  <i class="ti ti-circle-off me-1"></i>
                  <?= __('Nenhum evento registrado ainda para esta regra.', 'glpiintegaglpi') ?>
                </div>
              <?php endif; ?>
            </div><!-- /histórico -->

          </div><!-- /card-body detail -->
        </div><!-- /collapse -->

      </div><!-- /card -->
    </div><!-- /col -->
    <?php endforeach; ?>
  </div><!-- /rulesGrid -->

  <?php elseif ($schemaReady): ?>
    <div class="card mb-3">
      <div class="card-body text-center text-muted py-5">
        <i class="ti ti-bell-off" style="font-size:3rem;opacity:.3"></i>
        <p class="mt-2 mb-0"><?= __('Nenhuma regra de alarme cadastrada. Clique em "+ Nova Regra" para começar.', 'glpiintegaglpi') ?></p>
      </div>
    </div>
  <?php endif; ?>

  <!-- ── Blocos declarados (BLOCK_NEEDS_SCHEMA_CHANGE) ──────────────────────── -->
  <div class="alert alert-secondary border mt-2">
    <strong><i class="ti ti-database-exclamation me-1"></i>BLOCK_NEEDS_SCHEMA_CHANGE</strong>
    <ul class="mb-0 mt-1 small">
      <li>
        <strong><?= __('Maintenance/Silenciamento:', 'glpiintegaglpi') ?></strong>
        <?= __('Requer nova tabela', 'glpiintegaglpi') ?>
        <code>integaglpi_logmein_alarm_maintenance (id, rule_id, start_at, end_at, reason, created_by)</code>.
        <?= __('Não implementado nesta fase.', 'glpiintegaglpi') ?>
      </li>
      <li>
        <strong><?= __('Exclusões de alvos:', 'glpiintegaglpi') ?></strong>
        <?= __('Requer coluna', 'glpiintegaglpi') ?>
        <code>excluded BOOLEAN DEFAULT false</code>
        <?= __('em', 'glpiintegaglpi') ?>
        <code>integaglpi_logmein_alarm_targets</code>
        <?= __('(ou tabela separada de exclusões). Não implementado nesta fase.', 'glpiintegaglpi') ?>
      </li>
    </ul>
  </div>

  <!-- ── Painel de segurança ────────────────────────────────────────────────── -->
  <div class="alert alert-light border mt-2">
    <small class="text-muted">
      <i class="ti ti-shield-lock me-1"></i>
      <?= __('Fontes sem snapshot ou indisponíveis não criam chamado. Auto-ticket requer LOGMEIN_AUTO_TICKET_ENABLED=true (global) + create_ticket=true (por regra) + entidade + categoria + fila. Cooldown mín 60min. Vazio em Alvos = todos da entidade. Produção bloqueada até promoção manual.', 'glpiintegaglpi') ?>
    </small>
  </div>

</div><!-- /container -->

<script>
(function () {

// ── HTML escaping (XSS-safe) ──────────────────────────────────────────────────
function lmEsc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Alarm type hints on new-rule form ─────────────────────────────────────────
var ALERT_ONLY  = <?= json_encode($alertOnlyTypes) ?>;
var AUTO_TICKET = <?= json_encode($autoTicketTypes) ?>;
var UNSUPPORTED = <?= json_encode($forbiddenTypes) ?>;
var alarmTypeSelect   = document.getElementById('alarmTypeSelect');
var createTicketCheck = document.getElementById('createTicketCheck');

function updateAlarmTypeHints() {
  if (!alarmTypeSelect) return;
  var t = alarmTypeSelect.value;
  var hintEl       = document.getElementById('alarmTypeHint');
  var cooldownHint = document.getElementById('cooldownHint');
  var notSeenWrap  = document.getElementById('notSeenDaysWrap');
  var consecWrap   = document.getElementById('consecChecksWrap');
  var consecIvWrap = document.getElementById('consecIntervalWrap');
  var offlineWrap  = document.getElementById('offlineMinutesWrap');
  var diskPercentWrap = document.getElementById('diskPercentWrap');
  var diskGbWrap = document.getElementById('diskGbWrap');
  var partitionWrap = document.getElementById('partitionWrap');
  var memoryWrap = document.getElementById('memoryWrap');
  var raidWrap = document.getElementById('raidWrap');
  var hardwareChangeWrap = document.getElementById('hardwareChangeWrap');
  var ticketItem   = document.getElementById('acc-ticket-item');
  var condBox      = document.getElementById('conditionInfoBox');

  [notSeenWrap, consecWrap, consecIvWrap, offlineWrap, diskPercentWrap, diskGbWrap, partitionWrap, memoryWrap, raidWrap, hardwareChangeWrap].forEach(function (el) {
    if (el) el.style.display = 'none';
  });
  if (condBox) { condBox.style.display = 'none'; condBox.textContent = ''; }

  if (UNSUPPORTED.indexOf(t) !== -1) {
    if (hintEl) hintEl.textContent = '⚠ Fonte indisponível no LogMeIn atual. Não é possível criar regra.';
    if (ticketItem) ticketItem.style.opacity = '0.35';
    if (createTicketCheck) { createTicketCheck.checked = false; createTicketCheck.disabled = true; }
  } else if (ALERT_ONLY.indexOf(t) !== -1) {
    if (hintEl) hintEl.textContent = '⚠ Requer snapshot histórico futuro. Ticket automático bloqueado.';
    if (ticketItem) ticketItem.style.opacity = '0.45';
    if (createTicketCheck) { createTicketCheck.checked = false; createTicketCheck.disabled = true; }
  } else {
    if (hintEl) hintEl.textContent = '';
    if (ticketItem) ticketItem.style.opacity = '1';
    if (createTicketCheck) createTicketCheck.disabled = false;
  }
  if (t === 'host_not_seen') {
    if (notSeenWrap) notSeenWrap.style.display = '';
    if (condBox) { condBox.style.display = ''; condBox.textContent = 'Não visto há X dias: last_seen_at < agora - X dias.'; }
  }
  if (t === 'host_offline') {
    if (offlineWrap) offlineWrap.style.display = '';
    if (consecWrap)   consecWrap.style.display   = '';
    if (consecIvWrap) consecIvWrap.style.display = '';
    if (cooldownHint) cooldownHint.textContent = 'Mínimo 60 min para create_ticket.';
    if (condBox) { condBox.style.display = ''; condBox.textContent = 'Offline: status != "online" + N checks consecutivos.'; }
  }
  if (t === 'low_disk') {
    if (diskPercentWrap) diskPercentWrap.style.display = '';
    if (diskGbWrap) diskGbWrap.style.display = '';
    if (partitionWrap) partitionWrap.style.display = '';
    if (condBox) { condBox.style.display = ''; condBox.textContent = 'Disco: dispara quando PartitionFreeSpace / PartitionTotalSize fica abaixo do limite.'; }
  }
  if (t === 'low_memory') {
    if (memoryWrap) memoryWrap.style.display = '';
    if (condBox) { condBox.style.display = ''; condBox.textContent = 'Memória: usa MemorySize/MemoryModules. Não representa consumo em tempo real.'; }
  }
  if (t === 'raid_degraded') {
    if (raidWrap) raidWrap.style.display = '';
    if (condBox) { condBox.style.display = ''; condBox.textContent = 'RAID: usa PartitionRaidStatus/PartitionRaidFailingDiskNumber quando a API fornecer.'; }
  }
  if (t === 'missing_equipment_tag') {
    if (condBox) { condBox.style.display = ''; condBox.textContent = 'Sem patrimônio: dispara quando equipment_tag/asset tag está vazio.'; }
  }
  if (t === 'missing_entity_mapping') {
    if (condBox) { condBox.style.display = ''; condBox.textContent = 'Sem entidade: dispara quando o host/grupo não tem entidade candidata resolvida.'; }
  }
  if (t === 'hardware_change') {
    if (hardwareChangeWrap) hardwareChangeWrap.style.display = '';
    if (condBox) { condBox.style.display = ''; condBox.textContent = 'Mudança de hardware precisa de snapshot histórico. Bloqueado para ticket nesta fase.'; }
  }
  if (cooldownHint && t !== 'host_offline') {
    cooldownHint.textContent = AUTO_TICKET.indexOf(t) !== -1 ? 'Mínimo 60 min para create_ticket.' : '';
  }
}

if (alarmTypeSelect) {
  alarmTypeSelect.addEventListener('change', updateAlarmTypeHints);
  updateAlarmTypeHints();
}
if (createTicketCheck) {
  createTicketCheck.addEventListener('change', function () {
    var wrap = document.getElementById('ticketFieldsWrap');
    if (wrap) wrap.style.display = this.checked ? '' : 'none';
  });
}

// ── Target mode toggle ────────────────────────────────────────────────────────
window.lmAlarmTargetMode = function (accordionId, mode) {
  var searchDiv = document.getElementById('targetMode-search-' + accordionId);
  var groupDiv  = document.getElementById('targetMode-group-'  + accordionId);
  if (searchDiv) searchDiv.style.display = (mode === 'search') ? '' : 'none';
  if (groupDiv)  groupDiv.style.display  = (mode === 'group')  ? '' : 'none';
  var r1 = document.getElementById('hostResults-' + accordionId);
  if (r1) r1.innerHTML = '';
};

// ── AJAX host search ──────────────────────────────────────────────────────────
var _lmSearchTimers = {};

window.lmHostSearch = function (accordionId, groupId) {
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
    var url = window.location.pathname
            + '?action=search_hosts&q=' + encodeURIComponent(q)
            + (groupId ? '&group_id=' + encodeURIComponent(groupId) : '');
    fetch(url, { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        lmRenderHostResults(accordionId, resultsId, data.hosts || [], q);
      })
      .catch(function () {});
  }, isGroupMode ? 0 : 350);
};

function lmRenderHostResults(accordionId, resultsId, hosts, q) {
  var container = document.getElementById(resultsId);
  if (!container) return;
  if (hosts.length === 0) {
    container.innerHTML = '<div class="list-group-item text-muted small py-1">'
      + '<?= __('Nenhum dispositivo encontrado.', 'glpiintegaglpi') ?></div>';
    return;
  }
  var html = '';
  hosts.forEach(function (h) {
    var statusColor = h.status === 'online' ? 'success' : (h.status === 'offline' ? 'danger' : 'secondary');
    var tag = h.equipment_tag ? ' [' + lmEsc(h.equipment_tag) + ']' : '';
    var entity = h.glpi_entity_name ? ' · Entidade: ' + lmEsc(h.glpi_entity_name) : ' · Entidade não resolvida';
    var computer = h.glpi_computer_id ? ' · Computer #' + lmEsc(h.glpi_computer_id) : '';
    var label = lmEsc(h.hostname) + tag + ' — ' + lmEsc(h.group_name || '') + computer + entity;
    html += '<button type="button" class="list-group-item list-group-item-action py-1 small"'
          + ' data-host-id="' + lmEsc(h.host_id) + '"'
          + ' data-hostname="' + lmEsc(h.hostname) + '"'
          + ' onclick="lmSelectHost(\'' + lmEsc(accordionId) + '\', this)">'
          + '<span class="badge bg-' + lmEsc(statusColor) + ' me-2" style="width:10px;height:10px;display:inline-block;border-radius:50%"></span>'
          + label
          + '</button>';
  });
  if (hosts.length === 100) {
    html += '<div class="list-group-item text-muted small py-1"><?= __('Mostrando primeiros 100. Refine a busca.', 'glpiintegaglpi') ?></div>';
  }
  container.innerHTML = html;
}

window.lmSelectHost = function (accordionId, btn) {
  var hostId   = btn.getAttribute('data-host-id')   || '';
  var hostname = btn.getAttribute('data-hostname')   || '';
  var idEl     = document.getElementById('addHostId-'          + accordionId);
  var nameEl   = document.getElementById('addHostname-'        + accordionId);
  var addBtn   = document.getElementById('addTargetBtn-'       + accordionId);
  var lblEl    = document.getElementById('addTargetBtnLabel-'  + accordionId);
  if (idEl)   idEl.value   = hostId;
  if (nameEl) nameEl.value = hostname;
  if (addBtn) addBtn.style.display = '';
  if (lblEl)  lblEl.textContent = '<?= __('Adicionar:', 'glpiintegaglpi') ?> ' + hostname;
};

// ── Dry-run per rule ──────────────────────────────────────────────────────────
window.lmDryRun = function (ruleId, accordionId) {
  var panel = document.getElementById('dryRunResult-' + accordionId);
  var btn   = document.getElementById('dryRunBtn-'    + accordionId);
  if (!panel) return;

  panel.style.display = '';
  panel.innerHTML = '<div class="alert alert-light border py-2"><i class="ti ti-loader-2 me-1"></i>'
    + '<?= __('Executando dry-run…', 'glpiintegaglpi') ?></div>';
  if (btn) { btn.disabled = true; }

  var url = window.location.pathname + '?action=dry_run&rule_id=' + encodeURIComponent(ruleId);
  fetch(url, { credentials: 'same-origin' })
    .then(function (r) { return r.json(); })
    .then(function (d) { lmRenderDryRunResult(panel, d); })
    .catch(function (e) {
      panel.innerHTML = '<div class="alert alert-danger py-2"><?= __('Erro na requisição dry-run.', 'glpiintegaglpi') ?></div>';
    })
    .finally(function () { if (btn) btn.disabled = false; });
};

function lmRenderDryRunResult(panel, d) {
  if (!d.ok) {
    panel.innerHTML = '<div class="alert alert-danger py-2">'
      + lmEsc((d.errors || []).join(' | ') || '<?= __('Erro desconhecido.', 'glpiintegaglpi') ?>') + '</div>';
    return;
  }

  var fireCount = (d.hosts_triggering || []).length;
  var alertClass = fireCount > 0 ? 'warning' : 'success';
  var icon = fireCount > 0 ? 'ti-alert-triangle' : 'ti-circle-check';

  var html = '<div class="alert alert-' + alertClass + ' py-2 mb-2">'
    + '<i class="ti ' + icon + ' me-1"></i>'
    + '<strong>Dry-run: ' + lmEsc(d.rule_name) + ' (' + lmEsc(d.alarm_type) + ')</strong>'
    + '</div>';

  // Summary chips
  html += '<div class="d-flex flex-wrap gap-2 mb-2">';
  html += '<span class="badge bg-secondary"><?= __('Em escopo:', 'glpiintegaglpi') ?> ' + (d.hosts_in_scope || 0) + '</span>';
  html += '<span class="badge bg-' + (fireCount > 0 ? 'danger' : 'success') + '">'
        + '<?= __('Disparariam:', 'glpiintegaglpi') ?> ' + fireCount + '</span>';
  html += '<span class="badge bg-light text-dark border"><?= __('Seguros:', 'glpiintegaglpi') ?> ' + (d.hosts_safe || 0) + '</span>';
  html += '<span class="badge bg-secondary"><?= __('Dedupe hoje:', 'glpiintegaglpi') ?> ' + (d.suppressed_by_dedupe_today || 0) + '</span>';
  html += '<span class="badge ' + (d.would_create_ticket_if_enabled ? 'bg-warning text-dark' : 'bg-light text-muted border') + '">'
        + (d.would_create_ticket_if_enabled ? '⚠ <?= __('Criaria ticket', 'glpiintegaglpi') ?>' : '✓ <?= __('Não criaria ticket', 'glpiintegaglpi') ?>') + '</span>';
  html += '</div>';

  // Notes
  if (d.cooldown_note) {
    html += '<div class="text-muted small mb-1"><i class="ti ti-info-circle me-1"></i>' + lmEsc(d.cooldown_note) + '</div>';
  }
  if (d.condition_note) {
    html += '<div class="text-muted small mb-1"><i class="ti ti-info-circle me-1"></i>' + lmEsc(d.condition_note) + '</div>';
  }
  if ((d.blocked_by_policy || []).length > 0) {
    html += '<div class="alert alert-info py-1 mb-2 small"><i class="ti ti-shield-lock me-1"></i><strong>Bloqueios de policy:</strong> '
      + lmEsc(d.blocked_by_policy.join(' · ')) + '</div>';
  }

  // Triggering hosts table
  if (fireCount > 0) {
    html += '<div class="table-responsive mt-2"><table class="table table-sm table-hover mb-0">'
      + '<thead class="table-warning"><tr>'
      + '<th class="small"><?= __('Hostname', 'glpiintegaglpi') ?></th>'
      + '<th class="small"><?= __('Host ID', 'glpiintegaglpi') ?></th>'
      + '<th class="small"><?= __('Motivo da condição', 'glpiintegaglpi') ?></th>'
      + '</tr></thead><tbody>';
    (d.hosts_triggering || []).forEach(function (h) {
      html += '<tr>'
        + '<td><code class="small">' + lmEsc(h.hostname) + '</code></td>'
        + '<td><small class="text-muted">' + lmEsc(h.host_id) + '</small></td>'
        + '<td><small>' + lmEsc(h.reason) + '</small></td>'
        + '</tr>';
    });
    html += '</tbody></table></div>';
    html += '<div class="text-muted small mt-1"><i class="ti ti-bell me-1 text-warning"></i>'
      + '<?= __('Alerta interno de supervisão criado para', 'glpiintegaglpi') ?> ' + fireCount + ' host(s).</div>';
  } else {
    html += '<div class="text-success small"><i class="ti ti-circle-check me-1"></i>'
      + '<?= __('Nenhum host dispararia com as condições atuais.', 'glpiintegaglpi') ?></div>';
  }

  panel.innerHTML = html;
}

// ── Global dry-run (all enabled rules) ────────────────────────────────────────
window.lmGlobalDryRun = function () {
  var btn = document.getElementById('globalDryRunBtn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="ti ti-loader-2 me-1"></i><?= __('Executando…', 'glpiintegaglpi') ?>'; }
  // Expand all enabled-rule cards and trigger individual dry-runs
  var cards = document.querySelectorAll('[id^="dryRunBtn-"]');
  var count = 0;
  cards.forEach(function (b) {
    var aid = b.id.replace('dryRunBtn-', '');
    // expand collapse
    var collapseEl = document.getElementById(aid);
    if (collapseEl && !collapseEl.classList.contains('show')) {
      var bsCollapse = bootstrap.Collapse.getOrCreateInstance(collapseEl);
      bsCollapse.show();
    }
    setTimeout(function () { b.click(); }, count * 300);
    count++;
  });
  setTimeout(function () {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="ti ti-test-pipe me-1"></i><?= __('Dry-run Global', 'glpiintegaglpi') ?>'; }
  }, Math.max(1500, count * 400));
};

})();
</script>
