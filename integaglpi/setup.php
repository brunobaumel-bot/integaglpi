<?php

declare(strict_types=1);

use Glpi\Plugin\Hooks;
use GlpiPlugin\Integaglpi\Install\Installer;
use GlpiPlugin\Integaglpi\Plugin;
use GlpiPlugin\Integaglpi\Profile;
use GlpiPlugin\Integaglpi\Queue;
use GlpiPlugin\Integaglpi\Service\TicketSyncService;
use GlpiPlugin\Integaglpi\TicketRuntime;

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

    if (!class_exists('PluginIntegaglpiAttendanceCenterMenu', false) && class_exists('CommonDBTM')) {
        // phpcs:disable PSR1.Classes.ClassDeclaration.MissingNamespace
        class PluginIntegaglpiAttendanceCenterMenu extends CommonDBTM
        {
            public static $rightname = \GlpiPlugin\Integaglpi\Plugin::RIGHT_NAME;

            public static function getTypeName($nb = 0): string
            {
                return __('Central de Atendimento', 'glpiintegaglpi');
            }

            public static function getMenuName($nb = 0): string
            {
                return __('Central de Atendimento', 'glpiintegaglpi');
            }

            /**
             * @return array<string, mixed>
             */
            public static function getMenuContent(): array
            {
                return [
                    'title' => self::getMenuName(),
                    'page'  => \GlpiPlugin\Integaglpi\Plugin::getWebBasePath() . '/front/central.php',
                    'icon'  => 'ti ti-headset',
                ];
            }

            public static function canView(): bool
            {
                return \Session::haveRight(\GlpiPlugin\Integaglpi\Plugin::RIGHT_NAME, READ);
            }
        }
        // phpcs:enable PSR1.Classes.ClassDeclaration.MissingNamespace
    }

    $PLUGIN_HOOKS['csrf_compliant'][PLUGIN_INTEGAGLPI_NAME] = true;
    $PLUGIN_HOOKS[Hooks::ITEM_ADD][PLUGIN_INTEGAGLPI_NAME][\Ticket::class] = 'plugin_integaglpi_item_add_ticket';
    $PLUGIN_HOOKS[Hooks::ITEM_ADD][PLUGIN_INTEGAGLPI_NAME][\ITILFollowup::class] = 'plugin_integaglpi_item_add_followup';
    $PLUGIN_HOOKS[Hooks::ITEM_ADD][PLUGIN_INTEGAGLPI_NAME][\ITILSolution::class] = 'plugin_integaglpi_item_solution';
    $PLUGIN_HOOKS[Hooks::ITEM_UPDATE][PLUGIN_INTEGAGLPI_NAME][\Ticket::class] = 'plugin_integaglpi_ticket_update';
    $PLUGIN_HOOKS[Hooks::ITEM_UPDATE][PLUGIN_INTEGAGLPI_NAME][\ITILSolution::class] = 'plugin_integaglpi_item_solution';
    // JS assets are injected by renderers (see Support\AssetRenderer) because
    // some environments return 404 for /plugins/... static assets.
    $pluginMenuEntries = [Queue::class];
    if (class_exists('PluginIntegaglpiAttendanceCenterMenu', false)) {
        $pluginMenuEntries[] = 'PluginIntegaglpiAttendanceCenterMenu';
    }
    $PLUGIN_HOOKS[Hooks::MENU_TOADD][PLUGIN_INTEGAGLPI_NAME] = [
        'plugins' => $pluginMenuEntries,
    ];
    $PLUGIN_HOOKS['config_page'][PLUGIN_INTEGAGLPI_NAME] = 'front/config.form.php';

    // Rights class must be loaded only after GLPI core bootstrap (setup.php is
    // parsed during plugin state checks, before core classes like CommonSection exist).
    require_once __DIR__ . '/inc/right.class.php';
    \Plugin::registerClass('PluginIntegaglpiRight');
    \Plugin::registerClass(Profile::class, ['addtabon' => ['Profile']]);

    // Ensure the canonical right exists even on older installs (no reinstall needed).
    // This is safe and idempotent in GLPI.
    if (class_exists('ProfileRight')) {
        try {
            ProfileRight::addProfileRights([Plugin::RIGHT_NAME]);
        } catch (\Throwable $e) {
            $message = $e->getMessage();
            // Duplicate entry means the right row already exists for at least one profile.
            // This is expected after the first successful registration.
            if (!str_contains($message, '(1062)') && !str_contains($message, '1062')) {
                error_log('[integaglpi][rights] addProfileRights failed: ' . $message);
            }
        }
    }

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
    // Register only one tab provider to avoid duplicate "WhatsApp" tabs.
    // Keep the legacy shim as the canonical provider for GLPI tabs.
    \Plugin::registerClass('PluginIntegaglpiTicketRuntime', [
        'addtabon' => [\Ticket::class],
    ]);
    \CommonGLPI::registerStandardTab(\Ticket::class, 'PluginIntegaglpiTicketRuntime');
    \Plugin::registerClass(Queue::class);
}

function plugin_integaglpi_install(): bool
{
    try {
        Installer::install();

        foreach (Profile::getAllRights() as $right) {
            ProfileRight::addProfileRights([$right['field']]);
        }
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
