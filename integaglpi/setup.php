<?php

declare(strict_types=1);

use Glpi\Plugin\Hooks;
use GlpiPlugin\Integaglpi\AiOperationsMenu;
use GlpiPlugin\Integaglpi\AttendanceCenterMenu;
use GlpiPlugin\Integaglpi\ConfiguracaoGroupMenu;
use GlpiPlugin\Integaglpi\ContactAgendaImportMenu;
use GlpiPlugin\Integaglpi\ContractsHoursMenu;
use GlpiPlugin\Integaglpi\CoachingMenu;
use GlpiPlugin\Integaglpi\ExternalResearchMenu;
use GlpiPlugin\Integaglpi\GestaoGroupMenu;
use GlpiPlugin\Integaglpi\IaGroupMenu;
use GlpiPlugin\Integaglpi\Install\Installer;
use GlpiPlugin\Integaglpi\LogmeinAlarmMenu;
use GlpiPlugin\Integaglpi\LogmeinGroupMenu;
use GlpiPlugin\Integaglpi\KnowledgeBaseMenu;
use GlpiPlugin\Integaglpi\KbCandidatesMenu;
use GlpiPlugin\Integaglpi\MonitoramentoGroupMenu;
use GlpiPlugin\Integaglpi\OnlineMonitorMenu;
use GlpiPlugin\Integaglpi\OperationLogMenu;
use GlpiPlugin\Integaglpi\OperationalDiagnosticsMenu;
use GlpiPlugin\Integaglpi\ObservabilityMenu;
use GlpiPlugin\Integaglpi\Plugin;
use GlpiPlugin\Integaglpi\Profile;
use GlpiPlugin\Integaglpi\QualityDashboardMenu;
use GlpiPlugin\Integaglpi\Queue;
use GlpiPlugin\Integaglpi\RoutingOptionsMenu;
use GlpiPlugin\Integaglpi\RoutingSafetyMenu;
use GlpiPlugin\Integaglpi\SecurityCenterMenu;
use GlpiPlugin\Integaglpi\TechnicalHealthMenu;
use GlpiPlugin\Integaglpi\ServiceCatalogMenu;
use GlpiPlugin\Integaglpi\Service\TicketSyncService;
use GlpiPlugin\Integaglpi\SupervisaoGroupMenu;
use GlpiPlugin\Integaglpi\SupervisorBackofficeMenu;
use GlpiPlugin\Integaglpi\TicketRuntime;
use GlpiPlugin\Integaglpi\WhatsAppGroupMenu;

if (file_exists(__DIR__ . '/vendor/autoload.php')) {
    require_once __DIR__ . '/vendor/autoload.php';
} else {
    // Fallback autoloader for installs without composer vendor/.
    // Ensures plugin classes (including tab providers) are loadable in GLPI 11.
    spl_autoload_register(static function (string $class): void {
        $prefix = 'GlpiPlugin\\Integaglpi\\';
        if (strncmp($class, $prefix, strlen($prefix)) !== 0) {
            return;
        }

        $relative = substr($class, strlen($prefix));
        $path = __DIR__ . '/src/' . str_replace('\\', '/', $relative) . '.php';
        if (is_file($path)) {
            require_once $path;
        }
    });
}

require_once __DIR__ . '/inc/define.php';
// Legacy (non-namespaced) tab provider shim.
require_once __DIR__ . '/inc/ticketruntime.class.php';

define('PLUGIN_INTEGAGLPI_VERSION', '0.2.0');

/**
 * Avoid silent failures during install/update/uninstall. Prefer GLPI logger when available.
 */
function plugin_integaglpi_logThrowable(\Throwable $exception, string $context): void
{
    $message = sprintf('[integaglpi] %s failed: %s', $context, $exception->getMessage());

    // GLPI production environments may not expose Toolbox::logError().
    // Use plain error_log() to ensure failures are always visible.
    error_log($message . "\n" . $exception->getTraceAsString());
}

function plugin_integaglpi_is_admin_profile(array $profile): bool
{
    $name = strtolower(trim((string) ($profile['name'] ?? '')));

    return in_array($name, ['super-admin', 'super admin', 'admin', 'administrator', 'administrador'], true);
}

function plugin_integaglpi_ensure_profile_rights(): void
{
    global $DB;

    if (!isset($DB) || !is_object($DB)) {
        return;
    }

    $rights = Profile::getAllRights();
    $profiles = [];
    foreach ($DB->request(['FROM' => 'glpi_profiles']) as $profile) {
        $profileId = (int) ($profile['id'] ?? 0);
        if ($profileId > 0) {
            $profiles[$profileId] = $profile;
        }
    }

    foreach ($rights as $right) {
        $field = (string) ($right['field'] ?? '');
        if ($field === '') {
            continue;
        }

        $existingRows = [];
        foreach ($DB->request(['FROM' => 'glpi_profilerights', 'WHERE' => ['name' => $field]]) as $row) {
            $existingRows[(int) ($row['profiles_id'] ?? 0)] = $row;
        }

        foreach ($profiles as $profileId => $profile) {
            $isAdmin = plugin_integaglpi_is_admin_profile($profile);
            $adminRights = READ | UPDATE;
            $defaultRights = (int) ($right['default'] ?? 0);
            $desiredRights = $isAdmin ? $adminRights : $defaultRights;
            $existing = $existingRows[$profileId] ?? null;

            if ($existing === null) {
                $result = $DB->insert('glpi_profilerights', [
                    'profiles_id' => $profileId,
                    'name' => $field,
                    'rights' => $desiredRights,
                ]);
                if ($result === false) {
                    error_log('[integaglpi][rights] insert failed profile=' . $profileId . ' name=' . $field . ' error=' . $DB->error());
                }
                continue;
            }

            // Do not overwrite custom permissions. Only fix the install-time
            // zero-rights state for administrator profiles.
            if ($isAdmin && (int) ($existing['rights'] ?? 0) === 0) {
                $result = $DB->update(
                    'glpi_profilerights',
                    ['rights' => $adminRights],
                    ['profiles_id' => $profileId, 'name' => $field]
                );
                if ($result === false) {
                    error_log('[integaglpi][rights] admin update failed profile=' . $profileId . ' name=' . $field . ' error=' . $DB->error());
                }
            }
        }
    }
}

function plugin_version_integaglpi(): array
{
    return [
        'name' => 'integaglpi',
        'version' => PLUGIN_INTEGAGLPI_VERSION,
        'author' => 'Codex',
        'license' => 'GPLv3+',
        'homepage' => '',
        'requirements' => [
            'glpi' => [
                'min' => '11.0.0',
            ],
            'php' => [
                'min' => '8.2',
            ],
        ],
    ];
}

function plugin_init_integaglpi(): void
{
    global $PLUGIN_HOOKS;

    $PLUGIN_HOOKS['csrf_compliant'][PLUGIN_INTEGAGLPI_NAME] = true;
    $PLUGIN_HOOKS[Hooks::ADD_JAVASCRIPT][PLUGIN_INTEGAGLPI_NAME][] = 'front/integaglpi.js.php';
    $PLUGIN_HOOKS[Hooks::ITEM_ADD][PLUGIN_INTEGAGLPI_NAME][\Ticket::class] = 'plugin_integaglpi_item_add_ticket';
    $PLUGIN_HOOKS[Hooks::ITEM_ADD][PLUGIN_INTEGAGLPI_NAME][\Ticket_User::class] = 'plugin_integaglpi_item_add_ticket_user';
    $PLUGIN_HOOKS[Hooks::ITEM_UPDATE][PLUGIN_INTEGAGLPI_NAME][\Ticket_User::class] = 'plugin_integaglpi_item_add_ticket_user';
    $PLUGIN_HOOKS[Hooks::ITEM_ADD][PLUGIN_INTEGAGLPI_NAME][\ITILFollowup::class] = 'plugin_integaglpi_item_add_followup';
    $PLUGIN_HOOKS[Hooks::ITEM_ADD][PLUGIN_INTEGAGLPI_NAME][\ITILSolution::class] = 'plugin_integaglpi_item_solution';
    $PLUGIN_HOOKS[Hooks::ITEM_ADD][PLUGIN_INTEGAGLPI_NAME][\Document_Item::class] = 'plugin_integaglpi_item_add_document_item';
    $PLUGIN_HOOKS[Hooks::ITEM_UPDATE][PLUGIN_INTEGAGLPI_NAME][\Ticket::class] = 'plugin_integaglpi_ticket_update';
    // ITEM_UPDATE for ITILSolution intentionally not registered.
    // Re-firing notifyTicketSolved when a solution is updated (e.g. customer
    // approval flips status/date_approval) produced a duplicate ticket_solved
    // message because the fallback idempotency key (without solution_id) does
    // not collide with the ITEM_ADD key (which includes solution_id). The
    // ITEM_ADD hook already covers the legitimate "solution registered" event.
    // Phase: integaglpi_ops_console_claim_ui_messaging_stabilization_001.
    // JS assets are injected by renderers (see Support\AssetRenderer) because
    // some environments return 404 for /plugins/... static assets.
    // Phase: integaglpi_ops_console_claim_ui_messaging_stabilization_001.
    // Use GLPI parent menu entries with options so operators can expand each
    // category directly in the sidebar without an intermediate hub page.
    $PLUGIN_HOOKS[Hooks::MENU_TOADD][PLUGIN_INTEGAGLPI_NAME] = [
        'plugin_integaglpi_whatsapp' => [
            WhatsAppGroupMenu::class,
        ],
        'plugin_integaglpi_configuracao' => [
            ConfiguracaoGroupMenu::class,
        ],
        'plugin_integaglpi_monitoramento' => [
            MonitoramentoGroupMenu::class,
        ],
        'plugin_integaglpi_ia' => [
            IaGroupMenu::class,
        ],
        'plugin_integaglpi_gestao' => [
            GestaoGroupMenu::class,
        ],
        'plugin_integaglpi_supervisao' => [
            SupervisaoGroupMenu::class,
        ],
        // Phase integaglpi_plugin_logmein_menu_reorganization_001:
        // LogMeIn Central — dedicated group for all LogMeIn-related admin pages.
        // GLPI-native Contracts and Service Catalog remain the source of truth;
        // their plugin CRUDs are hidden from the sidebar (routes preserved).
        'plugin_integaglpi_logmein' => [
            LogmeinGroupMenu::class,
        ],
        // Phase FIX2: Central de Segurança não fica mais como item solto no
        // sidebar — ela passou a ser filho de Gestão (ver GestaoGroupMenu).
        // SecurityCenterMenu permanece registrada abaixo para resolução de
        // tipo do GLPI e acesso por URL direta a /front/security.center.php.
    ];
    $PLUGIN_HOOKS['config_page'][PLUGIN_INTEGAGLPI_NAME] = 'front/config.form.php';

    // Rights class must be loaded only after GLPI core bootstrap (setup.php is
    // parsed during plugin state checks, before core classes like CommonSection exist).
    require_once __DIR__ . '/inc/right.class.php';
    \Plugin::registerClass('PluginIntegaglpiRight');
    \Plugin::registerClass(Profile::class, ['addtabon' => ['Profile']]);

    // Ensure the canonical right exists even on older installs (no reinstall needed).
    // This path is deliberately idempotent and does not call addProfileRights()
    // because GLPI may throw on duplicate profilerights rows.
    plugin_integaglpi_ensure_profile_rights();

    // Phase 7.4C self-heal: GLPI only re-runs plugin_integaglpi_install() when the
    // operator clicks "Install/Upgrade" in the plugins admin UI. Since 7.4C did not
    // bump PLUGIN_INTEGAGLPI_VERSION, existing deployments never see that button
    // and the integration_auth_key column added by Installer::install() may be
    // missing. ensureSchemaUpToDate() performs an idempotent ALTER (guarded by a
    // static flag for at most one fieldExists() check per request) and never
    // throws — schema problems are logged but the request continues.
    try {
        Installer::ensureSchemaUpToDate();
    } catch (\Throwable $e) {
        error_log('[integaglpi][init][ensureSchema] ' . $e->getMessage());
    }
    // Register separate lightweight tab providers: diagnostic context and operational conversation.
    \Plugin::registerClass('PluginIntegaglpiTicketRuntime', [
        'addtabon' => [\Ticket::class],
    ]);
    \CommonGLPI::registerStandardTab(\Ticket::class, 'PluginIntegaglpiTicketRuntime');
    \Plugin::registerClass(WhatsAppGroupMenu::class);
    \Plugin::registerClass(ConfiguracaoGroupMenu::class);
    \Plugin::registerClass(MonitoramentoGroupMenu::class);
    \Plugin::registerClass(IaGroupMenu::class);
    \Plugin::registerClass(GestaoGroupMenu::class);
    \Plugin::registerClass(SupervisaoGroupMenu::class);
    \Plugin::registerClass(Queue::class);
    \Plugin::registerClass(OperationLogMenu::class);
    \Plugin::registerClass(RoutingSafetyMenu::class);
    \Plugin::registerClass(RoutingOptionsMenu::class);
    \Plugin::registerClass(ContactAgendaImportMenu::class);
    \Plugin::registerClass(AttendanceCenterMenu::class);
    \Plugin::registerClass(OnlineMonitorMenu::class);
    \Plugin::registerClass(SupervisorBackofficeMenu::class);
    \Plugin::registerClass(AiOperationsMenu::class);
    \Plugin::registerClass(QualityDashboardMenu::class);
    \Plugin::registerClass(CoachingMenu::class);
    \Plugin::registerClass(ExternalResearchMenu::class);
    \Plugin::registerClass(ObservabilityMenu::class);
    \Plugin::registerClass(OperationalDiagnosticsMenu::class);
    \Plugin::registerClass(TechnicalHealthMenu::class);
    \Plugin::registerClass(ContractsHoursMenu::class);
    \Plugin::registerClass(ServiceCatalogMenu::class);
    \Plugin::registerClass(KnowledgeBaseMenu::class);
    \Plugin::registerClass(KbCandidatesMenu::class);
    \Plugin::registerClass(SecurityCenterMenu::class);
    // LogmeinAlarmMenu is NOT registered as top-level: it is a child entry
    // inside LogmeinGroupMenu. Registering it separately causes a duplicate
    // sidebar item and breaks menu highlighting when on logmein.alarm.php.
    // (integaglpi_post_smoke_operational_gaps_hml_fix_prod_report_001)
    \Plugin::registerClass(LogmeinGroupMenu::class);
}

function plugin_integaglpi_install(): bool
{
    try {
        Installer::install();

        plugin_integaglpi_ensure_profile_rights();
    } catch (\Throwable $exception) {
        plugin_integaglpi_logThrowable($exception, 'install');
        return false;
    }

    return true;
}

function plugin_integaglpi_uninstall(): bool
{
    try {
        Installer::uninstall();

        foreach (Profile::getAllRights() as $right) {
            ProfileRight::deleteProfileRights([$right['field']]);
        }
    } catch (\Throwable $exception) {
        plugin_integaglpi_logThrowable($exception, 'uninstall');
        return false;
    }

    return true;
}

function plugin_integaglpi_check_prerequisites(): bool
{
    return version_compare(PHP_VERSION, '8.2.0', '>=')
        && extension_loaded('pdo')
        && extension_loaded('pdo_pgsql');
}

function plugin_integaglpi_check_config(bool $verbose = false): bool
{
    return true;
}
