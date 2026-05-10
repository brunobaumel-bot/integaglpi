<?php

declare(strict_types=1);

// Canonical plugin identity (installed under /plugins/integaglpi).
if (!defined('PLUGIN_INTEGAGLPI_NAME')) {
    define('PLUGIN_INTEGAGLPI_NAME', 'integaglpi');
}
if (!defined('PLUGIN_INTEGAGLPI_ROOT')) {
    define('PLUGIN_INTEGAGLPI_ROOT', dirname(__DIR__));
}
if (!defined('PLUGIN_INTEGAGLPI_CONFIG_TABLE')) {
    define('PLUGIN_INTEGAGLPI_CONFIG_TABLE', 'glpi_plugin_integaglpi_configs');
}
if (!defined('PLUGIN_INTEGAGLPI_EXTERNAL_PREFIX')) {
    define('PLUGIN_INTEGAGLPI_EXTERNAL_PREFIX', 'glpi_plugin_integaglpi_');
}

// Backward-compatible aliases (in case a legacy reference remains).
if (!defined('PLUGIN_GLPIWHATSAPP_NAME')) {
    define('PLUGIN_GLPIWHATSAPP_NAME', PLUGIN_INTEGAGLPI_NAME);
}
if (!defined('PLUGIN_GLPIWHATSAPP_ROOT')) {
    define('PLUGIN_GLPIWHATSAPP_ROOT', PLUGIN_INTEGAGLPI_ROOT);
}
if (!defined('PLUGIN_GLPIWHATSAPP_CONFIG_TABLE')) {
    define('PLUGIN_GLPIWHATSAPP_CONFIG_TABLE', PLUGIN_INTEGAGLPI_CONFIG_TABLE);
}
if (!defined('PLUGIN_GLPIWHATSAPP_EXTERNAL_PREFIX')) {
    define('PLUGIN_GLPIWHATSAPP_EXTERNAL_PREFIX', PLUGIN_INTEGAGLPI_EXTERNAL_PREFIX);
}
