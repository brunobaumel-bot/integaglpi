<?php

declare(strict_types=1);

use GlpiPlugin\Integaglpi\Plugin;

/**
 * central_hub_dashboard.php — F3 Central Hub Operacional template
 *
 * Renders 5 read-only operational cards: Saúde HML, Smart Help, KB Quality,
 * LogMeIn, Alarmes.
 *
 * Safety invariants:
 *   - All output escaping via htmlspecialchars / Html::cleanInputText.
 *   - No PII rendered: no phone, IP, token, credential, MAC, email.
 *   - No inline JS that sends data externally.
 *   - No CDN or external resource (F3 contract: no new external JS/CSS libs).
 *   - Displays "feature desabilitado" badge when feature_flag_enabled=false.
 *   - Read-only badge on header.
 *
 * @var array<string, mixed> $data
 */

$e = static fn (string $s): string => Html::cleanInputText($s);

$ok            = (bool) ($data['ok'] ?? false);
$flagEnabled   = (bool) ($data['feature_flag_enabled'] ?? false);
$generatedAt   = (string) ($data['generated_at'] ?? '');
$readonlyNote  = (string) ($data['readonly_note'] ?? '');
$error         = is_string($data['error'] ?? null) ? (string) $data['error'] : null;
$cards         = is_array($data['cards'] ?? null) ? $data['cards'] : [];

$cardSaude     = is_array($cards['saude_hml']  ?? null) ? $cards['saude_hml']  : [];
$cardSmartHelp = is_array($cards['smart_help'] ?? null) ? $cards['smart_help'] : [];
$cardKb        = is_array($cards['kb_quality'] ?? null) ? $cards['kb_quality'] : [];
$cardLogmein   = is_array($cards['logmein']    ?? null) ? $cards['logmein']    : [];
$cardAlarmes   = is_array($cards['alarmes']    ?? null) ? $cards['alarmes']    : [];

$badgeOk   = 'text-bg-success';
$badgeWarn = 'text-bg-warning';
$badgeErr  = 'text-bg-danger';
$badgeSec  = 'text-bg-secondary';

$boolBadge = static function (bool $val, string $labelTrue = '', string $labelFalse = '') use ($badgeOk, $badgeSec, $e): void {
    $class = $val ? $badgeOk : $badgeSec;
    $label = $val ? ($labelTrue ?: 'Sim') : ($labelFalse ?: 'Não');
    echo '<span class="badge ' . $class . '">' . $e($label) . '</span>';
};

$nullInt = static fn (mixed $v): string => $v === null ? '—' : (string) (int) $v;
$nullFloat = static fn (mixed $v, int $dec = 1): string =>
    $v === null ? '—' : number_format((float) $v, $dec, ',', '.');

?>

<div class="container-fluid integaglpi-central-hub py-3">

    {{/* ── Header ──────────────────────────────────────────────────────────── */}}
    <div class="d-flex flex-wrap justify-content-between align-items-start gap-2 mb-4">
        <div>
            <h2 class="mb-1"><?= $e(__('Hub Operacional', 'glpiintegaglpi')); ?></h2>
            <p class="text-muted mb-0">
                <?= $e(__('Visão consolidada read-only — Saúde, IA, KB, LogMeIn e Alarmes.', 'glpiintegaglpi')); ?>
            </p>
        </div>
        <div class="d-flex flex-column align-items-end gap-1">
            <span class="badge text-bg-light border"><?= $e(__('read-only', 'glpiintegaglpi')); ?></span>
            <?php if (!$flagEnabled): ?>
                <span class="badge text-bg-warning">
                    <?= $e(__('Feature desabilitada (CENTRAL_HUB_ENABLED=false)', 'glpiintegaglpi')); ?>
                </span>
            <?php endif; ?>
            <?php if ($generatedAt !== ''): ?>
                <span class="small text-muted">
                    <?= $e(__('Gerado em:', 'glpiintegaglpi')); ?> <?= $e($generatedAt); ?>
                </span>
            <?php endif; ?>
        </div>
    </div>

    <?php if (!$ok && $error !== null): ?>
        {{/* ── Global error ──────────────────────────────────────────────── */}}
        <div class="alert alert-danger" role="alert">
            <strong><?= $e(__('Hub indisponível', 'glpiintegaglpi')); ?></strong>
            <?= $e(__('O integration-service retornou um erro. Verifique os logs.', 'glpiintegaglpi')); ?>
            <span class="badge text-bg-secondary ms-2"><?= $e($error); ?></span>
        </div>
    <?php else: ?>

        <div class="row g-3">

            {{/* ── Card 1: Saúde HML ───────────────────────────────────────── */}}
            <div class="col-12 col-lg-6 col-xl-4">
                <div class="card h-100 shadow-sm">
                    <div class="card-header d-flex justify-content-between align-items-center">
                        <span class="fw-semibold">
                            <i class="ti ti-heartbeat me-1"></i>
                            <?= $e(__('Saúde HML', 'glpiintegaglpi')); ?>
                        </span>
                        <?php
                        $sOk = (bool) ($cardSaude['ok'] ?? false);
                        echo '<span class="badge ' . ($sOk ? $badgeOk : $badgeErr) . '">' .
                            $e($sOk ? __('OK', 'glpiintegaglpi') : __('Falha', 'glpiintegaglpi')) . '</span>';
                        ?>
                    </div>
                    <div class="card-body">
                        <?php $sd = is_array($cardSaude['data'] ?? null) ? $cardSaude['data'] : null; ?>
                        <?php if ($sd === null): ?>
                            <p class="text-muted small mb-0">
                                <?php if (isset($cardSaude['error'])): ?>
                                    <?= $e((string) $cardSaude['error']); ?>
                                <?php else: ?>
                                    <?= $e(__('Dados indisponíveis.', 'glpiintegaglpi')); ?>
                                <?php endif; ?>
                            </p>
                        <?php else: ?>
                            <ul class="list-unstyled mb-0 small">
                                <li class="d-flex justify-content-between py-1 border-bottom">
                                    <span><?= $e(__('PostgreSQL', 'glpiintegaglpi')); ?></span>
                                    <span>
                                        <?php $boolBadge((bool) ($sd['postgres_ok'] ?? false), 'OK', 'Falha'); ?>
                                        <?php if ($sd['postgres_latency'] !== null): ?>
                                            <span class="text-muted ms-1"><?= (int) $sd['postgres_latency']; ?>ms</span>
                                        <?php endif; ?>
                                    </span>
                                </li>
                                <li class="d-flex justify-content-between py-1 border-bottom">
                                    <span><?= $e(__('Redis', 'glpiintegaglpi')); ?></span>
                                    <span>
                                        <?php $boolBadge((bool) ($sd['redis_ok'] ?? false), 'OK', 'Falha'); ?>
                                        <span class="text-muted ms-1"><?= $e((string) ($sd['redis_status'] ?? '')); ?></span>
                                    </span>
                                </li>
                                <li class="d-flex justify-content-between py-1 border-bottom">
                                    <span><?= $e(__('Ollama', 'glpiintegaglpi')); ?></span>
                                    <span>
                                        <?php $boolBadge((bool) ($sd['ollama_configured'] ?? false), 'Configurado', 'Desativado'); ?>
                                        <span class="text-muted ms-1"><?= $e((string) ($sd['ollama_provider'] ?? '')); ?></span>
                                    </span>
                                </li>
                                <li class="d-flex justify-content-between py-1 border-bottom">
                                    <span><?= $e(__('Workers IA', 'glpiintegaglpi')); ?></span>
                                    <?php $boolBadge((bool) ($sd['workers_ai'] ?? false), 'Ativo', 'Inativo'); ?>
                                </li>
                                <li class="d-flex justify-content-between py-1 border-bottom">
                                    <span><?= $e(__('Meta (WhatsApp)', 'glpiintegaglpi')); ?></span>
                                    <?php $boolBadge((bool) ($sd['meta_configured'] ?? false), 'Configurado', 'Sem config'); ?>
                                </li>
                                <li class="d-flex justify-content-between py-1">
                                    <span><?= $e(__('Uptime', 'glpiintegaglpi')); ?></span>
                                    <span class="text-muted"><?= (int) ($sd['uptime_seconds'] ?? 0); ?>s</span>
                                </li>
                            </ul>
                        <?php endif; ?>
                        <?php if (isset($cardSaude['latency_ms'])): ?>
                            <div class="text-end text-muted" style="font-size:.7rem; margin-top:.5rem;">
                                <?= $e(__('latência:', 'glpiintegaglpi')); ?> <?= (int) $cardSaude['latency_ms']; ?>ms
                            </div>
                        <?php endif; ?>
                    </div>
                </div>
            </div>

            {{/* ── Card 2: Smart Help ──────────────────────────────────────── */}}
            <div class="col-12 col-lg-6 col-xl-4">
                <div class="card h-100 shadow-sm">
                    <div class="card-header d-flex justify-content-between align-items-center">
                        <span class="fw-semibold">
                            <i class="ti ti-robot me-1"></i>
                            <?= $e(__('Smart Help / IA', 'glpiintegaglpi')); ?>
                        </span>
                        <?php
                        $shOk = (bool) ($cardSmartHelp['ok'] ?? false);
                        echo '<span class="badge ' . ($shOk ? $badgeOk : $badgeErr) . '">' .
                            $e($shOk ? __('OK', 'glpiintegaglpi') : __('Falha', 'glpiintegaglpi')) . '</span>';
                        ?>
                    </div>
                    <div class="card-body">
                        <?php $shd = is_array($cardSmartHelp['data'] ?? null) ? $cardSmartHelp['data'] : null; ?>
                        <?php if ($shd === null): ?>
                            <p class="text-muted small mb-0">
                                <?= $e((string) ($cardSmartHelp['error'] ?? __('Dados indisponíveis.', 'glpiintegaglpi'))); ?>
                            </p>
                        <?php else: ?>
                            <ul class="list-unstyled mb-0 small">
                                <li class="d-flex justify-content-between py-1 border-bottom">
                                    <span><?= $e(__('Supervisor IA', 'glpiintegaglpi')); ?></span>
                                    <span>
                                        <?php $boolBadge((bool) ($shd['ai_supervisor_enabled'] ?? false), 'Ativo', 'Inativo'); ?>
                                        <span class="text-muted ms-1"><?= $e((string) ($shd['ai_supervisor_provider'] ?? '')); ?></span>
                                    </span>
                                </li>
                                <li class="d-flex justify-content-between py-1 border-bottom">
                                    <span><?= $e(__('Modelo IA', 'glpiintegaglpi')); ?></span>
                                    <span class="text-muted"><?= $e((string) ($shd['ai_supervisor_model'] ?? '—')); ?></span>
                                </li>
                                <li class="d-flex justify-content-between py-1 border-bottom">
                                    <span><?= $e(__('Copiloto', 'glpiintegaglpi')); ?></span>
                                    <span>
                                        <?php $boolBadge((bool) ($shd['copilot_enabled'] ?? false), 'Ativo', 'Inativo'); ?>
                                        <span class="text-muted ms-1"><?= $e((string) ($shd['copilot_provider'] ?? '')); ?></span>
                                    </span>
                                </li>
                                <li class="d-flex justify-content-between py-1 border-bottom">
                                    <span><?= $e(__('Cloud AI', 'glpiintegaglpi')); ?></span>
                                    <span class="badge text-bg-secondary"><?= $e(__('Desativado', 'glpiintegaglpi')); ?></span>
                                </li>
                                <?php if (!empty($shd['pii_guard_note'])): ?>
                                    <li class="py-1 text-muted" style="font-size:.75rem;">
                                        <i class="ti ti-shield-lock me-1"></i>
                                        <?= $e((string) $shd['pii_guard_note']); ?>
                                    </li>
                                <?php endif; ?>
                            </ul>
                        <?php endif; ?>
                    </div>
                </div>
            </div>

            {{/* ── Card 3: KB Quality ──────────────────────────────────────── */}}
            <div class="col-12 col-lg-6 col-xl-4">
                <div class="card h-100 shadow-sm">
                    <div class="card-header d-flex justify-content-between align-items-center">
                        <span class="fw-semibold">
                            <i class="ti ti-books me-1"></i>
                            <?= $e(__('KB Quality', 'glpiintegaglpi')); ?>
                        </span>
                        <?php
                        $kbOk = (bool) ($cardKb['ok'] ?? false);
                        echo '<span class="badge ' . ($kbOk ? $badgeOk : $badgeErr) . '">' .
                            $e($kbOk ? __('OK', 'glpiintegaglpi') : __('Falha', 'glpiintegaglpi')) . '</span>';
                        ?>
                    </div>
                    <div class="card-body">
                        <?php $kbd = is_array($cardKb['data'] ?? null) ? $cardKb['data'] : null; ?>
                        <?php if ($kbd === null): ?>
                            <p class="text-muted small mb-0">
                                <?= $e((string) ($cardKb['error'] ?? __('Dados indisponíveis.', 'glpiintegaglpi'))); ?>
                            </p>
                        <?php else: ?>
                            <ul class="list-unstyled mb-0 small">
                                <li class="d-flex justify-content-between py-1 border-bottom">
                                    <span><?= $e(__('Golden Set (queries)', 'glpiintegaglpi')); ?></span>
                                    <span class="fw-semibold"><?= (int) ($kbd['golden_set_total'] ?? 0); ?></span>
                                </li>
                                <li class="d-flex justify-content-between py-1 border-bottom">
                                    <span><?= $e(__('Prod. Detection (baseline)', 'glpiintegaglpi')); ?></span>
                                    <span><?= $nullFloat($kbd['product_detection_rate'] ?? null, 1); ?><?= $kbd['product_detection_rate'] !== null ? '%' : ''; ?></span>
                                </li>
                                <li class="d-flex justify-content-between py-1 border-bottom">
                                    <span><?= $e(__('Tier Coverage (baseline)', 'glpiintegaglpi')); ?></span>
                                    <span><?= $nullFloat($kbd['tier_coverage_rate'] ?? null, 1); ?><?= $kbd['tier_coverage_rate'] !== null ? '%' : ''; ?></span>
                                </li>
                                <li class="d-flex justify-content-between py-1 border-bottom">
                                    <span><?= $e(sprintf(__('Votos (últimos %dd)', 'glpiintegaglpi'), (int) ($kbd['period_days'] ?? 30))); ?></span>
                                    <span><?= (int) ($kbd['total_votes'] ?? 0); ?></span>
                                </li>
                                <li class="d-flex justify-content-between py-1 border-bottom">
                                    <span><?= $e(__('Taxa "útil"', 'glpiintegaglpi')); ?></span>
                                    <span><?= $nullFloat($kbd['helpful_ratio'] !== null ? ($kbd['helpful_ratio'] * 100) : null, 1); ?><?= $kbd['helpful_ratio'] !== null ? '%' : ''; ?></span>
                                </li>
                                <?php if (!empty($kbd['top_gap_categories'])): ?>
                                    <li class="py-1">
                                        <div class="text-muted mb-1"><?= $e(__('Principais lacunas:', 'glpiintegaglpi')); ?></div>
                                        <?php foreach ((array) $kbd['top_gap_categories'] as $cat): ?>
                                            <span class="badge text-bg-secondary me-1 mb-1"><?= $e((string) $cat); ?></span>
                                        <?php endforeach; ?>
                                    </li>
                                <?php endif; ?>
                            </ul>
                        <?php endif; ?>
                    </div>
                </div>
            </div>

            {{/* ── Card 4: LogMeIn ─────────────────────────────────────────── */}}
            <div class="col-12 col-lg-6 col-xl-6">
                <div class="card h-100 shadow-sm">
                    <div class="card-header d-flex justify-content-between align-items-center">
                        <span class="fw-semibold">
                            <i class="ti ti-device-laptop me-1"></i>
                            <?= $e(__('LogMeIn', 'glpiintegaglpi')); ?>
                        </span>
                        <?php
                        $lmOk = (bool) ($cardLogmein['ok'] ?? false);
                        echo '<span class="badge ' . ($lmOk ? $badgeOk : $badgeErr) . '">' .
                            $e($lmOk ? __('OK', 'glpiintegaglpi') : __('Falha', 'glpiintegaglpi')) . '</span>';
                        ?>
                    </div>
                    <div class="card-body">
                        <?php $lmd = is_array($cardLogmein['data'] ?? null) ? $cardLogmein['data'] : null; ?>
                        <?php if ($lmd === null): ?>
                            <p class="text-muted small mb-0">
                                <?= $e((string) ($cardLogmein['error'] ?? __('LogMeIn desativado ou dados indisponíveis.', 'glpiintegaglpi'))); ?>
                            </p>
                        <?php else: ?>
                            <div class="row g-2 mb-2 text-center">
                                <div class="col-4">
                                    <div class="border rounded p-2">
                                        <div class="fs-4 fw-bold"><?= (int) ($lmd['total_hosts'] ?? 0); ?></div>
                                        <div class="small text-muted"><?= $e(__('Hosts', 'glpiintegaglpi')); ?></div>
                                    </div>
                                </div>
                                <div class="col-4">
                                    <div class="border rounded p-2 <?= (int) ($lmd['hosts_without_tag'] ?? 0) > 0 ? 'border-warning' : ''; ?>">
                                        <div class="fs-4 fw-bold"><?= (int) ($lmd['hosts_without_tag'] ?? 0); ?></div>
                                        <div class="small text-muted"><?= $e(__('Sem tag', 'glpiintegaglpi')); ?></div>
                                    </div>
                                </div>
                                <div class="col-4">
                                    <div class="border rounded p-2 <?= (int) ($lmd['groups_without_entity'] ?? 0) > 0 ? 'border-warning' : ''; ?>">
                                        <div class="fs-4 fw-bold"><?= (int) ($lmd['groups_without_entity'] ?? 0); ?></div>
                                        <div class="small text-muted"><?= $e(__('Grupos s/ entidade', 'glpiintegaglpi')); ?></div>
                                    </div>
                                </div>
                            </div>
                            <ul class="list-unstyled mb-0 small">
                                <li class="d-flex justify-content-between py-1 border-bottom">
                                    <span><?= $e(__('Último sync', 'glpiintegaglpi')); ?></span>
                                    <span>
                                        <?php if ($lmd['last_sync_status'] !== null): ?>
                                            <span class="badge <?= $lmd['last_sync_status'] === 'completed' ? $badgeOk : $badgeErr; ?>">
                                                <?= $e((string) $lmd['last_sync_status']); ?>
                                            </span>
                                        <?php else: ?>
                                            <span class="text-muted">—</span>
                                        <?php endif; ?>
                                    </span>
                                </li>
                                <li class="d-flex justify-content-between py-1 border-bottom">
                                    <span><?= $e(__('Cache (h)', 'glpiintegaglpi')); ?></span>
                                    <span class="text-muted"><?= $nullFloat($lmd['cache_age_hours'] ?? null, 1); ?></span>
                                </li>
                                <li class="d-flex justify-content-between py-1">
                                    <span><?= $e(__('Regras ativas', 'glpiintegaglpi')); ?></span>
                                    <span><?= (int) ($lmd['enabled_rules'] ?? 0); ?></span>
                                </li>
                                <?php if (!empty($lmd['alarm_types_monitored'])): ?>
                                    <li class="py-1">
                                        <div class="text-muted mb-1"><?= $e(__('Tipos monitorados:', 'glpiintegaglpi')); ?></div>
                                        <?php foreach ((array) $lmd['alarm_types_monitored'] as $at): ?>
                                            <span class="badge text-bg-secondary me-1 mb-1"><?= $e((string) $at); ?></span>
                                        <?php endforeach; ?>
                                    </li>
                                <?php endif; ?>
                            </ul>
                        <?php endif; ?>
                    </div>
                </div>
            </div>

            {{/* ── Card 5: Alarmes ─────────────────────────────────────────── */}}
            <div class="col-12 col-lg-12 col-xl-6">
                <div class="card h-100 shadow-sm">
                    <div class="card-header d-flex justify-content-between align-items-center">
                        <span class="fw-semibold">
                            <i class="ti ti-bell-ringing me-1"></i>
                            <?= $e(__('Alarmes', 'glpiintegaglpi')); ?>
                            <span class="badge text-bg-secondary fw-normal ms-1">
                                <?= $e(sprintf(__('%d dias', 'glpiintegaglpi'), (int) ($cardAlarmes['data']['period_days'] ?? 7))); ?>
                            </span>
                        </span>
                        <?php
                        $alOk = (bool) ($cardAlarmes['ok'] ?? false);
                        echo '<span class="badge ' . ($alOk ? $badgeOk : $badgeErr) . '">' .
                            $e($alOk ? __('OK', 'glpiintegaglpi') : __('Falha', 'glpiintegaglpi')) . '</span>';
                        ?>
                    </div>
                    <div class="card-body">
                        <?php $ald = is_array($cardAlarmes['data'] ?? null) ? $cardAlarmes['data'] : null; ?>
                        <?php if ($ald === null): ?>
                            <p class="text-muted small mb-0">
                                <?= $e((string) ($cardAlarmes['error'] ?? __('Dados indisponíveis.', 'glpiintegaglpi'))); ?>
                            </p>
                        <?php else: ?>
                            <div class="mb-3 text-center">
                                <div class="fs-3 fw-bold"><?= (int) ($ald['total_events'] ?? 0); ?></div>
                                <div class="small text-muted"><?= $e(__('eventos totais', 'glpiintegaglpi')); ?></div>
                            </div>
                            <div class="row g-2 text-center mb-3">
                                <?php
                                $breakdown = [
                                    'fired'               => [__('Disparados', 'glpiintegaglpi'), $badgeSec],
                                    'suppressed_cooldown' => [__('Suprimidos (cooldown)', 'glpiintegaglpi'), $badgeWarn],
                                    'suppressed_dedupe'   => [__('Suprimidos (dedupe)', 'glpiintegaglpi'), $badgeWarn],
                                    'ticket_created'      => [__('Ticket criado', 'glpiintegaglpi'), $badgeOk],
                                    'dry_run'             => [__('Dry run', 'glpiintegaglpi'), 'text-bg-info'],
                                ];
                                foreach ($breakdown as $key => [$label, $badgeClass]):
                                    $count = (int) ($ald[$key] ?? 0);
                                ?>
                                    <div class="col-6 col-md-4">
                                        <div class="border rounded p-2">
                                            <span class="badge <?= $badgeClass; ?> mb-1"><?= $count; ?></span>
                                            <div class="small text-muted" style="font-size:.7rem;"><?= $e($label); ?></div>
                                        </div>
                                    </div>
                                <?php endforeach; ?>
                            </div>
                            <?php if (!empty($ald['recent_alarm_types'])): ?>
                                <div>
                                    <div class="small text-muted mb-1"><?= $e(__('Tipos recentes:', 'glpiintegaglpi')); ?></div>
                                    <?php foreach ((array) $ald['recent_alarm_types'] as $at): ?>
                                        <span class="badge text-bg-secondary me-1 mb-1"><?= $e((string) $at); ?></span>
                                    <?php endforeach; ?>
                                </div>
                            <?php endif; ?>
                        <?php endif; ?>
                    </div>
                </div>
            </div>

        </div>{{/* end .row */}}

        {{/* ── Footer note ──────────────────────────────────────────────────── */}}
        <?php if ($readonlyNote !== ''): ?>
            <div class="mt-3 text-muted small text-center">
                <i class="ti ti-shield-check me-1"></i>
                <?= $e($readonlyNote); ?>
            </div>
        <?php endif; ?>

    <?php endif; ?>{{/* end !$ok error branch */}}

</div>{{/* end .container-fluid */}}
