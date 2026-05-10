<?php

declare(strict_types=1);

use GlpiPlugin\Integaglpi\Plugin;

/**
 * Declara direitos do plugin para aparecer em Administração > Perfis.
 *
 * GLPI carrega permissões de plugins a partir de classes registradas que
 * implementam getRights().
 */
class PluginIntegaglpiRight
{
    public static $rightname = Plugin::RIGHT_NAME;

    /**
     * @param string $interface
     *
     * @return array<int, string>
     */
    public static function getRights($interface = 'central'): array
    {
        return [
            READ   => __('Visualizar conversas WhatsApp', 'integaglpi'),
            UPDATE => __('Operar atendimentos (Assumir/Encerrar)', 'integaglpi'),
        ];
    }
}

