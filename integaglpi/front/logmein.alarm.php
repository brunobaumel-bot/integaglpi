<?php

declare(strict_types=1);

use GlpiPlugin\Integaglpi\LogmeinAlarmMenu;
use GlpiPlugin\Integaglpi\Plugin;
use GlpiPlugin\Integaglpi\Service\LogmeinAlarmAdminService;

include '../../../inc/includes.php';

// ── Auth + RBAC ────────────────────────────────────────────────────────────────

Session::checkLoginUser();

if (!Plugin::canRead()) {
    Html::displayRightError();
}

$canWrite  = Plugin::canWrite();
$service   = new LogmeinAlarmAdminService();
$flash     = null;

// ── POST actions (require write right + CSRF) ──────────────────────────────────

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (!$canWrite) {
        $flash = ['type' => 'danger', 'message' => __('Permissão insuficiente.', 'glpiintegaglpi')];
    } elseif (!Plugin::isCsrfValid($_POST)) {
        $flash = ['type' => 'danger', 'message' => __('Token CSRF inválido. Recarregue a página.', 'glpiintegaglpi')];
    } else {
        $action = trim((string) ($_POST['action'] ?? ''));

        if ($action === 'create_rule') {
            $result = $service->createRule($_POST);
            $flash  = $result['ok']
                ? ['type' => 'success', 'message' => __('Regra criada com sucesso (desabilitada por padrão).', 'glpiintegaglpi')]
                : ['type' => 'danger',  'message' => implode(' | ', $result['errors'])];

        } elseif ($action === 'toggle_enabled') {
            $id      = trim((string) ($_POST['rule_id'] ?? ''));
            $enabled = ($_POST['enabled'] ?? '0') === '1';
            $result  = $service->setEnabled($id, $enabled);
            $flash   = $result['ok']
                ? ['type' => 'success', 'message' => $enabled ? __('Regra habilitada.', 'glpiintegaglpi') : __('Regra desabilitada.', 'glpiintegaglpi')]
                : ['type' => 'danger',  'message' => implode(' | ', $result['errors'])];

        } elseif ($action === 'delete_rule') {
            $id     = trim((string) ($_POST['rule_id'] ?? ''));
            $result = $service->deleteRule($id);
            $flash  = $result['ok']
                ? ['type' => 'success', 'message' => __('Regra excluída.', 'glpiintegaglpi')]
                : ['type' => 'danger',  'message' => implode(' | ', $result['errors'])];

        } else {
            $flash = ['type' => 'danger', 'message' => __('Ação inválida.', 'glpiintegaglpi')];
        }
    }
}

// ── Data ───────────────────────────────────────────────────────────────────────

$schemaReady   = $service->isSchemaReady();
$hasGuards     = $service->hasGuardsColumns();
$rules         = $schemaReady ? $service->listAllRules() : [];
$recentEvents  = $schemaReady ? $service->listRecentEvents(50) : [];
$validTypes    = LogmeinAlarmAdminService::getValidTypes();

// ── Render ─────────────────────────────────────────────────────────────────────

Html::header(
    __('Alarmes LogMeIn', 'glpiintegaglpi'),
    $_SERVER['PHP_SELF'],
    'plugins',
    LogmeinAlarmMenu::class
);

include __DIR__ . '/../templates/logmein_alarm.php';

Html::footer();
