<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi\Renderer;

use GlpiPlugin\Integaglpi\Plugin;
use Html;

final class RiskScoreRenderer
{
    /**
     * @param array<string, mixed>|null $score
     */
    public function renderTicketBadge(?array $score, int $ticketId, ?string $conversationId): string
    {
        if ($score === null) {
            return '';
        }

        $riskScore = (int) ($score['risk_score'] ?? 0);
        $badgeClass = $riskScore >= 70 ? 'danger' : ($riskScore >= 40 ? 'warning text-dark' : 'success');
        $scoreId = (string) ($score['score_id'] ?? '');
        $reasons = is_array($score['reasons'] ?? null) ? $score['reasons'] : [];
        $warnings = is_array($score['data_quality_warnings'] ?? null) ? $score['data_quality_warnings'] : [];
        $signals = is_array($score['signals_used'] ?? null) ? $score['signals_used'] : [];

        ob_start();
        ?>
        <div class="border rounded p-3 mt-3 js-integaglpi-risk-score">
            <div class="d-flex align-items-center justify-content-between gap-2">
                <div>
                    <strong><?= $this->escape(__('Indicador preditivo de risco', 'glpiintegaglpi')); ?></strong>
                    <div class="small text-muted">
                        <?= $this->escape(__('Indicador preditivo para apoio humano. Não executa ações automaticamente.', 'glpiintegaglpi')); ?>
                    </div>
                </div>
                <span class="badge bg-<?= $this->escape($badgeClass); ?>">
                    <?= $riskScore; ?>%
                </span>
            </div>
            <div class="row g-2 mt-2 small">
                <div class="col-md-3">
                    <span class="text-muted"><?= $this->escape(__('Reabertura', 'glpiintegaglpi')); ?></span><br>
                    <?= $this->escape((string) ($score['reopen_risk'] ?? 'unknown')); ?>
                </div>
                <div class="col-md-3">
                    <span class="text-muted"><?= $this->escape(__('Insatisfação', 'glpiintegaglpi')); ?></span><br>
                    <?= $this->escape((string) ($score['dissatisfaction_risk'] ?? 'unknown')); ?>
                </div>
                <div class="col-md-3">
                    <span class="text-muted"><?= $this->escape(__('Abandono', 'glpiintegaglpi')); ?></span><br>
                    <?= $this->escape((string) ($score['abandonment_risk'] ?? 'unknown')); ?>
                </div>
                <div class="col-md-3">
                    <span class="text-muted"><?= $this->escape(__('Confiança', 'glpiintegaglpi')); ?></span><br>
                    <?= (int) ($score['confidence_score'] ?? 0); ?>%
                </div>
                <div class="col-md-12">
                    <span class="text-muted"><?= $this->escape(__('Ação humana sugerida', 'glpiintegaglpi')); ?></span><br>
                    <?= $this->escape((string) ($score['suggested_human_action'] ?? '-')); ?>
                </div>
                <?php if ($reasons !== []) { ?>
                    <div class="col-md-12">
                        <span class="text-muted"><?= $this->escape(__('Motivos', 'glpiintegaglpi')); ?></span><br>
                        <?= $this->escape(implode('; ', array_map('strval', $reasons))); ?>
                    </div>
                <?php } ?>
                <?php if ($warnings !== []) { ?>
                    <div class="col-md-12 alert alert-warning py-2 mb-0">
                        <?= $this->escape(implode('; ', array_map('strval', $warnings))); ?>
                    </div>
                <?php } ?>
                <div class="col-md-12 text-muted">
                    <?= $this->escape(__('Sinais usados', 'glpiintegaglpi')); ?>:
                    <?= $this->escape($signals === [] ? '-' : implode(', ', array_slice(array_map('strval', $signals), 0, 8))); ?>
                </div>
            </div>
            <?php if ($scoreId !== '' && Plugin::canUpdate()) { ?>
                <form method="post" action="<?= $this->escape(Plugin::getWebBasePath() . '/front/risk.feedback.php'); ?>" class="row g-2 mt-2">
                    <?= Plugin::renderCsrfToken(); ?>
                    <input type="hidden" name="score_id" value="<?= $this->escape($scoreId); ?>">
                    <input type="hidden" name="ticket_id" value="<?= $ticketId; ?>">
                    <input type="hidden" name="conversation_id" value="<?= $this->escape((string) $conversationId); ?>">
                    <div class="col-md-3">
                        <select class="form-select form-select-sm" name="feedback_rating">
                            <option value="useful"><?= $this->escape(__('Útil', 'glpiintegaglpi')); ?></option>
                            <option value="incorrect"><?= $this->escape(__('Incorreto', 'glpiintegaglpi')); ?></option>
                            <option value="unsure"><?= $this->escape(__('Incerto', 'glpiintegaglpi')); ?></option>
                        </select>
                    </div>
                    <div class="col-md-6">
                        <input class="form-control form-control-sm" type="text" name="feedback_notes" maxlength="500" placeholder="<?= $this->escape(__('Observação opcional', 'glpiintegaglpi')); ?>">
                    </div>
                    <div class="col-md-3">
                        <button class="btn btn-sm btn-outline-secondary" type="submit">
                            <?= $this->escape(__('Salvar feedback', 'glpiintegaglpi')); ?>
                        </button>
                    </div>
                </form>
            <?php } ?>
        </div>
        <?php
        return (string) ob_get_clean();
    }

    public function escape(string $value): string
    {
        return Html::cleanInputText($value);
    }
}
