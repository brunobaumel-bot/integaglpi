<?php

declare(strict_types=1);

/** @var \GlpiPlugin\Integaglpi\Renderer\AiPilotRenderer $this */
/** @var array<string, mixed> $data */

$statusResponse = is_array($data['status'] ?? null) ? $data['status'] : [];
$body = is_array($statusResponse['body'] ?? null) ? $statusResponse['body'] : [];
$status = is_array($body['status'] ?? null) ? $body['status'] : [];
$budget = is_array($status['budget'] ?? null) ? $status['budget'] : [];
$testResult = is_array($data['test_result'] ?? null) ? $data['test_result'] : null;
$message = trim((string) ($data['message'] ?? ''));

$boolLabel = static fn (mixed $value): string => $value === true ? 'true' : 'false';
?>

<div class="d-flex align-items-center justify-content-between gap-3 mb-3">
    <div>
        <h2 class="mb-1"><?= $this->escape(__('Piloto IA Cloud / Embeddings', 'glpiintegaglpi')); ?></h2>
        <div class="text-muted">
            <?= $this->escape(__('Piloto controlado, desabilitado por padrão, para testes sintéticos e sanitizados.', 'glpiintegaglpi')); ?>
        </div>
    </div>
    <span class="badge bg-secondary"><?= $this->escape(__('read-only / sem ação operacional', 'glpiintegaglpi')); ?></span>
</div>

<div class="alert alert-warning">
    <?= $this->escape(__('LGPD/DPO: nenhuma chamada externa deve ocorrer sem opt-in administrativo, aprovação DPO/LGPD, orçamento disponível e payload anonimizado. Nenhum WhatsApp, ticket ou KB é alterado.', 'glpiintegaglpi')); ?>
</div>

<?php if ($message !== '') : ?>
    <div class="alert alert-info"><?= $this->escape($message); ?></div>
<?php endif; ?>

<div class="row g-3 mb-3">
    <?php
    $cards = [
        __('Cloud habilitada', 'glpiintegaglpi') => $boolLabel($status['cloudEnabled'] ?? false),
        __('Embeddings habilitados', 'glpiintegaglpi') => $boolLabel($status['embeddingsEnabled'] ?? false),
        __('Provider', 'glpiintegaglpi') => (string) ($status['provider'] ?? 'disabled'),
        __('Modelo', 'glpiintegaglpi') => (string) ($status['model'] ?? 'pilot-disabled'),
        __('Opt-in admin', 'glpiintegaglpi') => $boolLabel($status['adminOptIn'] ?? false),
        __('DPO/LGPD', 'glpiintegaglpi') => $boolLabel($status['dpoApproved'] ?? false),
        __('Budget restante', 'glpiintegaglpi') => (string) ($budget['remaining'] ?? 0),
        __('Custo mês', 'glpiintegaglpi') => (string) ($budget['monthCost'] ?? 0),
    ];
    ?>
    <?php foreach ($cards as $label => $value) : ?>
        <div class="col-md-3">
            <div class="border rounded p-3 h-100">
                <div class="text-muted small mb-1"><?= $this->escape((string) $label); ?></div>
                <div class="fw-bold"><?= $this->escape((string) $value); ?></div>
            </div>
        </div>
    <?php endforeach; ?>
</div>

<div class="card mb-3">
    <div class="card-header"><?= $this->escape(__('Teste sintético', 'glpiintegaglpi')); ?></div>
    <div class="card-body">
        <form method="post" action="<?= $this->escape($this->getAiPilotUrl()); ?>">
            <?= \GlpiPlugin\Integaglpi\Plugin::renderCsrfToken(); ?>
            <input type="hidden" name="action" value="synthetic_test">
            <label class="form-label" for="ai-pilot-payload"><?= $this->escape(__('Payload sintético sem PII', 'glpiintegaglpi')); ?></label>
            <textarea class="form-control" id="ai-pilot-payload" name="payload" rows="4" maxlength="2000">Teste sintético: comparar resumo local e cloud sem dados reais.</textarea>
            <div class="form-text">
                <?= $this->escape(__('A sanitização roda no Node antes de qualquer provider. Payload com PII/segredo/base64 será bloqueado.', 'glpiintegaglpi')); ?>
            </div>
            <button class="btn btn-outline-primary mt-3" type="submit">
                <?= $this->escape(__('Executar teste com payload sintético', 'glpiintegaglpi')); ?>
            </button>
        </form>
    </div>
</div>

<?php if ($testResult !== null) : ?>
    <?php $resultBody = is_array($testResult['body'] ?? null) ? $testResult['body'] : []; ?>
    <?php $result = is_array($resultBody['result'] ?? null) ? $resultBody['result'] : []; ?>
    <div class="card mb-3">
        <div class="card-header"><?= $this->escape(__('Resultado do teste', 'glpiintegaglpi')); ?></div>
        <div class="card-body">
            <dl class="row mb-0">
                <dt class="col-sm-3">Status</dt>
                <dd class="col-sm-9"><?= $this->escape((string) ($result['status'] ?? 'n/a')); ?></dd>
                <dt class="col-sm-3"><?= $this->escape(__('Bloqueio', 'glpiintegaglpi')); ?></dt>
                <dd class="col-sm-9"><?= $this->escape((string) ($result['blockedReason'] ?? '')); ?></dd>
                <dt class="col-sm-3"><?= $this->escape(__('Provider', 'glpiintegaglpi')); ?></dt>
                <dd class="col-sm-9"><?= $this->escape((string) ($result['provider'] ?? '')); ?></dd>
                <dt class="col-sm-3"><?= $this->escape(__('Custo estimado', 'glpiintegaglpi')); ?></dt>
                <dd class="col-sm-9"><?= $this->escape((string) ($result['estimatedCost'] ?? 0)); ?></dd>
                <dt class="col-sm-3"><?= $this->escape(__('Hash anonimizado', 'glpiintegaglpi')); ?></dt>
                <dd class="col-sm-9"><code><?= $this->escape((string) ($result['anonymizedPayloadHash'] ?? '')); ?></code></dd>
                <dt class="col-sm-3"><?= $this->escape(__('Prévia', 'glpiintegaglpi')); ?></dt>
                <dd class="col-sm-9"><?= $this->escape((string) ($result['outputPreview'] ?? '')); ?></dd>
            </dl>
        </div>
    </div>
<?php endif; ?>

<div class="alert alert-secondary">
    <?= $this->escape(__('Caminho de desabilitação: manter AI_PILOT_CLOUD_ENABLED=false e AI_PILOT_EMBEDDINGS_ENABLED=false. Produção permanece desabilitada por padrão.', 'glpiintegaglpi')); ?>
</div>
