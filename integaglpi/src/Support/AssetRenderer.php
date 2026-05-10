<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi\Support;

final class AssetRenderer
{
    private static bool $integaglpiJsRendered = false;

    public static function renderIntegaglpiJs(): void
    {
        if (self::$integaglpiJsRendered) {
            return;
        }
        self::$integaglpiJsRendered = true;

        $path = PLUGIN_INTEGAGLPI_ROOT . '/js/integaglpi.js';
        $contents = @file_get_contents($path);
        if ($contents === false || $contents === '') {
            error_log('[integaglpi][assets][error] Unable to read js/integaglpi.js from ' . $path);
            return;
        }

        // Prevent accidental early script termination if the JS ever contains </script>.
        $safeContents = str_replace('</script>', '<\/script>', $contents);

        echo "<script>\n" . $safeContents . "\n</script>\n";
    }
}

