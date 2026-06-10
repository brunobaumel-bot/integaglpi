<?php
/**
 * Template: LogMeIn → GLPI Field Mapping Configuration
 *
 * Variables injected by logmein.fieldmapping.php:
 *  - $mappings       list<array>  — all field mappings (active + inactive)
 *  - $forbiddenFields list<string> — PII fields that can never be activated
 *  - $validPolicies  list<string> — allowed overwrite policy values
 *  - $schemaReady    bool         — whether the DB table exists
 *  - $flash          ?array       — {type, message} flash message
 *  - $dryRunResult   ?array       — result from dry-run preview
 *
 * PHASE: integaglpi_logmein_field_mapping_config_001
 */

declare(strict_types=1);

/** @var list<array<string, mixed>> $mappings */
/** @var list<string>               $forbiddenFields */
/** @var list<string>               $validPolicies */
/** @var bool                       $schemaReady */
/** @var array{type:string,message:string}|null $flash */
/** @var array{dry_run_only:bool,fields:list<array<string,mixed>>,summary:array<string,int>}|null $dryRunResult */

$policyLabels = [
    'never_overwrite_manual'        => __('Nunca sobrescrever manual', 'glpiintegaglpi'),
    'overwrite_only_logmein_origin' => __('Sobrescrever só se origem LogMeIn', 'glpiintegaglpi'),
    'always_update'                 => __('Atualizar sempre (exige auditoria)', 'glpiintegaglpi'),
];

$statusBadge = [
    'would_update'       => 'success',
    'would_skip'         => 'secondary',
    'blocked_by_policy'  => 'warning',
    'field_unavailable'  => 'secondary',
    'blocked_pii'        => 'danger',
    'blocked_flag'       => 'warning',
    'blocked_forbidden'  => 'danger',
];

$targetTypeLabels = [
    'computer_field'  => 'Computador',
    'device_processor'=> 'Processador',
    'device_memory'   => 'Memória',
    'device_harddisk' => 'Disco',
    'network_port'    => 'Porta de rede',
    'context_only'    => 'Contexto / somente leitura',
    'alarm_context'   => 'Contexto para alarmes',
];
?>

<div class="container-fluid mt-2">
  <?php if (!$schemaReady): ?>
    <div class="alert alert-warning">
      <?= __('Tabela de mapeamento não encontrada. Execute a migration 047_logmein_field_mapping_config.sql e recarregue.', 'glpiintegaglpi') ?>
    </div>
  <?php endif; ?>

  <?php if (isset($flash)): ?>
    <div class="alert alert-<?= htmlspecialchars((string) ($flash['type'] ?? 'info')) ?> alert-dismissible fade show">
      <?= htmlspecialchars((string) ($flash['message'] ?? '')) ?>
      <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    </div>
  <?php endif; ?>

  <div class="card">
    <div class="card-header d-flex justify-content-between align-items-center">
      <h5 class="mb-0">
        <i class="ti ti-list-details me-1"></i>
        <?= __('Mapeamento de Campos LogMeIn → GLPI', 'glpiintegaglpi') ?>
      </h5>
      <div class="d-flex gap-2">
        <?php /* D03: efetiva a sincronização read-only do catálogo LogMeIn (CSRF + permissão + auditoria no serviço). */ ?>
        <form method="POST" action="" class="d-inline m-0"
              onsubmit="return confirm('<?= __('Executar a sincronização LogMeIn agora? Operação read-only: nenhum ativo GLPI é alterado.', 'glpiintegaglpi') ?>')">
          <?= \GlpiPlugin\Integaglpi\Plugin::renderCsrfToken() ?>
          <input type="hidden" name="action" value="sync_now">
          <button class="btn btn-primary btn-sm" type="submit">
            <i class="ti ti-refresh me-1"></i><?= __('Sincronizar agora', 'glpiintegaglpi') ?>
          </button>
        </form>
        <button class="btn btn-outline-secondary btn-sm" type="button"
                data-bs-toggle="collapse" data-bs-target="#dryRunPanel">
          <i class="ti ti-player-play me-1"></i><?= __('Preview / Dry-run', 'glpiintegaglpi') ?>
        </button>
      </div>
    </div>

    <div class="card-body p-0">
      <?php if ($schemaReady): ?>
      <div class="table-responsive">
        <table class="table table-hover table-sm mb-0">
          <thead class="table-dark">
            <tr>
              <th><?= __('Campo LogMeIn', 'glpiintegaglpi') ?></th>
              <th><?= __('Destino GLPI', 'glpiintegaglpi') ?></th>
              <th><?= __('Tipo GLPI', 'glpiintegaglpi') ?></th>
              <th><?= __('Política de sobrescrita', 'glpiintegaglpi') ?></th>
              <th><?= __('Flag requerida', 'glpiintegaglpi') ?></th>
              <th><?= __('Ativo', 'glpiintegaglpi') ?></th>
              <th><?= __('Ações', 'glpiintegaglpi') ?></th>
            </tr>
          </thead>
          <tbody>
          <?php foreach ($mappings as $m): ?>
            <?php
              $isForbidden = in_array((string) ($m['logmein_field_key'] ?? ''), $forbiddenFields, true);
              $rowClass    = $isForbidden ? 'table-danger' : (!(bool)($m['is_active'] ?? false) ? 'text-muted' : '');
            ?>
            <tr class="<?= htmlspecialchars($rowClass) ?>">
              <td>
                <code><?= htmlspecialchars((string) ($m['logmein_field_key'] ?? '')) ?></code>
                <?php if ($isForbidden): ?>
                  <span class="badge bg-danger ms-1"><?= __('PII — proibido', 'glpiintegaglpi') ?></span>
                <?php endif; ?>
              </td>
              <td><code><?= htmlspecialchars((string) ($m['glpi_target_field'] ?? '')) ?></code></td>
              <td><?= htmlspecialchars($targetTypeLabels[(string)($m['glpi_target_type']??'')] ?? (string)($m['glpi_target_type']??'')) ?></td>
              <td>
                <?php if (!$isForbidden): ?>
                <form method="post" class="d-inline">
                  <?= \GlpiPlugin\Integaglpi\Plugin::renderCsrfToken() ?>
                  <input type="hidden" name="action" value="set_policy">
                  <input type="hidden" name="mapping_id" value="<?= (int)($m['id']??0) ?>">
                  <select name="overwrite_policy" class="form-select form-select-sm"
                          onchange="this.form.submit()" <?= $isForbidden ? 'disabled' : '' ?>>
                    <?php foreach ($validPolicies as $pol): ?>
                      <option value="<?= htmlspecialchars($pol) ?>"
                        <?= ((string)($m['overwrite_policy']??'')) === $pol ? 'selected' : '' ?>>
                        <?= htmlspecialchars($policyLabels[$pol] ?? $pol) ?>
                      </option>
                    <?php endforeach; ?>
                  </select>
                </form>
                <?php else: ?>
                  <span class="badge bg-danger"><?= __('bloqueado', 'glpiintegaglpi') ?></span>
                <?php endif; ?>
              </td>
              <td>
                <?php if ($m['requires_flag']): ?>
                  <code class="text-info"><?= htmlspecialchars((string)($m['requires_flag']??'')) ?></code>
                <?php else: ?>
                  <span class="text-muted">—</span>
                <?php endif; ?>
              </td>
              <td>
                <form method="post" class="d-inline">
                  <?= \GlpiPlugin\Integaglpi\Plugin::renderCsrfToken() ?>
                  <input type="hidden" name="action" value="toggle_active">
                  <input type="hidden" name="mapping_id" value="<?= (int)($m['id']??0) ?>">
                  <input type="hidden" name="is_active" value="<?= (bool)($m['is_active']??false) ? '0' : '1' ?>">
                  <button type="submit" class="btn btn-sm <?= (bool)($m['is_active']??false) ? 'btn-success' : 'btn-outline-secondary' ?>"
                          <?= $isForbidden ? 'disabled title="'.__('PII — não pode ser ativado','glpiintegaglpi').'"' : '' ?>>
                    <?= (bool)($m['is_active']??false) ? __('Ativo','glpiintegaglpi') : __('Inativo','glpiintegaglpi') ?>
                  </button>
                </form>
              </td>
              <td>
                <small class="text-muted">#<?= (int)($m['id']??0) ?></small>
              </td>
            </tr>
          <?php endforeach; ?>
          </tbody>
        </table>
      </div>
      <?php endif; ?>
    </div>
  </div>

  <!-- Dry-run panel -->
  <div class="collapse mt-3 <?= $dryRunResult ? 'show' : '' ?>" id="dryRunPanel">
    <div class="card">
      <div class="card-header">
        <h6 class="mb-0">
          <i class="ti ti-player-play me-1"></i>
          <?= __('Preview / Dry-run (não altera o GLPI)', 'glpiintegaglpi') ?>
        </h6>
      </div>
      <div class="card-body">
        <form method="post">
          <?= \GlpiPlugin\Integaglpi\Plugin::renderCsrfToken() ?>
          <input type="hidden" name="action" value="dry_run">
          <div class="row g-2 mb-3">
            <div class="col-md-4">
              <label class="form-label form-label-sm"><?= __('GLPI serial atual', 'glpiintegaglpi') ?></label>
              <input type="text" name="current_glpi_values[serial]" class="form-control form-control-sm"
                     placeholder="<?= __('deixe vazio se não preenchido', 'glpiintegaglpi') ?>">
            </div>
            <div class="col-md-4">
              <label class="form-label form-label-sm"><?= __('GLPI fabricante atual', 'glpiintegaglpi') ?></label>
              <input type="text" name="current_glpi_values[manufacturer]" class="form-control form-control-sm">
            </div>
            <div class="col-md-4 d-flex align-items-end gap-2">
              <div class="form-check form-switch">
                <input class="form-check-input" type="checkbox" name="sync_local_ip" value="1" id="syncIp">
                <label class="form-check-label small" for="syncIp">LOGMEIN_SYNC_LOCAL_IP</label>
              </div>
              <button type="submit" class="btn btn-outline-primary btn-sm">
                <i class="ti ti-eye me-1"></i><?= __('Executar preview', 'glpiintegaglpi') ?>
              </button>
            </div>
          </div>
          <div class="alert alert-info small mb-0">
            <i class="ti ti-info-circle me-1"></i>
            <?= __('O preview mostra o que seria alterado. Nenhum dado é modificado no GLPI. Nenhum chamado é criado automaticamente.', 'glpiintegaglpi') ?>
            <!-- dry_run_only=true · auto_ticket=false · alarm_engine=false -->
          </div>
        </form>

        <?php if ($dryRunResult !== null): ?>
          <hr>
          <div class="row g-2 mb-3">
            <?php foreach ($dryRunResult['summary'] ?? [] as $key => $count): ?>
              <div class="col-auto">
                <span class="badge bg-<?= htmlspecialchars($statusBadge[$key] ?? 'secondary') ?> fs-6">
                  <?= htmlspecialchars($key) ?>: <?= (int)$count ?>
                </span>
              </div>
            <?php endforeach; ?>
          </div>
          <div class="table-responsive">
            <table class="table table-sm table-hover">
              <thead class="table-secondary">
                <tr>
                  <th><?= __('Campo LM', 'glpiintegaglpi') ?></th>
                  <th><?= __('Campo GLPI', 'glpiintegaglpi') ?></th>
                  <th><?= __('Política', 'glpiintegaglpi') ?></th>
                  <th><?= __('Status', 'glpiintegaglpi') ?></th>
                  <th><?= __('Valor atual', 'glpiintegaglpi') ?></th>
                  <th><?= __('Valor proposto', 'glpiintegaglpi') ?></th>
                </tr>
              </thead>
              <tbody>
              <?php foreach ($dryRunResult['fields'] ?? [] as $f): ?>
                <tr>
                  <td><code><?= htmlspecialchars((string)($f['logmein_field_key']??'')) ?></code></td>
                  <td><code><?= htmlspecialchars((string)($f['glpi_target_field']??'')) ?></code></td>
                  <td><small><?= htmlspecialchars($policyLabels[(string)($f['overwrite_policy']??'')] ?? (string)($f['overwrite_policy']??'—')) ?></small></td>
                  <td>
                    <span class="badge bg-<?= htmlspecialchars($statusBadge[(string)($f['status']??'')] ?? 'secondary') ?>">
                      <?= htmlspecialchars((string)($f['status']??'')) ?>
                    </span>
                  </td>
                  <td><small class="text-muted"><?= htmlspecialchars((string)($f['current_glpi_value']??'—')) ?></small></td>
                  <td><small><?= htmlspecialchars((string)($f['proposed_value']??'—')) ?></small></td>
                </tr>
              <?php endforeach; ?>
              </tbody>
            </table>
          </div>
        <?php endif; ?>
      </div>
    </div>
  </div>
</div>
