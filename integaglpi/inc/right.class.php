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
            READ   => __('IntegraGLPI: acessar Console, Diagnóstico, Contratos e Horas, IA Supervisora read-only', 'integaglpi'),
            UPDATE => __('IntegraGLPI: operar atendimentos e administrar Configurações, Mensagens, Templates, Contratos e Supervisor', 'integaglpi'),
        ];
    }
}
