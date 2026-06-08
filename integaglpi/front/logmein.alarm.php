<?php

declare(strict_types=1);

use GlpiPlugin\Integaglpi\LogmeinGroupMenu;
use GlpiPlugin\Integaglpi\Plugin;
use GlpiPlugin\Integaglpi\Service\LogmeinAlarmAdminService;

include '../../../inc/includes.php';

// ── Auth + RBAC ────────────────────────────────────────────────────────────────

Session::checkLoginUser();

if (!Plugin::canRead()) {
    Html::displayRightError();
}

$canWrite = Plugin::canUpdate();
$service  = new LogmeinAlarmAdminService();
$flash    = null;

// ── AJAX: host search (GET, JSON) ─────────────────────────────────────────────

if ($_SERVER['REQUEST_METHOD'] === 'GET' && isset($_GET['action']) && $_GET['action'] === 'search_hosts') {
    header('Content-Type: application/json; charset=UTF-8');
    if (!Plugin::canRead()) {
        echo json_encode(['ok' => false, 'hosts' => []], JSON_UNESCAPED_UNICODE);
        exit;
    }
    $q       = mb_substr(trim((string) ($_GET['q'] ?? '')), 0, 100, 'UTF-8');
    $groupId = trim((string) ($_GET['group_id'] ?? ''));
    $hosts   = $service->searchHosts($q, $groupId, 100);
    echo json_encode(['ok' => true, 'hosts' => $hosts], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

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

        } elseif ($action === 'add_target') {
            $ruleId   = trim((string) ($_POST['rule_id'] ?? ''));
            $hostId   = trim((string) ($_POST['host_id'] ?? ''));
            $hostname = trim((string) ($_POST['hostname'] ?? ''));
            $result   = $service->addTarget($ruleId, $hostId, $hostname);
            $flash    = $result['ok']
                ? ['type' => 'success', 'message' => __('Dispositivo adicionado como alvo.', 'glpiintegaglpi')]
                : ['type' => 'danger',  'message' => implode(' | ', $result['errors'])];

        } elseif ($action === 'remove_target') {
            $ruleId = trim((string) ($_POST['rule_id'] ?? ''));
            $hostId = trim((string) ($_POST['host_id'] ?? ''));
            $result = $service->removeTarget($ruleId, $hostId);
            $flash  = $result['ok']
                ? ['type' => 'success', 'message' => __('Alvo removido.', 'glpiintegaglpi')]
                : ['type' => 'danger',  'message' => implode(' | ', $result['errors'])];

        } else {
            $flash = ['type' => 'danger', 'message' => __('Ação inválida.', 'glpiintegaglpi')];
        }
    }
}

// ── Data ───────────────────────────────────────────────────────────────────────

$schemaReady  = $service->isSchemaReady();
$hasGuards    = $service->hasGuardsColumns();
$rules        = $schemaReady ? $service->listAllRules() : [];
$recentEvents = $schemaReady ? $service->listRecentEvents(50) : [];
$validTypes   = LogmeinAlarmAdminService::getValidTypes();
$groups       = $schemaReady ? $service->listGroups() : [];

// Load targets for each rule (keyed by rule_id)
$ruleIds     = array_column($rules, 'id');
$ruleTargets = $schemaReady && $ruleIds !== [] ? $service->listTargetsForRules($ruleIds) : [];

// ── Render ─────────────────────────────────────────────────────────────────────

Html::header(
    __('Alarmes LogMeIn', 'glpiintegaglpi'),
    $_SERVER['PHP_SELF'],
    'plugins',
    LogmeinGroupMenu::class
);

include __DIR__ . '/../templates/logmein_alarm.php';

Html::footer();
