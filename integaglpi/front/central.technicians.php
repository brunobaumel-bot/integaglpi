<?php

declare(strict_types=1);

use GlpiPlugin\Integaglpi\Plugin;

include '../../../inc/includes.php';

header('Content-Type: application/json; charset=UTF-8');

/**
 * @param array<string, mixed> $payload
 */
function plugin_integaglpi_central_technicians_json(array $payload, int $statusCode = 200): never
{
    http_response_code($statusCode);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

/**
 * @param array<int, true> $profileIds
 * @return array<int, true>
 */
function plugin_integaglpi_central_technicians_profile_users(array $profileIds): array
{
    global $DB;

    if ($profileIds === []) {
        return [];
    }

    $userIds = [];
    $iterator = $DB->request([
        'SELECT' => ['users_id', 'profiles_id'],
        'FROM'   => 'glpi_profiles_users',
        'WHERE'  => [
            'profiles_id' => array_keys($profileIds),
        ],
    ]);

    foreach ($iterator as $row) {
        $profileId = (int) ($row['profiles_id'] ?? 0);
        $userId = (int) ($row['users_id'] ?? 0);
        if ($profileId > 0 && $userId > 0 && isset($profileIds[$profileId])) {
            $userIds[$userId] = true;
        }
    }

    return $userIds;
}

try {
    Session::checkLoginUser();
    if (!Session::haveRight(Plugin::RIGHT_NAME, READ)) {
        plugin_integaglpi_central_technicians_json([
            'ok' => false,
            'error' => 'forbidden',
            'message' => __('You do not have permission to view technicians.', 'glpiintegaglpi'),
        ], 403);
    }

    if (strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET')) !== 'GET') {
        plugin_integaglpi_central_technicians_json([
            'ok' => false,
            'error' => 'method_not_allowed',
            'message' => __('Only GET requests are allowed.', 'glpiintegaglpi'),
        ], 405);
    }

    global $DB;

    $pluginRightsMask = READ | UPDATE;
    $ticketUpdateMask = UPDATE;

    $pluginProfileIds = [];
    $pluginRights = $DB->request([
        'SELECT' => ['profiles_id', 'rights'],
        'FROM'   => 'glpi_profilerights',
        'WHERE'  => ['name' => Plugin::RIGHT_NAME],
    ]);
    foreach ($pluginRights as $row) {
        $profileId = (int) ($row['profiles_id'] ?? 0);
        $rights = (int) ($row['rights'] ?? 0);
        if ($profileId > 0 && ($rights & $pluginRightsMask) !== 0) {
            $pluginProfileIds[$profileId] = true;
        }
    }

    $ticketUpdateProfileIds = [];
    $ticketRights = $DB->request([
        'SELECT' => ['profiles_id', 'rights'],
        'FROM'   => 'glpi_profilerights',
        'WHERE'  => ['name' => 'ticket'],
    ]);
    foreach ($ticketRights as $row) {
        $profileId = (int) ($row['profiles_id'] ?? 0);
        $rights = (int) ($row['rights'] ?? 0);
        if ($profileId > 0 && ($rights & $ticketUpdateMask) !== 0) {
            $ticketUpdateProfileIds[$profileId] = true;
        }
    }

    $centralProfileIds = [];
    $profiles = $DB->request([
        'SELECT' => ['id', 'interface'],
        'FROM'   => 'glpi_profiles',
    ]);
    foreach ($profiles as $row) {
        $profileId = (int) ($row['id'] ?? 0);
        if ($profileId > 0 && (string) ($row['interface'] ?? '') === 'central') {
            $centralProfileIds[$profileId] = true;
        }
    }

    $eligibleProfileIds = [];
    foreach ($pluginProfileIds as $profileId => $_enabled) {
        if (isset($centralProfileIds[$profileId]) || isset($ticketUpdateProfileIds[$profileId])) {
            $eligibleProfileIds[$profileId] = true;
        }
    }

    $eligibleUserIds = plugin_integaglpi_central_technicians_profile_users($eligibleProfileIds);
    if ($eligibleUserIds === []) {
        error_log('[integaglpi][central][technicians][empty] no eligible technicians found');
        plugin_integaglpi_central_technicians_json([
            'ok' => true,
            'users' => [],
        ]);
    }

    $users = [];
    $userIterator = $DB->request([
        'SELECT' => ['id'],
        'FROM'   => 'glpi_users',
        'WHERE'  => [
            'id'         => array_keys($eligibleUserIds),
            'is_deleted' => 0,
            'is_active'  => 1,
        ],
        'ORDER'  => ['realname ASC', 'firstname ASC', 'name ASC'],
        'LIMIT'  => 500,
    ]);

    foreach ($userIterator as $row) {
        $userId = (int) ($row['id'] ?? 0);
        if ($userId <= 0) {
            continue;
        }

        $users[] = [
            'id' => $userId,
            'name' => (string) getUserName($userId),
        ];
    }

    usort(
        $users,
        static fn (array $left, array $right): int => strcasecmp((string) $left['name'], (string) $right['name'])
    );

    if ($users === []) {
        error_log('[integaglpi][central][technicians][empty] no eligible technicians found');
    }

    plugin_integaglpi_central_technicians_json([
        'ok' => true,
        'users' => $users,
    ]);
} catch (Throwable $exception) {
    error_log('[integaglpi][central][technicians][error] ' . $exception->getMessage());

    plugin_integaglpi_central_technicians_json([
        'ok' => false,
        'error' => 'internal_error',
        'message' => __('Unable to load technicians right now.', 'glpiintegaglpi'),
    ], 500);
}
