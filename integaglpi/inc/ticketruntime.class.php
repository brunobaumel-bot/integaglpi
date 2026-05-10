<?php

declare(strict_types=1);

/**
 * Legacy (non-namespaced) itemtype shim for GLPI tab registration.
 *
 * Some GLPI setups still integrate plugin tab providers more reliably when the
 * provider itemtype follows the historical `PluginXxxYyy` naming convention.
 *
 * This class delegates behavior to the namespaced implementation by inheritance.
 */
class PluginIntegaglpiTicketRuntime extends \GlpiPlugin\Integaglpi\TicketRuntime
{
}

