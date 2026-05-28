<?php

declare(strict_types=1);

const INTEGAGLPI_PHPUNIT_BOOTSTRAPPED = true;

$pluginRoot = dirname(__DIR__);

if (!defined('PLUGIN_INTEGAGLPI_ROOT')) {
    define('PLUGIN_INTEGAGLPI_ROOT', $pluginRoot);
}

if (!defined('PLUGIN_INTEGAGLPI_NAME')) {
    define('PLUGIN_INTEGAGLPI_NAME', 'integaglpi');
}

foreach (['READ' => 1, 'UPDATE' => 2, 'CREATE' => 2, 'PURGE' => 4] as $constant => $value) {
    if (!defined($constant)) {
        define($constant, $value);
    }
}

if (!isset($GLOBALS['CFG_GLPI']) || !is_array($GLOBALS['CFG_GLPI'])) {
    $GLOBALS['CFG_GLPI'] = ['root_doc' => '/glpi'];
}

if (!function_exists('__')) {
    function __($value, $domain = null)
    {
        return (string) $value;
    }
}

if (!class_exists('CommonDBTM', false)) {
    class CommonDBTM
    {
    }
}

if (!class_exists('CommonGLPI', false)) {
    class CommonGLPI
    {
    }
}

if (!class_exists('Ticket', false)) {
    class Ticket extends CommonGLPI
    {
        public array $fields = [];

        public function getID(): int
        {
            return (int) ($this->fields['id'] ?? 0);
        }
    }
}

if (!class_exists('Html', false)) {
    class Html
    {
        public static function cleanInputText($value): string
        {
            return htmlspecialchars((string) $value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
        }
    }
}

if (!class_exists('Session', false)) {
    class Session
    {
        public static function checkRight($rightName, $right): void
        {
        }

        public static function haveRight($rightName, $right): bool
        {
            return true;
        }

        public static function checkCSRF($data = null): void
        {
        }

        public static function getLoginUserID(): int
        {
            return 1;
        }

        public static function getNewCSRFToken(): string
        {
            return 'test-csrf-token';
        }
    }
}

if (!class_exists('ProfileRight', false)) {
    class ProfileRight
    {
        public static function updateProfileRights(array $rights): void
        {
        }
    }
}

if (!class_exists('Profile', false)) {
    class Profile extends CommonDBTM
    {
        public array $fields = [];

        public function getID(): int
        {
            return (int) ($this->fields['id'] ?? 0);
        }
    }
}

$vendorAutoload = $pluginRoot . '/vendor/autoload.php';
if (is_file($vendorAutoload)) {
    require_once $vendorAutoload;
} else {
    spl_autoload_register(static function (string $class) use ($pluginRoot): void {
        $prefix = 'GlpiPlugin\\Integaglpi\\';
        if (strncmp($class, $prefix, strlen($prefix)) !== 0) {
            return;
        }

        $relative = str_replace('\\', DIRECTORY_SEPARATOR, substr($class, strlen($prefix))) . '.php';
        $path = $pluginRoot . DIRECTORY_SEPARATOR . 'src' . DIRECTORY_SEPARATOR . $relative;
        if (is_file($path)) {
            require_once $path;
        }
    });
}
